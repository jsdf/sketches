@preconcurrency import AVFoundation
import Foundation

/// Microphone capture for the host app.
///
/// This lives in the *app*, not the keyboard, because iOS denies microphone access to
/// app extensions. See README "Why the app owns the microphone".
///
/// The audio session is configured for `.record` + `.spokenAudio` and, combined with
/// the `audio` background mode, keeps the process alive and capturing after the user
/// swipes back to whatever app they were typing in.
actor AudioCapture {
    enum CaptureError: Error, LocalizedError {
        case permissionDenied
        case engineFailed(any Error)

        var errorDescription: String? {
            switch self {
            case .permissionDenied: "Microphone access was denied. Enable it in Settings > Scribe."
            case .engineFailed(let e): "Could not start the microphone: \(e.localizedDescription)"
            }
        }
    }

    private let engine = AVAudioEngine()
    private var continuation: AsyncStream<AVAudioPCMBuffer>.Continuation?
    private(set) var isRunning = false

    /// Most recent RMS levels, newest last, for the keyboard's waveform.
    private(set) var levels: [Float] = []
    private let levelWindow = 32

    static func requestPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
    }

    /// Activates the audio session and keeps it active for the lifetime of a Scribe
    /// session, so the app is not suspended between dictations.
    func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .spokenAudio, options: [.allowBluetooth])
        try session.setActive(true, options: [])
    }

    func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// Starts the tap and returns a stream of input buffers in the hardware format.
    /// Conversion to the analyzer's format happens downstream.
    func start() throws -> AsyncStream<AVAudioPCMBuffer> {
        guard AVAudioApplication.shared.recordPermission == .granted else {
            throw CaptureError.permissionDenied
        }
        if isRunning { stop() }

        levels.removeAll(keepingCapacity: true)

        let (stream, continuation) = AsyncStream<AVAudioPCMBuffer>.makeStream(
            bufferingPolicy: .bufferingNewest(64)
        )
        self.continuation = continuation

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            // Tap callback runs on a realtime thread: copy, measure, hand off, return.
            guard let copy = buffer.deepCopy() else { return }
            let level = buffer.rmsLevel()
            continuation.yield(copy)
            Task { await self?.record(level: level) }
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            continuation.finish()
            self.continuation = nil
            throw CaptureError.engineFailed(error)
        }

        isRunning = true
        return stream
    }

    func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        continuation?.finish()
        continuation = nil
        isRunning = false
    }

    private func record(level: Float) {
        levels.append(level)
        if levels.count > levelWindow { levels.removeFirst(levels.count - levelWindow) }
    }

    func currentLevels() -> [Float] { levels }
}

extension AVAudioPCMBuffer {
    /// The tap reuses its buffer, so anything handed to another thread must own its storage.
    func deepCopy() -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCapacity) else {
            return nil
        }
        copy.frameLength = frameLength
        let channels = Int(format.channelCount)
        let frames = Int(frameLength)

        if let src = floatChannelData, let dst = copy.floatChannelData {
            for ch in 0..<channels {
                dst[ch].update(from: src[ch], count: frames)
            }
        } else if let src = int16ChannelData, let dst = copy.int16ChannelData {
            for ch in 0..<channels {
                dst[ch].update(from: src[ch], count: frames)
            }
        } else if let src = int32ChannelData, let dst = copy.int32ChannelData {
            for ch in 0..<channels {
                dst[ch].update(from: src[ch], count: frames)
            }
        } else {
            return nil
        }
        return copy
    }

    /// Normalised RMS, roughly 0...1, tuned so speech sits in the upper half.
    func rmsLevel() -> Float {
        guard let data = floatChannelData, frameLength > 0 else { return 0 }
        let frames = Int(frameLength)
        var sum: Float = 0
        for i in 0..<frames {
            let sample = data[0][i]
            sum += sample * sample
        }
        let rms = (sum / Float(frames)).squareRoot()
        let db = 20 * log10(max(rms, 1e-7))
        // -50 dB floor, 0 dB ceiling.
        return min(max((db + 50) / 50, 0), 1)
    }
}

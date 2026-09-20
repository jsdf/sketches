@preconcurrency import AVFoundation
import Foundation

#if canImport(WhisperKit)
import WhisperKit

/// Transcription using open Whisper weights via WhisperKit (CoreML).
///
/// Enable by adding the package to `project.yml`:
///
///     packages:
///       WhisperKit:
///         url: https://github.com/argmaxinc/WhisperKit
///         from: "0.9.0"
///
/// and listing `- package: WhisperKit` under the Scribe target's dependencies.
/// The whole file compiles away when the package isn't linked.
///
/// Trade-off versus `AppleSpeechEngine`: this runs on any device (no Apple
/// Intelligence requirement) and the weights are inspectable, but the model loads
/// into *our* process, costs a few hundred MB of RAM and a noticeable warm-up, and
/// Whisper is not a streaming model — partials come from re-running the decoder over
/// the buffer so far.
actor WhisperKitEngine: TranscriptionEngine {
    enum EngineError: Error, LocalizedError {
        case notPrepared
        var errorDescription: String? { "Whisper model is still loading." }
    }

    /// Whisper is trained on 16 kHz mono.
    private static let sampleRate: Double = 16_000

    private var pipe: WhisperKit?
    private var samples: [Float] = []
    private var updateContinuation: AsyncStream<TranscriptionUpdate>.Continuation?
    private var partialTask: Task<Void, Never>?
    private let converter = BufferConverter()
    private var lastPartialAt: Date = .distantPast
    private var transcribing = false

    private let modelName: String

    init(modelName: String = "base.en") {
        self.modelName = modelName
    }

    var requiredFormat: AVAudioFormat? {
        AVAudioFormat(commonFormat: .pcmFormatFloat32,
                      sampleRate: Self.sampleRate,
                      channels: 1,
                      interleaved: false)
    }

    func prepare(locale: Locale) async throws {
        guard pipe == nil else { return }
        // Downloads the CoreML model on first run and compiles it for this device.
        pipe = try await WhisperKit(model: modelName)
    }

    func beginSession() async throws -> AsyncStream<TranscriptionUpdate> {
        guard pipe != nil else { throw EngineError.notPrepared }
        samples.removeAll(keepingCapacity: true)
        lastPartialAt = .distantPast

        let (stream, continuation) = AsyncStream<TranscriptionUpdate>.makeStream(
            bufferingPolicy: .bufferingNewest(4)
        )
        updateContinuation = continuation
        return stream
    }

    func feed(_ buffer: AVAudioPCMBuffer) async throws {
        guard let format = requiredFormat else { return }
        let converted = try converter.convert(buffer, to: format)
        guard let channel = converted.floatChannelData else { return }
        samples.append(contentsOf: UnsafeBufferPointer(start: channel[0], count: Int(converted.frameLength)))

        // Re-decode at most every 1.5s so the user sees something while speaking.
        if Date.now.timeIntervalSince(lastPartialAt) > 1.5, !transcribing {
            lastPartialAt = .now
            partialTask = Task { await self.emitPartial() }
        }
    }

    private func emitPartial() async {
        guard let pipe, !transcribing else { return }
        transcribing = true
        defer { transcribing = false }
        let snapshot = samples
        guard snapshot.count > Int(Self.sampleRate / 2) else { return }
        guard let results = try? await pipe.transcribe(audioArray: snapshot) else { return }
        let text = results.map(\.text).joined().trimmingCharacters(in: .whitespaces)
        updateContinuation?.yield(TranscriptionUpdate(finalized: "", volatile: text))
    }

    @discardableResult
    func finishSession() async throws -> String {
        partialTask?.cancel()
        partialTask = nil
        defer {
            updateContinuation?.finish()
            updateContinuation = nil
            samples.removeAll(keepingCapacity: false)
        }
        guard let pipe, !samples.isEmpty else { return "" }
        let results = try await pipe.transcribe(audioArray: samples)
        let text = results.map(\.text).joined()
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func cancelSession() async {
        partialTask?.cancel()
        partialTask = nil
        updateContinuation?.finish()
        updateContinuation = nil
        samples.removeAll(keepingCapacity: false)
    }
}
#endif

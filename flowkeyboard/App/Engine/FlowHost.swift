import AVFoundation
import Foundation
import Observation
import UIKit

/// The engine that lives in the containing app and does everything the keyboard can't.
///
/// Lifecycle of one dictation:
///
///   keyboard taps mic
///     -> writes DictationRequest to the shared container, posts `.startDictation`
///     -> FlowHost starts capture + transcription, publishes HostState on every update
///     -> keyboard renders partial text and the waveform
///   keyboard taps stop
///     -> posts `.stopDictation`
///     -> FlowHost finalises the transcript, runs the formatting pass,
///        publishes `.finished` with `formattedText`
///     -> keyboard inserts it via textDocumentProxy and returns to idle
@MainActor
@Observable
final class FlowHost {
    enum SessionState: Equatable {
        case stopped
        case ready          // audio session held, listening for keyboard signals
        case dictating
    }

    private(set) var sessionState: SessionState = .stopped
    private(set) var phase: DictationPhase = .idle
    private(set) var transcript: String = ""
    private(set) var volatileTranscript: String = ""
    private(set) var lastError: String?
    private(set) var lastResult: String?
    /// Completed dictations this launch, newest first. Never leaves the device.
    private(set) var history: [String] = []

    var settings: FlowSettings = FlowSettingsStore.load() {
        didSet {
            guard settings != oldValue else { return }
            FlowSettingsStore.save(settings)
            if settings.backend != oldValue.backend || settings.localeIdentifier != oldValue.localeIdentifier {
                engine = nil
            }
        }
    }

    private let capture = AudioCapture()
    private var engine: (any TranscriptionEngine)?
    private var currentRequest: DictationRequest?
    private var pumpTask: Task<Void, Never>?
    private var updatesTask: Task<Void, Never>?
    private var levelsTask: Task<Void, Never>?
    private var observerTokens: [UUID] = []
    private var lastPublish: Date = .distantPast

    init() {
        observeKeyboard()
    }

    // MARK: - Flow session

    /// Starts a "Flow session": holds the audio session so the app stays resident and
    /// can respond to the keyboard after the user switches away. This is the bit the
    /// user consents to, and the reason the orange mic indicator stays lit.
    func startFlowSession() async {
        guard sessionState == .stopped else { return }

        guard await AudioCapture.requestPermission() else {
            lastError = AudioCapture.CaptureError.permissionDenied.localizedDescription
            return
        }

        do {
            try await capture.activateSession()
        } catch {
            lastError = "Couldn't hold the audio session: \(error.localizedDescription)"
            return
        }

        sessionState = .ready
        lastError = nil
        publish(.idle)
        FlowSignalBus.shared.post(.hostDidBecomeReady)

        // Warm both models so the first dictation isn't the slow one.
        Task.detached { FoundationModelsFormatter.prewarm() }
        Task { await prepareEngine() }
    }

    func endFlowSession() async {
        await cancelDictation()
        await capture.stop()
        await capture.deactivateSession()
        sessionState = .stopped
        publish(.idle)
    }

    private func prepareEngine() async {
        do {
            let engine = try currentEngine()
            try await engine.prepare(locale: settings.locale)
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func currentEngine() throws -> any TranscriptionEngine {
        if let engine { return engine }
        let made: any TranscriptionEngine
        switch settings.backend {
        case .appleSpeech:
            made = AppleSpeechEngine()
        case .whisperKit:
            #if canImport(WhisperKit)
            made = WhisperKitEngine()
            #else
            // The package isn't linked in this build; Apple's model is the only option.
            made = AppleSpeechEngine()
            #endif
        }
        engine = made
        return made
    }

    // MARK: - Keyboard signals

    private func observeKeyboard() {
        let bus = FlowSignalBus.shared
        observerTokens.append(bus.observe(.startDictation) { [weak self] in
            Task { @MainActor in await self?.beginDictation() }
        })
        observerTokens.append(bus.observe(.stopDictation) { [weak self] in
            Task { @MainActor in await self?.finishDictation() }
        })
        observerTokens.append(bus.observe(.cancelDictation) { [weak self] in
            Task { @MainActor in await self?.cancelDictation() }
        })
        observerTokens.append(bus.observe(.keyboardDidAppear) { [weak self] in
            Task { @MainActor in
                guard let self, self.sessionState != .stopped else { return }
                FlowSignalBus.shared.post(.hostDidBecomeReady)
                await self.prepareEngine()
            }
        })
    }

    // MARK: - Dictation

    private func beginDictation() async {
        guard sessionState == .ready else { return }
        guard let request = FlowStore.readRequest() else { return }
        guard request.id != currentRequest?.id else { return }

        currentRequest = request
        transcript = ""
        volatileTranscript = ""
        lastError = nil
        sessionState = .dictating
        publish(.preparing)

        do {
            let engine = try currentEngine()
            try await engine.prepare(locale: settings.locale)

            let updates = try await engine.beginSession()
            let buffers = try await capture.start()

            updatesTask = Task { [weak self] in
                for await update in updates {
                    guard let self else { return }
                    await MainActor.run {
                        self.transcript = update.finalized
                        self.volatileTranscript = update.volatile
                        self.publish(.listening, throttled: true)
                    }
                }
            }

            // Detached: this loop runs for the whole dictation and must not be
            // scheduled on the main actor behind UI work.
            pumpTask = Task.detached {
                for await buffer in buffers {
                    if Task.isCancelled { break }
                    try? await engine.feed(buffer)
                }
            }

            levelsTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard let self else { return }
                    await MainActor.run { self.publish(.listening, throttled: false) }
                }
            }

            publish(.listening)
        } catch {
            lastError = error.localizedDescription
            sessionState = .ready
            publish(.failed)
        }
    }

    private func finishDictation() async {
        guard sessionState == .dictating, let request = currentRequest else { return }

        levelsTask?.cancel(); levelsTask = nil
        await capture.stop()
        pumpTask?.cancel(); pumpTask = nil

        publish(.formatting)

        var raw = ""
        do {
            if let engine { raw = try await engine.finishSession() }
        } catch {
            lastError = error.localizedDescription
        }
        updatesTask?.cancel(); updatesTask = nil

        guard !raw.isEmpty else {
            sessionState = .ready
            currentRequest = nil
            publish(.finished, formatted: "")
            return
        }

        let formatter = FormatterFactory.make(settings: settings)
        let formatted: String
        do {
            formatted = try await formatter.format(transcript: raw, request: request, settings: settings)
        } catch {
            // Never lose the user's words to a formatting failure.
            NSLog("[Flow] formatting failed, inserting raw transcript: \(error)")
            formatted = raw
        }

        lastResult = formatted
        history.insert(formatted, at: 0)
        if history.count > 50 { history.removeLast(history.count - 50) }

        sessionState = .ready
        currentRequest = nil
        publish(.finished, formatted: formatted)
    }

    private func cancelDictation() async {
        levelsTask?.cancel(); levelsTask = nil
        pumpTask?.cancel(); pumpTask = nil
        updatesTask?.cancel(); updatesTask = nil
        await capture.stop()
        await engine?.cancelSession()
        currentRequest = nil
        transcript = ""
        volatileTranscript = ""
        if sessionState == .dictating { sessionState = .ready }
        publish(.idle)
    }

    // MARK: - Publishing

    private func publish(_ phase: DictationPhase, formatted: String? = nil, throttled: Bool = false) {
        // Partial results arrive faster than anyone can read them; writing every one
        // just burns I/O in both processes.
        if throttled, Date.now.timeIntervalSince(lastPublish) < 0.08 { return }
        lastPublish = .now
        self.phase = phase

        Task { [transcript, volatileTranscript, lastError, currentRequest] in
            let levels = await capture.currentLevels()
            let state = HostState(
                requestID: currentRequest?.id,
                phase: phase,
                transcript: transcript,
                volatileTranscript: volatileTranscript,
                formattedText: formatted,
                levels: levels,
                errorMessage: phase == .failed ? lastError : nil
            )
            FlowStore.writeState(state)
            FlowSignalBus.shared.post(.hostStateDidChange)
        }
    }
}

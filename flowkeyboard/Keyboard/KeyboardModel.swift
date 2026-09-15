import Foundation
import Observation

/// The keyboard's view of the world.
///
/// The extension does no audio and no inference — it renders whatever the host app
/// publishes and sends the user's intent back. Keeping it this thin is what keeps it
/// inside the extension memory budget.
@MainActor
@Observable
final class KeyboardModel {
    enum Availability: Equatable {
        case checking
        case ready
        case needsFullAccess
        case needsHostApp      // host isn't running; user must open Flow
    }

    private(set) var availability: Availability = .checking
    private(set) var phase: DictationPhase = .idle
    private(set) var transcript: String = ""
    private(set) var volatileTranscript: String = ""
    private(set) var levels: [Float] = []
    private(set) var errorMessage: String?

    var settings: FlowSettings = FlowSettingsStore.load()

    /// Called when a finished dictation is ready to be typed into the field.
    var onInsert: ((String) -> Void)?
    /// Supplies the surrounding text at the moment the user taps the mic.
    var contextProvider: (() -> DictationContext)?

    private var tokens: [UUID] = []
    private var activeRequest: DictationRequest?
    private var livenessProbe: Task<Void, Never>?
    private var hasFullAccess = false

    var isDictating: Bool {
        phase == .listening || phase == .preparing || phase == .formatting
    }

    var displayText: String {
        transcript + volatileTranscript
    }

    init() {
        let bus = FlowSignalBus.shared
        tokens.append(bus.observe(.hostStateDidChange) { [weak self] in
            Task { @MainActor in self?.readState() }
        })
        tokens.append(bus.observe(.hostDidBecomeReady) { [weak self] in
            Task { @MainActor in
                self?.livenessProbe?.cancel()
                self?.availability = .ready
                self?.readState()
            }
        })
    }

    deinit {
        let bus = FlowSignalBus.shared
        for token in tokens { bus.removeObserver(token) }
    }

    // MARK: - Lifecycle

    func keyboardDidAppear(hasFullAccess: Bool) {
        self.hasFullAccess = hasFullAccess
        settings = FlowSettingsStore.load()

        guard hasFullAccess else {
            availability = .needsFullAccess
            return
        }

        availability = .checking
        readState()
        FlowSignalBus.shared.post(.keyboardDidAppear)

        // A Darwin notification can't wake a suspended process, so silence here means
        // the host app isn't resident and the user has to open it.
        livenessProbe?.cancel()
        livenessProbe = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled, let self else { return }
            if self.availability == .checking { self.availability = .needsHostApp }
        }
    }

    func keyboardWillDisappear() {
        livenessProbe?.cancel()
        if isDictating { cancel() }
    }

    // MARK: - User intent

    func toggleDictation(mode: DictationMode = .insert) {
        if isDictating {
            stop()
        } else {
            start(mode: mode)
        }
    }

    func start(mode: DictationMode) {
        guard availability == .ready else { return }
        let context = contextProvider?() ?? DictationContext()
        let request = DictationRequest(mode: mode, context: context)
        activeRequest = request
        transcript = ""
        volatileTranscript = ""
        errorMessage = nil
        phase = .preparing
        FlowStore.writeRequest(request)
        FlowSignalBus.shared.post(.startDictation)
    }

    func stop() {
        guard isDictating else { return }
        phase = .formatting
        FlowSignalBus.shared.post(.stopDictation)
    }

    func cancel() {
        FlowSignalBus.shared.post(.cancelDictation)
        activeRequest = nil
        phase = .idle
        transcript = ""
        volatileTranscript = ""
    }

    // MARK: - Host state

    private func readState() {
        let state = FlowStore.readState()

        // Ignore updates belonging to a dictation we're no longer running.
        if let active = activeRequest, let incoming = state.requestID, incoming != active.id {
            return
        }

        if availability == .checking { availability = .ready }

        phase = state.phase
        transcript = state.transcript
        volatileTranscript = state.volatileTranscript
        levels = state.levels
        errorMessage = state.errorMessage

        if state.phase == .finished, let text = state.formattedText, !text.isEmpty {
            onInsert?(text)
            activeRequest = nil
            transcript = ""
            volatileTranscript = ""
            phase = .idle
        } else if state.phase == .finished || state.phase == .failed {
            activeRequest = nil
            if state.phase == .finished { phase = .idle }
        }
    }
}

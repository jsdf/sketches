import Foundation

/// Identifiers shared by the containing app and the keyboard extension.
///
/// Both targets must carry the App Group entitlement, and the keyboard must have
/// "Allow Full Access" enabled by the user — without it the extension is denied
/// access to the shared container and no dictation is possible.
public enum ScribeGroup {
    public static let identifier = "group.co.jsdf.scribe"
    public static let urlScheme = "scribe"

    /// Shared container used to pass payloads between the two processes.
    /// Darwin notifications carry no payload, so the file is the transport and the
    /// notification is only the doorbell.
    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    static func fileURL(_ name: String) -> URL? {
        containerURL?.appendingPathComponent(name, isDirectory: false)
    }
}

// MARK: - Control channel

/// Cross-process signals. Darwin notifications are the only mechanism that reaches
/// a *running* process in another sandbox without a shared XPC service, which
/// app extensions are not allowed to vend.
///
/// Caveat that drives the whole design: a Darwin notification cannot *launch* or
/// *resume* a suspended app. The host app has to already be alive (foreground, or
/// backgrounded with an active audio session) for these to be delivered.
public enum ScribeSignal: String, CaseIterable, Sendable {
    /// Keyboard became visible; host may warm up models.
    case keyboardDidAppear = "co.jsdf.scribe.signal.keyboardDidAppear"
    /// Keyboard is asking the host app to begin capturing audio.
    case startDictation = "co.jsdf.scribe.signal.startDictation"
    /// Keyboard is asking the host to stop capture and produce a final result.
    case stopDictation = "co.jsdf.scribe.signal.stopDictation"
    /// Keyboard is discarding this dictation.
    case cancelDictation = "co.jsdf.scribe.signal.cancelDictation"
    /// Host app published a new `HostState` for the keyboard to read.
    case hostStateDidChange = "co.jsdf.scribe.signal.hostStateDidChange"
    /// Host app is alive and listening (broadcast on launch and on foreground).
    case hostDidBecomeReady = "co.jsdf.scribe.signal.hostDidBecomeReady"
}

/// Thin wrapper over the Darwin notification centre.
///
/// The C callback is a bare function pointer and cannot capture context, so
/// observers live in a process-wide registry keyed by signal name.
public final class ScribeSignalBus: @unchecked Sendable {
    public static let shared = ScribeSignalBus()

    private let lock = NSLock()
    private var handlers: [String: [UUID: @Sendable () -> Void]] = [:]
    private var observedNames: Set<String> = []

    private init() {}

    public func post(_ signal: ScribeSignal) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(signal.rawValue as CFString),
            nil, nil, true
        )
    }

    /// Returns a token; call `removeObserver(_:)` to stop listening.
    @discardableResult
    public func observe(_ signal: ScribeSignal, _ handler: @escaping @Sendable () -> Void) -> UUID {
        let token = UUID()
        lock.lock()
        handlers[signal.rawValue, default: [:]][token] = handler
        let needsRegistration = !observedNames.contains(signal.rawValue)
        if needsRegistration { observedNames.insert(signal.rawValue) }
        lock.unlock()

        if needsRegistration {
            CFNotificationCenterAddObserver(
                CFNotificationCenterGetDarwinNotifyCenter(),
                Unmanaged.passUnretained(self).toOpaque(),
                { _, _, name, _, _ in
                    guard let name else { return }
                    ScribeSignalBus.shared.dispatch(name.rawValue as String)
                },
                signal.rawValue as CFString,
                nil,
                .deliverImmediately
            )
        }
        return token
    }

    public func removeObserver(_ token: UUID) {
        lock.lock()
        for key in handlers.keys { handlers[key]?.removeValue(forKey: token) }
        lock.unlock()
    }

    fileprivate func dispatch(_ name: String) {
        lock.lock()
        let fns = handlers[name]?.values.map { $0 } ?? []
        lock.unlock()
        for fn in fns { fn() }
    }
}

// MARK: - Payloads

/// What the keyboard knows about the field being typed into. This is the context the
/// formatting model uses to match tone and to decide whether it is writing a chat
/// message or a paragraph of prose.
public struct DictationContext: Codable, Sendable, Equatable {
    public var textBeforeCursor: String
    public var textAfterCursor: String
    public var selectedText: String
    /// Best-effort hint from `UIKeyboardType` / `UITextContentType` on the field.
    public var fieldHint: String
    public var isSingleLineField: Bool

    public init(
        textBeforeCursor: String = "",
        textAfterCursor: String = "",
        selectedText: String = "",
        fieldHint: String = "",
        isSingleLineField: Bool = false
    ) {
        self.textBeforeCursor = textBeforeCursor
        self.textAfterCursor = textAfterCursor
        self.selectedText = selectedText
        self.fieldHint = fieldHint
        self.isSingleLineField = isSingleLineField
    }
}

public enum DictationMode: String, Codable, Sendable {
    /// Transcribe speech and insert it as new text.
    case insert
    /// Treat the speech as an instruction to rewrite `selectedText` (or the whole field).
    case edit
}

/// Keyboard -> host app.
public struct DictationRequest: Codable, Sendable {
    public var id: UUID
    public var mode: DictationMode
    public var context: DictationContext
    public var startedAt: Date

    public init(id: UUID = UUID(), mode: DictationMode, context: DictationContext, startedAt: Date = .now) {
        self.id = id
        self.mode = mode
        self.context = context
        self.startedAt = startedAt
    }
}

public enum DictationPhase: String, Codable, Sendable {
    case idle
    case preparing      // model / asset warm-up
    case listening
    case formatting     // transcription done, LLM pass running
    case finished
    case failed
}

/// Host app -> keyboard.
public struct HostState: Codable, Sendable {
    public var requestID: UUID?
    public var phase: DictationPhase
    /// Stable transcript so far (finalised segments only).
    public var transcript: String
    /// Last unstable hypothesis, shown greyed out in the keyboard.
    public var volatileTranscript: String
    /// Cleaned-up text, ready for the keyboard to insert. Only set in `.finished`.
    public var formattedText: String?
    /// Recent input level, 0...1, for the waveform.
    public var levels: [Float]
    public var errorMessage: String?
    public var updatedAt: Date

    public init(
        requestID: UUID? = nil,
        phase: DictationPhase = .idle,
        transcript: String = "",
        volatileTranscript: String = "",
        formattedText: String? = nil,
        levels: [Float] = [],
        errorMessage: String? = nil,
        updatedAt: Date = .now
    ) {
        self.requestID = requestID
        self.phase = phase
        self.transcript = transcript
        self.volatileTranscript = volatileTranscript
        self.formattedText = formattedText
        self.levels = levels
        self.errorMessage = errorMessage
        self.updatedAt = updatedAt
    }

    public static let idle = HostState()
}

/// Atomic JSON read/write over the shared container.
///
/// `UserDefaults(suiteName:)` is the more common choice here but it caches across
/// processes and can hand the keyboard a stale value; writing a file and ringing the
/// Darwin doorbell is the version that actually stays in sync.
public enum ScribeStore {
    private static let requestFile = "request.json"
    private static let stateFile = "state.json"

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private static func write<T: Encodable>(_ value: T, to name: String) {
        guard let url = ScribeGroup.fileURL(name) else { return }
        do {
            let data = try encoder.encode(value)
            try data.write(to: url, options: .atomic)
        } catch {
            NSLog("[Scribe] failed to write \(name): \(error)")
        }
    }

    private static func read<T: Decodable>(_ type: T.Type, from name: String) -> T? {
        guard let url = ScribeGroup.fileURL(name),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(type, from: data)
    }

    public static func writeRequest(_ request: DictationRequest) { write(request, to: requestFile) }
    public static func readRequest() -> DictationRequest? { read(DictationRequest.self, from: requestFile) }

    public static func writeState(_ state: HostState) { write(state, to: stateFile) }
    public static func readState() -> HostState { read(HostState.self, from: stateFile) ?? .idle }
}

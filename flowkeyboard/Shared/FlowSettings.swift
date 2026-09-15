import Foundation

public enum FormattingStyle: String, Codable, CaseIterable, Sendable {
    case matchContext   // infer register from the surrounding text
    case neutral
    case casual
    case formal

    public var label: String {
        switch self {
        case .matchContext: "Match the app"
        case .neutral: "Neutral"
        case .casual: "Casual"
        case .formal: "Formal"
        }
    }
}

public enum TranscriptionBackend: String, Codable, CaseIterable, Sendable {
    /// `SpeechTranscriber` / `SpeechAnalyzer` — Apple's on-device model (iOS 26+).
    case appleSpeech
    /// WhisperKit, if the package is linked. Slower to start, but the weights are
    /// open and the same model runs on every device regardless of Apple Intelligence.
    case whisperKit

    public var label: String {
        switch self {
        case .appleSpeech: "Apple Speech (on device)"
        case .whisperKit: "Whisper (open model)"
        }
    }
}

/// Settings shared by both processes. Written by the app, read by both.
public struct FlowSettings: Codable, Sendable, Equatable {
    public var backend: TranscriptionBackend = .appleSpeech
    public var style: FormattingStyle = .matchContext
    /// Run the Foundation Models clean-up pass. Off = raw transcript, which is
    /// faster and works on devices without Apple Intelligence.
    public var useModelFormatting: Bool = true
    /// Strip "um", "uh", false starts, and repeated words.
    public var removeDisfluencies: Bool = true
    /// Words the transcriber reliably gets wrong — names, jargon, product names.
    /// Passed to the formatter so it can repair them.
    public var customDictionary: [String] = []
    /// Show the full QWERTY under the mic button rather than a mic-only keyboard.
    public var showLetterKeys: Bool = true
    public var localeIdentifier: String = "en-US"

    public init() {}

    public var locale: Locale { Locale(identifier: localeIdentifier) }
}

public enum FlowSettingsStore {
    private static let key = "flow.settings.v1"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: FlowGroup.identifier)
    }

    public static func load() -> FlowSettings {
        guard let data = defaults?.data(forKey: key),
              let decoded = try? JSONDecoder().decode(FlowSettings.self, from: data)
        else { return FlowSettings() }
        return decoded
    }

    public static func save(_ settings: FlowSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults?.set(data, forKey: key)
    }
}

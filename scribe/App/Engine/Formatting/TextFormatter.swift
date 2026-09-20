import Foundation

/// Turns a raw transcript into text a person would have typed.
///
/// This is the part that separates dictation from *good* dictation: the transcriber
/// gives you "um so i think we should uh ship it on friday period", and this gives you
/// "So I think we should ship it on Friday."
public protocol TextFormatter: Sendable {
    func format(
        transcript: String,
        request: DictationRequest,
        settings: ScribeSettings
    ) async throws -> String
}

public enum FormatterFactory {
    /// Prefers the on-device LLM, falls back to rules when Apple Intelligence is
    /// unavailable (older device, feature switched off, model still downloading) or
    /// when the user has turned model formatting off.
    public static func make(settings: ScribeSettings) -> any TextFormatter {
        guard settings.useModelFormatting, FoundationModelsFormatter.isAvailable else {
            return RuleBasedFormatter()
        }
        return FoundationModelsFormatter()
    }
}

import Foundation
import FoundationModels

/// Clean-up pass driven by Apple's on-device foundation model.
///
/// Runs in the system's model process, so the memory cost to us is small, and nothing
/// leaves the device. Requires an Apple Intelligence capable device with the feature
/// enabled — always check `isAvailable` before constructing.
public struct FoundationModelsFormatter: TextFormatter {
    public init() {}

    public static var isAvailable: Bool {
        if case .available = SystemLanguageModel.default.availability { return true }
        return false
    }

    /// A human-readable reason when the model can't be used, for the app's settings screen.
    public static var unavailabilityReason: String? {
        switch SystemLanguageModel.default.availability {
        case .available:
            return nil
        case .unavailable(.deviceNotEligible):
            return "This device doesn't support Apple Intelligence. Flow will use rule-based clean-up instead."
        case .unavailable(.appleIntelligenceNotEnabled):
            return "Turn on Apple Intelligence in Settings to get model-based clean-up."
        case .unavailable(.modelNotReady):
            return "The system model is still downloading. Flow will use rule-based clean-up until it's ready."
        case .unavailable(let other):
            return "The system model is unavailable (\(other))."
        @unknown default:
            return "The system model is unavailable."
        }
    }

    /// Structured output keeps the model from prefixing the result with things like
    /// "Here's the cleaned up version:".
    @Generable
    struct Cleaned {
        @Guide(description: "The dictated text, cleaned up. Nothing else — no preamble, no quotes, no explanation.")
        var text: String
    }

    /// Warms the model so the first dictation of a session isn't the slow one.
    public static func prewarm() {
        guard isAvailable else { return }
        let session = LanguageModelSession(instructions: FormattingPrompt.insertInstructions(
            settings: FlowSettings(), context: DictationContext()
        ))
        session.prewarm()
    }

    public func format(
        transcript: String,
        request: DictationRequest,
        settings: FlowSettings
    ) async throws -> String {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        let instructions: String
        let prompt: String
        switch request.mode {
        case .insert:
            instructions = FormattingPrompt.insertInstructions(settings: settings, context: request.context)
            prompt = FormattingPrompt.insertPrompt(transcript: trimmed, context: request.context)
        case .edit:
            instructions = FormattingPrompt.editInstructions(settings: settings)
            prompt = FormattingPrompt.editPrompt(instruction: trimmed, context: request.context)
        }

        let session = LanguageModelSession(instructions: instructions)
        // Greedy sampling: dictation clean-up should be reproducible, not creative.
        let options = GenerationOptions(sampling: .greedy)

        do {
            let response = try await session.respond(to: prompt, generating: Cleaned.self, options: options)
            let text = response.content.text.trimmingCharacters(in: .whitespacesAndNewlines)
            // A model that returned nothing is worse than the raw transcript.
            return text.isEmpty ? trimmed : text
        } catch {
            // Deliberately not switching on specific error cases: the concrete error
            // enum was reshaped in iOS 27 and this needs to keep compiling against both
            // SDKs. Every failure mode here has the same two useful responses — retry
            // without the surrounding-text context (fixes context-window overflow, and
            // most guardrail trips, which are usually provoked by the quoted context
            // rather than by what the user said), then give up and insert what they
            // actually dictated. Losing the user's words to a formatting failure is the
            // one outcome that is never acceptable.
            NSLog("[Flow] formatting pass failed (\(error)); retrying without context")
            let bare = LanguageModelSession(
                instructions: FormattingPrompt.insertInstructions(settings: settings, context: DictationContext())
            )
            let retry = try? await bare.respond(
                to: FormattingPrompt.insertPrompt(transcript: trimmed, context: DictationContext()),
                generating: Cleaned.self,
                options: options
            )
            let text = retry?.content.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return text.isEmpty ? trimmed : text
        }
    }
}

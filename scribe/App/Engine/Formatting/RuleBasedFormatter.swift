import Foundation

/// Deterministic clean-up for when the on-device LLM isn't available.
///
/// Handles the cases that matter most in practice — spoken punctuation, filler words,
/// sentence capitalisation, custom spellings — without any model. Noticeably dumber
/// than the Foundation Models path, but it never fails and it costs nothing.
public struct RuleBasedFormatter: TextFormatter {
    public init() {}

    private static let spokenPunctuation: [(pattern: String, replacement: String)] = [
        (#"\bnew paragraph\b"#, "\n\n"),
        (#"\bnew line\b"#, "\n"),
        (#"\bquestion mark\b"#, "?"),
        (#"\bexclamation (mark|point)\b"#, "!"),
        (#"\bfull stop\b"#, "."),
        (#"\bperiod\b"#, "."),
        (#"\bcomma\b"#, ","),
        (#"\bsemicolon\b"#, ";"),
        (#"\bcolon\b"#, ":"),
        (#"\bopen paren(thesis)?\b"#, "("),
        (#"\bclose paren(thesis)?\b"#, ")"),
    ]

    private static let disfluencies = [
        #"\b(um+|uh+|erm+|ah+|hmm+)\b"#,
        #"\byou know\b"#,
        #"\bi mean\b"#,
        #"\bsort of\b"#,
        #"\bkind of\b"#,
    ]

    public func format(
        transcript: String,
        request: DictationRequest,
        settings: ScribeSettings
    ) async throws -> String {
        var text = transcript

        if settings.removeDisfluencies {
            for pattern in Self.disfluencies {
                text = text.replacingMatches(of: pattern, with: " ")
            }
        }

        for rule in Self.spokenPunctuation {
            text = text.replacingMatches(of: rule.pattern, with: rule.replacement)
        }

        text = applyDictionary(to: text, words: settings.customDictionary)

        // Tidy spacing: no space before punctuation, exactly one after.
        text = text.replacingMatches(of: #"[ \t]+"#, with: " ")
        text = text.replacingMatches(of: #" +([,.;:!?)])"#, with: "$1")
        text = text.replacingMatches(of: #"([,;:])(?=\S)"#, with: "$1 ")
        text = text.replacingMatches(of: #"([.!?])(?=[A-Za-z])"#, with: "$1 ")
        text = text.replacingMatches(of: #"\n +"#, with: "\n")
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)

        if request.context.isSingleLineField {
            text = text.replacingMatches(of: #"\s*\n+\s*"#, with: " ")
        }

        text = capitalizeSentences(text, joiningAfter: request.context.textBeforeCursor)
        return text
    }

    private func applyDictionary(to text: String, words: [String]) -> String {
        var result = text
        for word in words where !word.isEmpty {
            let escaped = NSRegularExpression.escapedPattern(for: word)
            result = result.replacingMatches(of: #"\b"# + escaped + #"\b"#,
                                             with: NSRegularExpression.escapedTemplate(for: word),
                                             caseInsensitive: true)
        }
        return result
    }

    /// Capitalises the first letter of each sentence. If we're continuing an existing
    /// sentence (the text before the cursor doesn't end in terminal punctuation), the
    /// very first letter is left alone.
    private func capitalizeSentences(_ text: String, joiningAfter previous: String) -> String {
        let previousTrimmed = previous.trimmingCharacters(in: .whitespacesAndNewlines)
        let continuesSentence = !previousTrimmed.isEmpty
            && !".!?\n".contains(previousTrimmed.last ?? " ")

        var result = ""
        var capitalizeNext = !continuesSentence
        for character in text {
            if capitalizeNext, character.isLetter {
                result.append(Character(character.uppercased()))
                capitalizeNext = false
            } else {
                result.append(character)
                if ".!?".contains(character) || character == "\n" {
                    capitalizeNext = true
                }
            }
        }
        return result
    }
}

private extension String {
    func replacingMatches(of pattern: String, with template: String, caseInsensitive: Bool = true) -> String {
        var options: NSRegularExpression.Options = []
        if caseInsensitive { options.insert(.caseInsensitive) }
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return self }
        let range = NSRange(startIndex..<endIndex, in: self)
        return regex.stringByReplacingMatches(in: self, options: [], range: range, withTemplate: template)
    }
}

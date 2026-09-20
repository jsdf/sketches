import SwiftUI

struct SettingsView: View {
    @Environment(ScribeHost.self) private var host
    @Environment(\.dismiss) private var dismiss
    @State private var newWord = ""

    var body: some View {
        @Bindable var host = host

        Form {
            Section("Transcription") {
                Picker("Model", selection: $host.settings.backend) {
                    ForEach(TranscriptionBackend.allCases, id: \.self) { backend in
                        Text(backend.label).tag(backend)
                    }
                }
                #if !canImport(WhisperKit)
                if host.settings.backend == .whisperKit {
                    Text("WhisperKit isn't linked in this build; Apple Speech will be used. See README to add the package.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                #endif
            }

            Section("Clean-up") {
                Toggle("Use on-device model", isOn: $host.settings.useModelFormatting)
                    .disabled(!FoundationModelsFormatter.isAvailable)
                Toggle("Remove filler words", isOn: $host.settings.removeDisfluencies)
                Picker("Tone", selection: $host.settings.style) {
                    ForEach(FormattingStyle.allCases, id: \.self) { style in
                        Text(style.label).tag(style)
                    }
                }
            }

            Section {
                ForEach(host.settings.customDictionary, id: \.self) { word in
                    Text(word)
                }
                .onDelete { offsets in
                    host.settings.customDictionary.remove(atOffsets: offsets)
                }
                HStack {
                    TextField("Add a word or name", text: $newWord)
                        .autocorrectionDisabled()
                        .onSubmit(addWord)
                    Button("Add", action: addWord).disabled(trimmedWord.isEmpty)
                }
            } header: {
                Text("Dictionary")
            } footer: {
                Text("Names, jargon, and product names that get transcribed wrong. Scribe uses these to repair the transcript before inserting it.")
            }

            Section("Keyboard") {
                Toggle("Show letter keys", isOn: $host.settings.showLetterKeys)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private var trimmedWord: String {
        newWord.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func addWord() {
        let word = trimmedWord
        guard !word.isEmpty, !host.settings.customDictionary.contains(word) else { return }
        host.settings.customDictionary.append(word)
        newWord = ""
    }
}

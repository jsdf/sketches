import SwiftUI
import UIKit

struct OnboardingView: View {
    private let steps: [(String, String, String)] = [
        ("keyboard.badge.ellipsis", "Add the keyboard",
         "Settings > General > Keyboard > Keyboards > Add New Keyboard, then choose Flow."),
        ("lock.open", "Allow Full Access",
         "Tap Flow in that same list and turn on Allow Full Access. The keyboard needs it to reach the shared container it uses to talk to this app. Flow sends nothing off the device."),
        ("mic", "Grant the microphone",
         "Start a Flow session on the previous screen and allow microphone access when asked."),
        ("arrow.right.circle", "Dictate anywhere",
         "In any app, hold the globe key and pick Flow, then tap the microphone. Tap again to stop and the cleaned-up text is inserted."),
    ]

    var body: some View {
        List {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(step.1).font(.headline)
                        Text(step.2).font(.subheadline).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: step.0)
                        .foregroundStyle(.tint)
                        .font(.title3)
                }
                .padding(.vertical, 4)
            }

            Section {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }
        }
        .navigationTitle("Set up Flow")
        .navigationBarTitleDisplayMode(.inline)
    }
}

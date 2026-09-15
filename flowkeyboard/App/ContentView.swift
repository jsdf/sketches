import SwiftUI

struct ContentView: View {
    @Environment(FlowHost.self) private var host
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            List {
                sessionSection
                setupSection
                if !host.history.isEmpty { historySection }
            }
            .navigationTitle("Flow")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .sheet(isPresented: $showingSettings) {
                NavigationStack { SettingsView() }
            }
        }
    }

    private var sessionSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 10, height: 10)
                    Text(statusTitle).font(.headline)
                }
                Text(statusDetail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button(host.sessionState == .stopped ? "Start Flow session" : "End Flow session") {
                    Task {
                        if host.sessionState == .stopped {
                            await host.startFlowSession()
                        } else {
                            await host.endFlowSession()
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
            }
            .padding(.vertical, 4)

            if let error = host.lastError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        } footer: {
            Text("A Flow session keeps Flow listening in the background so the keyboard can start dictation in other apps. iOS shows the orange microphone indicator the whole time. End the session when you're done.")
        }
    }

    private var setupSection: some View {
        Section("Setup") {
            NavigationLink {
                OnboardingView()
            } label: {
                Label("How to enable the keyboard", systemImage: "keyboard")
            }
            LabeledContent("On-device clean-up") {
                Text(FoundationModelsFormatter.isAvailable ? "Available" : "Unavailable")
                    .foregroundStyle(FoundationModelsFormatter.isAvailable ? .green : .secondary)
            }
            if let reason = FoundationModelsFormatter.unavailabilityReason {
                Text(reason).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var historySection: some View {
        Section("Recent dictations") {
            ForEach(Array(host.history.enumerated()), id: \.offset) { _, entry in
                Text(entry)
                    .font(.callout)
                    .lineLimit(4)
                    .textSelection(.enabled)
            }
        }
    }

    private var statusColor: Color {
        switch host.sessionState {
        case .stopped: .secondary
        case .ready: .green
        case .dictating: .red
        }
    }

    private var statusTitle: String {
        switch host.sessionState {
        case .stopped: "Not listening"
        case .ready: "Ready"
        case .dictating: "Dictating"
        }
    }

    private var statusDetail: String {
        switch host.sessionState {
        case .stopped:
            "Start a session before using the mic on the Flow keyboard."
        case .ready:
            "Switch to any app, bring up the Flow keyboard, and tap the microphone."
        case .dictating:
            host.volatileTranscript.isEmpty ? host.transcript : host.transcript + host.volatileTranscript
        }
    }
}

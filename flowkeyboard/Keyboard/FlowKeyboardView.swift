import SwiftUI

struct FlowKeyboardView: View {
    let model: KeyboardModel
    let needsInputModeSwitchKey: Bool
    let onKey: (KeyboardKey) -> Void
    let onAdvanceInputMode: () -> Void
    let onOpenHostApp: () -> Bool

    @State private var openAppFailed = false

    var body: some View {
        VStack(spacing: 0) {
            statusStrip
                .frame(height: 34)

            micBar
                .frame(height: 56)

            if model.settings.showLetterKeys {
                QwertyView(
                    needsInputModeSwitchKey: needsInputModeSwitchKey,
                    onKey: onKey,
                    onAdvanceInputMode: onAdvanceInputMode
                )
            } else if needsInputModeSwitchKey {
                HStack {
                    Button(action: onAdvanceInputMode) {
                        Image(systemName: "globe").padding(10)
                    }
                    Spacer()
                    Button { onKey(.backspace) } label: {
                        Image(systemName: "delete.left").padding(10)
                    }
                }
                .padding(.horizontal, 12)
            }
        }
        .foregroundStyle(.primary)
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Status

    private var statusStrip: some View {
        Group {
            switch model.availability {
            case .needsFullAccess:
                strip("Turn on Allow Full Access for Flow in Settings", systemImage: "lock")
            case .needsHostApp:
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle")
                    Text(openAppFailed ? "Open Flow and start a session" : "Flow isn't running")
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Button("Open Flow") {
                        if !onOpenHostApp() { openAppFailed = true }
                    }
                    .font(.caption.weight(.semibold))
                }
                .font(.caption)
                .padding(.horizontal, 12)
            case .checking:
                strip("Connecting to Flow…", systemImage: "ellipsis")
            case .ready:
                readyStrip
            }
        }
    }

    @ViewBuilder
    private var readyStrip: some View {
        if let error = model.errorMessage {
            strip(error, systemImage: "exclamationmark.triangle")
        } else if model.phase == .formatting {
            strip("Cleaning up…", systemImage: "wand.and.sparkles")
        } else if !model.displayText.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    Text(model.transcript)
                    Text(model.volatileTranscript).foregroundStyle(.secondary)
                }
                .font(.callout)
                .padding(.horizontal, 12)
            }
            .defaultScrollAnchor(.trailing)
        } else if model.phase == .listening {
            strip("Listening…", systemImage: "waveform")
        } else {
            strip("Tap to dictate", systemImage: "mic")
        }
    }

    private func strip(_ text: String, systemImage: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
            Text(text).lineLimit(1)
            Spacer(minLength: 0)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
    }

    // MARK: - Mic

    private var micBar: some View {
        HStack(spacing: 12) {
            Waveform(levels: model.levels, active: model.phase == .listening)
                .frame(maxWidth: .infinity)

            if model.isDictating {
                Button { model.cancel() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 36, height: 36)
                        .background(Color.secondary.opacity(0.2), in: Circle())
                }
                .buttonStyle(.plain)
                .transition(.scale.combined(with: .opacity))
            }

            Button {
                model.toggleDictation()
            } label: {
                Image(systemName: model.isDictating ? "stop.fill" : "mic.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(model.isDictating ? Color.red : Color.accentColor, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(model.availability != .ready)
            .opacity(model.availability == .ready ? 1 : 0.4)
        }
        .padding(.horizontal, 12)
        .animation(.snappy(duration: 0.2), value: model.isDictating)
    }
}

/// Live input level, oldest on the left.
private struct Waveform: View {
    let levels: [Float]
    let active: Bool

    private let barCount = 32

    var body: some View {
        GeometryReader { geo in
            let padded = Array(repeating: Float(0), count: max(0, barCount - levels.count)) + levels.suffix(barCount)
            let width = max((geo.size.width - CGFloat(barCount - 1) * 2) / CGFloat(barCount), 1)

            HStack(alignment: .center, spacing: 2) {
                ForEach(Array(padded.enumerated()), id: \.offset) { _, level in
                    let height = max(CGFloat(level) * geo.size.height, 3)
                    Capsule()
                        .fill(active ? Color.accentColor : Color.secondary.opacity(0.35))
                        .frame(width: width, height: height)
                }
            }
            .frame(maxHeight: .infinity, alignment: .center)
            .animation(.linear(duration: 0.1), value: levels)
        }
    }
}

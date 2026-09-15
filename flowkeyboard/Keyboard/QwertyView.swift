import SwiftUI

enum KeyboardKey: Equatable {
    case character(String)
    case space
    case backspace
    case newline
}

/// A plain letter keyboard, so Flow is still usable as a keyboard when you don't feel
/// like talking. Nothing clever — it exists so the mic isn't the only way to type.
struct QwertyView: View {
    let needsInputModeSwitchKey: Bool
    let onKey: (KeyboardKey) -> Void
    let onAdvanceInputMode: () -> Void

    @State private var isShifted = true
    @State private var isCapsLocked = false
    @State private var layer: Layer = .letters

    private enum Layer { case letters, numbers, symbols }

    private var rows: [[String]] {
        switch layer {
        case .letters:
            [["q","w","e","r","t","y","u","i","o","p"],
             ["a","s","d","f","g","h","j","k","l"],
             ["z","x","c","v","b","n","m"]]
        case .numbers:
            [["1","2","3","4","5","6","7","8","9","0"],
             ["-","/",":",";","(",")","$","&","@","\""],
             [".",",","?","!","'"]]
        case .symbols:
            [["[","]","{","}","#","%","^","*","+","="],
             ["_","\\","|","~","<",">","€","£","¥","•"],
             [".",",","?","!","'"]]
        }
    }

    var body: some View {
        VStack(spacing: 6) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: 5) {
                    if index == 2 { modifierKey }
                    ForEach(row, id: \.self) { key in
                        KeyCap(label: display(key)) { tap(key) }
                    }
                    if index == 2 {
                        KeyCap(label: nil, systemImage: "delete.left", width: 44, tinted: true) {
                            onKey(.backspace)
                        }
                    }
                }
                .padding(.horizontal, index == 1 && layer == .letters ? 18 : 0)
            }
            bottomRow
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var modifierKey: some View {
        switch layer {
        case .letters:
            KeyCap(
                label: nil,
                systemImage: isCapsLocked ? "capslock.fill" : (isShifted ? "shift.fill" : "shift"),
                width: 44,
                tinted: true
            ) {
                if isCapsLocked {
                    isCapsLocked = false
                    isShifted = false
                } else if isShifted {
                    isCapsLocked = true
                } else {
                    isShifted = true
                }
            }
        case .numbers:
            KeyCap(label: "#+=", width: 44, tinted: true) { layer = .symbols }
        case .symbols:
            KeyCap(label: "123", width: 44, tinted: true) { layer = .numbers }
        }
    }

    private var bottomRow: some View {
        HStack(spacing: 5) {
            KeyCap(label: layer == .letters ? "123" : "ABC", width: 44, tinted: true) {
                layer = layer == .letters ? .numbers : .letters
            }
            if needsInputModeSwitchKey {
                KeyCap(label: nil, systemImage: "globe", width: 44, tinted: true, action: onAdvanceInputMode)
            }
            KeyCap(label: "space", width: nil, tinted: false) { onKey(.space) }
            KeyCap(label: "return", width: 78, tinted: true) { onKey(.newline) }
        }
    }

    private func display(_ key: String) -> String {
        guard layer == .letters else { return key }
        return (isShifted || isCapsLocked) ? key.uppercased() : key
    }

    private func tap(_ key: String) {
        onKey(.character(display(key)))
        if isShifted, !isCapsLocked { isShifted = false }
    }
}

private struct KeyCap: View {
    var label: String?
    var systemImage: String?
    var width: CGFloat?
    var tinted: Bool = false
    let action: () -> Void

    private var fontSize: CGFloat {
        guard let label, label.count > 1 else { return 22 }
        return 15
    }

    var body: some View {
        Button(action: action) {
            Group {
                if let systemImage {
                    Image(systemName: systemImage)
                } else if let label {
                    Text(label)
                }
            }
            .font(.system(size: fontSize))
            .frame(maxWidth: width ?? .infinity)
            .frame(height: 40)
            .background(tinted ? Color.secondary.opacity(0.28) : Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
    }
}

import SwiftUI
import UIKit

/// The keyboard extension's entry point.
///
/// Everything here is deliberately cheap. Keyboard extensions get a small memory
/// budget (tens of MB — far below what any speech or language model needs) and are
/// jetsammed without ceremony when they exceed it, so no model is ever loaded in this
/// process. Audio and inference live in the containing app.
final class KeyboardViewController: UIInputViewController {

    private let model = KeyboardModel()
    private var hostingController: UIHostingController<FlowKeyboardView>?
    private var heightConstraint: NSLayoutConstraint?

    private var keyboardHeight: CGFloat {
        model.settings.showLetterKeys ? 300 : 190
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        model.onInsert = { [weak self] text in
            self?.insert(text)
        }
        model.contextProvider = { [weak self] in
            self?.captureContext() ?? DictationContext()
        }

        let root = FlowKeyboardView(
            model: model,
            needsInputModeSwitchKey: needsInputModeSwitchKey,
            onKey: { [weak self] key in self?.handle(key) },
            onAdvanceInputMode: { [weak self] in self?.advanceToNextInputMode() },
            onOpenHostApp: { [weak self] in self?.openHostApp() ?? false }
        )

        let hosting = UIHostingController(rootView: root)
        hosting.view.backgroundColor = .clear
        addChild(hosting)
        view.addSubview(hosting.view)
        hosting.didMove(toParent: self)
        hostingController = hosting

        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        applyHeight()
        model.keyboardDidAppear(hasFullAccess: hasFullAccess)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        model.keyboardWillDisappear()
    }

    private func applyHeight() {
        // A custom keyboard has no intrinsic height; without this it collapses.
        if let heightConstraint {
            heightConstraint.constant = keyboardHeight
        } else {
            let constraint = view.heightAnchor.constraint(equalToConstant: keyboardHeight)
            constraint.priority = .required - 1
            constraint.isActive = true
            heightConstraint = constraint
        }
    }

    // MARK: - Text

    /// Snapshot of the field, used by the formatting pass to match tone and to know
    /// whether it is joining onto an unfinished sentence.
    ///
    /// `documentContextBeforeInput` is not the whole field — iOS hands back roughly the
    /// current paragraph — but it is enough context for the model.
    private func captureContext() -> DictationContext {
        let proxy = textDocumentProxy
        let traits = proxy.keyboardType
        let singleLine = proxy.returnKeyType != .default || traits == .emailAddress || traits == .URL

        return DictationContext(
            textBeforeCursor: proxy.documentContextBeforeInput ?? "",
            textAfterCursor: proxy.documentContextAfterInput ?? "",
            selectedText: proxy.selectedText ?? "",
            fieldHint: Self.hint(for: traits),
            isSingleLineField: singleLine
        )
    }

    private static func hint(for type: UIKeyboardType) -> String {
        switch type {
        case .emailAddress: "an email address"
        case .URL: "a URL"
        case .numberPad, .decimalPad, .phonePad: "a number"
        case .twitter: "a social media post"
        case .webSearch: "a search box"
        default: ""
        }
    }

    private func insert(_ text: String) {
        let proxy = textDocumentProxy

        // Join sensibly onto whatever is already there.
        var toInsert = text
        if let before = proxy.documentContextBeforeInput,
           let last = before.last,
           !last.isWhitespace,
           let first = toInsert.first,
           !first.isWhitespace,
           !",.;:!?".contains(first) {
            toInsert = " " + toInsert
        }

        if proxy.selectedText?.isEmpty == false {
            proxy.deleteBackward()
        }
        proxy.insertText(toInsert)
        UIDevice.current.playInputClick()
    }

    private func handle(_ key: KeyboardKey) {
        switch key {
        case .character(let string):
            textDocumentProxy.insertText(string)
        case .space:
            textDocumentProxy.insertText(" ")
        case .backspace:
            textDocumentProxy.deleteBackward()
        case .newline:
            textDocumentProxy.insertText("\n")
        }
        UIDevice.current.playInputClick()
    }

    // MARK: - Opening the containing app

    /// Keyboards have no `UIApplication` and `NSExtensionContext.open(_:)` is not
    /// honoured for this extension point, so the only route is to walk the responder
    /// chain looking for something that implements `openURL:`.
    ///
    /// This is undocumented and Apple has narrowed it before; treat a `false` return as
    /// normal and tell the user to open Flow themselves.
    @discardableResult
    private func openHostApp() -> Bool {
        guard let url = URL(string: "\(FlowGroup.urlScheme)://start") else { return false }
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let current = responder {
            if current.responds(to: selector), current !== self {
                _ = current.perform(selector, with: url)
                return true
            }
            responder = current.next
        }
        return false
    }
}

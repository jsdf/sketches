@preconcurrency import AVFoundation
import Foundation
import Speech

/// Transcription backed by `SpeechAnalyzer` + `SpeechTranscriber` (iOS 26+).
///
/// This is the same on-device model that powers system dictation. Unlike the old
/// `SFSpeechRecognizer` path it has no one-minute session cap, which matters for
/// dictation that runs as long as the user holds the mic.
///
/// The heavy lifting happens in a system daemon rather than in our address space,
/// which is what makes this viable at all — see README on extension memory limits.
actor AppleSpeechEngine: TranscriptionEngine {
    enum EngineError: Error, LocalizedError {
        case localeNotSupported(String)
        case noCompatibleAudioFormat
        case notPrepared

        var errorDescription: String? {
            switch self {
            case .localeNotSupported(let id):
                "Speech model for \(id) isn't available on this device."
            case .noCompatibleAudioFormat:
                "No compatible audio format for the speech analyzer."
            case .notPrepared:
                "Speech engine was used before it was prepared."
            }
        }
    }

    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var resultsTask: Task<Void, Never>?
    private var updateContinuation: AsyncStream<TranscriptionUpdate>.Continuation?
    private let converter = BufferConverter()

    private var analyzerFormat: AVAudioFormat?
    private var finalizedText = ""
    private var volatileText = ""
    private var preparedLocale: Locale?

    /// Progress of an in-flight asset download, for the app's UI.
    private(set) var downloadProgress: Progress?

    var requiredFormat: AVAudioFormat? { analyzerFormat }

    // MARK: - Preparation

    func prepare(locale: Locale) async throws {
        if preparedLocale == locale, transcriber != nil { return }

        let transcriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: []
        )

        try await ensureAssets(for: transcriber, locale: locale)

        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw EngineError.noCompatibleAudioFormat
        }

        self.transcriber = transcriber
        self.analyzerFormat = format
        self.preparedLocale = locale
    }

    private func ensureAssets(for transcriber: SpeechTranscriber, locale: Locale) async throws {
        let supported = await SpeechTranscriber.supportedLocales
        let isSupported = supported.contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) }
        guard isSupported else { throw EngineError.localeNotSupported(locale.identifier) }

        // First run on a device downloads the model for this locale.
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            downloadProgress = request.progress
            try await request.downloadAndInstall()
            downloadProgress = nil
        }

        // A locale has to be reserved before the analyzer will use it, and the number
        // of concurrent reservations is capped, so release anything we no longer need.
        let reserved = await AssetInventory.reservedLocales
        if !reserved.contains(where: { $0.identifier(.bcp47) == locale.identifier(.bcp47) }) {
            try await AssetInventory.reserve(locale: locale)
        }
    }

    func releaseReservations() async {
        for locale in await AssetInventory.reservedLocales {
            await AssetInventory.release(reservedLocale: locale)
        }
    }

    // MARK: - Session

    func beginSession() async throws -> AsyncStream<TranscriptionUpdate> {
        guard let transcriber else { throw EngineError.notPrepared }

        finalizedText = ""
        volatileText = ""

        let (inputStream, inputContinuation) = AsyncStream<AnalyzerInput>.makeStream()
        self.inputContinuation = inputContinuation

        let (updates, updateContinuation) = AsyncStream<TranscriptionUpdate>.makeStream(
            bufferingPolicy: .bufferingNewest(8)
        )
        self.updateContinuation = updateContinuation

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer

        resultsTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters)
                    await self?.apply(text: text, isFinal: result.isFinal)
                }
            } catch {
                NSLog("[Flow] transcriber results ended: \(error)")
            }
            await self?.closeUpdates()
        }

        try await analyzer.start(inputSequence: inputStream)
        return updates
    }

    private func apply(text: String, isFinal: Bool) {
        if isFinal {
            finalizedText += text
            volatileText = ""
        } else {
            volatileText = text
        }
        updateContinuation?.yield(TranscriptionUpdate(finalized: finalizedText, volatile: volatileText))
    }

    private func closeUpdates() {
        updateContinuation?.finish()
        updateContinuation = nil
    }

    func feed(_ buffer: AVAudioPCMBuffer) async throws {
        guard let analyzerFormat, let inputContinuation else { return }
        let converted = try converter.convert(buffer, to: analyzerFormat)
        inputContinuation.yield(AnalyzerInput(buffer: converted))
    }

    @discardableResult
    func finishSession() async throws -> String {
        inputContinuation?.finish()
        inputContinuation = nil
        // Drains the remaining audio and emits final results before returning.
        try await analyzer?.finalizeAndFinishThroughEndOfInput()
        resultsTask = nil
        analyzer = nil
        let transcript = finalizedText + volatileText
        return transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func cancelSession() async {
        inputContinuation?.finish()
        inputContinuation = nil
        resultsTask?.cancel()
        resultsTask = nil
        if let analyzer { await analyzer.cancelAndFinishNow() }
        analyzer = nil
        closeUpdates()
        finalizedText = ""
        volatileText = ""
    }
}

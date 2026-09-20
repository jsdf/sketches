@preconcurrency import AVFoundation
import Foundation

public struct TranscriptionUpdate: Sendable, Equatable {
    /// Segments the recogniser has committed to.
    public var finalized: String
    /// Current hypothesis for the tail, which may still change.
    public var volatile: String

    public init(finalized: String, volatile: String) {
        self.finalized = finalized
        self.volatile = volatile
    }

    public var combined: String {
        volatile.isEmpty ? finalized : finalized + volatile
    }
}

/// A streaming speech-to-text backend.
///
/// Both implementations run entirely on device. The protocol exists so the choice of
/// model — Apple's, or open weights via WhisperKit — is a setting rather than a rewrite.
public protocol TranscriptionEngine: Actor {
    /// Downloads/reserves any assets. Safe to call repeatedly.
    func prepare(locale: Locale) async throws

    /// The format buffers must be in before `feed`. Nil means "any".
    var requiredFormat: AVAudioFormat? { get async }

    /// Begins a recognition session and returns incremental updates.
    func beginSession() async throws -> AsyncStream<TranscriptionUpdate>

    func feed(_ buffer: AVAudioPCMBuffer) async throws

    /// Flushes and returns the complete transcript.
    @discardableResult
    func finishSession() async throws -> String

    func cancelSession() async
}

@preconcurrency import AVFoundation
import Foundation
import os

/// Converts microphone buffers into the format the analyzer asked for.
///
/// The hardware hands us whatever the current route provides (often 48 kHz stereo);
/// `SpeechAnalyzer.bestAvailableAudioFormat` usually wants something else. Converting
/// per buffer keeps latency flat instead of resampling a whole recording at the end.
final class BufferConverter {
    enum ConversionError: Error {
        case couldNotCreateConverter
        case couldNotAllocateBuffer
        case failed(NSError?)
    }

    private var converter: AVAudioConverter?

    func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
        let inputFormat = buffer.format
        guard inputFormat != format else { return buffer }

        if converter == nil || converter?.inputFormat != inputFormat || converter?.outputFormat != format {
            converter = AVAudioConverter(from: inputFormat, to: format)
            // Priming adds latency and shifts timestamps; the first few samples are
            // not worth the drift for streaming speech.
            converter?.primeMethod = .none
        }
        guard let converter else { throw ConversionError.couldNotCreateConverter }

        let ratio = format.sampleRate / inputFormat.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            throw ConversionError.couldNotAllocateBuffer
        }

        var nsError: NSError?
        let consumed = OSAllocatedUnfairLock(initialState: false)

        let status = converter.convert(to: output, error: &nsError) { _, statusPointer in
            let alreadyConsumed = consumed.withLock { flag -> Bool in
                defer { flag = true }
                return flag
            }
            statusPointer.pointee = alreadyConsumed ? .noDataNow : .haveData
            return alreadyConsumed ? nil : buffer
        }

        guard status != .error else { throw ConversionError.failed(nsError) }
        return output
    }
}

# Scribe — a Wispr Flow-style dictation keyboard, fully on device

A custom iOS keyboard that turns speech into text that reads like you typed it:
transcription with Apple's on-device speech model, then a clean-up pass through the
on-device foundation model that removes filler words, fixes punctuation, repairs names,
and matches the tone of whatever you're typing into.

Nothing leaves the device. No API keys, no network calls.

## The constraint that shapes everything

**iOS does not let a keyboard extension touch the microphone.** This is not a
permissions problem you can configure your way out of — app extensions are blocked
from audio input at the system level, and attempts to start `AVAudioEngine` in a
keyboard fail with errors like `561145187` even with Full Access and microphone
permission granted. Apple's own extension guide has said so since iOS 8, and it is
still true.

So the keyboard cannot be the whole app. The working shape — the same one Wispr Flow
uses — splits the job across two processes:

```
┌─────────────────────────┐                      ┌──────────────────────────────┐
│  ScribeKeyboard         │   Darwin notifs      │  Scribe (containing app)     │
│  (keyboard extension)   │ ───────────────────► │                              │
│                         │                      │   AudioCapture               │
│  • mic button, waveform │   App Group          │   AppleSpeechEngine          │
│  • live partial text    │ ◄─────────────────── │   FoundationModelsFormatter  │
│  • QWERTY               │   shared container   │                              │
│  • inserts final text   │                      │   holds the audio session    │
│    via textDocumentProxy│                      │   alive in the background    │
└─────────────────────────┘                      └──────────────────────────────┘
```

The keyboard is deliberately dumb. It renders state and sends intent. Every model —
speech and language — lives in the app process.

This is also what keeps it alive at all: keyboard extensions get a small memory budget
(tens of MB) and are killed without warning when they exceed it. A Whisper model is
hundreds of MB. Even Apple's own APIs would be a gamble in there. In the app process
there's no such ceiling, and both Apple frameworks do their heavy lifting in system
daemons anyway, so our own footprint stays small.

### The cost of this design, stated plainly

- **The app has to be running.** A Darwin notification cannot wake a suspended process.
  The user starts a "Scribe session" in the app, which activates an audio session and,
  with the `audio` background mode, keeps the app resident after they switch away.
- **The orange mic indicator stays lit** for the whole session. That is iOS telling the
  truth about what's happening, and the UI says so rather than hiding it.
- **iOS will eventually reclaim the app.** When it does, the keyboard's liveness probe
  times out and it shows "Open Scribe" instead of a dead mic button.
- **Opening the app from the keyboard is on thin ice.** Keyboards have no
  `UIApplication` and `NSExtensionContext.open(_:)` isn't honoured for this extension
  point, so `KeyboardViewController.openHostApp()` walks the responder chain looking for
  `openURL:`. That is undocumented, Apple has narrowed it before, and the code treats
  failure as normal — it falls back to telling the user to open Scribe themselves.
  Wispr Flow appears to have hit the same wall: their docs note that on iOS 26.4+,
  tapping the mic may bounce you into their app.

If you want a version of this with none of those caveats, it can't be a keyboard. It
has to be a share extension, an Action Button shortcut, or a regular app you dictate
into and copy out of.

## What's in here

| | |
|---|---|
| `Shared/ScribeIPC.swift` | Darwin notification bus, shared-container payloads, the message types |
| `Shared/ScribeSettings.swift` | Settings both processes read |
| `App/Engine/AudioCapture.swift` | `AVAudioEngine` tap, session keep-alive, level metering |
| `App/Engine/AppleSpeechEngine.swift` | `SpeechAnalyzer` + `SpeechTranscriber` (iOS 26+) |
| `App/Engine/WhisperKitEngine.swift` | Optional open-weights path, compiled out unless the package is linked |
| `App/Engine/Formatting/` | The clean-up pass: Foundation Models, prompts, and a rule-based fallback |
| `App/Engine/ScribeHost.swift` | Orchestrator — owns the session, answers the keyboard |
| `Keyboard/` | The extension: model, view controller, SwiftUI keyboard, QWERTY |

## Which model?

Both, behind one protocol (`TranscriptionEngine`), because they're good at different things.

**Apple Speech (`SpeechTranscriber`, the default).** The same on-device model behind
system dictation. Genuinely streaming, no session length cap (the old
`SFSpeechRecognizer` died at 60 seconds), and it runs in a system daemon so it barely
costs us any memory. iOS 27 shipped a more accurate dictation model again. Downside:
it's Apple's, you get what you get, and asset download is per-locale.

**WhisperKit (open weights).** Works on any device regardless of Apple Intelligence
eligibility, and you can swap in your own fine-tune. Downside: Whisper is not a
streaming model, so "partial results" means re-decoding the buffer every 1.5s; the
weights load into *our* process; and warm-up is slow. It's compiled out by default —
see the header comment in `WhisperKitEngine.swift` for the two lines that enable it.

**The clean-up pass is Apple's foundation model either way**
(`FoundationModelsFormatter`). This is the part that actually makes dictation feel
good — turning `"um so i think we should uh ship it friday period"` into
`"So I think we should ship it on Friday."` — and it's why this is worth building now
rather than two years ago. It needs an Apple Intelligence capable device; when that
isn't available, `RuleBasedFormatter` handles spoken punctuation, filler words, and
sentence casing without any model at all.

Three details in `FormattingPrompt.swift` that matter more than they look:

1. **The model is told, emphatically, not to answer.** Dictate "what's the capital of
   France" and you want that sentence in your text field, not "Paris". Instruction-tuned
   models want to be helpful; this one has to be told its job is transcription.
2. **It sees the text already in the field.** That's how it knows whether it's writing
   a lowercase Slack reply or a punctuated email, and whether it's joining onto an
   unfinished sentence.
3. **Greedy sampling.** Clean-up should be reproducible. Same words in, same text out.

The formatter never lets a failure eat your words: any error retries once without the
surrounding context, then falls back to inserting the raw transcript.

## Running it

Needs a Mac with Xcode 26 or 27, and a **physical device** — the simulator has no
Apple Intelligence and the keyboard/mic interaction doesn't reproduce there.

```sh
brew install xcodegen
./bootstrap.sh
open Scribe.xcodeproj
```

Then, once:

1. Set your team on **both** targets under Signing & Capabilities.
2. Replace `group.co.jsdf.scribe` with an App Group you own — in `project.yml`
   and in `ScribeGroup.identifier` (`Shared/ScribeIPC.swift`). Both targets need it.
3. Build and run to your device.
4. In the app: **Start Scribe session**, allow the microphone.
5. Settings → General → Keyboard → Keyboards → Add New Keyboard → Scribe, then tap Scribe
   and enable **Allow Full Access**. Without it the extension can't reach the shared
   container and nothing works.
6. In any app, hold the globe key, pick Scribe, tap the mic.

`project.yml` targets iOS 26.0 and builds in Swift 5 language mode. Both are
deliberate: 26.0 is the floor for `SpeechAnalyzer` and `FoundationModels`, and Swift 5
mode keeps concurrency disagreements as warnings while you get it building. Flip
`SWIFT_VERSION` to `6.0` after that.

## State of this code

Written on Linux against verified API signatures — `SpeechAnalyzer`,
`SpeechTranscriber`, `AssetInventory`, `LanguageModelSession`, `@Generable` are all
real and used as documented — but **never compiled**, because that needs Xcode. Expect
to fix a few signature and isolation complaints on the first build. The architecture is
the part that's been thought through; treat the Swift as a strong first draft.

Specific things to verify on device:

- Whether the responder-chain `openURL:` trick still works on iOS 27.
- How long iOS actually leaves the app resident with an active recording session under
  memory pressure.
- Whether `FoundationModels` has picked up any entitlement requirements in iOS 27 —
  the plain on-device `SystemLanguageModel` path has never needed one, but iOS 27 added
  Private Cloud Compute and third-party model providers to the same framework, and
  those are reported to be gated.

## Sources

- [App Extension Programming Guide: Custom Keyboard](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html) — no microphone for extensions
- [Recording audio from a keyboard extension](https://developer.apple.com/forums/thread/775077) and [Record microphone in a keyboard app](https://developer.apple.com/forums/thread/800500) — what the failure looks like in practice
- [SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer) · [Foundation Models](https://developer.apple.com/documentation/foundationmodels)
- [FluidInference/swift-scribe](https://github.com/FluidInference/swift-scribe) — working SpeechAnalyzer + Foundation Models reference
- [Set up the Scribe keyboard on iPhone](https://docs.wisprflow.ai/articles/7453988911-set-up-the-flow-keyboard-on-iphone) — Wispr Flow's own setup flow, including the iOS 26.4 app-bounce
- [Wispr Flow is an AI iPhone keyboard that transcribes what you say](https://9to5mac.com/2025/06/30/wispr-flow-is-an-ai-that-transcribes-what-you-say-right-from-the-iphone-keyboard/)

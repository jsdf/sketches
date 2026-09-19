# Song Practice

An Expo Go app for practising a song's chords and melody. Type a song name, an
agent researches it on the web, and the result opens in six practice modes.

## Running it

```bash
cd songpractice
npm install
npx expo start
```

Scan the QR code with Expo Go. No native build is needed.

## Setting up song lookup

Four bundled songs work with no API key at all. To look up new songs, open
**Settings** from the Song tab and add a key for one of:

- **DeepSeek** — `deepseek-chat` by default. DeepSeek has no web search, so the
  app searches and reads pages itself. Search backend is pluggable: Tavily or
  Brave if you add a key, otherwise a keyless DuckDuckGo scrape that works but
  can be rate limited.
- **Claude** — `claude-opus-5`. Web search and page fetching run on Anthropic's
  servers, so no second key is needed.

Keys are stored in the device keystore (`expo-secure-store`) and only ever sent
to the provider you picked.

## Practice modes

| Tab | What it is for |
| --- | --- |
| **Song** | Search for a song, watch the agent's steps, manage your library |
| **Play** | Chords and melody in rhythm. Mute either part to play it yourself over the other — that is the accompaniment mode |
| **Pads** | A pad per chord in the song, for jamming the changes |
| **Scale** | Only the notes of the scale, laid out as rows of pads. Hold to sustain, slide to phrase. Chord tones light up over the backing track |
| **Shapes** | Page through each chord on a chromatic keyboard with the tones and degrees marked; hide them to test yourself |
| **Drill** | Simon-style. The app plays a chunk, you play it back, the chunk grows by one each time you get it right |

## How it is put together

```
App.tsx                    tab shell; instrument panel sits between screen and tab bar
src/music/                 note, chord, scale and song-timeline theory (no UI, no audio)
src/audio/instrumentHtml   the WebView: Web Audio synth + keyboard + pads
src/audio/Instrument*      React side of the instrument
src/agent/                 tool-calling loop, web search, submission validation
src/state/                 settings, prefs and library persistence
src/screens/               one file per tab
```

### Why the instrument is a WebView

React Native cannot synthesise audio, and one audio file per note gives poor
latency and no real polyphony. The synth is Web Audio inside a WebView — and the
**keyboard and pads live in that same WebView**, so a key press reaches the
oscillator without crossing the React Native bridge. That also gives real
multi-touch from pointer events and CSS transitions for the auto-shift.

The WebView is mounted **once**, outside the tab switcher, and collapses to zero
height on screens that do not need it. Unmounting it would tear down the
`AudioContext`.

Networking stays on the React Native side on purpose: a WebView loaded from an
HTML string has a null origin, so CORS would block the agent's API and scraping
requests. RN's `fetch` is a native call with no such restriction.

### Why the model never sends notes

The agent only ever submits **chord symbols** (`F#m7b5`) and **pitch names**
(`Bb4`). The app parses both locally with its own theory code, so a hallucinated
symbol becomes a validation error fed back to the model for another attempt,
rather than a wrong note reaching the audio engine.

### Timing

The sequencer runs inside the WebView against the Web Audio clock, scheduling
250 ms ahead. The app sends events positioned in **beats**; the engine converts
to seconds, handles looping and the count-in, and posts the playhead back about
18 times a second for the UI to follow.

## Known limits

- The keyless DuckDuckGo search is best effort and some chord sites block
  scraping. A Tavily or Brave key, or the Claude backend, is much more reliable.
- Melody transcriptions for obscure songs are the least reliable part; the agent
  reports its own confidence, and will submit chords with an empty melody rather
  than invent one.
- Web is not a supported target: `react-native-webview` has no web
  implementation, so the instrument would not render.

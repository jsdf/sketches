import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import {
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
} from "vexflow";

type Mode = "practice" | "simon";

type NoteEvent = {
  pcs: number[];
  midis: number[];
};

const PITCH_CLASS_NAMES_SHARP = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

const KEY_OPTIONS = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
] as const;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function pcFromMidi(m: number) {
  return ((m % 12) + 12) % 12;
}

function midiToVexKey(midi: number): string {
  const pc = pcFromMidi(midi);
  const octave = Math.floor(midi / 12) - 1;
  const name = PITCH_CLASS_NAMES_SHARP[pc].toLowerCase();
  if (name.includes("#")) {
    const [letter] = name.split("#");
    return `${letter}#/${octave}`;
  }
  return `${name}/${octave}`;
}

function keyToRootPC(keySig: string): number {
  const map: Record<string, number> = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    Ab: 8,
    A: 9,
    Bb: 10,
    B: 11,
  };
  return map[keySig] ?? 0;
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeNextNoteEvent(rootPC: number, octaveBaseMidi: number): NoteEvent {
  const interval = randomChoice(MAJOR_SCALE_INTERVALS);
  const pc = (rootPC + interval) % 12;

  const target = octaveBaseMidi;
  let midi = target;
  while (pcFromMidi(midi) !== pc) midi += 1;
  midi = clamp(midi, 48, 84);

  return { pcs: [pc], midis: [midi] };
}

function buildQwertyMap(baseC: number): Record<string, number> {
  const entries: Array<[string, number]> = [
    ["z", baseC + 0],
    ["s", baseC + 1],
    ["x", baseC + 2],
    ["d", baseC + 3],
    ["c", baseC + 4],
    ["v", baseC + 5],
    ["g", baseC + 6],
    ["b", baseC + 7],
    ["h", baseC + 8],
    ["n", baseC + 9],
    ["j", baseC + 10],
    ["m", baseC + 11],
    [",", baseC + 12],
    ["q", baseC + 12 + 0],
    ["2", baseC + 12 + 1],
    ["w", baseC + 12 + 2],
    ["3", baseC + 12 + 3],
    ["e", baseC + 12 + 4],
    ["r", baseC + 12 + 5],
    ["5", baseC + 12 + 6],
    ["t", baseC + 12 + 7],
    ["6", baseC + 12 + 8],
    ["y", baseC + 12 + 9],
    ["7", baseC + 12 + 10],
    ["u", baseC + 12 + 11],
    ["i", baseC + 12 + 12],
  ];
  return Object.fromEntries(entries);
}

function isTypingInInput(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Piano({
  startMidi,
  numWhiteKeys,
  pressedMidis,
  onDown,
}: {
  startMidi: number;
  numWhiteKeys: number;
  pressedMidis: Set<number>;
  onDown: (midi: number) => void;
}) {
  const whiteSteps = [2, 2, 1, 2, 2, 2, 1];
  const whites: number[] = [];
  let midi = startMidi;
  whites.push(midi);
  for (let i = 1; i < numWhiteKeys; i += 1) {
    midi += whiteSteps[(i - 1) % 7];
    whites.push(midi);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: 160, userSelect: "none" }}>
      <div
        style={{
          display: "flex",
          height: 160,
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid #d8cfd4",
        }}
      >
        {whites.map((whiteMidi) => {
          const down = pressedMidis.has(whiteMidi);
          return (
            <button
              key={whiteMidi}
              onMouseDown={() => onDown(whiteMidi)}
              style={{
                flex: 1,
                border: "none",
                borderRight: "1px solid #d8cfd4",
                background: down ? "#f0e6ec" : "#ffffff",
                position: "relative",
              }}
              aria-label={`White key ${whiteMidi}`}
            />
          );
        })}
      </div>

      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 100, pointerEvents: "none" }}>
        <div style={{ display: "flex", height: 160 }}>
          {whites.map((whiteMidi) => {
            const pc = pcFromMidi(whiteMidi);
            const hasSharp = pc === 0 || pc === 2 || pc === 5 || pc === 7 || pc === 9;
            const blackMidi = whiteMidi + 1;

            return (
              <div key={whiteMidi} style={{ flex: 1, position: "relative" }}>
                {hasSharp && (
                  <button
                    onMouseDown={() => onDown(blackMidi)}
                    style={{
                      pointerEvents: "auto",
                      position: "absolute",
                      left: "65%",
                      top: 0,
                      width: "70%",
                      height: 100,
                      transform: "translateX(-50%)",
                      borderRadius: 8,
                      border: "1px solid #2a1c22",
                      background: pressedMidis.has(blackMidi) ? "#5a3a4a" : "#3a2430",
                    }}
                    aria-label={`Black key ${blackMidi}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const pageLoadMs = useRef(performance.now());
  const [mode, setMode] = useState<Mode>("practice");
  const [keySig, setKeySig] = useState<(typeof KEY_OPTIONS)[number]>("G");
  const [locked, setLocked] = useState(false);

  const [bpm, setBpm] = useState(92);
  const [metronomeOn, setMetronomeOn] = useState(false);

  const [octaveShift, setOctaveShift] = useState(0);
  const [sequence, setSequence] = useState<NoteEvent[]>([]);
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<"idle" | "listening" | "playing" | "wrong" | "win">("idle");

  const [pressedMidis, setPressedMidis] = useState<Set<number>>(new Set());

  const vfRef = useRef<HTMLDivElement | null>(null);

  const synth = useMemo(() => {
    const instrument = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.6 },
    }).toDestination();
    instrument.volume.value = -8;
    return instrument;
  }, []);

  const clickSynth = useMemo(() => {
    const instrument = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
    }).toDestination();
    instrument.volume.value = -12;
    return instrument;
  }, []);

  const rootPC = useMemo(() => keyToRootPC(keySig), [keySig]);

  const qwertyBaseC = useMemo(() => 48 + octaveShift * 12, [octaveShift]);

  const qwertyMap = useMemo(() => buildQwertyMap(qwertyBaseC), [qwertyBaseC]);

  const logEvent = useCallback((message: string, details?: Record<string, unknown>) => {
    const secondsSinceLoad = (performance.now() - pageLoadMs.current) / 1000;
    if (details) {
      console.log(`[${secondsSinceLoad.toFixed(3)}s] ${message}`, details);
    } else {
      console.log(`[${secondsSinceLoad.toFixed(3)}s] ${message}`);
    }
  }, []);

  const renderNotation = useCallback(
    (seq: NoteEvent[]) => {
      const el = vfRef.current;
      if (!el) return;

      el.innerHTML = "";
      const renderer = new Renderer(el, Renderer.Backends.SVG);
      renderer.resize(820, 260);
      const ctx = renderer.getContext();

      (ctx as unknown as { svg: SVGElement }).svg.style.borderRadius = "12px";

      const treble = new Stave(40, 30, 740);
      treble.addClef("treble").addTimeSignature("4/4").setKeySignature(keySig);
      treble.setContext(ctx).draw();

      const bass = new Stave(40, 150, 740);
      bass.addClef("bass").addTimeSignature("4/4").setKeySignature(keySig);
      bass.setContext(ctx).draw();

      const connectorLeft = new StaveConnector(treble, bass).setType(StaveConnector.type.BRACKET);
      connectorLeft.setContext(ctx).draw();
      const connectorLine = new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_LEFT);
      connectorLine.setContext(ctx).draw();

      if (mode === "simon") {
        return;
      }

      if (seq.length === 0) {
        return;
      }

      const trebleNotes: StaveNote[] = [];
      for (const ev of seq) {
        const [midiNote] = ev.midis;
        const key = midiToVexKey(midiNote);
        const note = new StaveNote({
          clef: "treble",
          keys: [key],
          duration: "8",
        });
        if (key.includes("#")) note.addModifier(new Accidental("#"), 0);
        trebleNotes.push(note);
      }

      const voice = new Voice({ numBeats: Math.max(1, seq.length) / 2, beatValue: 4 });
      voice.addTickables(trebleNotes);

      new Formatter().joinVoices([voice]).format([voice], 680);
      voice.draw(ctx, treble);
    },
    [keySig, mode]
  );

  useEffect(() => {
    renderNotation(sequence);
  }, [sequence, renderNotation]);

  const resetGame = useCallback(() => {
    logEvent("reset game");
    setSequence([]);
    setIdx(0);
    setStatus("idle");
  }, [logEvent]);

  const ensureAudio = useCallback(async () => {
    if (Tone.context.state !== "running") {
      await Tone.start();
    }
  }, []);

  const playSequence = useCallback(async () => {
    await ensureAudio();
    logEvent("play sequence", { length: sequence.length, bpm });
    setStatus("listening");

    const stepMs = Math.round((60_000 / bpm) * 0.9);

    for (let i = 0; i < sequence.length; i += 1) {
      const ev = sequence[i];
      const freqs = ev.midis.map((midiNote) => Tone.Frequency(midiNote, "midi").toFrequency());
      logEvent("play note", { step: i + 1, midi: ev.midis, pcs: ev.pcs });
      synth.triggerAttackRelease(freqs, "8n");
      await sleep(stepMs);
    }

    setStatus("playing");
    setIdx(0);
  }, [bpm, ensureAudio, sequence, synth]);

  const extendSequence = useCallback(() => {
    setSequence((prev) => {
      const baseMidi = 60;
      const next = makeNextNoteEvent(rootPC, baseMidi);
      logEvent("extend sequence", { nextMidi: next.midis, nextPc: next.pcs });
      return [...prev, next];
    });
  }, [logEvent, rootPC]);

  const startGame = useCallback(async () => {
    await ensureAudio();
    logEvent("start game", { locked, keySig, mode });
    setStatus("idle");
    setIdx(0);

    setSequence((prev) => {
      if (prev.length === 0) {
        const baseMidi = 60;
        return [makeNextNoteEvent(rootPC, baseMidi)];
      }
      if (!locked) {
        const baseMidi = 60;
        return [...prev, makeNextNoteEvent(rootPC, baseMidi)];
      }
      return prev;
    });

    await sleep(50);
    await playSequence();
  }, [ensureAudio, keySig, locked, logEvent, mode, playSequence, rootPC]);

  const onUserPlayed = useCallback(
    async (midi: number) => {
      await ensureAudio();
      logEvent("user input", { midi, pitchClass: pcFromMidi(midi) });

      synth.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), "8n");

      setPressedMidis((prev) => new Set(prev).add(midi));
      setTimeout(() => {
        setPressedMidis((prev) => {
          const next = new Set(prev);
          next.delete(midi);
          return next;
        });
      }, 120);

      if (status !== "playing") return;

      const expected = sequence[idx];
      if (!expected) return;

      const playedPC = pcFromMidi(midi);
      const ok = expected.pcs.includes(playedPC);

      if (!ok) {
        logEvent("input incorrect", { expected: expected.pcs, got: playedPC });
        setStatus("wrong");
        if (mode === "simon") {
          setTimeout(() => resetGame(), 450);
        } else {
          setTimeout(() => {
            setStatus("playing");
            setIdx(0);
          }, 450);
        }
        return;
      }

      const nextIdx = idx + 1;
      if (nextIdx >= sequence.length) {
        logEvent("sequence complete");
        setStatus("win");
        setTimeout(async () => {
          if (!locked) extendSequence();
          setIdx(0);
          await sleep(80);
          await playSequence();
        }, 450);
      } else {
        setIdx(nextIdx);
      }
    },
    [
      ensureAudio,
      extendSequence,
      idx,
      locked,
      logEvent,
      mode,
      playSequence,
      resetGame,
      sequence,
      status,
      synth,
    ]
  );

  useEffect(() => {
    if (!metronomeOn) return;

    let alive = true;
    let timer: number | null = null;

    (async () => {
      await ensureAudio();
      logEvent("metronome start", { bpm });
      const interval = Math.round(60_000 / bpm);
      timer = window.setInterval(() => {
        if (!alive) return;
        logEvent("metronome tick");
        clickSynth.triggerAttackRelease("C2", "16n");
      }, interval);
    })();

    return () => {
      alive = false;
      logEvent("metronome stop");
      if (timer != null) window.clearInterval(timer);
    };
  }, [bpm, clickSynth, ensureAudio, logEvent, metronomeOn]);

  useEffect(() => {
    const down = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isTypingInInput()) return;

      const k = e.key.toLowerCase();

      if (k === "[") {
        e.preventDefault();
        setOctaveShift((s) => {
          const next = clamp(s - 1, -2, 2);
          logEvent("octave shift down", { octaveShift: next });
          return next;
        });
        return;
      }
      if (k === "]") {
        e.preventDefault();
        setOctaveShift((s) => {
          const next = clamp(s + 1, -2, 2);
          logEvent("octave shift up", { octaveShift: next });
          return next;
        });
        return;
      }

      const midi = qwertyMap[k];
      if (midi == null) return;

      e.preventDefault();
      if (down.has(k)) return;
      down.add(k);
      onUserPlayed(midi);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      down.delete(e.key.toLowerCase());
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [logEvent, onUserPlayed, qwertyMap]);

  const titleKey = `${keySig} Major`;
  const progressText =
    sequence.length > 0 ? `Note ${Math.min(idx + 1, sequence.length)} of ${sequence.length}` : "—";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3eadf",
        color: "#3a2430",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "26px 18px 42px" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div
            style={{
              fontSize: 54,
              letterSpacing: 1,
              color: "#6b3c50",
              fontFamily: "ui-serif, Georgia, serif",
            }}
          >
            Lend Me Your Ears (Clone)
          </div>
          <div style={{ marginTop: 6, color: "#8a5a72" }}>A musical ear training game</div>
        </div>

        <div
          style={{
            background: "#f7f0e7",
            border: "1px solid #eadfe3",
            borderRadius: 18,
            boxShadow: "0 20px 40px rgba(40, 18, 30, 0.10)",
            padding: 18,
          }}
        >
          <div style={{ textAlign: "center", padding: "8px 0 14px" }}>
            <div style={{ fontSize: 28 }}>{titleKey}</div>
            <div style={{ marginTop: 6, color: "#8a5a72" }}>
              {progressText} {locked ? " 🔒" : ""}
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              border: "1px solid #eadfe3",
              borderRadius: 14,
              padding: 14,
            }}
          >
            <div ref={vfRef} />
            <div style={{ textAlign: "center", color: "#a07a8e", marginTop: 8 }}>
              {mode === "practice"
                ? "Play the notes you heard on the piano below (notation shown)"
                : "Listen, then play the notes back (notation hidden)"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "center",
              marginTop: 16,
            }}
          >
            <button
              onClick={startGame}
              style={{
                background: "#6b3c50",
                color: "#fff",
                padding: "10px 18px",
                borderRadius: 12,
                border: "1px solid #6b3c50",
                cursor: "pointer",
              }}
            >
              ▶ Start
            </button>

            <button
              onClick={playSequence}
              disabled={sequence.length === 0}
              style={{
                background: "#f7f0e7",
                color: "#6b3c50",
                padding: "10px 18px",
                borderRadius: 12,
                border: "1px solid #6b3c50",
                cursor: sequence.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              ↻ Listen
            </button>

            <button
              onClick={() => {
                setMetronomeOn((v) => {
                  const next = !v;
                  logEvent("toggle metronome", { next });
                  return next;
                });
              }}
              style={{
                background: "#f7f0e7",
                color: "#6b3c50",
                padding: "10px 18px",
                borderRadius: 12,
                border: "1px solid #6b3c50",
                cursor: "pointer",
              }}
            >
              {metronomeOn ? "⏱ Metronome: On" : "⏱ Metronome"}
            </button>

            <button
              onClick={() =>
                setMode((m) => {
                  const next = m === "practice" ? "simon" : "practice";
                  logEvent("toggle mode", { next });
                  return next;
                })
              }
              style={{
                background: "#f7f0e7",
                color: "#6b3c50",
                padding: "10px 18px",
                borderRadius: 12,
                border: "1px solid #6b3c50",
                cursor: "pointer",
              }}
            >
              ⇄ Mode: {mode === "practice" ? "Practice" : "Simon"}
            </button>

            <button
              onClick={() =>
                setLocked((v) => {
                  const next = !v;
                  logEvent("toggle lock", { next });
                  return next;
                })
              }
              style={{
                background: "#f7f0e7",
                color: "#6b3c50",
                padding: "10px 18px",
                borderRadius: 12,
                border: "1px solid #6b3c50",
                cursor: "pointer",
              }}
              title="Lock sequence length"
            >
              {locked ? "🔒 Locked" : "🔓 Lock"}
            </button>

            <button
              onClick={resetGame}
              style={{
                background: "#f7f0e7",
                color: "#6b3c50",
                padding: "10px 18px",
                borderRadius: 12,
                border: "1px solid #6b3c50",
                cursor: "pointer",
              }}
            >
              ⟲ Reset
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 14 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "#6b3c50" }}>
              Key
              <select
                value={keySig}
                onChange={(e) => {
                  const next = e.target.value as (typeof KEY_OPTIONS)[number];
                  setKeySig(next);
                  logEvent("change key", { key: next });
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #d8cfd4",
                  background: "#fff",
                }}
              >
                {KEY_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k} Major
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "#6b3c50" }}>
              BPM
              <input
                type="range"
                min={50}
                max={160}
                value={bpm}
                onChange={(e) => setBpm(Number.parseInt(e.target.value, 10))}
              />
              <span style={{ width: 34, textAlign: "right" }}>{bpm}</span>
            </label>

            <div style={{ color: "#8a5a72" }}>
              QWERTY octave: <b>{Math.round(qwertyBaseC / 12) - 1}</b> (use <b>[</b>/<b>]</b> to shift)
            </div>

            <div style={{ color: "#8a5a72" }}>
              Status:{" "}
              <b>
                {status === "idle"
                  ? "Ready"
                  : status === "listening"
                    ? "Listening…"
                    : status === "playing"
                      ? "Your turn"
                      : status === "wrong"
                        ? "Wrong"
                        : "Win"}
              </b>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <Piano
              startMidi={48}
              numWhiteKeys={15}
              pressedMidis={pressedMidis}
              onDown={(midiNote) => onUserPlayed(midiNote)}
            />
          </div>

          <div style={{ textAlign: "center", marginTop: 10, color: "#8a5a72" }}>
            QWERTY: lower row <b>z…</b>, upper row <b>q…</b>, black keys <b>s d g h j</b> and <b>2 3 5 6 7</b>
          </div>
        </div>
      </div>
    </div>
  );
}

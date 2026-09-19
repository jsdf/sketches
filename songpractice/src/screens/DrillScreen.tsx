import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import * as Haptics from 'expo-haptics';

import {
  PadItem,
  SeqEvent,
  useInstrument,
  useInstrumentSurface,
  useTransportState,
} from '../audio/InstrumentProvider';
import {voiceChord} from '../music/chords';
import {comfortableKeyWidth, keyboardRange} from '../music/keyboard';
import {midiLabel, mod12} from '../music/notes';
import {uniqueChords} from '../music/song';
import {keyLabel, preferFlatsFor} from '../music/scales';
import {useStore} from '../state/store';
import {colors, radius, space, type} from '../theme';
import {Button, Card, Empty, Row, SectionLabel, Segmented, Toggle} from '../components/ui';

type Material = 'chords' | 'melody';
type Phase = 'idle' | 'demo' | 'input' | 'right' | 'wrong';

const PANEL_CHORDS = 250;
const PANEL_MELODY = 205;
const MIN_CHUNK = 2;
const MAX_CHUNK = 7;

/** One thing to reproduce: a chord (by pad) or a melody note (by pitch). */
type Step = {label: string; notes: number[]; beats: number; padIndex?: number; midi?: number};

export function DrillScreen() {
  const {timeline, prefs} = useStore();
  const instrument = useInstrument();
  const {width} = useWindowDimensions();
  const [material, setMaterial] = useState<Material>('chords');
  const [anyOctave, setAnyOctave] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [cursor, setCursor] = useState(0);
  const [chunk, setChunk] = useState(MIN_CHUNK);
  const [progress, setProgress] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const flats = timeline ? preferFlatsFor(timeline.key) : false;

  const padChords = useMemo(() => (timeline ? uniqueChords(timeline) : []), [timeline]);

  const padItems = useMemo<PadItem[]>(
    () =>
      padChords.map((chord) => ({
        label: chord.symbol,
        notes: voiceChord(chord.chord, 60).midi,
        strum: 0.02,
        dur: 1.4,
      })),
    [padChords],
  );

  /** The full sequence this drill walks through. */
  const steps = useMemo<Step[]>(() => {
    if (!timeline) return [];
    if (material === 'chords') {
      return timeline.chords.map((chord) => {
        const padIndex = padChords.findIndex((c) => c.symbol === chord.symbol);
        return {label: chord.symbol, notes: chord.midi, beats: Math.min(chord.beats, 2), padIndex};
      });
    }
    return timeline.melody
      .filter((note) => note.midi != null)
      .map((note) => ({
        label: midiLabel(note.midi!, flats),
        notes: [note.midi!],
        beats: Math.min(note.beats, 2),
        midi: note.midi!,
      }));
  }, [timeline, material, padChords, flats]);

  const melodyRange = useMemo(() => {
    const notes = steps.flatMap((s) => s.notes);
    return keyboardRange(notes.length ? notes : [60], 2);
  }, [steps]);

  const keyWidth = comfortableKeyWidth(melodyRange, width, prefs.keyWidth);

  useInstrumentSurface(
    useMemo(
      () =>
        material === 'chords'
          ? ({mode: 'pads' as const, items: padItems, cols: padItems.length <= 4 ? 2 : padItems.length <= 9 ? 3 : 4})
          : ({
              mode: 'piano' as const,
              low: melodyRange.low,
              high: melodyRange.high,
              keyWidth,
              labels: 'white' as const,
              flats,
            }),
      [material, padItems, melodyRange.low, melodyRange.high, keyWidth, flats],
    ),
    material === 'chords' ? PANEL_CHORDS : PANEL_MELODY,
  );

  const target = useMemo(() => steps.slice(cursor, cursor + chunk), [steps, cursor, chunk]);

  // Listener callbacks need the live round state, not the values captured when
  // the subscription was made.
  const stateRef = useRef({phase, target, progress, anyOctave, material});
  stateRef.current = {phase, target, progress, anyOctave, material};

  const playChunk = useCallback(
    (items: Step[]) => {
      if (items.length === 0) return;
      const events: SeqEvent[] = [];
      let beat = 0;
      for (const step of items) {
        for (const midi of step.notes) {
          events.push({b: beat, d: Math.max(0.4, step.beats * 0.9), m: midi, c: material === 'chords' ? 'chords' : 'melody', v: 1});
        }
        beat += step.beats;
      }
      instrument.setGain('chords', 1);
      instrument.setGain('melody', 1);
      instrument.play({
        events,
        tempo: Math.round(Math.min(160, Math.max(50, (timeline?.song.tempo ?? 100) * prefs.tempoScale))),
        loop: false,
        loopStart: 0,
        loopEnd: beat,
      });
    },
    [instrument, material, timeline, prefs.tempoScale],
  );

  const startRound = useCallback(
    (items: Step[]) => {
      setProgress(0);
      setMessage(null);
      setPhase('demo');
      playChunk(items);
    },
    [playChunk],
  );

  // The demo finished playing; hand over to the player.
  useTransportState(
    useCallback(() => {
      if (stateRef.current.phase === 'demo') setPhase('input');
    }, []),
  );

  const advance = useCallback(() => {
    setStreak((s) => {
      const next = s + 1;
      setBest((b) => Math.max(b, next));
      return next;
    });
    const atMax = chunk >= MAX_CHUNK || cursor + chunk >= steps.length;
    if (atMax) {
      const nextCursor = cursor + chunk >= steps.length ? 0 : cursor + chunk;
      setCursor(nextCursor);
      setChunk(MIN_CHUNK);
      setMessage(nextCursor === 0 ? 'Round complete. Back to the top.' : 'Chunk learned. Next chunk.');
    } else {
      setChunk(chunk + 1);
      setMessage('Correct. One more.');
    }
  }, [chunk, cursor, steps.length]);

  const handleInput = useCallback(
    (matches: (step: Step) => boolean, sound: () => void) => {
      const {phase: p, target: t, progress: pos} = stateRef.current;
      if (p !== 'input') return;
      const expected = t[pos];
      if (!expected) return;
      if (matches(expected)) {
        const next = pos + 1;
        setProgress(next);
        Haptics.selectionAsync().catch(() => {});
        if (next >= t.length) {
          setPhase('right');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          advance();
        }
      } else {
        setPhase('wrong');
        setStreak(0);
        setMessage(`Expected ${expected.label}. Listen again.`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
      sound();
    },
    [advance],
  );

  useEffect(
    () =>
      instrument.onPad((index) => {
        if (stateRef.current.material !== 'chords') return;
        handleInput((step) => step.padIndex === index, () => {});
      }),
    [instrument, handleInput],
  );

  useEffect(
    () =>
      instrument.onNote((midi, on) => {
        if (!on || stateRef.current.material !== 'melody') return;
        handleInput(
          (step) => (stateRef.current.anyOctave ? mod12(step.midi ?? -1) === mod12(midi) : step.midi === midi),
          () => {},
        );
      }),
    [instrument, handleInput],
  );

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const chunkRef = useRef(chunk);
  chunkRef.current = chunk;

  // After a right or wrong answer, pause a beat and then play the next prompt.
  useEffect(() => {
    if (phase !== 'right' && phase !== 'wrong') return;
    const timer = setTimeout(() => {
      startRound(phase === 'wrong' ? target : steps.slice(cursorRef.current, cursorRef.current + chunkRef.current));
    }, 900);
    return () => clearTimeout(timer);
    // `target` is deliberately read fresh above for the retry case only.
  }, [phase, startRound, steps, target]);

  const stop = useCallback(() => {
    instrument.stop();
    setPhase('idle');
    setProgress(0);
    setMessage(null);
  }, [instrument]);

  const restart = useCallback(() => {
    setCursor(0);
    setChunk(MIN_CHUNK);
    setStreak(0);
    startRound(steps.slice(0, MIN_CHUNK));
  }, [startRound, steps]);

  useEffect(() => {
    stop();
    setCursor(0);
    setChunk(MIN_CHUNK);
    // Switching material starts a different drill from scratch.
  }, [material, stop]);

  if (!timeline) return <Empty title="Pick a song first" hint="Find one on the Song tab." />;
  if (steps.length === 0) {
    return <Empty title={material === 'melody' ? 'This song has no melody yet' : 'This song has no chords'} />;
  }

  const running = phase !== 'idle';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={type.title}>Drill</Text>
        <Text style={type.dim}>
          {timeline.song.title} · {keyLabel(timeline.key)}
        </Text>
      </View>

      <Segmented
        options={[
          {value: 'chords', label: 'Chord sequence'},
          {value: 'melody', label: 'Melody phrase'},
        ]}
        value={material}
        onChange={(v) => setMaterial(v as Material)}
      />

      <Card>
        <SectionLabel
          right={
            <Text style={type.mono}>
              streak {streak} · best {best}
            </Text>
          }>
          {phaseLabel(phase)}
        </SectionLabel>

        <Row gap={6} style={styles.dots}>
          {target.map((step, i) => {
            const done = i < progress;
            const isNext = i === progress && phase === 'input';
            return (
              <View key={i} style={[styles.dot, done && styles.dotDone, isNext && styles.dotNext]}>
                <Text style={[styles.dotText, done && styles.dotTextDone, isNext && styles.dotTextNext]}>
                  {phase === 'input' && !done ? '?' : step.label}
                </Text>
              </View>
            );
          })}
        </Row>

        {message ? <Text style={[type.dim, phase === 'wrong' && styles.bad]}>{message}</Text> : null}

        <Text style={styles.hint}>
          Chunk {chunk} of {MAX_CHUNK} · items {cursor + 1}–{Math.min(cursor + chunk, steps.length)} of {steps.length}
        </Text>
      </Card>

      <Row gap={space.sm}>
        <Button
          label={running ? 'Stop' : 'Start drill'}
          onPress={running ? stop : restart}
          variant={running ? 'default' : 'primary'}
          style={styles.flex}
        />
        <Button label="Hear it again" onPress={() => startRound(target)} disabled={!running} style={styles.flex} />
      </Row>

      {material === 'melody' ? (
        <Row gap={space.xs} style={styles.wrap}>
          <Toggle label="Any octave counts" value={anyOctave} onChange={setAnyOctave} />
        </Row>
      ) : null}

      <Card>
        <SectionLabel>How it works</SectionLabel>
        <Text style={type.dim}>
          The app plays a short chunk, you play it back. Get it right and the chunk grows by one. Reach {MAX_CHUNK} and
          it moves on to the next part of the song.
        </Text>
      </Card>
    </ScrollView>
  );
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'demo':
      return 'Listen';
    case 'input':
      return 'Your turn';
    case 'right':
      return 'Correct';
    case 'wrong':
      return 'Not quite';
    default:
      return 'Ready';
  }
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  content: {padding: space.lg, gap: space.md, paddingBottom: space.lg},
  flex: {flex: 1},
  wrap: {flexWrap: 'wrap'},
  dots: {flexWrap: 'wrap'},
  dot: {
    minWidth: 46,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  dotDone: {borderColor: colors.good, backgroundColor: colors.good + '22'},
  dotNext: {borderColor: colors.accent},
  dotText: {color: colors.textDim, fontSize: 14, fontWeight: '700'},
  dotTextDone: {color: colors.good},
  dotTextNext: {color: colors.accent},
  hint: {...type.dim, color: colors.textFaint, fontSize: 12},
  bad: {color: colors.bad},
});

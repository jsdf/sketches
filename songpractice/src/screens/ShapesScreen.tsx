import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, useWindowDimensions, View} from 'react-native';

import {useInstrument, useInstrumentSurface, usePlayedNotes} from '../audio/InstrumentProvider';
import {chordPcs, describeChord, voiceChord} from '../music/chords';
import {comfortableKeyWidth, keyboardRange} from '../music/keyboard';
import {midiLabel, mod12} from '../music/notes';
import {chordsInOrder} from '../music/song';
import {keyLabel, preferFlatsFor, romanNumeral} from '../music/scales';
import {useStore} from '../state/store';
import {colors, radius, space, type} from '../theme';
import {Button, Card, Empty, Pill, Row, RoundButton, SectionLabel, Toggle} from '../components/ui';

const PANEL_HEIGHT = 210;
const AUTO_MS = 3200;

export function ShapesScreen() {
  const {timeline, prefs} = useStore();
  const instrument = useInstrument();
  const {width} = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const [quiz, setQuiz] = useState(false);

  const chords = useMemo(() => (timeline ? chordsInOrder(timeline) : []), [timeline]);
  const current = chords[Math.min(index, chords.length - 1)];

  const voiced = useMemo(() => (current ? voiceChord(current.chord, 60) : null), [current]);

  const range = useMemo(() => {
    const notes = chords.flatMap((c) => voiceChord(c.chord, 60).midi);
    return keyboardRange(notes, 2);
  }, [chords]);

  const flats = timeline ? preferFlatsFor(timeline.key) : false;
  const keyWidth = comfortableKeyWidth(range, width, prefs.keyWidth);

  useInstrumentSurface(
    useMemo(
      () => ({mode: 'piano' as const, low: range.low, high: range.high, keyWidth, labels: 'white' as const, flats}),
      [range.low, range.high, keyWidth, flats],
    ),
    PANEL_HEIGHT,
  );

  // What you are meant to press. Hidden in quiz mode until you reveal it.
  useEffect(() => {
    if (!voiced || !current) return;
    if (quiz) {
      instrument.update({highlight: {}, degrees: {}, focus: voiced.midi});
      return;
    }
    const highlight: Record<number, string> = {};
    for (const midi of voiced.midi) {
      highlight[midi] = mod12(midi) === current.chord.rootPc ? 'root' : 'on';
    }
    const degrees: Record<number, string> = {};
    for (const [i, midi] of voiced.midi.entries()) degrees[midi] = voiced.labels[i] ?? '';
    instrument.update({highlight, degrees, focus: voiced.midi});
  }, [voiced, current, quiz, instrument]);

  const play = useCallback(() => {
    if (!voiced) return;
    instrument.hit(voiced.midi, {channel: 'chords', dur: 1.8, strum: 0.02});
  }, [instrument, voiced]);

  const step = useCallback(
    (delta: number) => {
      setIndex((prev) => {
        if (chords.length === 0) return 0;
        return (prev + delta + chords.length) % chords.length;
      });
    },
    [chords.length],
  );

  // Auto-advance plays each shape then moves on, hands-free.
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!auto) return;
    play();
    autoRef.current = setInterval(() => {
      setIndex((prev) => (chords.length ? (prev + 1) % chords.length : 0));
    }, AUTO_MS);
    return () => {
      if (autoRef.current) clearInterval(autoRef.current);
    };
  }, [auto, chords.length, play]);

  useEffect(() => {
    if (auto) play();
  }, [index, auto, play]);

  const held = usePlayedNotes();
  const correct = useMemo(() => {
    if (!current || held.length === 0) return null;
    const wanted = new Set(chordPcs(current.chord));
    const playedPcs = new Set(held.map(mod12));
    const missing = [...wanted].filter((pc) => !playedPcs.has(pc));
    const extra = [...playedPcs].filter((pc) => !wanted.has(pc));
    return {ok: missing.length === 0 && extra.length === 0, missing, extra};
  }, [current, held]);

  if (!timeline) return <Empty title="Pick a song first" hint="Find one on the Song tab." />;
  if (!current || !voiced) return <Empty title="This song has no chords" />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Row style={styles.head}>
        <View style={styles.flex}>
          <Text style={type.title}>Chord shapes</Text>
          <Text style={type.dim}>
            {index + 1} of {chords.length} · {keyLabel(timeline.key)}
          </Text>
        </View>
        <Pill label={romanNumeral(timeline.key, current.chord)} tone="warn" />
      </Row>

      <Card>
        <Row style={styles.chordHead}>
          <View style={styles.flex}>
            <Text style={styles.chordName}>{current.symbol}</Text>
            <Text style={type.dim}>{describeChord(current.chord, flats)}</Text>
          </View>
          <RoundButton label="♪" onPress={play} size={46} />
        </Row>

        {quiz && correct ? (
          <View style={[styles.verdict, correct.ok ? styles.verdictOk : styles.verdictNo]}>
            <Text style={[styles.verdictText, {color: correct.ok ? colors.good : colors.bad}]}>
              {correct.ok
                ? 'That is the chord.'
                : `${correct.missing.length ? `missing ${correct.missing.length}` : ''}${
                    correct.missing.length && correct.extra.length ? ' · ' : ''
                  }${correct.extra.length ? `${correct.extra.length} extra` : ''}`}
            </Text>
          </View>
        ) : null}

        {!quiz ? (
          <Row gap={space.xs} style={styles.tones}>
            {voiced.midi.map((midi, i) => (
              <View key={`${midi}-${i}`} style={styles.tone}>
                <Text style={styles.toneNote}>{midiLabel(midi, flats)}</Text>
                <Text style={styles.toneDeg}>{voiced.labels[i]}</Text>
              </View>
            ))}
          </Row>
        ) : (
          <Text style={type.dim}>Play the chord on the keyboard, then check yourself.</Text>
        )}
      </Card>

      <Row gap={space.sm}>
        <Button label="Previous" onPress={() => step(-1)} style={styles.flex} />
        <Button label="Next" onPress={() => step(1)} variant="primary" style={styles.flex} />
      </Row>

      <Row gap={space.xs} style={styles.wrap}>
        <Toggle label="Auto-advance" value={auto} onChange={setAuto} />
        <Toggle label="Hide the notes" value={quiz} onChange={setQuiz} />
      </Row>

      <Card>
        <SectionLabel>All shapes</SectionLabel>
        <Row gap={6} style={styles.wrap}>
          {chords.map((chord, i) => (
            <Text
              key={chord.symbol}
              onPress={() => setIndex(i)}
              style={[styles.miniChip, i === index && styles.miniChipActive]}>
              {chord.symbol}
            </Text>
          ))}
        </Row>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  content: {padding: space.lg, gap: space.md, paddingBottom: space.lg},
  head: {gap: space.sm},
  flex: {flex: 1},
  wrap: {flexWrap: 'wrap'},
  chordHead: {gap: space.sm},
  chordName: {color: colors.text, fontSize: 34, fontWeight: '800'},
  tones: {flexWrap: 'wrap'},
  tone: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 52,
  },
  toneNote: {color: colors.text, fontSize: 15, fontWeight: '700'},
  toneDeg: {color: colors.accent, fontSize: 10, fontWeight: '700'},
  verdict: {borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1},
  verdictOk: {borderColor: colors.good + '66', backgroundColor: colors.good + '18'},
  verdictNo: {borderColor: colors.bad + '66', backgroundColor: colors.bad + '18'},
  verdictText: {fontSize: 13, fontWeight: '700'},
  miniChip: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  miniChipActive: {color: '#1a1405', backgroundColor: colors.accent, borderColor: colors.accent},
});

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';

import {PadItem, useInstrument, useInstrumentSurface, usePlayhead, useTransportState} from '../audio/InstrumentProvider';
import {chordPcs} from '../music/chords';
import {midiLabel, mod12} from '../music/notes';
import {chordEvents, effectiveTempo, findChordIndexAt, sectionSpan} from '../music/playback';
import {Key, keyLabel, preferFlatsFor, relatedScales, SCALES, scaleDegreeMidi} from '../music/scales';
import {Timeline} from '../music/song';
import {useStore} from '../state/store';
import {colors, space, type} from '../theme';
import {Card, Empty, Row, RoundButton, SectionLabel} from '../components/ui';

const PANEL_HEIGHT = 230;
const OCTAVES = 2;

export function ScaleScreen() {
  const {timeline, prefs} = useStore();
  const instrument = useInstrument();
  const [scaleIdx, setScaleIdx] = useState(0);
  const playing = useTransportState();

  const options = useMemo(() => (timeline ? relatedScales(timeline.key) : []), [timeline]);
  const scale = options[Math.min(scaleIdx, options.length - 1)] ?? {tonicPc: 0, scale: 'major' as const};

  // Centre the pads on wherever the melody actually sits.
  const baseOctave = useMemo(() => {
    if (!timeline?.melodyRange) return 4;
    const low = timeline.melodyRange[0];
    return Math.max(2, Math.min(6, Math.floor(low / 12) - 1));
  }, [timeline]);

  const flats = timeline ? preferFlatsFor(timeline.key) : false;
  const degreeCount = SCALES[scale.scale].intervals.length;
  const cols = Math.min(8, degreeCount + 1);

  const ascending = useMemo(() => {
    const out: {midi: number; degree: string}[] = [];
    const total = degreeCount * OCTAVES + 1;
    for (let i = 0; i < total; i++) {
      out.push({midi: scaleDegreeMidi(scale, i, baseOctave), degree: SCALES[scale.scale].degrees[i % degreeCount]});
    }
    return out;
  }, [scale, degreeCount, baseOctave]);

  const [chordTones, setChordTones] = useState<number[]>([]);

  const items = useMemo<PadItem[]>(() => {
    const pads = ascending.map((entry) => ({
      label: midiLabel(entry.midi, flats),
      sub: entry.degree,
      notes: [entry.midi],
      hold: true,
      root: chordTones.length > 0 && chordTones.includes(mod12(entry.midi)),
    }));
    // Pads fill top-to-bottom, so reverse the rows to put low notes at the
    // bottom where a keyboard would have them.
    const rows: PadItem[][] = [];
    for (let i = 0; i < pads.length; i += cols) rows.push(pads.slice(i, i + cols));
    return rows.reverse().flat();
  }, [ascending, flats, cols, chordTones]);

  useInstrumentSurface(
    useMemo(() => ({mode: 'pads' as const, items, cols}), [items, cols]),
    PANEL_HEIGHT,
  );

  const backing = useCallback(() => {
    if (!timeline) return;
    if (playing) {
      instrument.stop();
      setChordTones([]);
      return;
    }
    const span = sectionSpan(timeline, null);
    instrument.setGain('chords', 1);
    instrument.play({
      events: chordEvents(timeline, 'bar', span),
      tempo: effectiveTempo(timeline, prefs.tempoScale),
      loop: true,
      loopStart: span.start,
      loopEnd: span.end,
      beatsPerBar: timeline.beatsPerBar,
      countIn: timeline.beatsPerBar,
    });
  }, [timeline, playing, instrument, prefs.tempoScale]);

  if (!timeline) return <Empty title="Pick a song first" hint="Find one on the Song tab." />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={type.title}>Scale keyboard</Text>
        <Text style={type.dim}>
          Only notes in the scale. Hold a pad to sustain; slide between pads to phrase.
        </Text>
      </View>

      <Card>
        <SectionLabel right={<Text style={styles.scaleName}>{keyLabel(scale)}</Text>}>Scale</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scaleRow}>
          {options.map((option, i) => (
            <ScalePill
              key={`${option.tonicPc}-${option.scale}`}
              option={option}
              active={i === Math.min(scaleIdx, options.length - 1)}
              onPress={() => setScaleIdx(i)}
            />
          ))}
        </ScrollView>
        <Text style={styles.notes}>
          {ascending
            .slice(0, degreeCount)
            .map((e) => midiLabel(e.midi, flats))
            .join('  ')}
        </Text>
      </Card>

      <Card>
        <SectionLabel>Backing</SectionLabel>
        <Row gap={space.md}>
          <RoundButton label={playing ? '■' : '▶'} onPress={backing} active={playing} size={46} />
          <Text style={[type.dim, styles.flex]}>
            Loops the chord progression. Pads outlined in orange are chord tones right now.
          </Text>
        </Row>
        {playing ? <ChordWatch timeline={timeline} onChordTones={setChordTones} /> : null}
      </Card>
    </ScrollView>
  );
}

/** Tracks the backing chord so the pads can show which notes are consonant. */
function ChordWatch({timeline, onChordTones}: {timeline: Timeline; onChordTones: (pcs: number[]) => void}) {
  const beat = usePlayhead();
  const lastIndex = useRef(-2);
  const index = findChordIndexAt(timeline, beat);
  const chord = index >= 0 ? timeline.chords[index] : null;

  useEffect(() => {
    if (index === lastIndex.current) return;
    lastIndex.current = index;
    onChordTones(chord ? chordPcs(chord.chord) : []);
  }, [index, chord, onChordTones]);

  return (
    <Row gap={space.sm}>
      <Text style={type.tiny}>OVER</Text>
      <Text style={styles.overChord}>{chord ? chord.symbol : '·'}</Text>
    </Row>
  );
}

function ScalePill({option, active, onPress}: {option: Key; active: boolean; onPress: () => void}) {
  return (
    <Text onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      {keyLabel(option)}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  content: {padding: space.lg, gap: space.md, paddingBottom: space.lg},
  flex: {flex: 1},
  scaleRow: {gap: 6},
  scaleName: {color: colors.accent, fontSize: 12, fontWeight: '700'},
  pill: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  pillActive: {color: '#1a1405', backgroundColor: colors.accent, borderColor: colors.accent},
  notes: {color: colors.text, fontSize: 15, fontWeight: '700', letterSpacing: 1},
  overChord: {color: colors.chords, fontSize: 18, fontWeight: '800'},
});

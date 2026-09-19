import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';

import {PadItem, useInstrument, useInstrumentSurface, useTransportState} from '../audio/InstrumentProvider';
import {voiceChord} from '../music/chords';
import {effectiveTempo, melodyEvents, sectionSpan} from '../music/playback';
import {uniqueChords} from '../music/song';
import {keyLabel, preferFlatsFor, romanNumeral} from '../music/scales';
import {useStore} from '../state/store';
import {colors, space, type} from '../theme';
import {Card, Empty, Row, RoundButton, SectionLabel, Segmented, Toggle} from '../components/ui';

const PANEL_HEIGHT = 260;

export function PaletteScreen() {
  const {timeline, prefs, updatePrefs} = useStore();
  const instrument = useInstrument();
  const [strum, setStrum] = useState(true);
  const [voicing, setVoicing] = useState<'close' | 'open'>('close');
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const playing = useTransportState();

  const chords = useMemo(() => (timeline ? uniqueChords(timeline) : []), [timeline]);

  const items = useMemo<PadItem[]>(() => {
    if (!timeline) return [];
    return chords.map((chord) => {
      const voiced = voiceChord(chord.chord, voicing === 'open' ? 55 : 60);
      const notes = voicing === 'open' ? spread(voiced.midi) : voiced.midi;
      return {
        label: chord.symbol,
        sub: romanNumeral(timeline.key, chord.chord),
        notes,
        root: chord.chord.rootPc === timeline.key.tonicPc,
        strum: strum ? 0.022 : 0,
        dur: 1.6,
      };
    });
  }, [chords, timeline, strum, voicing]);

  const cols = items.length <= 4 ? 2 : items.length <= 9 ? 3 : 4;

  useInstrumentSurface(
    useMemo(() => ({mode: 'pads' as const, items, cols}), [items, cols]),
    PANEL_HEIGHT,
  );

  useEffect(
    () =>
      instrument.onPad((index) => {
        setLastPlayed(items[index]?.label ?? null);
      }),
    [instrument, items],
  );

  useEffect(() => {
    instrument.setGain('click', prefs.clickOn ? 0.8 : 0);
  }, [instrument, prefs.clickOn]);

  const backing = useCallback(() => {
    if (!timeline) return;
    if (playing) {
      instrument.stop();
      return;
    }
    const span = sectionSpan(timeline, null);
    instrument.setGain('melody', 1);
    instrument.play({
      events: melodyEvents(timeline, span),
      tempo: effectiveTempo(timeline, prefs.tempoScale),
      loop: true,
      loopStart: span.start,
      loopEnd: span.end,
      beatsPerBar: timeline.beatsPerBar,
      countIn: timeline.beatsPerBar,
    });
  }, [timeline, playing, instrument, prefs.tempoScale]);

  if (!timeline) return <Empty title="Pick a song first" hint="Find one on the Song tab." />;
  if (items.length === 0) return <Empty title="This song has no chords to jam on" />;

  const flats = preferFlatsFor(timeline.key);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={type.title}>Chord palette</Text>
        <Text style={type.dim}>
          {timeline.song.title} · {keyLabel(timeline.key)}
        </Text>
      </View>

      <Card>
        <SectionLabel right={lastPlayed ? <Text style={styles.last}>{lastPlayed}</Text> : null}>Feel</SectionLabel>
        <Row gap={space.xs} style={styles.wrap}>
          <Toggle label="Strum" value={strum} onChange={setStrum} />
          <Toggle label="Click" value={prefs.clickOn} onChange={(v) => updatePrefs({clickOn: v})} />
        </Row>
        <Segmented
          options={[
            {value: 'close', label: 'Close voicing'},
            {value: 'open', label: 'Open voicing'},
          ]}
          value={voicing}
          onChange={(v) => setVoicing(v as 'close' | 'open')}
        />
      </Card>

      <Card>
        <SectionLabel>Backing</SectionLabel>
        <Row gap={space.md}>
          <RoundButton label={playing ? '■' : '▶'} onPress={backing} active={playing} size={46} />
          <Text style={[type.dim, styles.flex]}>
            Loops the melody so you can comp the chords underneath it.
          </Text>
        </Row>
      </Card>

      <Card>
        <SectionLabel>In this song</SectionLabel>
        {chords.map((chord) => (
          <Row key={chord.symbol} style={styles.chordRow}>
            <Text style={styles.chordName}>{chord.symbol}</Text>
            <Text style={styles.chordRoman}>{romanNumeral(timeline.key, chord.chord)}</Text>
            <Text style={[type.dim, styles.flex]} numberOfLines={1}>
              {voiceChord(chord.chord, 60)
                .midi.map((m, i) => `${noteName(m, flats)} ${chord.chord.degrees[i] ?? ''}`.trim())
                .join(' · ')}
            </Text>
          </Row>
        ))}
      </Card>
    </ScrollView>
  );
}

/** Drops the third an octave for a wider, less muddy voicing. */
function spread(midi: number[]): number[] {
  if (midi.length < 3) return midi;
  const [root, third, ...rest] = midi;
  return [root, ...rest, third + 12].sort((a, b) => a - b);
}

function noteName(midi: number, flats: boolean): string {
  const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  return (flats ? flat : sharp)[((midi % 12) + 12) % 12];
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  content: {padding: space.lg, gap: space.md, paddingBottom: space.lg},
  wrap: {flexWrap: 'wrap'},
  flex: {flex: 1},
  last: {color: colors.accent, fontSize: 14, fontWeight: '700'},
  chordRow: {gap: space.sm},
  chordName: {color: colors.text, fontSize: 15, fontWeight: '700', width: 68},
  chordRoman: {color: colors.chords, fontSize: 12, fontWeight: '700', width: 52},
});

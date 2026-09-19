import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {activateKeepAwakeAsync, deactivateKeepAwake} from 'expo-keep-awake';

import {
  useInstrument,
  useInstrumentSurface,
  usePlayhead,
  useTransportState,
} from '../audio/InstrumentProvider';
import {chordPcs} from '../music/chords';
import {comfortableKeyWidth, keyboardRange} from '../music/keyboard';
import {midiLabel} from '../music/notes';
import {ChordPattern, chordEvents, effectiveTempo, findChordIndexAt, findMelodyIndexAt, melodyEvents, sectionSpan} from '../music/playback';
import {Timeline} from '../music/song';
import {degreeOf, keyLabel, preferFlatsFor} from '../music/scales';
import {useStore} from '../state/store';
import {colors, radius, space, type} from '../theme';
import {Card, Empty, Row, SectionLabel, Segmented} from '../components/ui';
import {Transport} from '../components/Transport';

const PANEL_HEIGHT = 208;

export function PlayScreen() {
  const {timeline, prefs, updatePrefs} = useStore();
  const instrument = useInstrument();
  const {width} = useWindowDimensions();
  const [sectionIndex, setSectionIndex] = useState<number | null>(null);
  const [pattern, setPattern] = useState<ChordPattern>('bar');
  const playing = useTransportState();

  const span = useMemo(
    () => (timeline ? sectionSpan(timeline, sectionIndex) : {start: 0, end: 0}),
    [timeline, sectionIndex],
  );

  const range = useMemo(() => {
    if (!timeline) return {low: 48, high: 83};
    const notes = [
      ...timeline.chords.flatMap((c) => c.midi),
      ...timeline.melody.filter((m) => m.midi != null).map((m) => m.midi!),
    ];
    return keyboardRange(notes, 3);
  }, [timeline]);

  const flats = timeline ? preferFlatsFor(timeline.key) : false;
  const keyWidth = comfortableKeyWidth(range, width, prefs.keyWidth);

  useInstrumentSurface(
    useMemo(
      () => ({mode: 'piano' as const, low: range.low, high: range.high, keyWidth, labels: 'white' as const, flats}),
      [range.low, range.high, keyWidth, flats],
    ),
    PANEL_HEIGHT,
  );

  // Part toggles take effect through channel gain, so they can be flipped
  // mid-playback without rescheduling anything.
  useEffect(() => {
    instrument.setGain('chords', prefs.chordsOn ? 1 : 0);
  }, [instrument, prefs.chordsOn]);
  useEffect(() => {
    instrument.setGain('melody', prefs.melodyOn ? 1 : 0);
  }, [instrument, prefs.melodyOn]);
  useEffect(() => {
    instrument.setGain('click', prefs.clickOn ? 0.8 : 0);
  }, [instrument, prefs.clickOn]);

  const bpm = timeline ? effectiveTempo(timeline, prefs.tempoScale) : 100;
  useEffect(() => {
    instrument.setTempo(bpm);
  }, [instrument, bpm]);

  useEffect(() => {
    if (!playing) return;
    activateKeepAwakeAsync('practice').catch(() => {});
    return () => {
      deactivateKeepAwake('practice').catch(() => {});
    };
  }, [playing]);

  const start = useCallback(() => {
    if (!timeline) return;
    instrument.play({
      events: [...chordEvents(timeline, pattern, span), ...melodyEvents(timeline, span)],
      tempo: bpm,
      loop: prefs.loop,
      loopStart: span.start,
      loopEnd: span.end,
      beatsPerBar: timeline.beatsPerBar,
      countIn: prefs.countIn ? timeline.beatsPerBar : 0,
    });
  }, [instrument, timeline, pattern, span, bpm, prefs.loop, prefs.countIn]);

  const toggle = useCallback(() => {
    if (playing) instrument.stop();
    else start();
  }, [playing, instrument, start]);

  // Restarting on a settings change would be jarring; stop instead.
  useEffect(() => {
    instrument.stop();
  }, [instrument, sectionIndex, pattern]);

  if (!timeline) return <Empty title="Pick a song first" hint="Find one on the Song tab." />;

  const sectionOptions: {value: string; label: string}[] = [
    {value: 'all', label: 'Whole song'},
    ...timeline.sections.map((s) => ({value: String(s.index), label: s.name})),
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={type.title} numberOfLines={1}>
          {timeline.song.title}
        </Text>
        <Text style={type.dim} numberOfLines={1}>
          {timeline.song.artist} · {keyLabel(timeline.key)} · {timeline.song.timeSignature.join('/')}
        </Text>
      </View>

      {sectionOptions.length > 1 ? (
        <Segmented
          options={sectionOptions}
          value={sectionIndex == null ? 'all' : String(sectionIndex)}
          onChange={(v) => setSectionIndex(v === 'all' ? null : Number(v))}
        />
      ) : null}

      <Transport
        playing={playing}
        onToggle={toggle}
        bpm={bpm}
        tempoScale={prefs.tempoScale}
        onTempoScale={(v) => updatePrefs({tempoScale: v})}
        toggles={[
          {label: 'Chords', value: prefs.chordsOn, onChange: (v) => updatePrefs({chordsOn: v}), tint: colors.chords},
          {label: 'Melody', value: prefs.melodyOn, onChange: (v) => updatePrefs({melodyOn: v}), tint: colors.melody},
          {label: 'Click', value: prefs.clickOn, onChange: (v) => updatePrefs({clickOn: v})},
          {label: 'Loop', value: prefs.loop, onChange: (v) => updatePrefs({loop: v})},
          {label: 'Count-in', value: prefs.countIn, onChange: (v) => updatePrefs({countIn: v})},
        ]}
      />

      <Card>
        <SectionLabel>Chord rhythm</SectionLabel>
        <Segmented
          options={[
            {value: 'sustain', label: 'Hold'},
            {value: 'bar', label: 'Per bar'},
            {value: 'beat', label: 'Per beat'},
          ]}
          value={pattern}
          onChange={(v) => setPattern(v as ChordPattern)}
        />
        <Text style={styles.hint}>
          Turn off a part to play it yourself while the rest keeps going.
        </Text>
      </Card>

      <Follow timeline={timeline} playing={playing} span={span} />
    </ScrollView>
  );
}

/**
 * Everything that changes with the playhead lives here, so the ~18 position
 * updates a second do not re-render the controls above.
 */
function Follow({timeline, playing, span}: {timeline: Timeline; playing: boolean; span: {start: number; end: number}}) {
  const beat = usePlayhead();
  const instrument = useInstrument();
  const laneRef = useRef<ScrollView>(null);
  const lastChord = useRef(-2);
  const lastMelody = useRef(-2);

  const chordIndex = playing ? findChordIndexAt(timeline, beat) : -1;
  const melodyIndex = playing ? findMelodyIndexAt(timeline, beat) : -1;
  const flats = preferFlatsFor(timeline.key);

  // Follow the chord: recolour its tones and slide the keybed to reach them.
  useEffect(() => {
    if (chordIndex === lastChord.current) return;
    lastChord.current = chordIndex;
    const chord = chordIndex >= 0 ? timeline.chords[chordIndex] : null;
    if (!chord) {
      instrument.update({highlight: {}, degrees: {}, focus: []});
      return;
    }
    const highlight: Record<number, string> = {};
    const degrees: Record<number, string> = {};
    for (const pc of chordPcs(chord.chord)) {
      for (let m = 24; m <= 108; m++) {
        if (m % 12 === pc) highlight[m] = pc === chord.chord.rootPc ? 'root' : 'on';
      }
    }
    for (const [i, midi] of chord.midi.entries()) degrees[midi] = chord.chord.degrees[i] ?? '';
    instrument.update({highlight, degrees, focus: chord.midi});
  }, [chordIndex, timeline, instrument]);

  // Light the melody note as it sounds.
  useEffect(() => {
    if (melodyIndex === lastMelody.current) return;
    lastMelody.current = melodyIndex;
    const note = melodyIndex >= 0 ? timeline.melody[melodyIndex] : null;
    instrument.flash(note?.midi != null ? [note.midi] : null);
  }, [melodyIndex, timeline, instrument]);

  useEffect(() => {
    if (chordIndex < 0) return;
    laneRef.current?.scrollTo({x: Math.max(0, chordIndex * 78 - 90), animated: true});
  }, [chordIndex]);

  const current = chordIndex >= 0 ? timeline.chords[chordIndex] : null;
  const currentNote = melodyIndex >= 0 ? timeline.melody[melodyIndex] : null;
  const nextNote = melodyIndex >= 0 ? timeline.melody[melodyIndex + 1] : null;
  const bar = Math.floor((beat - span.start) / timeline.beatsPerBar) + 1;
  const beatInBar = Math.floor((beat - span.start) % timeline.beatsPerBar) + 1;

  return (
    <>
      <Card>
        <SectionLabel
          right={
            <Text style={type.mono}>
              {playing ? `bar ${bar}.${beatInBar}` : `${timeline.chords.length} chords`}
            </Text>
          }>
          Chords
        </SectionLabel>
        <ScrollView ref={laneRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.lane}>
          {timeline.chords.map((chord, i) => (
            <View key={i} style={[styles.chordChip, i === chordIndex && styles.chordChipActive]}>
              <Text style={[styles.chordChipText, i === chordIndex && styles.chordChipTextActive]}>{chord.symbol}</Text>
              <Text style={[styles.chordChipBeats, i === chordIndex && styles.chordChipBeatsActive]}>
                {chord.beats}
              </Text>
            </View>
          ))}
        </ScrollView>
      </Card>

      <Card>
        <SectionLabel>Melody</SectionLabel>
        <Row gap={space.lg}>
          <View style={styles.noteBox}>
            <Text style={type.tiny}>NOW</Text>
            <Text style={styles.noteBig}>
              {currentNote ? (currentNote.midi != null ? midiLabel(currentNote.midi, flats) : '—') : '·'}
            </Text>
            {currentNote?.lyric ? <Text style={styles.lyric}>{currentNote.lyric}</Text> : null}
          </View>
          <View style={styles.noteBox}>
            <Text style={type.tiny}>NEXT</Text>
            <Text style={styles.noteNext}>
              {nextNote ? (nextNote.midi != null ? midiLabel(nextNote.midi, flats) : 'rest') : '·'}
            </Text>
            {nextNote?.lyric ? <Text style={styles.lyric}>{nextNote.lyric}</Text> : null}
          </View>
          <View style={[styles.noteBox, styles.noteGrow]}>
            <Text style={type.tiny}>OVER</Text>
            <Text style={styles.overChord}>{current ? current.symbol : '·'}</Text>
            {current && currentNote?.midi != null ? (
              <Text style={styles.lyric}>
                {degreeOf(timeline.key, currentNote.midi % 12)
                  ? `scale degree ${degreeOf(timeline.key, currentNote.midi % 12)}`
                  : 'outside the scale'}
              </Text>
            ) : null}
          </View>
        </Row>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  content: {padding: space.lg, gap: space.md, paddingBottom: space.lg},
  header: {gap: 2},
  hint: {...type.dim, color: colors.textFaint},
  lane: {gap: 6, paddingVertical: 2},
  chordChip: {
    minWidth: 72,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  chordChipActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  chordChipText: {color: colors.text, fontSize: 16, fontWeight: '700'},
  chordChipTextActive: {color: '#1a1405'},
  chordChipBeats: {color: colors.textFaint, fontSize: 10, fontWeight: '600'},
  chordChipBeatsActive: {color: '#5a4712'},
  noteBox: {gap: 2},
  noteGrow: {flex: 1},
  noteBig: {color: colors.melody, fontSize: 26, fontWeight: '800'},
  noteNext: {color: colors.textDim, fontSize: 20, fontWeight: '700'},
  overChord: {color: colors.chords, fontSize: 22, fontWeight: '800'},
  lyric: {...type.dim, color: colors.textFaint, fontSize: 11},
});

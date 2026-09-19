/** Turns a timeline into sequencer events for the instrument engine. */
import {SeqEvent} from '../audio/InstrumentProvider';
import {ChordEvent, Timeline} from './song';

export type ChordPattern = 'sustain' | 'bar' | 'beat';

export type PlaySpan = {start: number; end: number};

/** Beat range of a section, or the whole song when sectionIndex is null. */
export function sectionSpan(timeline: Timeline, sectionIndex: number | null): PlaySpan {
  if (sectionIndex == null) return {start: 0, end: Math.max(timeline.totalBeats, timeline.beatsPerBar)};
  const section = timeline.sections[sectionIndex];
  if (!section) return {start: 0, end: Math.max(timeline.totalBeats, timeline.beatsPerBar)};
  return {start: section.startBeat, end: section.startBeat + section.beats};
}

/**
 * Chord track. A long chord is re-struck rather than held for its whole length,
 * because a sustained sixteen-beat chord gives you nothing to play against.
 */
export function chordEvents(timeline: Timeline, pattern: ChordPattern = 'bar', span?: PlaySpan): SeqEvent[] {
  const bpb = timeline.beatsPerBar;
  const events: SeqEvent[] = [];
  for (const chord of timeline.chords) {
    if (span && (chord.startBeat >= span.end || chord.startBeat + chord.beats <= span.start)) continue;
    const step = pattern === 'beat' ? 1 : pattern === 'bar' ? bpb : chord.beats;
    for (let offset = 0; offset < chord.beats - 0.001; offset += step) {
      const beat = chord.startBeat + offset;
      if (span && (beat < span.start || beat >= span.end)) continue;
      const length = Math.min(step, chord.beats - offset);
      for (const [i, midi] of chord.midi.entries()) {
        events.push({
          b: beat,
          d: Math.max(0.25, length * 0.92),
          m: midi,
          c: 'chords',
          // Lean on the bass note a little and thin out the upper extensions.
          v: i === 0 ? 1 : Math.max(0.5, 0.95 - i * 0.07),
        });
      }
    }
  }
  return events;
}

export function melodyEvents(timeline: Timeline, span?: PlaySpan): SeqEvent[] {
  const events: SeqEvent[] = [];
  for (const note of timeline.melody) {
    if (note.midi == null) continue;
    if (span && (note.startBeat < span.start || note.startBeat >= span.end)) continue;
    events.push({b: note.startBeat, d: Math.max(0.2, note.beats * 0.92), m: note.midi, c: 'melody', v: 1});
  }
  return events;
}

/** The chord playing at `beat`, searching only forward from a cached index. */
export function findChordAt(timeline: Timeline, beat: number): ChordEvent | null {
  for (const chord of timeline.chords) {
    if (beat >= chord.startBeat && beat < chord.startBeat + chord.beats) return chord;
  }
  return null;
}

export function findChordIndexAt(timeline: Timeline, beat: number): number {
  for (let i = 0; i < timeline.chords.length; i++) {
    const c = timeline.chords[i];
    if (beat >= c.startBeat && beat < c.startBeat + c.beats) return i;
  }
  return -1;
}

export function findMelodyIndexAt(timeline: Timeline, beat: number): number {
  for (let i = 0; i < timeline.melody.length; i++) {
    const m = timeline.melody[i];
    if (beat >= m.startBeat && beat < m.startBeat + m.beats) return i;
  }
  return -1;
}

/** Playback tempo after applying the practice speed multiplier. */
export function effectiveTempo(timeline: Timeline, scale: number): number {
  return Math.round(Math.min(260, Math.max(30, timeline.song.tempo * scale)));
}

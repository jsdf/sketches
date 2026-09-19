/** The song model the whole app practises against, plus timeline derivation. */
import {Chord, parseChord, voiceChord} from './chords';
import {clamp, parseNote} from './notes';
import {inferKey, Key, parseKey} from './scales';

export type RawChord = {
  /** Chord symbol as written, e.g. `Am7`. */
  symbol: string;
  /** Length in beats. */
  beats: number;
};

export type RawNote = {
  /** Scientific pitch name (`C4`, `F#5`) or null for a rest. */
  note: string | null;
  beats: number;
  lyric?: string;
};

export type RawSection = {
  name: string;
  chords: RawChord[];
  melody: RawNote[];
};

export type SongSource = {
  urls: string[];
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  keyText: string;
  tempo: number;
  timeSignature: [number, number];
  sections: RawSection[];
  source?: SongSource;
  createdAt: number;
  /** True for the songs bundled with the app. */
  builtIn?: boolean;
};

export type ChordEvent = {
  index: number;
  sectionIndex: number;
  chord: Chord;
  symbol: string;
  startBeat: number;
  beats: number;
  /** Voiced notes used for playback and keyboard highlighting. */
  midi: number[];
};

export type MelodyEvent = {
  index: number;
  sectionIndex: number;
  midi: number | null;
  name: string | null;
  lyric?: string;
  startBeat: number;
  beats: number;
};

export type SectionSpan = {
  index: number;
  name: string;
  startBeat: number;
  beats: number;
};

export type Timeline = {
  song: Song;
  key: Key;
  chords: ChordEvent[];
  melody: MelodyEvent[];
  sections: SectionSpan[];
  totalBeats: number;
  beatsPerBar: number;
  /** Lowest and highest melody note, for sizing the keyboard. */
  melodyRange: [number, number] | null;
};

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const CHORD_CENTER = 60; // voicings sit around middle C

/**
 * Expands a song into absolute-beat chord and melody events. Chords and melody
 * are laid out per section: within a section both start at the section's first
 * beat, and the section is as long as its longer part.
 */
export function buildTimeline(song: Song): Timeline {
  const beatsPerBar = song.timeSignature?.[0] || 4;
  const chords: ChordEvent[] = [];
  const melody: MelodyEvent[] = [];
  const sections: SectionSpan[] = [];

  let cursor = 0;
  song.sections.forEach((section, sectionIndex) => {
    const sectionStart = cursor;
    let chordBeat = sectionStart;
    for (const raw of section.chords ?? []) {
      const chord = parseChord(raw.symbol);
      if (!chord) continue;
      const beats = sanitizeBeats(raw.beats, beatsPerBar);
      chords.push({
        index: chords.length,
        sectionIndex,
        chord,
        symbol: chord.symbol,
        startBeat: chordBeat,
        beats,
        midi: voiceChord(chord, CHORD_CENTER).midi,
      });
      chordBeat += beats;
    }

    let melodyBeat = sectionStart;
    for (const raw of section.melody ?? []) {
      const beats = sanitizeBeats(raw.beats, beatsPerBar);
      const midi = raw.note ? parseNote(raw.note) : null;
      melody.push({
        index: melody.length,
        sectionIndex,
        midi: midi == null ? null : clamp(midi, 24, 108),
        name: raw.note ?? null,
        lyric: raw.lyric,
        startBeat: melodyBeat,
        beats,
      });
      melodyBeat += beats;
    }

    const sectionBeats = Math.max(chordBeat - sectionStart, melodyBeat - sectionStart, beatsPerBar);
    sections.push({index: sectionIndex, name: section.name || `Section ${sectionIndex + 1}`, startBeat: sectionStart, beats: sectionBeats});
    cursor = sectionStart + sectionBeats;
  });

  const keyFromText = parseKey(song.keyText);
  const key = keyFromText ?? inferKey(chords.map((c) => ({chord: c.chord, beats: c.beats})));

  const sounded = melody.filter((m) => m.midi != null).map((m) => m.midi!);
  const melodyRange: [number, number] | null = sounded.length
    ? [Math.min(...sounded), Math.max(...sounded)]
    : null;

  return {song, key, chords, melody, sections, totalBeats: cursor, beatsPerBar, melodyRange};
}

function sanitizeBeats(beats: number, beatsPerBar: number): number {
  if (!Number.isFinite(beats) || beats <= 0) return 1;
  return Math.min(beats, beatsPerBar * 8);
}

/** Chord sounding at a given beat. */
export function chordAtBeat(timeline: Timeline, beat: number): ChordEvent | null {
  for (const c of timeline.chords) {
    if (beat >= c.startBeat && beat < c.startBeat + c.beats) return c;
  }
  return null;
}

export function melodyAtBeat(timeline: Timeline, beat: number): MelodyEvent | null {
  for (const m of timeline.melody) {
    if (beat >= m.startBeat && beat < m.startBeat + m.beats) return m;
  }
  return null;
}

export function eventsInSection<T extends {sectionIndex: number}>(events: T[], sectionIndex: number | null): T[] {
  return sectionIndex == null ? events : events.filter((e) => e.sectionIndex === sectionIndex);
}

/** Distinct chords in the song, most used first — the palette's pad list. */
export function uniqueChords(timeline: Timeline): ChordEvent[] {
  const seen = new Map<string, {event: ChordEvent; beats: number}>();
  for (const c of timeline.chords) {
    const entry = seen.get(c.symbol);
    if (entry) entry.beats += c.beats;
    else seen.set(c.symbol, {event: c, beats: c.beats});
  }
  return [...seen.values()].sort((a, b) => b.beats - a.beats).map((e) => e.event);
}

/** Chords in the order they first appear — the order to learn shapes in. */
export function chordsInOrder(timeline: Timeline): ChordEvent[] {
  const seen = new Set<string>();
  const out: ChordEvent[] = [];
  for (const c of timeline.chords) {
    if (seen.has(c.symbol)) continue;
    seen.add(c.symbol);
    out.push(c);
  }
  return out;
}

export function barOf(beat: number, beatsPerBar: number): number {
  return Math.floor(beat / beatsPerBar) + 1;
}

export function formatBeat(beat: number, beatsPerBar: number): string {
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const b = Math.floor(beat % beatsPerBar) + 1;
  return `${bar}.${b}`;
}

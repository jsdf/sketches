/** Scales, key inference and roman numeral analysis. */
import {Chord, chordPcs} from './chords';
import {mod12, parsePitchClass, Pc, pcName} from './notes';

export type ScaleName =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'chromatic';

export type ScaleDef = {
  label: string;
  intervals: number[];
  /** Degree names lined up with `intervals`. */
  degrees: string[];
};

export const SCALES: Record<ScaleName, ScaleDef> = {
  major: {label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11], degrees: ['1', '2', '3', '4', '5', '6', '7']},
  minor: {label: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10], degrees: ['1', '2', 'b3', '4', '5', 'b6', 'b7']},
  dorian: {label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], degrees: ['1', '2', 'b3', '4', '5', '6', 'b7']},
  phrygian: {label: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10], degrees: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7']},
  lydian: {label: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11], degrees: ['1', '2', '3', '#4', '5', '6', '7']},
  mixolydian: {label: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], degrees: ['1', '2', '3', '4', '5', '6', 'b7']},
  locrian: {label: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10], degrees: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7']},
  harmonicMinor: {
    label: 'Harmonic minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    degrees: ['1', '2', 'b3', '4', '5', 'b6', '7'],
  },
  melodicMinor: {
    label: 'Melodic minor',
    intervals: [0, 2, 3, 5, 7, 9, 11],
    degrees: ['1', '2', 'b3', '4', '5', '6', '7'],
  },
  majorPentatonic: {label: 'Major pentatonic', intervals: [0, 2, 4, 7, 9], degrees: ['1', '2', '3', '5', '6']},
  minorPentatonic: {label: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10], degrees: ['1', 'b3', '4', '5', 'b7']},
  blues: {label: 'Blues', intervals: [0, 3, 5, 6, 7, 10], degrees: ['1', 'b3', '4', 'b5', '5', 'b7']},
  chromatic: {
    label: 'Chromatic',
    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    degrees: ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'],
  },
};

export type Key = {tonicPc: Pc; scale: ScaleName};

export function keyLabel(key: Key): string {
  return `${pcName(key.tonicPc, preferFlatsFor(key))} ${SCALES[key.scale].label.toLowerCase()}`;
}

const FLAT_KEYS_MAJOR = new Set([1, 3, 5, 8, 10]); // Db, Eb, F, Ab, Bb
const FLAT_KEYS_MINOR = new Set([0, 2, 5, 7, 10]); // C, D, F, G, Bb minor

/** Whether note names in this key read better with flats. */
export function preferFlatsFor(key: Key): boolean {
  const minorish = key.scale !== 'major' && key.scale !== 'lydian' && key.scale !== 'majorPentatonic';
  return minorish ? FLAT_KEYS_MINOR.has(key.tonicPc) : FLAT_KEYS_MAJOR.has(key.tonicPc);
}

export function scalePcs(key: Key): Pc[] {
  return SCALES[key.scale].intervals.map((i) => mod12(key.tonicPc + i));
}

/** Degree label for a pitch class, or null when it is outside the scale. */
export function degreeOf(key: Key, pc: Pc): string | null {
  const idx = SCALES[key.scale].intervals.indexOf(mod12(pc - key.tonicPc));
  return idx === -1 ? null : SCALES[key.scale].degrees[idx];
}

export function inScale(key: Key, pc: Pc): boolean {
  return SCALES[key.scale].intervals.includes(mod12(pc - key.tonicPc));
}

/** Ascending MIDI notes of the scale between `low` and `high` inclusive. */
export function scaleNotes(key: Key, low: number, high: number): number[] {
  const pcs = new Set(scalePcs(key));
  const out: number[] = [];
  for (let m = low; m <= high; m++) if (pcs.has(mod12(m))) out.push(m);
  return out;
}

/** The scale note at `index` steps above the tonic in octave `octave`. */
export function scaleDegreeMidi(key: Key, index: number, baseOctave: number): number {
  const ivs = SCALES[key.scale].intervals;
  const n = ivs.length;
  const octShift = Math.floor(index / n);
  const iv = ivs[((index % n) + n) % n];
  return (baseOctave + 1) * 12 + key.tonicPc + iv + octShift * 12;
}

/** Parses `"C major"`, `"f# minor"`, `"Bb mixolydian"` or just `"Am"`. */
export function parseKey(text: string | null | undefined): Key | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/\s+/g, ' ');
  const m = /^([A-Ga-g][#b♯♭]?)\s*(.*)$/.exec(cleaned);
  if (!m) return null;
  const tonicPc = parsePitchClass(m[1]);
  if (tonicPc == null) return null;
  const rest = m[2].toLowerCase().replace(/[^a-z]/g, '');
  const table: [string, ScaleName][] = [
    ['harmonicminor', 'harmonicMinor'],
    ['melodicminor', 'melodicMinor'],
    ['majorpentatonic', 'majorPentatonic'],
    ['minorpentatonic', 'minorPentatonic'],
    ['mixolydian', 'mixolydian'],
    ['phrygian', 'phrygian'],
    ['dorian', 'dorian'],
    ['lydian', 'lydian'],
    ['locrian', 'locrian'],
    ['blues', 'blues'],
    ['minor', 'minor'],
    ['min', 'minor'],
    ['maj', 'major'],
    ['major', 'major'],
    ['m', 'minor'],
    ['', 'major'],
  ];
  for (const [needle, scale] of table) {
    if (needle === '' || rest.startsWith(needle)) return {tonicPc, scale};
  }
  return {tonicPc, scale: 'major'};
}

/**
 * Guesses the key from a chord progression. Used when the song data has no key,
 * or as a sanity check on one that does.
 */
export function inferKey(chords: {chord: Chord; beats: number}[]): Key {
  if (chords.length === 0) return {tonicPc: 0, scale: 'major'};
  const totalBeats = chords.reduce((a, c) => a + c.beats, 0) || 1;
  const weight = new Array(12).fill(0);
  const rootWeight = new Array(12).fill(0);
  for (const {chord, beats} of chords) {
    const w = beats / totalBeats;
    rootWeight[chord.rootPc] += w;
    for (const pc of chordPcs(chord)) weight[pc] += w;
  }

  let best: {key: Key; score: number} | null = null;
  for (const scale of ['major', 'minor'] as ScaleName[]) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const key: Key = {tonicPc: tonic, scale};
      const pcs = new Set(scalePcs(key));
      let score = 0;
      for (let pc = 0; pc < 12; pc++) score += pcs.has(pc) ? weight[pc] : -weight[pc] * 1.4;
      // Tonic and dominant chords carry most of the signal about a key.
      score += rootWeight[tonic] * 1.5;
      score += rootWeight[mod12(tonic + 7)] * 0.6;
      score += rootWeight[mod12(tonic + 5)] * 0.4;
      if (chords[0].chord.rootPc === tonic) score += 0.35;
      if (chords[chords.length - 1].chord.rootPc === tonic) score += 0.45;
      if (!best || score > best.score) best = {key, score};
    }
  }
  return best!.key;
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Roman numeral for a chord in a key, e.g. `ii7`, `V7`, `bVII`. */
export function romanNumeral(key: Key, chord: Chord): string {
  const majorIntervals = SCALES[key.scale === 'minor' ? 'minor' : 'major'].intervals;
  const rel = mod12(chord.rootPc - key.tonicPc);
  let idx = majorIntervals.indexOf(rel);
  let accidental = '';
  if (idx === -1) {
    idx = majorIntervals.indexOf(mod12(rel - 1));
    if (idx !== -1) accidental = '#';
    else {
      idx = majorIntervals.indexOf(mod12(rel + 1));
      accidental = idx === -1 ? '' : 'b';
    }
  }
  if (idx === -1) return pcName(chord.rootPc, preferFlatsFor(key));
  const minorish = chord.triad === 'min' || chord.triad === 'dim';
  let numeral = minorish ? NUMERALS[idx].toLowerCase() : NUMERALS[idx];
  if (chord.triad === 'dim') numeral += '°';
  if (chord.triad === 'aug') numeral += '+';
  if (chord.seventh === 'maj7') numeral += 'maj7';
  else if (chord.seventh === 'dom7') numeral += '7';
  else if (chord.seventh === 'dim7') numeral += '7';
  if (chord.triad === 'sus4') numeral += 'sus4';
  if (chord.triad === 'sus2') numeral += 'sus2';
  return accidental + numeral;
}

/** Scale that fits the song best for noodling: pentatonic/blues options included. */
export function relatedScales(key: Key): Key[] {
  const isMinor = key.scale !== 'major' && key.scale !== 'lydian' && key.scale !== 'mixolydian';
  const out: Key[] = [key];
  const push = (k: Key) => {
    if (!out.some((o) => o.tonicPc === k.tonicPc && o.scale === k.scale)) out.push(k);
  };
  if (isMinor) {
    push({tonicPc: key.tonicPc, scale: 'minorPentatonic'});
    push({tonicPc: key.tonicPc, scale: 'blues'});
    push({tonicPc: key.tonicPc, scale: 'dorian'});
    push({tonicPc: mod12(key.tonicPc + 3), scale: 'major'});
  } else {
    push({tonicPc: key.tonicPc, scale: 'majorPentatonic'});
    push({tonicPc: mod12(key.tonicPc + 9), scale: 'minorPentatonic'});
    push({tonicPc: key.tonicPc, scale: 'mixolydian'});
    push({tonicPc: mod12(key.tonicPc + 9), scale: 'minor'});
  }
  push({tonicPc: key.tonicPc, scale: 'chromatic'});
  return out;
}

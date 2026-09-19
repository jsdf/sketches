/** Note name <-> MIDI helpers. Middle C (C4) = MIDI 60. */

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const LETTER_PC: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

export type Pc = number; // 0..11

export function mod12(n: number): Pc {
  return ((n % 12) + 12) % 12;
}

export function pcOf(midi: number): Pc {
  return mod12(midi);
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** True for the five keys that are black on a piano. */
export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(pcOf(midi));
}

/**
 * Parses a pitch class from a note name such as `C`, `Bb`, `F##`, `Ebb`.
 * Returns null when the name is not a note.
 */
export function parsePitchClass(name: string): Pc | null {
  const m = /^([A-Ga-g])([#b♯♭x]*)$/.exec(name.trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') pc += 1;
    else if (ch === 'b' || ch === '♭') pc -= 1;
    else if (ch === 'x') pc += 2;
  }
  return mod12(pc);
}

/**
 * Parses a full note name with an octave (`C4`, `F#3`, `Bb5`) into a MIDI number.
 * A name without an octave defaults to `defaultOctave`.
 */
export function parseNote(name: string, defaultOctave = 4): number | null {
  const m = /^([A-Ga-g][#b♯♭x]*)(-?\d+)?$/.exec(name.trim());
  if (!m) return null;
  const pc = parsePitchClass(m[1]);
  if (pc == null) return null;
  // Use the raw letter/accidental so that e.g. Cb4 lands just below C4, and B#3
  // just above B3, matching scientific pitch notation.
  const letterPc = LETTER_PC[m[1][0].toUpperCase()];
  let shift = 0;
  for (const ch of m[1].slice(1)) {
    if (ch === '#' || ch === '♯') shift += 1;
    else if (ch === 'b' || ch === '♭') shift -= 1;
    else if (ch === 'x') shift += 2;
  }
  const octave = m[2] != null ? parseInt(m[2], 10) : defaultOctave;
  return (octave + 1) * 12 + letterPc + shift;
}

export function pcName(pc: Pc, preferFlats = false): string {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

export function midiName(midi: number, preferFlats = false): string {
  return pcName(pcOf(midi), preferFlats) + octaveOf(midi);
}

/** Short label used on keys: note letter without the octave. */
export function midiLabel(midi: number, preferFlats = false): string {
  return pcName(pcOf(midi), preferFlats);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Transposes `midi` by octaves until it sits in [low, high] where possible. */
export function foldIntoRange(midi: number, low: number, high: number): number {
  let m = midi;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return m;
}

/** Nearest MIDI note with pitch class `pc` to `target`. */
export function nearestPc(pc: Pc, target: number): number {
  const base = Math.floor(target / 12) * 12 + mod12(pc);
  const candidates = [base - 12, base, base + 12];
  return candidates.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

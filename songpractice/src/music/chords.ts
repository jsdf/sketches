/**
 * Chord symbol parsing. Chord data from the web arrives as text like `Cmaj7`,
 * `F#m7b5`, `Bb/D` or `Asus4`, so the parser has to be forgiving about the
 * many ways people spell the same chord.
 */
import {mod12, nearestPc, parsePitchClass, Pc, pcName} from './notes';

export type Triad = 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | 'power';
export type Seventh = 'none' | 'dom7' | 'maj7' | 'dim7';

export type Chord = {
  /** The symbol exactly as it should be displayed. */
  symbol: string;
  rootPc: Pc;
  /** Pitch class of a slash bass note, when the symbol had one. */
  bassPc: Pc | null;
  triad: Triad;
  seventh: Seventh;
  /** Highest tension present: 0, 9, 11 or 13. */
  extension: 0 | 9 | 11 | 13;
  /** Semitone offsets from the root, ascending, root first. */
  intervals: number[];
  /** Scale-degree names lined up with `intervals` (R, 3, b7, 9 ...). */
  degrees: string[];
  quality: string;
};

const INTERVAL_DEGREES: Record<number, string> = {
  0: 'R',
  1: 'b9',
  2: '9',
  3: 'b3',
  4: '3',
  5: '11',
  6: 'b5',
  7: '5',
  8: '#5',
  9: '13',
  10: 'b7',
  11: '7',
  13: 'b9',
  14: '9',
  15: '#9',
  17: '11',
  18: '#11',
  20: 'b13',
  21: '13',
};

/**
 * Names an interval in the context of the chord it belongs to, so that a sus4
 * shows a `4` rather than an `11` and a 6th chord shows `6` rather than `13`.
 */
function degreeFor(interval: number, p: Parsed): string {
  if (interval === 2 && p.triad === 'sus2') return '2';
  if (interval === 5 && p.triad === 'sus4') return '4';
  if (interval === 9) {
    if (p.seventh === 'dim7') return 'bb7';
    if (p.seventh === 'none') return '6';
  }
  return INTERVAL_DEGREES[interval] ?? `${interval}`;
}

/** Turns unicode and longhand spellings into a single canonical form. */
function normalizeSuffix(raw: string): string {
  return raw
    .replace(/[–—−]/g, '-')
    .replace(/[Δ∆]/g, 'maj7')
    .replace(/[øØ]/g, 'm7b5')
    .replace(/[°˚o](?=7|$|\/)/g, 'dim')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/major/gi, 'maj')
    .replace(/minor/gi, 'min')
    .replace(/dominant/gi, '')
    .replace(/[()\s]/g, '');
}

type Parsed = {
  triad: Triad;
  seventh: Seventh;
  extension: 0 | 9 | 11 | 13;
  alts: string[];
  adds: number[];
  omits: number[];
};

function parseSuffix(input: string): Parsed {
  let s = input;
  const out: Parsed = {triad: 'maj', seventh: 'none', extension: 0, alts: [], adds: [], omits: []};
  const eat = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s);
    if (m) s = s.slice(m[0].length);
    return m;
  };

  // Triad quality comes first, because `m` before `aj` means something else.
  if (eat(/^min(?!or)/) || eat(/^m(?!aj|a7|M)/) || eat(/^-/)) out.triad = 'min';
  else if (eat(/^dim/)) {
    out.triad = 'dim';
    out.seventh = eat(/^7/) ? 'dim7' : 'none';
  } else if (eat(/^aug/) || eat(/^\+(?!\d)/)) out.triad = 'aug';

  // `maj7` / `M7` / `ma7`. A bare `maj` is just a major triad.
  if (eat(/^(maj|ma|M)(?=7|9|11|13)/)) {
    out.seventh = 'maj7';
    const ext = eat(/^(13|11|9|7)/);
    if (ext && ext[1] !== '7') out.extension = Number(ext[1]) as 9 | 11 | 13;
  } else {
    eat(/^maj(?![79]|1[13])/);
  }

  if (eat(/^sus2/)) out.triad = 'sus2';
  else if (eat(/^sus4?/)) out.triad = 'sus4';

  if (out.seventh === 'none' && out.triad !== 'dim') {
    const ext = eat(/^(13|11|9|7|6|5)(?!\d)/);
    if (ext) {
      const n = Number(ext[1]);
      if (n === 5) out.triad = 'power';
      else if (n === 6) out.adds.push(9);
      else {
        out.seventh = 'dom7';
        if (n !== 7) out.extension = n as 9 | 11 | 13;
      }
    }
  } else if (out.seventh === 'maj7' && out.extension === 0) {
    const ext = eat(/^(13|11|9)(?!\d)/);
    if (ext) out.extension = Number(ext[1]) as 9 | 11 | 13;
  }

  // 6th chords: the `6` was consumed above as an `adds` marker.
  if (s.startsWith('6')) {
    s = s.slice(1);
    out.adds.push(9);
  }
  if (eat(/^\/9/) || eat(/^9/)) {
    if (out.adds.includes(9)) out.adds.push(14);
  }

  if (eat(/^sus2/)) out.triad = 'sus2';
  else if (eat(/^sus4?/)) out.triad = 'sus4';

  // Whatever is left is alterations, additions and omissions in any order.
  let guard = 0;
  while (s.length > 0 && guard++ < 12) {
    const add = eat(/^add(13|11|9|6|4|2)/);
    if (add) {
      const n = Number(add[1]);
      out.adds.push(n === 2 ? 14 : n === 4 ? 17 : n === 6 ? 9 : n === 9 ? 14 : n === 11 ? 17 : 21);
      continue;
    }
    const omit = eat(/^(?:no|omit)(\d+)/);
    if (omit) {
      out.omits.push(Number(omit[1]));
      continue;
    }
    const alt = eat(/^([#b+-])(13|11|9|5|6)/);
    if (alt) {
      const sign = alt[1] === '#' || alt[1] === '+' ? '#' : 'b';
      out.alts.push(sign + alt[2]);
      continue;
    }
    if (eat(/^alt/)) {
      out.alts.push('b9', '#5');
      continue;
    }
    if (eat(/^./)) continue; // skip anything we do not understand
  }
  return out;
}

function buildIntervals(p: Parsed): number[] {
  const set = new Set<number>([0]);
  switch (p.triad) {
    case 'min':
      set.add(3);
      set.add(7);
      break;
    case 'dim':
      set.add(3);
      set.add(6);
      break;
    case 'aug':
      set.add(4);
      set.add(8);
      break;
    case 'sus2':
      set.add(2);
      set.add(7);
      break;
    case 'sus4':
      set.add(5);
      set.add(7);
      break;
    case 'power':
      set.add(7);
      break;
    default:
      set.add(4);
      set.add(7);
  }
  if (p.seventh === 'dom7') set.add(10);
  else if (p.seventh === 'maj7') set.add(11);
  else if (p.seventh === 'dim7') set.add(9);

  if (p.extension >= 9) set.add(14);
  if (p.extension >= 11) set.add(17);
  if (p.extension >= 13) set.add(21);
  for (const a of p.adds) set.add(a);

  for (const alt of p.alts) {
    const deg = Number(alt.slice(1));
    const up = alt[0] === '#';
    const base = deg === 5 ? 7 : deg === 6 ? 9 : deg === 9 ? 14 : deg === 11 ? 17 : 21;
    set.delete(base);
    set.add(base + (up ? 1 : -1));
  }
  for (const o of p.omits) {
    if (o === 3) {
      set.delete(3);
      set.delete(4);
    } else if (o === 5) {
      set.delete(7);
    }
  }
  // An 11th against a major 3rd clashes. An explicit 11 chord drops the 3rd;
  // a 13 chord keeps the 3rd and drops the 11 the way players actually voice it.
  if (set.has(17) && set.has(4)) {
    if (p.extension === 11) set.delete(4);
    else set.delete(17);
  }
  return [...set].sort((a, b) => a - b);
}

const chordCache = new Map<string, Chord | null>();

/** Parses a chord symbol. Returns null if no root note could be found. */
export function parseChord(symbol: string): Chord | null {
  const key = symbol.trim();
  if (chordCache.has(key)) return chordCache.get(key)!;
  const result = parseChordUncached(key);
  chordCache.set(key, result);
  return result;
}

function parseChordUncached(symbol: string): Chord | null {
  const raw = symbol.trim().replace(/^\|+|\|+$/g, '').trim();
  if (!raw || raw === '-' || raw === '%') return null;

  const slash = raw.lastIndexOf('/');
  let body = raw;
  let bassPc: Pc | null = null;
  if (slash > 0) {
    const maybeBass = raw.slice(slash + 1);
    const pc = parsePitchClass(maybeBass);
    if (pc != null) {
      bassPc = pc;
      body = raw.slice(0, slash);
    }
  }

  const rootMatch = /^([A-Ga-g][#b♯♭]?)/.exec(body);
  if (!rootMatch) return null;
  const rootPc = parsePitchClass(rootMatch[1]);
  if (rootPc == null) return null;

  const parsed = parseSuffix(normalizeSuffix(body.slice(rootMatch[1].length)));
  const intervals = buildIntervals(parsed);
  const display = rootMatch[1][0].toUpperCase() + rootMatch[1].slice(1);

  return {
    symbol: display + body.slice(rootMatch[1].length) + (bassPc != null ? '/' + pcName(bassPc, raw.includes('b')) : ''),
    rootPc,
    bassPc,
    triad: parsed.triad,
    seventh: parsed.seventh,
    extension: parsed.extension,
    intervals,
    degrees: intervals.map((i) => degreeFor(i, parsed)),
    quality: body.slice(rootMatch[1].length) || 'maj',
  };
}

export type Voicing = {
  /** All sounding notes, lowest first (includes the slash bass note). */
  midi: number[];
  /** Interval label for each entry of `midi`. */
  labels: string[];
  bassMidi: number | null;
};

/**
 * Lays the chord out on a keyboard around `center`, in root position, so the
 * shape stays recognisable when practising.
 */
export function voiceChord(chord: Chord, center = 60, opts: {withBass?: boolean} = {}): Voicing {
  const rootMidi = nearestPc(chord.rootPc, center - 4);
  const midi = chord.intervals.map((i) => rootMidi + i);
  const labels = chord.degrees.slice();
  let bassMidi: number | null = null;
  if (opts.withBass !== false && chord.bassPc != null && mod12(chord.bassPc) !== mod12(chord.rootPc)) {
    bassMidi = nearestPc(chord.bassPc, rootMidi - 8);
    midi.unshift(bassMidi);
    labels.unshift('bass');
  }
  return {midi, labels, bassMidi};
}

/** Pitch classes sounded by the chord, for highlighting a keyboard. */
export function chordPcs(chord: Chord): Pc[] {
  const pcs = new Set<Pc>(chord.intervals.map((i) => mod12(chord.rootPc + i)));
  if (chord.bassPc != null) pcs.add(chord.bassPc);
  return [...pcs];
}

/** Human readable one-liner, e.g. "C major 7" or "A minor". */
export function describeChord(chord: Chord, preferFlats = false): string {
  const root = pcName(chord.rootPc, preferFlats);
  const triad =
    chord.triad === 'min'
      ? 'minor'
      : chord.triad === 'dim'
        ? 'diminished'
        : chord.triad === 'aug'
          ? 'augmented'
          : chord.triad === 'sus2'
            ? 'sus2'
            : chord.triad === 'sus4'
              ? 'sus4'
              : chord.triad === 'power'
                ? '5'
                : 'major';
  const seventh =
    chord.seventh === 'dom7' ? ' 7' : chord.seventh === 'maj7' ? ' major 7' : chord.seventh === 'dim7' ? ' 7' : '';
  const ext = chord.extension ? ` add ${chord.extension}` : '';
  return `${root} ${triad}${seventh}${ext}`;
}

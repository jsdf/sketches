/**
 * Turns the model's submission into a Song.
 *
 * The model only ever sends chord symbols and note names as text; everything
 * that reaches the audio engine is parsed here by the app's own theory code. A
 * hallucinated symbol becomes a validation error the agent can be asked to fix,
 * not a bad note.
 */
import {parseChord} from '../music/chords';
import {parseNote} from '../music/notes';
import {parseKey} from '../music/scales';
import {makeId, RawChord, RawNote, RawSection, Song} from '../music/song';
import {SubmitPayload} from './types';

export class ValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

const MAX_REPORTED = 8;

function parseTimeSignature(text: string | undefined): [number, number] {
  const m = /^\s*(\d{1,2})\s*[/|]\s*(\d{1,2})\s*$/.exec(text ?? '');
  if (!m) return [4, 4];
  const top = Number(m[1]);
  const bottom = Number(m[2]);
  if (!top || !bottom) return [4, 4];
  return [Math.min(Math.max(top, 1), 16), bottom];
}

function normalizeBeats(value: unknown, fallback: number): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  // Snap to a sensible grid: sixteenths are as fine as this app needs.
  const snapped = Math.round(n * 4) / 4;
  return snapped > 0 ? Math.min(snapped, fallback * 16) : null;
}

const REST_WORDS = new Set(['rest', 'r', '-', '', 'silence', 'null', 'none', 'pause']);

export function normalizeSubmission(payload: SubmitPayload, fallbackTitle: string): {song: Song; warnings: string[]} {
  const problems: string[] = [];
  const warnings: string[] = [];

  const rawSections = Array.isArray(payload.sections) ? payload.sections : [];
  if (rawSections.length === 0) problems.push('sections was empty; at least one section with chords is required.');

  const timeSignature = parseTimeSignature(payload.timeSignature);
  const beatsPerBar = timeSignature[0];
  const sections: RawSection[] = [];

  rawSections.forEach((section, si) => {
    const label = section?.name?.trim() || `section ${si + 1}`;
    const chords: RawChord[] = [];
    const melody: RawNote[] = [];

    for (const [ci, raw] of (section?.chords ?? []).entries()) {
      const symbol = String(raw?.symbol ?? '').trim();
      if (!symbol) continue;
      if (!parseChord(symbol)) {
        if (problems.length < MAX_REPORTED) {
          problems.push(`"${symbol}" in ${label} (chord ${ci + 1}) is not a chord symbol I can read.`);
        }
        continue;
      }
      const beats = normalizeBeats(raw?.beats, beatsPerBar);
      if (beats == null) {
        warnings.push(`Chord ${symbol} in ${label} had no usable length; assumed one bar.`);
        chords.push({symbol, beats: beatsPerBar});
      } else {
        chords.push({symbol, beats});
      }
    }

    for (const [ni, raw] of (section?.melody ?? []).entries()) {
      const rawNote = String(raw?.note ?? '').trim();
      const beats = normalizeBeats(raw?.beats, beatsPerBar) ?? 1;
      if (REST_WORDS.has(rawNote.toLowerCase())) {
        melody.push({note: null, beats});
        continue;
      }
      const midi = parseNote(rawNote);
      if (midi == null) {
        if (problems.length < MAX_REPORTED) {
          problems.push(`"${rawNote}" in ${label} (note ${ni + 1}) is not a pitch name like C4 or F#5.`);
        }
        continue;
      }
      if (midi < 24 || midi > 108) {
        warnings.push(`Note ${rawNote} in ${label} was outside the playable range and was dropped.`);
        continue;
      }
      const lyric = typeof raw?.lyric === 'string' && raw.lyric.trim() ? raw.lyric.trim() : undefined;
      melody.push({note: rawNote, beats, lyric});
    }

    if (chords.length === 0 && melody.length === 0) {
      warnings.push(`Section "${label}" had nothing usable and was dropped.`);
      return;
    }
    if (chords.length === 0) {
      warnings.push(`Section "${label}" has a melody but no chords.`);
    }

    const chordBeats = chords.reduce((a, c) => a + c.beats, 0);
    const melodyBeats = melody.reduce((a, m) => a + m.beats, 0);
    if (chordBeats > 0 && melodyBeats > 0 && Math.abs(chordBeats - melodyBeats) > 0.01) {
      // Not worth rejecting the whole song over: the timeline lets the shorter
      // part finish early, and a trailing rest makes looping feel right.
      warnings.push(
        `In "${label}" the chords last ${chordBeats} beats but the melody lasts ${melodyBeats}; the shorter part was padded.`,
      );
      if (melodyBeats < chordBeats) melody.push({note: null, beats: chordBeats - melodyBeats});
    }

    sections.push({name: label, chords, melody});
  });

  if (sections.length === 0 && problems.length === 0) {
    problems.push('No section contained a readable chord or note.');
  }
  const totalChords = sections.reduce((a, s) => a + s.chords.length, 0);
  if (sections.length > 0 && totalChords === 0) {
    problems.push('No readable chords at all; the app needs at least a chord progression.');
  }
  if (problems.length > 0) throw new ValidationError(problems);

  const keyText = payload.key?.trim() ?? '';
  if (keyText && !parseKey(keyText)) {
    warnings.push(`Key "${keyText}" was not understood; the key was inferred from the chords instead.`);
  }

  const tempoRaw = typeof payload.tempo === 'string' ? Number(payload.tempo) : payload.tempo;
  let tempo = typeof tempoRaw === 'number' && Number.isFinite(tempoRaw) ? Math.round(tempoRaw) : 100;
  if (tempo < 40 || tempo > 220) {
    warnings.push(`Reported tempo ${tempo} bpm was out of range; clamped.`);
    tempo = Math.min(220, Math.max(40, tempo));
  }

  const song: Song = {
    id: makeId(),
    title: payload.title?.trim() || fallbackTitle,
    artist: payload.artist?.trim() || 'Unknown',
    keyText: parseKey(keyText) ? keyText : '',
    tempo,
    timeSignature,
    sections,
    source: {
      urls: (payload.sources ?? []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 8),
      confidence:
        payload.confidence === 'high' || payload.confidence === 'medium' || payload.confidence === 'low'
          ? payload.confidence
          : undefined,
      notes: payload.notes?.trim() || undefined,
    },
    createdAt: Date.now(),
  };

  return {song, warnings};
}

/** Message handed back to the model so it can correct its own submission. */
export function retryMessage(err: ValidationError): string {
  return `Your submission could not be used:\n- ${err.problems.join('\n- ')}\n\nFix these and call the tool again. Use plain chord symbols (C, Am7, F#m7b5, D/F#) and pitch names with an octave (C4, A#3), or "rest".`;
}

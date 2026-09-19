/** Choosing what slice of the keyboard to put on screen. */
import {clamp, isBlackKey, mod12} from './notes';

export type KeyRange = {low: number; high: number};

const LOWEST = 36; // C2
const HIGHEST = 96; // C7

/** Rounds down to the C at or below `midi`. */
function floorToC(midi: number): number {
  return midi - mod12(midi);
}

/** Rounds up to the B at the top of `midi`'s octave. */
function ceilToB(midi: number): number {
  return floorToC(midi) + 11;
}

/**
 * A keybed that comfortably contains `notes`, padded out to at least
 * `minOctaves` and snapped to whole octaves so the layout never looks cut off.
 */
export function keyboardRange(notes: number[], minOctaves = 3): KeyRange {
  const usable = notes.filter((n) => Number.isFinite(n));
  if (usable.length === 0) return {low: 48, high: 48 + minOctaves * 12 - 1};
  let low = floorToC(clamp(Math.min(...usable) - 2, LOWEST, HIGHEST));
  let high = ceilToB(clamp(Math.max(...usable) + 2, LOWEST, HIGHEST));
  while (high - low + 1 < minOctaves * 12) {
    if (high + 12 <= HIGHEST) high += 12;
    else if (low - 12 >= LOWEST) low -= 12;
    else break;
  }
  return {low, high: Math.max(high, low + 11)};
}

/** Number of white keys in a range, which is what sets the on-screen width. */
export function whiteKeyCount(range: KeyRange): number {
  let n = 0;
  for (let m = range.low; m <= range.high; m++) if (!isBlackKey(m)) n++;
  return n;
}

/**
 * Key width that fills the screen when the range already fits, and otherwise
 * stays at a comfortable thumb size and lets the keybed auto-shift.
 */
export function comfortableKeyWidth(range: KeyRange, screenWidth: number, preferred: number): number {
  const whites = whiteKeyCount(range);
  const exact = screenWidth / whites;
  if (exact >= preferred) return Math.floor(exact);
  return preferred;
}

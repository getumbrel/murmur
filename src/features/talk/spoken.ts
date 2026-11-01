/** Messages you said on a call rather than typed, this visit: the thread marks them with a small waveform. */
export const spokenIds = new Set<string>()

/**
 * How far up its box a long sentence has moved: whole lines, so the line being said stays a third
 * of the way down and the one that leaves fades out whole, and never past the sentence's end.
 */
export function reelShift(wordTop: number, room: number, height: number, line: number) {
  return Math.max(0, Math.ceil(Math.min(wordTop - room / 3, height - room) / line) * line)
}

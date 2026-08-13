import { describe, expect, it } from "vitest";
import { JINGLE_NOTES, TICK_NOTES } from "./audio";

function sequenceDuration(notes: typeof TICK_NOTES | typeof JINGLE_NOTES): number {
  return Math.max(...notes.map((note) => note.start + note.duration));
}

describe("audio cues", () => {
  it("uses a clearly audible two-tone ding-dong cue", () => {
    expect(TICK_NOTES).toHaveLength(2);
    expect(TICK_NOTES[0].frequency).toBeGreaterThan(TICK_NOTES[1].frequency);
    expect(TICK_NOTES[0].frequency).toBeGreaterThan(1_000);
    expect(TICK_NOTES.every((note) => note.waveform === "triangle")).toBe(true);
    expect(sequenceDuration(TICK_NOTES)).toBeGreaterThanOrEqual(0.85);
  });

  it("uses an approximately four-second school-chime melody", () => {
    expect(JINGLE_NOTES).toHaveLength(16);
    expect(JINGLE_NOTES.filter((_, index) => index % 2 === 0).map((note) => note.start))
      .toEqual([0, 0.4, 0.8, 1.2, 2.2, 2.6, 3, 3.4]);
    expect(sequenceDuration(JINGLE_NOTES)).toBeGreaterThanOrEqual(4);
    expect(sequenceDuration(JINGLE_NOTES)).toBeLessThanOrEqual(4.5);
  });
});

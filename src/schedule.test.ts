import { describe, expect, it } from "vitest";
import {
  EVENT_TOLERANCE_MS,
  EXAM_DURATION_MS,
  MINUTE,
  findDueEvents,
  formatRemaining,
  getPhase,
  atLocalTime,
} from "./schedule";

describe("schedule event engine", () => {
  it("fires the 75-minute prestart alert after a small polling delay", () => {
    const events = findDueEvents(75 * MINUTE + 400, 75 * MINUTE - 300, new Set());
    expect(events.map((event) => event.id)).toEqual(["prestart"]);
  });

  it("does not catch up an old alert after a long delay", () => {
    const events = findDueEvents(61 * MINUTE, 59 * MINUTE, new Set());
    expect(events).toEqual([]);
  });

  it("never repeats a completed event", () => {
    const events = findDueEvents(10 * MINUTE + 100, 10 * MINUTE - 100, new Set(["remaining-10"]));
    expect(events).toEqual([]);
  });

  it("always recognizes a crossed exam end even after throttling", () => {
    const events = findDueEvents(1_000, -30_000, new Set());
    expect(events.map((event) => event.id)).toEqual(["end"]);
  });

  it("uses the exact 70-minute boundary for the active phase", () => {
    expect(getPhase(EXAM_DURATION_MS + 1)).toBe("waiting");
    expect(getPhase(EXAM_DURATION_MS)).toBe("active");
    expect(getPhase(0)).toBe("ended");
  });

  it("clamps display at zero and rounds up partial seconds", () => {
    expect(formatRemaining(-1)).toBe("00:00");
    expect(formatRemaining(60_001)).toBe("01:01");
    expect(formatRemaining(EVENT_TOLERANCE_MS)).toBe("00:03");
  });

  it("maps the default 20:20 end to 19:10 start and 19:05 prestart", () => {
    const end = atLocalTime(new Date(2026, 7, 13, 12), 20, 20);
    expect(new Date(end.getTime() - 70 * MINUTE).getHours()).toBe(19);
    expect(new Date(end.getTime() - 70 * MINUTE).getMinutes()).toBe(10);
    expect(new Date(end.getTime() - 75 * MINUTE).getHours()).toBe(19);
    expect(new Date(end.getTime() - 75 * MINUTE).getMinutes()).toBe(5);
  });

  it("contains every requested remaining-time announcement exactly once", async () => {
    const { SCHEDULE_EVENTS } = await import("./schedule");
    const minutes = SCHEDULE_EVENTS
      .filter((event) => event.kind === "time")
      .map((event) => event.minutes);
    expect(minutes).toEqual([60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(new Set(SCHEDULE_EVENTS.map((event) => event.id)).size).toBe(SCHEDULE_EVENTS.length);
  });
});

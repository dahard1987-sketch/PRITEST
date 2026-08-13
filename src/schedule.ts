export const MINUTE = 60_000;
export const EXAM_DURATION_MS = 70 * MINUTE;
export const PRE_START_MS = 75 * MINUTE;
export const EVENT_TOLERANCE_MS = 2_500;

export type ScheduleEventKind = "prestart" | "start" | "time" | "end";

export interface ScheduleEvent {
  id: string;
  kind: ScheduleEventKind;
  thresholdMs: number;
  minutes?: number;
  speech?: string;
}

export const SCHEDULE_EVENTS: readonly ScheduleEvent[] = [
  { id: "prestart", kind: "prestart", thresholdMs: 75 * MINUTE, speech: "시험 시작 5분 전입니다" },
  { id: "start", kind: "start", thresholdMs: 70 * MINUTE },
  ...[60, 50, 40, 30, 20, 10, 9, 8, 7, 6].map((minutes) => ({
    id: `remaining-${minutes}`,
    kind: "time" as const,
    thresholdMs: minutes * MINUTE,
    minutes,
    speech: `${minutes}분 남았습니다`,
  })),
  {
    id: "remaining-5",
    kind: "time",
    thresholdMs: 5 * MINUTE,
    minutes: 5,
    speech: "OMR 작성을 시작하지 않았으면 이제 시작하세요",
  },
  ...[4, 3, 2, 1].map((minutes) => ({
    id: `remaining-${minutes}`,
    kind: "time" as const,
    thresholdMs: minutes * MINUTE,
    minutes,
    speech: `${minutes}분 남았습니다`,
  })),
  { id: "end", kind: "end", thresholdMs: 0 },
];

export type ExamPhase = "waiting" | "active" | "ended";

export function getPhase(remainingMs: number): ExamPhase {
  if (remainingMs <= 0) return "ended";
  if (remainingMs <= EXAM_DURATION_MS) return "active";
  return "waiting";
}

export function getRemainingMs(endTimeMs: number, nowMs = Date.now()): number {
  return endTimeMs - nowMs;
}

export function findDueEvents(
  previousRemainingMs: number | null,
  currentRemainingMs: number,
  completed: ReadonlySet<string>,
): ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter((event) => {
    if (completed.has(event.id)) return false;

    if (event.kind === "end") {
      return currentRemainingMs <= 0 && (previousRemainingMs === null || previousRemainingMs > 0);
    }

    const crossed = previousRemainingMs !== null
      ? previousRemainingMs > event.thresholdMs && currentRemainingMs <= event.thresholdMs
      : Math.abs(currentRemainingMs - event.thresholdMs) <= EVENT_TOLERANCE_MS;

    if (!crossed) return false;
    const lateness = event.thresholdMs - currentRemainingMs;
    return lateness >= 0 && lateness <= EVENT_TOLERANCE_MS;
  });
}

export function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function atLocalTime(base: Date, hours: number, minutes: number): Date {
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function formatDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

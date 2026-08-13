import "./style.css";
import { AudioController } from "./audio";
import {
  EXAM_DURATION_MS,
  MINUTE,
  PRE_START_MS,
  SCHEDULE_EVENTS,
  atLocalTime,
  findDueEvents,
  formatDateTimeInput,
  formatRemaining,
  getPhase,
  getRemainingMs,
  type ExamPhase,
  type ScheduleEvent,
} from "./schedule";

interface Preferences {
  ttsEnabled: boolean;
  voiceUri: string;
  ttsVolume: number;
  audioVolume: number;
}

interface ExamSession {
  id: string;
  endTimeMs: number;
  completed: string[];
}

const PREFS_KEY = "english-exam-clock:preferences";
const SESSION_KEY = "english-exam-clock:session";
const DEFAULT_END_HOUR = 20;
const DEFAULT_END_MINUTE = 20;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const ui = {
  phaseBadge: byId("phaseBadge"),
  readyStatus: byId("readyStatus"),
  wakeStatus: byId("wakeStatus"),
  currentClock: byId<HTMLTimeElement>("currentClock"),
  phaseMessage: byId("phaseMessage"),
  remainingTime: byId<HTMLTimeElement>("remainingTime"),
  endTimeDisplay: byId("endTimeDisplay"),
  prepareButton: byId<HTMLButtonElement>("prepareButton"),
  fullscreenButton: byId<HTMLButtonElement>("fullscreenButton"),
  settingsButton: byId<HTMLButtonElement>("settingsButton"),
  settingsPanel: byId<HTMLElement>("settingsPanel"),
  closeSettingsButton: byId<HTMLButtonElement>("closeSettingsButton"),
  endDateTimeInput: byId<HTMLInputElement>("endDateTimeInput"),
  applyScheduleButton: byId<HTMLButtonElement>("applyScheduleButton"),
  scheduleSummary: byId("scheduleSummary"),
  ttsEnabledInput: byId<HTMLInputElement>("ttsEnabledInput"),
  voiceSelect: byId<HTMLSelectElement>("voiceSelect"),
  ttsVolumeInput: byId<HTMLInputElement>("ttsVolumeInput"),
  ttsVolumeOutput: byId<HTMLOutputElement>("ttsVolumeOutput"),
  audioVolumeInput: byId<HTMLInputElement>("audioVolumeInput"),
  audioVolumeOutput: byId<HTMLOutputElement>("audioVolumeOutput"),
  stopTestButton: byId<HTMLButtonElement>("stopTestButton"),
  testStatus: byId("testStatus"),
  pastScheduleDialog: byId<HTMLDialogElement>("pastScheduleDialog"),
  scheduleTomorrowButton: byId<HTMLButtonElement>("scheduleTomorrowButton"),
  openEndedButton: byId<HTMLButtonElement>("openEndedButton"),
  toast: byId("toast"),
  devPanel: byId("devPanel"),
  devButtons: byId("devButtons"),
};

const audio = new AudioController();
let session: ExamSession;
let previousRemainingMs: number | null = null;
let wakeLock: WakeLockSentinel | null = null;
let preparing = false;
let endingSequenceRunning = false;
let toastTimer = 0;

function loadPreferences(): Preferences {
  const fallback: Preferences = { ttsEnabled: true, voiceUri: "", ttsVolume: 0.9, audioVolume: 0.85 };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") } as Preferences;
  } catch {
    return fallback;
  }
}

function loadSession(): ExamSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as ExamSession | null;
    if (!value || !Number.isFinite(value.endTimeMs) || !Array.isArray(value.completed)) return null;
    return value;
  } catch {
    return null;
  }
}

function saveSession(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function newSession(endTimeMs: number, completed: string[] = []): void {
  session = { id: crypto.randomUUID(), endTimeMs, completed };
  previousRemainingMs = null;
  endingSequenceRunning = false;
  audio.stopAlerts();
  audio.listeningAudio.pause();
  audio.listeningPlaying = false;
  saveSession();
  updateScheduleControls();
  render(Date.now());
}

function savePreferences(): void {
  const preferences: Preferences = {
    ttsEnabled: audio.ttsEnabled,
    voiceUri: audio.selectedVoiceUri,
    ttsVolume: audio.ttsVolume,
    audioVolume: audio.audioVolume,
  };
  localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("visible"), 3_500);
}

function formatClock(date: Date, includeDate = false): string {
  return new Intl.DateTimeFormat("ko-KR", {
    ...(includeDate ? { month: "numeric", day: "numeric", weekday: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: includeDate ? undefined : "2-digit",
    hour12: false,
  }).format(date);
}

function render(nowMs: number): void {
  const remainingMs = getRemainingMs(session.endTimeMs, nowMs);
  const phase = getPhase(remainingMs);
  const now = new Date(nowMs);
  const end = new Date(session.endTimeMs);
  const start = new Date(session.endTimeMs - EXAM_DURATION_MS);

  document.body.dataset.phase = phase;
  ui.currentClock.textContent = formatClock(now);
  ui.currentClock.dateTime = now.toISOString();
  ui.remainingTime.textContent = formatRemaining(remainingMs);
  ui.remainingTime.dateTime = `PT${Math.max(0, Math.ceil(remainingMs / 1_000))}S`;
  ui.endTimeDisplay.textContent = formatClock(end, true);

  const labels: Record<ExamPhase, [string, string]> = {
    waiting: ["시험 대기", `${formatClock(start, true)} 시작`],
    active: ["시험 진행", audio.listeningPlaying ? "듣기평가 진행 중" : "영어 영역"],
    ended: ["시험 종료", "시험이 종료되었습니다"],
  };
  ui.phaseBadge.textContent = labels[phase][0];
  ui.phaseMessage.textContent = labels[phase][1];
}

async function handleEvent(event: ScheduleEvent): Promise<void> {
  if (event.kind === "prestart" && event.speech) {
    await audio.playTimedAnnouncement(event.speech);
    return;
  }
  if (event.kind === "start") {
    try {
      await audio.playListening();
    } catch {
      showToast("듣기평가 음원을 재생하지 못했습니다. 시험 준비 버튼을 확인하세요.");
    }
    return;
  }
  if (event.kind === "time") {
    if (audio.listeningPlaying) return;
    if (event.speech) await audio.playTimedAnnouncement(event.speech);
    return;
  }
  if (event.kind === "end") {
    void runEndingSequence();
  }
}

async function runEndingSequence(): Promise<void> {
  if (endingSequenceRunning) return;
  endingSequenceRunning = true;
  audio.stopAlerts();
  audio.stopTest();
  audio.listeningAudio.pause();
  audio.listeningPlaying = false;
  render(Date.now());
  try {
    await audio.playJingle("live").finished;
    await audio.playEndingSong();
  } catch {
    showToast("종료 음원을 재생하지 못했습니다. 오디오 활성화 상태를 확인하세요.");
  }
}

function timerTick(): void {
  const nowMs = Date.now();
  const remainingMs = getRemainingMs(session.endTimeMs, nowMs);
  render(nowMs);
  const completed = new Set(session.completed);
  const dueEvents = findDueEvents(previousRemainingMs, remainingMs, completed);
  previousRemainingMs = remainingMs;

  for (const event of dueEvents) {
    // Persist before playback so rendering, refresh, or visibility changes cannot duplicate it.
    session.completed.push(event.id);
    saveSession();
    void handleEvent(event);
  }
}

async function requestWakeLock(): Promise<void> {
  if (!("wakeLock" in navigator)) {
    ui.wakeStatus.textContent = "Wake Lock 미지원";
    ui.wakeStatus.dataset.state = "error";
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    ui.wakeStatus.textContent = "Wake Lock 켜짐";
    ui.wakeStatus.dataset.state = "on";
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      ui.wakeStatus.textContent = "Wake Lock 해제됨";
      ui.wakeStatus.dataset.state = "error";
    });
  } catch {
    ui.wakeStatus.textContent = "Wake Lock 요청 실패";
    ui.wakeStatus.dataset.state = "error";
  }
}

async function prepareExam(): Promise<void> {
  if (preparing) return;
  preparing = true;
  ui.prepareButton.disabled = true;
  ui.prepareButton.textContent = "준비 중…";
  try {
    await audio.prepare();
    await requestWakeLock();
    ui.readyStatus.textContent = "시험 준비 완료";
    ui.readyStatus.dataset.state = "on";
    ui.prepareButton.textContent = "준비 완료";
    showToast("오디오, TTS, 음원 로드와 절전 방지 요청을 완료했습니다.");
  } catch {
    ui.readyStatus.textContent = "일부 준비 실패 · 다시 시도";
    ui.readyStatus.dataset.state = "error";
    ui.prepareButton.textContent = "시험 준비 다시 시도";
    ui.prepareButton.disabled = false;
  } finally {
    preparing = false;
  }
}

function updateScheduleControls(): void {
  const end = new Date(session.endTimeMs);
  const start = new Date(session.endTimeMs - EXAM_DURATION_MS);
  const prestart = new Date(session.endTimeMs - PRE_START_MS);
  ui.endDateTimeInput.value = formatDateTimeInput(end);
  ui.scheduleSummary.textContent = `5분 전 안내 ${formatClock(prestart, true)} · 시작 ${formatClock(start, true)} · 종료 ${formatClock(end, true)}`;
}

function updateVoices(): void {
  const voices = audio.getKoreanVoices();
  ui.voiceSelect.replaceChildren();
  if (voices.length === 0) {
    ui.voiceSelect.add(new Option("한국어 음성 없음 · tick만 사용", ""));
    ui.voiceSelect.disabled = true;
    return;
  }
  ui.voiceSelect.disabled = false;
  for (const voice of voices) ui.voiceSelect.add(new Option(`${voice.name} (${voice.lang})`, voice.voiceURI));
  const wanted = voices.some((voice) => voice.voiceURI === audio.selectedVoiceUri)
    ? audio.selectedVoiceUri
    : voices[0].voiceURI;
  audio.selectedVoiceUri = wanted;
  ui.voiceSelect.value = wanted;
  savePreferences();
}

function initializeSettings(): void {
  const preferences = loadPreferences();
  audio.ttsEnabled = preferences.ttsEnabled;
  audio.selectedVoiceUri = preferences.voiceUri;
  audio.setVolumes(preferences.audioVolume, preferences.ttsVolume);
  ui.ttsEnabledInput.checked = preferences.ttsEnabled;
  ui.ttsVolumeInput.value = String(preferences.ttsVolume);
  ui.audioVolumeInput.value = String(preferences.audioVolume);
  ui.ttsVolumeOutput.value = `${Math.round(preferences.ttsVolume * 100)}%`;
  ui.audioVolumeOutput.value = `${Math.round(preferences.audioVolume * 100)}%`;
  updateVoices();
  speechSynthesis.addEventListener("voiceschanged", updateVoices);
}

function toggleSettings(force?: boolean): void {
  const open = force ?? ui.settingsPanel.hidden;
  ui.settingsPanel.hidden = !open;
  ui.settingsButton.setAttribute("aria-expanded", String(open));
}

function initializeSession(): void {
  const now = new Date();
  const stored = loadSession();
  if (stored) {
    session = stored;
  } else {
    session = { id: crypto.randomUUID(), endTimeMs: atLocalTime(now, DEFAULT_END_HOUR, DEFAULT_END_MINUTE).getTime(), completed: [] };
    saveSession();
  }
  updateScheduleControls();
  render(Date.now());
  if (session.endTimeMs <= Date.now()) ui.pastScheduleDialog.showModal();
}

ui.prepareButton.addEventListener("click", () => void prepareExam());
ui.fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    showToast("전체화면으로 전환하지 못했습니다.");
  }
});
document.addEventListener("fullscreenchange", () => {
  ui.fullscreenButton.textContent = document.fullscreenElement ? "전체화면 종료" : "전체화면";
  if (document.fullscreenElement) toggleSettings(false);
});
ui.settingsButton.addEventListener("click", () => toggleSettings());
ui.closeSettingsButton.addEventListener("click", () => toggleSettings(false));
ui.applyScheduleButton.addEventListener("click", () => {
  const endTimeMs = new Date(ui.endDateTimeInput.value).getTime();
  if (!Number.isFinite(endTimeMs)) {
    showToast("올바른 종료 날짜와 시각을 입력하세요.");
    return;
  }
  newSession(endTimeMs);
  showToast("새 종료 시각과 안내 일정을 적용했습니다.");
});

ui.ttsEnabledInput.addEventListener("change", () => {
  audio.ttsEnabled = ui.ttsEnabledInput.checked;
  if (!audio.ttsEnabled) speechSynthesis.cancel();
  savePreferences();
});
ui.voiceSelect.addEventListener("change", () => {
  audio.selectedVoiceUri = ui.voiceSelect.value;
  savePreferences();
});
ui.ttsVolumeInput.addEventListener("input", () => {
  audio.ttsVolume = Number(ui.ttsVolumeInput.value);
  ui.ttsVolumeOutput.value = `${Math.round(audio.ttsVolume * 100)}%`;
  savePreferences();
});
ui.audioVolumeInput.addEventListener("input", () => {
  audio.setVolumes(Number(ui.audioVolumeInput.value), audio.ttsVolume);
  ui.audioVolumeOutput.value = `${Math.round(audio.audioVolume * 100)}%`;
  savePreferences();
});

document.querySelectorAll<HTMLButtonElement>("[data-test]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!audio.prepared) await prepareExam();
    const id = button.dataset.test!;
    const wasActive = audio.getActiveTestId() === id;
    ui.testStatus.textContent = wasActive ? "테스트 중지 중…" : `${button.textContent} 재생 중 · 같은 버튼을 다시 누르면 중지`;
    ui.stopTestButton.disabled = false;
    try {
      await audio.runTest(id);
      ui.testStatus.textContent = wasActive ? "테스트 중지됨" : "테스트 완료";
    } catch {
      ui.testStatus.textContent = "테스트 재생 실패 · 오디오 활성화를 확인하세요";
    } finally {
      if (!audio.getActiveTestId()) ui.stopTestButton.disabled = true;
    }
  });
});
ui.stopTestButton.addEventListener("click", () => {
  audio.stopTest();
  ui.stopTestButton.disabled = true;
  ui.testStatus.textContent = "테스트 중지됨";
});

ui.scheduleTomorrowButton.addEventListener("click", () => {
  const tomorrow = atLocalTime(new Date(), DEFAULT_END_HOUR, DEFAULT_END_MINUTE);
  tomorrow.setDate(tomorrow.getDate() + 1);
  newSession(tomorrow.getTime());
  ui.pastScheduleDialog.close();
});
ui.openEndedButton.addEventListener("click", () => {
  const todayEnd = atLocalTime(new Date(), DEFAULT_END_HOUR, DEFAULT_END_MINUTE);
  newSession(todayEnd.getTime(), SCHEDULE_EVENTS.map((event) => event.id));
  ui.pastScheduleDialog.close();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && audio.prepared && !wakeLock) void requestWakeLock();
  previousRemainingMs = getRemainingMs(session.endTimeMs, Date.now());
  render(Date.now());
});

function initializeDevTools(): void {
  if (new URLSearchParams(location.search).get("dev") !== "1") return;
  ui.devPanel.hidden = false;
  const points = [75, 70, 60, 10, 5, 1];
  for (const minutes of points) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${minutes}:00까지 1초`;
    button.addEventListener("click", () => newSession(Date.now() + minutes * MINUTE + 1_000));
    ui.devButtons.append(button);
  }
  const endButton = document.createElement("button");
  endButton.type = "button";
  endButton.textContent = "종료까지 3초";
  endButton.addEventListener("click", () => newSession(Date.now() + 3_000));
  ui.devButtons.append(endButton);
}

initializeSettings();
initializeSession();
initializeDevTools();
window.setInterval(timerTick, 200);
timerTick();

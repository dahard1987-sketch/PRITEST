export const LISTENING_AUDIO_URL = "./2026학년도 6월 2학년 영어 듣기평가.mp3";
export const ENDING_SONG_URL = "./시험종료송.mp3";

type SoundGroup = "live" | "test";

interface SoundHandle {
  finished: Promise<void>;
  stop: () => void;
}

interface ToneNote {
  frequency: number;
  start: number;
  duration: number;
  gain: number;
  waveform?: OscillatorType;
}

export const TICK_NOTES: readonly ToneNote[] = [
  { frequency: 783.99, start: 0, duration: 0.3, gain: 0.17 },
  { frequency: 659.25, start: 0.36, duration: 0.54, gain: 0.18 },
];

const jingleMelody: readonly ToneNote[] = [
  { frequency: 659.25, start: 0, duration: 0.34, gain: 0.12 },
  { frequency: 523.25, start: 0.46, duration: 0.34, gain: 0.12 },
  { frequency: 587.33, start: 0.92, duration: 0.34, gain: 0.12 },
  { frequency: 392, start: 1.38, duration: 0.58, gain: 0.13 },
  { frequency: 392, start: 2.02, duration: 0.34, gain: 0.12 },
  { frequency: 587.33, start: 2.48, duration: 0.34, gain: 0.12 },
  { frequency: 659.25, start: 2.94, duration: 0.34, gain: 0.12 },
  { frequency: 523.25, start: 3.4, duration: 0.78, gain: 0.14 },
];

// A quiet, slightly detuned octave partial gives the melody a bell-like school chime timbre.
export const JINGLE_NOTES: readonly ToneNote[] = jingleMelody.flatMap((note) => [
  note,
  { ...note, frequency: note.frequency * 2.01, gain: note.gain * 0.2 },
]);

export class AudioController {
  private context: AudioContext | null = null;
  private readonly liveNodes = new Set<OscillatorNode>();
  private readonly testNodes = new Set<OscillatorNode>();
  private activeTestCleanup: (() => void) | null = null;
  private activeTestId: string | null = null;
  private alertGeneration = 0;

  readonly listeningAudio = new Audio(LISTENING_AUDIO_URL);
  readonly endingAudio = new Audio(ENDING_SONG_URL);
  listeningPlaying = false;
  prepared = false;
  audioVolume = 0.85;
  ttsVolume = 0.9;
  ttsEnabled = true;

  constructor() {
    this.listeningAudio.preload = "auto";
    this.endingAudio.preload = "auto";
    this.listeningAudio.addEventListener("ended", () => {
      this.listeningPlaying = false;
    });
  }

  async prepare(): Promise<void> {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();

    // A zero-gain buffer unlocks the audio pipeline without making a test sound.
    const buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = 0;
    source.buffer = buffer;
    source.connect(gain).connect(this.context.destination);
    source.start();

    speechSynthesis.getVoices();
    this.listeningAudio.load();
    this.endingAudio.load();
    await Promise.all([this.waitForMetadata(this.listeningAudio), this.waitForMetadata(this.endingAudio)]);
    this.prepared = true;
  }

  private waitForMetadata(audio: HTMLAudioElement): Promise<void> {
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        window.clearTimeout(timeout);
        audio.removeEventListener("loadedmetadata", finish);
        audio.removeEventListener("error", finish);
        resolve();
      };
      const timeout = window.setTimeout(finish, 4_000);
      audio.addEventListener("loadedmetadata", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
    });
  }

  setVolumes(audioVolume: number, ttsVolume: number): void {
    this.audioVolume = audioVolume;
    this.ttsVolume = ttsVolume;
    this.listeningAudio.volume = audioVolume;
    this.endingAudio.volume = audioVolume;
  }

  async playListening(): Promise<void> {
    this.listeningAudio.pause();
    this.listeningAudio.currentTime = 0;
    this.listeningAudio.volume = this.audioVolume;
    this.listeningPlaying = true;
    try {
      await this.listeningAudio.play();
    } catch (error) {
      this.listeningPlaying = false;
      throw error;
    }
  }

  async playEndingSong(): Promise<void> {
    this.endingAudio.pause();
    this.endingAudio.currentTime = 0;
    this.endingAudio.volume = this.audioVolume;
    await this.endingAudio.play();
  }

  async playTimedAnnouncement(text: string): Promise<void> {
    const generation = ++this.alertGeneration;
    await this.playTick("live").finished;
    if (generation !== this.alertGeneration) return;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    if (generation !== this.alertGeneration || !this.ttsEnabled) return;
    await this.speak(text);
  }

  playTick(group: SoundGroup = "live"): SoundHandle {
    return this.makeToneSequence(TICK_NOTES, group);
  }

  playJingle(group: SoundGroup = "live"): SoundHandle {
    return this.makeToneSequence(JINGLE_NOTES, group);
  }

  private makeToneSequence(
    notes: readonly ToneNote[],
    group: SoundGroup,
  ): SoundHandle {
    let stopped = false;
    let resolveFinished: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });

    if (!this.context || this.context.state !== "running") {
      resolveFinished();
      return { finished, stop: () => undefined };
    }

    const nodeSet = group === "live" ? this.liveNodes : this.testNodes;
    const startAt = this.context.currentTime + 0.015;
    const created: OscillatorNode[] = [];
    notes.forEach((note, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      const noteStart = startAt + note.start;
      const noteEnd = noteStart + note.duration;
      oscillator.type = note.waveform ?? "sine";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(note.gain * this.audioVolume, noteStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain).connect(this.context!.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
      oscillator.addEventListener("ended", () => {
        nodeSet.delete(oscillator);
        if (index === notes.length - 1 && !stopped) resolveFinished();
      });
      nodeSet.add(oscillator);
      created.push(oscillator);
    });

    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const oscillator of created) {
        try { oscillator.stop(); } catch { /* already stopped */ }
        nodeSet.delete(oscillator);
      }
      resolveFinished();
    };
    return { finished, stop };
  }

  async speak(text: string): Promise<void> {
    if (!this.ttsEnabled || !("speechSynthesis" in window)) return;
    const voice = this.getGoogleKoreanVoice();
    if (!voice) return;

    speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ko-KR";
      utterance.voice = voice;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = this.ttsVolume;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  }

  getGoogleKoreanVoice(): SpeechSynthesisVoice | undefined {
    return speechSynthesis.getVoices().find((voice) =>
      voice.lang.toLowerCase().startsWith("ko") && voice.name.toLowerCase().includes("google"),
    );
  }

  stopAlerts(): void {
    this.alertGeneration += 1;
    speechSynthesis.cancel();
    for (const oscillator of [...this.liveNodes]) {
      try { oscillator.stop(); } catch { /* already stopped */ }
      this.liveNodes.delete(oscillator);
    }
  }

  stopTest(): void {
    this.activeTestCleanup?.();
    this.activeTestCleanup = null;
    this.activeTestId = null;
    for (const oscillator of [...this.testNodes]) {
      try { oscillator.stop(); } catch { /* already stopped */ }
      this.testNodes.delete(oscillator);
    }
  }

  getActiveTestId(): string | null {
    return this.activeTestId;
  }

  async runTest(id: string): Promise<void> {
    if (this.activeTestId === id) {
      this.stopTest();
      return;
    }
    this.stopTest();
    this.activeTestId = id;

    if (id === "listening" || id === "ending-song") {
      const audio = new Audio(id === "listening" ? LISTENING_AUDIO_URL : ENDING_SONG_URL);
      audio.volume = this.audioVolume;
      this.activeTestCleanup = () => {
        audio.pause();
        audio.currentTime = 0;
      };
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener("pause", () => resolve(), { once: true });
      });
    } else if (id === "tick") {
      const handle = this.playTick("test");
      this.activeTestCleanup = handle.stop;
      await handle.finished;
    } else if (id === "tts") {
      this.activeTestCleanup = () => speechSynthesis.cancel();
      await this.speak("안내 음성 테스트입니다");
    } else if (id === "jingle") {
      const handle = this.playJingle("test");
      this.activeTestCleanup = handle.stop;
      await handle.finished;
    } else if (id === "ending-sequence") {
      const handle = this.playJingle("test");
      this.activeTestCleanup = handle.stop;
      await handle.finished;
      if (this.activeTestId !== id) return;
      const audio = new Audio(ENDING_SONG_URL);
      audio.volume = this.audioVolume;
      this.activeTestCleanup = () => {
        audio.pause();
        audio.currentTime = 0;
      };
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener("pause", () => resolve(), { once: true });
      });
    }

    if (this.activeTestId === id) {
      this.activeTestId = null;
      this.activeTestCleanup = null;
    }
  }
}

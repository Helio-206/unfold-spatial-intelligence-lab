import { isApprovedExplanation, type ApprovedExplanation } from './explanation';

export type SpeechSettings = { language: 'pt-PT' | 'en'; voiceURI: string | null; rate: number };
export type SpeechState = 'idle' | 'playing' | 'paused';
export interface SpatialTtsPort {
  speak(text: string, settings: SpeechSettings, finished: () => void): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}

/** The host must cancel on selection, plan revision, Space and recognition changes. */
export class SpatialSpeechController {
  private generation = 0;
  private stateValue: SpeechState = 'idle';
  private disposed = false;
  constructor(private readonly port: SpatialTtsPort | null, private readonly stopRecognition: () => void, private readonly changed: (state: SpeechState) => void = () => {}) {}
  get state(): SpeechState { return this.stateValue; }
  get supported(): boolean { return this.port !== null; }
  play(explanation: ApprovedExplanation, settings: SpeechSettings): boolean {
    if (this.disposed || !this.port || !isApprovedExplanation(explanation) || !explanation.text.trim() || !Number.isFinite(settings.rate) || settings.rate < 0.5 || settings.rate > 2) return false;
    this.cancel();
    this.stopRecognition();
    const generation = this.generation;
    this.setState('playing');
    try { this.port.speak(explanation.text, settings, () => { if (!this.disposed && generation === this.generation) this.setState('idle'); }); }
    catch { this.cancel(); return false; }
    return true;
  }
  pause(): void { if (this.stateValue === 'playing') { this.port?.pause(); this.setState('paused'); } }
  resume(): void { if (this.stateValue === 'paused') { this.stopRecognition(); this.port?.resume(); this.setState('playing'); } }
  cancel(): void { this.generation++; this.port?.cancel(); this.setState('idle'); }
  dispose(): void { if (!this.disposed) { this.cancel(); this.disposed = true; } }
  private setState(state: SpeechState): void { if (this.stateValue !== state) { this.stateValue = state; this.changed(state); } }
}

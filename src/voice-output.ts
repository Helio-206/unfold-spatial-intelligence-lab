export type VoiceOutputPort = { cancel(): void; speak(text: string): void };

export class VoiceOutput {
  enabled = false;
  constructor(private readonly port: VoiceOutputPort | undefined, private readonly stopRecognition: () => void) {}
  get supported(): boolean { return this.port !== undefined; }
  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled && this.supported;
    if (!this.enabled) this.cancel();
    return this.enabled;
  }
  cancel(): void { this.port?.cancel(); }
  speak(text: string): void {
    if (!this.enabled || !this.port) return;
    this.stopRecognition();
    this.port.cancel();
    this.port.speak(text);
  }
}

export function browserVoiceOutput(stopRecognition: () => void): VoiceOutput {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return new VoiceOutput(undefined, stopRecognition);
  return new VoiceOutput({
    cancel: () => window.speechSynthesis.cancel(),
    speak: (text) => { const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'pt-PT'; window.speechSynthesis.speak(utterance); },
  }, stopRecognition);
}

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
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return new VoiceOutput(undefined, stopRecognition);
  return new VoiceOutput({
    cancel: () => window.speechSynthesis.cancel(),
    speak: (text) => { const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'pt-PT'; window.speechSynthesis.speak(utterance); },
  }, stopRecognition);
}

/** Browser implementation of the spatial TTS port. Voice lists may arrive asynchronously. */
export function browserSpatialTts(): import('./living/spatial-voice/speech').SpatialTtsPort | null {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return null;
  const synth = window.speechSynthesis;
  return {
    speak(text, settings, finished) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = settings.language;
      utterance.rate = settings.rate;
      const voices = synth.getVoices();
      const selected = settings.voiceURI && voices.find((voice) => voice.voiceURI === settings.voiceURI);
      const matching = voices.find((voice) => voice.lang.toLowerCase() === settings.language.toLowerCase());
      if (selected || matching) utterance.voice = selected || matching || null;
      utterance.onend = finished;
      utterance.onerror = finished;
      synth.speak(utterance);
    },
    pause: () => synth.pause(),
    resume: () => synth.resume(),
    cancel: () => synth.cancel(),
  };
}

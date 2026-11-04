export type VoiceStatus = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'EXECUTING' | 'COMPLETE' | 'ERROR';

interface SpeechRecognitionResultLike {
  readonly length: number;
  [index: number]: { readonly isFinal: boolean; readonly length: number; [index: number]: { readonly transcript: string } };
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const browserWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
}

export class BrowserVoiceInput {
  private recognition: SpeechRecognitionLike | undefined;
  private statusValue: VoiceStatus = 'IDLE';
  private processingCommand = false;

  constructor(private readonly handlers: {
    onStatus(status: VoiceStatus, message?: string): void;
    onTranscript(value: string): void;
    onCommand(value: string): Promise<boolean>;
  }) {}

  get supported(): boolean {
    return typeof window !== 'undefined' && Boolean(recognitionConstructor());
  }

  get status(): VoiceStatus {
    return this.statusValue;
  }

  start(): boolean {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      this.fail('Reconhecimento de voz não está disponível neste browser. Usa a entrada textual.');
      return false;
    }
    this.stop();
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = 'pt-PT';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => { if (this.recognition === recognition) this.setStatus('LISTENING'); };
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return;
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index][0]?.transcript ?? '').join(' ').trim();
      if (transcript) this.handlers.onTranscript(transcript);
      const finalResult = event.results[event.results.length - 1];
      if (!finalResult?.isFinal || !transcript) return;
      this.setStatus('PROCESSING');
      this.processingCommand = true;
      void this.handlers.onCommand(transcript).then((success) => {
        if (success) this.setStatus('COMPLETE');
        else this.fail('O comando não foi executado. Consulta o estado apresentado no workspace.');
      }).finally(() => { this.processingCommand = false; });
    };
    recognition.onerror = (event) => { if (this.recognition !== recognition) return; this.fail(event.error === 'not-allowed' ? 'Permissão do microfone recusada. Usa a entrada textual.' : `Falha de voz: ${event.error}.`); };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      if (this.statusValue === 'LISTENING') this.setStatus('IDLE');
      else if (this.statusValue === 'PROCESSING' && !this.processingCommand) this.setStatus('IDLE');
      this.recognition = undefined;
    };
    try {
      recognition.start();
      return true;
    } catch {
      this.fail('Não foi possível activar o microfone. Usa a entrada textual.');
      return false;
    }
  }

  stop(): void {
    if (!this.recognition) return;
    const recognition = this.recognition;
    this.recognition = undefined;
    recognition.abort();
    this.setStatus('IDLE');
  }

  finish(): void {
    if (!this.recognition) return;
    this.setStatus('PROCESSING', 'A finalizar a transcrição.');
    this.recognition.stop();
  }

  private setStatus(status: VoiceStatus, message?: string): void {
    this.statusValue = status;
    this.handlers.onStatus(status, message);
  }

  private fail(message: string): void {
    this.recognition?.abort();
    this.recognition = undefined;
    this.setStatus('ERROR', message);
  }
}

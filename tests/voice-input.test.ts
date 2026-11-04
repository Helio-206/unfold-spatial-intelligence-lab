import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserVoiceInput } from '../src/voice-input';

class MockRecognition {
  lang = '';
  interimResults = false;
  continuous = true;
  onstart: (() => void) | null = null;
  onresult: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  aborted = false;
  start(): void { this.started = true; this.onstart?.(); }
  stop(): void { this.stopped = true; }
  abort(): void { this.aborted = true; }
}

afterEach(() => vi.unstubAllGlobals());

describe('push-to-talk input adapter', () => {
  it('transcribes on release and sends the final transcript through the shared command handler', async () => {
    let recognition: MockRecognition | undefined;
    vi.stubGlobal('window', { SpeechRecognition: class extends MockRecognition { constructor() { super(); recognition = this; } } });
    const statuses: string[] = [];
    const command = vi.fn(async () => true);
    const voice = new BrowserVoiceInput({ onStatus: (status) => statuses.push(status), onTranscript: vi.fn(), onCommand: command });
    expect(voice.start()).toBe(true);
    expect(recognition?.lang).toBe('pt-PT');
    voice.finish();
    expect(recognition?.stopped).toBe(true);
    expect(recognition?.aborted).toBe(false);
    const results = [{ isFinal: true, 0: { transcript: 'Aumenta esta parede para cinco metros.' } }];
    recognition?.onresult?.({ results, resultIndex: 0 } as unknown as Event);
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('Aumenta esta parede para cinco metros.'));
    expect(statuses).toContain('PROCESSING');
    expect(statuses).toContain('COMPLETE');
  });

  it('aborts on cancellation and never dispatches an interim transcript', () => {
    let recognition: MockRecognition | undefined;
    vi.stubGlobal('window', { webkitSpeechRecognition: class extends MockRecognition { constructor() { super(); recognition = this; } } });
    const command = vi.fn(async () => true);
    const voice = new BrowserVoiceInput({ onStatus: vi.fn(), onTranscript: vi.fn(), onCommand: command });
    expect(voice.start()).toBe(true);
    voice.stop();
    expect(recognition?.aborted).toBe(true);
    const results = [{ isFinal: true, 0: { transcript: 'áudio obsoleto' } }];
    recognition?.onresult?.({ results, resultIndex: 0 } as unknown as Event);
    recognition?.onstart?.();
    expect(voice.status).toBe('IDLE');
    expect(command).not.toHaveBeenCalled();
  });
});

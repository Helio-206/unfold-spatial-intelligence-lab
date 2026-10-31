import { describe, expect, it, vi } from 'vitest';
import { VoiceOutput } from '../src/voice-output';

describe('voice output', () => {
  it('stops recognition before speaking and cancels speech on interruption or disable', () => {
    const calls: string[] = [];
    const output = new VoiceOutput({ cancel: () => calls.push('cancel'), speak: (text) => calls.push(`speak:${text}`) }, () => calls.push('stop-recognition'));
    output.setEnabled(true);
    output.speak('Resposta');
    expect(calls).toEqual(['stop-recognition', 'cancel', 'speak:Resposta']);
    output.cancel();
    output.setEnabled(false);
    expect(calls.slice(-2)).toEqual(['cancel', 'cancel']);
    output.speak('Não falar');
    expect(calls).not.toContain('speak:Não falar');
  });
  it('falls back to text when synthesis is unavailable', () => {
    const stop = vi.fn();
    const output = new VoiceOutput(undefined, stop);
    expect(output.setEnabled(true)).toBe(false);
    output.speak('Texto');
    expect(stop).not.toHaveBeenCalled();
  });
});

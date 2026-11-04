import { describe, expect, it, vi } from 'vitest';
import { SpatialSpeechController, type SpatialTtsPort } from '../src/living/spatial-voice/speech';
import { createSpatialExplanationContext } from '../src/living/spatial-voice/context';
import { explainSpatialContext } from '../src/living/spatial-voice/explanation';
import { microscopeLikeReply } from './fixtures/spatial-v2/handauthored';

describe('spatial speech controller', () => {
  it('stops recognition, cancels old playback and ignores stale completion', () => {
    const callbacks: Array<() => void> = [];
    const port: SpatialTtsPort = { speak: vi.fn((_text, _settings, done) => callbacks.push(done)), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    const stop = vi.fn(); const controller = new SpatialSpeechController(port, stop);
    const result = explainSpatialContext(createSpatialExplanationContext(microscopeLikeReply().plan, 'eyepiece', 'r1'));
    const settings = { language: 'pt-PT', voiceURI: null, rate: 1 } as const;
    expect(controller.play({ ...result, text: 'unvalidated' }, settings)).toBe(false);
    expect(controller.play(result, settings)).toBe(true);
    controller.pause(); expect(controller.state).toBe('paused');
    controller.resume(); expect(controller.state).toBe('playing');
    controller.play(result, settings); callbacks[0]!(); expect(controller.state).toBe('playing');
    callbacks[1]!(); expect(controller.state).toBe('idle');
    expect(stop).toHaveBeenCalledTimes(3);
    controller.dispose(); controller.dispose();
    expect(controller.play(result, settings)).toBe(false);
  });
  it('works silently without a TTS port', () => {
    const controller = new SpatialSpeechController(null, vi.fn());
    const result = explainSpatialContext(createSpatialExplanationContext(microscopeLikeReply().plan, null, 'r1'));
    expect(controller.play(result, { language: 'pt-PT', voiceURI: null, rate: 1 })).toBe(false);
    expect(controller.state).toBe('idle');
  });
});

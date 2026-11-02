import { describe, expect, it } from 'vitest';
import { clampOutput, planTiles } from '../src/rendering/hires';
import { adaptQuality, profileFor, QUALITY_PROFILES } from '../src/rendering/quality';
import { percentile, summariseFrames } from '../src/rendering/metrics';

describe('quality profiles', () => {
  it('technical is flat and cheap, presentation is detailed', () => {
    const t = profileFor('technical'), p = profileFor('presentation');
    expect([t.textures, t.shadows, t.environment, t.cornerFillers]).toEqual([false, false, false, false]);
    expect([p.textures, p.shadows, p.environment, p.cornerFillers]).toEqual([true, true, true, true]);
    expect(Object.keys(QUALITY_PROFILES)).toEqual(['technical', 'presentation']);
    expect(t.toneMapping).toBe('none');
  });
  it('adapts without flapping', () => {
    const slow = Array.from({ length: 60 }, () => 40), fast = Array.from({ length: 60 }, () => 5), middle = Array.from({ length: 60 }, () => 14);
    expect(adaptQuality('presentation', slow)).toBe('technical');
    expect(adaptQuality('technical', fast)).toBe('presentation');
    expect(adaptQuality('presentation', middle)).toBe('presentation');
    expect(adaptQuality('technical', middle)).toBe('technical');
    expect(adaptQuality('presentation', slow.slice(0, 5))).toBe('presentation');
  });
});

describe('high resolution planning', () => {
  it('tiles cover the output exactly once', () => {
    const plan = planTiles(3840, 2160, 1024);
    expect(plan).toHaveLength(4 * 3);
    expect(plan.reduce((sum, t) => sum + t.w * t.h, 0)).toBe(3840 * 2160);
    const seen = new Set(plan.map((t) => `${t.x},${t.y}`)); expect(seen.size).toBe(plan.length);
    expect(plan.at(-1)).toEqual({ x: 3072, y: 2048, w: 768, h: 112 });
  });
  it('clamps by side and by pixel count, keeping the aspect ratio', () => {
    expect(clampOutput(3840, 2160, 16384, 120e6)).toEqual({ width: 3840, height: 2160, clamped: false });
    const big = clampOutput(30000, 16875, 16384, 120e6);
    expect(big.clamped).toBe(true);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(16384); expect(big.width * big.height).toBeLessThanOrEqual(120e6);
    expect(big.width / big.height).toBeCloseTo(30000 / 16875, 2);
  });
});

describe('metrics helpers', () => {
  it('summarises frame times', () => {
    expect(percentile([1, 2, 3, 4, 100], 0.5)).toBe(3);
    const s = summariseFrames([16, 16, 16, 32]); expect(s.frames).toBe(4); expect(s.worstMs).toBe(32); expect(s.fps).toBeCloseTo(1000 / 20, 0);
  });
});

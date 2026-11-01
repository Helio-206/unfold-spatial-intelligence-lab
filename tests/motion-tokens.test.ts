import { describe, expect, it } from 'vitest';
import { CSS_EASE, DURATION, EASE, applyMotionTokens } from '../src/motion/tokens';
import { stepsHeaderHtml, STEPS } from '../src/steps-header';

describe('motion tokens', () => {
  it('has exactly three durations, ordered, and two curves', () => {
    expect(Object.keys(DURATION)).toEqual(['fast', 'base', 'slow']);
    expect(DURATION.fast).toBeLessThan(DURATION.base);
    expect(DURATION.base).toBeLessThan(DURATION.slow);
    expect(Object.keys(EASE)).toEqual(['out', 'inOut']);
    expect(Object.keys(CSS_EASE)).toEqual(['out', 'inOut']);
  });
  it('keeps UI durations inside the 300-600 ms band for the default change of state', () => {
    expect(DURATION.base * 1000).toBeGreaterThanOrEqual(300);
    expect(DURATION.base * 1000).toBeLessThanOrEqual(600);
  });
  it('exposes the tokens to CSS', () => {
    const set = new Map<string, string>();
    applyMotionTokens({ style: { setProperty: (k: string, v: string) => set.set(k, v) } } as unknown as HTMLElement);
    expect([...set.keys()].sort()).toEqual(['--dur-base', '--dur-fast', '--dur-slow', '--ease-in-out', '--ease-out']);
    expect(set.get('--dur-base')).toBe('420ms');
  });
});

describe('steps header', () => {
  it('renders the six steps, marks the active one and disables the one without a screen', () => {
    const html = stepsHeaderHtml('experiment');
    expect(STEPS).toHaveLength(6);
    expect((html.match(/class="sh-step/g) ?? []).length).toBe(6);
    expect(html).toContain('aria-current="page"');
    expect(html.match(/is-active/g)?.length).toBe(1);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('/circuit');
  });
  it('is identical across screens except for the active step', () => {
    const strip = (html: string) => html.replace(/ is-active/g, '').replace(/ aria-current="page"/g, '');
    expect(strip(stepsHeaderHtml('unfold'))).toBe(strip(stepsHeaderHtml('experiment')));
  });
});

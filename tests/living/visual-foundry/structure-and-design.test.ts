/**
 * Structural rules for the prototype, checked from source: imports (not words), design-system compliance of the CSS,
 * and motion taken from the motion tokens.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduleSpecifiers } from '../../helpers/module-specifiers';

const ROOTS = ['src/living/visual-foundry', 'src/living/workspace-design'];
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const all = ROOTS.flatMap((r) => files(resolve(r)));
const ts = all.filter((f) => f.endsWith('.ts'));

describe('module boundaries', () => {
  it('never imports server code, node built-ins or the architectural editor', () => {
    for (const f of ts) {
      for (const spec of moduleSpecifiers(f, readFileSync(f, 'utf8'))) {
        expect(spec, relative(process.cwd(), f)).not.toMatch(/^node:|\/server\/|spatial-editor|plan-|room-merge|wall-removal|<dynamic>/);
      }
    }
  });
  it('the visual foundry does not depend on the workspace (renderer stays reusable)', () => {
    for (const f of ts.filter((x) => x.includes('visual-foundry'))) for (const spec of moduleSpecifiers(f, readFileSync(f, 'utf8'))) expect(spec).not.toMatch(/workspace-design/);
  });
  it('talks to the intelligence only through the existing spatial-agent contract', () => {
    const imports = ts.flatMap((f) => moduleSpecifiers(f, readFileSync(f, 'utf8')));
    expect(imports.filter((s) => /spatial-agent$/.test(s)).length).toBeGreaterThan(0);
    for (const f of ts) expect(readFileSync(f, 'utf8')).not.toMatch(/MODEL_API_KEY\s*[=:]|graph\.facebook|api\.meta|llama-api/i);
  });
});

describe('design-system compliance', () => {
  const css = readFileSync(resolve('src/living/workspace-design/workspace.css'), 'utf8');
  it('uses tokens, not palette values', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
  it('does not redefine design-system variables', () => {
    for (const token of ['surface', 'surface-raised', 'surface-sunken', 'line', 'ink', 'ink-muted', 'fold', 'fold-ink', 'on-fold', 'laser', 'depth', 'focus-ring', 'font-sans', 'font-mono', 'radius-sm', 'radius-md', 'radius-lg']) {
      expect(css).not.toMatch(new RegExp(`--${token}\\s*:`));
    }
  });
  it('uses only Geist and Geist Mono, no shadows, glows or gradients', () => {
    expect(css).not.toMatch(/font-family:\s*(?!\s|var\()/);
    expect(css).not.toMatch(/Instrument Serif|Inter\b|JetBrains/);
    expect(css).not.toMatch(/box-shadow|text-shadow|drop-shadow|linear-gradient|radial-gradient|backdrop-filter/);
  });
  it('animates only with motion tokens', () => {
    const transitions = css.match(/transition[^;]*;/g) ?? [];
    for (const t of transitions) if (!/1ms/.test(t)) expect(t).not.toMatch(/\d+m?s\b/);
    expect(css).not.toMatch(/@keyframes|animation:\s*(?!\s|none)/);
    for (const f of ts) {
      const src = readFileSync(f, 'utf8');
      expect(src, relative(process.cwd(), f)).not.toMatch(/duration:\s*\d/);
      expect(src).not.toMatch(/ease:\s*['"]/);
    }
  });
  it('keeps the official logo file', () => {
    expect(readFileSync(resolve('src/living/workspace-design/workspace.ts'), 'utf8')).toContain('/design-system/logos/unfold-mark-on-dark.svg');
  });
});

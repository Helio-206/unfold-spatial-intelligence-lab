import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core';
import { validateMotionFrame, type MotionFrame } from '../../src/living/contracts';
import { buildExcavatorScenario, SCENARIO_SCHEMA } from '../../src/living/engineering/scenario';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const exported = read('../../src/living/engineering/fixtures/excavator.scenario.motion-sequence.json') as { schema: string; frames: Array<{ label: string; frame: MotionFrame }> };

describe('entrega aos visuais: a sequência exportada é a que o motor produz hoje', () => {
  it('o JSON versionado é idêntico, byte a byte (canónico), ao que o motor gera agora', () => {
    expect(canonicalize(exported)).toBe(canonicalize(buildExcavatorScenario()));
  });

  it('cada quadro exportado valida com validateMotionFrame e tem os identificadores exactos das partes', () => {
    expect(exported.schema).toBe(SCENARIO_SCHEMA);
    for (const { label, frame } of exported.frames) {
      expect(validateMotionFrame(frame), label).toEqual({ ok: true, issues: [] });
      expect(frame.parts.length, label).toBe(13);
    }
  });

  it('os instantes da sequência de movimento não recuam', () => {
    const times = exported.frames.filter((f) => f.label.includes(' · ') && !f.label.startsWith('exemplo')).map((f) => f.frame.timestampS);
    for (let i = 1; i < times.length; i += 1) expect(times[i]!, `i=${i}`).toBeGreaterThanOrEqual(times[i - 1]!);
  });

  it('inclui um exemplo bloqueado por curso e um bloqueado por colisão, cada um com o seu código e a pose de referência', () => {
    const blocked = exported.frames.filter((f) => f.frame.status === 'blocked');
    expect(blocked.map((f) => f.frame.blocked!.code).sort()).toEqual(['COLLISION', 'STROKE_OUT_OF_RANGE']);
    for (const f of blocked) expect(f.frame.poseBasis).toBe('reference');
  });

  it('nenhum quadro afirma força ou capacidade: são desconhecidas em todos os actuadores', () => {
    for (const { frame } of exported.frames) for (const a of frame.actuators) { expect(a.forceStatus).toBe('unknown'); expect(a.forceN).toBeNull(); }
  });
});

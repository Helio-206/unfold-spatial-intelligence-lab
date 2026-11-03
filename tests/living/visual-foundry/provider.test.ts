import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { loadFixturePreview } from '../../../src/living/visual-foundry/poses';
import { createExcavatorProvider } from '../../../src/living/visual-foundry/provider';
import { moduleSpecifiers } from '../../helpers/module-specifiers';

describe('high-fidelity geometry provider', () => {
  it('exposes one group per canonical part and canonical ids on every non display-only mesh', () => {
    const p = createExcavatorProvider(EXCAVATOR_ASSEMBLY_V1);
    for (const part of EXCAVATOR_ASSEMBLY_V1.parts) expect(p.parts.get(part.id)?.userData.partId).toBe(part.id);
    p.root.traverse((o) => { if ((o as Mesh).isMesh) expect(typeof o.userData.partId === 'string' || o.userData.displayOnly === true).toBe(true); });
    p.dispose();
  });

  it('applies validated frames and labels fixture frames as fixture, never engine', () => {
    const p = createExcavatorProvider(EXCAVATOR_ASSEMBLY_V1);
    const f = loadFixturePreview().frames.at(-1)!;
    const r = p.applyFrame(f);
    expect(r).toMatchObject({ status: 'applied', source: 'fixture', unknownPartIds: [] });
    const boom = f.parts.find((x) => x.partId === 'boom')!;
    expect(p.parts.get('boom')!.position.toArray()).toEqual(boom.translationM);
    p.dispose();
  });

  it('refuses invalid, blocked or foreign frames and keeps the current pose', () => {
    const p = createExcavatorProvider(EXCAVATOR_ASSEMBLY_V1);
    p.applyReferencePose();
    const before = p.parts.get('boom')!.position.toArray();
    const f = structuredClone(loadFixturePreview().frames.at(-1)!);
    expect(p.applyFrame({ ...f, schema: 'x' }).status).toBe('refused');
    expect(p.applyFrame({ ...f, assemblyId: 'other-assembly' })).toEqual({ status: 'refused', reason: 'ASSEMBLY_MISMATCH' });
    const blocked = { ...f, status: 'blocked', poseBasis: 'held_last_valid', blocked: { code: 'LIMIT', message: 'm', subjectIds: [], firstInvalidTimeS: null } };
    expect(p.applyFrame(blocked).status).toBe('refused');
    expect(p.parts.get('boom')!.position.toArray()).toEqual(before);
    p.dispose();
    expect(p.applyReferencePose()).toEqual({ status: 'refused', reason: 'PROVIDER_DISPOSED' });
  });

  it('does not depend on the workspace, the studio or the renderer', () => {
    const f = resolve('src/living/visual-foundry/provider.ts');
    const deps = moduleSpecifiers(f, readFileSync(f, 'utf8'));
    for (const d of deps) expect(d).not.toMatch(/workspace-design|studio|renderer|^node:/);
  });
});

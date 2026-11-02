import { describe, expect, it } from 'vitest';
import { validateMotionFrame, type Assembly, type Shape } from '../../src/living/contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { boxesOverlap, primitiveCollisionBackend, type CollisionInput } from '../../src/living/engineering/collision';
import { evaluateConfiguration, evaluateReferencePose } from '../../src/living/engineering/engine';
import { referenceConfiguration, solveForwardKinematics } from '../../src/living/engineering/forward-kinematics';
import { type Rigid } from '../../src/living/engineering/transform-math';
import type { CollisionBackend } from '../../src/living/engineering/collision';

const clone = (): Assembly => structuredClone(EXCAVATOR_ASSEMBLY_V1);
const box = (center: [number, number, number], half: [number, number, number], rotZ = 0): { world: Rigid; half: [number, number, number] } => ({
  world: { t: center, q: [0, 0, Math.sin(rotZ / 2), Math.cos(rotZ / 2)] }, half,
});

describe('sobreposição de caixas orientadas (eixos de separação, SAT)', () => {
  it('duas caixas afastadas não se tocam', () => {
    expect(boxesOverlap(box([0, 0, 0], [1, 1, 1]), box([2.1, 0, 0], [1, 1, 1]))).toEqual({ overlap: false, depthM: 0 });
  });
  it('duas caixas alinhadas sobrepostas em 0,2 m têm profundidade 0,2 m', () => {
    const r = boxesOverlap(box([0, 0, 0], [1, 1, 1]), box([1.8, 0, 0], [1, 1, 1]));
    expect(r.overlap).toBe(true);
    expect(r.depthM).toBeCloseTo(0.2, 12);
  });
  it('uma caixa rodada 45° em torno de Z toca a outra num canto: profundidade pela diagonal', () => {
    const diag = Math.SQRT2; // meia-diagonal de um quadrado de meia-aresta 1
    const touching = boxesOverlap(box([0, 0, 0], [1, 1, 1]), box([2 * diag - 0.5, 0, 0], [1, 1, 1], Math.PI / 4));
    expect(touching.overlap).toBe(true);
    expect(touching.depthM).toBeGreaterThan(0);
    expect(touching.depthM).toBeLessThan(0.6);
    expect(boxesOverlap(box([0, 0, 0], [1, 1, 1]), box([3.2, 0, 0], [1, 1, 1], Math.PI / 4)).overlap).toBe(false);
  });
  it('encostar exactamente (sem penetração) não conta como colisão', () => {
    expect(boxesOverlap(box([0, 0, 0], [1, 1, 1]), box([2, 0, 0], [1, 1, 1])).overlap).toBe(false);
  });
});

describe('revisão: contacto sem profundidade conhecida (null) não faz rebentar a formatação', () => {
  const unknownDepth: CollisionBackend = {
    name: 'teste-profundidade-desconhecida', version: '0',
    check: () => ({ checked: true, shapesChecked: [], shapesSkipped: [], groundPlaneChecked: false, contacts: [{ kind: 'part_ground', partIds: ['boom'], shapeIds: ['boom-box'], depthM: null }] }),
  };
  it('com a política block, o quadro fica bloqueado por COLLISION com a profundidade dita desconhecida', () => {
    const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1, { collisionBackend: unknownDepth });
    expect(frame).toMatchObject({ status: 'blocked', blocked: { code: 'COLLISION' } });
    expect(frame.blocked!.message).toMatch(/profundidade desconhecida/);
    expect(validateMotionFrame(frame).ok).toBe(true);
  });
  it('com a política warn, o mesmo contacto é só um aviso e a pose de referência continua ok', () => {
    const warn = clone();
    warn.collision = { ...warn.collision, onContact: 'warn' };
    const frame = evaluateReferencePose(warn, { collisionBackend: unknownDepth });
    expect(frame.status).toBe('ok');
    expect(frame.warnings.find((w) => w.code === 'COLLISION')!.message).toMatch(/profundidade desconhecida/);
  });
});

describe('colisões na referência: o que se verifica e o que não se verifica, com razão', () => {
  const input = (assembly: Assembly): CollisionInput => ({
    assembly, state: solveForwardKinematics(assembly, referenceConfiguration(assembly)),
  });

  it('o relatório diz quais formas foram verificadas e quais não, com razão para cada uma', () => {
    const report = primitiveCollisionBackend.check(input(EXCAVATOR_ASSEMBLY_V1));
    expect(report.checked).toBe(true);
    const all = EXCAVATOR_ASSEMBLY_V1.parts.flatMap((p) => p.shapes.map((s) => s.id));
    expect([...report.shapesChecked, ...report.shapesSkipped.map((s) => s.shapeId)].sort()).toEqual(all.sort());
    for (const skipped of report.shapesSkipped) expect(skipped.reason.length, skipped.shapeId).toBeGreaterThan(5);
    expect(report.shapesSkipped.some((s) => /visual/.test(s.reason))).toBe(true);
  });

  it('as formas visuais (os balancés) não entram na verificação de colisões', () => {
    const report = primitiveCollisionBackend.check(input(EXCAVATOR_ASSEMBLY_V1));
    expect(report.shapesChecked).not.toContain('idler-link-box');
    expect(report.shapesChecked).not.toContain('bucket-link-box');
  });

  it('a verificação do chão só corre nas partes que não estão na lista de isenção (chassis e caçamba)', () => {
    const report = primitiveCollisionBackend.check(input(EXCAVATOR_ASSEMBLY_V1));
    expect(report.groundPlaneChecked).toBe(true);
    expect(report.contacts.filter((c) => c.kind === 'part_ground').flatMap((c) => c.partIds)).not.toContain('chassis');
    expect(report.contacts.filter((c) => c.kind === 'part_ground').flatMap((c) => c.partIds)).not.toContain('bucket');
  });

  it('a referência não tem contactos: com a política de bloqueio, a pose de referência continua ok', () => {
    const report = primitiveCollisionBackend.check(input(EXCAVATOR_ASSEMBLY_V1));
    expect(report.contacts).toEqual([]);
    expect(evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1).status).toBe('ok');
  });
});

describe('colisões no quadro: contactos reais, política de bloqueio e aviso', () => {
  it('uma montagem rebaixada até o corpo superior tocar o chão tem um contacto de chão, com profundidade', () => {
    const a = clone();
    a.root.pose.translationM = [0, -1.0, 0];
    const frame = evaluateConfiguration(a, referenceConfiguration(a));
    const ground = frame.collisions.contacts.filter((c) => c.kind === 'part_ground');
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.every((c) => c.depthM !== null && c.depthM > 0)).toBe(true);
    expect(frame.status).toBe('blocked');
    expect(frame.blocked!.code).toBe('COLLISION');
    expect(validateMotionFrame(frame).ok).toBe(true);
  });

  it('com a política "warn", o mesmo contacto só aparece como aviso e o quadro continua ok', () => {
    const a = clone();
    a.root.pose.translationM = [0, -1.0, 0];
    a.collision.onContact = 'warn';
    const frame = evaluateConfiguration(a, referenceConfiguration(a));
    expect(frame.status).toBe('ok');
    expect(frame.collisions.contacts.length).toBeGreaterThan(0);
    expect(frame.warnings.map((w) => w.code)).toContain('COLLISION');
  });

  it('um par listado em ignorePairs deixa de contar como contacto, e os outros pares continuam a contar', () => {
    // A caixa do chassis aumentada encosta à lança (não são vizinhos na árvore de juntas): contacto real de ~0,24 m.
    const withContact = (ignore: boolean) => {
      const a = clone();
      (a.parts.find((p) => p.id === 'chassis')!.shapes[0] as { halfExtentsM: number[] }).halfExtentsM = [2.5, 0.9, 2.0];
      a.collision = { ...a.collision, groundPlane: null, onContact: 'warn', ignorePairs: ignore ? [['chassis', 'boom']] : [] };
      return primitiveCollisionBackend.check({ assembly: a, state: solveForwardKinematics(a, referenceConfiguration(a)) }).contacts.filter((c) => c.kind === 'part_part');
    };
    const before = withContact(false);
    const after = withContact(true);
    expect(before.map((c) => c.partIds.slice().sort().join('|'))).toContain('boom|chassis');
    expect(after.map((c) => c.partIds.slice().sort().join('|'))).not.toContain('boom|chassis');
    expect(after.length).toBe(before.length - 1);
  });

  it('os cilindros não são verificados por inteiro (sem fio, sem malha): saltados, com a razão, nunca marcados como verificados', () => {
    const report = primitiveCollisionBackend.check({ assembly: EXCAVATOR_ASSEMBLY_V1, state: solveForwardKinematics(EXCAVATOR_ASSEMBLY_V1, referenceConfiguration(EXCAVATOR_ASSEMBLY_V1)) });
    const cylinderIds = EXCAVATOR_ASSEMBLY_V1.parts.flatMap((p) => p.shapes.filter((s: Shape) => s.kind === 'cylinder').map((s) => s.id));
    expect(cylinderIds.length).toBeGreaterThan(0);
    for (const id of cylinderIds) {
      expect(report.shapesChecked).not.toContain(id);
      expect(report.shapesSkipped.find((s) => s.shapeId === id)?.reason, id).toMatch(/cilindro/);
    }
  });
});

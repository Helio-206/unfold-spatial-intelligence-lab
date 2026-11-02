import { describe, expect, it } from 'vitest';
import { summarizeReport } from '../src/core';
import { planWallRemoval } from '../src/plan-scene';
import { describeScaleBasis, planRoomMerge } from '../src/room-merge';
import { describeRemovalCard, describeWallRemoval } from '../src/removal-preview';
import { serializeSceneTransaction, type PropertyProvenance, type SpatialSceneV1 } from '../src/spatial-scene';
import { mutateScene, nodeOf, sceneFromRooms, sharedWallId, type RoomSpec } from './helpers/rooms';

const AT = '2026-11-01T10:00:00.000Z';
const A: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const B: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
const confirmed = (validation: 'verified' | 'corrected', source: PropertyProvenance['source'] = 'user'): PropertyProvenance =>
  ({ source, validation, actor: 'reviewer', evidence: 'Medido em obra.', recordedAt: AT, ...(validation === 'corrected' ? { sourceValue: 'x' } : {}) });

const setup = (edit?: (scene: SpatialSceneV1) => void) => {
  const t = edit ? mutateScene(sceneFromRooms([A, B]), edit) : sceneFromRooms([A, B]);
  const wall = sharedWallId(t.scene, 'sala', 'cozinha');
  const result = planRoomMerge(t.scene, wall, AT);
  if (result.status !== 'merge') throw new Error(`sem fusão: ${result.status}`);
  const card = describeRemovalCard(describeWallRemoval(t.scene, wall)!, { ok: true, plan: planWallRemoval(t, wall, 'reviewer'), notice: '' });
  return { t, wall, result, card, rows: Object.fromEntries(card.rows.map((row) => [row.label, row])) };
};
const scaleCheck = (result: ReturnType<typeof setup>['result']) => result.report.checks.find((check) => check.id === 'architecture.room-merge.scale')!;
const mappingInput = (result: ReturnType<typeof setup>['result']) => result.report.inputs.find((input) => input.field === 'imageWorldMapping');

describe('a escala por trás da área calculada: escala fornecida pelo utilizador e por verificar', () => {
  it('a cena do editor traz a escala como «user» + «unreviewed»: é isso que o relatório lê', () => {
    const { t } = setup();
    expect(t.scene.imageWorldMapping!.provenance).toMatchObject({ source: 'user', validation: 'unreviewed' });
    expect(describeScaleBasis(t.scene)).toMatchObject({ state: 'unverified', source: 'user', validation: 'unreviewed' });
  });

  it('o cartão diz «área calculada: 21 m²» e que assenta numa escala fornecida pelo utilizador, por verificar', () => {
    const { rows } = setup();
    expect(rows['área calculada']!.value).toBe('21 m²');
    expect(rows['escala']).toMatchObject({ value: 'fornecida pelo utilizador · por verificar', tone: 'unknown' });
  });

  it('a conservação de área passa e a escala fica "unknown": a área conservada não prova que a escala esteja certa', () => {
    const { result } = setup();
    expect(result.report.checks.find((check) => check.id === 'architecture.room-merge.area')!.status).toBe('pass');
    expect(scaleCheck(result)).toMatchObject({ status: 'unknown' });
    expect(scaleCheck(result).reason).toMatch(/fornecida pelo utilizador/);
    expect(scaleCheck(result).reason).toMatch(/ninguém verificou/);
    expect(summarizeReport(result.report).status).toBe('unknown');
  });

  it('o relatório leva a escala como entrada, com a origem «human_entered» e a validação «unreviewed» (sem promoção)', () => {
    const { result } = setup();
    expect(mappingInput(result)).toMatchObject({ entityId: 'rooms', field: 'imageWorldMapping', origin: 'human_entered', validation: 'unreviewed' });
  });

  it('a área escrita na divisão nova diz de que escala depende', () => {
    const { result } = setup();
    expect(result.merged.component!.properties.area!.provenance.evidence).toMatch(/fornecida pelo utilizador, por verificar/);
    expect(result.merged.component!.properties.area!.provenance).toMatchObject({ source: 'derived', validation: 'unreviewed' });
  });
});

describe('escala verificada', () => {
  it.each(['verified', 'corrected'] as const)('com a escala %s e a geometria das divisões confirmada, a verificação passa e o cartão diz «verificada»', (validation) => {
    const { result, rows } = setup((scene) => {
      scene.imageWorldMapping!.provenance = confirmed(validation);
      for (const id of ['sala', 'cozinha']) nodeOf(scene, id).geometry!.provenance = confirmed('verified');
    });
    expect(scaleCheck(result).status).toBe('pass');
    expect(mappingInput(result)).toMatchObject({ origin: 'human_entered', validation });
    expect(rows['escala']).toMatchObject({ value: 'fornecida pelo utilizador · verificada' });
    expect(rows['escala']!.tone).toBeUndefined();
    expect(rows['geometria']).toMatchObject({ value: 'das duas divisões confirmada' });
    expect(rows['estrutura']).toMatchObject({ tone: 'unknown' });
  });

  it('escala verificada com geometria por rever: continua "unknown", e o motivo diz que é a geometria', () => {
    const { result, rows } = setup((scene) => { scene.imageWorldMapping!.provenance = confirmed('verified'); });
    expect(scaleCheck(result).status).toBe('unknown');
    expect(scaleCheck(result).reason).toMatch(/geometria das duas divisões ainda não foi revista/);
    expect(rows['escala']!.value).toBe('fornecida pelo utilizador · verificada');
    expect(rows['geometria']).toMatchObject({ value: 'das duas divisões por rever', tone: 'unknown' });
  });

  it('só uma das divisões com geometria confirmada não chega', () => {
    const { result } = setup((scene) => { scene.imageWorldMapping!.provenance = confirmed('verified'); nodeOf(scene, 'sala').geometry!.provenance = confirmed('verified'); });
    expect(scaleCheck(result).status).toBe('unknown');
  });

  it('escala vinda do documento técnico mas por rever não passa por verificada: o texto diz a origem', () => {
    const { rows, result } = setup((scene) => { scene.imageWorldMapping!.provenance = { source: 'technical_document', validation: 'unreviewed', recordedAt: AT, documentRef: { documentId: 'planta', schema: 'technical_document.v1' } }; });
    expect(rows['escala']!.value).toBe('lida do documento técnico · por verificar');
    expect(scaleCheck(result).status).toBe('unknown');
    expect(mappingInput(result)).toMatchObject({ origin: 'observed', validation: 'unreviewed' });
  });

  it('escala ambígua é por verificar', () => {
    const { rows } = setup((scene) => { scene.imageWorldMapping!.provenance = { ...scene.imageWorldMapping!.provenance, validation: 'ambiguous' }; });
    expect(rows['escala']!.value).toBe('fornecida pelo utilizador · por verificar');
  });

  it('escala rejeitada: a verificação falha e o cartão diz que a área não é fiável', () => {
    const { result, rows } = setup((scene) => { scene.imageWorldMapping!.provenance = { ...scene.imageWorldMapping!.provenance, validation: 'rejected' }; });
    expect(scaleCheck(result).status).toBe('fail');
    expect(summarizeReport(result.report).status).toBe('fail');
    expect(rows['escala']!.value).toMatch(/rejeitada/);
    expect(rows['escala']!.value).toMatch(/não é fiável/);
  });
});

describe('sem proveniência da escala', () => {
  it('sem calibração na cena a escala é desconhecida: nem «verificada» nem «por verificar»', () => {
    const { t, result, rows } = setup((scene) => { scene.imageWorldMapping = null; });
    expect(describeScaleBasis(t.scene)).toMatchObject({ state: 'unknown', source: null });
    expect(scaleCheck(result)).toMatchObject({ status: 'unknown' });
    expect(scaleCheck(result).reason).toMatch(/não tem calibração de escala/);
    expect(mappingInput(result)).toBeUndefined();
    expect(rows['escala']).toMatchObject({ value: 'desconhecida · sem calibração na cena', tone: 'unknown' });
    expect(rows['área calculada']!.value).toBe('21 m²');
    expect(result.merged.component!.properties.area!.provenance.evidence).toMatch(/não está registada/);
  });
});

describe('a escala não promove nada nem dá certeza que não existe', () => {
  it('o cartão nunca diz «verificada»/«confirmada» com a proveniência por rever, e nunca fala em segurança estrutural', () => {
    const { card } = setup();
    const text = card.rows.map((row) => `${row.label} ${row.value}`).join(' | ');
    expect(text).not.toMatch(/escala[^|]*verificada(?! )/);
    expect(text).not.toMatch(/confirmada/);
    expect(text).not.toMatch(/seguro|segura\b/);
    expect(card.rows.find((row) => row.label === 'estrutura')).toMatchObject({ value: 'desconhecida · sem dados estruturais' });
  });

  it('o texto do cartão acompanha o relatório: escala "unknown" no relatório ⇔ linha com tom "unknown" no cartão', () => {
    for (const edit of [undefined, (s: SpatialSceneV1) => { s.imageWorldMapping = null; }, (s: SpatialSceneV1) => { s.imageWorldMapping!.provenance = confirmed('verified'); }]) {
      const { result, rows } = setup(edit);
      expect(rows['escala']!.tone === 'unknown').toBe(describeScaleBasis(setup(edit).t.scene).state !== 'verified');
      expect(scaleCheck(result).status === 'pass' && rows['geometria']!.tone === 'unknown').toBe(false);
    }
  });

  it('planear a fusão não toca na proveniência da escala nem na cena', () => {
    const t = sceneFromRooms([A, B]);
    const before = serializeSceneTransaction(t);
    planWallRemoval(t, sharedWallId(t.scene, 'sala', 'cozinha'), 'reviewer');
    expect(serializeSceneTransaction(t)).toBe(before);
    expect(t.scene.imageWorldMapping!.provenance.validation).toBe('unreviewed');
  });
});

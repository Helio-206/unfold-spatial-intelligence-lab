import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core';
import { ASSEMBLY_SCHEMA, MOTION_FRAME_SCHEMA, assertAssembly, validateAssembly, validateMotionFrame, type Assembly } from '../../src/living/contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';

const json = (name: string) => JSON.parse(readFileSync(new URL(`../../src/living/contracts/fixtures/${name}`, import.meta.url), 'utf8'));
const clone = (): Assembly => structuredClone(EXCAVATOR_ASSEMBLY_V1);
const issues = (a: unknown) => validateAssembly(a).issues.map((issue) => issue.code);

describe('unfold.assembly.v1: o fixture da escavadora', () => {
  it('o módulo TypeScript e o JSON são o mesmo documento', () => {
    expect(canonicalize(json('excavator.assembly.v1.json'))).toBe(canonicalize(EXCAVATOR_ASSEMBLY_V1));
  });
  it('é válido e declara o schema, as unidades e o mundo', () => {
    expect(validateAssembly(EXCAVATOR_ASSEMBLY_V1)).toEqual({ ok: true, issues: [] });
    expect(EXCAVATOR_ASSEMBLY_V1.schema).toBe(ASSEMBLY_SCHEMA);
    expect(EXCAVATOR_ASSEMBLY_V1.units).toEqual({ length: 'm', angle: 'rad', time: 's' });
    expect(EXCAVATOR_ASSEMBLY_V1.frames.filter((frame) => frame.kind === 'world')).toHaveLength(1);
  });
  it('tem as partes, juntas e actuadores de uma escavadora', () => {
    expect(EXCAVATOR_ASSEMBLY_V1.parts.map((part) => part.role)).toEqual(expect.arrayContaining(['chassis', 'upper_body', 'boom', 'stick', 'bucket', 'cylinder_barrel', 'cylinder_rod', 'link']));
    expect(EXCAVATOR_ASSEMBLY_V1.actuators.map((a) => a.id)).toEqual(['swing_drive', 'boom_cylinder', 'stick_cylinder', 'bucket_cylinder']);
    expect(EXCAVATOR_ASSEMBLY_V1.joints.filter((joint) => joint.type === 'prismatic')).toHaveLength(3);
  });
  it('é um exemplo declarado: toda a proveniência é fixture + unreviewed, sem confirmações nem autorizações', () => {
    const text = JSON.stringify(EXCAVATOR_ASSEMBLY_V1);
    const provenances = [...text.matchAll(/"origin":"(\w+)","validation":"(\w+)"/g)];
    expect(provenances.length).toBeGreaterThan(100);
    expect(new Set(provenances.map((m) => `${m[1]}/${m[2]}`))).toEqual(new Set(['fixture/unreviewed']));
    expect(text).not.toContain('authorizationId');
  });
  it('não inventa massas nem dados hidráulicos: ficam null (desconhecidos)', () => {
    expect(EXCAVATOR_ASSEMBLY_V1.parts.every((part) => part.massKg === null)).toBe(true);
    for (const actuator of EXCAVATOR_ASSEMBLY_V1.actuators) if (actuator.kind === 'hydraulic_cylinder') expect(actuator.hydraulics).toEqual({ boreDiameter: null, rodDiameter: null, supplyPressure: null });
  });
  it('a pose de referência independente (script Python) tem uma entrada por parte, com quaterniões unitários', () => {
    const pose = json('excavator.reference-pose.json') as { parts: Array<{ partId: string; rotation: number[] }> };
    expect(pose.parts.map((p) => p.partId)).toEqual(EXCAVATOR_ASSEMBLY_V1.parts.map((p) => p.id));
    for (const p of pose.parts) expect(Math.hypot(...p.rotation)).toBeCloseTo(1, 12);
  });
});

describe('unfold.assembly.v1: o validador recusa o que não é uma montagem', () => {
  const cases: Array<[string, (a: Assembly) => void, string]> = [
    ['schema errado', (a) => { (a as { schema: string }).schema = 'unfold.assembly.v2'; }, 'SCHEMA_MISMATCH'],
    ['unidades em milímetros', (a) => { (a.units as { length: string }).length = 'mm'; }, 'INVALID_UNIT'],
    ['unidade errada num limite', (a) => { a.joints[1]!.limits!.min.unit = 'm'; }, 'INVALID_UNIT'],
    ['id duplicado', (a) => { a.parts[1]!.id = a.parts[0]!.id; }, 'DUPLICATE_ID'],
    ['id inválido', (a) => { a.parts[0]!.id = '1 chassis'; }, 'INVALID_ID'],
    ['quaternião não unitário', (a) => { a.joints[1]!.origin.rotation = [0, 0, 1, 1]; }, 'INVALID_QUATERNION'],
    ['número não finito', (a) => { a.joints[1]!.origin.translationM[0] = Number.NaN; }, 'INVALID_NUMBER'],
    ['proveniência em falta', (a) => { delete (a.joints[1]!.limits!.min as unknown as Record<string, unknown>).provenance; }, 'INVALID_PROVENANCE'],
    ['confirmado sem autorização', (a) => { a.joints[1]!.provenance.validation = 'verified'; }, 'INVALID_PROVENANCE'],
    ['limites invertidos', (a) => { const l = a.joints[1]!.limits!; [l.min.value, l.max.value] = [l.max.value, l.min.value]; }, 'INVALID_LIMITS'],
    ['referência fora dos limites', (a) => { a.joints[1]!.referenceValue!.value = 5; }, 'INVALID_LIMITS'],
    ['junta fixa com limites', (a) => { a.joints[0]!.type = 'fixed'; }, 'INVALID_LIMITS'],
    ['parte desconhecida numa junta', (a) => { a.joints[1]!.childPartId = 'fantasma'; }, 'UNKNOWN_REFERENCE'],
    ['dois pais', (a) => { a.joints[2]!.childPartId = 'upper_body'; }, 'INVALID_TREE'],
    ['parte desligada da raiz', (a) => { a.joints = a.joints.filter((j) => j.id !== 'boom_joint'); }, 'INVALID_TREE'],
    ['ponto desconhecido numa restrição', (a) => { a.constraints[0]!.a.pointId = 'nao_existe'; }, 'UNKNOWN_REFERENCE'],
    ['actuador com junta desconhecida', (a) => { (a.actuators[0] as { jointId: string }).jointId = 'nao_existe'; }, 'UNKNOWN_REFERENCE'],
    ['cilindro com a junta de curso trocada', (a) => { (a.actuators[1] as { slideJointId: string }).slideJointId = 'boom_joint'; }, 'INVALID_ACTUATOR'],
    ['curso invertido', (a) => { const c = a.actuators[1] as { stroke: { min: { value: number }; max: { value: number } } }; c.stroke.min.value = 5; }, 'INVALID_LIMITS'],
    ['transmissão com restrições a mais', (a) => { (a.actuators[1] as { drives: { constraintIds: string[] } }).drives.constraintIds.push('stick_cyl_closure'); }, 'INVALID_ACTUATOR'],
    ['referenciais estáticos em ciclo (A → B → A)', (a) => {
      const pose = a.frames[0]!.pose;
      a.frames.push({ id: 'fa', parentFrameId: 'fb', kind: 'static', pose, description: 'a' }, { id: 'fb', parentFrameId: 'fa', kind: 'static', pose, description: 'b' });
    }, 'INVALID_FRAME'],
    ['referencial estático que é pai de si próprio', (a) => { a.frames.push({ id: 'fa', parentFrameId: 'fa', kind: 'static', pose: a.frames[0]!.pose, description: 'a' }); }, 'INVALID_FRAME'],
    ['cadeia estática que não chega ao mundo (ciclo de três)', (a) => {
      const pose = a.frames[0]!.pose;
      a.frames.push({ id: 'fa', parentFrameId: 'fc', kind: 'static', pose, description: 'a' }, { id: 'fb', parentFrameId: 'fa', kind: 'static', pose, description: 'b' }, { id: 'fc', parentFrameId: 'fb', kind: 'static', pose, description: 'c' });
    }, 'INVALID_FRAME'],
    ['raiz colocada num referencial dentro de um ciclo', (a) => {
      const pose = a.frames[0]!.pose;
      a.frames.push({ id: 'fa', parentFrameId: 'fb', kind: 'static', pose, description: 'a' }, { id: 'fb', parentFrameId: 'fa', kind: 'static', pose, description: 'b' });
      a.root.frameId = 'fa';
    }, 'INVALID_FRAME'],
    ['sem referencial do mundo', (a) => { a.frames = []; }, 'INVALID_FRAME'],
    ['massa em falta (tem de ser null, não omitida)', (a) => { delete (a.parts[0] as Partial<Assembly['parts'][number]>).massKg; }, 'MISSING_FIELD'],
    ['política de colisão inválida', (a) => { (a.collision as { onContact: string }).onContact = 'ignore'; }, 'INVALID_ENUM'],
  ];
  it.each(cases)('%s', (_name, mutate, code) => {
    const assembly = clone();
    mutate(assembly);
    expect(issues(assembly)).toContain(code);
  });
  it('uma cadeia estática válida (filho depois do pai e pai depois do filho na lista) é aceite', () => {
    const assembly = clone(); const pose = assembly.frames[0]!.pose;
    assembly.frames.push({ id: 'site', parentFrameId: 'base', kind: 'static', pose, description: 'site' }, { id: 'base', parentFrameId: 'world', kind: 'static', pose, description: 'base' });
    expect(validateAssembly(assembly).ok).toBe(true);
  });
  it('não-objectos e assertAssembly', () => {
    expect(issues(null)).toEqual(['NOT_AN_OBJECT']);
    expect(issues([])).toEqual(['NOT_AN_OBJECT']);
    expect(() => assertAssembly({})).toThrow(/unfold\.assembly\.v1 inválido/);
    expect(assertAssembly(EXCAVATOR_ASSEMBLY_V1)).toBe(EXCAVATOR_ASSEMBLY_V1);
  });
});

describe('unfold.motion-frame.v1: o validador de quadros', () => {
  const frame = () => ({
    schema: MOTION_FRAME_SCHEMA, assemblyId: 'excavator-fixture-1', assemblyDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), index: 0, timestampS: 0, worldFrameId: 'world',
    status: 'ok', poseBasis: 'solved', parts: [{ partId: 'chassis', translationM: [0, 0, 0], rotation: [0, 0, 0, 1] }], joints: [], actuators: [], measurements: [], warnings: [], evidence: [], blocked: null,
    solver: { id: 'x', version: '1', method: 'm', status: 'solved', closureResidualM: 0, toleranceM: 1e-9, assumptions: ['a'] },
    collisions: { checked: true, shapesChecked: [], shapesSkipped: [], groundPlaneChecked: true, contacts: [] },
  });
  it('aceita um quadro bem formado', () => { expect(validateMotionFrame(frame())).toEqual({ ok: true, issues: [] }); });
  const bad: Array<[string, (f: ReturnType<typeof frame>) => void]> = [
    ['schema', (f) => { (f as { schema: string }).schema = 'x'; }],
    ['digest', (f) => { f.inputDigest = 'xyz'; }],
    ['instante negativo', (f) => { f.timestampS = -1; }],
    ['quaternião não unitário', (f) => { f.parts[0]!.rotation = [0, 0, 0, 2]; }],
    ['parte duplicada', (f) => { f.parts.push({ ...f.parts[0]! }); }],
    ['ok com bloqueio', (f) => { (f as { blocked: unknown }).blocked = { code: 'X' }; }],
    ['bloqueado sem explicação', (f) => { f.status = 'blocked'; }],
    ['montagem inválida com poses', (f) => { f.status = 'invalid_assembly'; (f as { blocked: unknown }).blocked = { code: 'X' }; }],
    ['pressupostos vazios', (f) => { f.solver.assumptions = []; }],
    ['medida desconhecida com valor', (f) => { (f.measurements as unknown[]).push({ id: 'm', status: 'unknown', value: 1 }); }],
  ];
  it.each(bad)('recusa: %s', (_name, mutate) => { const f = frame(); mutate(f); expect(validateMotionFrame(f).ok).toBe(false); });
});

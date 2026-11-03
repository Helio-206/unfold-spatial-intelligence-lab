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
    ['velocidade máxima nula', (a) => { (a.actuators[1] as unknown as { maxRate: { value: number } }).maxRate.value = 0; }, 'INVALID_NUMBER'],
    ['velocidade máxima negativa', (a) => { (a.actuators[1] as unknown as { maxRate: { value: number } }).maxRate.value = -0.1; }, 'INVALID_NUMBER'],
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
  type Frame = Record<string, any>;
  const frame = (): Frame => ({
    schema: MOTION_FRAME_SCHEMA, assemblyId: 'excavator-fixture-1', assemblyDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), index: 0, timestampS: 0, worldFrameId: 'world',
    status: 'ok', poseBasis: 'solved', parts: [{ partId: 'chassis', translationM: [0, 0, 0], rotation: [0, 0, 0, 1] }],
    joints: [{ jointId: 'boom_joint', value: 0.45, unit: 'rad', kind: 'commanded' }],
    actuators: [
      { actuatorId: 'boom_cylinder', kind: 'hydraulic_cylinder', value: 0.57, unit: 'm', lengthM: 2.75, withinLimits: true, forceN: null, forceStatus: 'unknown', forceReason: 'Sem parâmetros hidráulicos.' },
      { actuatorId: 'swing_drive', kind: 'rotary_drive', value: 0, unit: 'rad', lengthM: null, withinLimits: true, forceN: 1200, forceStatus: 'computed', forceReason: null },
    ],
    measurements: [
      { id: 'reach', label: 'Alcance', status: 'computed', value: 7.1, unit: 'm', method: 'FK', subjectIds: ['bucket'] },
      { id: 'load', label: 'Carga', status: 'unknown', value: null, unit: 'N', method: 'sem modelo', subjectIds: [] },
    ],
    warnings: [{ code: 'W', severity: 'info', message: 'm', subjectIds: ['boom'] }],
    evidence: [{ sourceId: 'src-excavator-fixture', locator: 'x' }], blocked: null,
    solver: { id: 'x', version: '1', method: 'm', status: 'solved', closureResidualM: 1e-15, toleranceM: 1e-9, assumptions: ['a'] },
    collisions: { checked: true, shapesChecked: ['boom-box'], shapesSkipped: [{ shapeId: 'c', reason: 'cilindro' }], groundPlaneChecked: true, contacts: [{ kind: 'part_part', partIds: ['a', 'b'], shapeIds: ['x', 'y'], depthM: 0.01 }] },
  });
  const blockedFrame = (basis = 'held_last_valid'): Frame => ({ ...frame(), status: 'blocked', poseBasis: basis, solver: { ...frame().solver, status: 'blocked' }, blocked: { code: 'JOINT_LIMIT_EXCEEDED', message: 'm', subjectIds: ['boom_joint'], firstInvalidTimeS: 1.5 } });
  const invalidFrame = (): Frame => ({ ...frame(), status: 'invalid_assembly', poseBasis: 'none', parts: [], solver: { ...frame().solver, status: 'invalid_assembly' }, blocked: { code: 'X', message: 'm', subjectIds: [], firstInvalidTimeS: null } });
  it('aceita um quadro ok, um bloqueado (pose retida ou de referência) e um de montagem inválida', () => {
    for (const f of [frame(), blockedFrame(), blockedFrame('reference'), invalidFrame()]) expect(validateMotionFrame(f)).toEqual({ ok: true, issues: [] });
  });
  it('aceita um bloqueado sem pose (poseBasis none, sem partes)', () => {
    const f = blockedFrame('none'); f.parts = [];
    expect(validateMotionFrame(f).ok).toBe(true);
  });
  const bad: Array<[string, (f: Frame) => void, Frame?]> = [
    ['schema', (f) => { f.schema = 'x'; }],
    ['digest', (f) => { f.inputDigest = 'xyz'; }],
    ['instante negativo', (f) => { f.timestampS = -1; }],
    ['quaternião não unitário', (f) => { f.parts[0].rotation = [0, 0, 0, 2]; }],
    ['parte duplicada', (f) => { f.parts.push({ ...f.parts[0] }); }],
    ['partes [null]', (f) => { f.parts = [null]; }],
    ['juntas [null]', (f) => { f.joints = [null]; }],
    ['actuadores [null]', (f) => { f.actuators = [null]; }],
    ['medidas [null]', (f) => { f.measurements = [null]; }],
    ['avisos [null]', (f) => { f.warnings = [null]; }],
    ['evidência [null]', (f) => { f.evidence = [null]; }],
    ['contactos [null]', (f) => { f.collisions.contacts = [null]; }],
    ['formas saltadas [null]', (f) => { f.collisions.shapesSkipped = [null]; }],
    ['junta sem jointId', (f) => { delete f.joints[0].jointId; }],
    ['junta com valor NaN', (f) => { f.joints[0].value = Number.NaN; }],
    ['junta com unidade desconhecida', (f) => { f.joints[0].unit = 'deg'; }],
    ['junta com kind desconhecido', (f) => { f.joints[0].kind = 'free'; }],
    ['junta duplicada', (f) => { f.joints.push({ ...f.joints[0] }); }],
    ['actuador com unidade que não condiz com o tipo (cilindro em rad)', (f) => { f.actuators[0].unit = 'rad'; }],
    ['actuador rotativo com lengthM', (f) => { f.actuators[1].lengthM = 1; }],
    ['cilindro sem lengthM', (f) => { f.actuators[0].lengthM = null; }],
    ['actuador com withinLimits que não é booleano', (f) => { f.actuators[0].withinLimits = 'sim'; }],
    ['actuador com kind desconhecido', (f) => { f.actuators[0].kind = 'pump'; }],
    ['actuador com valor infinito', (f) => { f.actuators[0].value = Infinity; }],
    ['força desconhecida com valor', (f) => { f.actuators[0].forceN = 5; }],
    ['força desconhecida sem razão', (f) => { f.actuators[0].forceReason = null; }],
    ['força calculada sem valor', (f) => { f.actuators[1].forceN = null; }],
    ['força calculada com razão de desconhecida', (f) => { f.actuators[1].forceReason = 'x'; }],
    ['actuador duplicado', (f) => { f.actuators.push({ ...f.actuators[0] }); }],
    ['medida sem método', (f) => { delete f.measurements[0].method; }],
    ['medida com unidade desconhecida', (f) => { f.measurements[0].unit = 'ft'; }],
    ['medida calculada com NaN', (f) => { f.measurements[0].value = Number.NaN; }],
    ['medida desconhecida com valor', (f) => { f.measurements[1].value = 1; }],
    ['medida com subjectIds que não é lista de strings', (f) => { f.measurements[0].subjectIds = [1]; }],
    ['medida com estado desconhecido', (f) => { f.measurements[0].status = 'maybe'; }],
    ['medida duplicada', (f) => { f.measurements.push({ ...f.measurements[0] }); }],
    ['solver sem id', (f) => { delete f.solver.id; }],
    ['solver com estado desconhecido', (f) => { f.solver.status = 'done'; }],
    ['solver com tolerância não positiva', (f) => { f.solver.toleranceM = 0; }],
    ['solver com resíduo negativo', (f) => { f.solver.closureResidualM = -1; }],
    ['solver com resíduo NaN', (f) => { f.solver.closureResidualM = Number.NaN; }],
    ['pressupostos vazios', (f) => { f.solver.assumptions = []; }],
    ['pressupostos que não são strings', (f) => { f.solver.assumptions = [1]; }],
    ['colisões sem shapesChecked', (f) => { delete f.collisions.shapesChecked; }],
    ['colisões com groundPlaneChecked em falta', (f) => { delete f.collisions.groundPlaneChecked; }],
    ['forma saltada sem razão', (f) => { delete f.collisions.shapesSkipped[0].reason; }],
    ['contacto com kind desconhecido', (f) => { f.collisions.contacts[0].kind = 'edge'; }],
    ['contacto part_part com uma só parte', (f) => { f.collisions.contacts[0].partIds = ['a']; }],
    ['contacto part_ground com duas partes', (f) => { f.collisions.contacts[0].kind = 'part_ground'; }],
    ['contacto com profundidade negativa', (f) => { f.collisions.contacts[0].depthM = -0.1; }],
    ['contacto com profundidade NaN', (f) => { f.collisions.contacts[0].depthM = Number.NaN; }],
    ['aviso sem código', (f) => { delete f.warnings[0].code; }],
    ['aviso com severidade desconhecida', (f) => { f.warnings[0].severity = 'fatal'; }],
    ['aviso sem mensagem', (f) => { f.warnings[0].message = ''; }],
    ['evidência sem sourceId', (f) => { f.evidence[0] = { locator: 'x' }; }],
    ['evidência com locator que não é string', (f) => { f.evidence[0].locator = 3; }],
    ['ok com bloqueio', (f) => { f.blocked = { code: 'X', message: 'm', subjectIds: [], firstInvalidTimeS: null }; }],
    ['ok com poseBasis held_last_valid', (f) => { f.poseBasis = 'held_last_valid'; }],
    ['ok com solver.status blocked', (f) => { f.solver.status = 'blocked'; }],
    ['ok com solver.status invalid_assembly', (f) => { f.solver.status = 'invalid_assembly'; }],
    ['solved com status blocked', (f) => { Object.assign(f, blockedFrame()); f.poseBasis = 'solved'; }],
    ['bloqueado sem explicação', (f) => { Object.assign(f, blockedFrame()); f.blocked = null; }],
    ['bloqueado com solver.status solved', (f) => { Object.assign(f, blockedFrame()); f.solver.status = 'solved'; }],
    ['bloqueado com solver.status invalid_assembly', (f) => { Object.assign(f, blockedFrame()); f.solver.status = 'invalid_assembly'; }],
    ['bloqueado com pose retida mas sem partes', (f) => { Object.assign(f, blockedFrame()); f.parts = []; }],
    ['bloqueado com poseBasis none mas com partes', (f) => { Object.assign(f, blockedFrame('none')); }],
    ['bloqueio sem código', (f) => { Object.assign(f, blockedFrame()); f.blocked.code = ''; }],
    ['bloqueio com subjectIds inválido', (f) => { Object.assign(f, blockedFrame()); f.blocked.subjectIds = [null]; }],
    ['bloqueio com firstInvalidTimeS negativo', (f) => { Object.assign(f, blockedFrame()); f.blocked.firstInvalidTimeS = -1; }],
    ['bloqueio com firstInvalidTimeS NaN', (f) => { Object.assign(f, blockedFrame()); f.blocked.firstInvalidTimeS = Number.NaN; }],
    ['montagem inválida com poses', (f) => { Object.assign(f, invalidFrame()); f.parts = frame().parts; }],
    ['montagem inválida com poseBasis reference', (f) => { Object.assign(f, invalidFrame()); f.poseBasis = 'reference'; }],
    ['montagem inválida com solver.status blocked', (f) => { Object.assign(f, invalidFrame()); f.solver.status = 'blocked'; }],
    ['montagem inválida sem bloqueio', (f) => { Object.assign(f, invalidFrame()); f.blocked = null; }],
    ['poseBasis solved com status blocked e solver solved', (f) => { f.status = 'blocked'; f.blocked = { code: 'X', message: 'm', subjectIds: [], firstInvalidTimeS: null }; }],
    ['índice fraccionário', (f) => { f.index = 1.5; }],
    ['sem blocked (campo em falta)', (f) => { delete f.blocked; }],
  ];
  it.each(bad)('recusa: %s', (_name, mutate) => { const f = frame(); mutate(f); expect(validateMotionFrame(f).ok).toBe(false); });
  it('as razões apontam o caminho do campo em falta', () => {
    const f = frame(); delete f.joints[0].jointId;
    expect(validateMotionFrame(f).issues.map((i) => i.path)).toContain('$.joints[0].jointId');
  });
  it('não-objectos', () => { expect(validateMotionFrame(null).ok).toBe(false); expect(validateMotionFrame([]).ok).toBe(false); });
});

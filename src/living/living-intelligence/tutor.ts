/** Tutor espacial: explicações ancoradas em entidades reais da LivingScene activa. */
import type { Assembly } from '../contracts';
import { entityById, relatedEntities, type LivingScene } from './contracts';
import { behavioursFor } from './behaviours';

export type ExplanationLevel = 'beginner' | 'intermediate' | 'technical';
export type Explanation = {
  entityId: string; label: string; level: ExplanationLevel;
  what: string; purpose: string; howItWorks: string; dependencies: string[];
  whenItMoves: string; unknowns: string[]; evidenceNote: string;
};
export type WalkthroughStep = { index: number; entityId: string; title: string; text: string; actuatorId: string | null; actuatorTarget: number | null };
export type Walkthrough = { id: string; title: string; steps: WalkthroughStep[] };

const ROLE_PURPOSE: Record<string, { purpose: string; how: string; moves: string }> = {
  chassis: { purpose: 'Suporta a máquina e distribui o peso pelo solo através das lagartas.', how: 'É a base fixa desta cena; as outras partes montam-se sobre ele.', moves: 'Nesta cena o chassis não roda; sustenta o corpo superior.' },
  upper_body: { purpose: 'Carrega a lança e pode rodar sobre o chassis (swing), apontando o braço para onde se trabalha.', how: 'Roda em torno do eixo vertical da junta de swing dentro dos limites declarados.', moves: 'Ao rodar, leva consigo lança, braço, caçamba e cilindros.' },
  boom: { purpose: 'É o primeiro braço: levanta e baixa o conjunto braço+caçamba, definindo grande parte da altura e do alcance.', how: 'Roda no pino da base quando o cilindro da lança estende ou retrai.', moves: 'Subir a lança levanta também o braço e a caçamba que dela pendem.' },
  stick: { purpose: 'É o segundo braço: aproxima e afasta a caçamba da máquina.', how: 'Roda na extremidade da lança, accionado pelo cilindro do braço.', moves: 'Ao mover-se, desloca a caçamba e o seu cilindro.' },
  bucket: { purpose: 'É a ferramenta: escava, recolhe e despeja material.', how: 'Roda na ponta do braço (curl/dump), accionada pelo cilindro da caçamba através do balancé.', moves: 'Rodar a caçamba muda a orientação da abertura sem mover o resto da máquina.' },
  cylinder_barrel: { purpose: 'É o corpo fixo do cilindro hidráulico: contém o êmbolo e liga-se por um pino à estrutura.', how: 'Fica ancorado num pino; a haste desliza dentro dele.', moves: 'O barril roda ligeiramente em torno do seu pino para acompanhar o movimento.' },
  cylinder_rod: { purpose: 'É a haste do cilindro: transmite a força ao pino da parte accionada.', how: 'Desliza para fora ou para dentro do barril (junta prismática) e empurra/puxa o pino.', moves: 'Estender a haste afasta os dois pinos e roda a parte accionada.' },
  link: { purpose: 'Transmite o movimento do cilindro à caçamba mantendo os pinos coincidentes.', how: 'Barra rígida ligada por pinos; o seu movimento resulta do fecho do laço mecânico.', moves: 'Move-se apenas como consequência do cilindro e da caçamba.' },
  other: { purpose: 'Parte da montagem sem papel funcional específico declarado nesta cena.', how: 'O seu movimento, se existir, vem das juntas declaradas.', moves: 'Segue a hierarquia de juntas declarada.' },
};

export function explainEntity(scene: LivingScene, assembly: Assembly, entityId: string, level: ExplanationLevel = 'beginner'): Explanation | null {
  const e = entityById(scene, entityId); if (!e) return null;
  const roleInfo = ROLE_PURPOSE[e.role] ?? ROLE_PURPOSE.other!;
  const related = relatedEntities(scene, assembly, entityId);
  const behaviours = behavioursFor(scene, assembly).filter(b => b.componentIds.includes(entityId));
  const unknowns = e.parameters.filter(p => p.status === 'unknown').map(p => p.label);
  for (const b of behaviours) for (const c of b.componentIds) { const ce = entityById(scene, c); if (ce) for (const p of ce.parameters.filter(p => p.status === 'unknown')) if (!unknowns.includes(p.label)) unknowns.push(p.label); }
  const actuator = assembly.actuators.find(a => a.id === entityId);
  let purpose = roleInfo.purpose, how = roleInfo.how, moves = roleInfo.moves;
  if (actuator?.kind === 'hydraulic_cylinder') {
    const driven = assembly.joints.find(j => j.id === actuator.drives.jointId);
    purpose = `Converte pressão hidráulica em movimento linear da haste, que roda ${driven?.childPartId ?? 'a parte accionada'} em torno do seu pino.`;
    how = `A haste desliza no barril entre ${actuator.stroke.min.value} m e ${actuator.stroke.max.value} m de curso; a geometria dos pinos transforma esse curso em ângulo da junta ${actuator.drives.jointId}.`;
    moves = 'Estender levanta/empurra a parte accionada; retrair faz o inverso. Os descendentes acompanham pela hierarquia.';
  }
  if (level === 'technical') {
    const caps = e.capabilities.map(c => `${c.jointId} ${c.kind} [${c.min ?? '?'}, ${c.max ?? '?'}] ${c.unit} (${c.status})`).join('; ') || 'sem capacidade de movimento declarada';
    how += ` Capacidades declaradas: ${caps}. Nível de evidência desta cena: ${scene.evidenceLevel} — cinemática verificada pelo motor, sem validação física (sem massas, pressões ou materiais confirmados).`;
  }
  if (level === 'beginner') { purpose = purpose.split('.')[0] + '.'; }
  return {
    entityId, label: e.label, level, what: `${e.label} (${e.id}) — papel: ${e.role}.`, purpose, howItWorks: how,
    dependencies: related.map(r => `${r.label} (${r.id})`),
    whenItMoves: moves, unknowns,
    evidenceNote: `Proveniência: ${e.review.origin}/${e.review.validation}${e.review.reviewed ? ' (revisto)' : ' (não revisto)'}. Nada aqui afirma capacidade de elevação nem segurança estrutural.`,
  };
}

export function whoMoves(scene: LivingScene, assembly: Assembly, entityId: string): { movers: string[]; text: string } | null {
  const e = entityById(scene, entityId); if (!e) return null;
  const movers: string[] = [];
  for (const a of assembly.actuators) {
    const drivenJoint = a.kind === 'hydraulic_cylinder' ? a.drives.jointId : a.jointId;
    const joint = assembly.joints.find(j => j.id === drivenJoint);
    if (joint?.childPartId === entityId || (a.kind === 'hydraulic_cylinder' && (a.barrelPartId === entityId || a.rodPartId === entityId))) movers.push(`${a.label} (${a.id})`);
  }
  if (e.jointId && !movers.length) movers.push(`a junta ${e.jointId} (sem actuador declarado)`);
  return { movers, text: movers.length ? `${e.label} é movido por: ${movers.join(', ')}.` : `Nenhum actuador declarado move ${e.label} nesta cena.` };
}

export function buildWalkthrough(scene: LivingScene, assembly: Assembly): Walkthrough {
  const steps: WalkthroughStep[] = [];
  const add = (entityId: string, title: string, text: string, actuatorId: string | null = null, actuatorTarget: number | null = null) => {
    if (entityById(scene, entityId)) steps.push({ index: steps.length, entityId, title, text, actuatorId, actuatorTarget });
  };
  add('chassis', 'A base', 'Tudo assenta no chassis. É a referência fixa desta demonstração.');
  add('upper_body', 'O corpo que roda', 'O corpo superior roda sobre o chassis para apontar o braço.');
  const boomCyl = assembly.actuators.find(a => a.id === 'boom_cylinder');
  add('boom_cylinder', 'O cilindro da lança', 'Ao estender, a haste empurra o pino da lança e esta sobe. Veja o movimento ligado.', 'boom_cylinder', boomCyl?.kind === 'hydraulic_cylinder' ? Math.min(boomCyl.stroke.max.value, boomCyl.referenceStroke.value + 0.3) : null);
  add('boom', 'A lança sobe', 'A lança roda no pino da base e leva consigo o braço e a caçamba.');
  add('stick_cylinder', 'O cilindro do braço', 'Este cilindro roda o braço na ponta da lança, aproximando ou afastando a caçamba.', 'stick_cylinder', null);
  add('stick', 'O braço', 'O braço é o segundo segmento: define quanto a caçamba se afasta da máquina.');
  add('bucket_cylinder', 'O cilindro da caçamba', 'Acciona a caçamba através do balancé de duas barras, mantendo os pinos coincidentes.', 'bucket_cylinder', null);
  add('bucket', 'A caçamba', 'A ferramenta final: roda para escavar, recolher e despejar (curl/dump).');
  if (!steps.length) for (const e of scene.entities.slice(0, 6)) add(e.id, e.label, explainEntity(scene, assembly, e.id)?.purpose ?? e.label);
  return { id: `walkthrough:${assembly.id}`, title: `Como funciona: ${assembly.title}`, steps };
}

export class WalkthroughPlayer {
  index = 0; paused = false;
  constructor(readonly walkthrough: Walkthrough) {}
  current(): WalkthroughStep | null { return this.walkthrough.steps[this.index] ?? null; }
  next(): WalkthroughStep | null { if (this.index < this.walkthrough.steps.length - 1) this.index++; return this.current(); }
  previous(): WalkthroughStep | null { if (this.index > 0) this.index--; return this.current(); }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  restart() { this.index = 0; this.paused = false; return this.current(); }
  get finished() { return this.index >= this.walkthrough.steps.length - 1; }
}

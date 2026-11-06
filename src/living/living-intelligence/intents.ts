/**
 * Intérprete offline de comandos (PT/EN). Determinístico, sem inferência paga.
 * O intérprete resolve intenções contra IDs reais; quem executa é o motor determinístico.
 * Texto de modelo externo nunca chega aqui como comando executável: só este tipo validado executa.
 */
import type { Assembly } from '../contracts';
import { entityById, type LivingScene } from './contracts';

export type InteractionCommand =
  | { type: 'show'; entityId: string }
  | { type: 'explain'; entityId: string; level: 'beginner' | 'intermediate' | 'technical' }
  | { type: 'who_moves'; entityId: string }
  | { type: 'move_actuator'; actuatorId: string; direction: 'extend' | 'retract' | 'raise' | 'lower'; fraction: number }
  | { type: 'playback'; action: 'stop' | 'pause' | 'resume' | 'reset' | 'reverse' }
  | { type: 'walkthrough'; action: 'start' }
  | { type: 'limit_question'; entityId: string }
  | { type: 'propose_parameter'; description: string }
  | { type: 'unsupported'; reason: string }
  | { type: 'unknown_component'; text: string };

const SYNONYMS: Array<[RegExp, string[]]> = [
  [/lança|boom/i, ['boom']], [/braço|stick|arm(?!a)/i, ['stick']], [/caçamba|balde|bucket/i, ['bucket']],
  [/chassis|lagartas|undercarriage/i, ['chassis']], [/corpo superior|upper|swing/i, ['upper_body']],
  [/cilindro da lança|boom cylinder/i, ['boom_cylinder']], [/cilindro do braço|stick cylinder/i, ['stick_cylinder']],
  [/cilindro da caçamba|bucket cylinder/i, ['bucket_cylinder']], [/cilindro|cylinder|pistão|piston|haste/i, ['boom_cylinder', 'stick_cylinder', 'bucket_cylinder']],
  [/roda|wheel/i, ['wheel']], [/direc|steering|volante/i, ['steer_knuckle', 'steering']],
  [/porta|door/i, ['door_leaf', 'door']], [/balancé|idler|link/i, ['idler_link']],
];

export function resolveEntityId(scene: LivingScene, text: string): string | null {
  const direct = scene.entities.find(e => text.toLowerCase().includes(e.id.replace(/_/g, ' ')) || text.toLowerCase().includes(e.label.toLowerCase()));
  if (direct) return direct.id;
  for (const [re, ids] of SYNONYMS) if (re.test(text)) { const hit = ids.find(id => entityById(scene, id)); if (hit) return hit; }
  // papel: "a lança" pode resolver por role quando o id difere
  for (const [re] of SYNONYMS) if (re.test(text)) { const byRole = scene.entities.find(e => re.test(e.role) || re.test(e.label)); if (byRole) return byRole.id; }
  return null;
}

export function parseIntent(scene: LivingScene, raw: string): InteractionCommand {
  const text = raw.trim();
  if (!text) return { type: 'unsupported', reason: 'Comando vazio.' };
  if (/\b(apaga|apagar|elimina|destrói|grava por cima|substitui o plano|delete|destroy)\b/i.test(text))
    return { type: 'unsupported', reason: 'Acção destrutiva ou autoritativa recusada: alterações autoritativas exigem o processo de revisão existente.' };
  if (/(muda|altera|alterar|mudar|change|modify).*(comprimento|length|tamanho|dimens)/i.test(text) || /what if i change|e se (eu )?(mudar|alterar)/i.test(text))
    return { type: 'propose_parameter', description: text };
  if (/\b(para|parar|stop)\b/i.test(text) && /(anima|movimento|animation)/i.test(text)) return { type: 'playback', action: 'stop' };
  if (/^\s*(para|parar|stop|pausa|pause)\s*[.!]?\s*$/i.test(text)) return { type: 'playback', action: 'pause' };
  if (/(continua|continuar|resume|retoma)/i.test(text)) return { type: 'playback', action: 'resume' };
  if (/(recomeça|reinicia|reset|repõe|repor)/i.test(text)) return { type: 'playback', action: 'reset' };
  if (/(inverte|reverse|para trás|ao contrário)/i.test(text)) return { type: 'playback', action: 'reverse' };
  if (/(passo a passo|step by step|explica.*tudo|explain.*whole|como funciona.*(mecanismo|sistema|máquina)|how does.*work)/i.test(text) && !resolveEntityId(scene, text.replace(/cilindro hidráulico|hydraulic system/gi, '')))
    return { type: 'walkthrough', action: 'start' };
  const entityId = resolveEntityId(scene, text);
  if (/(que|o que|quais?|qual|which).*(move|acciona|aciona|faz mover|drives?)/i.test(text)) {
    return entityId ? { type: 'who_moves', entityId } : { type: 'unknown_component', text };
  }
  if (/(limite|limit|atinge|chega ao fim|reach.*limit)/i.test(text) && /(acontece|happens|se)/i.test(text)) {
    return entityId ? { type: 'limit_question', entityId } : { type: 'unknown_component', text };
  }
  if (/(estende|estender|extend|empurra)/i.test(text)) {
    const act = entityId && entityById(scene, entityId)?.role === 'actuator' ? entityId : (scene.entities.find(e => e.role === 'actuator' && /cilindro|cylinder/i.test(e.label + e.id))?.id ?? entityId);
    return act ? { type: 'move_actuator', actuatorId: act, direction: 'extend', fraction: 0.75 } : { type: 'unknown_component', text };
  }
  if (/(retrai|retrair|retract|encurta)/i.test(text)) {
    const act = entityId && entityById(scene, entityId)?.role === 'actuator' ? entityId : (scene.entities.find(e => e.role === 'actuator')?.id ?? entityId);
    return act ? { type: 'move_actuator', actuatorId: act, direction: 'retract', fraction: 0.25 } : { type: 'unknown_component', text };
  }
  if (/(roda|rodar|gira|girar|rotate|curl|dump|despeja|escava)/i.test(text)) {
    if (/caçamba|balde|bucket/i.test(text)) return { type: 'move_actuator', actuatorId: 'bucket_cylinder', direction: 'extend', fraction: 0.7 };
    if (entityId) { const e = entityById(scene, entityId); const act = e?.actuatorId ?? (e?.role === 'actuator' ? e.id : null); if (act) return { type: 'move_actuator', actuatorId: act, direction: 'extend', fraction: 0.7 }; }
    return { type: 'unknown_component', text };
  }
  if (/(levanta|sobe|raise|ergue)/i.test(text)) return { type: 'move_actuator', actuatorId: entityById(scene, 'boom_cylinder') ? 'boom_cylinder' : (entityId ?? ''), direction: 'raise', fraction: 0.75 };
  if (/(baixa|desce|lower)/i.test(text)) return { type: 'move_actuator', actuatorId: entityById(scene, 'boom_cylinder') ? 'boom_cylinder' : (entityId ?? ''), direction: 'lower', fraction: 0.25 };
  if (/(mostra|mostrar|show|onde está|encontra|aponta|find)/i.test(text)) {
    return entityId ? { type: 'show', entityId } : { type: 'unknown_component', text };
  }
  if (/(o que|para que|explica|explain|what|função|faz\b|serve|como funciona|how)/i.test(text)) {
    if (!entityId) return /(hidráulico|hydraulic)/i.test(text) ? { type: 'walkthrough', action: 'start' } : { type: 'unknown_component', text };
    return { type: 'explain', entityId, level: /técnic|technical|detalhe/i.test(text) ? 'technical' : /interméd|intermediate/i.test(text) ? 'intermediate' : 'beginner' };
  }
  if (/(mostra como|show me how|demonstra|anima)/i.test(text)) {
    return entityId ? { type: 'move_actuator', actuatorId: entityById(scene, entityId)?.actuatorId ?? entityId, direction: 'extend', fraction: 0.75 } : { type: 'walkthrough', action: 'start' };
  }
  return entityId ? { type: 'show', entityId } : { type: 'unsupported', reason: `Não sei executar: "${text}". Tente "mostra a lança", "o que faz o cilindro da lança?", "estende o cilindro" ou "explica passo a passo".` };
}

/** Validação fail-closed contra a cena e a revisão actuais. */
export function validateCommand(scene: LivingScene, assembly: Assembly, cmd: InteractionCommand, sceneRevision: string):
  { ok: true } | { ok: false; code: string; message: string } {
  if (sceneRevision !== scene.sourceRevision) return { ok: false, code: 'STALE_SCENE', message: 'A cena mudou desde que o comando foi interpretado; repita o pedido.' };
  switch (cmd.type) {
    case 'show': case 'explain': case 'who_moves': case 'limit_question':
      return entityById(scene, cmd.entityId) ? { ok: true } : { ok: false, code: 'UNKNOWN_COMPONENT', message: `Componente desconhecido nesta cena: ${cmd.entityId}.` };
    case 'move_actuator': {
      const a = assembly.actuators.find(x => x.id === cmd.actuatorId);
      if (!a) return { ok: false, code: 'UNKNOWN_ACTUATOR', message: `Actuador desconhecido: ${cmd.actuatorId}.` };
      if (!(cmd.fraction >= 0 && cmd.fraction <= 1)) return { ok: false, code: 'INVALID_FRACTION', message: 'Fracção de curso fora de [0, 1].' };
      return { ok: true };
    }
    case 'propose_parameter':
      return { ok: false, code: 'AUTHORITATIVE_REVIEW_REQUIRED', message: 'Alterações de parâmetros autoritativos exigem revisão; posso demonstrar a consequência como experiência transitória.' };
    case 'unsupported': return { ok: false, code: 'UNSUPPORTED', message: cmd.reason };
    case 'unknown_component': return { ok: false, code: 'UNKNOWN_COMPONENT', message: `Não identifiquei o componente em: "${cmd.text}".` };
    default: return { ok: true };
  }
}

/** Alvo absoluto de curso a partir de uma fracção, respeitando o curso declarado. */
export function actuatorTargetFor(assembly: Assembly, actuatorId: string, fraction: number): number | null {
  const a = assembly.actuators.find(x => x.id === actuatorId);
  if (!a) return null;
  if (a.kind === 'hydraulic_cylinder') return a.stroke.min.value + (a.stroke.max.value - a.stroke.min.value) * Math.min(1, Math.max(0, fraction));
  const joint = assembly.joints.find(j => j.id === a.jointId);
  if (!joint?.limits) return null;
  return joint.limits.min.value + (joint.limits.max.value - joint.limits.min.value) * Math.min(1, Math.max(0, fraction));
}

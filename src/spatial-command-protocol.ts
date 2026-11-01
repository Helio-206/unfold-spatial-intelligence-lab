import type { SpatialSceneV1 } from './spatial-scene';

export const SPATIAL_COMMAND_SCHEMA = 'spatial_command.v1' as const;

export type SpatialIntentKind = 'Select' | 'Inspect' | 'Focus' | 'Move' | 'Rotate' | 'Resize' | 'UpdateParameter' | 'AddComponent' | 'RemoveComponent' | 'AddOpening' | 'RemoveOpening' | 'Undo' | 'Redo' | 'Save' | 'Restore' | 'RequestClarification';
export type SpatialCommandState = 'Idle' | 'Listening' | 'Understanding' | 'RequestClarification' | 'ProposedAction' | 'Preview' | 'AwaitingConfirmation' | 'Executing' | 'Completed' | 'Rejected' | 'Failed';
export type SpatialCommandOrigin = 'local_deterministic' | 'speech_transcript' | 'muse_spark';
export type SpatialCommandV1 = {
  schema: typeof SPATIAL_COMMAND_SCHEMA;
  id: string;
  intent: {
    kind: SpatialIntentKind;
    target: { nodeId: string | null; reference: string | null };
    parameters: Record<string, string | number | boolean>;
    unit: 'm' | 'rad' | null;
  };
  context: { sceneId: string; revisionId: string; selectedNodeId: string | null; documentId: string | null; mode: 'architecture' | 'mechanical' | 'electrical' };
  provenance: { origin: SpatialCommandOrigin; validation: 'unreviewed'; inputText: string; recordedAt: string };
  preconditions: { expectedRevisionId: string; requiresConfirmation: boolean };
  state: SpatialCommandState;
  result: { message: string; revisionId?: string } | null;
};

export type ParsedSpatialIntent = Pick<SpatialCommandV1, 'intent'>;
export type SpatialIntentParse = { status: 'recognized'; value: ParsedSpatialIntent } | { status: 'clarification'; question: string } | { status: 'unsupported'; reason: string };
export type SpatialWallTarget = { id: string; label: string; x: number; z: number; kind: string };
export type SpatialTargetResolution = { status: 'resolved'; nodeId: string | null } | { status: 'clarification'; question: string };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const INTENTS = new Set<SpatialIntentKind>(['Select', 'Inspect', 'Focus', 'Move', 'Rotate', 'Resize', 'UpdateParameter', 'AddComponent', 'RemoveComponent', 'AddOpening', 'RemoveOpening', 'Undo', 'Redo', 'Save', 'Restore', 'RequestClarification']);
const STATES = new Set<SpatialCommandState>(['Idle', 'Listening', 'Understanding', 'RequestClarification', 'ProposedAction', 'Preview', 'AwaitingConfirmation', 'Executing', 'Completed', 'Rejected', 'Failed']);
const ORIGINS = new Set<SpatialCommandOrigin>(['local_deterministic', 'speech_transcript', 'muse_spark']);
const UNITS = new Set(['m', 'rad']);
const MUTATING_INTENTS = new Set<SpatialIntentKind>(['Move', 'Rotate', 'Resize', 'UpdateParameter', 'AddComponent', 'RemoveComponent', 'AddOpening', 'RemoveOpening']);
const NUMBER = '(\\d+(?:[.,]\\d+)?|zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezasseis|dezesseis|dezassete|dezessete|dezoito|dezanove|dezenove|vinte|meio|meia)';
const LENGTH = `${NUMBER}\\s*(mm|milimetros?|cm|centimetros?|m|metros?|ft|feet|in|polegadas?)?`;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/,(?=\d)/g, '.').replace(/\s+/g, ' ').trim();
}

function lengthMetres(value: string, unit = 'm'): number {
  const spokenNumbers: Record<string, number> = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezasseis: 16, dezesseis: 16, dezassete: 17, dezessete: 17, dezoito: 18, dezanove: 19, dezenove: 19, vinte: 20, meio: 0.5, meia: 0.5 };
  const number = Object.hasOwn(spokenNumbers, value) ? spokenNumbers[value]! : Number(value);
  const factor = /^(mm|milimetros?)$/.test(unit) ? 0.001 : /^(cm|centimetros?)$/.test(unit) ? 0.01 : /^(ft|feet)$/.test(unit) ? 0.3048 : /^(in|polegadas?)$/.test(unit) ? 0.0254 : 1;
  return number * factor;
}

function target(reference: string | null): ParsedSpatialIntent['intent']['target'] { return { nodeId: null, reference }; }
function result(kind: SpatialIntentKind, reference: string | null = null, parameters: Record<string, string | number | boolean> = {}, unit: 'm' | 'rad' | null = null): SpatialIntentParse {
  return { status: 'recognized', value: { intent: { kind, target: target(reference), parameters, unit } } };
}

/** Strict offline grammar. It recognises only complete, explicitly unit-bearing architectural actions. */
export function parseSpatialIntentV1(input: string): SpatialIntentParse {
  if (typeof input !== 'string' || !input.trim() || input.length > 500) return { status: 'unsupported', reason: 'Comando vazio ou demasiado longo.' };
  const text = normalize(input).replace(/[.!?]+$/g, '').trim();
  if (/^(desfaz|desfazer|undo)$/.test(text)) return result('Undo');
  if (/^(refaz|refazer|redo)$/.test(text)) return result('Redo');
  if (/^(guarda|guardar|salva|salvar)(?: esta versao)?$/.test(text)) return result('Save');
  if (/^(restaura|restaurar)(?: a ultima versao)?$/.test(text)) return result('Restore');
  if (/^(?:compara|comparar) (?:a cena )?antes e depois$/.test(text)) return result('Inspect', 'selection', { comparison: 'before-after' });

  const wallOrdinal = text.match(/^(?:seleciona|seleccionar|selecionar|mostra|foca|isola) (?:a )?parede (\d+)$/);
  if (wallOrdinal) return result(text.startsWith('seleciona') || text.startsWith('seleccionar') || text.startsWith('selecionar') ? 'Select' : text.startsWith('mostra') ? 'Inspect' : 'Focus', `wall_ordinal:${wallOrdinal[1]}`);
  const relativeWall = text.match(/^(?:seleciona|seleccionar|selecionar|mostra|foca|isola) (?:a )?parede (?:da )?(esquerda|direita)$/);
  if (relativeWall) return result(text.startsWith('seleciona') || text.startsWith('seleccionar') || text.startsWith('selecionar') ? 'Select' : text.startsWith('mostra') ? 'Inspect' : 'Focus', `screen_${relativeWall[1]}`);
  if (/^(?:mostra|consultar|consulta) (?:as )?(?:dimensoes|medidas) (?:desta|dessa) parede$/.test(text)) return result('Inspect', 'selection');
  if (/^(?:foca|isola|mostra)(?:-me)? (?:esta|essa) parede$/.test(text)) return result('Focus', 'selection');
  if (/^(?:seleciona|seleccionar|selecionar) (?:esta|essa) parede$/.test(text)) return result('Select', 'selection');

  const relativeResize = text.match(new RegExp(`^(aumenta|aumentar|reduz|reduzir) (?:a )?(?:esta |essa )?parede em ${LENGTH}$`));
  if (relativeResize) {
    if (!relativeResize[3]) return { status: 'clarification', question: 'Indique a unidade da alteração (mm, cm ou m). Nenhuma alteração foi proposta.' };
    const metres = lengthMetres(relativeResize[2]!, relativeResize[3]);
    if (!Number.isFinite(metres) || metres <= 0 || metres > 1000) return { status: 'unsupported', reason: 'Alteração fora dos limites permitidos.' };
    return result('Resize', 'selection', { property: 'length', delta: relativeResize[1]!.startsWith('reduz') ? -metres : metres }, 'm');
  }
  const resize = text.match(new RegExp(`^(?:aumenta|aumentar|reduz|reduzir|define|altera|muda) (?:a )?(?:esta |essa )?parede para ${LENGTH}$`));
  if (resize) {
    if (!resize[2]) return { status: 'clarification', question: 'Indique a unidade do comprimento (mm, cm ou m). Nenhuma alteração foi proposta.' };
    const metres = lengthMetres(resize[1]!, resize[2] ?? 'm');
    if (!Number.isFinite(metres) || metres <= 0 || metres > 1000) return { status: 'unsupported', reason: 'Comprimento fora dos limites permitidos (0–1000 m).' };
    return result('Resize', 'selection', { property: 'length', value: metres }, 'm');
  }

  const move = text.match(new RegExp(`^move (?:a )?(?:esta |essa )?parede ${LENGTH} no eixo ([xyz])$`));
  if (move) {
    if (!move[2]) return { status: 'clarification', question: 'Indique a unidade do deslocamento (mm, cm ou m). Nenhuma alteração foi proposta.' };
    const metres = lengthMetres(move[1]!, move[2] ?? 'm');
    if (!Number.isFinite(metres) || metres <= 0 || metres > 1000) return { status: 'unsupported', reason: 'Deslocamento fora dos limites permitidos (0–1000 m).' };
    return result('Move', 'selection', { axis: move[3]!.toUpperCase(), distance: metres }, 'm');
  }

  const opening = text.match(new RegExp(`^adiciona (?:uma )?(porta|janela) (?:com )?largura ${LENGTH},? altura ${LENGTH},? offset ${LENGTH},? peitoril ${LENGTH}$`));
  if (opening) {
    if ([3, 5, 7, 9].some((index) => !opening[index])) return { status: 'clarification', question: 'Indique explicitamente as unidades da largura, altura, offset e peitoril. Nenhuma abertura foi proposta.' };
    const [width, height, offset, sill] = [2, 4, 6, 8].map((index) => lengthMetres(opening[index]!, opening[index + 1] ?? 'm'));
    if ([width, height, offset, sill].some((value) => !Number.isFinite(value) || value < 0 || value > 100)) return { status: 'unsupported', reason: 'Parâmetros da abertura fora dos limites permitidos.' };
    if (width <= 0 || height <= 0) return { status: 'unsupported', reason: 'Largura e altura da abertura devem ser positivas.' };
    return result('AddOpening', 'selection', { kind: opening[1] === 'porta' ? 'door' : 'window', widthM: width, heightM: height, offsetM: offset, sillM: sill }, 'm');
  }
  if (/^(?:adiciona|cria) (?:uma )?(?:porta|janela)(?:\b|$)/.test(text)) return { status: 'clarification', question: 'Indique tipo, largura, altura, offset ao longo da parede e peitoril em unidades explícitas. Nada foi alterado.' };
  if (/^(?:remove|elimina) (?:esta )?abertura$/.test(text)) return result('RemoveOpening', 'selection');

  if (/^(?:seleciona|seleccionar|selecionar) (?:a )?parede(?:\b|$)/.test(text)) return { status: 'clarification', question: 'Qual parede pretende seleccionar? Indique o número ou esquerda/direita no enquadramento actual.' };
  if (/\b(?:esta|essa) parede\b/.test(text)) return { status: 'clarification', question: 'Não há uma parede seleccionada. Seleccione uma parede ou indique o seu número.' };
  return { status: 'unsupported', reason: 'Comando não suportado pelo executor local. Nenhuma alteração foi feita; use uma intenção arquitectónica explícita.' };
}

export function resolveSpatialTarget(scene: SpatialSceneV1, intent: ParsedSpatialIntent['intent'], selectedNodeId: string | undefined, screenRight: readonly [number, number, number] = [1, 0, 0]): SpatialTargetResolution {
  const reference = intent.target.reference;
  if (!reference) return { status: 'resolved', nodeId: null };
  if (reference === 'selection') {
    if (!selectedNodeId) return { status: 'clarification', question: 'Não há componente seleccionado. Seleccione a parede que pretende alterar.' };
    const selected = scene.nodes.find((node) => node.id === selectedNodeId);
    if (!selected || selected.component?.kind !== 'wall' && intent.kind !== 'RemoveOpening') return { status: 'clarification', question: 'O componente seleccionado não é uma parede. Seleccione uma parede para esta operação.' };
    if (intent.kind === 'RemoveOpening' && selected.component?.kind !== 'door' && selected.component?.kind !== 'window') return { status: 'clarification', question: 'Seleccione uma porta ou janela para remover.' };
    return { status: 'resolved', nodeId: selectedNodeId };
  }
  if (reference.startsWith('wall_ordinal:')) {
    const ordinal = Number(reference.split(':')[1]);
    const wall = scene.nodes.filter((node) => node.component?.kind === 'wall')[ordinal - 1];
    return wall ? { status: 'resolved', nodeId: wall.id } : { status: 'clarification', question: `Não existe Parede ${ordinal} nesta cena.` };
  }
  if (reference === 'screen_esquerda' || reference === 'screen_direita') {
    const walls = scene.nodes.filter((node) => node.component?.kind === 'wall');
    if (!walls.length) return { status: 'clarification', question: 'A cena não contém paredes.' };
    const ranked = walls.map((wall) => ({ wall, screenX: wall.transform.translationM[0] * screenRight[0] + wall.transform.translationM[1] * screenRight[1] + wall.transform.translationM[2] * screenRight[2] })).sort((a, b) => a.screenX - b.screenX);
    const index = reference === 'screen_esquerda' ? 0 : ranked.length - 1;
    if (ranked.length > 1 && Math.abs(ranked[ranked.length - 1]!.screenX - ranked[0]!.screenX) < 0.05) return { status: 'clarification', question: 'A orientação esquerda/direita não distingue paredes nesta vista. Indique o número da parede.' };
    return { status: 'resolved', nodeId: ranked[index]!.wall.id };
  }
  return { status: 'clarification', question: 'A referência não pôde ser resolvida de forma inequívoca.' };
}

export function createSpatialCommandEnvelope(args: { intent: ParsedSpatialIntent['intent']; context: SpatialCommandV1['context']; inputText: string; origin: SpatialCommandOrigin; recordedAt?: string }): SpatialCommandV1 {
  return validateSpatialCommand({
    schema: SPATIAL_COMMAND_SCHEMA,
    id: `cmd-${crypto.randomUUID()}`,
    intent: args.intent,
    context: args.context,
    provenance: { origin: args.origin, validation: 'unreviewed', inputText: args.inputText.slice(0, 500), recordedAt: args.recordedAt ?? new Date().toISOString() },
    preconditions: { expectedRevisionId: args.context.revisionId, requiresConfirmation: MUTATING_INTENTS.has(args.intent.kind) },
    state: 'ProposedAction', result: null,
  });
}

export function validateSpatialCommand(value: unknown): SpatialCommandV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SPATIAL_COMMAND_INVALID');
  const command = value as Partial<SpatialCommandV1>;
  if (command.schema !== SPATIAL_COMMAND_SCHEMA || typeof command.id !== 'string' || !ID_PATTERN.test(command.id) || !command.intent || !INTENTS.has(command.intent.kind) || !command.intent.target || !(command.intent.target.nodeId === null || typeof command.intent.target.nodeId === 'string' && ID_PATTERN.test(command.intent.target.nodeId)) || !(command.intent.target.reference === null || typeof command.intent.target.reference === 'string' && command.intent.target.reference.length <= 100) || !command.intent.parameters || typeof command.intent.parameters !== 'object' || Array.isArray(command.intent.parameters) || Object.keys(command.intent.parameters).length > 16 || !Object.values(command.intent.parameters).every((item) => typeof item === 'string' && item.length <= 200 || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000) || !(command.intent.unit === null || typeof command.intent.unit === 'string' && UNITS.has(command.intent.unit)) || !command.context || !ID_PATTERN.test(command.context.sceneId) || !ID_PATTERN.test(command.context.revisionId) || !(command.context.selectedNodeId === null || ID_PATTERN.test(String(command.context.selectedNodeId))) || !(command.context.documentId === null || ID_PATTERN.test(String(command.context.documentId))) || !['architecture', 'mechanical', 'electrical'].includes(command.context.mode) || !command.provenance || !ORIGINS.has(command.provenance.origin) || command.provenance.validation !== 'unreviewed' || typeof command.provenance.inputText !== 'string' || command.provenance.inputText.length > 500 || !Number.isFinite(Date.parse(command.provenance.recordedAt)) || !command.preconditions || command.preconditions.expectedRevisionId !== command.context.revisionId || command.preconditions.requiresConfirmation !== MUTATING_INTENTS.has(command.intent.kind) || typeof command.state !== 'string' || !STATES.has(command.state) || !(command.result === null || command.result && typeof command.result.message === 'string' && command.result.message.length <= 1000)) throw new Error('SPATIAL_COMMAND_INVALID');
  return structuredClone(value) as SpatialCommandV1;
}

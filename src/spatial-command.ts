import type { BarName } from './kinematics';

export type SpatialAction =
  | { kind: 'focus'; componentId: BarName }
  | { kind: 'fit' }
  | { kind: 'home' }
  | { kind: 'explode' }
  | { kind: 'reassemble' }
  | { kind: 'update_length'; componentId: BarName; value: number; unit: 'mm' };

export type ParsedSpatialCommand = { status: 'recognized'; action: SpatialAction } | { status: 'unknown'; reason: string };

export function explainUnsupportedSpatialCommand(input: string, fallback: string): string {
  const value = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/desmont|explode|separ/.test(value) && /linha\s+rec?ta|alinha|alinhamento/.test(value)) {
    return 'Posso desmontar o mecanismo, mas a disposição em linha recta ainda não está disponível. Nada foi executado.';
  }
  return `${fallback} Nada foi executado.`;
}

const COMPONENT_ALIASES: Record<string, BarName> = {
  manivela: 'crank',
  manivelao: 'crank',
  crank: 'crank',
  acoplador: 'coupler',
  coupler: 'coupler',
  rocker: 'rocker',
  balancim: 'rocker',
  ground: 'ground',
  base: 'ground',
};

function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[!?]|[.,](?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function componentFrom(input: string): BarName | undefined {
  for (const [alias, component] of Object.entries(COMPONENT_ALIASES)) {
    if (input.includes(alias)) return component;
  }
  return undefined;
}

export function parseSpatialCommand(input: string, selectedComponent?: BarName): ParsedSpatialCommand {
  const value = normalize(input);
  if (!value) return { status: 'unknown', reason: 'Comando vazio.' };

  const lengthMatch = value.match(/^(?:e se\s+)?(?:a\s+)?(?:aumenta(?:r)?|reduz(?:ir)?|diminui(?:r)?|altera(?:r)?|define|muda(?:r)?|change|set)\s+(?:(?:a|o)\s+)?(?:(?:manivela|crank|acoplador|coupler|rocker|balancim|base|ground|ela|essa barra)\s+)?(?:para|to|em|at)\s+(\d+(?:\.\d+)?)\s*(?:mm|milimetros?|millimeters?)?$/);
  if (lengthMatch) {
    const componentId = componentFrom(value) ?? selectedComponent;
    const amount = Number(lengthMatch[1]);
    if (!componentId) return { status: 'unknown', reason: 'Qual é a barra que pretende alterar?' };
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'unknown', reason: 'Comprimento inválido.' };
    return { status: 'recognized', action: { kind: 'update_length', componentId, value: amount, unit: 'mm' } };
  }

  if (/^(?:(?:unfold|agora)\s+)?(?:desmonta|explode|separa|separar|disassemble)(?:\s+o\s+mecanismo|\s+tudo)?$/.test(value)) {
    return { status: 'recognized', action: { kind: 'explode' } };
  }
  if (/^(?:unfold\s+)?(?:remonta|reassemble|monta\s+de\s+novo|junta\s+tudo|reconstroi)(?:\s+tudo|\s+o\s+mecanismo)?$/.test(value)) {
    return { status: 'recognized', action: { kind: 'reassemble' } };
  }
  if (/^(?:unfold\s+)?(?:enquadra|fit|enquadra\s+o)\s*(?:mecanismo|tudo)?$/.test(value)) {
    return { status: 'recognized', action: { kind: 'fit' } };
  }
  if (/^(?:unfold\s+)?(?:volta|retorna|regressa)\s+(?:a\s+)?(?:vista\s+)?(?:inicial|home)$/.test(value) || /^(?:home|vista inicial)$/.test(value)) {
    return { status: 'recognized', action: { kind: 'home' } };
  }
  if (/^(?:mostra|mostrar|foca|focus|isola|isolar)(?:-me)?\s+(?:a\s+)?/.test(value)) {
    const componentId = componentFrom(value) ?? (/\b(?:essa|esta|ela)\b/.test(value) ? selectedComponent : undefined);
    if (componentId) return { status: 'recognized', action: { kind: 'focus', componentId } };
  }
  return { status: 'unknown', reason: 'Comando não reconhecido. Usa desmonta, remonta, mostra a manivela, enquadra ou vista inicial.' };
}

export function instructionForLengthUpdate(componentId: BarName, value: number, unit: 'mm'): string {
  const componentName = componentId === 'crank' ? 'manivela' : componentId;
  return `Aumenta a ${componentName} para ${value} ${unit}.`;
}

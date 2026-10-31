export type Point = { x: number; y: number };
export type ElementKind = 'wall' | 'door' | 'window' | 'room';
export type Confidence = 'known' | 'inferred' | 'unknown';

export type Evidence = {
  source: string;
  confidence: Confidence;
  note?: string;
};

export type Wall = {
  id: string;
  kind: 'wall';
  start: Point;
  end: Point;
  thickness: number;
  height: number;
  evidence: Evidence;
};

export type Opening = {
  id: string;
  kind: 'door' | 'window';
  wallId: string;
  position: number;
  width: number;
  evidence: Evidence;
};

export type Room = {
  id: string;
  kind: 'room';
  name: string;
  polygon: Point[];
  evidence: Evidence;
};

export type PlanElement = Wall | Opening | Room;

export type FloorPlan = {
  schemaVersion: 'unfold.plan.v1';
  image: { width: number; height: number; coordinateSystem: 'image-top-left' };
  scale: { value?: number; unit: 'px' | 'm'; confidence: Confidence };
  elements: PlanElement[];
  ambiguities: string[];
};

export type ValidationIssue = {
  code: string;
  message: string;
  elementId?: string;
};

export type Operation =
  | { type: 'select' | 'highlight' | 'isolate' | 'hide'; ids: string[] }
  | { type: 'explode' | 'reassemble' | 'reset' };

const EPSILON = 1e-6;

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointOnWall(wall: Wall, position: number): Point {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * position,
    y: wall.start.y + (wall.end.y - wall.start.y) * position,
  };
}

export function validatePlan(plan: FloorPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const wallIds = new Set<string>();

  if (plan.schemaVersion !== 'unfold.plan.v1') {
    issues.push({ code: 'schema.version', message: 'Versão do contrato desconhecida.' });
  }
  if (plan.image.width <= 0 || plan.image.height <= 0) {
    issues.push({ code: 'image.dimensions', message: 'Dimensões da imagem devem ser positivas.' });
  }

  for (const element of plan.elements) {
    if (ids.has(element.id)) {
      issues.push({ code: 'id.duplicate', message: `ID duplicado: ${element.id}.`, elementId: element.id });
    }
    ids.add(element.id);

    if (element.kind === 'wall') {
      wallIds.add(element.id);
      if (!isFinitePoint(element.start) || !isFinitePoint(element.end)) {
        issues.push({ code: 'wall.coordinates', message: 'Coordenadas de parede inválidas.', elementId: element.id });
      }
      if (element.start.x === element.end.x && element.start.y === element.end.y) {
        issues.push({ code: 'wall.zero-length', message: 'Parede sem comprimento.', elementId: element.id });
      }
      if (element.thickness <= 0 || element.height <= 0) {
        issues.push({ code: 'wall.dimensions', message: 'Espessura e altura devem ser positivas.', elementId: element.id });
      }
    }

    if (element.kind === 'room') {
      if (element.polygon.length < 3) {
        issues.push({ code: 'room.polygon', message: 'Divisão precisa de pelo menos três pontos.', elementId: element.id });
      }
      if (element.polygon.some((point) => !isFinitePoint(point))) {
        issues.push({ code: 'room.coordinates', message: 'Coordenadas de divisão inválidas.', elementId: element.id });
      }
    }
  }

  for (const element of plan.elements) {
    if (element.kind !== 'door' && element.kind !== 'window') continue;
    if (!wallIds.has(element.wallId)) {
      issues.push({ code: 'opening.wall-ref', message: `Abertura referencia parede inexistente: ${element.wallId}.`, elementId: element.id });
    }
    if (element.position < 0 || element.position > 1 || element.width <= 0) {
      issues.push({ code: 'opening.geometry', message: 'Posição ou largura de abertura inválida.', elementId: element.id });
    }
    const wall = plan.elements.find((candidate): candidate is Wall => candidate.kind === 'wall' && candidate.id === element.wallId);
    if (wall && element.position >= 0 && element.position <= 1) {
      const point = pointOnWall(wall, element.position);
      if (point.x < -EPSILON || point.y < -EPSILON || point.x > plan.image.width + EPSILON || point.y > plan.image.height + EPSILON) {
        issues.push({ code: 'opening.bounds', message: 'Abertura fora dos limites da imagem.', elementId: element.id });
      }
    }
  }

  for (const element of plan.elements) {
    if (element.kind === 'wall') {
      for (const point of [element.start, element.end]) {
        if (point.x < 0 || point.y < 0 || point.x > plan.image.width || point.y > plan.image.height) {
          issues.push({ code: 'wall.bounds', message: 'Extremo de parede fora dos limites da imagem.', elementId: element.id });
        }
      }
    }
  }
  return issues;
}

export function createFixturePlan(variant: 'A' | 'B' | 'C'): FloorPlan {
  const offset = variant === 'A' ? 0 : variant === 'B' ? 24 : -18;
  const width = variant === 'C' ? 1080 : 1000;
  const height = 700;
  const wall = (id: string, start: Point, end: Point): Wall => ({
    id,
    kind: 'wall',
    start,
    end,
    thickness: 12,
    height: 2.5,
    evidence: { source: `fixture-${variant}`, confidence: 'known' },
  });
  return {
    schemaVersion: 'unfold.plan.v1',
    image: { width, height, coordinateSystem: 'image-top-left' },
    scale: { unit: 'px', confidence: 'unknown' },
    ambiguities: ['A escala arquitectónica não foi fornecida.'],
    elements: [
      wall('wall-exterior-north', { x: 80, y: 80 + offset }, { x: width - 80, y: 80 + offset }),
      wall('wall-exterior-east', { x: width - 80, y: 80 + offset }, { x: width - 80, y: height - 80 }),
      wall('wall-exterior-south', { x: width - 80, y: height - 80 }, { x: 80, y: height - 80 }),
      wall('wall-exterior-west', { x: 80, y: height - 80 }, { x: 80, y: 80 + offset }),
      wall('wall-room-divider', { x: width * 0.58, y: 80 + offset }, { x: width * 0.58, y: height - 80 }),
      { id: 'door-main', kind: 'door', wallId: 'wall-exterior-south', position: 0.18, width: 86, evidence: { source: `fixture-${variant}`, confidence: 'known' } },
      { id: 'door-room', kind: 'door', wallId: 'wall-room-divider', position: 0.52, width: 76, evidence: { source: `fixture-${variant}`, confidence: 'known' } },
      { id: 'window-living', kind: 'window', wallId: 'wall-exterior-north', position: 0.42, width: 120, evidence: { source: `fixture-${variant}`, confidence: 'known' } },
      { id: 'room-living', kind: 'room', name: 'Sala', polygon: [{ x: 92, y: 92 + offset }, { x: width * 0.56, y: 92 + offset }, { x: width * 0.56, y: height - 92 }, { x: 92, y: height - 92 }], evidence: { source: `fixture-${variant}`, confidence: 'known' } },
      { id: 'room-private', kind: 'room', name: 'Quarto', polygon: [{ x: width * 0.6, y: 92 + offset }, { x: width - 92, y: 92 + offset }, { x: width - 92, y: height - 92 }, { x: width * 0.6, y: height - 92 }], evidence: { source: `fixture-${variant}`, confidence: 'known' } },
    ],
  };
}

export class UnfoldEngine {
  private readonly baseIds: Set<string>;
  private selected = new Set<string>();
  private highlighted = new Set<string>();
  private hidden = new Set<string>();
  private isolated = new Set<string>();
  private exploded = false;

  constructor(plan: FloorPlan) {
    this.baseIds = new Set(plan.elements.map((element) => element.id));
  }

  apply(operation: Operation): void {
    if ('ids' in operation) {
      const invalid = operation.ids.filter((id) => !this.baseIds.has(id));
      if (invalid.length > 0) throw new Error(`IDs inexistentes: ${invalid.join(', ')}`);
    }
    if (operation.type === 'select') this.selected = new Set(operation.ids);
    if (operation.type === 'highlight') this.highlighted = new Set(operation.ids);
    if (operation.type === 'hide') this.hidden = new Set(operation.ids);
    if (operation.type === 'isolate') {
      this.isolated = new Set(operation.ids);
      this.hidden = new Set([...this.baseIds].filter((id) => !this.isolated.has(id)));
    }
    if (operation.type === 'explode') this.exploded = true;
    if (operation.type === 'reassemble') this.exploded = false;
    if (operation.type === 'reset') {
      this.selected.clear();
      this.highlighted.clear();
      this.hidden.clear();
      this.isolated.clear();
      this.exploded = false;
    }
  }

  state(): { selected: string[]; highlighted: string[]; hidden: string[]; isolated: string[]; exploded: boolean } {
    return {
      selected: [...this.selected],
      highlighted: [...this.highlighted],
      hidden: [...this.hidden],
      isolated: [...this.isolated],
      exploded: this.exploded,
    };
  }
}

export function answerSpatialQuestion(plan: FloorPlan, question: string): { text: string; ids: string[]; actions: Operation[] } {
  const normalized = question.toLocaleLowerCase('pt-PT');
  const room = plan.elements.find((element): element is Room => {
    if (element.kind !== 'room') return false;
    const aliases = element.name === 'Sala' ? ['sala', 'living room', 'living'] : element.name === 'Quarto' ? ['quarto', 'bedroom'] : [element.name.toLocaleLowerCase('pt-PT')];
    return aliases.some((alias) => normalized.includes(alias));
  });
  if (!room) {
    return { text: 'A pergunta exige informação que não está determinada no contrato desta planta.', ids: [], actions: [{ type: 'reset' }] };
  }
  const wallIds = plan.elements.filter((element): element is Wall => element.kind === 'wall').map((element) => element.id);
  const ids = [room.id, ...wallIds];
  return {
    text: `A divisão “${room.name}” está representada por ${room.id}. As paredes disponíveis no contrato são ${wallIds.join(', ')}. A planta não contém informação estrutural.`,
    ids,
    actions: [{ type: 'highlight', ids }, { type: 'select', ids: [room.id] }],
  };
}

import { roomDisplayName } from './room-merge';
import type { Node, SpatialSceneV1 } from './spatial-scene';

/**
 * Resolve "a parede entre a cozinha e a sala", "a parede W5" e afins para uma parede da cena. É determinístico e vive no executor
 * local: o Muse pode propor a acção, mas o alvo sai sempre do texto do utilizador e da cena, nunca de um id que o modelo diga.
 * Recusa em vez de escolher quando é ambíguo ou não existe.
 */
export type WallTargetResolution = { status: 'resolved'; wallId: string } | { status: 'clarification'; question: string };

const strip = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ARTICLE = /^(?:a|o|as|os|the)\s+/;
/** Nome comparável: sem acentos, sem maiúsculas e sem o artigo da frente (a, o, as, os, the). */
const comparable = (text: string) => { const plain = strip(text); const withoutArticle = plain.replace(ARTICLE, ''); return withoutArticle || plain; };

const rooms = (scene: SpatialSceneV1): Node[] => scene.nodes.filter((node) => node.component?.kind === 'room');
const walls = (scene: SpatialSceneV1): Node[] => scene.nodes.filter((node) => node.component?.kind === 'wall');
const ask = (question: string): WallTargetResolution => ({ status: 'clarification', question });

/** `rest` é o que vem depois de «entre» / «between»: «a cozinha e a sala», «kitchen and living room». */
export function resolveWallBetweenRooms(scene: SpatialSceneV1, rest: string): WallTargetResolution {
  const text = strip(rest);
  const separators = [...text.matchAll(/ (?:e|and) /g)].map((match) => ({ at: match.index!, length: match[0].length }));
  if (!separators.length) return ask('Indique as duas divisões: «entre a cozinha e a sala», por exemplo.');
  const known = rooms(scene).map((room) => ({ room, name: comparable(roomDisplayName(room)) }));
  const named = (name: string) => known.filter((item) => item.name === comparable(name)).map((item) => item.room);
  const splits = separators.map(({ at, length }) => ({ left: text.slice(0, at), right: text.slice(at + length) }));
  const valid = splits.filter(({ left, right }) => left.trim() && right.trim() && named(left).length > 0 && named(right).length > 0);
  if (valid.length === 0) {
    // Diz o que não encontrou na partição mais natural (a primeira).
    const { left, right } = splits[0]!;
    const missing = named(left).length === 0 ? left : right;
    return ask(`Não encontrei uma divisão chamada “${comparable(missing)}”. Dê um nome à divisão no inspector ou indique a parede pelo id.`);
  }
  if (valid.length > 1) return ask('Não consegui perceber quais são as duas divisões, porque os nomes podem partir-se de mais do que uma maneira. Indique a parede pelo id.');
  const { left, right } = valid[0]!;
  const [first, second] = [named(left), named(right)];
  for (const [list, name] of [[first, left], [second, right]] as const) {
    if (list.length > 1) return ask(`Há mais do que uma divisão chamada “${comparable(name)}”. Dê-lhes nomes diferentes ou indique a parede pelo id.`);
  }
  const [a, b] = [first[0]!, second[0]!];
  if (a.id === b.id) return ask('Indique duas divisões diferentes: uma parede separa uma divisão de outra, não de si própria.');
  const shared = walls(scene).filter((wall) => a.component!.dependsOn.includes(wall.id) && b.component!.dependsOn.includes(wall.id));
  if (shared.length === 0) return ask(`As divisões “${comparable(left)}” e “${comparable(right)}” não partilham nenhuma parede.`);
  if (shared.length > 1) return ask(`As divisões “${comparable(left)}” e “${comparable(right)}” partilham ${shared.length} paredes (${shared.map((wall) => wall.id).join(', ')}). Indique qual pelo id.`);
  return { status: 'resolved', wallId: shared[0]!.id };
}

/** `token` é o id escrito pelo utilizador (já sem maiúsculas): «w5» encontra «wall-W5». */
export function resolveWallById(scene: SpatialSceneV1, token: string): WallTargetResolution {
  const wanted = strip(token);
  const matches = walls(scene).filter((wall) => { const id = wall.id.toLowerCase(); return id === wanted || id === `wall-${wanted}`; });
  if (matches.length === 1) return { status: 'resolved', wallId: matches[0]!.id };
  if (matches.length > 1) return ask(`Há mais do que uma parede que corresponde a “${token}”. Seleccione-a na cena.`);
  return ask(`Não existe a parede “${token}” nesta cena.`);
}

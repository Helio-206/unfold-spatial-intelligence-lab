export type ExplodedNode = { id: string; position: readonly [number, number, number] };
export type RenderOffset = readonly [number, number, number];

/** Deterministic render-only offsets. The canonical scene is never modified. */
export function computeExplodedViewOffsets(nodes: readonly ExplodedNode[], amount = 1): Map<string, RenderOffset> {
  if (!Number.isFinite(amount) || amount < 0 || amount > 2) throw new Error('EXPLODED_VIEW_AMOUNT_INVALID');
  if (nodes.some(({ id, position }) => !id || position.length !== 3 || position.some((value) => !Number.isFinite(value)))) {
    throw new Error('EXPLODED_VIEW_NODE_INVALID');
  }
  const uniqueIds = new Set(nodes.map(({ id }) => id));
  if (uniqueIds.size !== nodes.length) throw new Error('EXPLODED_VIEW_DUPLICATE_ID');
  if (!nodes.length || amount === 0) return new Map(nodes.map(({ id }) => [id, [0, 0, 0] as const]));

  const center = [0, 1, 2].map((axis) => nodes.reduce((sum, node) => sum + node.position[axis]!, 0) / nodes.length);
  return new Map(nodes.map(({ id, position }) => {
    const direction = position.map((value, axis) => value - center[axis]!);
    let length = Math.hypot(...direction);
    if (length < 1e-8) {
      let hash = 2166136261;
      for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      const axis = hash % 3;
      direction[axis] = 1;
      length = 1;
    }
    const distance = 0.5 * amount;
    return [id, direction.map((value) => value / length * distance) as unknown as RenderOffset];
  }));
}

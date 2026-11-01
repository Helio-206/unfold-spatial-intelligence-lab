import { describe, expect, it } from 'vitest';
import { computeExplodedViewOffsets } from '../src/spatial-exploded-view';

describe('render-only exploded view offsets', () => {
  const nodes = [
    { id: 'west', position: [-2, 0, 0] as const },
    { id: 'east', position: [2, 0, 0] as const },
  ];

  it('uses stable outward offsets and restores by a zero amount', () => {
    expect(computeExplodedViewOffsets(nodes)).toEqual(new Map([
      ['west', [-0.5, 0, 0]],
      ['east', [0.5, 0, 0]],
    ]));
    expect(computeExplodedViewOffsets(nodes, 0)).toEqual(new Map([
      ['west', [0, 0, 0]],
      ['east', [0, 0, 0]],
    ]));
    expect(computeExplodedViewOffsets(nodes)).toEqual(computeExplodedViewOffsets(nodes));
  });

  it('breaks centroid ties deterministically without leaving a node stationary', () => {
    const offsets = computeExplodedViewOffsets([
      { id: 'first', position: [0, 0, 0] },
      { id: 'second', position: [0, 0, 0] },
    ]);
    expect([...offsets.values()].every((offset) => Math.hypot(...offset) === 0.5)).toBe(true);
    expect(offsets).toEqual(computeExplodedViewOffsets([
      { id: 'first', position: [0, 0, 0] },
      { id: 'second', position: [0, 0, 0] },
    ]));
  });

  it('rejects invalid amounts, duplicate identifiers, and non-finite positions', () => {
    expect(() => computeExplodedViewOffsets(nodes, 2.1)).toThrow('EXPLODED_VIEW_AMOUNT_INVALID');
    expect(() => computeExplodedViewOffsets([nodes[0]!, nodes[0]!])).toThrow('EXPLODED_VIEW_DUPLICATE_ID');
    expect(() => computeExplodedViewOffsets([{ id: 'bad', position: [0, Number.NaN, 0] }])).toThrow('EXPLODED_VIEW_NODE_INVALID');
  });
});

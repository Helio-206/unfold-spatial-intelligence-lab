import { describe, expect, it } from 'vitest';
import { buildProvisionalPlan } from '../src/plan-provisional';
import { traceWallCandidate, type PlanRegionCandidate } from '../src/plan-reconstruction';

function region(id: string, x0: number, y0: number, x1: number, y1: number): PlanRegionCandidate {
  const vertices = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return { id, boundaryCandidateIds: [], vertices, areaPx2: (x1 - x0) * (y1 - y0), validation: 'unreviewed', eligibility: 'construction_candidate', confidence: 0.6, evidence: ['independent raster candidate'] };
}

describe('provisional plan reconstruction', () => {
  it('splits the lower-right proposal at an upper-right anchor and creates a non-overlapping residual hall', () => {
    const regions = [region('ul', 20, 10, 90, 70), region('ur', 110, 10, 180, 70), region('ll', 20, 75, 90, 130), region('lr', 90, 75, 180, 130)];
    const walls = [traceWallCandidate('partial-cut-a', { x: 110, y: 90 }, { x: 110, y: 110 }, 4), traceWallCandidate('partial-cut-b', { x: 115, y: 90 }, { x: 115, y: 110 }, 4)];
    const model = buildProvisionalPlan(regions, walls, { width: 200, height: 150 });
    expect(model.status).toBe('provisional');
    expect(model.coordinateSpace).toBe('source-image-pixels');
    expect(model.persistence).toBe('ephemeral');
    expect(model.zones.map((zone) => zone.id)).toEqual(['room-c', 'room-a', 'room-d', 'room-b', 'hall']);
    expect(model.zones.find((zone) => zone.id === 'room-b')!.vertices[0]!.x).toBe(110);
    expect(model.zones.find((zone) => zone.id === 'hall')!.vertices).toEqual([{ x: 90, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 130 }, { x: 90, y: 130 }]);
    expect(model.overlaps).toEqual([]);
    expect(model.unresolved.some((item) => item.id === 'hall-boundary-gap-1')).toBe(true);
    expect(model.unresolved.find((item) => item.id === 'hall-boundary')?.reason).toContain('36%');
    expect(model.zones.every((zone) => zone.status === 'provisional')).toBe(true);
  });

  it('rejects an ambiguous layout instead of forcing four candidates into a 2x2 arrangement', () => {
    const regions = [region('1', 10, 10, 50, 50), region('2', 20, 20, 60, 60), region('3', 70, 10, 110, 50), region('4', 70, 60, 110, 100)];
    expect(() => buildProvisionalPlan(regions, [], { width: 120, height: 120 })).toThrow(/duas colunas|duas fiadas/);
  });

  it('generalizes the positional layout to a translated and rescaled independent arrangement', () => {
    const regions = [region('p', 300, 200, 540, 400), region('q', 620, 200, 860, 400), region('r', 300, 430, 540, 650), region('s', 540, 430, 860, 650)];
    const model = buildProvisionalPlan(regions, [], { width: 1000, height: 800 });
    expect(model.zones).toHaveLength(5);
    expect(model.overlaps).toEqual([]);
    expect(model.zones.find((zone) => zone.id === 'hall')!.vertices[0]!.x).toBe(540);
  });
});

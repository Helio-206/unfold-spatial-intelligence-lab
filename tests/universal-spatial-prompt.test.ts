import { describe, expect, it } from 'vitest';
import { SPATIAL_V2_GEOMETRY_GUIDANCE } from '../src/universal-spatial/spatial-prompt-v2';

describe('V2 geometry guidance', () => {
  it('asks for scale, contact, silhouette-first construction and complete parameters', () => {
    for (const clause of [/longest side between 2 and 10 units/, /touch or overlap/, /Silhouette first/, /revolve/, /loft or extrude/, /exact keys/, /different materials/]) expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(clause);
  });

  it('stays subject-independent: no object names or per-category templates', () => {
    const subjects = /\b(excavator|harp|engine|aircraft|airplane|turbine|bicycle|car|chair|table|robot|house|building|machine)\b/i;
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).not.toMatch(subjects);
  });
});

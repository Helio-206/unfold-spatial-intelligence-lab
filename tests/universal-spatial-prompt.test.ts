import { describe, expect, it } from 'vitest';
import { SPATIAL_V2_GEOMETRY_GUIDANCE } from '../src/universal-spatial/spatial-prompt-v2';
import { SHAPE_PARAMETER_KEYS } from '../src/universal-spatial/contracts-v2';

describe('V2 geometry guidance', () => {
  it('asks for scale, contact, silhouette-first construction and complete parameters', () => {
    for (const clause of [/longest side between 2 and 10 units/, /touch or overlap/, /Silhouette first/, /revolve/, /loft or extrude/, /exact keys/, /different materials/]) expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(clause);
  });

  it('tells the model how circular parts are oriented and not to bury visible details inside opaque solids', () => {
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(/around the Y axis/);
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(/rotationRad/);
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(/inside the volume of a larger opaque shape is invisible/);
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(/faces \+Z/);
  });

  it('spells out every operator\'s exact parameter keys and the transform keys, so the model does not abbreviate them', () => {
    for (const [operator, keys] of Object.entries(SHAPE_PARAMETER_KEYS)) {
      expect(SPATIAL_V2_GEOMETRY_GUIDANCE, operator).toContain(operator);
      for (const key of keys) expect(SPATIAL_V2_GEOMETRY_GUIDANCE, `${operator}.${key}`).toContain(`"${key}"`);
    }
    for (const key of ['position', 'rotationRad', 'scale']) expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toContain(`"${key}"`);
    for (const key of ['profile', 'color', 'roughness', 'metalness', 'clearcoat', 'spacingOrRadius']) expect(SPATIAL_V2_GEOMETRY_GUIDANCE, key).toContain(`"${key}"`);
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(/material is a JSON object, never a bare name/i);
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).toMatch(/never abbreviate/i);
  });

  it('stays subject-independent: no object names or per-category templates', () => {
    const subjects = /\b(excavator|harp|engine|aircraft|airplane|turbine|bicycle|car|chair|table|robot|house|building|machine|clock|dial|pendulum)\b/i;
    expect(SPATIAL_V2_GEOMETRY_GUIDANCE).not.toMatch(subjects);
  });
});

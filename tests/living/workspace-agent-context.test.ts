import { describe, expect, it } from 'vitest';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { buildComponentRegistry } from '../../src/living/visual-foundry/component-registry';
import { buildAgentRequest } from '../../src/living/workspace-design/agent-client';
import { SPATIAL_AGENT_REQUEST_SCHEMA } from '../../src/spatial-agent';

const registry = buildComponentRegistry(EXCAVATOR_ASSEMBLY_V1);

describe('agent request context when the engineering engine is connected', () => {
  const text = (engineConnected: boolean) => buildAgentRequest('estende o cilindro', registry, 'boom_cylinder', [], { engineConnected }).scene?.constraints.join(' | ') ?? '';

  it('no longer claims the engine is unavailable', () => {
    expect(text(true)).not.toMatch(/não está ligado/i);
  });

  it('states provenance, approval and the no-execution boundary', () => {
    const c = text(true);
    expect(c).toMatch(/motor de engenharia.*(calcula|resultados)/i);
    expect(c).toMatch(/confirma|aprova/i);
    expect(c).toMatch(/não (calcula|executa)/i);
  });

  it('keeps the unavailable wording for the fixture demo and stays a valid v1 request', () => {
    expect(text(false)).toMatch(/não está ligado/i);
    expect(buildAgentRequest('x', registry, null, [], { engineConnected: true }).schema).toBe(SPATIAL_AGENT_REQUEST_SCHEMA);
  });
});

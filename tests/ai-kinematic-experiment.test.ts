import { describe, expect, it } from 'vitest';
import {
  buildKinematicOperationPrompt,
  executeKinematicOperation,
  parseKinematicOperation,
  validateKinematicOperation,
} from '../src/ai-kinematic-experiment';
import { createPhase3DReferenceFixture } from '../src/phase3d-fixture';

describe('AI-controlled kinematic experiment', () => {
  it('parses only the typed declarative operation', () => {
    expect(parseKinematicOperation('```json\n{"schema":"kinematic_operation.v1","action":"update_length","componentId":"crank","newValue":80,"unit":"mm"}\n```')).toEqual({
      status: 'accepted',
      operation: { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: 80, unit: 'mm' },
    });
    expect(parseKinematicOperation('{"action":"clarify","question":"which bar?"}').status).toBe('blocked');
    expect(parseKinematicOperation('not json').status).toBe('blocked');
  });

  it('builds a minimal prompt without graph internals or credentials', () => {
    const { assembly } = createPhase3DReferenceFixture();
    const prompt = buildKinematicOperationPrompt('Aumenta o comprimento da manivela de 40 para 80 milímetros.', assembly);
    expect(prompt).toContain('Aumenta o comprimento');
    expect(prompt).toContain('"componentId":"crank"');
    expect(prompt).toContain('"currentLength":40');
    expect(prompt).not.toContain('MODEL_API_KEY');
    expect(prompt).not.toContain('Authorization');
  });

  it('executes 40 -> 80 using the deterministic solver without mutating the source', () => {
    const fixture = createPhase3DReferenceFixture();
    const original = structuredClone(fixture.assembly);
    const result = executeKinematicOperation(fixture.graph, fixture.assembly, {
      schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: 80, unit: 'mm',
    });
    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;
    expect(result.before.result.status).toBe('solved');
    expect(result.after.result.status).toBe('impossible');
    expect(result.differences.lengthDeltaMm).toBe(40);
    expect(result.provenance).toEqual({ before: 'test_fixture', after: 'test_fixture' });
    expect(fixture.assembly).toEqual(original);
  });

  it.each([
    ['component inexistente', { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'missing', newValue: 80, unit: 'mm' }, 'componentId'],
    ['valor negativo', { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: -1, unit: 'mm' }, 'newValue'],
    ['unidade desconhecida', { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: 80, unit: 'cm' }, 'unit'],
    ['operação não autorizada', { schema: 'kinematic_operation.v1', action: 'delete_mechanism', componentId: 'crank', newValue: 80, unit: 'mm' }, 'action'],
    ['componente não autorizado', { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'ground', newValue: 80, unit: 'mm' }, 'componentId'],
  ])('bloqueia %s', (_name, operation, path) => {
    const { assembly } = createPhase3DReferenceFixture();
    const validation = validateKinematicOperation(operation, assembly);
    expect(validation.status).toBe('blocked');
    if (validation.status === 'blocked') expect(validation.issues.some((item) => item.path === path)).toBe(true);
  });

  it('blocks an assembly with unverified provenance/state before the operation', () => {
    const fixture = createPhase3DReferenceFixture();
    fixture.assembly.links.crank.length.state = 'unverified';
    const result = executeKinematicOperation(fixture.graph, fixture.assembly, {
      schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: 80, unit: 'mm',
    });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.issues.some((item) => item.message.includes('verified'))).toBe(true);
  });

  it('does not execute malformed Meta output', () => {
    const parsed = parseKinematicOperation('{"schema":"kinematic_operation.v1","action":"update_length","componentId":"crank","newValue":null,"unit":"mm"}');
    expect(parsed.status).toBe('blocked');
    const { assembly } = createPhase3DReferenceFixture();
    const result = executeKinematicOperation(createPhase3DReferenceFixture().graph, assembly, parsed.status === 'accepted' ? parsed.operation : {});
    expect(result.status).toBe('blocked');
  });
});

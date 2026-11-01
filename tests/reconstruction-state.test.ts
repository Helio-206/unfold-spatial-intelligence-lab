import { describe, expect, it } from 'vitest';
import { countReconstructionStates, reconstructionChip, reconstructionState } from '../src/reconstruction-state';

const p = (source: 'technical_document' | 'user' | 'solver' | 'derived' | 'system', validation: 'unreviewed' | 'ambiguous' | 'verified' | 'rejected' | 'corrected') => ({ source, validation });

describe('reconstruction state presentation', () => {
  it('never promotes unreviewed values to validated', () => {
    for (const source of ['technical_document', 'user', 'solver', 'derived', 'system'] as const) expect(reconstructionState(p(source, 'unreviewed'))).not.toBe('validated');
  });
  it('maps provenance to the five workbench states', () => {
    expect(reconstructionState(p('technical_document', 'unreviewed'))).toBe('observed');
    expect(reconstructionState(p('user', 'unreviewed'))).toBe('observed');
    expect(reconstructionState(p('derived', 'unreviewed'))).toBe('inferred');
    expect(reconstructionState(p('solver', 'unreviewed'))).toBe('inferred');
    expect(reconstructionState(p('derived', 'ambiguous'))).toBe('provisional');
    expect(reconstructionState(p('user', 'verified'))).toBe('validated');
    expect(reconstructionState(p('derived', 'corrected'))).toBe('validated');
    expect(reconstructionState(p('user', 'rejected'))).toBe('rejected');
    expect(reconstructionState(undefined)).toBeUndefined();
  });
  it('renders icon and text label, not colour alone', () => {
    const html = reconstructionChip('provisional', 'derived · ambiguous');
    expect(html).toContain('Provisional');
    expect(html).toContain('<svg');
    expect(html).toContain('data-state="provisional"');
  });
  it('counts components without geometry separately', () => {
    expect(countReconstructionStates(['observed', 'observed', undefined, 'rejected'])).toEqual({ observed: 2, inferred: 0, provisional: 0, validated: 0, rejected: 1, none: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { explainUnsupportedSpatialCommand, parseSpatialCommand } from '../src/spatial-command';

describe('deterministic spatial command parser', () => {
  it.each([
    ['UNFOLD, desmonta o mecanismo.', { kind: 'explode' }],
    ['Remonta tudo.', { kind: 'reassemble' }],
    ['Mostra-me a manivela.', { kind: 'focus', componentId: 'crank' }],
    ['Enquadra o mecanismo.', { kind: 'fit' }],
    ['Volta à vista inicial.', { kind: 'home' }],
    ['Aumenta a manivela para 50 milímetros.', { kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' }],
  ])('%s', (input, expected) => {
    expect(parseSpatialCommand(input)).toEqual({ status: 'recognized', action: expected });
  });

  it('rejects unknown commands and invalid lengths without side effects', () => {
    expect(parseSpatialCommand('Faz uma coisa qualquer')).toEqual({ status: 'unknown', reason: expect.any(String) });
    expect(parseSpatialCommand('Aumenta a manivela para -10 mm').status).toBe('unknown');
  });

  it('resolves a length request only with an explicit or selected component', () => {
    expect(parseSpatialCommand('Aumenta para 50 mm')).toEqual({ status: 'unknown', reason: 'Qual é a barra que pretende alterar?' });
    expect(parseSpatialCommand('Aumenta para 50 mm', 'crank')).toEqual({ status: 'recognized', action: { kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' } });
    expect(parseSpatialCommand('Aumenta o acoplador para 50 mm').status).toBe('recognized');
    expect(parseSpatialCommand('E se a diminuir para 30?', 'crank')).toEqual({ status: 'recognized', action: { kind: 'update_length', componentId: 'crank', value: 30, unit: 'mm' } });
    expect(parseSpatialCommand('Aumenta para 50,5 mm', 'crank')).toEqual({ status: 'recognized', action: { kind: 'update_length', componentId: 'crank', value: 50.5, unit: 'mm' } });
    expect(parseSpatialCommand('Agora desmonta o mecanismo')).toEqual({ status: 'recognized', action: { kind: 'explode' } });
  });

  it('explains unsupported compound actions without executing a supported prefix', () => {
    const command = 'Desmonta e coloca tudo em linha recta';
    expect(parseSpatialCommand(command).status).toBe('unknown');
    expect(explainUnsupportedSpatialCommand(command, 'Comando não reconhecido.')).toContain('a disposição em linha recta ainda não está disponível');
    expect(explainUnsupportedSpatialCommand('Faz algo impossível', 'Comando não reconhecido.')).toBe('Comando não reconhecido. Nada foi executado.');
  });
});

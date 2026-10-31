import { afterEach, describe, expect, it } from 'vitest';
import { executeActiveSpatialCommand, hasActiveSpatialCommandHandler, registerSpatialCommandHandler } from '../src/spatial-command-runtime';

let unregister: (() => void) | undefined;
afterEach(() => { unregister?.(); unregister = undefined; });

describe('spatial command bridge lifecycle', () => {
  it('routes through one active editor handler and unregisters it on disposal', async () => {
    const handler = async (input: string) => ({ status: 'preview' as const, message: `preview:${input}` });
    unregister = registerSpatialCommandHandler(handler);
    expect(hasActiveSpatialCommandHandler()).toBe(true);
    expect(await executeActiveSpatialCommand('test')).toEqual({ status: 'preview', message: 'preview:test' });
    expect(() => registerSpatialCommandHandler(handler)).toThrow('SPATIAL_COMMAND_HANDLER_ALREADY_REGISTERED');
    unregister(); unregister = undefined;
    expect(hasActiveSpatialCommandHandler()).toBe(false);
    expect(await executeActiveSpatialCommand('orphan')).toBeUndefined();
  });

  it('passes voice transcripts through the same active handler without changing their origin', async () => {
    unregister = registerSpatialCommandHandler(async (input, origin) => ({ status: 'preview', message: `${origin}:${input}` }));
    expect(await executeActiveSpatialCommand('move wall', 'speech_transcript')).toEqual({ status: 'preview', message: 'speech_transcript:move wall' });
  });
});

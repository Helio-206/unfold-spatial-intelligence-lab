import type { SpatialCommandOrigin, SpatialCommandState } from './spatial-command-protocol';

export type SpatialCommandOutcome = { status: 'completed' | 'preview' | 'clarification' | 'rejected' | 'failed'; message: string };
export type SpatialCommandHandler = (input: string, origin: SpatialCommandOrigin, signal?: AbortSignal) => Promise<SpatialCommandOutcome>;
export type SpatialCommandStateHandler = (state: SpatialCommandState, message: string) => void;

let activeHandler: SpatialCommandHandler | undefined;

export function registerSpatialCommandHandler(handler: SpatialCommandHandler): () => void {
  if (activeHandler) throw new Error('SPATIAL_COMMAND_HANDLER_ALREADY_REGISTERED');
  activeHandler = handler;
  return () => { if (activeHandler === handler) activeHandler = undefined; };
}

export function hasActiveSpatialCommandHandler(): boolean { return activeHandler !== undefined; }

export async function executeActiveSpatialCommand(input: string, origin: SpatialCommandOrigin = 'local_deterministic', signal?: AbortSignal): Promise<SpatialCommandOutcome | undefined> {
  if (!activeHandler) return undefined;
  return activeHandler(input, origin, signal);
}

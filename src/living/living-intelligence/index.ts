export * from './contracts';
export * from './motion';
export * from './behaviours';
export * from './tutor';
export * from './intents';
export * from './experiments';
export * from './fixtures';
export * from './scenario-store';
export * from './space-bridge';
export { mountLivingIntelligence, LivingIntelligencePanel, type LivingWorkspacePort } from './panel';

/** Flag experimental: nunca activo por omissão. Requer também `debug-living` (decisão do shell). */
export function livingIntelligenceEnabled(params: URLSearchParams): boolean {
  return params.has('experimental-living-intelligence');
}

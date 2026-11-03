import mark from '../../../design-system/logos/unfold-mark-on-dark.svg';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { SpatialWorkspace, type WorkspaceOptions } from './workspace';

/** The synthetic reference assembly remains explicitly identified in the workspace. */
export function mountLivingWorkspace(host: HTMLElement, extra: Partial<WorkspaceOptions> = {}): SpatialWorkspace {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug-living');
  const workspace = new SpatialWorkspace(host, {
    assembly: EXCAVATOR_ASSEMBLY_V1,
    logoSrc: mark,
    agent: { mode: debug && params.get('agent') === 'fixture' ? 'fixture' : 'auto' },
    reducedMotion: debug && params.has('rm') ? params.get('rm') === '1' : undefined,
    ...extra,
  });
  if (debug) Object.assign(window, { __workspace: workspace, __foundry: { ready: true } });
  const onHide = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    window.removeEventListener('pagehide', onHide); workspace.dispose();
  };
  window.addEventListener('pagehide', onHide);
  return workspace;
}

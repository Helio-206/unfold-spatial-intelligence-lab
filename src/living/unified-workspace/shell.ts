import './unified.css';
import scanIcon from 'lucide-static/icons/scan-line.svg?raw';
import { mountExperience } from '../experience/experience';
import { DemoReconstructionPort, type DemoScenario } from '../experience/intake';
import { mountLivingWorkspace } from '../workspace-design/page';
import { createReconstructionClient } from './reconstruction-client';
import { LiveReconstructionPort } from './live-port';
import { asReviewHandoff, ReviewGateway } from './review-bridge';
import { WorkspaceLabHost } from './lab-host';

/**
 * `/living`. One laboratory: the workspace. By default it opens on the reference machine exactly as before.
 * `?flow=reconstruct` starts from an empty lab: source -> reconstruction -> review -> transition -> the same workspace,
 * now built from the approved assembly. Moving between the two is a real navigation (a link), so the browser history,
 * back-forward cache and disposal keep working as they already do.
 */
export function mountLivingShell(app: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug-living');
  const flow = params.get('flow') === 'reconstruct';
  const link = document.createElement('a');
  link.className = 'ls-link u-label';

  if (!flow) {
    // the reference workspace: the way into the reconstruction is a tool in its own rail, not a floating control
    mountLivingWorkspace(app, { extraTools: [{ id: 'reconstruct', label: 'Reconstruir uma máquina', hint: 'a partir de fotografia, desenho ou texto', icon: scanIcon, run: () => location.assign('/living?flow=reconstruct') }] });
    return;
  }

  // flow screens (before the lab): a quiet way back to the reference workspace, inside the experience so it hides in the lab
  link.href = '/living'; link.textContent = 'espaço de trabalho de referência'; link.dataset.shell = 'reference';
  const attachLink = () => { const root = app.querySelector('.ux-root'); if (root && !link.isConnected) root.append(link); };
  const base = { agent: { mode: (debug && params.get('agent') === 'fixture' ? 'fixture' : 'auto') as 'fixture' | 'auto' }, reducedMotion: debug && params.has('rm') ? params.get('rm') === '1' : undefined };
  // The demonstration port exists only on request and is labelled on every screen; it never reaches the real lab.
  if (params.has('demo')) {
    void mountExperience(app, { port: new DemoReconstructionPort((params.get('scenario') as DemoScenario | null) ?? 'observation', Number(params.get('delay') ?? 1200)) }).then(attachLink);
    return;
  }
  const port = new LiveReconstructionPort({ client: createReconstructionClient() });
  const gateway = new ReviewGateway(port.session);
  const lab = new WorkspaceLabHost({
    base,
    onMount: (workspace) => { if (debug) Object.assign(window, { __workspace: workspace, __foundry: { ready: true } }); },
    onUnmount: () => { if (debug) Object.assign(window, { __workspace: null }); },
  });
  if (debug) Object.assign(window, { __unified: { port, gateway, lab } });
  addEventListener('pagehide', (event) => { if (!(event as PageTransitionEvent).persisted) { lab.unmount(); port.session.dispose(); } });
  void mountExperience(app, { port, handoff: asReviewHandoff(gateway), lab }).then(attachLink);
}

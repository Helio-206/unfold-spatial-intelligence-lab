import './unified.css';
import plusIcon from 'lucide-static/icons/plus.svg?raw';
import { mountExperience } from '../experience/experience';
import { DemoReconstructionPort, type DemoScenario } from '../experience/intake';
import { mountLivingWorkspace } from '../workspace-design/page';
import { createReconstructionClient } from './reconstruction-client';
import { LiveReconstructionPort } from './live-port';
import { asReviewHandoff, ReviewGateway } from './review-bridge';
import { WorkspaceLabHost } from './lab-host';
import { createStudioEnvironment } from '../cinema/studio-environment';

/** Same page, other mode; every query parameter the person or a test set (debug, motion, agent) is kept. */
function livingUrl(change: { example?: boolean }): string {
  const params = new URLSearchParams(location.search);
  params.delete('flow'); params.delete('demo'); params.delete('scenario'); params.delete('delay');
  if (change.example) params.set('example', '1'); else params.delete('example');
  const query = params.toString();
  return `/living${query ? `?${query}` : ''}`;
}

/**
 * `/living`: one laboratory, the workspace, and it opens EMPTY.
 *
 *   /living            empty lab -> source -> reconstruction -> review -> transition -> the workspace, built from the approved assembly
 *   /living?example=1  the synthetic reference machine, openly labelled as an example, never as something reconstructed
 *
 * Moving between the two is a real navigation, so the browser history, the back-forward cache and disposal keep working.
 * `?flow=reconstruct` is the old name for the default and is still accepted. `?demo` is the Design's labelled demonstration
 * port; it never reaches the real lab.
 */
export function mountLivingShell(app: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug-living');

  if (params.has('example')) {
    mountLivingWorkspace(app, {
      look: 'premium', premiumEnvironment: createStudioEnvironment,
      brandLabel: 'exemplo · montagem sintética',
      initialNotices: [{
        id: 'example',
        text: 'Exemplo: máquina sintética de referência · não foi reconstruída a partir de nenhuma fotografia',
        detail: 'A geometria e as dimensões são de uma montagem de demonstração, escolhida por plausibilidade, não de um fabricante nem de uma fonte sua. Para reconstruir a sua máquina, comece um novo projecto.',
      }],
      extraTools: [{ id: 'new', label: 'Novo projecto', hint: 'volta ao laboratório vazio', icon: plusIcon, run: () => location.assign(livingUrl({ example: false })) }],
    });
    return;
  }

  const base = { agent: { mode: (debug && params.get('agent') === 'fixture' ? 'fixture' : 'auto') as 'fixture' | 'auto' }, reducedMotion: debug && params.has('rm') ? params.get('rm') === '1' : undefined };
  const example = { run: () => location.assign(livingUrl({ example: true })) };
  // The demonstration port exists only on request and is labelled on every screen; it never reaches the real lab.
  if (params.has('demo')) {
    void mountExperience(app, { port: new DemoReconstructionPort((params.get('scenario') as DemoScenario | null) ?? 'observation', Number(params.get('delay') ?? 1200)), example });
    return;
  }
  const port = new LiveReconstructionPort({ client: createReconstructionClient({ timeoutMs: 90_000 }) });
  const gateway = new ReviewGateway(port.session);
  const lab = new WorkspaceLabHost({
    base,
    onMount: (workspace) => { if (debug) Object.assign(window, { __workspace: workspace, __foundry: { ready: true } }); },
    onUnmount: () => { if (debug) Object.assign(window, { __workspace: null }); },
  });
  if (debug) Object.assign(window, { __unified: { port, gateway, lab } });
  addEventListener('pagehide', (event) => { if (!(event as PageTransitionEvent).persisted) { lab.unmount(); port.session.dispose(); } });
  void mountExperience(app, { port, handoff: asReviewHandoff(gateway), lab, example });
}

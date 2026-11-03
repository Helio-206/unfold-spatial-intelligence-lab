import './unified.css';
import mark from '../../../design-system/logos/unfold-mark-on-dark.svg';
import { mountExperience } from '../experience/experience';
import { DemoReconstructionPort, type DemoScenario } from '../experience/intake';
import type { ComposerMode, EmbeddedHost, ExperienceApi } from '../experience/integration';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { SpatialWorkspace } from '../workspace-design/workspace';
import { createStudioEnvironment } from '../cinema/studio-environment';
import { createReconstructionClient } from './reconstruction-client';
import { LiveReconstructionPort } from './live-port';
import { asReviewHandoff, ReviewGateway } from './review-bridge';
import { EMPTY_BRAND, newProjectIcon, WorkspaceStageHost } from './lab-host';

const EXAMPLE_NOTICE = {
  id: 'example',
  text: 'Exemplo: máquina sintética de referência · não foi reconstruída a partir de nenhuma fotografia',
  detail: 'A geometria e as dimensões são de uma montagem de demonstração, escolhida por plausibilidade, não de um fabricante nem de uma fonte sua. Para reconstruir a sua máquina, comece um novo projecto.',
};

/** What the composer says in each phase of the flow. The composer is the same one, whatever the machine or the domain. */
const COMPOSER_COPY: Record<ComposerMode, { placeholder: string; status: string; disabled?: boolean } | null> = {
  intake: { placeholder: 'Descreva a máquina ou anexe uma fotografia', status: 'PNG, JPEG ou WebP · até 10 MB' },
  busy: { placeholder: 'A aguardar o modelo…', status: 'A reconstruir; pode cancelar no painel.', disabled: true },
  review: { placeholder: 'Termine a revisão para falar com o assistente', status: 'A revisão é sua; o assistente abre no laboratório.', disabled: true },
  lab: null,
};

/**
 * `/living`: ONE workspace, from the empty stage to the machine.
 *
 * The workspace (stage, rail, composer, brand) is created once and never replaced. Import and review are panels hosted inside it
 * (`panelHost`); adopting an assembly replaces the machine on the same stage; the example is another machine on that stage, openly
 * labelled. `?example=1` opens the example at once. `?demo` is the Design's labelled prototype (its own page, never the real lab).
 */
export function mountLivingShell(app: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug-living');

  if (params.has('demo')) {
    void mountExperience(app, { port: new DemoReconstructionPort((params.get('scenario') as DemoScenario | null) ?? 'observation', Number(params.get('delay') ?? 1200)) });
    return;
  }

  const workspace = new SpatialWorkspace(app, {
    assembly: EXCAVATOR_ASSEMBLY_V1, // the hidden placeholder behind the empty stage; replaced by the first machine
    startEmpty: true, look: 'premium', premiumEnvironment: createStudioEnvironment, logoSrc: mark, brandLabel: EMPTY_BRAND,
    agent: { mode: debug && params.get('agent') === 'fixture' ? 'fixture' : 'auto' },
    reducedMotion: debug && params.has('rm') ? params.get('rm') === '1' : undefined,
  });
  let api: ExperienceApi | null = null;
  const embedded: EmbeddedHost = {
    host: workspace.panelHost,
    setComposer(mode, intake) {
      const copy = COMPOSER_COPY[mode];
      workspace.setComposerIntake(copy ? { onText: intake.text, onFile: intake.file, ...copy } : null);
    },
  };
  const port = new LiveReconstructionPort({ client: createReconstructionClient({ timeoutMs: 90_000 }) });
  const gateway = new ReviewGateway(port.session);
  const lab = new WorkspaceStageHost(workspace);
  const example = {
    run: () => workspace.replaceAssembly(EXCAVATOR_ASSEMBLY_V1, {
      reveal: true, brandLabel: 'exemplo · montagem sintética', notices: [EXAMPLE_NOTICE],
      extraTools: [{ id: 'new', label: 'Novo projecto', hint: 'volta ao laboratório vazio', icon: newProjectIcon, run: () => api?.restart() }],
    }),
    close: () => { if (!workspace.isEmpty) workspace.clearMachine({ brandLabel: EMPTY_BRAND, notices: [], extraTools: [] }); },
  };
  if (debug) Object.assign(window, { __workspace: workspace, __foundry: { ready: !params.has('example') }, __unified: { port, gateway, lab } });
  addEventListener('pagehide', (event) => { if (!(event as PageTransitionEvent).persisted) { workspace.dispose(); port.session.dispose(); } });
  void mountExperience(app, { port, handoff: asReviewHandoff(gateway), lab, example, embedded }).then((experience) => {
    api = experience;
    if (params.has('example')) { experience.openExample(); if (debug) (window as unknown as { __foundry: { ready: boolean } }).__foundry.ready = true; }
  });
}

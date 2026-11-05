import { FoundryGeometry } from '../universal-foundry/provider';
import { PhotorealGeometry, applyPhotorealStage, type PhotorealStage } from '../photoreal/look';
import { detectCapabilities, selectPhotorealPreset } from '../photoreal/presets';
import { mountFoundryPanel } from '../universal-foundry/panel';
import { evidenceFromDataUrl } from '../universal-foundry/browser';
import { ExperimentalV4 } from '../spatial-space/experimental-v4';
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
import { SpaceFlow } from '../spatial-space/flow';
import { mountLivingIntelligence, livingIntelligenceEnabled } from '../living-intelligence';

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
  // New Space: any object, from text or a photograph, through Muse Spark and a human review, on this same stage. Its panels sit beside the experience's.
  const experienceRoot = () => workspace.panelHost.querySelector<HTMLElement>('.ux-root');
  const foundry = debug && params.has('experimental-foundry') ? new FoundryGeometry() : null;
  // Experimental photoreal rendering: wraps the Foundry geometry seam (materials follow the
  // authoritative plan on every compile) and dresses the stage once a Space is live. Without the
  // flag, neither exists and the renderer behaves exactly as before.
  // Capabilities are decided before any material is touched: an unsupported renderer keeps the
  // original path completely (stock materials included), not just the stock stage.
  const photorealPreset = foundry && params.has('experimental-photoreal') ? selectPhotorealPreset('balanced', detectCapabilities(workspace.photorealStage().renderer)) : null;
  const photoreal = foundry && photorealPreset ? new PhotorealGeometry(foundry, { microdetail: photorealPreset.microdetail }) : null;
  let photorealStage: PhotorealStage | null = null;
  const space = new SpaceFlow({
    workspace, host: workspace.panelHost,
    ...(foundry ? { geometry: () => photoreal ?? foundry, onImage: (dataUrl: string) => { if (!dataUrl) foundry.setEvidence(null); else void evidenceFromDataUrl(dataUrl).then((e) => foundry.setEvidence(e)); } } : {}),
    onActive: (active) => { const root = experienceRoot(); if (root) root.hidden = active; },
    onExit: () => { const root = experienceRoot(); if (root) root.hidden = false; api?.restart(); },
  });
  const foundryPanel = foundry ? mountFoundryPanel(foundry, () => space.layer) : null;
  const experimentalV4 = debug && params.has('experimental-v4') ? new ExperimentalV4(() => space.layer, id => workspace.select(id), () => space.currentReviewId) : null;
  let livingIntelligence: ReturnType<typeof mountLivingIntelligence> | null = null;
  if (debug) Object.assign(window, { __workspace: workspace, __foundry: { ready: !params.has('example') }, __unified: { port, gateway, lab }, __space: space, ...(experimentalV4 ? { __v4: experimentalV4 } : {}), ...(foundry ? { __foundry3d: foundry } : {}), ...(photoreal ? { __photoreal: { active: () => photorealStage !== null, stage: () => photorealStage } } : {}) });
  if (photoreal) {
    const dress = () => {
      if (!photorealStage && workspace.spaceActive) { const stage = workspace.photorealStage(); photorealStage = applyPhotorealStage(stage.renderer, stage.scene, photorealPreset?.name ?? 'balanced'); }
      if (photorealStage && !workspace.spaceActive) { photorealStage.dispose(); photorealStage = null; }
    };
    const timer = setInterval(dress, 400);
    addEventListener('pagehide', () => { clearInterval(timer); photorealStage?.dispose(); photorealStage = null; });
  }
  addEventListener('pagehide', (event) => { if (!(event as PageTransitionEvent).persisted) { livingIntelligence?.dispose(); experimentalV4?.dispose(); foundryPanel?.dispose(); space.dispose(); workspace.dispose(); port.session.dispose(); } });
  void mountExperience(app, { port, handoff: asReviewHandoff(gateway), lab, example, space: { open: () => space.open() }, embedded }).then((experience) => {
    api = experience;
    if (params.has('example')) { experience.openExample(); if (debug) (window as unknown as { __foundry: { ready: boolean } }).__foundry.ready = true; }
    // Depois da experiência montar (ela reconstrói a app): o painel vivo entra por cima do mesmo palco, nunca como outra aplicação.
    if (debug && livingIntelligenceEnabled(params)) { livingIntelligence = mountLivingIntelligence(app, workspace); if (debug) Object.assign(window, { __living: livingIntelligence }); }
  });
}

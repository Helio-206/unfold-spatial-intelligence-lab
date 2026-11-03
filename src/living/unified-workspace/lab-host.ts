import mark from '../../../design-system/logos/unfold-mark-on-dark.svg';
import arrowLeftIcon from 'lucide-static/icons/arrow-left.svg?raw';
import plusIcon from 'lucide-static/icons/plus.svg?raw';
import type { LabContext, LabHost } from '../experience/integration';
import { SpatialWorkspace, type WorkspaceOptions } from '../workspace-design/workspace';
import type { WorkspaceCandidate } from './workspace-adapter';
import { visualCapacityIssues } from './visual-capacity';
import { createStudioEnvironment } from '../cinema/studio-environment';

export type LabHostOptions = {
  /** Same switches as `/living`: agent mode and reduced motion are only honoured with `?debug-living`. */
  base?: Pick<WorkspaceOptions, 'agent' | 'reducedMotion'>;
  onMount?: (workspace: SpatialWorkspace) => void;
  onUnmount?: () => void;
};

const fmt = (m: number) => m.toFixed(2).replace('.', ',');

/** Notices that tell the truth about a reconstructed assembly, inside the lab itself. */
export function candidateNotices(candidate: WorkspaceCandidate, gates: LabContext['gates']): Array<{ id: string; text: string; detail: string }> {
  return [{
    id: 'reconstruction',
    text: 'Geometria sintética de referência · largura da caçamba sua, não verificada',
    detail: `Revisão humana: ${gates.review}. Validação de engenharia: ${gates.engine} (o motor resolveu a pose de referência; não certifica segurança nem movimento). `
      + `A largura da caçamba (${fmt(candidate.bucketWidthM.after)} m, antes ${fmt(candidate.bucketWidthM.before)} m) e a revisão são suas e não foram verificadas; o resto da geometria é sintético. `
      + 'A malha 3D ainda não mostra esta largura: a forma que vê é de demonstração.',
  }];
}

/**
 * The real laboratory for the experience: the same `SpatialWorkspace` as `/living`, built from the approved assembly.
 * Replacing the assembly means disposing this workspace and building a new one, so the engineering session, the component
 * registry, the hand, the selection and the conversation all start from the new assembly instead of carrying the old one.
 */
export class WorkspaceLabHost implements LabHost {
  workspace: SpatialWorkspace | null = null;
  private host: HTMLElement | null = null;
  constructor(private readonly options: LabHostOptions = {}) {}

  mount(host: HTMLElement, candidateValue: unknown, context: LabContext): void {
    this.unmount();
    const candidate = candidateValue as WorkspaceCandidate;
    if (!candidate || candidate.motionAuthorized !== false || !candidate.assembly) throw new Error('LAB_CANDIDATE_INVALID');
    // adoption already checks this; mounting must not depend on it, because the Foundry throws on a width it cannot draw
    const cannotDraw = visualCapacityIssues(candidate.assembly);
    if (cannotDraw.length) throw new Error(`LAB_CANDIDATE_NOT_DRAWABLE: ${cannotDraw.join(' ')}`);
    this.host = host;
    this.workspace = new SpatialWorkspace(host, {
      assembly: candidate.assembly, logoSrc: mark, ...this.options.base, look: 'premium', premiumEnvironment: createStudioEnvironment,
      brandLabel: 'reconstrução revista', initialNotices: candidateNotices(candidate, context.gates),
      extraTools: [
        { id: 'review', label: 'Rever a reconstrução', hint: 'volta às decisões, que se mantêm', icon: arrowLeftIcon, run: context.back },
        { id: 'restart', label: 'Nova máquina', hint: 'esquece esta reconstrução', icon: plusIcon, run: context.restart },
      ],
    });
    this.options.onMount?.(this.workspace);
  }

  unmount(): void {
    if (!this.workspace) return;
    this.workspace.dispose(); this.workspace = null;
    this.host?.replaceChildren(); this.host = null;
    this.options.onUnmount?.();
  }
}

import arrowLeftIcon from 'lucide-static/icons/arrow-left.svg?raw';
import plusIcon from 'lucide-static/icons/plus.svg?raw';
import type { LabContext, LabHost } from '../experience/integration';
import type { SpatialWorkspace } from '../workspace-design/workspace';
import type { WorkspaceCandidate } from './workspace-adapter';
import { visualCapacityIssues } from './visual-capacity';

export const EMPTY_BRAND = 'laboratório vazio';
const fmt = (m: number) => m.toFixed(2).replace('.', ',');

/** Notices that tell the truth about a reconstructed assembly, inside the lab itself. */
export function candidateNotices(candidate: WorkspaceCandidate, gates: LabContext['gates']): Array<{ id: string; text: string; detail: string }> {
  return [{
    id: 'reconstruction',
    text: 'Largura da caçamba sua e não verificada · restante geometria sintética',
    detail: `Revisão humana: ${gates.review}. Validação de engenharia: ${gates.engine} (o motor resolveu a pose de referência; não certifica segurança nem movimento). `
      + `A malha 3D da caçamba segue a largura que indicou (${fmt(candidate.bucketWidthM.after)} m, antes ${fmt(candidate.bucketWidthM.before)} m). Essa largura é um valor seu: não foi medida nem verificada pela Meta nem por qualquer outra fonte. `
      + 'O resto da geometria é sintético (referência), e a revisão é sua e não foi verificada.',
  }];
}

/**
 * The laboratory is the one persistent workspace. Adopting an assembly replaces the machine ON ITS STAGE: the renderer, the
 * canvas, the rail, the composer and the brand stay, and engine session, component registry, scene, hand, selection and
 * conversation are rebuilt from the new assembly. Leaving empties the stage again.
 */
export class WorkspaceStageHost implements LabHost {
  constructor(private readonly workspace: SpatialWorkspace) {}

  mount(_host: HTMLElement, candidateValue: unknown, context: LabContext): void {
    const candidate = candidateValue as WorkspaceCandidate;
    if (!candidate || candidate.motionAuthorized !== false || !candidate.assembly) throw new Error('LAB_CANDIDATE_INVALID');
    // adoption already checks this; mounting must not depend on it, because the Foundry throws on a width it cannot draw
    const cannotDraw = visualCapacityIssues(candidate.assembly);
    if (cannotDraw.length) throw new Error(`LAB_CANDIDATE_NOT_DRAWABLE: ${cannotDraw.join(' ')}`);
    this.workspace.replaceAssembly(candidate.assembly, {
      reveal: true, brandLabel: 'reconstrução revista', notices: candidateNotices(candidate, context.gates),
      extraTools: [
        { id: 'review', label: 'Rever a reconstrução', hint: 'volta às decisões, que se mantêm', icon: arrowLeftIcon, run: context.back },
        { id: 'restart', label: 'Nova máquina', hint: 'esquece esta reconstrução', icon: plusIcon, run: context.restart },
      ],
    });
  }

  unmount(): void { this.workspace.clearMachine({ brandLabel: EMPTY_BRAND, notices: [], extraTools: [] }); }
}

export { plusIcon as newProjectIcon };

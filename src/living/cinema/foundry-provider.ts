import type { Object3D } from 'three';
import { PROVIDER_ID, createExcavatorProvider } from '../visual-foundry/provider';
import { referencePoses } from '../visual-foundry/poses';
import type { PoseSample } from './pose-source';
import type { MachineVisualProvider, MachineVisuals } from './visual-provider';

/**
 * Adapter from the Visual Foundry's `GeometryProvider` (high-fidelity excavator, canonical part ids) to the cinema's `MachineVisualProvider`.
 * The Foundry owns geometry and materials; the cinema owns stage, camera and post. Poses go in as the Foundry requires:
 *  - an `ok` engine frame: `provider.applyFrame(frame)` (it validates again and routes the flexible hoses);
 *  - the reference sample, or a blocked frame whose poseBasis is `reference` and whose poses ARE the reference: `provider.applyReferencePose()`;
 *  - anything else that has poses (a held pose, a blend of two valid frames): `provider.applyDisplayPoses`, which re-routes the hoses too and carries no engine provenance;
 *  - no poses: nothing applied (the runtime hides the machine).
 * Nothing is interpolated or invented here.
 */
const SAME = 1e-9;
export const foundryVisualProvider = (): MachineVisualProvider => ({
  id: PROVIDER_ID,
  load(assembly): MachineVisuals {
    const provider = createExcavatorProvider(assembly);
    provider.applyReferencePose();
    const matchesReference = (sample: PoseSample) => {
      const ref = new Map(referencePoses().poses.map((p) => [p.partId, p]));
      return sample.parts.length === ref.size && sample.parts.every((p) => { const r = ref.get(p.partId); return !!r && r.translationM.every((v, i) => Math.abs(v - p.translationM[i]!) < SAME) && Math.abs(Math.abs(r.rotation.reduce((s, v, i) => s + v * p.rotation[i]!, 0)) - 1) < SAME; });
    };
    return {
      source: 'visual-foundry', root: provider.root, parts: provider.parts as ReadonlyMap<string, Object3D>, registry: provider.registry,
      applyPose(sample) {
        if (sample.parts.length === 0) return { applied: 0, unknown: [], refused: null };
        if (sample.status === 'reference' || (sample.poseBasis === 'reference' && matchesReference(sample))) { const r = provider.applyReferencePose(); return { applied: r.status === 'applied' ? provider.parts.size : 0, unknown: r.status === 'applied' ? r.unknownPartIds : [], refused: r.status === 'refused' ? r.reason : null }; }
        if (sample.frame && sample.frame.status === 'ok') { const r = provider.applyFrame(sample.frame); return r.status === 'applied' ? { applied: sample.parts.length - r.unknownPartIds.length, unknown: r.unknownPartIds, refused: null } : { applied: 0, unknown: [], refused: r.reason }; }
        // a blend of two valid engine frames, or a held pose: the Foundry places them (and re-routes the hoses) but never labels them an engine frame
        const r = provider.applyDisplayPoses(sample.parts);
        return r.status === 'applied' ? { applied: sample.parts.length - r.unknownPartIds.length, unknown: r.unknownPartIds, refused: null } : { applied: 0, unknown: [], refused: r.reason };
      },
      dispose() { provider.dispose(); },
    };
  },
});

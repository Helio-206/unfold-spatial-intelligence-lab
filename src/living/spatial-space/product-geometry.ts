import { InstancedMesh, Mesh } from 'three';
import type { GeometryNodeV2, SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../universal-spatial/geometry-compiler-v2';
import { ContinuousService, createBrowserWorker, type WorkerLike } from '../../universal-spatial/fidelity/continuous-service';
import { compileWithRouter, type RoutedPlan } from '../../universal-spatial/fidelity/router';
import type { GeometryFamily, RouterReport } from '../../universal-spatial/fidelity/types';

/** Conservative policy: only single, non-repeated tube or torus shapes; generic cylinders/boxes stay V2. */
export function productGeometryRequests(plan: SpatialPlanV2): Record<string, GeometryFamily> {
  return Object.fromEntries(plan.components.map(c => {
    const n: GeometryNodeV2 = c.geometry;
    const eligible = plan.components.length <= 32 && n.type === 'shape' && n.repeat === null && (n.operator === 'tube' || n.operator === 'torus');
    return [c.id, eligible ? 'continuous_surface' : 'procedural_v2'];
  }));
}

/** Owned by one Space. Never uses an inline worker in the product path. */
export class ProductGeometry {
  private readonly service: ContinuousService | null;
  private failure: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private current: RoutedPlan | null = null;
  private closed = false;
  constructor(createWorker: (() => WorkerLike) | null = typeof Worker === 'undefined' ? null : createBrowserWorker) {
    this.service = createWorker ? new ContinuousService({ createWorker, poolSize: 1, maxCacheBytes: 16 * 1024 * 1024, jobTimeoutMs: 5000, maxQueue: 32 }) : null;
  }
  compile = (plan: SpatialPlanV2): ReturnType<typeof compileSpatialPlanV2> => {
    if (!this.service || this.closed || this.failure) return this.fallback(plan, this.failure ?? 'WORKER_UNAVAILABLE');
    try {
      this.current = compileWithRouter(plan, { service: this.service, policy: 'auto', requests: productGeometryRequests(plan), upgradeBudget: { maxWorkMs: 4, maxComponentTriangles: 12_000 }, limits: { maxTriangles: 160_000, maxGeometryBytes: 16 * 1024 * 1024, maxGridCells: 64 } });
      return this.current;
    } catch {
      this.failure = 'ROUTER_ERROR'; this.service.dispose(); this.current = null;
      return this.fallback(plan, this.failure);
    }
  };
  private fallback(plan: SpatialPlanV2, reason: string): ReturnType<typeof compileSpatialPlanV2> {
    const compiled = compileSpatialPlanV2(plan);
    const triangles = new Map<string, number>();
    compiled.root.traverse(o => { if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const g = o.geometry; const count = (g.index ? g.index.count : g.getAttribute('position').count) / 3 * (o instanceof InstancedMesh ? o.count : 1); triangles.set(o.userData.spatialEntityId, (triangles.get(o.userData.spatialEntityId) ?? 0) + count); });
    const decisions = plan.components.map(c => ({ componentId: c.id, requested: null, used: 'procedural_v2' as const, reason: `Stays on V2: ${reason}.`, fallback: { from: 'continuous_surface' as const, code: reason }, planGeometryOrigin: c.provenance.geometry, representation: 'derived_from_plan' as const, assetId: null, triangles: triangles.get(c.id) ?? 0 }));
    const report: RouterReport = { planSource: { ...plan.source }, decisions, proposalsNotApproved: [], pending: [], service: null, limits: { maxTriangles: 160_000, maxMeshes: 1000, maxGeometryBytes: 16 * 1024 * 1024, maxGridCells: 64, maxAssetBytes: 20 * 1024 * 1024, maxTextureSide: 2048, maxTextureBytes: 64 * 1024 * 1024, maxAssetTriangles: 300_000, maxAssetNodes: 512 }, totals: { triangles: compiled.stats.triangleCount, meshes: compiled.stats.meshCount, geometryBytes: compiled.stats.geometryBytes, ms: 0 }, perFamily: { procedural_v2: { components: plan.components.length, triangles: compiled.stats.triangleCount, ms: 0 }, continuous_surface: { components: 0, triangles: 0, ms: 0 }, mesh_asset: { components: 0, triangles: 0, ms: 0 }, universal_foundry: { components: 0, triangles: 0, ms: 0 } }, fallbacks: decisions.length };
    return { ...compiled, report } as ReturnType<typeof compileSpatialPlanV2>;
  }
  attach(onReady: () => void): void { this.unsubscribe?.(); this.unsubscribe = this.closed || this.failure ? null : this.service?.onReady(onReady) ?? null; }
  report(): RouterReport | null { return this.current?.report ?? null; }
  dispose(): void { if (this.closed) return; this.closed = true; this.unsubscribe?.(); this.unsubscribe = null; this.service?.dispose(); this.current = null; }
}

import type { ValueOrigin } from '../contracts';

/**
 * Contract of the Adaptive Geometry Router (V3). Prose and rules: `./CONTRACT.md`.
 *
 * The reviewed V2 plan stays the single source of truth for WHAT the object is: components, hierarchy, relations, provenance, source hash and the human
 * review. A geometry family only decides HOW a component is drawn. The router never writes the plan and never changes which components exist.
 */
export type GeometryFamily = 'procedural_v2' | 'continuous_surface' | 'mesh_asset' | 'universal_foundry';

export type RouterLimits = {
  /** triangles over the whole compiled scene */
  maxTriangles: number;
  maxMeshes: number;
  /** vertex + index bytes over the whole compiled scene */
  maxGeometryBytes: number;
  /** longest axis of the sampling grid of one continuous-surface component */
  maxGridCells: number;
  /** a GLB file */
  maxAssetBytes: number;
  /** one texture, any side, in pixels */
  maxTextureSide: number;
  /** all textures of one asset, decoded RGBA bytes */
  maxTextureBytes: number;
  maxAssetTriangles: number;
  maxAssetNodes: number;
};
export const DEFAULT_ROUTER_LIMITS: RouterLimits = {
  maxTriangles: 400_000, maxMeshes: 1_000, maxGeometryBytes: 48 * 1024 * 1024, maxGridCells: 96,
  maxAssetBytes: 20 * 1024 * 1024, maxTextureSide: 2048, maxTextureBytes: 64 * 1024 * 1024, maxAssetTriangles: 300_000, maxAssetNodes: 512,
};

/** Why a component was drawn the way it was. One per component, always present. */
export type RoutingDecision = {
  componentId: string;
  /** what the policy or the host asked for, null when nothing was asked */
  requested: GeometryFamily | null;
  used: GeometryFamily;
  reason: string;
  /** set when `used` is not what was requested: the V2 compiler is always the safe return path */
  fallback: { from: GeometryFamily; code: string } | null;
  /** the plan's own provenance for this component's geometry, copied, never promoted */
  planGeometryOrigin: ValueOrigin;
  /** `derived_from_plan`: the shape comes from the plan's parameters. `external_asset`: the shape comes from a mesh the plan does not contain. */
  representation: 'derived_from_plan' | 'external_asset';
  assetId: string | null;
  triangles: number;
  /** continuous surface only: how far the surface strays from the plan's own shape (see `Deviation`) */
  deviation?: { freeMax: number; blendMax: number; cell: number };
  /** continuous surface only: the components this one flares into (the fillet is drawn by this side only) */
  blendedWith?: string[];
  /** where a continuous surface came from */
  computed?: 'cache' | 'computed';
  /** true while an off-main-thread computation is still running and the component is drawn by V2 meanwhile */
  pending?: boolean;
};

export type AssetLicense = { spdx: string | 'unknown'; attribution: string | null; sourceUrl: string | null; verified: boolean };
export type AssetSource =
  | { kind: 'provider'; providerId: string; requestId: string; costUsd: number }
  | { kind: 'user_upload' }
  | { kind: 'licensed_library'; library: string };

/** A mesh offered for some components. It is only a proposal: it draws nothing until it is approved. */
export type AssetProposal = {
  id: string;
  sha256: string;
  source: AssetSource;
  license: AssetLicense;
  /** assignment of GLB nodes to plan components, with how it was decided */
  mapping: Array<{ componentId: string; nodePaths: string[]; method: 'node_name' | 'bounding_overlap' | 'manual'; confidence: number }>;
  stats: { triangles: number; nodes: number; materials: number; textures: number; textureBytes: number; bytes: number };
  status: 'proposed';
};

/** A person accepted a proposal for these components. Without it the mesh is never drawn. The reviewer identity is not authenticated. */
export type AssetApproval = { proposalId: string; componentIds: string[]; decidedBy: 'human_review'; reviewerAuthenticated: false; at: string };

export type RouterReport = {
  /** the plan's source hash and kind, copied from the plan: the new path must keep pointing at the same source */
  planSource: { kind: 'text' | 'image'; sha256: string };
  decisions: RoutingDecision[];
  proposalsNotApproved: string[];
  /** components waiting for the worker (drawn by V2 until it finishes) */
  pending: string[];
  service: { hits: number; misses: number; queued: number; running: number; cacheEntries: number; cacheBytes: number; completed: number; failed: number; timeouts: number; cancelled: number; evicted: number; rejected: number; workersCreated: number } | null;
  limits: RouterLimits;
  totals: { triangles: number; meshes: number; geometryBytes: number; ms: number };
  perFamily: Record<GeometryFamily, { components: number; triangles: number; ms: number }>;
  fallbacks: number;
};

// ---------------------------------------------------------------------------------------------------- optional external providers
/** Server side only. Nothing in the frontend bundle may import a provider implementation or hold a key. */
export type ProviderRequest = { kind: 'image_to_3d'; imageSha256: string; imageBytes: Uint8Array; mimeType: string } | { kind: 'text_to_3d'; prompt: string };
export type ProviderContext = {
  budget: { approvedUsd: number; spentUsd: number };
  /** present only if a person authorised sending THIS image (by hash) to THIS provider */
  consent: { imageSha256: string; providerId: string; grantedBy: 'user'; at: string } | null;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
};
export type ProviderResult = { glb: Uint8Array; requestId: string; costUsd: number; latencyMs: number; license: AssetLicense };
export interface GeometryProvider {
  readonly id: string;
  /** upper bound in USD, used by the budget gate BEFORE any call */
  estimateCostUsd(request: ProviderRequest): number;
  generate(request: ProviderRequest, context: ProviderContext): Promise<ProviderResult>;
}
export type ProviderRefusal = 'NO_BUDGET' | 'OVER_BUDGET' | 'NO_CONSENT' | 'CONSENT_FOR_OTHER_IMAGE' | 'PROVIDER_NOT_CONFIGURED';

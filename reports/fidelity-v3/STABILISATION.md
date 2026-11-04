# Fidelity V3 — stabilisation results

Everything below was measured in Chromium (system build) + SwiftShader at 1440×900, with a real module Web Worker. CPU times belong to this machine; software rendering dominates anything that touches the GPU path. Raw data: `cycle-result.json`, `metrics.json`, `glb-memory.json`, `capture-result.json`. Scripts: `scripts/visual/fidelity-cycle.mjs`, `scripts/benchmark/fidelity-metrics.ts`, `scripts/benchmark/fidelity-glb-memory.mjs`.

Provenance: lungs and microscope are **hand-authored reproductions** of structures recorded in `reports/acceptance` (not Meta output). Excavator and harp are **real plans saved from Meta calls**, produced by the old repair step; several of their components are generic placeholder shapes (cubes, cylinders). The camera is a CC0 artist asset, not generated.

## 1. Execution cycle in a real browser (19/19 checks, 3 consecutive runs)

| # | Requirement | Result |
|---|---|---|
| 1 | V2 on screen while V3 is computed in a Worker | The very first frame has every component on V2 with all V3 jobs pending. V3 arrives 36–46 ms later on the lungs (2 workers, 7 jobs). |
| 2 | Update without recreating anything | Same component groups, same canvas, plan object and JSON unchanged, selection kept (layer and workspace), exploded view and group offsets unchanged. Swaps touch only the meshes inside existing groups (`PlanSpaceLayer.upgradeGeometry`, new `PresentationDirector.refreshComponents`: no `rebind`, so no Cinema reset). Dimming and PBR finish are re-applied to the new meshes. |
| 3 | Edit/undo invalidate only what is needed | Keys are content hashes of a part and the *relative* placement of its partners. Moving a parent together with its child recomputes nothing. Moving one lung: 5 of 7 jobs recomputed (3 geometries actually changed; the other 2 had a changed key but identical vertices). Undo: 0 jobs, exact geometry restored from cache. |
| 4 | Old results never replace newer plans | 5 plan versions in flight: what is drawn equals a fresh synchronous compile of the current plan, vertex for vertex; 8 stale jobs cancelled. A compile can only consume results for its own keys, and `retire()` ends that right. |
| 5 | Cancel / timeout / Space change / dispose | Timeout 1 ms: 9/9 jobs killed, remembered as `TIMEOUT`, components stay on V2, 9/9 workers terminated, Space still selectable. 5 Space changes with jobs running: 8/8 workers terminated, disposed services empty, no write after dispose, GPU geometries do not grow. |
| 6 | Worker == inline | 7/7 components bit-identical (hash of the vertex bits). |

Known cost: during an edit, components whose job key changed are drawn by V2 until the new result arrives (5 of 7 lung components flashed back to V2). Keeping the previous V3 surface visible would show geometry of an older plan version, so it was not done.

Arrival is spread over frames (60 000 triangles per call, then the next frame) so one frame does not carry the whole GPU upload.

## 2. Responsiveness (main-thread build of the Space)

| Plan | V2 | V3 synchronous | V3 with Worker (first frame) | V3 complete (wall) | largest single swap | triangles V2 → V3 |
|---|---|---|---|---|---|---|
| Lungs (repro) | 29 ms | 1,469 ms | **25 ms** | 7.1 s | 18 ms | 9,792 → 48,822 |
| Microscope (repro) | 37 ms | 572 ms | **95 ms** | 6.5 s | 47 ms | 3,132 → 78,493 |
| Excavator (Meta, old repair) | 34 ms | 1,669 ms | **52 ms** | 7.4 s | 61 ms | 5,148 → 251,822 |
| Harp (Meta, old repair) | 24 ms | 601 ms | **24 ms** | 7.0 s | 20 ms | 2,372 → 131,704 |

"V3 complete" is wall time of the whole page cycle in this software environment (includes load and shader compile); it is not the compute time. Honest limits: V3 draws 5–50× more triangles than V2 (geometry 233 KB → 1.4 MB lungs, 467 KB → 6.9 MB excavator; the service cache holds the same bytes, bounded at 64 MB). Frame-gap measurements under SwiftShader were dominated by one-off program compilation in every route including V2, so they are not reported as evidence; the excavator V3 shows one 0.5 s long task after the first frame (first render of 250k triangles on a CPU rasteriser).

## 3. Junctions, artefacts and silhouette (from the meshes, no lighting)

Same plan, three variants: V2, V3 *earlier* (whole-triangle rim, kept only as a measurement baseline, `rim: 'discard'`), V3 final (sub-triangle clipping).

- **Serration of the skirt rim** (mean / p90 turning angle along the open boundary; 0 = straight): earlier 36–107° / 98–143°; final 4–11° / 9–24°. About ten times smoother. The serrated halo is visible in `zoom-lungs-like-v3-earlier-rim.png` and gone in `zoom-lungs-like-v3.png`.
- **Pearl-string highlights** along under-resolved edges (microscope revolver): found in the 2× crops, fixed by sampling normals one cell wide (job version 4).
- **Junction tangency** (angle between drawn normal and partner surface normal near the joint, median): V2 45–74° where measurable (lung/carina 74°, arm/column 45°, focus/column 73°, harp strings 34°); V3 final 14–20° on the same pairs. Clipping did not change this versus the earlier rim (15–20°): the improvement is V3 versus V2. Some pairs stay far from tangent (microscope revolver/arm p90 86°, excavator tracks ~17°): box-to-box joints with a fillet limited to 0.8 × the thinner feature.
- **Silhouette preserved?** Nothing is removed: V2 area missing from V3 is 0.2–0.5 % (harp side view 2.3 %). V3 *adds* fillet material at joints: up to 4.8–5.3 % of V2's silhouette area (microscope, excavator, harp), by design at most 20 % of the thinner part's feature. Free surfaces stay within 0.02–0.48 % of the object span of the plan's own shape; blend zones within 0.6–4.3 %. Silhouette IoU against V2: lungs 0.995, microscope 0.95/1.00/0.95, excavator 0.96–0.97, harp 0.95–0.97.
- Sliver triangles: V2 11–27 % on three of four plans (thin box faces), V3 0.05–0.7 %.

## 4. GLB decode memory (AntiqueCamera, 17.5 MB file, 6 × 2048² textures)

Fresh Chromium per run, resident set of renderer + GPU + browser sampled every 4 ms, median of 3 runs (the GPU process is software here, so absolute numbers are inflated compared to a real GPU).

| Strategy | Peak above baseline | Decode time |
|---|---|---|
| header validation only | 0 MB | 1 ms |
| full size, no reduction | 242 MB | 217 ms |
| decode full, then reduce to 1024 (previous behaviour) | 249 MB | 215 ms |
| all images asked at 1024 | 255 MB | 289 ms |
| **one image at a time, asked at 1024 (new default)** | **170 MB (−32 %)** | 514 ms |

Findings: the previous downscale lowered the memory *kept* (134 MB → 32 MB of decoded textures) but **not the peak**, which is set by decoding; the JS heap does not see it at all (0 MB), and the validator's budget (judged after reduction) understated the real peak several times. Asking the browser for a reduced size does not help for these PNGs (no scaled decoding); decoding sequentially does. The cost is 2.4× decode time, once. Peak still scales with the largest single image; the hard cap of 4096 px per side is kept.

## 5. Real Meta plans

Excavator and harp go through the same cycle without errors and with all components selectable. **V3 does not rescue them**: the plans contain generic placeholder shapes, so V3 produces smooth cubes and, where thin parts touch (harp strings and pegs), dark blobs. No visible improvement; the limit is the plan's parameters, not the surface. A guard that skips fillets for placeholder-like plans is not implemented. See `board-real-meta-plans.png`.

## 6. Not done

No new providers or operators. No provider was run. No GPU measurements. The adaptive-detailing proposal is in `ADAPTIVE-DETAILING.md` (a proposal, not an implementation).

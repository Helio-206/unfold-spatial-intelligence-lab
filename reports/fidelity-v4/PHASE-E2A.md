# Phase E2-A — isolated research checkpoint (incomplete)

Branch `feat/v4-e2a-parametric-geometry`, base `2ce3e4029d61de4399f6199034e2441f2283e892`. The report is committed with the implementation; use `git rev-parse HEAD` to identify the exact checkout. This is an isolated research checkpoint, not an integration or an approval to activate V4.

## Reproduced Phase D limitation

Run `npx tsx scripts/benchmark/v4-e2a.ts`. The stored Meta excavator plan is analysed without its source photo or ground truth. Seven relations were classified as contradicted. The heuristic search reported remaining distances as a percentage of scene span: boom 6.21%, stick 25.90%, bucket 35.34%; four other relations had residuals of 0.03–0.07%. Search is bounded (scale 0.6–1.7, rotation 0.6 rad, shift 15% of span) and heuristic; this is neither proof of mathematical impossibility nor proof that a declared relationship is true. Full results: `e2a-diagnosis.json`.

## Prototype and assumptions

Existing V2 `loft` represents a straight beam along local Z with up to 32 ordered rectangular sections and independently varying width and height. Existing `extrude` represents a concave U-shaped open trough; it is not a closed bucket and does not generate end plates, teeth or a pivot. No shared geometry contract was changed. Stable supplied component and geometry IDs are retained. Candidate `set-geometry` operations are validated against a copy of the complete V2 plan and have inferred provenance; the original plan is not modified and no automatic apply occurs. The caller supplies geometry and evidence; arbitrary dimensions are not extracted from the image. Geometry is expressed in plan units, which can be unitless. No dimensions are asserted to be physical.

The joint diagnostic composes rigid parent-relative translation and Euler rotation (Three.js XYZ), with unit scale, then reports distances between explicitly supplied local anchor points. It detects missing/cyclic parents and invalid/duplicate joint IDs; it does not solve joints, establish hinge axes, enforce attachment, test physical plausibility, reject an excessive residual or repair a chain. Rigid scale and constraints are deliberately not inferred from images. Existing plan hierarchy may contain non-unit scales, which this isolated diagnostic does not model: do not use it as proof of closure for those plans.

## Measurements and tests

`npx tsx scripts/benchmark/v4-e2a.ts` runs the diagnosis and compares the entire stored plan with an **arbitrary synthetic** replacement for the boom; it is not fitted to evidence. One local run: 17 meshes / 14,884 vertices / 5,148 triangles before; 17 / 13,996 / 4,868 after. 1,519 ms wall time includes the expensive existing diagnosis and both full-plan compilations; heap in use at the final sample was 33,140,856 bytes, not a peak or isolated allocation measurement. Counts and timing are descriptive, not performance or fidelity claims. Results vary by machine.

Five dedicated tests cover deterministic output, existing V2 proposal validation and provenance, generated trough, invalid sections, parent-relative closure and perturbation, invalid hierarchy. Three relevant test files passed 23 tests. The full suite passed 154 files / 2,487 tests (`npm test -- --testTimeout=60000`). `npm run build` passed with existing missing contact-variable and bundle-size warnings. See the final handoff for any later whole-suite results.

## Missing acceptance evidence and integration requirements

- No before/after screenshots or independent visual inspection were completed. There is no recognisable reconstructed excavator assembly demonstrated.
- There is no fitting algorithm, held-out-view IoU, shape reconstruction error, independent licensed reference comparison, joint-axis validation, collision/strength analysis or real-photo ground truth. The synthetic joint test measures residual 0 and then 0.25 plan units after perturbation, not a solved chain. Memory is not peak memory; no repeated runtime distribution was measured.
- The shell is open-ended and cannot yet represent the complete bucket. Loft sections only scale one profile; a curved or offset beam requires a compatible new operator or multi-piece proposal, neither implemented here.
- Proposal operations do not carry revision or source-hash preconditions. E1 must bind the source bytes/hash, selected IDs and current revision, present the inferred hypotheses and explicit human decision, and invalidate on changes. E0 must validate and atomically commit the reviewed operation batch and preserve exact undo. Do not route this prototype into the workspace until those interfaces are agreed and tested.
- No E1 implementation, UI, renderer, backend, default `/living` flow or shared contracts was changed; no paid inference was performed.

**NO-GO for integration after E1 as a reconstruction engine.** The code is a small isolated prototype, not completion of the requested research. Next: implement and verify closed bucket/end plates and hinge frames, generate a complete three-body assembly with explicit rigid joints, evaluate independent synthetic and licensed ground truth views, capture and inspect before/after images, then define the E1/E0 revision and evidence binding. Do not claim mechanical or photographic accuracy without supporting evidence.

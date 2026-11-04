# Universal Spatial Presentation Director — results

Base: PR #25 `2cea25f39cb2d8db4de07d1385c48875d01a93d8`. This branch: PR #26 (draft, nothing merged). No Meta call was made: there is no key in this environment and tests may not spend. API: `src/living/spatial-presentation/API.md`.

## What was audited, and what already existed (Mission A)

| Area | Reusable for any object | Excavator-specific (not reused) |
|---|---|---|
| `visual-foundry/materials.ts` | procedural micro-surface generators (`finishPixels`, `finishTexture` (now exported), `variationPixels`, seeded `rng`): **reused** by the finish | the 12 material keys and presets |
| `visual-foundry/geometry.ts` | chaikin, hulls, extrude/lathe/pipe helpers | `excavator/*`, component registry, poses, accent zones |
| `cinema/studio-environment.ts`, `contact-shadow.ts` | PMREM studio, contact shadow: already used by the workspace's premium look | – |
| `cinema/choreography.ts` | `CameraPose` convention and orbital blend | shots authored for a machine's bounds |
| `workspace-design/camera-arbiter.ts`, `camera-director.ts`, `framing.ts` | arbiter, safe view offset, `fitBoxDistance`: **reused** by the cues (cues never move the camera) | – |
| `motion/tokens.ts` | durations and curves | – |
| `spatial-space/layer.ts` (#25) | selection, inspector, edits, solver | – |
| `universal-spatial/` (#22–#24) | compiler, solver, repair, framing | – |

Not reimplemented: renderer, lights, shadows, camera, picking, inspector. The Director is the missing layer between a validated plan and those.

## What was built

- **`spatial-presentation/` (Mission B)**: structure (assembly order grown from the grounded base through contact and hierarchy, points of interest, generic exploded offsets), cues (workspace `setView` shape, solved with the workspace's `fitBoxDistance` at a reference size so any scale works), PBR finish, and the runtime. Entrance, focus, reversible exploded view, point-of-interest tour, editing handover, rebind, reduced motion (live), exact restore, idempotent dispose. No clock, renderer, camera or loop inside.
- **Geometry (Mission C)**: box edges softened (7% of the thinnest side, outer size unchanged); lofts get UVs; a `buried` finding (a part no direction can see, by ray casts on the compiled triangles, no false positives on hollow shells in the engine and bicycle fixtures) and `revealBuriedComponents` (typed `set-transform`, never moves observed/confirmed positions). Earlier in this line of work: field-level parameter repair, gap solver, scale-free framing (#24).
- **Materials (Mission D)**: per-profile finish reusing the Foundry generators (brushed metal, paint, rubber) plus a new directional grain for organic. Restrained: roughness/bump/tone variation only, no bloom, no extra reflections.
- **Contract (Mission E)**: published as the first commit, unchanged since; "API needs from the workspace" lists what the Terminal must expose.

## Evidence (Mission F), all in the real SpatialWorkspace (Chromium + SwiftShader, 1440×900)

`board-comparison.png`, `board-sequence.png`, `demo-clock-like.webm`, per-step PNGs, `capture-result.json` (cues, sequences, points of interest, GPU counts, errors). Reproduce: `scripts/visual/presentation-capture.mjs`, `-record.mjs`, `-board.mjs`.

| Input | Provenance |
|---|---|
| Foundry excavator | procedural geometry of the Foundry (premium look), the reference |
| Pendulum clock, real Meta run | **real Meta output**, but only its screenshots survive (`reports/space-integration/runs/real-meta/`); the plan was not kept |
| Pendulum clock used here | **manual fixture** reproducing that run's component list, operators (rounded_box, sphere, cylinder, tube) and visible faults (floating feet); procedural primitives, `design_approximation`; **not Meta output** |
| Bicycle, aircraft engine | **manual fixtures** (from #24), procedural, `design_approximation`; no code written for them |
| External 3D assets | **none**; no licence, attribution or provenance question arises |
| Meta calls | 0 |

Measured:

| Check | Result |
|---|---|
| Excavator regression | screenshot of the Foundry excavator in the same workspace is **byte-identical** on #25 and on this branch (sha256 equal) |
| Console errors | none, in all runs and in the phone-sized run |
| Director CPU | 0.0001 ms per `update` when idle (no render request); 0.14 ms per frame while animating 8 components |
| GPU | no geometry created; Foundry texture count returns to its no-Director level after `dispose` (clock 10 to 8, bicycle 12 to 7, engine 11 to 8) |
| Reduced motion | the whole entrance completes in one step, every cue `durationMs: 0` |
| Phone (390×844 @2x) | entrance, portrait framing and exploded view work |
| Tests | 48 new Director tests; full suite and build below |

## Honest reading of the images

- **Pendulum clock**: clearly better than #25 where the layer acts: wood grain and rounded edges instead of flat orange boxes, and a sequence that builds the object part by part from structure, an exploded view, a focus and a tour. Its **geometry is still primitive** (flat dial disc, thin rod, spheres for feet) and the feet still float, because this layer does not invent shape. Next to the Foundry excavator it is still far from premium.
- **Bicycle and engine**: almost the same as in #25 at rest. The finish is barely visible on metal, rubber and paint at this scale. What they gain is the sequence, explode, focus and tour.
- The Foundry look comes from authored geometry (profiles, tubes, hierarchy, detail), not from lighting. A generic layer can raise materials, edges, framing and motion; it cannot raise a plan whose shapes are crude.

## Limits that remain

- No live Meta run, so nothing here says how a new real plan would look. The clock is a reproduction; the real plan's geometry was not recoverable.
- The workspace's camera director and insets are private, so the reference host animates cues with `setView` (bypassing the arbiter) and reads insets through a cast. The Terminal must add the four items in `API.md`. The Director is **not integrated** into `/living` by design.
- The exploded view is generic (away from the parent): it can look arbitrary for objects whose parts do not separate radially. It is labelled as a visualisation.
- Assembly order is a presentation order grown from contact and hierarchy; for a plan with floating parts it puts them last ("nearest remaining").
- The `buried` check and gap solver are bounding-box or ray-sampling approximations: not contact, collision or structural checks.
- Headless software rendering only (SwiftShader): the recording runs at about 3 frames per second of screencast (resampled to 10 fps), far below a GPU; no real mobile device or hardware GPU was tested.
- No hybrid procedural + 3D asset path was built: it needs a new node type (contract change), licence and attribution fields and scale calibration, and no asset with a verifiable licence was at hand to demonstrate a gain.
- Reference-host chrome (buttons, notice placement) overlaps the workspace's composer on small screens; that is the test host, not the module.

## GO / NO-GO

- **Technical, as a draft module: GO** for integration by the Terminal: contract published first and unchanged, 48 tests, no regression on the excavator (byte-identical), idle cost zero, exact restore, cancel and dispose verified, reduced motion honoured, no GPU leak observed.
- **Visual, as "Foundry-level quality for any object": NO-GO.** The presentation layer measurably improves materials, edges and the experience, but quality still depends on the plan the model returns. The clock remains a primitive assembly, and the layer deliberately does not hide that.

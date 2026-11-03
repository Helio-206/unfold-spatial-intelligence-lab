# Cinematic stage: evidence

Branch `feat/living-cinematic-runtime`, from main `ff16954` (after PR #10). Module and usage: [`src/living/cinema/README.md`](../../src/living/cinema/README.md). Route: `/cinema`.

Everything here comes from the real page in Chrome with **SwiftShader (a software rasteriser, not a GPU)**: `ANGLE (Vulkan, SwiftShader)`, `MAX_TEXTURE_SIZE` 8192. Stills are rendered synchronously with a frozen grain seed so the same state gives the same pixels. The machine is the **synthetic excavator assembly in its reference pose, drawn with a proxy of the contract's own box/cylinder shapes**; detailed geometry belongs to the Visual Foundry and is not rebuilt here.

## Golden Frame

| file | size | note |
|---|---|---|
| [`golden-frame-1080p.png`](golden-frame-1080p.png) | 1920 x 1080 | tier `studio`, hero shot at 3.2 s |
| [`golden-frame-4k.png`](golden-frame-4k.png) | 3840 x 2160 | native 3840 x 2160 drawing buffer (1920 x 1080 viewport at device pixel ratio 2), not upscaled |
| [`ui-desktop.png`](ui-desktop.png) · [`ui-mobile.png`](ui-mobile.png) · [`e2e/presentation-fullscreen.png`](e2e/presentation-fullscreen.png) | | interface with the UNFOLD tokens/components; mobile 390 px; presentation mode |

What is in the frame: HDR soft-box studio baked to a PMREM (reflections on lacquer, chrome and brushed steel), a shadow-mapped key with a cool rim, a glossy floor with a mirrored machine, a contact shadow under the hanging bucket, 4x MSAA half-float, ambient occlusion, bloom, grade, ACES tone mapping.

## What each part of the pipeline contributes (same frame, one switch at a time)

[`sheets/ablation.png`](sheets/ablation.png): full pipeline, no studio environment, no contact shadow, no post-processing, no mirrored floor, and "plain" (all off). Measured on the same canvas pixels by the browser E2E:

| measurement | with | without | |
|---|---|---|---|
| contact shadow: mean luminance of the floor under the bucket | 74 % of the value without it | | darker by about 26 % (assertion: at least 8 %) |
| polished chrome rod, studio environment: highlight (99th percentile luminance) | 243 | 69 | 3.5x |
| same rod, contrast (standard deviation of luminance) | 55 | 28 | 2x |
| brushed-steel bucket, mean luminance | 77 | 37 | 2.1x |

## Camera choreography

[`sheets/shots.png`](sheets/shots.png): hero, profile, bucket (framed on the assembly's `tool_tip`), reach, top, orbit. Shots are authored relative to the machine bounds and sampled by pure functions of time. Measured:

- the same shot at the same instant gives the identical camera and the identical image (checked by pixel hash);
- no step between 1/60 s samples larger than 3 % of the machine radius in any shot (unit test); transitions start on the previous pose, end exactly on the shot and stay outside 1.2 radii of the machine;
- grabbing the camera hands control to the user; zoom is bounded; the camera never goes under the floor;
- with `prefers-reduced-motion` a cut jumps to the framing and nothing animates.

## Quality tiers and cost (software rendering)

[`sheets/tiers.png`](sheets/tiers.png), same frame. Time per 1920 x 1080 frame, with a GPU sync after each: studio 5.6 s, balanced 2.8 s, light 0.85 s (draw calls 93 / 52 / 17, triangles about 47 k / 24 k / 10 k, summed over all passes). **These numbers are for a CPU rasteriser and say nothing about a GPU**; they exist to show the relative price of each stage and that the lower tiers are cheaper. The default tier is chosen from the device (software or small textures: `light`); `?tier=` overrides.

Adaptive step-down (E2E, 640 x 360 viewport on the studio tier): ambient occlusion goes off after 34 s of continuous frames, bloom/smaller shadows/DPR 1 after 57 s, the UI says so, it never steps back up, and after the camera stops there is no render loop. Idle, no frames are drawn at all.

Lifecycle: 20 tier switches leave geometries (17), textures (5), shader programs (17) and lights (3) unchanged.

## Motion-frame playback

`MotionFramePlayer` validates every `unfold.motion-frame.v1` frame (one invalid frame rejects the sequence), blends only between two `ok` frames and says so, and never blends across a frame that is not `ok`: `blocked` is shown with its `poseBasis`, message and warnings. E2E, with three valid *transport test* frames that repeat the reference pose (not engine output): status and base are shown, the blocked message is surfaced, and the image is pixel-identical to the reference pose. Real engine frames plug in with `runtime.setPoseSource(new MotionFramePlayer(frames))`.

## Review fixes (PR #14, review 5743361419)

- A sample without poses (`invalid_assembly`, `poseBasis: none`) hides the machine, its mirrored copy and its contact shadow together; the next sample with poses restores them (browser: no orange pixels while hidden, image identical to the reference pose after).
- Frame captions are owned by the frame: a blocked/warning message is cleared when the next frame has none, and a clean frame never erases an unrelated notification (`CaptionState`).
- `MotionFramePlayer` refuses sequences that do not belong together: different `assemblyDigest`, different `worldFrameId`, an assembly other than the one on stage, part ids the assembly does not have, frames that miss parts. `setPoseSource` refuses a source for another assembly.
- Pose time is a separate monotonic clock (`PoseClock`) driven by real elapsed time; the 100 ms cap only smooths camera and render motion. Browser: a 4 s sequence on slow software frames reaches 2.4 s or more after 3 s of wall time and ends on time.
- A blended sample carries no measurements and no input digest (nothing the engine computed at that instant); it records `derivedFrom` (the two input digests and the weight). Warnings of the two bounding frames are kept.

Each was written as a failing unit test first (missing module / wrong behaviour), then fixed; the browser scenario 9 covers the same behaviours end to end.

## Integration: Visual Foundry + engine frames ([`integration/`](integration/))

- [`integration/hero-engine-t0-1080p.png`](integration/hero-engine-t0-1080p.png), [`hero-engine-end-1080p.png`](integration/hero-engine-end-1080p.png): 1920 x 1080, studio tier, the Foundry excavator driven by the live engineering session at the start and at the end of the scenario.
- [`integration/engine-sequence-sheet.png`](integration/engine-sequence-sheet.png): the exported scenario at the exact instants of its frames (9 distinct instants of the 13 `ok` frames) and its 2 blocked examples. [`evidence.json`](integration/evidence.json) lists, per frame, the input digest, origin (`engine`), status and the largest distance between the pose on stage and the pose in the frame (0 for `ok` frames, 2.4e-15 m for the blocked ones: floating-point rounding).
- Model on stage: 64 meshes, 253 744 triangles, 13 canonical parts, the Foundry's own materials.
- Browser E2E scenario 10 (32 checks) on this path: play / pause / resume / scrub with every part within 1e-9 m of the engine frame; 41 samples of the bucket with no jump above 0.25 m and 0.5 m or more of travel; hoses re-routed through the playback and through blended poses; the 15-frame sequence with blending labelled and measurement-free; both blocked frames with the engine's reason and `reference` pose basis; sequences with another digest, world frame, assembly or part set refused; click-to-inspect by canonical id; 24 source switches with no growth of geometries, textures or lights; dispose releases geometries and textures to 0 and removes the canvas.
- 1080p studio frame cost in software: about 10.6 s mean (3 frames, SwiftShader). It is a CPU rasteriser; this says nothing about a GPU.

## Responsive layout (review of 30a9cfe)

At widths from 768 to about 1480 px the technical readout (left column, 340 px) and the centred motion bar (up to 720 px) shared the same bottom edge and overlapped; the readout, drawn later, intercepted the select, slider and play button. At 390 px the caption sat on the motion bar and intercepted the slider. Fix (CSS only): between 761 and 1480 px the readout stacks directly above the motion bar and scrolls inside its box on short windows; the caption no longer takes pointer events. Browser scenario 11 measures bounding rectangles and uses real pointer interactions at 768, 800, 1024, 1080, 1280, 1440, 1600 and 390 px (74 checks); before the fix it failed 10 of them on the previous HEAD. Limitation: in the stacked layout the readout covers the left part of the picture at 1024 px; "Esconder interface" (H) clears it.

## First pose (review of 5501a2e)

The runtime constructor applied the first sample straight onto the part objects, bypassing the provider's `applyPose`; with the Visual Foundry the hoses stayed on the reference routing whenever the first source was not the reference pose, and a pose-less first frame left the machine visible. The first pose now goes through the same `showPose` path as every later one (provider ownership, pose-less hiding, stage refresh) and only then are bounds and framing computed; `onSample` is still announced once. Browser scenario 12 (16 checks): with an articulated static frame as the first source the hose routing at boot was 59.59 before the fix (the reference's) against 49.60 after re-applying the same sample, and 49.60 = 49.60 after the fix; a pose-less first frame left the machine, root and contact shadow visible before the fix, hidden after; the first pose is applied exactly once; reference and proxy first poses unchanged.

## Tests

- `npx vitest run --testTimeout=15000`: 1677 passed (88 files; 36 in `tests/living/cinema.test.ts`, 25 in `tests/living/cinema-integration.test.ts`). `npm run build`: ok.
- Browser E2E `tests/e2e/cinema.pw.mjs`: 189/189 ([`e2e/results.json`](e2e/results.json)): load and proxy labelling, six shots, determinism, keyboard, tour and hand-over, ablation measurements, 20 tier switches, motion-frame playback and blocked state, full screen / hidden interface, 44 px targets, visible focus, 390 px layout, reduced motion, benchmark per tier, adaptive step-down, idle, no console errors, no request outside localhost.
- Regressions, unchanged: `wall-removal-merge` 189/189, `confirmed-values-authorization` 60/60, `rendering-integration` 63/63.

## Limits

- No GPU measurements. Frame times, tier defaults and the cost of the GPU probe need a run on real hardware.
- Proxy geometry only; no part detail, no normal maps, no real tracks or cab. Replace it by implementing `MachineVisualProvider` over the Visual Foundry output.
- Engine frames are not available yet; playback is exercised with transport test frames only.
- Full screen depends on the browser permitting it; if it does not, the interface is hidden and the page says so.
- `golden-frame-4k.png` is 13 MB (lossless).

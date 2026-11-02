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

## Tests

- `npm test`: 1365 passed (19 new in `tests/living/cinema.test.ts`). `npm run build`: ok.
- Browser E2E `tests/e2e/cinema.pw.mjs`: 55/55 ([`e2e/results.json`](e2e/results.json)): load and proxy labelling, six shots, determinism, keyboard, tour and hand-over, ablation measurements, 20 tier switches, motion-frame playback and blocked state, full screen / hidden interface, 44 px targets, visible focus, 390 px layout, reduced motion, benchmark per tier, adaptive step-down, idle, no console errors, no request outside localhost.
- Regressions, unchanged: `wall-removal-merge` 101/101, `confirmed-values-authorization` 60/60, `rendering-integration` 63/63.

## Limits

- No GPU measurements. Frame times, tier defaults and the cost of the GPU probe need a run on real hardware.
- Proxy geometry only; no part detail, no normal maps, no real tracks or cab. Replace it by implementing `MachineVisualProvider` over the Visual Foundry output.
- Engine frames are not available yet; playback is exercised with transport test frames only.
- Full screen depends on the browser permitting it; if it does not, the interface is hidden and the page says so.
- `golden-frame-4k.png` is 13 MB (lossless).

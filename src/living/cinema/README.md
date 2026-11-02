# Cinematic runtime (`src/living/cinema/`, route `/cinema`)

A studio stage, a camera director, a post chain and an on-demand render loop around one articulated machine. It owns **presentation only**: it never
edits an assembly, a pose or an engineering value, and what a frame says (`status`, `poseBasis`, warnings, blocked info) is shown, never repaired.

Ownership: the detailed excavator geometry, the workspace UI and the Digital Hand belong to Claude Code Design (`src/living/visual-foundry/` and the
workspace). This module owns the stage, cameras, post-processing, interaction, presentation controls and the simulation-frame integration.

## Files

| file | what it does |
|---|---|
| `visual-provider.ts` | The seam to whoever owns the geometry: `MachineVisualProvider.load(assembly)` returns one Object3D per part id. `proxyVisualProvider` draws the assembly's own `shapes` (bevelled boxes, cylinders) as a stand-in and tags every mesh `proxy`. `applyPose` writes a pose sample onto the parts and reports unknown part ids instead of inventing them. |
| `pose-source.ts` | `PoseSource`: `ReferencePoseSource` (the synthetic reference pose) and `MotionFramePlayer` (validated `unfold.motion-frame.v1`, see below). |
| `studio-environment.ts` | Procedural photo studio baked to a PMREM: HDR soft boxes (radiance 3 to 20), strip lights, rim, bounce. No image file. |
| `studio-materials.ts` | Clear-coated paint (fold accent from the design tokens), graphite, polished chrome rods, anisotropic brushed steel. |
| `studio-stage.ts` | Backdrop, glossy floor with a mirrored copy of the machine, key (shadow) / rim / fill lights, contact shadow, environment. |
| `contact-shadow.ts` | Depth of the machine layer seen from under the floor, blurred twice; redrawn only when the pose changes. |
| `post.ts` | 4x MSAA half-float target, GTAO, bloom, grade (contrast, vignette, grain), tone mapping + sRGB in the last pass. Each effect switches off without rebuilding the chain. |
| `choreography.ts` | Six shots authored relative to the machine bounds, sampled by pure functions of time; orbital transitions that never cut through the machine; `CameraDirector` advances only through `advance(dt)` (no clock inside). |
| `quality.ts` | Tiers `studio` / `balanced` / `light`, device-aware default (never raised automatically), fixed step-down order. |
| `cinema-runtime.ts` | Ties it together. On-demand loop (idle = no frames), adaptive step-down using the shared `FrameMonitor`/`FrameClock` of `src/rendering` (GPU probe on every other frame, exactly one follow-up frame after a step), resize, disposal. |
| `cinema-page.ts`, `cinema.css` | `/cinema`: UNFOLD tokens and components, dark viewport, shot rail, readout, full-screen and hidden-interface presentation mode. |
| `test-frames.ts` | Debug only (`?debug-cinema`): three valid motion frames that repeat the reference pose, to test the playback path. They are not engine output. |

## Where the machine's pose comes from

- Today: `ReferencePoseSource`, the reference configuration of `unfold.assembly.v1`'s synthetic excavator (`contracts/fixtures/excavator.reference-pose.json`, computed by an independent script).
- When the engine delivers frames: `runtime.setPoseSource(new MotionFramePlayer(frames))`. Every frame goes through `validateMotionFrame`; one invalid frame rejects the whole sequence (no partial playback). Two consecutive `ok` frames are blended (position lerp, rotation slerp) and the sample says `interpolated: true`; a frame that is not `ok` is shown as produced, with its `poseBasis` (`held_last_valid`, `reference`, `none`), `blocked` info and warnings, and never blended into its neighbours.
- The cinema does not resolve engineering relations (stroke to angle, loop closure, limits): that is the engine's job.

## Camera shots

`hero`, `profile`, `bucket` (framed on the assembly's `tool_tip` point), `reach`, `top`, `orbit` (looping) and a tour. A cut starts with a 1.6 s orbital transition from wherever the camera is. Grabbing the camera hands control to the user (`Livre`). With `prefers-reduced-motion` a cut jumps to the shot's framing and nothing animates.

## Quality and adaptation

`?tier=studio|balanced|light` forces a tier; otherwise the device decides (software renderer or small textures: `light`). Frames that are slow step the tier down (ambient occlusion first, then bloom, smaller shadows and DPR 1), say so in the UI and never step up again on their own.

## Honest limits

- Measured only with a software rasteriser (SwiftShader): about 0.5 s (light), 2 s (balanced) and 4 s (studio) per 1600x900 frame, so interactivity numbers say nothing about a GPU. The pipeline is built so that GPU cost can be read per tier before choosing a default.
- The machine you see today is the proxy of the contract's shapes (boxes and cylinders). Detail, normal maps and real part shapes arrive with the Visual Foundry.

# Spatial Presentation Director — integration contract

Module: `src/living/spatial-presentation/`. Types: `types.ts` (stable). Entry: `index.ts`.
Status of this file: **contract published before the implementation** so the Terminal can integrate in parallel. Names and shapes below do not change without a note on the PR.

```ts
import { createPresentationDirector } from '../spatial-presentation';
const director = createPresentationDirector({ plan, root, requestRender, onCue, onState, view });
```

## Who owns what

| | Workspace / Terminal | Director |
|---|---|---|
| renderer, scene, lights, loop, canvas | yes | never created, never touched |
| camera, `CameraDirector`, `CameraArbiter` | yes | **never moves it**; emits `CameraCue`s |
| plan (`SpatialPlanV2`), review, edits, undo, solver | yes | read-only; never written |
| selection, inspector, rail, notices | yes | never touched (focus is a separate, visual-only state) |
| compiled objects (`root`) | owns and disposes them | animates presentation state on them and restores it |
| presentation-only state (entrance offsets, exploded offsets, dim, PBR finish, edge softening) | – | yes, listed in `state.active`, always reversible |

## Wiring (what the Terminal does)

1. After the layer compiles a plan: `createPresentationDirector({ plan: layer.currentPlan, root: <layer wrapper>, requestRender: () => workspace.redraw(), onCue, onState, view })`.
2. In the workspace frame loop, while `director.update(dtMs)` returns `true`, keep rendering. `dtMs` is real elapsed time of that frame. There are no timers inside the Director.
3. `onCue(cue)`: ask the arbiter, then move. Suggested: `const r = workspace.cameraDirector.moveTo(cueToViewSpec(cue), 'assistant')`. If the arbiter denies (a person is orbiting) **do nothing**; the object keeps animating and the person keeps the camera. Under reduced motion `cue.durationMs === 0`: use `jumpTo`.
4. Entrance: `director.playEntrance()` replaces `layer.reveal(...)`. The returned handle's `cancel()` is safe at any time; `done` always resolves.
5. Selection: the workspace selection is untouched. Use `director.focus(id)` for a presentation spotlight (dims the rest, emits a focus cue); `focus(null)` clears.
6. Exploded view: `director.toggleExploded()` or `setExploded(0..1)`. While `state.notice !== null` the host **must** show it ("Vista explodida · visualização; o objecto não se move assim").
7. Editing: before the inspector applies an edit call `director.enterEditing()` (restores planned transforms and colours exactly, so edits and the solver see the true plan). After the layer rebuilds from the new plan call `director.rebind({ plan, root })`, then `resumeExploring()`.
8. Teardown (leaving the space, replacing the plan): `director.dispose()`. Idempotent. After it no frame callback, listener or texture remains.

`cueToViewSpec(cue)` converts a cue into the workspace's `ViewSpec` (`Vector3` target, radians). The cue's azimuth is already in the workspace director's convention (the mirror of the Cinema's), identical to `SpatialWorkspace.setView`.

## Guarantees (tested)

- Never mutates the plan (deep-equal before/after every operation).
- `cancel()`, `enterEditing()` and `dispose()` restore position, scale, visibility, colour and reflection of every object the Director touched, **bit for bit**.
- Reduced motion (option or `prefers-reduced-motion`, live): sequences complete instantly, cues have `durationMs: 0`, no intermediate frames.
- No GPU leak: textures the Director creates are disposed with it; it creates no geometry, no renderer, no render target.
- Deterministic: same plan and same `dtMs` sequence → same states and cues.
- Idempotent `dispose`, safe `update` after dispose (returns `false`).

## What the Director does not claim

- Motion follows **plan structure only** (hierarchy, spatial relations, contact between boxes, sizes). No joints, kinematics or physics are inferred.
- Assembly order is a presentation order, not a manufacturing or assembly procedure. Each step carries a structural reason.
- The exploded view is a **visualisation**: offsets are generic (away from the parent), reversible and always announced by `state.notice`.
- PBR finishes are a presentation of the declared material profile; they say nothing about the real material.

## Defaults

`entranceMs 5200` (capped per part), `explodeMs 900`, `explodeSpread 0.45`, `dim 0.32`, `maxPois 8`.

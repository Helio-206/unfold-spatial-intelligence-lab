# UNFOLD — Spatial Intelligence Lab

UNFOLD is a multimodal spatial intelligence laboratory built for the **Meta Global AI Developer Hackathon**. It turns technical images — floor plans and mechanism drawings — into validated, editable spatial and mechanical structures that can be inspected and manipulated in 2D and 3D.

This repository is a clean publication snapshot of the final local development version (`unfold-app-phase-9-2`, based on commit `c79c699` plus its uncommitted Phase 9.2 reconstruction work). The original multi-phase development history, private evidence, uploaded images, and live Meta API responses are intentionally not published here and remain only in the local archives.

## Meta Muse Spark integration

- The local backend (`server/`) calls the Meta Responses API at `https://api.meta.ai/v1/responses` using model `muse-spark-1.3`.
- `MODEL_API_KEY` is read only on the server side (see `.env.example`). It is never exposed to the Vite frontend.
- Implemented backend routes include text and image understanding, region verification, kinematics experiments, experiment preview, conversation, and a spatial-agent endpoint (`/api/meta/text`, `/api/meta/image`, `/api/meta/image/verify-region`, `/api/kinematics/experiment`, `/api/experiments/preview`, `/api/conversation`, `/api/spatial-agent`, plus `/api/health` and `/api/diagnostics`).
- Without `MODEL_API_KEY`, Meta-dependent paths report a blocked state instead of making external calls. Deterministic local engines (validation, kinematics solvers, plan reconstruction, scene graph) run fully offline.

## Implemented capabilities

- **Plan reconstruction:** image-to-plan pipeline that detects candidate walls/openings, exposes them as editable vector proposals, and requires human tracing/confirmation before building geometry.
- **Spatial editor and 3D viewer:** Three.js-based 2.5D/3D scene (slab, walls, doors, windows) generated from a validated scene graph — no hard-coded house in the renderer — with focus, isolation, disassembly/reassembly, undo/redo, and save/restore.
- **Spatial agent and commands:** natural-language spatial commands are validated against a command protocol and executed transactionally against the scene graph; the agent does not write directly to the scene.
- **Mechanical / four-bar laboratory:** mechanical graph contract (`unfold.plan.v1` / `mechanical_graph.v1`), deterministic kinematics, kinematic completion and assembly validation, and Blender-authored GLB assets.
- **Multimodal inputs:** image understanding, technical-document extraction with evidence tracking, hand tracking (MediaPipe), and voice input/output modules.
- Accessibility and UX details include reduced-motion support (`prefers-reduced-motion`) and responsive breakpoints.

## Architecture

| Layer | Location | Role |
|---|---|---|
| Frontend | `src/` | Vite + TypeScript UI, Three.js spatial scene/editor, plan reconstruction, kinematics, local deterministic engines |
| Backend | `server/` | Local HTTP server; the only place `MODEL_API_KEY` is used; proxies and validates Meta Muse Spark calls |
| Contracts | `schemas/`, `src/model.ts`, `src/mechanical-graph.ts` | Versioned plan/mechanical-graph schemas and deterministic validation |
| Assets | `public/`, `assets/blender/` | GLB models, MediaPipe wasm/hand-landmarker model, Blender sources that generate the GLB library |
| Tests | `tests/` | Vitest unit/contract tests; CDP end-to-end scripts under `tests/e2e/` |

## Tech stack

- TypeScript, Vite, Vitest
- Three.js (3D scene), GSAP (motion), Lucide icons
- MediaPipe Tasks Vision (hand tracking)
- Node.js (`tsx`) local backend; Meta Muse Spark (`muse-spark-1.3`) via the Meta Responses API
- Blender Python scripts as the source of the architectural/mechanical GLB assets

## Install and run

Requirements: Node.js 20+ and npm.

```bash
npm install
npm test          # unit and contract tests (offline; no Meta calls)
npm run build     # TypeScript check + production build
npm run dev       # Vite frontend
```

To enable the Meta-backed features locally, in a separate terminal:

```bash
export MODEL_API_KEY='<your-key>'   # server-side only, never commit it
npm run server                       # backend on http://127.0.0.1:8787
```

Useful routes in the frontend include `/demo` and `/spatial-editor` (see `src/main.ts`).

## Tests

- `npm test` runs the Vitest suite (42 test files / 238 tests, all passing; see Known limitations for the three evidence-dependent files excluded from this snapshot). Phase 10 adds `tests/phase-10-grounded-flow.test.ts`, a fully offline grounded E2E: synthetic image → wall/region detection → semantic association proposal/acceptance → scene built from the validated graph → grounded answers → +50 cm alteration via preview/commit → undo.
- `npm run build` runs `tsc --noEmit` and the Vite production build; it passed before publication.
- CDP scripts in `tests/e2e/` require a local Chrome/Chromium and, for the real-plan cases, the private plan images/evidence that are not published, so they are not runnable from this snapshot alone.

## Phase 10 — Grounded Spatial Intelligence

- `semantic_spatial_map.v1` (`src/semantic-spatial-map.ts`) explicitly links accepted technical-document elements → candidate plan regions → wall candidates → scene-graph components, with evidence and human review state (`proposed`/`accepted`/`rejected`). The proposal is shown before acceptance; document names, areas and dimensions are never converted into walls or coordinates, and the original document is preserved.
- Well-defined candidate regions (closed contour, confidence ≥ 0.7) are pre-selected for review in the spatial editor; construction still requires explicit scale calibration, boundary confirmation and height/thickness parameters.
- Accepted links label room nodes in the built scene (provenance: `technical_document`), so contextual commands such as “Mostra-me a cozinha” resolve to real scene components.
- Deterministic grounded answers (`answerGroundedQuery`) cover identification, showing a linked division, selected-wall dimensions and “what changed”, returning an explicit clarification instead of fabricating when context is missing. Mutations continue through the existing Muse Spark agent + deterministic executor with preview, confirmation and undo/redo; no model output writes directly to the Scene Graph.
- Untrusted labels/ids are escaped before `innerHTML` interpolation in the spatial editor and workspace.

## Known limitations

- Automatic plan reconstruction produces **candidate** geometry, not confirmed geometry; human tracing/confirmation is required before building.
- Scale remains explicitly unknown when a plan does not provide it.
- The 3D viewer is 2.5D: geometry is generated from the validated structure rather than a full BIM model.
- Live Muse Spark behaviour is not re-validated by the test suite; tests are offline and make no Meta, audio, or paid-service calls.
- Three test files that asserted against private live Meta evidence (`technical-evidence`, `spatial-handoff`, `phase-7e4-resume`) were excluded from this public-clean snapshot; two small structured fixtures needed by other tests are kept under `reports/`.
- Mobile viewport behaviour was not visually inspected in the final local iteration.

No licence is included in this repository.

# UNFOLD — image-to-functional-assembly

## Contract boundary

This slice produces a reviewable proposal under `src/living/reconstruction/`:

- `unfold.excavator_observation.v1` contains source evidence, stable entity IDs, detected features, unknown values, hypotheses, relations, dimensions and user requests.
- `unfold.assembly_proposal.v1` is the reconstruction-layer proposal. It is deliberately different from the engineering team's `unfold.assembly.v1`.
- `adaptReviewedProposalToAssembly()` is the explicit, validated adapter to the canonical engineering `Assembly`. It requires a validated engineering seed and explicit human review authorization, and fails closed when either is absent.
- The proposal is never written to `spatial_scene.v1`, never sent to a solver, and never executes text returned by Muse Spark.

The canonical engineering contract was integrated from commit `efa8fe0fb0fab6ce6beda979df4f77240260c5db`. The adapter consumes its `validateAssembly()` and the synthetic excavator fixture; it does not redefine that schema.

## Coordinate and unit conversion

The proposal template frame is `+X forward, +Y operator-left, +Z up`, with metres and Euler degrees. The adapter explicitly converts to the engineering frame `+X forward, +Y up, +Z operator-right`, metres, radians and unit quaternions. Conversion covers translations, axes, rotations and relative joint origins. Unknown units remain `unknown` in the proposal and are never treated as degrees.

## Supported path

`POST /api/living/reconstruction` accepts exactly one of:

- an image or technical drawing (`imageDataUrl`, JPEG/PNG, validated before processing);
- a textual instruction (`instruction`, maximum 8000 characters).

`mode: "live"` calls Muse Spark through the existing server-only Meta transport with `excavator_observation_v1` strict JSON output. `mode: "offline"` is deterministic and template-based for tests; it is labelled `offline-template` and does not claim visual interpretation.

The response includes `observation`, `assemblyProposal`, `engineering.status`, `metrics`, `limitations` and non-sensitive Meta telemetry. The engineering status is `blocked` until an explicitly reviewed proposal and a validated engineering seed are supplied.

## Generalization and integration evidence

| Input | Parts | Joints | Actuators | Schema | Human correction items |
| --- | ---: | ---: | ---: | ---: | ---: |
| image fixture A | 13 | 7 | 3 | valid proposal | 21 |
| technical drawing fixture B | 13 | 7 | 3 | valid proposal | 21 |
| text instruction (`boom 4200 mm`, bucket modification) | 13 | 7 | 3 | valid proposal | 22 |

The two image fixtures are distinct source hashes and references. Offline outputs mark geometry as hypotheses or synthetic template values; they do not contain Muse inference provenance. A live-model build uses model provenance only for the live path.

The integration test builds an offline proposal, supplies the engineering team's excavator fixture as the validated seed, adapts it with explicit review authorization, and asserts the actual result with `validateAssembly()` from `src/living/contracts/assembly.v1.ts`. The adapted assembly remains `unreviewed`; no constraint is promoted to verified.

## Live provider evidence

The live path was exercised from the PR worktree with the local ignored `.env`: a real textual Muse Spark request returned HTTP 200 in approximately 16.5 seconds, with model `muse-spark-1.3`, a request ID, `unfold.excavator_observation.v1`, and a downstream `unfold.assembly_proposal.v1` containing 13 parts and 7 joints. The API reported `engineering.status=blocked` because no reviewed engineering seed was supplied. The key, raw input and full request ID are not published.

## Validation and safety

- Entity and relation resolution uses semantic roles rather than exact model IDs.
- Dimensions match semantic labels and the resolved part role; unrelated measurements are not reused.
- Unknown, hypothesis, observed and template values remain separate.
- Template dimensions are hypothetical and carry `requiredForVerification: true`.
- User text can create pending dimension or replacement proposals only; it cannot execute commands or mutate confirmed scene data.
- Image payloads use the existing JPEG/PNG signature and size validation, server-only credentials and the existing origin/host/token guards.
- Missing engineering shapes, points, limits, actuator topology or review authorization blocks adaptation instead of manufacturing verified constraints.

## Verification

- Focused reconstruction tests: 12 passed.
- Full suite: 66 files, 1260 tests, zero failures.
- TypeScript and production build: passed; existing contact-variable and large-chunk warnings remain.
- `git diff --check`: passed.

## Limitations

- The offline path is a deterministic template fallback, not image understanding.
- No hidden excavator geometry, masses, materials, hydraulic pressures, cylinder bores, joint limits or structural safety claims are inferred as verified.
- The current library supports the generic excavator family only; the mechanical solver and renderer are intentionally untouched.
- Human review and an engineering seed remain required before simulation.

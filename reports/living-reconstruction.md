# UNFOLD — image-to-functional-assembly

## Contract boundary

This slice produces a reviewable proposal under `src/living/reconstruction/`:

- `unfold.excavator_observation.v1` contains source evidence, stable entity IDs, detected features, unknown values, hypotheses, relations, dimensions and user requests.
- `unfold.assembly_proposal.v1` is the reconstruction-layer proposal. It is deliberately different from the engineering team's `unfold.assembly.v1`.
- `adaptReviewedProposalToAssembly()` is the explicit, validated adapter to the canonical engineering `Assembly`. It requires a validated engineering seed and explicit human review authorization, and fails closed when either is absent.
- The proposal is never written to `spatial_scene.v1`, never sent to a solver, and never executes text returned by Muse Spark.

The canonical engineering contract is synchronized with `main` after merged PR #11 (`40088fa906c22a4dde15d62279160e12c74da42a`, merge `855a0f59cc2ee38acc69d31acc1aea8aed4ba435`) and PR #10 (`main@ff16954d0ac9ea01bebe49935f521dde6990ab6c`). The adapter consumes `validateAssembly()` and the synthetic excavator fixture; it does not redefine that schema.

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
- Text dimensions require the requested semantic name in the local part phrase: chassis length and width are independent, mixed units are preserved, and an omitted measurement remains unknown.
- Unknown, hypothesis, observed and template values remain separate.
- Template dimensions are hypothetical and carry `requiredForVerification: true`.
- User text can create pending dimension or replacement proposals only; it cannot execute commands or mutate confirmed scene data.
- Image payloads use the existing JPEG/PNG signature and size validation, server-only credentials and the existing origin/host/token guards.
- Missing engineering shapes, points, limits, actuator topology or review authorization blocks adaptation instead of manufacturing verified constraints.
- `Joint.origin` is written at q=0: the proposed reference pose is reconciled by removing the seed `referenceValue` motion. Forward-kinematics regression checks compare the adapted result with the proposal and the independent fixture reference pose.
- Approved boom/stick lengths update local box geometry, named points, child joint anchors and related constraint provenance. Approved cylinder strokes update actuator maxima, slide limits and rod geometry. Observed dimensions without a coherent canonical mapping block adaptation explicitly.
- Every mapped parent/child pose, including cylinder base and slide mounts, is reconciled to q=0 before FK. Mapped loop constraints are checked in the reference configuration; inconsistent geometry blocks conversion. Barrel and rod stroke observations must agree or conversion blocks.

## Verification

- Focused reconstruction tests: 18 passed.
- Full suite: 72 files, 1408 tests passed with `npx vitest run --testTimeout=15000` after synchronizing `main@ff16954`. The unparameterized `npm test` still times out in the existing rendering lifecycle test at its 5 s default; no rendering code was changed here.
- TypeScript and production build: passed; existing contact-variable and large-chunk warnings remain.
- `git diff --check`: passed.

## Limitations

- The offline path is a deterministic template fallback, not image understanding.
- No hidden excavator geometry, masses, materials, hydraulic pressures, cylinder bores, joint limits or structural safety claims are inferred as verified.
- The current library supports the generic excavator family only; the mechanical solver and renderer are intentionally untouched.
- Human review and an engineering seed remain required before simulation.
- Dev-Brain STATUS/HANDOFF update is pending because the local Obsidian MCP endpoint was unavailable during this handoff.

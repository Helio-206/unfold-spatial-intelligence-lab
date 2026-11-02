# UNFOLD — image-to-functional-assembly

## Contract boundary

This slice adds a reviewable proposal boundary under `src/living/reconstruction/`:

- `unfold.excavator_observation.v1` contains source evidence, stable entity IDs, detected features, unknown values, hypotheses, relations, dimensions and user requests.
- `unfold.assembly.v1` contains a validated part hierarchy, transforms, joints, hydraulic actuator references, template provenance and pending human review.
- The proposal is never written to `spatial_scene.v1`, never sent to a solver, and never executes text returned by Muse Spark.

The existing `mechanical_graph.v1` and `kinematic_assembly.v1` contracts remain unchanged. This proposal is an upstream handoff for the engineering agent, not a replacement solver contract.

## Supported path

`POST /api/living/reconstruction` accepts exactly one of:

- an image or technical drawing (`imageDataUrl`, JPEG/PNG, validated before processing);
- a textual instruction (`instruction`, maximum 8000 characters).

`mode: "live"` calls Muse Spark through the existing server-only Meta transport with `excavator_observation_v1` strict JSON output. `mode: "offline"` is deterministic and template-based for tests; it is labelled `offline-template` and does not claim visual interpretation.

The response includes `observation`, `assembly`, `metrics`, `limitations` and non-sensitive Meta telemetry. `assembly.validation.status` is always `review_required` for generated proposals in this slice.

## Offline generalization evidence

| Input | Parts | Joints | Actuators | Schema | Human correction items |
| --- | ---: | ---: | --- | ---: | ---: |
| image fixture A | 13 | 7 | 3 | valid | 21 |
| technical drawing fixture B | 13 | 7 | 3 | valid | 21 |
| text instruction (`boom 4200 mm`, bucket modification) | 13 | 7 | 3 | valid | 22 |

The two image fixtures are distinct source hashes and references. The offline result marks the machine and parts as hypotheses because no visual model call was made. The text fixture records the explicit boom dimension as an unverified user supplied value and keeps the bucket change as a pending modification.

## Live provider evidence

No live Muse Spark request was made in this checkout because `MODEL_API_KEY` was not configured. The API returns `503 MODEL_API_KEY_MISSING` for `mode: "live"`; it does not silently downgrade to the offline template. Tests inject a fake transport and verify the strict schema name, model and `strict: true` request format without calling Meta.

## Validation and safety

- Unknown, hypothesis, observed and template values remain separate.
- Template dimensions are hypothetical and carry `requiredForVerification: true`.
- Part IDs, relation endpoints, dimensions, transforms, hierarchy cycles, joint axes, actuator references and request operations are validated before an assembly is returned.
- User text can create pending dimension or replacement proposals only; it cannot execute commands or mutate confirmed scene data.
- Image payloads use the existing JPEG/PNG signature and size validation, server-only credentials and the existing origin/host/token guards.

## Limitations

- The offline path is a deterministic template fallback, not image understanding.
- No hidden excavator geometry, masses, materials, hydraulic pressures, cylinder bores, joint limits or structural safety claims are inferred as verified.
- The current library supports the generic excavator family only; the mechanical solver and renderer are intentionally untouched.
- Human review and a later engineering-agent adapter are required before simulation.

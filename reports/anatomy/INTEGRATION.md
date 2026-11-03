# UNFOLD Anatomy Heart Domain — Claude Terminal handoff

## Boundary

This prototype adds the isolated `/anatomy` domain route and the `AnatomyDomainAdapter`. It does not change the industrial assembly, excavator observation, Visual Foundry, Engineering Engine, Cinema route, or the shared Claude UI. The heart GLB is a static reference atlas; Meta findings only select atlas components after review. The illustration is never converted into model geometry.

## Meta endpoint

`POST /api/anatomy/observe` is the only network endpoint owned by this domain. It is called through the same-origin local backend proxy. It uses the existing Muse Spark Responses client and the backend's origin/host guard, Meta budget and concurrency gate, and request rate limit.

Request headers:

```http
Content-Type: application/json
```

Request body (no extra properties):

```json
{
  "imageDataUrl": "data:image/png;base64,...",
  "sourceReference": "https://commons.wikimedia.org/wiki/File:Diagram_of_the_human_heart.svg"
}
```

Accepted image MIME types are JPEG and PNG; the raw image is limited to 10 MB, each side to 64–4096 px, and total pixels to 12 MP. SVG is rasterised in the browser first. The server calculates the source SHA-256 from the decoded image bytes and sends one high-detail image request to `muse-spark-1.3` with strict JSON Schema `anatomy_observation_v1`. This endpoint is live-only; there is no template or offline response.

Success response:

```json
{
  "contract": "unfold.anatomy_observation.v1",
  "status": "review_required",
  "observation": {
    "schema": "unfold.anatomy_observation.v1",
    "observationId": "<24 hex chars, bound to canonical findings and source SHA>",
    "source": {
      "kind": "image",
      "reference": "https://commons.wikimedia.org/wiki/File:Diagram_of_the_human_heart.svg",
      "sha256": "<SHA-256 of exact raster bytes sent to Meta>"
    },
    "subjectDisposition": "heart_illustration",
    "subjectEvidence": [
      { "id": "subject-visible", "kind": "image_region", "detail": "A labelled heart cutaway is visible.", "locator": null }
    ],
    "structures": [
      {
        "id": "right-atrium",
        "label": "Right atrium",
        "status": "observed",
        "confidence": 0.98,
        "evidence": [
          { "id": "right-atrium-label", "kind": "label_text", "detail": "Printed label identifies the right atrium.", "locator": "left chamber label" }
        ]
      }
    ],
    "relations": [],
    "hypotheses": [],
    "uncertainties": ["Scale and physical dimensions are unknown."],
    "dimensions": [],
    "limitations": ["educational_only", "not_diagnostic", "not_measured", "not_photo_reconstruction"]
  },
  "meta": {
    "model": "muse-spark-1.3",
    "httpStatus": 200,
    "status": "success",
    "requestId": "<provider request id>"
  }
}
```

`subjectDisposition` is `heart_illustration`, `incompatible`, or `uncertain`. Anything other than `heart_illustration` blocks the heart adapter. Structure IDs and relation endpoints are allow-listed to the 11 nodes in `public/anatomy/model-manifest.json`; unknown anatomy stays in `uncertainties`. `dimensions` is always an empty tuple. Confidence is Meta's self-reported confidence, not calibrated accuracy.

Errors use `{ "error": { "code": "...", "message": "..." }, "meta"?: { ... } }`. Known codes include `ANATOMY_REQUEST_INVALID`, `ANATOMY_SOURCE_INVALID`, `ANATOMY_IMAGE_INVALID`, `ANATOMY_RATE_LIMITED`, `META_CALL_BUDGET_EXHAUSTED`, `META_CONCURRENCY_LIMIT`, `ANATOMY_SCHEMA_INVALID`, `ANATOMY_META_FAILED`, and `ANATOMY_OBSERVATION_FAILED`.

## Human review adapter

The API response is preserved as `AnatomyObservationV1`. Do not mutate it to record review decisions. Build a separate object with the review contract and bind it to both `observationId` and `source.sha256`:

```ts
{
  schema: 'unfold.anatomy_review.v1',
  reviewId: 'client-generated-id',
  observationId: observation.observationId,
  sourceSha256: observation.source.sha256,
  actor: { kind: 'client_unverified', identityVerified: false },
  decisions: [
    { targetId: 'right-atrium', decision: 'accept', correctedComponentId: null, note: null }
  ]
}
```

Every returned structure, relation, and hypothesis needs exactly one `accept`, `reject`, or `correct` decision. Corrections are only valid for structures and must name an allow-listed component. Duplicate component mappings are rejected. Missing, repeated, stale-source, or malformed decisions block adaptation. The demo creates a local client review; it does not persist a review or verify a person's identity. The actor enum deliberately makes no such claim.

Public adapter entry point:

```ts
import { anatomyDomainAdapter } from './anatomy/adapter';

const observation = anatomyDomainAdapter.validateObservation(apiResponse.observation);
const review = anatomyDomainAdapter.validateReview(reviewInput, observation);
const scene = anatomyDomainAdapter.adapt(observation, review);
```

`anatomyDomainAdapter.validateObservation` validates the `observation` member, including its bound source hash, immutable educational limitations, empty dimensions, and canonical observation ID; it does not validate the outer HTTP wrapper. The caller must also require `contract === 'unfold.anatomy_observation.v1'` and `status === 'review_required'`, then compare the returned source hash/reference with the submitted image. `adapt` returns `unfold.anatomy_scene.v1` only for a reviewed heart illustration.

## Live Meta result and review provenance

The recorded live request used `muse-spark-1.3`, returned HTTP 200 under request ID `f57db0ed-7ef6-44fb-856b-060c4ba48a8c`, and was bound to raster PNG SHA-256 `c79356c78e4b95f765d3d12649a0b2e129a5dc74ecf4c18712a4260a9810c43b`. Meta classified the source as `heart_illustration` and returned 9 structures, 8 relations, 0 hypotheses, 6 uncertainty statements, and no dimensions. It explicitly left coronary anatomy, true depth/3D relationships, scale, wall thickness, patient-specific anatomy, clinical meaning, and detailed valve morphology unresolved. Confidence values are provider self-reports.

The observation remains the immutable Meta result. The browser acceptance script replayed that saved result and exercised decisions accepting the returned structures and relations; this is automated UI evidence, not evidence that a person reviewed it. The adapter labels the actor `client_unverified`, does not persist review, and makes no identity claim. A permanent workspace must store an independently authenticated review record bound to the observation and exact source hash before presenting a verified reviewer.

The nine returned structures correspond to these existing atlas nodes. This is an entity-to-mesh proposal, not proof that the labels or geometry are anatomically correct:

| Meta observation | Atlas component / exact mesh name | Atlas interpretation |
| --- | --- | --- |
| `right-atrium` | `right-atrium` | Right atrial wall |
| `left-atrium` | `left-atrium` | Left atrial wall |
| `right-ventricle` | `right-ventricle` | Right ventricular cavity surface (space, not muscle) |
| `left-ventricle` | `left-ventricle` | Left ventricular cavity surface (space, not muscle) |
| `ventricular-wall` | `ventricular-wall` | One combined ventricular wall |
| `ascending-aorta` | `ascending-aorta` | Ascending aorta |
| `aortic-arch` | `aortic-arch` | Aortic arch |
| `pulmonary-trunk` | `pulmonary-trunk` | Pulmonary trunk |
| `superior-vena-cava` | `superior-vena-cava` | Superior vena cava |

The two coronary mesh nodes are not mapped from this result: Meta said their anatomy was not clearly shown or labelled. No hidden or absent structure should be promoted by the adapter.

## Relations requiring anatomical validation

All eight relations below were returned by Meta with status `observed` for the schematic illustration. The status records what the model reported; it is not expert validation and must remain reviewable. The confidence values are not calibrated.

| Relation ID | Meta relation | Confidence | Validation question |
| --- | --- | ---: | --- |
| `rel-svc-ra` | `superior-vena-cava connects_to right-atrium` | 0.95 | Confirm the depicted vessel/chamber endpoints and the intended meaning of `connects_to`. |
| `rel-ra-rv` | `right-atrium connects_to right-ventricle` | 0.90 | Confirm that this is a chamber-flow adjacency across the tricuspid valve, not a direct anatomical connection. |
| `rel-rv-pt` | `right-ventricle connects_to pulmonary-trunk` | 0.90 | Confirm the depicted outflow endpoint and relation semantics across the pulmonary valve. |
| `rel-la-lv` | `left-atrium connects_to left-ventricle` | 0.90 | Confirm chamber-flow adjacency across the mitral valve. |
| `rel-lv-aa` | `left-ventricle connects_to ascending-aorta` | 0.80 | Confirm the depicted aortic root/outflow and endpoint mapping. |
| `rel-aa-arch` | `ascending-aorta continues_as aortic-arch` | 0.90 | Confirm the vessel continuity represented by the drawing. |
| `rel-vw-rv` | `ventricular-wall contains right-ventricle` | 0.80 | **Requires explicit review.** The atlas node `right-ventricle` is a cavity-space surface, while `ventricular-wall` is combined muscle. Does `contains` mean “the wall bounds/surrounds this cavity,” rather than literal material containment? |
| `rel-vw-lv` | `ventricular-wall contains left-ventricle` | 0.80 | **Requires explicit review.** Same semantic issue for the left cavity. The current enum has no `bounds`/`surrounds` relation; do not reinterpret or canonicalise these edges without an anatomy-domain decision and a versioned contract change. |

The source is a simplified frontal cutaway. All eight edges need anatomy review before being treated as canonical. In particular, do not infer valve topology, directional flow, or 3D enclosure from the illustration alone.

## Scene and timeline contract

Scene proposal fields:

```ts
{
  schema: 'unfold.anatomy_scene.v1',
  sourceObservationId: string,
  sourceImageSha256: string,
  model: { url: '/anatomy/heart.glb', sha256: string, license: 'CC-BY-4.0', attribution: string },
  components: Array<{
    entityId: string,
    componentId: AnatomyComponentId,
    meshName: AnatomyComponentId,
    reviewDecision: 'accepted' | 'corrected',
    observationStatus: 'observed' | 'hypothesis'
  }>,
  uncertainties: string[],
  motion: {
    kind: 'illustrative',
    physiologyValidated: false,
    durationS: 4,
    phases: Array<{ id: string, label: string, startS: number, endS: number, note: string }>
  }
}
```

The mesh names equal the stable component IDs. Available IDs: `right-atrium`, `left-atrium`, `ventricular-wall`, `right-ventricle`, `left-ventricle`, `ascending-aorta`, `aortic-arch`, `pulmonary-trunk`, `superior-vena-cava`, `left-coronary`, and `right-coronary`. The atlas uses one combined ventricular wall; it has no separate left/right ventricular muscle meshes. The ventricular cavity surfaces represent spaces, not muscle.

The timeline changes only highlight state and explanatory text. It does not move or deform anatomy, calculate blood flow, model pressure, or claim physiological timing. The sequence is explicitly illustrative and not physiologically validated.

## Reuse in the permanent workspace

The Terminal integration should add this domain through the existing common experience; this PR does not propose a second permanent interface.

- Reusable domain surface: `AnatomyObservationV1`, `AnatomyReviewV1`, `unfold.anatomy_scene.v1`, `AnatomyDomainAdapter`, the `POST /api/anatomy/observe` route contract (wrap the request in the common workspace gateway/port), allow-listed component manifest, asset attribution, and a viewer mount that consumes a reviewed proposal.
- Existing 3D dependencies: the repository's pinned `three` package, `GLTFLoader`, and `OrbitControls`. Cinema reuse is limited to the existing `createStudioEnvironment` helper for studio lighting/environment. `CinemaRuntime` itself is excavator/assembly-oriented and should not be imported as the anatomy contract or shared state machine.
- Workspace owner supplies authenticated reviewer identity, durable review persistence/audit, stale-session handling, and the common interface. Keep original Meta observation immutable and persist human decisions separately. Do not promote the E2E's scripted decisions as a person-reviewed result.
- The `/anatomy` page in this branch is an isolated prototype harness for this domain, not a proposed second workspace. The permanent experience should host its own common UI and mount the domain viewer/adapter as appropriate.
- Safe integration can expose the nine proposed entity-to-mesh mappings and the static licensed atlas while showing remaining uncertainties; promotion requires an actual review in the permanent interface. Keep all dimensions empty; the source is schematic and uncalibrated. The relation set, especially both ventricular-wall `contains` edges, remains provisional until domain review. No broader anatomy family is in scope.

## Expected overlap with PR #20

This branch is based on `main@c1390c75d981cfb9bdb43b8e9466ccfdd317a227`. A non-mutating merge-tree check against PR #20's current head (`14b6d6172ea578450afa8372cb209e39e37a0d13`) found one content conflict in `server/meta-server.ts`; both branches add logic around `/api/living/reconstruction`, so a resolver must preserve PR #20's review-session/rate-limit behavior and this branch's separate `/api/anatomy/observe` route. `src/main.ts` is also changed by both branches, but Git auto-merges the `/anatomy` route with PR #20's `/living` route change. No other path overlap was found. This is a prediction against the observed heads, not a claim about a future merge after either branch changes.

## Asset and evidence

- `public/anatomy/heart.glb`, SHA-256 `b80a727d022a4ab07ccfcf15caccc228eaccb6d69ec0e72923324946ac35a946`.
- Upstream prepared asset: `organui/heart-3d` commit `c72ce6654ff8e282942f97750d3104f55ef4fc3d`; exact asset bytes compared against that commit.
- Geometry source: BodyParts3D 4.0, adapted by OrganUI, model data CC BY 4.0; attribution is in `public/anatomy/MODEL-ATTRIBUTION.md`. The official archive is the licensing source; the MIT upstream application-code license does not apply to model geometry.
- `public/anatomy/source-heart.svg`, SHA-256 `f1594cbae7130d32d21b4c9b9df2864dc5038cfd6e090860d9e458c164e502ba`, Wapcaplet/Yaddah, CC BY-SA 3.0; see `public/anatomy/SOURCE-ILLUSTRATION-ATTRIBUTION.md`.
- The image attached to the integration-preparation request was treated as a visual reference only. Its source/licence was not supplied, so it is not added to the repository or treated as licensed input.
- Live Meta request ID and exact findings are recorded above; source PNG SHA-256 `c79356c78e4b95f765d3d12649a0b2e129a5dc74ecf4c18712a4260a9810c43b`.
- Browser acceptance ran on headless Chromium with SwiftShader. Screenshots and the sanitized observation record are generated under the ignored local `reports/anatomy/evidence/` directory.

## Limits

This is an adult male atlas with omitted anatomy, truncated vessel ends, grouped coronary trees, no separately selectable valves or atrial cavities, and no expert clinical anatomy review. The source diagram is schematic and not calibrated. No diagnosis, medical measurement, patient-specific reconstruction, or clinical inference is supported. Fidelity to photography remains NO-GO.

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

Errors use `{ "error": { "code": "...", "message": "..." }, "meta"?: { ... } }`. Known codes include `ANATOMY_REQUEST_INVALID`, `ANATOMY_SOURCE_INVALID`, `ANATOMY_IMAGE_INVALID`, `ANATOMY_RATE_LIMITED`, `META_CALL_BUDGET_EXHAUSTED`, `ANATOMY_SCHEMA_INVALID`, and `ANATOMY_META_FAILED`.

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

`validateObservation` checks the complete API envelope, source hash, immutable educational limitations, empty dimensions, and canonical observation ID. `adapt` returns `unfold.anatomy_scene.v1` only for a reviewed heart illustration.

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

## Asset and evidence

- `public/anatomy/heart.glb`, SHA-256 `b80a727d022a4ab07ccfcf15caccc228eaccb6d69ec0e72923324946ac35a946`.
- Upstream prepared asset: `organui/heart-3d` commit `c72ce6654ff8e282942f97750d3104f55ef4fc3d`; exact asset bytes compared against that commit.
- Geometry source: BodyParts3D 4.0, adapted by OrganUI, model data CC BY 4.0; attribution is in `public/anatomy/MODEL-ATTRIBUTION.md`. The official archive is the licensing source; the MIT upstream application-code license does not apply to model geometry.
- `public/anatomy/source-heart.svg`, SHA-256 `f1594cbae7130d32d21b4c9b9df2864dc5038cfd6e090860d9e458c164e502ba`, Wapcaplet/Yaddah, CC BY-SA 3.0; see `public/anatomy/SOURCE-ILLUSTRATION-ATTRIBUTION.md`.
- Live Meta request ID: `f57db0ed-7ef6-44fb-856b-060c4ba48a8c`; HTTP 200; source PNG SHA-256 `c79356c78e4b95f765d3d12649a0b2e129a5dc74ecf4c18712a4260a9810c43b`.
- Browser acceptance ran on headless Chromium with SwiftShader. Screenshots and the sanitized observation record are generated under the ignored local `reports/anatomy/evidence/` directory.

## Limits

This is an adult male atlas with omitted anatomy, truncated vessel ends, grouped coronary trees, no separately selectable valves or atrial cavities, and no expert clinical anatomy review. The source diagram is schematic and not calibrated. No diagnosis, medical measurement, patient-specific reconstruction, or clinical inference is supported. Fidelity to photography remains NO-GO.

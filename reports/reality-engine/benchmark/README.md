# Reality Engine benchmark (ground truth 3D, licensed)

**What it is.** 14 independent 3D assets (Khronos glTF-Sample-Assets, licences and authors in `manifest.json`, sha256 verified). Views are **rendered** from them with known cameras. They are **not photographs**. Distances are percentages of the asset's bounding-box diagonal.

**Reproduce**
```
node scripts/benchmark/fetch-reality-assets.mjs          # downloads + verifies sha256 (GLBs are git-ignored)
npx tsx scripts/benchmark/reality-engine.ts              # engine on orthographic renders, known cameras  -> results/results.json
npx tsx scripts/benchmark/reality-product-eval.ts        # PRODUCT path on perspective renders (Chromium) -> product-results/product-results.json
npx tsx scripts/benchmark/derive-reality-calibration.ts  # derives src/living/reality/calibration.ts from the DEVELOPMENT split only
npx tsx tests/e2e/reality-engine.pw.ts                   # the /living journey in a browser (UNFOLD_RE_ASSET=BoomBox|CesiumMilkTruck|AntiqueCamera)
```

**Split rules.** `development` assets may be used to tune; `acceptance` assets never influence a parameter. Two things happened and are recorded, not hidden:
1. `CesiumMilkTruck` was first an acceptance asset. Its product-path run exposed a segmentation weakness (pale body on a pale background); the fix (adaptive threshold, generic segmentation) was made in response, so it was **moved to development** and four fresh acceptance assets were added (`GlamVelvetSofa`, `ChairDamaskPurplegold`, `IridescenceLamp`, `CarConcept`, `addedAfterTuning: true`).
2. After the acceptance run, calibration constants were NOT edited to fit it; one acceptance object (`IridescenceLamp`, transparent glass) exceeds the development maximum and that is reported as an overshoot.

**Metrics.** Chamfer (accuracy = prediction→truth, completeness = truth→prediction), held-out silhouette IoU on renders never used, leave-one-out agreement, pose error, compute time, peak memory. Product-path Chamfer: translation aligned from the solid's own outer surface (origin convention only; no rotation, no scale fit), accuracy on the outer surface only.

**What it cannot prove.** Photographs (no 3D truth available here), architecture, anatomy, transparent or reflective objects, single-photo reconstruction, real camera calibration. Silhouette agreement is never presented as 3D accuracy; 3D accuracy is the Chamfer against the asset.

# External benchmarks: DTU and ETH3D (real photographs + reference geometry)

**Status: prepared, NOT run.** The build environment's network policy blocks the dataset hosts, so no scan has been downloaded and no number from these datasets appears anywhere in the reports. Everything below is ready for the day the data is on disk.

## What is ready (and tested without the data)
| Piece | File | Test |
|---|---|---|
| Frozen dev/acceptance split (pure function of the scan name) | `freeze-splits.ts`, `splits.json` | `tests/dataset-splits.test.ts` recomputes it |
| Readers: MVSNet camera files, PLY point clouds, square-camera/mask conversion | `src/universal-spatial/reconstruction/dataset-formats.ts` | `tests/dataset-formats.test.ts` |
| Perspective (pinhole) visual hull | `src/universal-spatial/reconstruction/multiview.ts` | `tests/multiview-hull.test.ts` |
| Chamfer + held-out IoU against a reference cloud | `src/universal-spatial/reconstruction/dataset-eval.ts` | `tests/dataset-eval.test.ts` (synthetic scan with the same shape as DTU) |
| Scan-directory loader / CLI | `scan-directory.ts` | `tests/dataset-eval.test.ts` (writes a scan to disk and reads it back) |

## Layout the CLI reads (`npx tsx scripts/datasets/scan-directory.ts <dir> --out <file>`)
```
<dir>/cams/00000000_cam.txt ...   MVSNet camera files (extrinsic world->camera, intrinsic)
<dir>/masks/00000000.pgm ...      8-bit PGM (P5), white = object, same size as the image
<dir>/reference.ply               reference point cloud
<dir>/meta.json                   { "width", "height", "units", "scan", "dataset", "licence" }
```
Pillow converts masks: `Image.open('mask.png').convert('L').save('00000000.pgm')`. DTU object masks are not part of the raw DTU release; they come from derived sets (e.g. the masks shipped with common neural-reconstruction preprocessings) and their own licence applies.

## Protocol (fixed in advance)
1. Download, read the licence on the source page, write it in `meta.json`. **Licences are not asserted in this repository.**
2. Tune on `development` scans only (`splits.json`). Freeze the configuration (commit hash).
3. Run every `acceptance` scan once with that configuration; publish all results, including the bad ones, next to the synthetic and render benchmarks.
4. The Chamfer printed by the CLI is **not** the benchmarks' official metric (no observability masks, no thresholds). Run the official evaluation script on the same hull before quoting any dataset number.
5. Masks must be independent of the reconstruction. If masks come from a segmentation model, say which and report its own IoU where a reference exists.

## What the real data can settle that renders cannot
Lens/camera effects, real lighting, real texture, real segmentation difficulty, and calibrated cameras (the product assumes orthographic poses; the pinhole path with calibrated cameras bounds how much the assumption costs).

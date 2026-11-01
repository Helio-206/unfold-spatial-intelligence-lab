import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPlanVectorModel, countClosedCandidateContours, detectWallCandidatesDetailed, measureRegionRasterSupport } from '../src/plan-reconstruction';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const planPath = resolve(process.env.HABS_PLAN ?? join(repositoryRoot, 'reports/phase-10-teardown/fixtures/amoureaux-house-plan.png'));
const openPlanRoot = process.env.OPENPLAN3D_ROOT;
if (!openPlanRoot) throw new Error('Defina OPENPLAN3D_ROOT para o checkout fixado de OpenPlan3D.');

const scratch = await mkdtemp(join(tmpdir(), 'unfold-habs-compare-'));
const grayPath = join(scratch, 'plan.gray');
try {
  execFileSync('python3', ['-c', 'from PIL import Image; import sys; open(sys.argv[2], "wb").write(Image.open(sys.argv[1]).convert("L").tobytes())', planPath, grayPath]);
  const bytes = await readFile(planPath);
  const gray = await readFile(grayPath);
  const dimensions = execFileSync('python3', ['-c', 'from PIL import Image; import sys; im=Image.open(sys.argv[1]); print(f"{im.width} {im.height}")', planPath], { encoding: 'utf8' }).trim().split(' ').map(Number);
  const [width, height] = dimensions;
  if (!width || !height || gray.length !== width * height) throw new Error('Raster HABS inválido.');
  const raster = { width, height, grayscale: new Uint8Array(gray) };

  const detected = detectWallCandidatesDetailed(raster, {
    threshold: 150,
    minimumLengthPx: Math.max(24, Math.floor(Math.min(width, height) * 0.045)),
    gapTolerancePx: 3,
  });
  const unfold = buildPlanVectorModel(detected.fused, { tolerancePx: 6, imageSize: { width, height } });
  const moduleUrl = pathToFileURL(resolve(openPlanRoot, 'src/lib/utils/roomDetection.ts')).href;
  const { resolveRoomGeometry } = await import(moduleUrl) as { resolveRoomGeometry: (floor: { walls: unknown[]; rooms: unknown[] }) => Array<{ room: { area: number; walls: string[] }; polygon: Array<{ x: number; y: number }> }> };
  const openPlanWalls = detected.fused.map((candidate) => ({
    id: candidate.id,
    start: candidate.start,
    end: candidate.end,
    thickness: 15,
    height: 280,
    color: '#ffffff',
  }));
  const openPlanRooms = resolveRoomGeometry({ walls: openPlanWalls, rooms: [] });
  const unfoldRooms = unfold.regions.filter((region) => region.eligibility === 'construction_candidate');
  const edgeEvidence = (id: string, vertices: Array<{ x: number; y: number }>) => measureRegionRasterSupport(
    raster,
    { id, vertices },
  );

  const report = {
    scenario: 'HABS MO-1113 Amoureaux House, first-floor plan, sheet 3/10',
    attribution: 'Library of Congress, Prints & Photographs Division, HABS MO-1113, sheet 3/10',
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourcePixels: { width, height },
    setup: {
      grayscale: 'Pillow Image.convert("L")',
      unfoldDetector: { threshold: 150, minimumLengthPx: Math.max(24, Math.floor(Math.min(width, height) * 0.045)), gapTolerancePx: 3 },
      sharedTopologyInput: 'The exact fused UNFOLD segment list was supplied to both graph algorithms; coordinates remain source-image pixels.',
      openPlan3DUnits: 'Pixels were passed numerically as centimetres so its fixed 5-unit epsilon equals 5 source pixels. No metric calibration was implied.',
      openPlan3DCommit: '98f9cb467e4045c6abc5d9880ada1f03dff50c68',
    },
    sharedInput: { rawSegments: detected.raw.length, fusedSegments: detected.fused.length },
    unfold: {
      candidateRegions: unfoldRooms.map((region) => ({ id: region.id, areaPx2: region.areaPx2, vertices: region.vertices, rasterEvidence: edgeEvidence(region.id, region.vertices) })),
      candidateCount: unfoldRooms.length,
      rejectedFaceCount: unfold.regions.length - unfoldRooms.length,
      intersections: unfold.intersections.length,
      graphCycleRank: countClosedCandidateContours(detected.fused, 6),
      acceptedClosedRoomFaces: unfold.regions.filter((region) => region.eligibility === 'construction_candidate' && region.topologyMethod === 'closed_segment_graph').length,
      validatedHabsRooms: 0,
    },
    openPlan3D: {
      emittedFaceCount: openPlanRooms.length,
      faces: openPlanRooms.map((face, index) => ({
        id: `openplan-face-${index + 1}`,
        areaPx2: Math.abs(face.room.area) * 10_000,
        wallCount: face.room.walls.length,
        vertices: face.polygon,
        rasterEvidence: edgeEvidence(`openplan-face-${index + 1}`, face.polygon),
      })),
      hABsRoomScaleFacesOver100000Px2: openPlanRooms.filter((face) => Math.abs(face.room.area) * 10_000 > 100_000).length,
    },
    interpretation: 'The 100000 px2 scale threshold is a diagnostic size band, not labelled ground truth. Raster edge support is not proof of wall identity. Neither pipeline has accepted HABS room polygons from this run.',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

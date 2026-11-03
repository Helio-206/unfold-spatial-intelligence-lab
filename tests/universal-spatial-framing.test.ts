import { describe, expect, it } from 'vitest';
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { analyzeFrame, verifyFrame } from '../src/universal-spatial/frame-analysis';
import { collectWorldPoints, fitCamera, heroAzimuth, normalizeForPresentation, projectedExtent, SHOT_DIRECTIONS } from '../src/universal-spatial/framing';

function assembly(scale: number): Group {
  const root = new Group();
  const body = new Mesh(new BoxGeometry(4, 1, 1.5), new MeshBasicMaterial()); body.position.set(2, 0.5, 0);
  const mast = new Mesh(new CylinderGeometry(0.1, 0.1, 6, 8), new MeshBasicMaterial()); mast.position.set(0, 3, 0);
  root.add(body, mast); root.scale.setScalar(scale); root.updateMatrixWorld(true); return root;
}
const project = (points: Vector3[], pose: ReturnType<typeof fitCamera>, aspect: number) => projectedExtent(points, pose, aspect);

describe('automatic framing', () => {
  it('fills the viewport by the same fraction at any scale (micro to huge)', () => {
    const fractions = [1e-3, 1, 1e3].map((scale) => {
      const root = assembly(scale), points = collectWorldPoints(root);
      const pose = fitCamera(points, { aspect: 16 / 9, ...SHOT_DIRECTIONS.hero });
      return project(points, pose, 16 / 9);
    });
    for (const extent of fractions) { expect(extent.maxAbsNdc).toBeGreaterThan(0.8); expect(extent.maxAbsNdc).toBeLessThanOrEqual(0.9 + 1e-6); }
    expect(fractions[0]!.maxAbsNdc).toBeCloseTo(fractions[2]!.maxAbsNdc, 3);
  });

  it('never clips in portrait, square or ultra-wide viewports', () => {
    for (const aspect of [0.5, 1, 2.4]) {
      const points = collectWorldPoints(assembly(1)), pose = fitCamera(points, { aspect, ...SHOT_DIRECTIONS.hero });
      expect(projectedExtent(points, pose, aspect).maxAbsNdc).toBeLessThanOrEqual(0.9 + 1e-6);
    }
  });

  it('centres the object on screen', () => {
    const points = collectWorldPoints(assembly(1)), pose = fitCamera(points, { aspect: 1.5, ...SHOT_DIRECTIONS.hero });
    const extent = projectedExtent(points, pose, 1.5);
    expect(Math.abs(extent.centerNdc[0])).toBeLessThan(0.02); expect(Math.abs(extent.centerNdc[1])).toBeLessThan(0.02);
  });

  it('keeps near/far planes proportional to the object, so tiny and huge objects are not clipped by 0.01/1000', () => {
    for (const scale of [1e-3, 1e3]) {
      const points = collectWorldPoints(assembly(scale)), pose = fitCamera(points, { aspect: 1.5, ...SHOT_DIRECTIONS.hero });
      const camera = new PerspectiveCamera(pose.fov, 1.5, pose.near, pose.far); camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld(true);
      const distance = new Vector3(...pose.position).distanceTo(new Vector3(...pose.target));
      expect(pose.near).toBeLessThan(distance * 0.5); expect(pose.far).toBeGreaterThan(distance * 2);
    }
  });

  it('normalises presentation scale without touching the compiled geometry, and sits the object on the floor', () => {
    const root = assembly(1e-3), before = root.scale.x;
    const stage = normalizeForPresentation(root, 4);
    expect(root.scale.x).toBe(before);
    expect(stage.scale).toBeGreaterThan(1);
    const points = collectWorldPoints(stage.wrapper);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0, 5);
    expect(Math.max(...points.map((p) => Math.hypot(p.x, p.y, p.z)))).toBeGreaterThan(0);
  });

  it('turns the hero view toward the side that holds more geometric detail, whichever side that is', () => {
    const build = (detailSign: number) => {
      const root = new Group();
      const body = new Mesh(new CylinderGeometry(1, 1, 8, 12).rotateZ(Math.PI / 2), new MeshBasicMaterial()); root.add(body);
      const detail = new Mesh(new CylinderGeometry(1.2, 1.2, 0.5, 96, 8).rotateZ(Math.PI / 2), new MeshBasicMaterial()); detail.position.x = 4 * detailSign; root.add(detail);
      root.updateMatrixWorld(true); return collectWorldPoints(root);
    };
    for (const sign of [-1, 1]) {
      const azimuth = heroAzimuth(build(sign)), toCamera = Math.cos((azimuth * Math.PI) / 180);
      expect(Math.sign(toCamera)).toBe(sign);
    }
  });

  it('keeps the hero at one of the four diagonal views and is deterministic', () => {
    const points = collectWorldPoints(assembly(1)), a = heroAzimuth(points), b = heroAzimuth(points);
    expect(a).toBe(b); expect([38, 128, 218, 308]).toContain(a);
  });

  it('returns no points for an empty scene instead of NaN poses', () => {
    expect(collectWorldPoints(new Group())).toEqual([]);
    expect(() => fitCamera([], { aspect: 1, ...SHOT_DIRECTIONS.hero })).toThrow('SPATIAL_FRAMING_EMPTY');
  });
});

describe('verified captures', () => {
  const W = 40, H = 20;
  const frame = (fill: (x: number, y: number) => [number, number, number]) => { const data = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fill(x, y); data.set([r, g, b, 255], (y * W + x) * 4); } return { data, width: W, height: H }; };
  const background = frame(() => [20, 24, 28]);

  it('flags an all-black frame as unusable, whatever the reference was', () => {
    const analysis = analyzeFrame(frame(() => [0, 0, 0]), background);
    expect(analysis.uniformBlack).toBe(true);
    expect(verifyFrame(analysis).ok).toBe(false); expect(verifyFrame(analysis).problems).toContain('black');
  });

  it('flags a frame identical to the empty reference as blank', () => {
    const analysis = analyzeFrame(background, background);
    expect(verifyFrame(analysis).problems).toContain('blank');
  });

  it('measures coverage, bounding box and centring from the difference to the reference', () => {
    const content = frame((x, y) => (x >= 10 && x < 30 && y >= 4 && y < 16 ? [200, 120, 60] : [20, 24, 28]));
    const analysis = analyzeFrame(content, background);
    expect(analysis.coverage).toBeCloseTo((20 * 12) / (W * H), 5);
    expect(analysis.bbox).toEqual([10, 4, 29, 15]); expect(analysis.bboxFraction).toBeCloseTo(0.3, 5);
    expect(analysis.touchesEdge).toBe(false); expect(Math.abs(analysis.centerOffset[0])).toBeLessThan(0.03);
    expect(verifyFrame(analysis).ok).toBe(true);
  });

  it('flags objects that are tiny, clipped at the border or far off-centre', () => {
    const tiny = analyzeFrame(frame((x, y) => (x >= 19 && x < 22 && y >= 9 && y < 12 ? [255, 255, 255] : [20, 24, 28])), background);
    expect(verifyFrame(tiny).problems).toContain('too_small');
    const clipped = analyzeFrame(frame((x) => (x < 25 ? [255, 255, 255] : [20, 24, 28])), background);
    expect(verifyFrame(clipped).problems).toContain('clipped');
    const off = analyzeFrame(frame((x, y) => (x >= 30 && x < 38 && y >= 4 && y < 16 ? [255, 255, 255] : [20, 24, 28])), background);
    expect(verifyFrame(off).problems).toContain('off_center');
  });

  it('judges blackness on the frame that is actually presented, and the object on the shadow-free mask', () => {
    const mask = frame((x, y) => (x >= 10 && x < 30 && y >= 4 && y < 16 ? [200, 120, 60] : [20, 24, 28]));
    const presentedBlack = frame(() => [0, 0, 0]);
    const analysis = analyzeFrame(mask, background, presentedBlack);
    expect(analysis.uniformBlack).toBe(true); expect(analysis.coverage).toBeCloseTo((20 * 12) / (W * H), 5);
    expect(verifyFrame(analysis).problems).toEqual(['black']);
    expect(analyzeFrame(mask, background, mask).uniformBlack).toBe(false);
  });

  it('rejects mismatched frame sizes', () => {
    expect(() => analyzeFrame({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, background)).toThrow('SPATIAL_FRAME_SIZE_MISMATCH');
  });
});

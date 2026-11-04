/**
 * Verified captures. A frame is only worth sending to a visual evaluator (a paid call) or showing as proof if it actually contains the object.
 * The PR #23 evaluator was fed `canvas.toDataURL()` from a WebGL context without `preserveDrawingBuffer`, called outside the render task: the buffer
 * had already been cleared and the model correctly reported "a uniformly black render". These functions make that failure detectable before any call.
 *
 * Measurement is a pixel difference against a reference frame of the same view without the object, so a graded backdrop, floor or vignette never
 * counts as object. Everything here is a measurement of pixels: it says nothing about whether the shape is the right one.
 */
export type RgbaFrame = { data: ArrayLike<number>; width: number; height: number };
export type FrameAnalysis = {
  width: number; height: number;
  /** fraction of pixels that differ from the empty reference (the object plus its contact shadow) */
  coverage: number;
  bbox: [number, number, number, number] | null;
  /** bounding-box area / frame area */
  bboxFraction: number;
  /** largest bounding-box side / frame side: what "fills the frame" means to a person */
  extentFraction: number;
  /** bounding-box centre relative to the frame centre, each axis in [-1, 1] */
  centerOffset: [number, number];
  touchesEdge: boolean;
  meanLuma: number;
  uniformBlack: boolean;
};
export type FrameProblem = 'black' | 'blank' | 'too_small' | 'clipped' | 'off_center';
export type FrameVerdict = { ok: boolean; problems: FrameProblem[] };

export const FRAME_THRESHOLDS = { diffSum: 30, blankCoverage: 0.0005, minExtent: 0.35, maxCenterOffset: 0.45, blackChannel: 8, blackFraction: 0.995 } as const;

/**
 * `frame` is the view with the object, `reference` the same view without it. Pass a shadow-free pair so floor shadows do not count as object.
 * `presented` is the frame that will actually be shown or sent (with its shadows); blackness is judged on it, defaulting to `frame`.
 */
export function analyzeFrame(frame: RgbaFrame, reference: RgbaFrame, presented: RgbaFrame = frame): FrameAnalysis {
  const { width, height, data } = frame;
  if (reference.width !== width || reference.height !== height || data.length !== width * height * 4 || reference.data.length !== data.length || presented.data.length !== data.length) throw new Error('SPATIAL_FRAME_SIZE_MISMATCH');
  let count = 0, black = 0, luma = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4, r = data[o]!, g = data[o + 1]!, b = data[o + 2]!;
    luma += (presented.data[o]! + presented.data[o + 1]! + presented.data[o + 2]!) / 3;
    if (Math.max(presented.data[o]!, presented.data[o + 1]!, presented.data[o + 2]!) < FRAME_THRESHOLDS.blackChannel) black++;
    if (Math.abs(r - reference.data[o]!) + Math.abs(g - reference.data[o + 1]!) + Math.abs(b - reference.data[o + 2]!) > FRAME_THRESHOLDS.diffSum) {
      count++; const x = i % width, y = (i - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const total = width * height, bw = maxX - minX + 1, bh = maxY - minY + 1;
  return {
    width, height, coverage: count / total, bbox: count ? [minX, minY, maxX, maxY] : null,
    bboxFraction: count ? (bw * bh) / total : 0, extentFraction: count ? Math.max(bw / width, bh / height) : 0,
    centerOffset: count ? [((minX + maxX + 1) / 2 - width / 2) / (width / 2), ((minY + maxY + 1) / 2 - height / 2) / (height / 2)] : [0, 0],
    touchesEdge: count > 0 && (minX <= 0 || minY <= 0 || maxX >= width - 1 || maxY >= height - 1),
    meanLuma: luma / total, uniformBlack: black / total >= FRAME_THRESHOLDS.blackFraction,
  };
}

export function verifyFrame(analysis: FrameAnalysis): FrameVerdict {
  if (analysis.uniformBlack) return { ok: false, problems: ['black'] };
  if (analysis.coverage < FRAME_THRESHOLDS.blankCoverage) return { ok: false, problems: ['blank'] };
  const problems: FrameProblem[] = [];
  if (analysis.extentFraction < FRAME_THRESHOLDS.minExtent) problems.push('too_small');
  if (analysis.touchesEdge) problems.push('clipped');
  if (Math.max(Math.abs(analysis.centerOffset[0]), Math.abs(analysis.centerOffset[1])) > FRAME_THRESHOLDS.maxCenterOffset) problems.push('off_center');
  return { ok: problems.length === 0, problems };
}

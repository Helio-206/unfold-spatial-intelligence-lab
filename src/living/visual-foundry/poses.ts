/**
 * Pose sources for the display model. Each source says what it is; the workspace shows that label and never upgrades it.
 *
 *  - reference: the fixture's reference configuration (independent Python FK in contracts/fixtures). `poseBasis: reference`.
 *  - fixture-preview: pre-generated frames for one labelled experiment (independent Python FK). NOT engine output.
 *  - engine: frames from the engineering engine. Not connected in this prototype; requesting it reports `unavailable`.
 */
import referenceRaw from '../contracts/fixtures/excavator.reference-pose.json?raw';
import boomPreviewRaw from './fixtures/boom-extension-preview.json?raw';
import { validateMotionFrame, type MotionFrame } from '../contracts';
import type { PartPose } from './excavator/build';

export type PoseSourceKind = 'reference' | 'fixture-preview' | 'engine';

export type FixturePreview = {
  kind: 'unfold.visual-foundry.fixture-preview';
  id: string; label: string; origin: 'fixture'; validation: 'unreviewed'; producedBy: string; notEngineOutput: true;
  actuatorId: string; strokeFromM: number; strokeToM: number; frames: MotionFrame[];
};

export function referencePoses(): { kind: 'reference'; poses: PartPose[]; tipM: [number, number, number] } {
  const raw = JSON.parse(referenceRaw) as { tip: [number, number, number]; parts: PartPose[] };
  return { kind: 'reference', poses: raw.parts, tipM: raw.tip };
}

/** Loads and validates a fixture preview; every frame must pass `validateMotionFrame` and carry the fixture warning. */
export function loadFixturePreview(raw: string = boomPreviewRaw): FixturePreview {
  const doc = JSON.parse(raw) as FixturePreview;
  if (doc.kind !== 'unfold.visual-foundry.fixture-preview' || doc.origin !== 'fixture' || doc.notEngineOutput !== true) throw new Error('FOUNDRY_PREVIEW_NOT_A_FIXTURE');
  doc.frames.forEach((frame, i) => {
    const v = validateMotionFrame(frame);
    if (!v.ok) throw new Error(`FOUNDRY_PREVIEW_INVALID_FRAME:${i}:${v.issues[0]?.path}`);
    if (!frame.warnings.some((w) => w.code === 'FIXTURE_NOT_ENGINE')) throw new Error(`FOUNDRY_PREVIEW_UNLABELLED_FRAME:${i}`);
  });
  return doc;
}

export const framePoses = (frame: MotionFrame): PartPose[] => frame.parts.map((p) => ({ partId: p.partId, translationM: p.translationM, rotation: p.rotation }));

/** The engine is not part of this prototype. The answer is always explicit. */
export function engineSource(): { kind: 'engine'; status: 'unavailable'; reason: string } {
  return { kind: 'engine', status: 'unavailable', reason: 'O motor de engenharia não está ligado a este protótipo.' };
}

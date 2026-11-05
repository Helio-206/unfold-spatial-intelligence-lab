import { BufferGeometry, Matrix4, Vector3 } from 'three';
import type { PartContext } from './types';
import type { ParamSpec, Known } from '../recipe';
import { at } from '../ops';

export const num = (ctx: PartContext, key: string, fallback: number) => { const v = ctx.params[key]; return typeof v === 'number' ? v : fallback; };
export const str = (ctx: PartContext, key: string, fallback: string) => { const v = ctx.params[key]; return typeof v === 'string' ? v : fallback; };
export const flag = (ctx: PartContext, key: string, fallback: boolean) => { const v = ctx.params[key]; return typeof v === 'boolean' ? v : fallback; };
export const numSpec = (key: string, label: string, min: number, max: number, def: number, step: number, doc: string, known: Known = 'inferred'): ParamSpec => ({ key, label, type: 'number', min, max, step, default: def, doc, known });
export const choiceSpec = (key: string, label: string, options: string[], def: string, doc: string, known: Known = 'inferred'): ParamSpec => ({ key, label, type: 'choice', options, default: def, doc, known });
export const boolSpec = (key: string, label: string, def: boolean, doc: string, known: Known = 'inferred'): ParamSpec => ({ key, label, type: 'boolean', default: def, doc, known });

/**
 * A canonical frame for a part: builders model with the LONG horizontal axis along +X, height along +Y and width along +Z, in a box of L x H x W centred on the
 * origin; `place` carries that model into the part's own local box (rotating a quarter turn when the plan has the long side along Z).
 */
export type Frame = { L: number; H: number; W: number; place: Matrix4; swapped: boolean };
export function frameOf(ctx: PartContext, longest = false): Frame {
  if (longest || ctx.role === 'handle' && false) {
    const { x, y, z } = ctx.size; const c = new Matrix4().makeTranslation(ctx.centre.x, ctx.centre.y, ctx.centre.z);
    if (y >= x && y >= z) return { L: y, H: x, W: z, place: c.multiply(new Matrix4().makeRotationZ(Math.PI / 2)), swapped: false };
    if (z > x) return { L: z, H: y, W: x, place: c.multiply(new Matrix4().makeRotationY(Math.PI / 2)), swapped: true };
    return { L: x, H: y, W: z, place: c, swapped: false };
  }
  const swapped = ctx.size.z > ctx.size.x * 1.0001;
  const L = swapped ? ctx.size.z : ctx.size.x, W = swapped ? ctx.size.x : ctx.size.z, H = ctx.size.y;
  const place = new Matrix4().makeTranslation(ctx.centre.x, ctx.centre.y, ctx.centre.z).multiply(swapped ? new Matrix4().makeRotationY(Math.PI / 2) : new Matrix4());
  return { L, H, W, place, swapped };
}
/** A point of the object frame expressed in the canonical frame of this part. */
export function toFrame(ctx: PartContext, f: Frame, p: Vector3): Vector3 {
  const local = p.clone().applyMatrix4(ctx.toLocal).sub(ctx.centre);
  return f.swapped ? new Vector3(local.z, local.y, -local.x) : local;
}
export const place = (g: BufferGeometry, f: Frame): BufferGeometry => g.applyMatrix4(f.place);
export const placeAt = (f: Frame, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Matrix4 => f.place.clone().multiply(at(x, y, z, rx, ry, rz));

/** Which local axis is the thinnest (the axle of a wheel, the thickness of a plate). */
export const thinAxis = (ctx: PartContext): 'x' | 'y' | 'z' => { const { x, y, z } = ctx.size; return x <= y && x <= z ? 'x' : y <= z ? 'y' : 'z'; };
export const wordHit = (re: RegExp, text: string) => re.test(text.toLowerCase());

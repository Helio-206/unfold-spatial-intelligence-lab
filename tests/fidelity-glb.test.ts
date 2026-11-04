import { describe, expect, it } from 'vitest';
import { validateGlb } from '../src/universal-spatial/fidelity/glb';
import { DEFAULT_ROUTER_LIMITS } from '../src/universal-spatial/fidelity/types';

const limits = DEFAULT_ROUTER_LIMITS;
const pad = (data: Uint8Array, fill: number) => { const n = (4 - (data.length % 4)) % 4; const out = new Uint8Array(data.length + n).fill(fill); out.set(data); return out; };
function glb(json: object, bin: Uint8Array = new Uint8Array(0)): Uint8Array {
  const j = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20), b = pad(bin, 0), total = 12 + 8 + j.length + (b.length ? 8 + b.length : 0), out = new Uint8Array(total), v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true); v.setUint32(12, j.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(j, 20);
  if (b.length) { v.setUint32(20 + j.length, b.length, true); v.setUint32(24 + j.length, 0x004e4942, true); out.set(b, 28 + j.length); }
  return out;
}
// one triangle: 3 positions (float32 VEC3) in the binary chunk
const triangleBin = () => { const f = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); return new Uint8Array(f.buffer); };
const triangle = (extra: object = {}) => ({ asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0, name: 'Part' }], scenes: [{ nodes: [0] }], scene: 0, ...extra });
const png = (w: number, h: number) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const v = new DataView(b.buffer); v.setUint32(8, 13); b.set([0x49, 0x48, 0x44, 0x52], 12); v.setUint32(16, w); v.setUint32(20, h); return b; };

describe('GLB intake is fail-closed', () => {
  it('accepts a minimal valid asset and reports what it measured', () => {
    const verdict = validateGlb(glb(triangle(), triangleBin()), limits); expect(verdict.ok).toBe(true);
    if (verdict.ok) { expect(verdict.info.triangles).toBe(1); expect(verdict.info.nodes).toBe(1); expect(verdict.info.nodeNames).toEqual(['Part']); }
  });

  it('refuses anything that is not a well-formed GLB', () => {
    const good = glb(triangle(), triangleBin()), code = (b: Uint8Array) => { const v = validateGlb(b, limits); return v.ok ? 'OK' : v.code; };
    expect(code(new Uint8Array(8))).toBe('NOT_GLB'); expect(code(new TextEncoder().encode('<html>not a model at all, just text content here</html>'))).toBe('NOT_GLB');
    const wrongLength = good.slice(); new DataView(wrongLength.buffer).setUint32(8, good.length + 4, true); expect(code(wrongLength)).toBe('BAD_CONTAINER');
    const wrongVersion = good.slice(); new DataView(wrongVersion.buffer).setUint32(4, 1, true); expect(code(wrongVersion)).toBe('BAD_VERSION');
    expect(code(glb({ asset: { version: '1.0' } }))).toBe('BAD_VERSION');
  });

  it('refuses oversized files before reading them', () => {
    expect(validateGlb(glb(triangle(), triangleBin()), { ...limits, maxAssetBytes: 64 })).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });

  it('refuses extensions outside the allowlist (Draco included) and any external or non-embedded data', () => {
    const code = (b: Uint8Array) => { const v = validateGlb(b, limits); return v.ok ? 'OK' : v.code; };
    expect(code(glb(triangle({ extensionsUsed: ['KHR_draco_mesh_compression'] }), triangleBin()))).toBe('EXTENSION_NOT_ALLOWED');
    expect(code(glb(triangle({ extensionsRequired: ['EXT_unknown'] }), triangleBin()))).toBe('EXTENSION_NOT_ALLOWED');
    expect(code(glb(triangle({ buffers: [{ byteLength: 36, uri: 'https://example.com/x.bin' }] }), triangleBin()))).toBe('EXTERNAL_DATA');
    expect(code(glb(triangle({ buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,AAAA' }] }), triangleBin()))).toBe('EXTERNAL_DATA');
    expect(code(glb(triangle({ images: [{ uri: 'tex.png' }] }), triangleBin()))).toBe('EXTERNAL_DATA');
    expect(code(glb(triangle(), triangleBin()))).toBe('OK');
  });

  it('refuses accessors that point outside their buffer view, and counts that exceed the limits', () => {
    const code = (b: Uint8Array, l = limits) => { const v = validateGlb(b, l); return v.ok ? 'OK' : v.code; };
    expect(code(glb(triangle({ accessors: [{ bufferView: 0, componentType: 5126, count: 300, type: 'VEC3' }] }), triangleBin()))).toBe('BAD_ACCESSOR');
    expect(code(glb(triangle({ bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 9999 }] }), triangleBin()))).toBe('BAD_ACCESSOR');
    expect(code(glb(triangle({ accessors: [{ bufferView: 0, componentType: 9999, count: 3, type: 'VEC3' }] }), triangleBin()))).toBe('BAD_ACCESSOR');
    expect(code(glb(triangle(), triangleBin()), { ...limits, maxAssetNodes: 0 })).toBe('TOO_MANY_NODES');
    expect(code(glb(triangle(), triangleBin()), { ...limits, maxAssetTriangles: 0 })).toBe('TOO_MANY_TRIANGLES');
  });

  it('reads texture sizes from the image headers and refuses large or unreadable ones', () => {
    const withImage = (img: Uint8Array) => { const bin = new Uint8Array(36 + img.length + ((4 - (img.length % 4)) % 4)); bin.set(triangleBin()); bin.set(img, 36); return glb(triangle({ buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: img.length }], images: [{ bufferView: 1, mimeType: 'image/png' }] }), bin); };
    const code = (b: Uint8Array) => { const v = validateGlb(b, limits); return v.ok ? 'OK' : v.code; };
    expect(code(withImage(png(512, 512)))).toBe('OK'); expect(code(withImage(png(4096, 4096)))).toBe('TEXTURE_TOO_LARGE'); expect(code(withImage(new Uint8Array(40).fill(7)))).toBe('IMAGE_DIMENSIONS_UNKNOWN');
    const ok = validateGlb(withImage(png(1024, 1024)), limits); expect(ok.ok && ok.info.textureBytes).toBe(Math.round(1024 * 1024 * 4 * (4 / 3)));
    const tight = validateGlb(withImage(png(1024, 1024)), { ...limits, maxTextureBytes: 1_000_000 }); expect(tight).toMatchObject({ ok: false, code: 'TEXTURES_TOO_HEAVY' });
  });

  it('accepts a heavy texture set only when a declared downscale brings it under the memory budget', () => {
    const withImage = (w: number, h: number) => { const img = png(w, h), bin = new Uint8Array(36 + img.length + ((4 - (img.length % 4)) % 4)); bin.set(triangleBin()); bin.set(img, 36); return glb(triangle({ buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: img.length }], images: [{ bufferView: 1, mimeType: 'image/png' }] }), bin); };
    const heavy = { ...limits, maxTextureSide: 4096, maxTextureBytes: 8_000_000 };
    expect(validateGlb(withImage(2048, 2048), heavy)).toMatchObject({ ok: false, code: 'TEXTURES_TOO_HEAVY' });
    const down = validateGlb(withImage(2048, 2048), heavy, { downscaleTo: 1024 }); expect(down.ok).toBe(true);
    if (down.ok) { expect(down.info.textureBytes).toBe(Math.round(1024 * 1024 * 4 * (4 / 3))); expect(down.info.downscaledTo).toBe(1024); }
    expect(validateGlb(withImage(8192, 8192), heavy, { downscaleTo: 1024 })).toMatchObject({ ok: false, code: 'TEXTURE_TOO_LARGE' }); // hard decode-safety cap
    expect(validateGlb(withImage(2048, 2048), { ...heavy, maxTextureBytes: 1_000_000 }, { downscaleTo: 1024 })).toMatchObject({ ok: false, code: 'TEXTURES_TOO_HEAVY' });
  });

  it('never throws on hostile input: random and corrupted bytes always yield a verdict', () => {
    let seed = 99; const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const base = glb(triangle(), triangleBin());
    for (let n = 0; n < 400; n++) {
      const bytes = rand() < 0.3 ? Uint8Array.from({ length: Math.floor(rand() * 300) }, () => Math.floor(rand() * 256)) : base.map((b) => (rand() < 0.04 ? Math.floor(rand() * 256) : b));
      const verdict = validateGlb(bytes, limits); expect(typeof verdict.ok).toBe('boolean');
    }
  });
});

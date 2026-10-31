import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, validateImageDataUrl } from '../src/image-input';
import { parseMechanicalObservationText } from '../src/image-understanding';

const jpeg = 'data:image/jpeg;base64,/9j/4AA=';
const png = 'data:image/png;base64,iVBORw0KGgo=';

describe('image understanding input', () => {
  it('accepts JPEG and PNG signatures', () => {
    expect(validateImageDataUrl(jpeg)).toMatchObject({ mimeType: 'image/jpeg', byteLength: 5 });
    expect(validateImageDataUrl(png)).toMatchObject({ mimeType: 'image/png', byteLength: 8 });
  });

  it.each([
    ['missing value', undefined],
    ['unsupported MIME', 'data:image/webp;base64,UklGRg=='],
    ['wrong JPEG signature', 'data:image/jpeg;base64,ZmFrZQ=='],
    ['wrong PNG signature', 'data:image/png;base64,ZmFrZQ=='],
  ])('rejects %s', (_label, value) => {
    expect(() => validateImageDataUrl(value)).toThrow();
  });

  it('rejects an image above the decoded processing limit', () => {
    const oversized = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_IMAGE_BYTES)]).toString('base64')}`;
    expect(() => validateImageDataUrl(oversized)).toThrow('limite');
  });

  it('requires the complete observed-only response contract', () => {
    expect(parseMechanicalObservationText('```json\n{"elements":[],"connections":[],"dimensions":[],"ambiguities":["axis unclear"],"missingInformation":["dimensions"]}\n```')).toMatchObject({ ambiguities: ['axis unclear'] });
    expect(() => parseMechanicalObservationText('{"elements":[]}')).toThrow('incompleto');
    expect(() => parseMechanicalObservationText('not json')).toThrow('JSON parseável');
  });
});

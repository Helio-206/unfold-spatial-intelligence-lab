import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, validateImageDataUrl } from '../src/image-input';
import { parseMechanicalObservationText } from '../src/image-understanding';

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYxLjMuMTAwAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEsAAQEAAAAAAAAAAAAAAAAAAAAHAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgACAAIAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8Av4AP/9k=';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC';

describe('image understanding input', () => {
  it('accepts complete JPEG and PNG test fixtures', () => {
    expect(validateImageDataUrl(jpeg)).toMatchObject({ mimeType: 'image/jpeg' });
    expect(validateImageDataUrl(png)).toMatchObject({ mimeType: 'image/png' });
  });

  it('rejects signature-only and truncated image payloads', () => {
    expect(() => validateImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toThrow();
    expect(() => validateImageDataUrl('data:image/jpeg;base64,/9j/4AA=')).toThrow();
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

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { requestMetaImageText } from '../src/meta';
import { readImageFileAsDataUrl } from '../src/image-input';
import { MECHANICAL_IMAGE_PROMPT, parseMechanicalObservationText } from '../src/image-understanding';

const IMAGE_PATH = resolve(process.cwd(), 'input/mechanism-four-bar.jpg');

if (!existsSync(IMAGE_PATH)) {
  console.error(JSON.stringify({ status: 'BLOCKED_INPUT', reason: 'REAL_IMAGE_MISSING', expectedPath: IMAGE_PATH }));
  process.exitCode = 2;
} else if (!process.env.MODEL_API_KEY) {
  console.error(JSON.stringify({ status: 'BLOCKED_INPUT', reason: 'MODEL_API_KEY_MISSING', expectedPath: IMAGE_PATH }));
  process.exitCode = 2;
} else {
  const image = readImageFileAsDataUrl(IMAGE_PATH);
  const result = await requestMetaImageText(image.dataUrl, MECHANICAL_IMAGE_PROMPT, process.env.MODEL_API_KEY);
  const observation = parseMechanicalObservationText(result.text);
  console.log(JSON.stringify({ status: 'PASS', image: { path: IMAGE_PATH, mimeType: image.mimeType, byteLength: image.byteLength }, observation, meta: result.log }));
}

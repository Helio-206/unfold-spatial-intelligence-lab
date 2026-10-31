import { requestMetaText } from '../src/meta';

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) {
  console.error('BLOCKED: MODEL_API_KEY ausente. Configure-a no shell do backend e execute novamente.');
  process.exitCode = 2;
} else {
  const result = await requestMetaText('Reply with exactly: UNFOLD_META_PROBE_OK', apiKey);
  console.log(JSON.stringify({ text: result.text, meta: result.log }));
}

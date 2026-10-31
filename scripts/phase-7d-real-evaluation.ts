import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requestMetaStructuredImage } from '../src/meta';
import { TECHNICAL_DOCUMENT_JSON_SCHEMA, buildTechnicalDocumentPrompt, parseTechnicalDocumentText, technicalAdapters } from '../src/technical-document';
import { validateImageDataUrl } from '../src/image-input';

const root = resolve(import.meta.dirname, '..');
const cases = [
  { id: 'residential-floorplan', source: '/tmp/codex-clipboard-c3cb2657-3e2d-4e21-b4a3-0e0c292dfe03.png', category: 'architecture' },
  { id: 'electrical-installation-plan', source: '/tmp/codex-clipboard-44cb8f57-d072-4062-b7f4-51fb49a1c927.png', category: 'electrical_installation' },
  { id: 'paderborn-linkage', source: 'input/mechanism-paderborn.jpg', category: 'mechanical' },
];
const outDir = resolve(root, 'reports/multimodal-core/real');
mkdirSync(outDir, { recursive: true });
const evaluationPath = resolve(outDir, 'evaluation.json');
let prior: { callsAttempted?: number; calls?: Array<{ caseId?: string; status?: string }> } = {};
try { prior = JSON.parse(readFileSync(evaluationPath, 'utf8')) as typeof prior; } catch { /* first run */ }
const requested = (process.env.UNFOLD_REAL_CASES ?? cases.map((item) => item.id).join(',')).split(',').map((id) => id.trim()).filter(Boolean);
const explicitRepeat = new Set((process.env.UNFOLD_REAL_REPEAT_CASES ?? '').split(',').map((id) => id.trim()).filter(Boolean));
const selectedCases = cases.filter((item) => requested.includes(item.id));
const priorCalls = prior.calls ?? [];

if (!process.env.MODEL_API_KEY) {
  writeFileSync(evaluationPath, JSON.stringify({ status: 'BLOCKED', reason: 'MODEL_API_KEY não está disponível no processo. Nenhuma chamada realizada.', calls: priorCalls }, null, 2));
  process.exitCode = 2;
} else {
  const records = [];
  for (const item of selectedCases) {
    const priorForCase = priorCalls.filter((record) => record.caseId === item.id);
    if (priorForCase.length && !explicitRepeat.has(item.id)) continue;
    if ((prior.callsAttempted ?? priorCalls.length) + records.length >= 4) break;
    const attempt = priorForCase.length + 1;
    const imagePath = resolve(root, item.source);
    try {
      const bytes = readFileSync(imagePath);
      const mimeType = imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
      const image = validateImageDataUrl(`data:${mimeType};base64,${bytes.toString('base64')}`);
      const result = await requestMetaStructuredImage(image.dataUrl, buildTechnicalDocumentPrompt(), process.env.MODEL_API_KEY, TECHNICAL_DOCUMENT_JSON_SCHEMA as unknown as Record<string, unknown>, fetch, 7_000);
      const document = parseTechnicalDocumentText(result.text);
      document.capabilities = technicalAdapters(document.primaryDomain, document);
      const record = {
        caseId: item.id, attempt,
        sourceId: item.source,
        expectedDomainForComparisonOnly: item.category,
        image: { mimeType: image.mimeType, bytes: image.byteLength },
        meta: result.log,
        validation: { schema: 'valid', primaryDomain: document.primaryDomain, domainAgreement: document.primaryDomain === item.category },
        document,
        rawStructuredOutput: result.text,
      };
      writeFileSync(resolve(outDir, `${item.id}-attempt-${String(attempt).padStart(2, '0')}.json`), JSON.stringify(record, null, 2));
      records.push({ caseId: item.id, attempt, sourceId: item.source, primaryDomain: document.primaryDomain, domainAgreement: document.primaryDomain === item.category, status: 'valid', meta: result.log, elementCount: document.elements.length, relationCount: document.relations.length, ambiguityCount: document.ambiguities.length, missingCount: document.missingInformation.length });
    } catch (error) {
      const meta = error && typeof error === 'object' && 'log' in error ? (error as { log: unknown }).log : undefined;
      const record = { caseId: item.id, attempt, sourceId: item.source, expectedDomainForComparisonOnly: item.category, status: 'failed', error: error instanceof Error ? error.message : 'Falha não identificada.', meta };
      writeFileSync(resolve(outDir, `${item.id}-attempt-${String(attempt).padStart(2, '0')}.json`), JSON.stringify(record, null, 2));
      records.push(record);
      break;
    }
  }
  const allCalls = [...priorCalls, ...records];
  const validUniqueCases = new Set(allCalls.filter((item) => item.status === 'valid').map((item) => item.caseId));
  const output = { status: ['residential-floorplan', 'electrical-installation-plan', 'paderborn-linkage'].every((id) => validUniqueCases.has(id)) ? 'COMPLETED' : 'PARTIAL', callsAttempted: (prior.callsAttempted ?? priorCalls.length) + records.length, callsLimit: 4, automaticRetries: 0, calls: allCalls };
  writeFileSync(evaluationPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

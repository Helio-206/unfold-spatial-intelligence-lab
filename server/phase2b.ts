import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { requestMetaImageText, validateMechanicalObservation, type MechanicalObservation, type MetaCallLog } from '../src/meta';
import { applyReviewDraft, normalizeMechanicalObservation, validateMechanicalGraph, validateReviewActions, type MechanicalGraphSource, type ReviewAction } from '../src/mechanical-graph';

const ROOT = resolve(process.cwd());
const REPORT_ROOT = resolve(ROOT, 'reports/phase-2b');
const RAW_ROOT = resolve(REPORT_ROOT, 'raw');
const NORMALIZED_ROOT = resolve(REPORT_ROOT, 'normalized');
const DRAFT_ROOT = resolve(REPORT_ROOT, 'drafted');
const REVIEW_PLAN_PATH = resolve(REPORT_ROOT, 'review-plan.json');
const MAX_IMAGE_BYTES = 50_000_000;
const MIME_BY_EXTENSION: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const CASES: MechanicalGraphSource[] = [
  {
    caseId: 'bennett',
    imagePath: resolve(ROOT, 'input/mechanism-four-bar.jpg'),
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Bennett_four-bar_linkage.jpg',
    title: 'Bennett four-bar linkage',
  },
  {
    caseId: 'paderborn',
    imagePath: resolve(ROOT, 'input/mechanism-paderborn.jpg'),
    sourceUrl: 'https://mb.uni-paderborn.de/en/ldm/lehre/pojektseminar',
    title: 'Vier-Gelenkkette — Dynamics and Mechatronics, Paderborn University',
  },
  {
    caseId: 'wooden',
    imagePath: resolve(ROOT, 'input/mechanism-wooden.jpg'),
    sourceUrl: 'https://fabacademy.org/2024/labs/waag/students/leo-kuipers/weekly-assignments/10_mechanical-design_machine-design/10_4_group-assignment-mechanical-movement/',
    title: 'Wooden four-bar linkage prototype',
  },
  {
    caseId: 'tchebyshev',
    imagePath: resolve(ROOT, 'input/mechanism-tchebyshev.jpg'),
    sourceUrl: 'https://en.tcheb.ru/four-bar-reversing-mechanism/',
    title: 'Tchebyshev four-bar reversing mechanism',
  },
];

const PROMPT = `Analyse esta imagem mecânica real e responde apenas com JSON válido com exactamente os campos elements, connections, dimensions, ambiguities e missingInformation. Em elements regista apenas objectos visíveis como bar, joint ou fixed, com id, kind, label, observed=true, evidence e confidence numérica entre 0 e 1. Em connections regista apenas ligações visíveis entre IDs observados, com from, to, relation, observed=true e evidence. Em dimensions inclui apenas dimensões explicitamente escritas ou marcadas. Não atribuas a uma barra um papel ontológico como link, shaft, handle ou coupler; não infiras peças ocultas, medidas, materiais, comprimentos, graus de liberdade ou relações não visíveis. Coloca tudo o que não puder ser confirmado em ambiguities ou missingInformation.`;

function ensureOutputDirectories(): void {
  mkdirSync(RAW_ROOT, { recursive: true });
  mkdirSync(NORMALIZED_ROOT, { recursive: true });
  mkdirSync(DRAFT_ROOT, { recursive: true });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function parseObservation(text: string): MechanicalObservation {
  const clean = text.replace(/^```json\s*|\s*```$/g, '').trim();
  return validateMechanicalObservation(JSON.parse(clean) as unknown);
}

function imageDataUrl(source: MechanicalGraphSource): string {
  if (!existsSync(source.imagePath)) throw new Error(`Imagem ausente: ${source.imagePath}`);
  const extension = extname(source.imagePath).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) throw new Error(`Formato não suportado: ${extension}.`);
  const size = readFileSync(source.imagePath).byteLength;
  if (size === 0 || size > MAX_IMAGE_BYTES) throw new Error(`Imagem vazia ou superior a 50 MB: ${source.imagePath}.`);
  return `data:${mime};base64,${readFileSync(source.imagePath).toString('base64')}`;
}

async function collect(): Promise<void> {
  ensureOutputDirectories();
  if (CASES.some((source) => existsSync(resolve(RAW_ROOT, `${source.caseId}.json`)))) {
    throw new Error('Recolha já existente. Preserve o output cru e execute apenas a revisão local.');
  }
  if (!process.env.MODEL_API_KEY) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'MODEL_API_KEY_MISSING' }));
    process.exitCode = 2;
    return;
  }

  const collected: Array<{ caseId: string; meta: MetaCallLog }> = [];
  for (const source of CASES) {
    const result = await requestMetaImageText(imageDataUrl(source), PROMPT, process.env.MODEL_API_KEY);
    const observation = parseObservation(result.text);
    writeJson(resolve(RAW_ROOT, `${source.caseId}.json`), { source, observation, meta: result.log });
    collected.push({ caseId: source.caseId, meta: result.log });
    console.log(JSON.stringify({ status: 'PASS', caseId: source.caseId, httpStatus: result.log.httpStatus, latencyMs: result.log.latencyMs, usage: result.log.usage, requestId: result.log.requestId }));
  }
  writeJson(resolve(REPORT_ROOT, 'collection.json'), { cases: collected });
}

type RawCase = { source: MechanicalGraphSource; observation: MechanicalObservation; meta: MetaCallLog };

function countBy<T extends { provenance: string }>(items: T[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.provenance] = (counts[item.provenance] ?? 0) + 1;
    return counts;
  }, {});
}

function reviewPlan(): Record<string, ReviewAction[]> {
  if (!existsSync(REVIEW_PLAN_PATH)) throw new Error(`Plano de revisão ausente: ${REVIEW_PLAN_PATH}.`);
  const value = readJson(REVIEW_PLAN_PATH);
  if (!value || typeof value !== 'object') throw new Error('Plano de revisão deve ser um objecto por caseId.');
  return Object.fromEntries(Object.entries(value).map(([caseId, actions]) => [caseId, validateReviewActions(actions)]));
}

function review(): void {
  ensureOutputDirectories();
  const plan = reviewPlan();
  const summaries: Array<Record<string, unknown>> = [];
  for (const source of CASES) {
    const rawPath = resolve(RAW_ROOT, `${source.caseId}.json`);
    if (!existsSync(rawPath)) throw new Error(`Output cru ausente: ${rawPath}.`);
    const raw = readJson(rawPath) as RawCase;
    const normalized = validateMechanicalGraph(normalizeMechanicalObservation(raw.observation, raw.source));
    const drafted = applyReviewDraft(normalized, plan[source.caseId] ?? []);
    writeJson(resolve(NORMALIZED_ROOT, `${source.caseId}.json`), normalized);
    writeJson(resolve(DRAFT_ROOT, `${source.caseId}.json`), drafted);
    summaries.push({
      caseId: source.caseId,
      raw: { elements: raw.observation.elements.length, connections: raw.observation.connections.length, dimensions: raw.observation.dimensions.length },
      normalized: { nodes: normalized.nodes.length, connections: normalized.connections.length, provenance: { nodes: countBy(normalized.nodes), connections: countBy(normalized.connections) } },
      draft: { nodes: drafted.nodes.length, connections: drafted.connections.length, actions: drafted.review.proposedActions.length, provenance: { nodes: countBy(drafted.nodes), connections: countBy(drafted.connections) } },
      meta: raw.meta,
    });
  }

  const recurringErrors = [
    'A classificação crua bar não distingue link, shaft, handle, coupler ou disc.',
    'Blocos e abraçadeiras visíveis podem ser confundidos com juntas cinemáticas.',
    'Contacto visual não prova uma ligação mecânica nem o papel de suporte fixo.',
    'Dimensões não devem ser criadas quando a imagem não tem marcações explícitas.',
  ];
  const report = [
    '# UNFOLD — PHASE 2B report',
    '',
    'Quatro imagens mecânicas reais foram processadas. O output cru foi preservado antes da normalização; as classificações da fase anterior são propostas e permanecem pending até confirmação humana.',
    '',
    '| Caso | Cru | Normalizado | Draft pending |',
    '|---|---:|---:|---:|',
    ...summaries.map((summary) => `| ${summary.caseId} | ${JSON.stringify(summary.raw)} | ${JSON.stringify(summary.normalized)} | ${JSON.stringify(summary.draft)} |`),
    '',
    '## Erros recorrentes',
    '',
    ...recurringErrors.map((error) => `- ${error}`),
    '',
    '## Limites',
    '',
    '- Não foram geradas geometrias, simulações ou soluções cinemáticas.',
    '- `inferred` permanece separado de `observed`; `ambiguous` não é promovido automaticamente.',
    '- O resultado revisto é uma representação documental, não um contrato geométrico.',
    '',
    'Veredicto: `CONDITIONAL` — o pipeline e as invariantes foram executados nos quatro casos, mas a classificação mecânica continua dependente de revisão humana e não autoriza geometria ou simulação.',
    '',
  ].join('\n');
  writeFileSync(resolve(REPORT_ROOT, 'report.md'), report, 'utf8');
  writeJson(resolve(REPORT_ROOT, 'summary.json'), { status: 'CONDITIONAL', cases: summaries, recurringErrors });
  console.log(JSON.stringify({ status: 'PASS', cases: summaries.length, report: resolve(REPORT_ROOT, 'report.md') }));
}

const mode = process.argv[2];
if (mode === 'collect') await collect();
else if (mode === 'review') review();
else throw new Error('Use `collect` ou `review`.');

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateMechanicalObservation, type MechanicalObservation } from '../src/meta';
import { applyReviewDraft, confirmHumanReview, normalizeMechanicalObservation, type HumanConfirmation, type MechanicalGraphSource, type ReviewAction } from '../src/mechanical-graph';

const ROOT = resolve(process.cwd());
const REPORT_ROOT = resolve(ROOT, 'reports/phase-2d');
const RAW_PATH = resolve(ROOT, 'reports/phase-2b/raw/paderborn.json');
const PREVIOUS_GRAPH_PATH = resolve(ROOT, 'reports/phase-2b/reviewed/paderborn.json');
const DRAFT_PATH = resolve(REPORT_ROOT, 'paderborn-draft.json');
const PACKAGE_PATH = resolve(REPORT_ROOT, 'paderborn-review-package.json');
const VISUAL_REVIEW_PATH = resolve(REPORT_ROOT, 'paderborn-visual-review.md');
const CONFIRMATION_PATH = resolve(REPORT_ROOT, 'paderborn-human-confirmation.json');
const VERIFIED_PATH = resolve(REPORT_ROOT, 'paderborn-verified.json');
const HISTORY_PATH = resolve(REPORT_ROOT, 'paderborn-history.json');
const IMAGE_PATH = resolve(ROOT, 'input/mechanism-paderborn.jpg');

const PROPOSED_ACTIONS: ReviewAction[] = [
  { action: 'correct_kind', nodeId: 'node-1-b1', kind: 'support', note: 'Candidato a ground: barra escura horizontal, fixação não confirmada.' },
  { action: 'correct_kind', nodeId: 'node-2-b2', kind: 'link', note: 'Barra clara inclinada visualmente compatível com link.' },
  { action: 'correct_kind', nodeId: 'node-3-b3', kind: 'link', note: 'Barra clara diagonal visualmente compatível com link.' },
  { action: 'mark_uncertain', target: 'node', id: 'node-4-b4', note: 'Terminal direito: link, suporte ou terminal não distinguíveis pela fotografia.' },
  { action: 'mark_uncertain', target: 'node', id: 'node-5-j1', note: 'Junta visível, subtipo e eixo não confirmáveis.' },
  { action: 'mark_uncertain', target: 'node', id: 'node-6-j2', note: 'Junta visível, subtipo e eixo não confirmáveis.' },
  { action: 'mark_uncertain', target: 'node', id: 'node-7-j3', note: 'Junta visível, subtipo e eixo não confirmáveis.' },
  { action: 'approve', target: 'connection', id: 'connection-1' },
  { action: 'approve', target: 'connection', id: 'connection-2' },
  { action: 'approve', target: 'connection', id: 'connection-3' },
  { action: 'approve', target: 'connection', id: 'connection-4' },
  { action: 'approve', target: 'connection', id: 'connection-5' },
  { action: 'mark_uncertain', target: 'connection', id: 'connection-6', note: 'Ligação ao terminal direito visível como contacto, mas papel cinemático não confirmável.' },
];

type RawCase = { source: MechanicalGraphSource; observation: MechanicalObservation; meta: unknown };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function prepare(): void {
  mkdirSync(REPORT_ROOT, { recursive: true });
  if (!existsSync(RAW_PATH) || !existsSync(PREVIOUS_GRAPH_PATH) || !existsSync(IMAGE_PATH)) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'PADERBORN_INPUTS_MISSING' }));
    process.exitCode = 2;
    return;
  }
  const raw = readJson<RawCase>(RAW_PATH);
  const observation = validateMechanicalObservation(raw.observation);
  const normalized = normalizeMechanicalObservation(observation, raw.source);
  const draft = applyReviewDraft(normalized, PROPOSED_ACTIONS);
  const sourceHash = sha256(IMAGE_PATH);
  const previousHash = sha256(PREVIOUS_GRAPH_PATH);

  const packageValue = {
    schema: 'unfold.phase2d.paderborn.review_package.v1',
    caseId: 'paderborn',
    image: { path: IMAGE_PATH, sha256: sourceHash, sourceUrl: raw.source.sourceUrl, title: raw.source.title },
    previousVersion: {
      path: PREVIOUS_GRAPH_PATH,
      sha256: previousHash,
      status: 'legacy_complete_not_human_verified',
      preserved: true,
    },
    rawObservation: observation,
    proposedComponents: observation.elements.map((element, index) => ({
      sourceId: element.id,
      nodeId: `node-${index + 1}-${element.id}`,
      rawKind: element.kind,
      label: element.label,
      evidence: element.evidence,
      proposedKind: index === 0 ? 'support' : index === 1 || index === 2 ? 'link' : index === 3 ? 'unknown' : 'joint',
      jointType: index >= 4 ? 'unknown' : null,
      status: 'pending',
    })),
    proposedConnections: observation.connections.map((connection, index) => ({ ...connection, connectionId: `connection-${index + 1}`, status: index === 5 ? 'uncertain' : 'pending' })),
    groundCandidate: { nodeId: 'node-1-b1', sourceId: 'b1', status: 'pending', reason: 'Barra escura horizontal parece referência fixa, mas a ancoragem não é visível.' },
    terminalRight: { nodeId: 'node-4-b4', sourceId: 'b4', status: 'uncertain', reason: 'A fotografia não decide entre link, suporte ou terminal.' },
    unknowns: [
      'Subtipo e eixo de cada uma das três juntas não são visíveis.',
      'Não há ground confirmado nem fixação observável do conjunto.',
      'A peça terminal direita e a ligação connection-6 permanecem incertas.',
      'Não há escala, comprimentos, ângulos, pose, DOF ou limites de movimento.',
      'Ranhuras, parafusos e elementos no verso podem não ser juntas cinemáticas.',
    ],
    draftGraph: draft,
    humanConfirmation: { status: 'pending', reviewer: null, confirmedAt: null, confirmationTextRequired: 'CONFIRM_MECHANICAL_REVIEW', changes: [] },
  };
  writeJson(DRAFT_PATH, draft);
  writeJson(PACKAGE_PATH, packageValue);
  writeJson(CONFIRMATION_PATH, { status: 'pending', reviewer: null, confirmedAt: null, confirmationText: '', changes: [] });
  writeJson(HISTORY_PATH, [
    { version: 'phase-2b-reviewed', path: PREVIOUS_GRAPH_PATH, sha256: previousHash, status: 'legacy_complete_not_human_verified' },
    { version: 'phase-2d-draft', path: DRAFT_PATH, sha256: sha256(DRAFT_PATH), status: 'pending' },
  ]);
  const visual = [
    '# Paderborn — pacote visual de revisão humana',
    '',
    `![Imagem original](${IMAGE_PATH})`,
    '',
    `Origem: ${raw.source.sourceUrl}`,
    '',
    '## Componentes propostos',
    '',
    '| ID | Raw kind | Proposta | Estado |',
    '|---|---|---|---|',
    ...packageValue.proposedComponents.map((component) => `| ${component.nodeId} (${component.sourceId}) | ${component.rawKind} | ${component.proposedKind}${component.jointType ? ` / jointType=${component.jointType}` : ''} | ${component.status} |`),
    '',
    '## Ligações propostas pelo Muse',
    '',
    '| ID | From | To | Relação | Estado |',
    '|---|---|---|---|---|',
    ...packageValue.proposedConnections.map((connection) => `| ${connection.connectionId} | ${connection.from} | ${connection.to} | ${connection.relation} | ${connection.status} |`),
    '',
    '## Confirmação necessária',
    '',
    '- Confirmar ou rejeitar `node-1-b1` como ground/support.',
    '- Confirmar os tipos dos três pivots; a fotografia não permite escolher revolute/prismatic com segurança.',
    '- Manter `node-4-b4` e `connection-6` como incertos salvo evidência humana adicional.',
    '- Registar nome do revisor, data UTC, alterações e a frase exacta `CONFIRM_MECHANICAL_REVIEW`.',
    '',
    'Estado actual: `pending`. Nenhuma confirmação humana foi registada.',
    '',
  ].join('\n');
  writeFileSync(VISUAL_REVIEW_PATH, visual, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', package: PACKAGE_PATH, draft: DRAFT_PATH, confirmation: CONFIRMATION_PATH, previousPreserved: true }));
}

async function confirm(): Promise<void> {
  if (!existsSync(DRAFT_PATH) || !existsSync(CONFIRMATION_PATH)) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'PADERBORN_REVIEW_PACKAGE_MISSING' }));
    process.exitCode = 2;
    return;
  }
  const confirmation = readJson<HumanConfirmation & { status?: string }>(CONFIRMATION_PATH);
  if (confirmation.status !== 'ready' || !confirmation.reviewer || !confirmation.confirmedAt || confirmation.confirmationText !== 'CONFIRM_MECHANICAL_REVIEW' || !Array.isArray(confirmation.changes) || confirmation.changes.length === 0) {
    console.error(JSON.stringify({ status: 'CONDITIONAL', reason: 'HUMAN_CONFIRMATION_REQUIRED', expectedFile: CONFIRMATION_PATH }));
    process.exitCode = 2;
    return;
  }
  const draft = readJson<ReturnType<typeof normalizeMechanicalObservation>>(DRAFT_PATH);
  const verified = confirmHumanReview(draft, confirmation);
  writeJson(VERIFIED_PATH, verified);
  writeJson(HISTORY_PATH, [
    ...readJson<unknown[]>(HISTORY_PATH),
    { version: 'phase-2d-verified', path: VERIFIED_PATH, sha256: sha256(VERIFIED_PATH), status: 'verified', reviewer: confirmation.reviewer, confirmedAt: confirmation.confirmedAt },
  ]);
  console.log(JSON.stringify({ status: 'PASS', verified: VERIFIED_PATH, reviewer: confirmation.reviewer, confirmedAt: confirmation.confirmedAt }));
}

const mode = process.argv[2];
if (mode === 'prepare') prepare();
else if (mode === 'confirm') await confirm();
else throw new Error('Use `prepare` ou `confirm`.');

/**
 * Technical debt of the Reality Engine at the close of Phase 01, in priority order. Every item has a RESOLUTION CRITERION that a program can evaluate: a metric read
 * from a committed measurement file, a comparison and a threshold. Items whose measurement does not exist yet (needs data or people outside the build) have
 * `source: null` and are `blocked`, never "met". Nothing is resolved by editing this file: only by the measurement file changing through a re-run of the named script.
 */
export type DebtItem = {
  id: string; priority: 1 | 2 | 3; title: string; why: string;
  /** measurement file (relative to the repository root) or null when no measurement can exist yet */ source: string | null;
  /** script that regenerates the measurement */ script: string | null;
  /** extracts the number from the parsed measurement file */ value: ((json: any) => number) | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  op: '>=' | '<='; threshold: number; unit: string;
  /** what a person or process outside the build must provide, when blocked */ blockedBy?: string;
};
const B = 'reports/reality-engine/benchmark/';
const ratio = (a: { recovered: number; significant: number }) => a.recovered / a.significant;

export const DEBT: readonly DebtItem[] = [
  { id: 'D1-geometry-real-photos', priority: 1, title: 'Fidelidade geométrica em fotografias reais contra referência 3D independente', why: 'Todo o benchmark é de renders; nenhuma afirmação sobre fotografias é sustentada.', source: null, script: 'scripts/datasets/scan-directory.ts', value: null, op: '<=', threshold: 3, unit: '% da diagonal, chamfer oficial em scans de aceitação DTU/ETH3D', blockedBy: 'download dos datasets (ficheiros locais) e script oficial de avaliação' },
  { id: 'D2-outline-handheld', priority: 1, title: 'Contornos automáticos errados com fundo a mudar', why: 'Sem câmara fixa a automação é insuficiente; obriga a confirmação vista a vista.', source: B + 'segmentation-cached.json', script: 'scripts/benchmark/seg-cached.ts', value: (j) => j.summary['varied/baseline'].wrongRate, op: '<=', threshold: 0.2, unit: 'fracção de contornos aceites com IoU < 0,8' },
  { id: 'D3-outline-fixed', priority: 1, title: 'Qualidade do contorno automático com câmara fixa', why: 'O caminho automático mais favorável ainda erra quase metade das vistas.', source: B + 'segmentation-cached.json', script: 'scripts/benchmark/seg-cached.ts', value: (j) => j.summary['fixed/baseline'].meanIoU, op: '>=', threshold: 0.85, unit: 'IoU médio dos contornos aceites' },
  { id: 'D4-parts-physical', priority: 1, title: 'Recuperação de peças físicas sem correcção humana', why: 'A estrutura automática é hipótese; só a correcção assistida atinge valores úteis.', source: B + 'components-product-shells.json', script: 'scripts/benchmark/component-eval.ts --gt shells --near 1.5', value: (j) => ratio(j.aggregate.baseline.acceptance), op: '>=', threshold: 0.6, unit: 'peças significativas recuperadas (IoU ≥ 0,5), activos de aceitação' },
  { id: 'D5-parts-nodes', priority: 2, title: 'Recuperação de peças contra os nós do activo', why: 'Referencial do autor; mede a coincidência com a decomposição humana original.', source: B + 'components-product.json', script: 'scripts/benchmark/component-eval.ts --gt nodes --near 1.5', value: (j) => ratio(j.aggregate.baseline.acceptance), op: '>=', threshold: 0.6, unit: 'peças significativas recuperadas, activos de aceitação' },
  { id: 'D6-hull-accuracy', priority: 1, title: 'Exactidão do casco com contornos confirmados', why: 'O casco é limite superior; o erro mediano ainda é maior que o objectivo de uma reconstrução fiel.', source: B + 'product-results-realbg/product-results.json', script: 'scripts/benchmark/reality-product-eval.ts', value: (j) => { const v = j.results.filter((r: { status: string }) => r.status === 'reconstructed').map((r: { chamferPctAligned: number }) => r.chamferPctAligned).sort((a: number, b: number) => a - b); return v[Math.floor(v.length / 2)]; }, op: '<=', threshold: 2, unit: '% da diagonal, chamfer mediano' },
  { id: 'D7-camera-estimation', priority: 2, title: 'Estimação do campo de visão a 65°', why: 'O ganho com a câmara verdadeira é maior do que o que a estimação recupera.', source: B + 'camera-eval.json', script: 'scripts/benchmark/camera-eval.ts', value: (j) => (j.summary['65'].medianOrtho - j.summary['65'].medianProduct) / j.summary['65'].medianOrtho, op: '>=', threshold: 0.15, unit: 'redução relativa do chamfer mediano' },
  { id: 'D8-human-evaluation', priority: 1, title: 'Avaliação humana independente', why: 'Requisito de aceitação que não pode ser simulado.', source: null, script: null, value: null, op: '>=', threshold: 3, unit: 'avaliadores independentes por scan', blockedBy: 'pessoas independentes (reports/reality-engine/HUMAN-EVALUATION-PROTOCOL.md)' },
  { id: 'D9-materials-grounded', priority: 3, title: 'Materiais PBR fundamentados em evidência', why: 'A reflectância não é medida; o material é mate assumido.', source: null, script: null, value: null, op: '>=', threshold: 0.7, unit: 'correlação com os factores de material do GT', blockedBy: 'método de estimação ainda não existe (investigar com referência de material)' },
  { id: 'D10-device-budget', priority: 3, title: 'Orçamento de desempenho em GPU real por dispositivo', why: 'Medições feitas em renderização por software.', source: null, script: null, value: null, op: '<=', threshold: 16.7, unit: 'ms por fotograma no dispositivo-alvo', blockedBy: 'GPU real' },
  { id: 'D11-structure-on-built-space', priority: 2, title: 'Alterar a estrutura de um Space já construído', why: 'O Spatial Core não tem operações de acrescentar/remover componentes.', source: 'src/universal-spatial/contracts-v2.ts', script: null, value: (j: { text: string }) => (/'add-component'/.test(j.text) && /'remove-component'/.test(j.text) ? 1 : 0), op: '>=', threshold: 1, unit: 'operações add/remove-component existem (1 = sim)' },
] as const;

export type DebtStatus = 'open' | 'met' | 'blocked';
export type DebtEvaluation = { item: DebtItem; current: number | null; status: DebtStatus };
export function evaluateDebt(load: (path: string) => unknown | null): DebtEvaluation[] {
  return DEBT.map((item) => {
    if (!item.source || !item.value) return { item, current: null, status: 'blocked' as const };
    const raw = load(item.source); if (raw === null) return { item, current: null, status: 'blocked' as const };
    const v = item.value(raw), ok = Number.isFinite(v) && (item.op === '>=' ? v >= item.threshold : v <= item.threshold);
    return { item, current: Number.isFinite(v) ? v : null, status: ok ? 'met' as const : 'open' as const };
  });
}
export function debtMarkdown(ev: readonly DebtEvaluation[]): string {
  const f = (n: number | null) => (n === null ? '—' : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3));
  return `# Dívida técnica do Reality Engine — encerramento da Fase 01

Gerado por \`npx tsx scripts/reality-debt-report.ts\` a partir de \`src/living/reality/debt.ts\` e dos ficheiros de medição; um teste verifica que este ficheiro coincide com o gerado. **Um item só passa a «cumprido» quando o ficheiro de medição indicado for regenerado pelo script indicado e o critério se verificar.** Itens sem medição possível são «bloqueados» e nunca «cumpridos».

| # | Prioridade | Dívida | Critério de resolução | Valor actual | Estado |
|---|---|---|---|---|---|
${ev.map(({ item: d, current, status }) => `| ${d.id} | ${d.priority} | ${d.title} | ${d.op} ${d.threshold} (${d.unit}) | ${f(current)} | **${status}**${d.blockedBy ? ` — depende de: ${d.blockedBy}` : ''} |`).join('\n')}

## Porquê cada uma importa
${ev.map(({ item: d }) => `- **${d.id}** — ${d.why}${d.source ? ` Medição: \`${d.source}\`${d.script ? `, regenerada por \`${d.script}\`` : ''}.` : ''}`).join('\n')}
`;
}

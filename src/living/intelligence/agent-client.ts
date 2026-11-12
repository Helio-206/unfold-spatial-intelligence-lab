import { AGENT_REPLY_CONTRACT, AGENT_REQUEST_CONTRACT, parseModelReply, type ModelReply, type ModelStatement, type ToolResultWire, type ToolSpec } from './agent-protocol';
import type { ModelClient } from './agent';

/** Real path: the server forwards the grounded request to Muse Spark (paid, budgeted). The browser never holds a key. */
export class RemoteMuseClient implements ModelClient {
  readonly source = 'muse-spark' as const; model = 'muse-spark'; calls = 0; lastCostUsd: number | null = null;
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly baseUrl = '') {}
  async complete(input: { question: string; step: number; context: unknown; toolResults: ToolResultWire[]; tools: ToolSpec[] }, signal?: AbortSignal): Promise<ModelReply> {
    this.calls++;
    const response = await this.fetchImpl(`${this.baseUrl}/api/living/agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contract: AGENT_REQUEST_CONTRACT, ...input }), ...(signal ? { signal } : {}) });
    const body = (await response.json().catch(() => null)) as { contract?: string; reply?: unknown; meta?: { model?: string; estimatedCostUsd?: number }; error?: { code?: string } } | null;
    if (!response.ok || !body || body.contract !== AGENT_REPLY_CONTRACT) throw new Error(body?.error?.code ?? `HTTP ${response.status}`);
    if (body.meta?.model) this.model = body.meta.model; this.lastCostUsd = body.meta?.estimatedCostUsd ?? null;
    return parseModelReply(JSON.stringify(body.reply));
  }
}

const NUM = /-?\d+(?:[.,]\d+)?/;
const num = (q: string): number | null => { const m = q.match(NUM); return m ? Number(m[0].replace(',', '.')) : null; };
/**
 * DETERMINISTIC SIMULATION of the model, for tests and for working without Muse Spark: a keyword planner picks the tools a person's question calls for and the answer is assembled
 * only from the tool results (their own statements and categories). It is NOT Muse Spark and never claims to be: `source` is 'simulated' and the UI says so. It exists so the
 * whole tool path (validation, grounding, proposals, authorisation) is testable without a paid call. Real-model integration is only "validated" by a recorded real call.
 */
export class SimulatedClient implements ModelClient {
  readonly source = 'simulated' as const; readonly model = 'simulated-planner.v1'; calls = 0;
  constructor(private readonly hint: { selectedJoint?: string | null; selectedComponent?: string | null } = {}) {}
  async complete(input: { question: string; step: number; context: unknown; toolResults: ToolResultWire[]; tools: ToolSpec[] }): Promise<ModelReply> {
    this.calls++; const q = input.question.toLowerCase(), ctx = input.context as { seleccionado?: string | null; mecanismo?: { juntas: Array<{ id: string; tipo: string }> } | null } | null, sel = this.hint.selectedComponent ?? (ctx as { seleccionado?: string } | null)?.seleccionado ?? null;
    const movable = (ctx?.mecanismo?.juntas ?? []).filter((j) => j.tipo !== 'fixed'), joint = this.hint.selectedJoint ?? movable[0]?.id ?? null, n = num(input.question);
    if (input.step === 0) {
      const calls: Array<{ tool: string; args: unknown }> = [];
      if (/que pe[çc]a|o que [ée] (esta|isto)|para que serve/.test(q) && sel) calls.push({ tool: 'describe_component', args: { id: sel } });
      else if (/interior|mostra|isola|explod/.test(q)) calls.push({ tool: 'set_view', args: { action: /explod/.test(q) ? 'explode' : sel ? 'isolate' : 'transparent', ids: sel ? [sel] : [] } });
      else if (/porque|porquê|n[ãa]o consegue|bloquead|impede/.test(q) && joint) calls.push({ tool: 'explain_blocked', args: { joint, target: n !== null ? (/gr(a|au)s?|°/.test(q) ? (n * Math.PI) / 180 : n) : 6 } });
      else if (/o que acontece|se aumentar|se eu aumentar/.test(q) && joint) calls.push({ tool: 'explain_effect', args: { joint, value: n !== null ? (/gr(a|au)s?|°/.test(q) ? (n * Math.PI) / 180 : n) : 0.5 } });
      else if (/move|mover|roda|rodar|articula/.test(q) && joint) calls.push({ tool: 'propose_pose', args: { inputs: { [joint]: n !== null ? (/gr(a|au)s?|°/.test(q) ? (n * Math.PI) / 180 : n) : 0.5 }, rationale: 'pedido do utilizador' } });
      else if (/funciona|trabalham|em conjunto|mecanismo/.test(q)) { calls.push({ tool: 'get_mechanism', args: {} }, { tool: 'explain_mechanism', args: {} }); }
      else calls.push({ tool: 'list_components', args: {} });
      return { kind: 'tool_calls', toolCalls: calls.map((c) => ({ tool: c.tool, args: JSON.stringify(c.args) })) };
    }
    const statements: ModelStatement[] = [];
    for (const r of input.toolResults) {
      if (!r.ok) { statements.push({ text: `A ferramenta ${r.tool} falhou: ${(r.data as { erro?: string })?.erro ?? 'erro'}. Nada foi alterado.`, category: 'unknown', refs: [r.id] }); continue; }
      const d = r.data as { declarações?: Array<{ text: string; category: ModelStatement['category'] }>; proposta?: string; estado?: string; causa?: string; nota?: string; id?: string; label?: string; papel?: string; descritor?: string | null; aplicada?: boolean };
      if (d.declarações) { const reads = input.toolResults.filter((x) => x.ok && x.category === 'observed').map((x) => x.id); for (const s of d.declarações.slice(0, 8)) statements.push({ text: s.text, category: s.category, refs: s.category === 'observed' || s.category === 'user' ? [...reads, r.id] : [r.id] }); }
      else if (r.tool === 'propose_pose') statements.push({ text: `Proponho esta pose e ela fica em pré-visualização só depois de a autorizar (estado calculado: ${(r.data as { estadoCalculado?: string }).estadoCalculado}).`, category: 'computed', refs: [r.id] });
      else if (r.tool === 'describe_component') statements.push({ text: `${d.id}: «${d.label}». Papel no mecanismo: ${d.papel}.${d.descritor ? ` Forma: ${d.descritor}.` : ''} A função da peça não é conhecida só pela geometria.`, category: 'observed', refs: [r.id] }, { text: 'A função real da peça é desconhecida: o plano só diz forma, posição e proveniência.', category: 'unknown', refs: [] });
      else if (r.tool === 'set_view') statements.push({ text: `Vista alterada (${(r.data as { acção?: string }).acção}); a geometria e o mecanismo não foram tocados.`, category: 'observed', refs: [r.id] });
      else if (r.tool === 'list_components') statements.push({ text: `O Space tem ${(r.data as unknown[]).length} componente(s); a origem de cada um consta da lista.`, category: 'observed', refs: [r.id] });
    }
    if (!statements.length) statements.push({ text: 'Não há informação suficiente para responder.', category: 'unknown', refs: [] });
    return { kind: 'answer', statements, limitations: ['Resposta de uma simulação determinística (não é o Muse Spark).'] };
  }
}

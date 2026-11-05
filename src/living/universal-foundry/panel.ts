/**
 * Experimental parameter panel (debug flag only). Lists the recipe the Foundry chose for the current Space (category, archetype, confidence, provenance of every value)
 * and its parameters; changing one regenerates the geometry from the same plan. It does not touch the plan, the review or the authorisation.
 */
import type { PlanSpaceLayer } from '../spatial-space/layer';
import type { ParamSpec, ParamValue } from './recipe';
import type { FoundryGeometry } from './provider';

export function mountFoundryPanel(geometry: FoundryGeometry, layer: () => PlanSpaceLayer | null): { dispose(): void } {
  const root = document.createElement('aside'); root.setAttribute('aria-label', 'Universal Foundry (experimental)'); root.dataset.foundryPanel = '';
  root.style.cssText = 'position:fixed;right:12px;top:72px;z-index:30;width:262px;max-height:60vh;overflow:auto;background:rgba(23,26,31,.94);color:#F3F0E8;font:12px/1.4 ui-monospace,monospace;border:1px solid rgba(243,240,232,.16);border-radius:10px;padding:10px 12px;display:none';
  document.body.append(root);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const input = (s: ParamSpec, v: ParamValue) => s.type === 'number' ? `<input data-k="${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step ?? 0.01}" value="${String(v)}" style="width:100%"><output>${String(v)}</output>` : s.type === 'boolean' ? `<input data-k="${s.key}" type="checkbox" ${v ? 'checked' : ''}>` : `<select data-k="${s.key}">${(s.options ?? []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const render = () => {
    const recipe = geometry.recipe, l = layer();
    if (!recipe || !l) { root.style.display = 'none'; return; }
    root.style.display = 'block'; const values = geometry.values;
    root.innerHTML = `<strong>Foundry · experimental</strong><div>${recipe.category} / ${recipe.archetype} · confiança ${(recipe.confidence * 100).toFixed(0)}%</div><div>paleta: ${recipe.paletteKnown} · proporções: ${recipe.proportions.known}</div>${l.currentPlan.source.kind === 'image' && !recipe.evidence.used ? '<div role="status">Evidência da imagem indisponível; apresentação conceptual baseada no plano.</div>' : ''}<div>contorno: ${geometry.maskProvenance === 'user_confirmed' ? 'corrigido e confirmado por si (não verificado)' : geometry.maskProvenance === 'automatic' ? `automático (${geometry.segmentationSource === 'model-mediapipe-deeplab-v3' ? 'modelo local DeepLab v3' : 'clássico'})` : 'sem máscara'}</div><div>semente <input data-seed type="number" min="0" value="${geometry.currentSeed}" style="width:64px"> <button data-reset>repor</button></div><div style="margin:8px 0"><button data-proportions type="button">Propor proporções derivadas da evidência</button><div data-proportions-status role="status"></div></div><hr>${geometry.specs.map((s) => `<label style="display:block;margin:6px 0">${esc(s.label)} <em>(${s.known})</em>${input(s, values[s.key]!)}</label>`).join('')}<details><summary>desconhecido (${recipe.unknowns.length})</summary>${recipe.unknowns.map((u) => `<div>· ${esc(u)}</div>`).join('')}</details>`;
  };
  const apply = (change: Record<string, ParamValue>, seed?: number) => { const l = layer(); if (!l) return; geometry.set(l.currentPlan, change, seed); l.regenerate(); };
  root.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.dataset.k && t.type === 'range') { const o = t.nextElementSibling as HTMLOutputElement | null; if (o) o.textContent = t.value; } });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement; if ('seed' in t.dataset) { apply({}, Number((t as HTMLInputElement).value)); return; }
    const k = t.dataset.k; if (!k) return; const spec = geometry.specs.find((s) => s.key === k); if (!spec) return;
    apply({ [k]: spec.type === 'number' ? Number(t.value) : spec.type === 'boolean' ? (t as HTMLInputElement).checked : t.value });
  });
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.reset !== undefined) { const l = layer(); if (l) { geometry.reset(l.currentPlan); l.regenerate(); } }
    if (target.dataset.proportions !== undefined) {
      const l = layer(); if (!l) return;
      const status = root.querySelector<HTMLElement>('[data-proportions-status]');
      const proposal = geometry.proportionsProposal();
      if (!proposal) { if (status) status.textContent = 'Sem evidência ligada a este plano; nada é proposto.'; return; }
      if (proposal.derived.status !== 'derived' || !proposal.operations) {
        if (status) status.textContent = `Proporções indisponíveis: ${proposal.derived.status === 'unavailable' ? proposal.derived.reason : 'sem operações válidas'}. Nada foi alterado.`;
        return;
      }
      const ok = l.proposeSolverEdit(proposal.operations, 'Proporções derivadas da evidência', `${proposal.derived.method} Incerteza: ${proposal.derived.uncertainty}`);
      if (status) status.textContent = ok
        ? `Proposta tipada criada (câmara: ${proposal.camera}; distância entre eixos ${proposal.derived.wheelbaseFraction ? (proposal.derived.wheelbaseFraction * 100).toFixed(0) + '%' : '—'}). Revê e aplica no inspector do componente — o plano só muda com a tua autorização, pela transacção existente.`
        : 'A proposta foi recusada pela validação da layer; nada foi alterado.';
    }
  });
  const off = geometry.onCompiled(() => queueMicrotask(render));
  return { dispose: () => { off(); root.remove(); } };
}

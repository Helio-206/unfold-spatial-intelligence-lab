import { FIDELITY_LABEL, EVIDENCE_LABEL } from '../../core';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { analyseStructure } from './structure';
import { assessCoverage } from './capture-quality';
import { hullSilhouette } from '../../universal-spatial/reconstruction/multiview';
import { decodeMask, type RealityEvidence } from './evidence';
import { decodeImageFile } from './intake-panel';
import { intakeAddView, type IntakeImage, type Refusal } from './intake';
import type { RealityHost } from './host';
import { UNOBSERVED_COLOUR, viewsOf } from './model';
import type { Refinement } from './refine';

/**
 * Reconstruction review on the Space that is on stage: the evidence ledger in plain words, the reference views compared with what the solid predicts,
 * a new perspective previewed (what it removes, whether it told us anything) BEFORE it is applied, and the version history with undo and redo.
 * Nothing here edits the plan: a refinement changes the reconstruction's shells under the same component ids and positions, and the person's
 * transform edits keep their meaning. Applying is an explicit button; discarding leaves everything as it was.
 */
export type RealityReviewDeps = {
  host: RealityHost; sourceSha256: string; plan: () => SpatialPlanV2;
  decode?: (file: File) => Promise<IntakeImage>;
  /** called after the reconstruction changed (the Space recompiles its shells) */
  onChanged(): void;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const swatch = `rgb(${UNOBSERVED_COLOUR.map((v) => Math.round(v * 255)).join(',')})`;
const REFUSE: Partial<Record<Refusal['code'], string>> = { MASK_UNRELIABLE: 'O contorno desta imagem não é credível; use fundo liso ou PNG transparente.', EMPTY_MASK: 'Não foi encontrado nenhum objecto nesta imagem.', TOO_MANY_VIEWS: 'Já tem o número máximo de vistas.', POSE_COUNT_MISMATCH: 'Esta reconstrução não admite vistas adicionais por fotografia.' };

export function mountRealityReview(deps: RealityReviewDeps): { refresh(): void; dispose(): void } {
  const decode = deps.decode ?? decodeImageFile;
  const root = document.createElement('aside'); root.dataset.realityReview = ''; root.setAttribute('aria-label', 'Reality Engine · revisão da reconstrução');
  root.style.cssText = 'position:fixed;right:12px;top:72px;z-index:30;width:320px;max-height:74vh;overflow:auto;background:rgba(23,26,31,.95);color:#F3F0E8;font:12px/1.45 ui-monospace,monospace;border:1px solid rgba(243,240,232,.16);border-radius:10px;padding:12px';
  document.body.append(root);
  let pending: { evidence: RealityEvidence; refinement: Refinement; label: string } | null = null, problem: string | null = null, busy = false, azimuth = '45', open = true, disposed = false;

  const render = () => {
    if (disposed) return;
    const sha = deps.sourceSha256, entry = deps.host.entry(sha); if (!entry) { root.hidden = true; return; }
    root.hidden = false;
    const a = deps.host.assess(sha, deps.plan())!, f = a.ledger.fidelity, m = entry.model, ev = m.evidence;
    const kind = (k: keyof typeof EVIDENCE_LABEL) => EVIDENCE_LABEL[k];
    const comps = a.ledger.components.map((c) => `<li>${esc(c.label)} — forma <b>${kind(c.geometry.kind)}</b> · posição <b>${kind(c.transform.kind)}</b> · cor <b>${kind(c.material.kind)}</b></li>`).join('');
    const compare = viewsOf(ev).map((v) => `<figure style="margin:0"><canvas data-rr-cmp="${esc(v.id)}" width="96" height="72" aria-label="Referência ${esc(v.id)} contra o previsto"></canvas><figcaption>${esc(v.id)} · IoU <span data-rr-iou="${esc(v.id)}"></span></figcaption></figure>`).join('');
    const d = pending?.refinement.diff;
    const diff = d ? `<div data-rr-diff><b>Pré-visualização · ${esc(pending!.label)}</b><br>Veredicto: <b data-rr-verdict="${d.verdict}">${d.verdict === 'informative' ? 'esta vista traz informação nova' : 'esta vista é redundante (não muda o sólido)'}</b><br>Informação nova: ${(d.informationGain[0]?.gain ?? 0) * 100 | 0}% · volume removido: ${(d.removedFraction * 100).toFixed(1)}%<br>Concordância entre vistas: ${d.heldOutBefore === null ? '—' : (d.heldOutBefore * 100).toFixed(0) + '%'} → ${d.heldOutAfter === null ? '—' : (d.heldOutAfter * 100).toFixed(0) + '%'}<br>Partes mantidas ${d.matched.length}${d.droppedPartIds.length ? ` · deixam de ter suporte: ${esc(d.droppedPartIds.join(', '))}` : ''}${d.newPartIds.length ? ` · novas hipóteses (não adicionadas ao plano): ${esc(d.newPartIds.join(', '))}` : ''}<br><button data-rr="apply" class="u-btn u-btn--primary" ${busy ? 'disabled' : ''}>Aplicar</button> <button data-rr="discard" class="u-btn u-btn--outline">Descartar</button></div>` : '';
    root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><strong>Reality Engine</strong><button data-rr="toggle" class="uw-link" aria-expanded="${open}">${open ? 'recolher' : 'abrir'}</button></div>
      <div data-fidelity="${f.class}" role="status"><b>${esc(FIDELITY_LABEL[f.class])}</b>${f.class === 'faithful' ? '' : ' — não é uma medição'}<br><small>${esc(f.reasons[0] ?? '')}</small></div>
      ${open ? `<ul style="margin:6px 0;padding-left:16px">${a.statements.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <details><summary>O que ninguém verificou</summary><ul style="padding-left:16px">${f.unvalidatable.map((s) => `<li>${esc(s)}</li>`).join('')}${f.blockers.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>
      <div style="display:flex;gap:6px;align-items:center;margin:6px 0"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${swatch}"></span> região nenhuma vista viu: hipótese</div>
      <details open><summary>Comparar com a referência (azul = referência, laranja = previsto)</summary><div style="display:flex;flex-wrap:wrap;gap:6px">${compare}</div></details>
      <details data-rr-structure><summary>Estrutura medida (relações e oclusão)</summary>${(() => { const st = analyseStructure(m); return `<ul style="padding-left:16px"><li>Contactos: ${st.contacts.length ? st.contacts.map((c) => `${esc(c.a)}–${esc(c.b)} (${(c.areaFraction * 100).toFixed(0)}%)`).join(', ') : 'nenhum'}</li><li>Pares espelhados: ${st.symmetries.length ? st.symmetries.map((x) => `${esc(x.a)}≈${esc(x.b)} (${x.axis}, ${(x.iou * 100).toFixed(0)}%)`).join(', ') : 'nenhum'}</li><li>Eixos paralelos: ${st.alignments.length ? st.alignments.map((x) => `${esc(x.a)}∥${esc(x.b)} (${x.angleDeg}°)`).join(', ') : 'nenhum'}</li>${st.visibility.map((v) => `<li>${esc(v.partId)}: ${v.status === 'observed' ? 'vista' : v.status === 'weakly_observed' ? 'pouco observada' : 'não observada'} por ${v.observedViews} vista(s)</li>`).join('')}</ul><small>Relações medidas no casco; não são restrições impostas nem dizem o que a parte é.</small>`; })()}</details>
      <details><summary>Evidência por componente</summary><ul style="padding-left:16px">${comps}</ul></details>
      <details data-rr-guidance open><summary>O que fotografar a seguir</summary>${(() => { const g = assessCoverage(viewsOf(ev)); return g.issues.length ? `<ul style="padding-left:16px">${g.issues.map((i) => `<li data-rr-issue="${i.code}">${esc(i.message)} <b>${esc(i.advice)}</b></li>`).join('')}</ul>` : '<p>Cobertura angular e de altura sem lacunas evidentes.</p>'; })()}</details>
      <hr><div><b>Acrescentar uma perspectiva</b><br><label>azimute (°) <input data-rr-az type="number" value="${esc(azimuth)}" min="-360" max="360" step="1" style="width:70px"></label><br><input data-rr-file type="file" accept="image/png,image/jpeg,image/webp" ${busy ? 'disabled' : ''}>
        ${problem ? `<p role="alert" style="color:#ffb4a8">${esc(problem)}</p>` : ''}${diff}</div>
      <hr><div><b>Versões</b> ${ev.views.length} vistas · <span data-rr-version>${entry.record.current + 1}/${entry.record.versions.length}</span><br>${entry.record.versions.map((v, i) => `<div>${i === entry.record.current ? '▶' : '·'} ${esc(v.note)}</div>`).join('')}
        <button data-rr="undo" class="u-btn u-btn--outline" ${deps.host.canUndo(sha) && !busy ? '' : 'disabled'}>Desfazer refinamento</button> <button data-rr="redo" class="u-btn u-btn--outline" ${deps.host.canRedo(sha) && !busy ? '' : 'disabled'}>Refazer</button></div>` : ''}`;
    if (open) paintComparison();
  };

  const paintComparison = () => {
    const entry = deps.host.entry(deps.sourceSha256); if (!entry) return;
    const m = entry.model, ev = m.evidence;
    for (const v of viewsOf(ev)) {
      const canvas = root.querySelector<HTMLCanvasElement>(`[data-rr-cmp="${v.id}"]`); if (!canvas) continue;
      const ref = decodeMask(ev.views.find((x) => x.id === v.id)!.maskRle, ev.res * ev.res), pred = hullSilhouette(m.solid.grid, m.solid.occupancy, v, m.frame);
      const ctx = canvas.getContext('2d')!, img = ctx.createImageData(canvas.width, canvas.height); let i = 0, u = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const sx = Math.floor(x / canvas.width * ev.res), sy = Math.floor((canvas.height - 1 - y) / canvas.height * ev.res), k = sy * ev.res + sx, r = ref[k]!, p = pred[k]!, o = (y * canvas.width + x) * 4;
        // reference only = blue, prediction only = orange, both = grey: where the solid and the evidence disagree is visible
        const rgb = r && p ? [150, 150, 150] : r ? [70, 140, 255] : p ? [255, 150, 60] : [22, 25, 30];
        img.data[o] = rgb[0]!; img.data[o + 1] = rgb[1]!; img.data[o + 2] = rgb[2]!; img.data[o + 3] = 255;
      }
      for (let k = 0; k < ref.length; k++) { i += ref[k]! & pred[k]!; u += ref[k]! | pred[k]!; }
      ctx.putImageData(img, 0, 0);
      const out = root.querySelector<HTMLElement>(`[data-rr-iou="${v.id}"]`); if (out) out.textContent = `${((u ? i / u : 1) * 100).toFixed(0)}%`;
    }
  };

  const onClick = (event: Event) => {
    const b = (event.target as HTMLElement).closest<HTMLElement>('[data-rr]'); if (!b) return;
    const act = b.dataset.rr, sha = deps.sourceSha256;
    if (act === 'toggle') { open = !open; render(); }
    else if (act === 'discard') { pending = null; problem = null; render(); }
    else if (act === 'apply' && pending && !busy) {
      busy = true; render(); const p = pending;
      void deps.host.apply(sha, p.evidence, p.label).then((ok) => { busy = false; pending = null; problem = ok ? null : 'Não foi possível aplicar (limite de versões).'; render(); if (ok) deps.onChanged(); });
    }
    else if ((act === 'undo' || act === 'redo') && !busy) { busy = true; void deps.host.step(sha, act === 'undo' ? -1 : 1).then(() => { busy = false; pending = null; render(); deps.onChanged(); }); }
  };
  const onChange = (event: Event) => {
    const t = event.target as HTMLInputElement;
    if (t.matches('[data-rr-az]')) { azimuth = t.value; return; }
    if (!t.matches('[data-rr-file]') || !t.files?.[0] || busy) return;
    const file = t.files[0], az = Number(azimuth); busy = true; problem = null; pending = null; render();
    void (async () => {
      try {
        if (!Number.isFinite(az)) throw new Error('azimuth');
        const entry = deps.host.entry(deps.sourceSha256)!, image = await decode(file);
        const added = intakeAddView(entry.model.evidence, image, { azimuthDeg: az });
        if (!added.evidence) problem = added.refusals.map((r) => REFUSE[r.code] ?? r.detail).join(' ');
        else { const refinement = (await deps.host.preview(deps.sourceSha256, added.evidence))!; pending = { evidence: added.evidence, refinement, label: `Vista «${file.name.slice(0, 40)}» a ${az}°` }; }
      } catch { problem = 'Indique o azimute em graus e uma imagem legível.'; }
      busy = false; render();
    })();
  };
  root.addEventListener('click', onClick); root.addEventListener('change', onChange);
  render();
  return { refresh: render, dispose() { disposed = true; root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.remove(); } };
}

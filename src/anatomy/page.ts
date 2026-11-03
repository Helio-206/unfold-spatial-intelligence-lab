import './anatomy.css';
import { ANATOMY_COMPONENTS, type AnatomyObservationV1, type AnatomyReviewV1, type ReviewDecision } from './contracts';
import { anatomyDomainAdapter, HEART_COMPONENT_LABELS, type AnatomySceneProposal } from './adapter';
import { activePhaseAt, mountHeartViewer, type HeartViewer } from './heart-viewer';

const SOURCE_URL = '/anatomy/source-heart.svg';
const SOURCE_REFERENCE = 'https://commons.wikimedia.org/wiki/File:Diagram_of_the_human_heart.svg';
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function mountAnatomyDomain(app: HTMLElement): Promise<void> {
  app.innerHTML = `
    <main class="anatomy-root" data-theme="dark">
      <header class="anatomy-head">
        <a class="anatomy-brand" href="/" aria-label="UNFOLD"><img src="/design-system/logos/unfold-lockup-on-dark.svg" alt="UNFOLD" height="24"></a>
        <div><p class="u-label">Domínio experimental · coração</p><h1>UNFOLD Anatomy</h1></div>
        <div class="anatomy-head-state" id="anatomy-status" role="status">Imagem pronta · aguarda análise</div>
      </header>
      <section class="anatomy-flow" aria-label="Percurso anatómico">
        <span class="is-current" data-step="source">01 Imagem</span><i></i><span data-step="meta">02 Meta live</span><i></i><span data-step="review">03 Revisão</span><i></i><span data-step="scene">04 Atlas 3D</span><i></i><span data-step="timeline">05 Ciclo ilustrativo</span>
      </section>
      <div class="anatomy-layout">
        <aside class="anatomy-side">
          <section class="anatomy-card anatomy-source-card" aria-labelledby="source-heading">
            <div class="anatomy-section-title"><span class="anatomy-index">01</span><div><p class="u-label">Fonte visual</p><h2 id="source-heading">Ilustração anatómica</h2></div></div>
            <div class="anatomy-source-frame"><img id="anatomy-source-image" src="${SOURCE_URL}" alt="Diagrama didáctico do coração humano com câmaras, válvulas e vasos assinalados"></div>
            <p class="anatomy-credit">Wapcaplet / Yaddah · Wikimedia Commons · <a href="${SOURCE_REFERENCE}" target="_blank" rel="noreferrer">CC BY-SA 3.0</a></p>
            <label class="anatomy-upload">Usar outra imagem <input id="anatomy-upload" type="file" accept="image/png,image/jpeg"></label>
            <label class="anatomy-field">Referência da fonte <input id="source-reference" value="${SOURCE_REFERENCE}" maxlength="500"></label>
            <button class="u-btn u-btn--primary anatomy-action" id="analyse-image" type="button">Analisar com Meta Muse Spark</button>
            <p class="anatomy-inline-note">JPEG/PNG · 64–4096 px por lado · máximo 12 MP e 10 MB. Sem escala física.</p>
          </section>
          <section class="anatomy-card anatomy-observation-card" aria-labelledby="observation-heading">
            <div class="anatomy-section-title"><span class="anatomy-index">02</span><div><p class="u-label">Observação original</p><h2 id="observation-heading">Meta Muse Spark</h2></div></div>
            <div id="meta-observation" class="anatomy-observation-placeholder">A resposta live aparecerá separada das decisões de revisão.</div>
          </section>
          <section class="anatomy-card anatomy-review-card" aria-labelledby="review-heading">
            <div class="anatomy-section-title"><span class="anatomy-index">03</span><div><p class="u-label">Decisão humana</p><h2 id="review-heading">Revisão local</h2></div></div>
            <p class="anatomy-inline-note">Cada observação, hipótese e relação precisa de decisão. A interface não verifica identidade.</p>
            <div id="review-list" class="anatomy-review-list"><p class="anatomy-muted">A revisão fica disponível depois da observação Meta.</p></div>
            <button class="u-btn u-btn--outline anatomy-action" id="build-scene" type="button" disabled>Aplicar decisões ao atlas 3D</button>
          </section>
          <section class="anatomy-card anatomy-component-card" aria-labelledby="component-heading" hidden>
            <div class="anatomy-section-title"><span class="anatomy-index">04</span><div><p class="u-label">Componente do atlas</p><h2 id="component-heading">Selecção 3D</h2></div></div>
            <div id="component-list" class="anatomy-component-list"></div>
            <p id="component-inspector" class="anatomy-inspector">Seleccione uma estrutura para a identificar.</p>
            <p class="anatomy-license-note">Modelo de referência estático BodyParts3D 4.0 · CC BY 4.0 · adulto masculino · paredes ventriculares combinadas.</p>
          </section>
        </aside>
        <section class="anatomy-stage-column">
          <div class="anatomy-stage-wrap" id="anatomy-stage-wrap">
            <div class="anatomy-canvas-host" id="anatomy-canvas"></div>
            <div class="anatomy-stage-empty" id="stage-empty"><div><span>ATLAS DE REFERÊNCIA</span><h2>Um modelo educativo, independente da imagem</h2><p>O atlas só é associado depois da revisão completa. Não é geometria reconstruída.</p></div></div>
            <div class="anatomy-stage-label" id="stage-label" hidden><span>ESTRUTURA SELECCIONADA</span><strong></strong></div>
            <div class="anatomy-stage-credits" id="stage-credits" hidden>BodyParts3D · CC BY 4.0</div>
          </div>
          <section class="anatomy-timeline" aria-labelledby="timeline-heading">
            <div class="anatomy-timeline-title"><div><p class="u-label">05 · Sequência didáctica</p><h2 id="timeline-heading">Ciclo cardíaco ilustrativo</h2></div><span class="anatomy-illustrative-tag">ANIMAÇÃO · NÃO É SIMULAÇÃO VALIDADA</span></div>
            <div class="anatomy-timeline-controls"><button type="button" id="cycle-play" class="u-btn u-btn--outline" disabled>Reproduzir</button><input id="cycle-time" type="range" min="0" max="4" step="0.01" value="0" aria-label="Instante do ciclo ilustrativo" disabled><output id="cycle-time-readout">0,00 / 4,00 s</output></div>
            <div class="anatomy-phases" id="cycle-phases"><span data-phase="fill">Enchimento</span><span data-phase="atria">Fase auricular</span><span data-phase="ventricles">Fase ventricular</span><span data-phase="rest">Relaxamento</span></div>
            <p id="cycle-caption" class="anatomy-cycle-caption">Esta sequência apenas destaca grupos do atlas. Não anima deformação, não calcula fluxo ou pressão, e não está validada como fisiologia.</p>
          </section>
        </section>
      </div>
      <footer class="anatomy-disclaimer">Protótipo educativo. Sem diagnóstico, medição médica ou reconstrução anatómica fiel à fotografia. Escala e dimensões físicas: desconhecidas.</footer>
    </main>`;

  const $ = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
  const status = $('#anatomy-status'); const sourceImage = $<HTMLImageElement>('#anatomy-source-image'); const fileInput = $<HTMLInputElement>('#anatomy-upload'); const sourceRef = $<HTMLInputElement>('#source-reference');
  let sourceBlob: Blob | undefined; let submittedBlob: Blob | undefined; let previewUrl: string | undefined; let observation: AnatomyObservationV1 | undefined; let review: AnatomyReviewV1 | undefined; let proposal: AnatomySceneProposal | undefined; let metaCallLog: unknown; let viewer: HeartViewer | undefined; let playFrame = 0; let playing = false; let timeS = 0; let lastTick = 0;

  const setStatus = (text: string) => { status.textContent = text; };
  const updateSteps = (complete: string[]) => app.querySelectorAll<HTMLElement>('[data-step]').forEach((step) => { step.classList.toggle('is-complete', complete.includes(step.dataset.step ?? '')); step.classList.toggle('is-current', !complete.includes(step.dataset.step ?? '') && complete[complete.length - 1] === (['source','meta','review','scene','timeline'][complete.length - 1])); });
  const setDefaultImageBlob = async () => { const response = await fetch(SOURCE_URL); if (!response.ok) throw new Error('A ilustração local não foi carregada.'); sourceBlob = await response.blob(); };
  const validateImageDimensions = async (blob: Blob) => {
    if (blob.size > 10_000_000) throw new Error('A imagem excede 10 MB.');
    const url = URL.createObjectURL(blob);
    try { const image = new Image(); image.src = url; await image.decode(); if (image.width < 64 || image.height < 64 || image.width > 4096 || image.height > 4096 || image.width * image.height > 12_000_000) throw new Error('Imagem fora dos limites: 64–4096 px por lado e máximo 12 MP.'); }
    finally { URL.revokeObjectURL(url); }
  };
  await setDefaultImageBlob();
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try { await validateImageDimensions(file); sourceBlob = file; submittedBlob = undefined; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(file); sourceImage.src = previewUrl; sourceRef.value = `upload:${file.name}`; observation = undefined; review = undefined; proposal = undefined; viewer?.dispose(); viewer = undefined; app.querySelector<HTMLElement>('.anatomy-component-card')!.hidden = true; $('#stage-empty').hidden = false; $('#stage-credits').hidden = true; $('#cycle-play').setAttribute('disabled', ''); $<HTMLInputElement>('#cycle-time').setAttribute('disabled', ''); $('#meta-observation').innerHTML = '<p class="anatomy-muted">A imagem mudou; a observação anterior deixou de ser aplicável.</p>'; $('#review-list').innerHTML = '<p class="anatomy-muted">A revisão fica disponível depois da observação Meta.</p>'; $('#build-scene').setAttribute('disabled', ''); setStatus('Nova imagem pronta · análise pendente'); } catch (error) { fileInput.value = ''; setStatus(error instanceof Error ? error.message : 'Imagem inválida.'); }
  });

  const blobDataUrl = async (blob: Blob): Promise<{ dataUrl: string; sha256: string }> => {
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Falha ao ler a imagem.')); reader.onerror = () => reject(new Error('Falha ao ler a imagem.')); reader.readAsDataURL(blob); });
    return { dataUrl, sha256 };
  };
  const prepareSubmission = async (blob: Blob): Promise<Blob> => {
    if (blob.type !== 'image/svg+xml') return blob;
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D indisponível para rasterizar a ilustração.');
      context.drawImage(image, 0, 0);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Falha ao rasterizar a ilustração.')), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  };
  const renderOriginal = (original: AnatomyObservationV1) => {
    const sections = [
      ...original.structures.map((x) => `<li><strong>${esc(x.label)}</strong><span>${esc(x.id)} · ${esc(x.status)} · ${Math.round(x.confidence * 100)}%</span><small>${x.evidence.map((e) => esc(e.detail)).join(' · ') || 'Sem evidência explícita.'}</small></li>`),
      ...original.relations.map((x) => `<li><strong>${esc(x.relation)}</strong><span>${esc(x.from)} → ${esc(x.to)} · ${esc(x.status)}</span><small>${x.evidence.map((e) => esc(e.detail)).join(' · ') || 'Sem evidência explícita.'}</small></li>`),
      ...original.hypotheses.map((x) => `<li><strong>Hipótese · ${esc(x.statement)}</strong><span>${Math.round(x.confidence * 100)}% de confiança declarada pelo modelo</span><small>${x.evidence.map((e) => esc(e.detail)).join(' · ')}</small></li>`),
    ];
    $('#meta-observation').innerHTML = `<p class="anatomy-source-badge"><span></span>Muse Spark · live · ${esc(original.subjectDisposition)}</p><p class="anatomy-muted">Classificação da imagem: ${original.subjectEvidence.map((e) => esc(e.detail)).join(' · ')}</p><ul class="anatomy-observation-list">${sections.join('')}</ul><div class="anatomy-unknowns"><strong>Incertezas / desconhecidos</strong><ul>${original.uncertainties.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><p class="anatomy-provenance">Imagem SHA-256 · <code>${original.source.sha256.slice(0, 14)}…</code><br>Observação preservada em separado da revisão.</p>`;
  };
  const renderReview = (original: AnatomyObservationV1) => {
    const items: Array<{ id: string; kind: string; label: string; status: string; canCorrect: boolean }> = [
      ...original.structures.map((x) => ({ id: x.id, kind: 'Estrutura', label: x.label, status: x.status, canCorrect: true })),
      ...original.relations.map((x) => ({ id: x.id, kind: 'Relação', label: `${x.from} → ${x.to} · ${x.relation}`, status: x.status, canCorrect: false })),
      ...original.hypotheses.map((x) => ({ id: x.id, kind: 'Hipótese', label: x.statement, status: 'hypothesis', canCorrect: false })),
    ];
    $('#review-list').innerHTML = items.length ? items.map((item) => `<article class="anatomy-review-item" data-review-id="${esc(item.id)}"><div><span class="anatomy-review-kind">${esc(item.kind)} · ${esc(item.status)}</span><strong>${esc(item.label)}</strong></div><label>Decisão<select data-review-choice aria-label="Decisão para ${esc(item.id)}"><option value="">Pendente</option><option value="accept">Aceitar</option><option value="reject">Rejeitar</option>${item.canCorrect ? '<option value="correct">Corrigir componente</option>' : ''}</select></label>${item.canCorrect ? `<label data-correction-wrap hidden>Componente corrigido<select data-correction><option value="">Seleccionar componente</option>${ANATOMY_COMPONENTS.map((id) => `<option value="${id}">${esc(HEART_COMPONENT_LABELS[id])}</option>`).join('')}</select></label>` : ''}<label>Nota opcional<input data-review-note maxlength="300" placeholder="Nota da decisão"></label></article>`).join('') : '<p class="anatomy-muted">Sem estruturas candidatas; nenhuma geometria será ligada.</p>';
    $('#review-list').querySelectorAll<HTMLSelectElement>('[data-review-choice]').forEach((select) => select.addEventListener('change', () => { const wrap = select.closest('.anatomy-review-item')?.querySelector<HTMLElement>('[data-correction-wrap]'); if (wrap) wrap.hidden = select.value !== 'correct'; validateReviewReadiness(); }));
    validateReviewReadiness();
  };
  const validateReviewReadiness = () => {
    const cards = [...$('#review-list').querySelectorAll<HTMLElement>('.anatomy-review-item')];
    const complete = cards.length > 0 && cards.every((card) => {
      const choice = card.querySelector<HTMLSelectElement>('[data-review-choice]')?.value;
      const correction = card.querySelector<HTMLSelectElement>('[data-correction]');
      return !!choice && (choice !== 'correct' || !!correction?.value);
    });
    $('#build-scene').toggleAttribute('disabled', !complete); return complete;
  };
  $('#analyse-image').addEventListener('click', async () => {
    try {
      if (!sourceBlob) await setDefaultImageBlob();
      await validateImageDimensions(sourceBlob!);
      const reference = sourceRef.value.trim(); if (!reference || reference.length > 500) throw new Error('Indique uma referência à fonte da imagem.');
      $('#analyse-image').setAttribute('disabled', ''); setStatus('A enviar imagem · Meta Muse Spark live…');
      submittedBlob = await prepareSubmission(sourceBlob!);
      await validateImageDimensions(submittedBlob);
      const { dataUrl, sha256 } = await blobDataUrl(submittedBlob);
      const response = await fetch('/api/anatomy/observe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageDataUrl: dataUrl, sourceReference: reference }) });
      const payload = await response.json() as { contract?: string; status?: string; observation?: unknown; error?: { message?: string }; meta?: { requestId?: string; model?: string } };
      if (!response.ok || payload.contract !== 'unfold.anatomy_observation.v1' || !payload.observation) throw new Error(payload.error?.message ?? `Meta falhou (${response.status}).`);
      observation = anatomyDomainAdapter.validateObservation(payload.observation);
      if (observation.source.sha256 !== sha256 || observation.source.reference !== reference) throw new Error('A proveniência da resposta Meta não corresponde à imagem enviada.');
      if (observation.subjectDisposition !== 'heart_illustration') { renderOriginal(observation); $('#review-list').innerHTML = '<p class="anatomy-muted">Sem revisão de modelo incompatível; não é possível avançar para o atlas cardíaco.</p>'; setStatus('Domínio incompatível ou incerto · montagem bloqueada'); updateSteps(['source','meta']); return; }
      metaCallLog = payload.meta; renderOriginal(observation); renderReview(observation); proposal = undefined;
      setStatus(`Meta live · ${payload.meta?.model ?? 'Muse Spark'} · revisão pendente`); updateSteps(['source','meta']);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Não foi possível analisar a imagem.'); }
    finally { $('#analyse-image').removeAttribute('disabled'); }
  });

  const selectComponent = (componentId: string | null) => {
    viewer?.select(componentId);
    const label = componentId ? HEART_COMPONENT_LABELS[componentId as keyof typeof HEART_COMPONENT_LABELS] : '';
    $('#component-inspector').textContent = label ? `${label} · atlas de referência, não identificado clinicamente.` : 'Seleccione uma estrutura para a identificar.';
    const badge = $('#stage-label'); badge.hidden = !label; badge.querySelector('strong')!.textContent = label;
    $('#component-list').querySelectorAll<HTMLButtonElement>('[data-component]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.component === componentId)));
  };
  $('#build-scene').addEventListener('click', async () => {
    if (!observation || !validateReviewReadiness()) { setStatus('Revisão incompleta · modelo bloqueado.'); return; }
    const decisions: ReviewDecision[] = [...$('#review-list').querySelectorAll<HTMLElement>('.anatomy-review-item')].map((card) => {
      const decision = card.querySelector<HTMLSelectElement>('[data-review-choice]')!.value as ReviewDecision['decision'];
      return { targetId: card.dataset.reviewId!, decision, correctedComponentId: decision === 'correct' ? card.querySelector<HTMLSelectElement>('[data-correction]')!.value as ReviewDecision['correctedComponentId'] : null, note: card.querySelector<HTMLInputElement>('[data-review-note]')!.value.trim() || null };
    });
    const candidate = { schema: 'unfold.anatomy_review.v1', reviewId: crypto.randomUUID(), observationId: observation.observationId, sourceSha256: observation.source.sha256, actor: { kind: 'client_unverified', identityVerified: false }, decisions };
    try {
      review = anatomyDomainAdapter.validateReview(candidate, observation); proposal = anatomyDomainAdapter.adapt(observation, review);
      $('#component-list').innerHTML = proposal.components.map((component) => `<div class="anatomy-component-row"><button type="button" class="anatomy-component-select" data-component="${esc(component.componentId)}" aria-pressed="false"><span class="anatomy-dot"></span><span><strong>${esc(HEART_COMPONENT_LABELS[component.componentId as keyof typeof HEART_COMPONENT_LABELS])}</strong><small>${esc(component.observationStatus)} · ${esc(component.reviewDecision)}</small></span></button><label title="Mostrar ou ocultar estrutura"><input type="checkbox" data-visible="${esc(component.componentId)}" checked> visível</label></div>`).join('') || '<p class="anatomy-muted">Nenhum componente aceito; revisão completa, associação 3D bloqueada.</p>';
      const panel = app.querySelector<HTMLElement>('.anatomy-component-card')!; panel.hidden = false;
      $('#component-list').querySelectorAll<HTMLButtonElement>('[data-component]').forEach((button) => button.addEventListener('click', () => selectComponent(button.dataset.component ?? null)));
      $('#component-list').querySelectorAll<HTMLInputElement>('[data-visible]').forEach((input) => input.addEventListener('change', () => viewer?.setVisible(input.dataset.visible!, input.checked)));
      $('#stage-empty').hidden = true; $('#stage-credits').hidden = false;
      viewer = await mountHeartViewer($('#anatomy-canvas'), selectComponent, matchMedia('(prefers-reduced-motion: reduce)').matches);
      for (const component of proposal.components) viewer.setVisible(component.componentId, true);
      selectComponent(proposal.components[0]?.componentId ?? null);
      $('#cycle-play').removeAttribute('disabled'); $('#cycle-time').removeAttribute('disabled');
      $('#cycle-time').addEventListener('input', () => { timeS = Number($<HTMLInputElement>('#cycle-time').value); updatePhase(); });
      setStatus(`Revisão local concluída · identidade não verificada · ${proposal.components.length} componente(s) associados.`);
      updateSteps(['source','meta','review','scene']);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Revisão inválida.'); }
  });

  const updatePhase = () => {
    if (!proposal) return;
    const phase = activePhaseAt(proposal, timeS); viewer?.setIllustrativePhase(phase.id);
    $('#cycle-time-readout').textContent = `${timeS.toFixed(2).replace('.', ',')} / ${proposal.motion.durationS.toFixed(2).replace('.', ',')} s`;
    $('#cycle-caption').textContent = `${phase.label} · ${phase.note} Ciclo ilustrativo, sem validação fisiológica.`;
    app.querySelectorAll<HTMLElement>('[data-phase]').forEach((el) => el.classList.toggle('is-active', el.dataset.phase === phase.id));
  };
  const tick = (now: number) => {
    if (!playing) return;
    if (lastTick) timeS += (now - lastTick) / 1000;
    lastTick = now; if (timeS >= 4) timeS = 0;
    $<HTMLInputElement>('#cycle-time').value = String(timeS); updatePhase(); playFrame = requestAnimationFrame(tick);
  };
  $('#cycle-play').addEventListener('click', () => {
    if (!proposal) return; playing = !playing; $('#cycle-play').textContent = playing ? 'Pausar' : 'Reproduzir'; lastTick = 0;
    if (playing) playFrame = requestAnimationFrame(tick); else cancelAnimationFrame(playFrame);
  });
  if (new URLSearchParams(location.search).has('debug-anatomy')) {
    (window as unknown as { __unfoldAnatomy?: unknown }).__unfoldAnatomy = {
      observation: () => observation, review: () => review, proposal: () => proposal,
      meta: () => metaCallLog,
      componentMeshes: () => viewer?.meshNames ?? [],
      sourceShaMatches: async () => submittedBlob ? (await blobDataUrl(submittedBlob)).sha256 === observation?.source.sha256 : false,
    };
  }
  window.addEventListener('pagehide', () => { cancelAnimationFrame(playFrame); playing = false; viewer?.dispose(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
}

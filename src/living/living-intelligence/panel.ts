/**
 * Painel Living Intelligence dentro de `/living` (atrás de flag experimental).
 * Centro continua a ser o palco 3D existente; este painel só comanda o motor transitório
 * através da porta estreita do workspace (selecção, poses transitórias, reset existente).
 */
import type { Assembly } from '../contracts';
import { buildLivingScene, entityById, type LivingScene } from './contracts';
import { LivingMotionEngine } from './motion';
import { parseIntent, validateCommand, actuatorTargetFor } from './intents';
import { explainEntity, whoMoves, buildWalkthrough, WalkthroughPlayer, type ExplanationLevel } from './tutor';
import { excavatorExperiments, type Experiment } from './experiments';
import { WHEEL_STEERING_ASSEMBLY, DOOR_ASSEMBLY, FIXTURE_PROVENANCE } from './fixtures';
import { serializeScenario, parseScenario, scenarioStorageKey } from './scenario-store';
import { buildSpaceLivingScene, explainSpaceComponent, SpaceMotionController, type SpaceLivingScene } from './space-bridge';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import './living-intelligence.css';

export type LivingWorkspacePort = {
  livingAssembly(): Assembly;
  applyLivingFrame(parts: ReadonlyArray<{ partId: string; translationM: [number, number, number]; rotation: [number, number, number, number] }>): void;
  select(id: string): void;
  pointAt(id: string, state: 'attention' | 'select', by: 'assistant', note?: string | null): { resolved: boolean };
  resetPose(): void;
  readonly reducedMotion?: boolean;
  livingSpacePlan?(): SpatialPlanV2 | null;
  applyLivingSpacePose?(id: string, angleRad: number, axis: 'x' | 'y' | 'z'): boolean;
  clearLivingSpacePoses?(): void;
};

type Mode = 'explore' | 'understand' | 'animate' | 'experiment';
const MODES: Array<[Mode, string]> = [['explore', 'Explorar'], ['understand', 'Compreender'], ['animate', 'Animar'], ['experiment', 'Experimentar']];
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class LivingIntelligencePanel {
  private root: HTMLElement;
  private scene: LivingScene;
  private assembly: Assembly;
  private engine: LivingMotionEngine;
  private mode: Mode = 'explore';
  private selectedId: string | null = 'boom';
  private output = 'Motor vivo pronto. Pergunte "o que faz o cilindro da lança?" ou "estende o cilindro". Movimento é estado transitório: o plano autoritativo não muda.';
  private raf = 0; private lastTs = 0; private disposed = false;
  private walk: WalkthroughPlayer | null = null;
  private experiments: Experiment[];
  private demoAssembly: Assembly;
  private demoEngine: LivingMotionEngine;
  private spacePlan: SpatialPlanV2 | null = null;
  private spaceScene: SpaceLivingScene | null = null;
  private spaceMotion = new SpaceMotionController();
  private spaceEntityId: string | null = null;
  private spaceOpen = false;

  constructor(host: HTMLElement, private port: LivingWorkspacePort) {
    this.assembly = port.livingAssembly();
    this.demoAssembly = this.assembly;
    this.scene = buildLivingScene(this.assembly);
    this.engine = new LivingMotionEngine(this.assembly, { reducedMotion: port.reducedMotion ?? false });
    this.demoEngine = this.engine;
    this.experiments = excavatorExperiments(this.assembly, FIXTURE_PROVENANCE);
    this.root = document.createElement('section');
    this.root.className = 'li-panel'; this.root.dataset.testid = 'living-intelligence';
    this.root.setAttribute('aria-label', 'Living Intelligence (experimental)');
    host.appendChild(this.root);
    this.restoreScenario();
    this.render(); this.applyFrame();
  }

  private restoreScenario() {
    try {
      const saved = parseScenario(localStorage.getItem(scenarioStorageKey(this.assembly.id)), this.assembly.id);
      if (saved && Object.keys(saved.actuatorValues).length) {
        const r = this.engine.moveToActuators(saved.actuatorValues, 0.1);
        if (r.ok) this.output = 'Cenário guardado reaberto: valores de actuador restaurados como estado transitório.';
      }
    } catch { /* armazenamento indisponível: a experiência continua sem persistência */ }
  }

  private say(text: string) { this.output = text; this.render(); }

  /** Space activo mudou (o shell chama por geração): todo o estado vivo anterior fica inválido. */
  attachSpace(plan: SpatialPlanV2 | null, planFingerprint = ''): void {
    if (this.disposed) return;
    this.spaceMotion.cancel();
    this.port.clearLivingSpacePoses?.();
    this.spacePlan = plan;
    this.spaceScene = plan ? buildSpaceLivingScene(plan, planFingerprint) : null;
    this.spaceEntityId = this.spaceScene?.entities[0]?.id ?? null;
    this.spaceOpen = false;
    if (plan) this.say(`Space activo ligado ao motor vivo: ${plan.title}. ${this.spaceScene!.motionSupported ? 'Há componentes articulados inferidos do plano; o movimento é uma demonstração marcada como inferida.' : `Sem mecanismo declaratório suficiente para mover. Em falta: ${this.spaceScene!.missingForMotion.join('; ')}.`}`);
    else this.render();
  }

  private runSpaceMotion(open: boolean): void {
    const scene = this.spaceScene, id = this.spaceEntityId;
    if (!scene || !id) return;
    const entity = scene.entities.find((e) => e.id === id);
    if (!entity || entity.capability.kind !== 'revolute') { this.say(`Sem movimento suportado para ${entity?.label ?? id}: ${entity?.capability.reason ?? 'componente desconhecido'}. Em falta: ${scene.missingForMotion.join('; ')}.`); return; }
    const cap = entity.capability;
    const target = open ? cap.demoRangeRad : 0;
    const started = this.spaceMotion.start(target, cap.demoRangeRad, this.port.reducedMotion ?? false);
    if (!started.ok) { this.say(started.message); return; }
    this.spaceOpen = open;
    this.say(`${open ? 'A abrir' : 'A fechar'} ${entity.label}: demonstração inferida em torno de ${cap.axis} até ${target.toFixed(2)} rad (amplitude conceptual, sem limites declarados no plano). Pose transitória — o plano autoritativo não muda.`);
    const token = this.spaceMotion.token;
    const t0 = performance.now();
    let last = t0;
    const tick = (now: number) => {
      if (this.disposed || token !== this.spaceMotion.token) return;
      const angle = this.spaceMotion.step(Math.min(0.05, (now - last) / 1000), token); last = now;
      this.port.applyLivingSpacePose?.(id, angle, cap.axis);
      if (this.spaceMotion.state === 'playing') requestAnimationFrame(tick); else this.render();
    };
    requestAnimationFrame(tick);
  }

  private selectEntity(id: string) {
    this.selectedId = id;
    this.port.select(id);
    const pointed = this.port.pointAt(id, 'attention', 'assistant');
    const e = entityById(this.scene, id);
    this.say(`${e?.label ?? id} seleccionado${pointed.resolved ? ' e apontado no palco' : ''}. ${e ? `Capacidades: ${e.capabilities.map(c => `${c.kind} (${c.status})`).join(', ') || 'nenhuma declarada'}.` : ''}`);
  }

  private runMove(actuatorId: string, fraction: number) {
    const target = actuatorTargetFor(this.demoAssembly, actuatorId, fraction);
    if (target === null) { this.say(`Actuador sem alvo calculável: ${actuatorId}.`); return; }
    const r = this.demoEngine.moveToActuators({ [actuatorId]: target }, 2.4);
    if (!r.ok) { this.say(`Movimento recusado (${r.code}): ${r.message}`); return; }
    this.mode = 'animate';
    this.say(`A animar ${actuatorId} → ${target.toFixed(3)} (motor determinístico, fecho de laço verificado na trajectória). Use Pausa/Continuar/Inverter/Repor.`);
    this.startLoop();
  }

  private startLoop() {
    if (this.raf || this.disposed) return;
    const gen = this.demoEngine.generationToken;
    const tick = (ts: number) => {
      if (this.disposed || gen !== this.demoEngine.generationToken) { this.raf = 0; return; }
      const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0.016;
      this.lastTs = ts;
      const frame = this.demoEngine.step(dt, gen);
      if (this.demoAssembly.id === this.assembly.id) this.port.applyLivingFrame(frame.parts);
      if (this.demoEngine.state === 'playing' || this.demoEngine.state === 'reversed') { this.raf = requestAnimationFrame(tick); }
      else { this.raf = 0; this.render(); }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private applyFrame() {
    try { const f = this.engine.frame(); if (this.demoAssembly.id === this.assembly.id) this.port.applyLivingFrame(f.parts); } catch { /* palco vazio */ }
  }

  private explain(id: string, level: ExplanationLevel = 'beginner') {
    const ex = explainEntity(this.sceneForDemo(), this.demoAssembly, id, level);
    if (!ex) { this.say(`Sem explicação: componente desconhecido (${id}).`); return; }
    this.mode = 'understand';
    this.say(`${ex.what}\nPara que serve: ${ex.purpose}\nComo funciona: ${ex.howItWorks}\nQuando se move: ${ex.whenItMoves}\nDepende de: ${ex.dependencies.join(', ') || 'nada declarado'}.\nDesconhecido: ${ex.unknowns.join(', ') || 'nada registado'}.\n${ex.evidenceNote}`);
  }
  private sceneForDemo(): LivingScene { return this.demoAssembly.id === this.assembly.id ? this.scene : buildLivingScene(this.demoAssembly); }

  private execute(raw: string) {
    const scene = this.sceneForDemo();
    const cmd = parseIntent(scene, raw);
    const validation = validateCommand(scene, this.demoAssembly, cmd, scene.sourceRevision);
    if (cmd.type === 'propose_parameter') {
      this.mode = 'experiment';
      this.say('Isso é uma alteração de parâmetro. Não a aplico ao plano: corro-a como experiência transitória comparável (separador Experimentar, experiência do braço de alavanca). Alterações autoritativas continuam a exigir a revisão existente.');
      this.render(); return;
    }
    if (!validation.ok) { this.say(`Recusado (${validation.code}): ${validation.message}`); return; }
    switch (cmd.type) {
      case 'show': this.selectEntity(cmd.entityId); break;
      case 'explain': this.selectEntity(cmd.entityId); this.explain(cmd.entityId, cmd.level); break;
      case 'who_moves': { const w = whoMoves(scene, this.demoAssembly, cmd.entityId); this.selectEntity(cmd.entityId); this.say(w?.text ?? 'Sem dados.'); } break;
      case 'limit_question': {
        const e = entityById(scene, cmd.entityId); const cap = e?.capabilities[0];
        this.say(cap && cap.min !== null ? `${e?.label}: a junta ${cap.jointId} pára em [${cap.min}, ${cap.max}] ${cap.unit}. Ao atingir o limite o motor bloqueia o movimento (fail-closed) e mantém a última pose válida; nada parte nem força o limite.` : `${e?.label}: sem limites declarados nesta cena — por isso não demonstro esse movimento.`);
      } break;
      case 'move_actuator': this.selectEntity(cmd.actuatorId); this.runMove(cmd.actuatorId, cmd.fraction); break;
      case 'playback':
        if (cmd.action === 'pause' || cmd.action === 'stop') this.demoEngine.pause();
        else if (cmd.action === 'resume') { this.demoEngine.resume(); this.startLoop(); }
        else if (cmd.action === 'reverse') { this.demoEngine.reverse(); this.startLoop(); }
        else if (cmd.action === 'reset') { this.demoEngine.reset(); this.port.resetPose(); }
        this.say(`Reprodução: ${cmd.action}. Estado: ${this.demoEngine.state}.`); break;
      case 'walkthrough': this.startWalkthrough(); break;
      default: this.say('Comando sem efeito.');
    }
    this.render();
  }

  private startWalkthrough() {
    this.walk = new WalkthroughPlayer(buildWalkthrough(this.sceneForDemo(), this.demoAssembly));
    this.mode = 'understand'; this.showWalkStep();
  }
  private showWalkStep() {
    const step = this.walk?.current(); if (!step) return;
    this.selectedId = step.entityId; this.port.select(step.entityId); this.port.pointAt(step.entityId, 'attention', 'assistant');
    if (step.actuatorId && step.actuatorTarget !== null) {
      const cyl = this.demoAssembly.actuators.find(a => a.id === step.actuatorId);
      if (cyl?.kind === 'hydraulic_cylinder') { const r = this.demoEngine.moveToActuators({ [cyl.id]: step.actuatorTarget }, 2); if (r.ok) this.startLoop(); }
    }
    this.say(`Passo ${step.index + 1}/${this.walk!.walkthrough.steps.length} — ${step.title}: ${step.text}`);
    this.render();
  }

  private render() {
    if (this.disposed) return;
    const scene = this.sceneForDemo();
    const entities = scene.entities.map(e => `<button type="button" class="li-chip" data-entity="${esc(e.id)}" aria-pressed="${e.id === this.selectedId}">${esc(e.label)}</button>`).join('');
    const experiments = this.demoAssembly.id === this.assembly.id ? this.experiments.map((x, i) => `<div class="li-exp"><p><strong>${esc(x.question)}</strong></p><label>${esc(x.adjustable[0]!)} <input type="number" step="0.05" data-exp-input="${i}" value="${i === 2 ? '0.1' : '0.55'}"></label> <button type="button" class="li-btn" data-exp="${i}">Correr experiência</button></div>`).join('') : '<p>Experiências físicas guiadas estão definidas para a escavadora; nesta demonstração use Animar.</p>';
    this.root.innerHTML = `
      <header class="li-head"><strong>Living Intelligence</strong><span class="li-badge">experimental · transitório</span></header>
      <nav class="li-modes" aria-label="Modos">${MODES.map(([m, l]) => `<button type="button" data-mode="${m}" aria-pressed="${m === this.mode}">${l}</button>`).join('')}</nav>
      <div class="li-demos" role="group" aria-label="Demonstrações">
        <button type="button" data-demo="excavator">Escavadora</button><button type="button" data-demo="wheel">Roda e direcção</button><button type="button" data-demo="door">Porta</button>
      </div>
      ${this.spaceScene ? `<div class="li-space" data-li-space>
        <p><strong>Space activo:</strong> ${esc(this.spaceScene.title)} <span class="li-badge">fonte ${esc(this.spaceScene.sourceKind)} · ${esc(this.spaceScene.sourceSha256.slice(0, 10))}…</span></p>
        <div class="li-entities">${this.spaceScene.entities.map((e) => `<button type="button" class="li-chip" data-space-entity="${esc(e.id)}" aria-pressed="${e.id === this.spaceEntityId}">${esc(e.label)} · ${esc(e.capability.kind === 'revolute' ? 'rotação inferida' : e.capability.kind)}</button>`).join('')}</div>
        <div class="li-controls">
          <button type="button" data-space-explain>Explicar componente</button>
          <button type="button" data-space-motion="open">Mover (demonstração inferida)</button>
          <button type="button" data-space-motion="close">Fechar/Repor</button>
          <button type="button" data-space-pause>Pausa/Continuar</button>
        </div>
        ${this.spaceScene.motionSupported ? '' : `<p class="li-note">Movimento indisponível neste Space. Em falta: ${esc(this.spaceScene.missingForMotion.join('; '))}. Interacções suportadas: identificar, explicar, seleccionar e enquadrar.</p>`}
      </div>` : ''}
      <div class="li-entities">${entities}</div>
      <form class="li-command"><label>Comando ou pergunta<input data-li-input type="text" placeholder="O que faz o cilindro da lança?" autocomplete="off"></label><button type="submit" class="li-btn">Executar</button></form>
      <div class="li-controls" role="group" aria-label="Reprodução">
        <button type="button" data-play="play">Reproduzir</button><button type="button" data-play="pause">Pausa</button>
        <button type="button" data-play="resume">Continuar</button><button type="button" data-play="reverse">Inverter</button>
        <button type="button" data-play="reset">Repor</button>
        <label>Velocidade <select data-li-speed><option>0.5</option><option selected>1</option><option>2</option></select></label>
        <span data-li-state>${this.demoEngine.state} · ${this.demoEngine.currentTimeS.toFixed(2)}/${this.demoEngine.totalDurationS.toFixed(2)}s · fecho ${this.demoEngine.closureOk() ? 'OK' : 'FALHOU'}</span>
      </div>
      <div class="li-walk" role="group" aria-label="Explicação guiada">
        <button type="button" data-walk="start">Explicação passo a passo</button><button type="button" data-walk="prev">Anterior</button>
        <button type="button" data-walk="next">Seguinte</button><button type="button" data-walk="replay">Repetir</button>
        <button type="button" data-li-explain>Explicar seleccionado</button><button type="button" data-li-save>Guardar cenário</button>
      </div>
      ${this.mode === 'experiment' ? `<div class="li-experiments">${experiments}</div>` : ''}
      <pre class="li-output" role="status" aria-live="polite" data-li-output>${esc(this.output)}</pre>
      <p class="li-note">Capacidades suportadas: ${scene.supported.length} · indisponíveis: ${scene.unavailable.length}. Evidência: cinemática validada pelo motor — não é física validada nem capacidade real da máquina.</p>`;
    this.bind();
  }

  private bind() {
    this.root.querySelectorAll<HTMLElement>('[data-space-entity]').forEach(b => b.addEventListener('click', () => { this.spaceEntityId = b.dataset.spaceEntity!; this.port.select(this.spaceEntityId); this.render(); }));
    this.root.querySelector<HTMLElement>('[data-space-explain]')?.addEventListener('click', () => {
      if (!this.spaceScene || !this.spacePlan || !this.spaceEntityId) return;
      this.port.select(this.spaceEntityId);
      const text = explainSpaceComponent(this.spaceScene, this.spacePlan, this.spaceEntityId);
      this.mode = 'understand';
      this.say(text ?? 'Componente desconhecido neste Space.');
    });
    this.root.querySelectorAll<HTMLElement>('[data-space-motion]').forEach(b => b.addEventListener('click', () => this.runSpaceMotion(b.dataset.spaceMotion === 'open')));
    this.root.querySelector<HTMLElement>('[data-space-pause]')?.addEventListener('click', () => {
      if (this.spaceMotion.state === 'paused') { this.spaceMotion.resume(); this.runSpaceMotion(this.spaceOpen); }
      else this.spaceMotion.pause();
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => b.addEventListener('click', () => { this.mode = b.dataset.mode as Mode; this.render(); }));
    this.root.querySelectorAll<HTMLElement>('[data-entity]').forEach(b => b.addEventListener('click', () => this.selectEntity(b.dataset.entity!)));
    this.root.querySelector<HTMLElement>('[data-li-explain]')?.addEventListener('click', () => { if (this.selectedId) this.explain(this.selectedId); });
    this.root.querySelector<HTMLElement>('[data-li-save]')?.addEventListener('click', () => {
      try { localStorage.setItem(scenarioStorageKey(this.assembly.id), serializeScenario({ assemblyId: this.assembly.id, actuatorValues: this.engine.actuatorValues(), experimentId: null, experimentInput: {}, walkthroughStep: this.walk?.index ?? 0 })); this.say('Cenário guardado localmente (estado interactivo; o plano autoritativo não foi tocado).'); }
      catch { this.say('Guardar falhou: armazenamento local indisponível.'); }
    });
    this.root.querySelectorAll<HTMLElement>('[data-demo]').forEach(b => b.addEventListener('click', () => {
      const kind = b.dataset.demo;
      this.demoAssembly = kind === 'wheel' ? WHEEL_STEERING_ASSEMBLY : kind === 'door' ? DOOR_ASSEMBLY : this.assembly;
      this.demoEngine = kind === 'excavator' ? this.engine : new LivingMotionEngine(this.demoAssembly, { reducedMotion: this.port.reducedMotion ?? false });
      this.selectedId = this.demoAssembly.parts[1]?.id ?? null;
      this.say(kind === 'excavator' ? 'Demonstração: escavadora (montada no palco).' : `Demonstração multi-domínio resolvida pelo mesmo motor FK: ${this.demoAssembly.title}. O palco mantém a escavadora; os valores de pose são calculados para esta montagem.`);
      this.render();
    }));
    this.root.querySelectorAll<HTMLElement>('[data-exp]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.exp); const exp = this.experiments[i]!; const input = this.root.querySelector<HTMLInputElement>(`[data-exp-input="${i}"]`);
      const key = exp.adjustable[0]!; const result = exp.run({ [key]: Number(input?.value ?? NaN) });
      this.say(result.ok ? `${result.summary}\nAntes: ${JSON.stringify(result.before)} · Depois: ${JSON.stringify(result.after)}\n${result.resetHint}` : `Experiência recusada (${result.code}): ${result.message}`);
    }));
    this.root.querySelectorAll<HTMLElement>('[data-walk]').forEach(b => b.addEventListener('click', () => {
      if (!this.walk && b.dataset.walk !== 'start') this.startWalkthrough();
      else if (b.dataset.walk === 'start' || b.dataset.walk === 'replay') { if (b.dataset.walk === 'replay') this.walk?.restart(); else this.walk = new WalkthroughPlayer(buildWalkthrough(this.sceneForDemo(), this.demoAssembly)); this.showWalkStep(); }
      else if (b.dataset.walk === 'next') { this.walk?.next(); this.showWalkStep(); }
      else if (b.dataset.walk === 'prev') { this.walk?.previous(); this.showWalkStep(); }
    }));
    this.root.querySelectorAll<HTMLElement>('[data-play]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.play;
      if (a === 'play') { this.demoEngine.play(); this.startLoop(); }
      else if (a === 'pause') this.demoEngine.pause();
      else if (a === 'resume') { this.demoEngine.resume(); this.startLoop(); }
      else if (a === 'reverse') { this.demoEngine.reverse(); this.startLoop(); }
      else if (a === 'reset') { this.demoEngine.reset(); if (this.demoAssembly.id === this.assembly.id) this.port.resetPose(); }
      this.say(`Reprodução: ${this.demoEngine.state}.`); this.render();
    }));
    this.root.querySelector<HTMLSelectElement>('[data-li-speed]')?.addEventListener('change', (e) => { this.demoEngine.setSpeed(Number((e.target as HTMLSelectElement).value)); });
    const form = this.root.querySelector<HTMLFormElement>('.li-command');
    form?.addEventListener('submit', (e) => { e.preventDefault(); const input = form.querySelector<HTMLInputElement>('[data-li-input]'); if (input?.value) this.execute(input.value); });
  }

  dispose() {
    this.disposed = true;
    this.spaceMotion.cancel(); this.port.clearLivingSpacePoses?.();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this.engine.cancel(); this.engine.dispose(); this.demoEngine.dispose();
    this.root.remove();
  }
}

export function mountLivingIntelligence(host: HTMLElement, port: LivingWorkspacePort): LivingIntelligencePanel {
  return new LivingIntelligencePanel(host, port);
}

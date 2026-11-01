import {
  AmbientLight, Color, DirectionalLight, FogExp2, GridHelper, Light, LineBasicMaterial, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane, PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FourBarLabScene, fourBarLabResidual } from './four-bar-lab';
import { createFitCameraView, createFocusCameraView, type CameraView } from './four-bar-lab-camera';
import { createPhase4AExperimentRequest, validatePhase4AExperimentResponse } from './phase4a-experiment';
import { PHASE4A_LENGTHS } from './phase4a-kinematics';
import { solveFourBar, type BarName, type FourBarLengths } from './kinematics';
import { parseSpatialCommand, type SpatialAction } from './spatial-command';
import { SpatialActionOrchestrator } from './spatial-orchestrator';
import { BrowserVoiceInput, type VoiceStatus } from './voice-input';
import { browserVoiceOutput } from './voice-output';
import { verifyBackendCompatibility } from './api-contract';
import { HandInteractionModel, WebcamHandTracker, type HandLandmark, type HandTrackerMetrics } from './hand-tracking';
import { assessTechnicalDocumentSimulation, handlePastedImage, requestImageAnalysis, requestImageRegionVerification, validateImageDemoFile, type ImageAnalysisResult, type ImageRegionRequest, type ImageRegionResult } from './image-demo';
import { createDocumentCorrection, type DocumentCorrection } from './document-understanding';
import { answerTechnicalDocumentQuestion, type TechnicalDocumentV1 } from './technical-document';
import { applyHumanValueDecision, createTechnicalValueReview, parseTechnicalValueReview, recordRegionalReading, selectManualEvidenceRegion, type TechnicalValueReviewV1 } from './technical-evidence';
import { applyElectricalOperation, calculateElectricalSandbox, createIndependentElectricalExample, createUserElectricalCircuit, type ElectricalSandboxV1 } from './electrical-sandbox';
import { createEmptyDemoProject, createFourBarDemoProject, parseManualFourBarParameters, type DemoProject } from './demo-project';
import { answerProjectQuestion, authorizeProposedAction, parseConversationResponse, type ConversationMessage, type ConversationContext } from './spatial-conversation';
import { parseSpatialAgentResult, SPATIAL_AGENT_REQUEST_SCHEMA, type SpatialAgentRequestV1 } from './spatial-agent';
import lockupDark from '../design-system/logos/unfold-lockup-on-dark.svg';
import plusIcon from 'lucide-static/icons/plus.svg?raw';
import imageIcon from 'lucide-static/icons/image.svg?raw';
import micIcon from 'lucide-static/icons/mic.svg?raw';
import arrowRightIcon from 'lucide-static/icons/arrow-right.svg?raw';
import settingsIcon from 'lucide-static/icons/settings-2.svg?raw';
import boxIcon from 'lucide-static/icons/box.svg?raw';
import './demo.css';
import { saveSpatialSourceImage } from './spatial-source-store';
import { executeActiveSpatialCommand, hasActiveSpatialCommandHandler } from './spatial-command-runtime';
import type { SpatialCommandOrigin, SpatialCommandState } from './spatial-command-protocol';

const API_BASE_URL = '/api';
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Elemento #app não encontrado.');

app.innerHTML = `
  <main class="demo-shell" data-theme="dark" data-demo-phase="EMPTY_LAB" data-project-state="empty" data-inspector-open="false" data-command-state="IDLE">
    <div id="demo-scene" class="demo-scene" aria-label="Laboratório espacial 3D do mecanismo de quatro barras"></div>
    <div class="demo-vignette" aria-hidden="true"></div>
    <header class="demo-header">
      <a class="demo-brand" href="/landing/" aria-label="UNFOLD — página inicial"><img class="demo-logo" src="${lockupDark}" alt="UNFOLD — Spatial Intelligence Lab" width="150" height="40" /></a>
      <nav class="demo-nav" aria-label="Navegação da experiência" data-theme="light">
        <a class="is-active" href="/demo" aria-current="page">Lab</a><button id="demo-nav-plans" type="button">Planos</button><button id="demo-open-spatial" type="button">Construir cena</button><button id="demo-nav-experiences" type="button" aria-controls="demo-actions" aria-expanded="false" hidden>Experiências</button><button id="demo-inspector-toggle" class="demo-context-toggle" type="button" aria-controls="demo-readout" aria-expanded="false" hidden>Contexto</button>
      </nav>
      <div class="demo-runtime"><i></i><span id="demo-runtime">ENTERING LAB</span></div>
    </header>

    <nav class="demo-process-rail" aria-label="Fluxo do UNFOLD" data-theme="light">
      <button class="demo-process-step is-active" type="button" data-demo-flow="capture" aria-current="step"><span>01</span><strong>Capturar</strong></button>
      <button class="demo-process-step" type="button" data-demo-flow="understand"><span>02</span><strong>Compreender</strong></button>
      <button class="demo-process-step" type="button" data-demo-flow="explore"><span>03</span><strong>Explorar</strong></button>
    </nav>

    <section id="demo-empty-state" class="demo-empty-state" aria-labelledby="demo-empty-title">
      <span class="demo-empty-kicker">laboratório espacial · pronto</span>
      <h1 id="demo-empty-title">Uma ideia é suficiente<br />para começar.</h1>
      <p>Traga uma imagem, descreva o que pretende explorar ou configure um mecanismo suportado.</p>
      <div class="demo-empty-actions" data-theme="light">
        <button id="demo-empty-photo" type="button"><span class="demo-empty-action-icon" aria-hidden="true">${imageIcon}</span><span class="demo-empty-action-copy"><strong>Adicionar imagem</strong><small>JPEG ou PNG</small></span></button>
        <button id="demo-empty-manual" type="button"><span class="demo-empty-action-icon" aria-hidden="true">${settingsIcon}</span><span class="demo-empty-action-copy"><strong>Criar mecanismo</strong><small>Configuração manual</small></span></button>
        <button id="demo-empty-example" type="button"><span class="demo-empty-action-icon" aria-hidden="true">${boxIcon}</span><span class="demo-empty-action-copy"><strong>Explorar exemplo</strong><small>Four-Bar hipotético</small></span></button>
      </div>
    </section>

    <section id="demo-manual-setup" class="demo-manual-setup" aria-labelledby="demo-manual-title" hidden data-theme="light">
      <div class="demo-manual-heading"><div><span class="demo-empty-kicker">CONFIGURAÇÃO MANUAL · QUATRO BARRAS REVOLUTAS</span><h2 id="demo-manual-title">Defina a montagem</h2></div><button id="demo-manual-close" type="button" aria-label="Fechar configuração">×</button></div>
      <p>Insira dimensões do seu projecto em milímetros. Estes valores serão classificados como fornecidos pelo utilizador, não como validação física.</p>
      <form id="demo-manual-form">
        <label>Ground <input name="ground" type="number" min="0.001" step="any" required inputmode="decimal" placeholder="mm" /></label>
        <label>Manivela <input name="crank" type="number" min="0.001" step="any" required inputmode="decimal" placeholder="mm" /></label>
        <label>Acoplador <input name="coupler" type="number" min="0.001" step="any" required inputmode="decimal" placeholder="mm" /></label>
        <label>Balancim <input name="rocker" type="number" min="0.001" step="any" required inputmode="decimal" placeholder="mm" /></label>
        <label class="demo-manual-angle">Ângulo de entrada <input name="angle" type="number" min="0" max="360" step="any" required inputmode="decimal" placeholder="graus" /></label>
        <div class="demo-manual-error" id="demo-manual-error" role="alert"></div>
        <button type="submit">Validar e abrir espaço 3D <span>→</span></button>
      </form>
    </section>

    <aside id="demo-readout" class="demo-readout" aria-label="Contexto do mecanismo" hidden data-theme="light">
      <button id="demo-readout-close" class="demo-readout-close" type="button" aria-label="Fechar contexto">×</button>
      <div class="demo-panel-kicker">MECANISMO ACTIVO</div>
      <div class="demo-panel-title"><h1>Four-Bar</h1><span>LAB</span></div>
      <p id="demo-status-copy">Mecanismo planar de quatro barras, resolvido pelo solver determinístico.</p>
      <div class="demo-mechanism-specs" aria-label="Reference parameters">
        <div><span class="spec-dot steel"></span><span>Ground</span><strong id="demo-ground-length">—</strong></div><div><span class="spec-dot copper"></span><span>Crank</span><strong id="demo-crank-length">—</strong></div><div><span class="spec-dot ivory"></span><span>Coupler</span><strong id="demo-coupler-length">—</strong></div><div><span class="spec-dot olive"></span><span>Rocker</span><strong id="demo-rocker-length">—</strong></div>
      </div>
      <div class="demo-readout-rule"></div>
      <div class="demo-panel-kicker">COMPONENTE SELECCIONADO</div>
      <div class="demo-component-title"><span class="demo-selection-mark"></span><strong id="demo-selection">Nenhum componente seleccionado</strong></div>
      <div class="demo-component-card"><span id="demo-component-glyph">—</span><span id="demo-component-copy">Seleccione uma barra para consultar o seu contexto.</span></div>
      <div class="demo-readout-line"><span>solver</span><strong id="demo-solver">SOLVED</strong></div>
      <div class="demo-readout-line"><span>modo visual</span><strong id="demo-visual">ASSEMBLED</strong></div>
      <div class="demo-readout-line demo-readout-secondary"><span>asset</span><strong id="demo-asset">LOADING</strong></div>
      <div class="demo-readout-line demo-readout-secondary"><span>frame</span><strong id="demo-fps">— FPS</strong></div>
      <div class="demo-readout-note" id="demo-provenance">hypothetical_user_design · no physical claim</div>
      <span id="demo-state" class="demo-state-hidden">ENTRY</span>
    </aside>

    <div class="demo-mode-mark" id="demo-mode-mark" hidden><span aria-hidden="true"></span><div><strong id="demo-mode-title">FOUR-BAR LAB</strong><small id="demo-mode-provenance">PROJECTO HIPOTÉTICO · NÃO RECONSTRUÍDO DA IMAGEM</small></div><button id="demo-return-empty" type="button">Novo projecto</button></div>

    <section class="demo-command" aria-label="Floating spatial command bar" data-theme="light">
      <div id="demo-conversation" class="demo-conversation" hidden aria-label="Conversa com o UNFOLD">
        <div class="demo-conversation-header"><strong>CONVERSA</strong><div><button id="demo-chat-image" type="button" aria-label="Anexar imagem à conversa">＋ Imagem</button><button id="demo-voice-output" type="button" aria-pressed="false">Voz: desligada</button><button id="demo-stop-speech" type="button">Parar voz</button><button id="demo-chat-close" type="button" aria-label="Recolher conversa">×</button></div></div>
        <div id="demo-chat-attachment" class="demo-chat-attachment" hidden><img id="demo-chat-attachment-preview" alt="Pré-visualização do anexo da conversa" /><div><strong id="demo-chat-attachment-name"></strong><span id="demo-chat-attachment-state">A aguardar confirmação de análise.</span></div></div>
        <div id="demo-messages" class="demo-messages" role="log" aria-live="polite"></div>
      </div>
      <button id="demo-command-drag" class="demo-command-drag" type="button" aria-label="Mover a barra de comandos"><i></i><i></i><i></i></button>
      <button class="demo-command-add" id="demo-image-add" type="button" aria-label="Adicionar imagem" title="Adicionar imagem">${plusIcon}</button>
      <div class="demo-command-main"><div class="demo-command-row"><textarea id="demo-question" rows="1" aria-label="Comando espacial" placeholder="Pergunta, constrói ou transforma..."></textarea></div><div class="demo-command-feedback" role="status" aria-live="polite"><strong id="demo-command-state">IDLE</strong><span id="demo-command-message">O laboratório está pronto.</span><span class="demo-waveform" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div></div>
      <div class="demo-command-tools"><button id="demo-chat-toggle" type="button" aria-label="Abrir conversa" aria-expanded="false">⋯</button><button id="demo-image" type="button" aria-label="Analisar fotografia" title="Analisar fotografia">${imageIcon}</button><button id="demo-mic" type="button" aria-label="Activar microfone" aria-pressed="false">${micIcon}</button><button id="demo-submit" class="demo-command-submit" type="button" aria-label="Enviar comando" title="Enviar comando">${arrowRightIcon}</button></div>
      <div id="demo-actions" class="demo-actions" hidden data-theme="light"><button data-demo-action="explode" type="button"><span>01</span>Desmontar</button><button data-demo-action="reassemble" type="button"><span>02</span>Remontar</button><button data-demo-action="focus" type="button"><span>03</span>Mostrar manivela</button><button data-demo-action="fit" type="button"><span>04</span>Enquadrar</button><button data-demo-action="home" type="button"><span>05</span>Vista inicial</button><button data-demo-action="restore" type="button"><span>06</span>Restaurar parâmetros</button><button id="demo-hand-toggle" type="button" aria-pressed="false"><span>07</span>Activar Hand Control</button></div>
    </section>

    <section id="demo-image-insight" class="demo-image-insight" data-image-state="idle" tabindex="-1" hidden aria-live="polite" aria-label="Interpretação da fotografia" data-theme="light">
      <div class="demo-image-insight-header"><div><span class="demo-panel-kicker">IMAGEM → INTERPRETAÇÃO</span><h2 id="demo-image-title">Imagem analisada</h2></div><button id="demo-image-close" type="button" aria-label="Fechar análise da imagem">×</button></div>
      <div class="demo-image-stage"><div class="demo-image-preview-frame" id="demo-image-preview-frame"><img id="demo-image-preview" alt="Pré-visualização da imagem seleccionada" /><span id="demo-image-scan-line" aria-hidden="true"></span><div id="demo-image-region-selection" class="demo-image-region-selection" hidden></div></div><div class="demo-image-file-meta"><strong id="demo-image-file-name">—</strong><span id="demo-image-status">Confirme a imagem antes de enviar.</span><span id="demo-image-recognition-status"></span></div></div>
      <div class="demo-image-actions"><button id="demo-image-confirm" type="button">Analisar fotografia</button><button id="demo-image-cancel" type="button">Cancelar</button></div>
      <div id="demo-image-results" class="demo-image-results" hidden>
        <div class="demo-image-result-heading"><span class="demo-panel-kicker">INTERPRETAÇÃO DOCUMENTAL</span><strong id="demo-image-result-badge">LEITURAS AUTOMÁTICAS</strong></div>
        <p id="demo-image-result-summary">Leituras propostas pelo modelo; confirme antes de as usar como dados de engenharia.</p>
        <div id="demo-mechanical-analysis">
          <div class="demo-image-result-columns"><div><span class="demo-panel-kicker">COMPONENTES OBSERVADOS</span><div id="demo-image-observed" class="demo-image-list"></div></div><div><span class="demo-panel-kicker">LIGAÇÕES OBSERVADAS</span><div id="demo-image-connections" class="demo-image-list"></div><span class="demo-panel-kicker">DIMENSÕES EXPLÍCITAS</span><div id="demo-image-dimensions" class="demo-image-list"></div></div></div>
          <div class="demo-image-result-columns"><div><span class="demo-panel-kicker">INFERRED</span><div id="demo-image-inferred" class="demo-image-list"><span class="demo-image-empty">Nenhuma inferência declarada.</span></div></div><div class="demo-image-uncertainty"><span class="demo-panel-kicker">AMBIGUOUS</span><div id="demo-image-ambiguous" class="demo-image-list"></div><span class="demo-panel-kicker">INFORMAÇÃO EM FALTA</span><div id="demo-image-missing" class="demo-image-list"></div></div></div>
          <div id="demo-document-semantic-issues" class="demo-image-list" aria-live="polite"></div>
          <div class="demo-image-readiness"><span class="demo-panel-kicker">CONTINUAÇÃO PARA SIMULAÇÃO</span><strong id="demo-image-readiness-status">BLOCKED</strong><p id="demo-image-readiness-copy">A interpretação visual não é uma reconstrução mecânica verificada.</p><div id="demo-image-readiness-missing" class="demo-image-missing-list"></div></div>
          <button id="demo-image-example" class="demo-image-example" type="button">Explorar um mecanismo de exemplo <span>→</span></button>
        </div>
        <div id="demo-domain-analysis" hidden>
          <div class="demo-domain-card"><span class="demo-panel-kicker">DOCUMENTO CLASSIFICADO</span><strong id="demo-document-domain">—</strong><p id="demo-document-summary"></p><small id="demo-document-classification-evidence"></small><button id="demo-build-spatial" type="button" hidden>Continuar para tracing espacial <span aria-hidden="true">→</span></button></div>
          <div id="demo-document-facts" class="demo-domain-facts"></div>
          <div class="demo-domain-columns"><div><span class="demo-panel-kicker">INCERTEZAS</span><div id="demo-document-uncertainty" class="demo-image-list"></div></div><div><span class="demo-panel-kicker">INFORMAÇÃO EM FALTA</span><div id="demo-document-missing" class="demo-image-list"></div></div></div>
          <div><span class="demo-panel-kicker">PERGUNTAS SOBRE ESTE DOCUMENTO</span><div id="demo-document-answers" class="demo-document-answers"></div></div>
          <div class="demo-image-detail" id="demo-image-detail">Seleccione um valor para consultar a evidência textual. Não há coordenadas automáticas; a região pode ser escolhida manualmente na fotografia.</div>
          <div class="demo-value-review" id="demo-value-review" hidden>
            <span id="demo-value-review-status">LEITURA AUTOMÁTICA · NÃO VERIFICADA</span>
            <div class="demo-value-review-fields"><label>Correcção explícita<input id="demo-value-corrected" maxlength="100" placeholder="Valor lido na imagem" /></label><label>Unidade<input id="demo-value-unit" maxlength="32" placeholder="Unidade impressa" /></label></div>
            <div class="demo-value-review-actions"><button id="demo-value-confirm" type="button">Confirmar leitura</button><button id="demo-value-correct-button" type="button">Registar correcção</button><button id="demo-value-reject" type="button">Rejeitar leitura</button></div>
            <small id="demo-value-review-history"></small>
          </div>
          <div class="demo-image-region-actions"><button id="demo-image-verify-region" type="button" hidden disabled>Seleccionar região para releitura</button><span id="demo-image-region-status" aria-live="polite">Uma releitura localizada não confirma independentemente a interpretação.</span></div>
          <img id="demo-image-region-zoom" class="demo-image-region-zoom" alt="Ampliação sem processamento da região seleccionada" hidden />
          <div id="demo-image-region-result" class="demo-image-detail" aria-live="polite" hidden></div>
          <form id="demo-document-correction" class="demo-document-correction">
            <span class="demo-panel-kicker">CORRIGIR OU COMPLETAR · CONFIRMAÇÃO EXPLÍCITA</span>
            <div class="demo-correction-fields"><label>Campo<select name="field"><option value="component">Componente</option><option value="domain">Tipo de documento</option><option value="value">Valor</option><option value="unit">Unidade</option><option value="relation">Ligação / relação</option><option value="missing_parameter">Parâmetro em falta</option></select></label><label>ID (opcional)<input name="targetId" maxlength="100" /></label></div>
            <div class="demo-correction-fields"><label>Valor / correcção<input name="value" required maxlength="500" /></label><label>Unidade (opcional)<input name="unit" maxlength="40" /></label></div>
            <button type="submit">Registar correcção confirmada</button>
            <div id="demo-document-corrections" class="demo-image-list" aria-live="polite"></div>
          </form>
          <section id="demo-electrical-sandbox" class="demo-electrical-sandbox" hidden aria-label="Electrical Sandbox">
            <span class="demo-panel-kicker">ELECTRICAL SANDBOX · MODELO NOMINAL SIMPLIFICADO</span>
            <p>A análise desta imagem não confirmou a topologia. Introduza os parâmetros e confirme as ligações manualmente. O circuito abaixo será um modelo independente, não uma reconstrução do documento.</p>
            <form id="demo-electrical-form">
              <label>Tensão da fonte (V)<input name="voltageV" type="number" min="0.001" step="any" required inputmode="decimal" /></label>
              <label>Limite nominal do ramo (A)<input name="currentLimitA" type="number" min="0.001" step="any" required inputmode="decimal" /></label>
              <label>Carga de iluminação (VA)<input name="lightingVA" type="number" min="0.001" step="any" required inputmode="decimal" /></label>
              <label>Outra carga (VA)<input name="outletVA" type="number" min="0.001" step="any" required inputmode="decimal" /></label>
              <label class="demo-electrical-confirm"><input name="confirmedTopology" type="checkbox" required /> Confirmo que esta topologia e estas ligações são os parâmetros do modelo manual.</label>
              <button type="submit">Criar modelo eléctrico manual</button>
            </form>
            <button id="demo-electrical-example" type="button">Carregar exemplo eléctrico independente</button>
            <div id="demo-electrical-result" hidden>
              <strong id="demo-electrical-provenance"></strong>
              <div id="demo-electrical-readout" class="demo-image-list"></div>
              <label>Alterar carga B (VA)<input id="demo-electrical-load-value" type="number" min="0.001" step="any" inputmode="decimal" /></label><button id="demo-electrical-update-load" type="button">Recalcular carga</button>
              <button id="demo-electrical-toggle-branch" type="button">Ligar / desligar ramo</button>
              <button id="demo-electrical-open-feed" type="button">Abrir / fechar ligação à fonte</button>
            </div>
            <p class="demo-electrical-limits">Modelo monofásico nominal I = ΣVA / V. Não calcula curto-circuito, choque eléctrico, queda de tensão nem tempo de actuação de protecção.</p>
          </section>
          <div id="demo-architecture-limitations" class="demo-domain-card" hidden><span class="demo-panel-kicker">RECONSTRUÇÃO ESPACIAL</span><p>A informação reconhecida pode não conter escala, coordenadas, espessuras ou ligações suficientes para gerar geometria 3D fiável. Não serão criadas paredes arbitrárias.</p></div>
        </div>
      </div>
    </section>
    <input id="demo-image-input" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden />
    <div id="demo-hand-layer" class="demo-hand-layer" hidden data-theme="light"><video id="demo-hand-preview" autoplay muted playsinline aria-label="Pré-visualização opcional da webcam"></video><span id="demo-hand-status" role="status" aria-live="polite">Câmara desligada</span><button id="demo-hand-stop" type="button" aria-label="Desligar Hand Control">×</button></div>
    <div id="demo-hand-cursor" class="demo-hand-cursor" aria-hidden="true" hidden></div>

    <div class="demo-quick-actions" aria-label="Quick laboratory actions" hidden data-theme="light"><button data-demo-command="Desmonta o mecanismo" type="button"><span>◌</span>Desmonta o mecanismo</button><button data-demo-command="Mostra-me a manivela" type="button"><span>⌘</span>Mostra-me a manivela</button><button data-demo-command="Aumenta para 50 mm" type="button"><span>↗</span>Aumenta para 50 mm</button><button data-demo-command="Remonta tudo" type="button"><span>◇</span>Remonta tudo</button></div>
    <div class="demo-tools" hidden data-theme="light"><button data-demo-action="fit" type="button" aria-label="Enquadrar mecanismo" title="Enquadrar">${arrowRightIcon}</button><button data-demo-action="focus" type="button" aria-label="Mostrar manivela" title="Mostrar manivela">${imageIcon}</button><button id="demo-tools-toggle" type="button" aria-label="Abrir acções" aria-controls="demo-actions" aria-expanded="false">+</button></div>
    <div class="demo-footer" hidden><span id="demo-footer-provenance">DESIGN SANDBOX</span><span id="demo-metrics">ONE WEBGL RENDERER · CAMERA READY</span></div>
  </main>`;

const shell = document.querySelector<HTMLElement>('.demo-shell')!;
const surface = document.querySelector<HTMLDivElement>('#demo-scene')!;
let spatialEditorHost: HTMLDivElement | undefined;
let spatialEditorUnmount: (() => void) | undefined;
let spatialEditorOpening = false;
let commandReturnSlot: Comment | undefined;
let demoLoopActive = true;
let demoFrame = 0;
if (!shell || !surface) throw new Error('Palco da demonstração não encontrado.');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene = new Scene();
scene.background = new Color('#191A19');
scene.fog = new FogExp2('#191A19', 0.026);
const camera = new PerspectiveCamera(42, 1, 0.05, 100);
camera.position.set(10.6, 7.4, 11.8);
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = 2;
renderer.domElement.setAttribute('aria-label', 'Palco 3D cinematográfico do mecanismo');
surface.appendChild(renderer.domElement);

function suspendDemoRenderer(): Promise<boolean> {
  const context = renderer.getContext();
  if (context.isContextLost()) return Promise.resolve(true);
  if (!context.getExtension('WEBGL_lose_context')) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; window.clearTimeout(timeout); renderer.domElement.removeEventListener('webglcontextlost', finish); resolve(context.isContextLost()); };
    renderer.domElement.addEventListener('webglcontextlost', finish, { once: true });
    const timeout = window.setTimeout(finish, 1_000);
    renderer.forceContextLoss();
  });
}

function restoreDemoRenderer(): Promise<boolean> {
  const context = renderer.getContext();
  if (!context.isContextLost()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; window.clearTimeout(timeout); renderer.domElement.removeEventListener('webglcontextrestored', finish); resolve(!context.isContextLost()); };
    renderer.domElement.addEventListener('webglcontextrestored', finish, { once: true });
    const timeout = window.setTimeout(finish, 2_000);
    renderer.forceContextRestore();
  });
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 2.4;
controls.maxDistance = 24;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 0, 0);

const ambientLight = new AmbientLight('#c9c1ae', reducedMotion ? 1.38 : 1.05);
scene.add(ambientLight);
const keyLight = new DirectionalLight('#f0d8b8', reducedMotion ? 3.8 : 2.3);
keyLight.position.set(4, 9, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const rimLight = new DirectionalLight('#8f977c', reducedMotion ? 1.6 : 0.82);
rimLight.position.set(-7, 4, -8);
scene.add(rimLight);

const floor = new Mesh(new PlaneGeometry(24, 24), new MeshStandardMaterial({ color: '#16191A', roughness: 0.88, metalness: 0.14 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.17;
floor.receiveShadow = true;
scene.add(floor);

let lab: FourBarLabScene | undefined;
let project: DemoProject = createEmptyDemoProject();
let lengths: FourBarLengths | undefined;
let selectedComponent: BarName | undefined;
let originalLengths: FourBarLengths | undefined;
let originalAngleDegrees = 0;
let cameraMotion: { fromPosition: Vector3; toPosition: Vector3; fromTarget: Vector3; toTarget: Vector3; started: number; duration: number } | undefined;
let labEntryStarted: number | undefined;
let homeView: CameraView | undefined;
let demoBusy = false;
let sequence = 0;
let abortController: AbortController | undefined;
let selectedImageFile: File | undefined;
let imageAbortController: AbortController | undefined;
let imageSequence = 0;
let imagePreviewUrl: string | undefined;
let imageAnalysis: ImageAnalysisResult | undefined;
let selectedEvidenceElement: TechnicalDocumentV1['elements'][number] | undefined;
let selectedReviewEntryId: string | undefined;
let selectedReviewEntryLabel: string | undefined;
let technicalValueReview: TechnicalValueReviewV1 | undefined;
let technicalDocumentSha256: string | undefined;
let technicalReviewPersistenceError = false;
let documentFocusId: string | undefined;
let regionVerifyAbort: AbortController | undefined;
let regionVerifySequence = 0;
let regionSelection: { active: boolean; pointerId?: number; start?: { x: number; y: number }; current?: { x: number; y: number } } = { active: false };
let documentCorrections: DocumentCorrection[] = [];
let electricalCircuit: ElectricalSandboxV1 | undefined;
let commandState: 'IDLE' | 'TYPING' | 'LISTENING' | 'PROCESSING' | 'UNDERSTANDING' | 'PROPOSED_ACTION' | 'PREVIEW' | 'AWAITING_CONFIRMATION' | 'EXECUTING' | 'COMPLETE' | 'CLARIFICATION' | 'REJECTED' | 'ERROR' = 'IDLE';
let voiceInput: BrowserVoiceInput;
const voiceOutput = browserVoiceOutput(() => voiceInput?.stop());
let conversationAbort: AbortController | undefined;
let conversationSequence = 0;
let history: ConversationMessage[] = [];
let lastOperation: string | null = null;
const handInteraction = new HandInteractionModel();
let handTracker: WebcamHandTracker | undefined;
let handControlEnabled = false;
let handHoverRole: BarName | undefined;
let handGrab: { role: BarName; plane: Plane; startWorld: Vector3; baseOffset: Vector3 } | undefined;
let commandDrag: { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | undefined;
let commandOffset = { x: 0, y: 0 };
let fpsFrames = 0;
let fpsStarted = performance.now();
let fps = 0;
let previousSurfaceWidth: number | undefined;

declare global {
  interface Window {
    __UNFOLD_DEMO_METRICS__?: () => {
      asset: string;
      canvasCount: number;
      dpr: number;
      canvasWidth: number;
      canvasHeight: number;
      webgl2: boolean;
      renderer: string;
      vendor: string;
      drawCalls: number;
      triangles: number;
      geometries: number;
      textures: number;
      materials: number;
      lights: number;
      visualState: FourBarLabScene['currentVisualState'] | 'empty';
      cameraPosition: number[];
      cameraTarget: number[];
    };
  }
}

function sceneMaterialCount(): number {
  const materials = new Set<object>();
  scene.traverse((object) => {
    const material = (object as Mesh).material;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material) materials.add(material);
  });
  return materials.size;
}

function exposeRuntimeMetrics(): void {
  const context = renderer.getContext();
  const debugInfo = context.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null;
  window.__UNFOLD_DEMO_METRICS__ = () => ({
    asset: lab?.crankAssetStatus.toUpperCase() ?? 'NOT_LOADED',
    canvasCount: document.querySelectorAll('canvas').length,
    dpr: renderer.getPixelRatio(),
    canvasWidth: renderer.domElement.width,
    canvasHeight: renderer.domElement.height,
    webgl2: renderer.capabilities.isWebGL2,
    renderer: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : String(context.getParameter(context.RENDERER)),
    vendor: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : String(context.getParameter(context.VENDOR)),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    materials: sceneMaterialCount(),
    lights: scene.children.filter((child) => child instanceof Light).length,
    visualState: lab?.currentVisualState ?? 'empty',
    cameraPosition: camera.position.toArray(),
    cameraTarget: controls.target.toArray(),
  });
}

exposeRuntimeMetrics();

const grid = new GridHelper(22, 32, '#41433c', '#252825');
grid.position.y = -0.15;
(grid.material as LineBasicMaterial).opacity = 0.055;
(grid.material as LineBasicMaterial).transparent = true;
scene.add(grid);

function setText(selector: string, value: string): void { const element = document.querySelector<HTMLElement>(selector); if (element) element.textContent = value; }
function setCommandState(state: typeof commandState, message: string): void { commandState = state; shell.dataset.commandState = state; setText('#demo-command-state', state); setText('#demo-command-message', message); }
function updateLengthReadouts(values: FourBarLengths): void {
  for (const role of ['ground', 'crank', 'coupler', 'rocker'] as const) setText(`#demo-${role}-length`, `${values[role]} mm`);
}
function cancelConversation(): void {
  conversationSequence += 1;
  conversationAbort?.abort();
  conversationAbort = undefined;
  voiceOutput.cancel();
  voiceInput?.stop();
}
function resetConversation(): void {
  cancelConversation();
  history = [];
  lastOperation = null;
  document.querySelector('#demo-messages')?.replaceChildren();
}
function setDemoState(state: string, copy?: string): void { setText('#demo-state', state); setText('#demo-runtime', state); if (copy) setText('#demo-status-copy', copy); }
function setInspector(open: boolean): void {
  shell.dataset.inspectorOpen = String(open);
  const panel = document.querySelector<HTMLElement>('#demo-readout');
  const toggle = document.querySelector<HTMLButtonElement>('#demo-inspector-toggle');
  if (panel) panel.hidden = !open;
  toggle?.setAttribute('aria-expanded', String(open));
}
function setActiveFlow(flow: 'capture' | 'understand' | 'explore'): void {
  document.querySelectorAll<HTMLButtonElement>('[data-demo-flow]').forEach((step) => {
    const active = step.dataset.demoFlow === flow;
    step.classList.toggle('is-active', active);
    if (active) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  });
}

function openFourBarProject(source: 'example' | 'manual', projectLengths: FourBarLengths, angleDegrees: number): boolean {
  const result = solveFourBar({ lengths: projectLengths, inputAngleRad: angleDegrees * Math.PI / 180, branch: 'plus' });
  if (result.status !== 'solved') {
    setText('#demo-manual-error', `A configuração não pode ser resolvida a ${angleDegrees}°. Estado: ${result.status}. Ajuste os dados; nenhuma geometria foi aberta.`);
    return false;
  }

  resetConversation();
  lab?.dispose();
  lab = new FourBarLabScene({ theme: 'industrial', lengths: projectLengths, angleDegrees });
  lab.mount(scene);
  lab.select(undefined);
  lab.root.scale.setScalar(0.72);
  lab.root.position.y = -0.8;
  labEntryStarted = performance.now();
  project = createFourBarDemoProject(source);
  lengths = { ...projectLengths };
  originalLengths = { ...projectLengths };
  originalAngleDegrees = angleDegrees;
  shell.dataset.projectState = project.status;
  shell.dataset.demoPhase = 'ENTERING';
  document.querySelector<HTMLElement>('#demo-empty-state')!.hidden = true;
  document.querySelector<HTMLElement>('#demo-manual-setup')!.hidden = true;
  document.querySelector<HTMLElement>('#demo-mode-mark')!.hidden = false;
  document.querySelector<HTMLElement>('.demo-quick-actions')!.hidden = false;
  document.querySelector<HTMLElement>('.demo-tools')!.hidden = false;
  document.querySelector<HTMLElement>('.demo-footer')!.hidden = false;
  document.querySelector<HTMLElement>('#demo-nav-experiences')!.hidden = false;
  document.querySelector<HTMLElement>('#demo-inspector-toggle')!.hidden = false;
  setInspector(false);
  selectedComponent = undefined;
  setText('#demo-selection', 'Nenhum componente seleccionado');
  setText('#demo-component-glyph', '—');
  setText('#demo-component-copy', 'Seleccione uma barra para consultar o seu contexto.');
  updateLengthReadouts(projectLengths);
  setText('#demo-solver', result.status.toUpperCase());
  setText('#demo-visual', 'ASSEMBLED');
  const hypothetical = source === 'example';
  setText('#demo-provenance', hypothetical ? 'hypothetical_user_design · example · not physical validation' : 'user_provided · not physically verified');
  setText('#demo-mode-title', hypothetical ? 'FOUR-BAR · EXEMPLO' : 'FOUR-BAR · CONFIGURAÇÃO MANUAL');
  setText('#demo-mode-provenance', hypothetical ? 'PROJECTO HIPOTÉTICO · INDEPENDENTE DE QUALQUER IMAGEM' : 'PARÂMETROS FORNECIDOS PELO UTILIZADOR · NÃO VERIFICADOS FISICAMENTE');
  setText('#demo-footer-provenance', hypothetical ? 'EXAMPLE / HYPOTHETICAL USER DESIGN' : 'USER-PROVIDED / NOT PHYSICALLY VERIFIED');
  setActiveFlow('explore');
  setDemoState('ENTERING', 'A preparar o espaço 3D a partir dos parâmetros seleccionados.');
  setCommandState('COMPLETE', hypothetical ? 'Exemplo Four-Bar carregado. É independente de qualquer fotografia.' : 'Montagem manual validada pelo solver. Parâmetros não são validação física.');
  resize();
  fitLab(true);
  return true;
}

function returnToEmptyLab(): void {
  resetConversation();
  sequence += 1;
  abortController?.abort();
  abortController = undefined;
  demoBusy = false;
  closeImageInsight();
  stopHandControl();
  lab?.dispose();
  lab = undefined;
  lengths = undefined;
  selectedComponent = undefined;
  originalLengths = undefined;
  originalAngleDegrees = 0;
  project = createEmptyDemoProject();
  shell.dataset.projectState = 'empty';
  shell.dataset.demoPhase = 'EMPTY_LAB';
  cameraMotion = undefined;
  labEntryStarted = undefined;
  homeView = undefined;
  controls.target.set(0, 0, 0);
  camera.position.set(10.6, 7.4, 11.8);
  controls.update();
  document.querySelector<HTMLElement>('#demo-empty-state')!.hidden = false;
  document.querySelector<HTMLElement>('#demo-manual-setup')!.hidden = true;
  document.querySelector<HTMLElement>('#demo-mode-mark')!.hidden = true;
  document.querySelector<HTMLElement>('.demo-quick-actions')!.hidden = true;
  document.querySelector<HTMLElement>('.demo-tools')!.hidden = true;
  document.querySelector<HTMLElement>('.demo-footer')!.hidden = true;
  document.querySelector<HTMLElement>('#demo-nav-experiences')!.hidden = true;
  document.querySelector<HTMLElement>('#demo-inspector-toggle')!.hidden = true;
  setInspector(false);
  setActiveFlow('capture');
  const prompt = document.querySelector<HTMLTextAreaElement>('#demo-question');
  if (prompt) { prompt.value = ''; prompt.style.height = '24px'; }
  setDemoState('EMPTY LAB', 'Uma ideia é suficiente para começar.');
  setCommandState('IDLE', 'Descreva uma ideia ou escolha uma forma de começar.');
  resize();
}

function cinematicFit(view: CameraView, scale = 0.82): CameraView {
  return { target: view.target.clone(), position: view.target.clone().lerp(view.position, scale) };
}
function formatResidual(value: number | undefined): string { return value === undefined ? '—' : value.toExponential(2); }

function resize(): void {
  const width = Math.max(surface.clientWidth, 1);
  const height = Math.max(surface.clientHeight, 1);
  const shouldReframe = previousSurfaceWidth !== undefined && Math.abs(width - previousSurfaceWidth) > 120 && shell.dataset.demoPhase !== 'ENTRY';
  previousSurfaceWidth = width;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (lab && shouldReframe) fitLab(true);
}

function applyCameraView(view: CameraView): void { camera.position.copy(view.position); controls.target.copy(view.target); controls.update(); }
function startCameraMotion(view: CameraView, duration = 720): void {
  cameraMotion = { fromPosition: camera.position.clone(), toPosition: view.position.clone(), fromTarget: controls.target.clone(), toTarget: view.target.clone(), started: performance.now(), duration };
  setDemoState('CAMERA', 'Reframing the laboratory around the active structure.');
}
function fitLab(transition = true, bounds?: ReturnType<FourBarLabScene['bounds']>): void {
  if (!lab) return;
  bounds ??= lab.bounds();
  const view = cinematicFit(createFitCameraView(bounds, camera.fov, undefined, camera.aspect));
  if (!homeView || lab.currentVisualState === 'assembled') homeView = { position: view.position.clone(), target: view.target.clone() };
  if (transition) startCameraMotion(view); else applyCameraView(view);
}
function focusRole(role: BarName): void {
  if (!lab) return;
  selectedComponent = role;
  lab.select(role);
  setInspector(true);
  const view = cinematicFit(createFocusCameraView(lab.boundsFor(role), camera.fov, camera.position, controls.target, camera.aspect), 0.78);
  startCameraMotion(view);
  const context: Record<BarName, { label: string; copy: string }> = {
    ground: { label: 'Ground / suporte', copy: 'Elemento fixo da montagem de referência.' },
    crank: { label: 'Manivela (Crank)', copy: 'Converte rotação em movimento planar.' },
    coupler: { label: 'Biela (Coupler)', copy: 'Transmite o movimento entre as juntas móveis.' },
    rocker: { label: 'Balancim (Rocker)', copy: 'Recebe o movimento e fecha o mecanismo.' },
  };
  setText('#demo-selection', context[role].label);
  setText('#demo-component-glyph', context[role].label.toUpperCase());
  setText('#demo-component-copy', context[role].copy);
  setDemoState('FOCUS', `${context[role].label} isolado no campo espacial.`);
}
function frameVisualState(exploded: boolean): void {
  if (!lab) return;
  lab.setExploded(exploded, reducedMotion);
  fitLab(true, lab.boundsForVisualState(exploded));
  setText('#demo-solver', lab.currentResult.status.toUpperCase());
  setText('#demo-visual', exploded ? 'INSPECTION' : 'ASSEMBLED');
  setDemoState(exploded ? 'INSPECTION' : 'ASSEMBLED', exploded ? 'Peças separadas para inspecção visual; sem simulação física.' : 'Ligações visuais restauradas. O solver mantém o estado cinemático.');
}

function restoreOriginalDesign(): void {
  if (!lab || !originalLengths || !lengths) return;
  cancelConversation();
  sequence += 1;
  abortController?.abort();
  abortController = undefined;
  demoBusy = false;
  lengths = { ...originalLengths };
  lab.setLengths(lengths);
  lab.setAngle(originalAngleDegrees);
  if (lab.currentVisualState === 'inspection') lab.setExploded(false, reducedMotion);
  updateLengthReadouts(lengths);
  setText('#demo-solver', lab.currentResult.status.toUpperCase());
  setText('#demo-visual', 'ASSEMBLED');
  setText('#demo-status-copy', 'Os parâmetros iniciais deste projecto foram restaurados.');
  setCommandState('COMPLETE', 'Parâmetros iniciais restaurados.');
  lastOperation = 'Parâmetros iniciais do projecto restaurados.';
  setDemoState('RESTORED', 'Projecto restaurado sem alterar a montagem original no backend.');
  fitLab(true);
}

function setImagePanelState(state: 'idle' | 'selected' | 'processing' | 'success' | 'error' | 'cancelled'): void {
  shell.dataset.imageState = state;
  shell.dataset.visualContext = state === 'idle' || state === 'cancelled' ? 'mechanism' : 'photograph';
  if (state === 'selected') setActiveFlow('capture');
  if (state === 'processing' || state === 'success' || state === 'error') setActiveFlow('understand');
  const panel = document.querySelector<HTMLElement>('#demo-image-insight');
  if (panel) { panel.hidden = state === 'idle' || state === 'cancelled'; panel.dataset.imageState = state; }
}

function clearImagePreview(): void {
  regionVerifySequence += 1;
  regionVerifyAbort?.abort();
  regionVerifyAbort = undefined;
  regionSelection = { active: false };
  const frame = document.querySelector<HTMLElement>('#demo-image-preview-frame');
  if (frame) delete frame.dataset.selecting;
  const selection = document.querySelector<HTMLElement>('#demo-image-region-selection');
  if (selection) { selection.hidden = true; selection.style.cssText = ''; }
  const regionResult = document.querySelector<HTMLElement>('#demo-image-region-result');
  if (regionResult) { regionResult.hidden = true; regionResult.textContent = ''; }
  const verifyButton = document.querySelector<HTMLButtonElement>('#demo-image-verify-region');
  if (verifyButton) { verifyButton.hidden = true; verifyButton.disabled = true; }
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = undefined;
  const preview = document.querySelector<HTMLImageElement>('#demo-image-preview');
  if (preview) preview.removeAttribute('src');
  const chatPreview = document.querySelector<HTMLImageElement>('#demo-chat-attachment-preview');
  if (chatPreview) chatPreview.removeAttribute('src');
  const chatAttachment = document.querySelector<HTMLElement>('#demo-chat-attachment');
  if (chatAttachment) chatAttachment.hidden = true;
}

function closeImageInsight(): void {
  imageSequence += 1;
  imageAbortController?.abort();
  imageAbortController = undefined;
  selectedImageFile = undefined;
  imageAnalysis = undefined;
  technicalValueReview = undefined;
  technicalDocumentSha256 = undefined;
  selectedEvidenceElement = undefined;
  selectedReviewEntryId = undefined;
  selectedReviewEntryLabel = undefined;
  documentFocusId = undefined;
  documentCorrections = [];
  electricalCircuit = undefined;
  clearImagePreview();
  const input = document.querySelector<HTMLInputElement>('#demo-image-input');
  if (input) input.value = '';
  const results = document.querySelector<HTMLElement>('#demo-image-results');
  if (results) results.hidden = true;
  const confirm = document.querySelector<HTMLButtonElement>('#demo-image-confirm');
  if (confirm) { confirm.hidden = false; confirm.disabled = false; }
  setImagePanelState('idle');
  setCommandState('IDLE', 'O laboratório está pronto.');
}

function addInsightItem(container: HTMLElement, label: string, detail: string, onClick?: () => void): void {
  const item: HTMLElement = onClick ? document.createElement('button') : document.createElement('span');
  item.className = 'demo-image-item';
  if (onClick) { (item as HTMLButtonElement).type = 'button'; item.addEventListener('click', onClick); }
  const title = document.createElement('strong');
  title.textContent = label;
  const copy = document.createElement('small');
  copy.textContent = detail;
  item.append(title, copy);
  container.append(item);
}

function handRoleAt(cursor: { x: number; y: number }): BarName | undefined {
  if (!lab) return undefined;
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  const pointer = new Vector2(((cursor.x - rect.left) / rect.width) * 2 - 1, -((cursor.y - rect.top) / rect.height) * 2 + 1);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(lab.selectableMeshes())[0]?.object.userData.labRole as BarName | undefined;
}

function handWorldPoint(cursor: { x: number; y: number }, plane: Plane): Vector3 | undefined {
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  const pointer = new Vector2(((cursor.x - rect.left) / rect.width) * 2 - 1, -((cursor.y - rect.top) / rect.height) * 2 + 1);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(plane, new Vector3()) ?? undefined;
}

function setHandStatus(message: string, active = handControlEnabled, visible = active): void {
  const layer = document.querySelector<HTMLElement>('#demo-hand-layer');
  const button = document.querySelector<HTMLButtonElement>('#demo-hand-toggle');
  if (layer) layer.hidden = !visible;
  setText('#demo-hand-status', message);
  button?.setAttribute('aria-pressed', String(active));
  if (button) button.innerHTML = `<span>07</span>${active ? 'Desligar Hand Control' : 'Activar Hand Control'}`;
}

function handleHandLandmarks(landmarks: HandLandmark[] | undefined, metrics: HandTrackerMetrics): void {
  if (!handControlEnabled || !lab) return;
  const frame = handInteraction.update(landmarks, renderer.domElement.getBoundingClientRect());
  const cursorElement = document.querySelector<HTMLElement>('#demo-hand-cursor');
  if (cursorElement && frame.handVisible && frame.viewportCursor) {
    cursorElement.hidden = false;
    cursorElement.style.left = `${frame.viewportCursor.x}px`;
    cursorElement.style.top = `${frame.viewportCursor.y}px`;
    cursorElement.dataset.state = frame.pinch ? 'grabbing' : 'pointing';
  } else if (cursorElement) cursorElement.hidden = true;
  const hover = frame.viewportCursor ? handRoleAt(frame.viewportCursor) : undefined;
  if (hover !== handHoverRole) { handHoverRole = hover; lab.hover(hover); }
  setText('#demo-hand-status', frame.state === 'NO_HAND' ? 'Mão não detectada' : `${frame.state} · ${metrics.delegate} · ${metrics.inferenceHz.toFixed(0)} inferências/s`);
  if (frame.grabStarted && frame.viewportCursor && hover) {
    selectedComponent = hover;
    lab.select(hover);
    if (lab.currentVisualState === 'inspection') {
      const center = lab.boundsFor(hover).getCenter(new Vector3());
      const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).normalize(), center);
      const startWorld = handWorldPoint(frame.viewportCursor, plane);
      if (startWorld) handGrab = { role: hover, plane, startWorld, baseOffset: lab.inspectionOffset(hover) };
    } else setText('#demo-hand-status', 'PINCH · desmonta para mover peças; solver protegido');
  }
  if (handGrab && frame.state === 'GRABBING' && frame.viewportCursor && lab.currentVisualState === 'inspection') {
    const point = handWorldPoint(frame.viewportCursor, handGrab.plane);
    if (point) lab.setInspectionOffset(handGrab.role, handGrab.baseOffset.clone().add(point).sub(handGrab.startWorld));
  }
  if (frame.grabEnded) handGrab = undefined;
}

function stopHandControl(): void {
  handControlEnabled = false;
  handTracker?.stop();
  handTracker = undefined;
  handInteraction.reset();
  handHoverRole = undefined;
  handGrab = undefined;
  lab?.hover(undefined);
  const cursor = document.querySelector<HTMLElement>('#demo-hand-cursor');
  if (cursor) cursor.hidden = true;
  const video = document.querySelector<HTMLVideoElement>('#demo-hand-preview');
  if (video) video.srcObject = null;
  setHandStatus('Câmara desligada', false, false);
}

async function startHandControl(): Promise<void> {
  if (!lab) { setHandStatus('Abra primeiro um mecanismo para activar selecção por gesto.', false, true); return; }
  if (handControlEnabled) return;
  const video = document.querySelector<HTMLVideoElement>('#demo-hand-preview');
  if (!video) return;
  handControlEnabled = true;
  setHandStatus('A pedir permissão da câmara…');
  const tracker = new WebcamHandTracker({
    video,
    onState: (state, message) => {
      if (handTracker !== tracker) return;
      handInteraction.setState(state);
      setHandStatus(message ?? state);
    },
    onLandmarks: handleHandLandmarks,
    onError: () => { if (handTracker === tracker) setText('#demo-hand-status', 'Reconhecimento indisponível. Pode continuar sem webcam.'); },
  });
  handTracker = tracker;
  try {
    await tracker.start();
    if (handTracker !== tracker || !handControlEnabled) tracker.stop();
  } catch {
    if (handTracker === tracker) {
      handControlEnabled = false;
      handTracker = undefined;
      handInteraction.reset();
      setHandStatus('Câmara indisponível ou permissão recusada.', false, true);
    }
  }
}

function renderImageInsight(result: ImageAnalysisResult): void {
  imageAnalysis = result;
  renderTechnicalDocumentInsight(result);
  const results = document.querySelector<HTMLElement>('#demo-image-results');
  if (results) results.hidden = false;
  const confirm = document.querySelector<HTMLButtonElement>('#demo-image-confirm');
  if (confirm) confirm.hidden = true;
  setText('#demo-image-file-name', result.fileName);
}

async function hashImageDataUrl(dataUrl: string): Promise<string> {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function saveTechnicalValueReview(): void {
  if (!technicalValueReview || technicalReviewPersistenceError) return;
  try { localStorage.setItem(`unfold:technical-value-review:${technicalValueReview.documentSha256}`, JSON.stringify(technicalValueReview)); }
  catch { setText('#demo-image-region-status', 'Histórico mantido apenas nesta sessão; armazenamento local indisponível.'); }
}

async function prepareTechnicalValueReview(result: ImageAnalysisResult): Promise<void> {
  technicalReviewPersistenceError = false;
  technicalDocumentSha256 = await hashImageDataUrl(result.previewDataUrl);
  const storageKey = `unfold:technical-value-review:${technicalDocumentSha256}`;
  try {
    const saved = localStorage.getItem(storageKey);
    technicalValueReview = saved ? parseTechnicalValueReview(JSON.parse(saved), technicalDocumentSha256, result.document) : createTechnicalValueReview(technicalDocumentSha256, result.document);
  } catch {
    technicalValueReview = createTechnicalValueReview(technicalDocumentSha256, result.document);
    technicalReviewPersistenceError = true;
  }
}

function renderSelectedEvidence(): void {
  const item = selectedEvidenceElement;
  const reviewId = selectedReviewEntryId;
  const review = technicalValueReview;
  const reviewPanel = document.querySelector<HTMLElement>('#demo-value-review');
  if (!reviewId || !review || !reviewPanel) { if (reviewPanel) reviewPanel.hidden = true; return; }
  const entry = review.entries[reviewId];
  if (!entry) { reviewPanel.hidden = true; return; }
  reviewPanel.hidden = false;
  const statusLabel: Record<string, string> = { unreviewed: 'LEITURA AUTOMÁTICA · NÃO VERIFICADA', ambiguous: 'LEITURA AMBÍGUA · CONFIRMAÇÃO NECESSÁRIA', verified: 'CONFIRMADA EXPLICITAMENTE PELO UTILIZADOR', rejected: 'LEITURA REJEITADA PELO UTILIZADOR', corrected: 'VALOR CORRIGIDO EXPLICITAMENTE PELO UTILIZADOR' };
  const originalDisplay = `${entry.original.rawValue}${entry.original.unit ? ` ${entry.original.unit}` : ''}`;
  const currentDisplay = entry.current ? `${entry.current.rawValue}${entry.current.unit ? ` ${entry.current.unit}` : ''}` : null;
  setText('#demo-value-review-status', `${statusLabel[entry.status]} · Original: ${originalDisplay}${currentDisplay && currentDisplay !== originalDisplay ? ` → Correcção: ${currentDisplay}` : ''}`);
  const correctionInput = document.querySelector<HTMLInputElement>('#demo-value-corrected');
  const unitInput = document.querySelector<HTMLInputElement>('#demo-value-unit');
  if (correctionInput && document.activeElement !== correctionInput) correctionInput.value = entry.current?.rawValue ?? '';
  if (unitInput && document.activeElement !== unitInput) unitInput.value = entry.current?.unit ?? item?.unit ?? entry.original.unit ?? '';
  setText('#demo-value-review-history', `${entry.region ? `Região manual associada: x=${entry.region.coordinates.x.toFixed(3)}, y=${entry.region.coordinates.y.toFixed(3)}, w=${entry.region.coordinates.width.toFixed(3)}, h=${entry.region.coordinates.height.toFixed(3)} · ${entry.region.originalSize.width}×${entry.region.originalSize.height}px. ` : 'Sem região exacta associada. '}Histórico: ${review.history.filter((event) => event.elementId === reviewId).length} evento(s). ${technicalReviewPersistenceError ? 'Histórico anterior inválido preservado; alterações desta sessão não serão gravadas para não o sobrescrever. ' : ''}Registos locais são auto-declarações do utilizador, não assinatura ou certificação independente.`);
  const confirm = document.querySelector<HTMLButtonElement>('#demo-value-confirm');
  if (confirm) confirm.hidden = entry.status === 'verified' || entry.status === 'corrected' || entry.status === 'rejected';
}

function refreshSelectedReview(): void {
  renderSelectedEvidence();
  const facts = document.querySelector<HTMLElement>('#demo-document-facts');
  const row = selectedReviewEntryId && facts ? Array.from(facts.children).find((child) => (child as HTMLElement).dataset.reviewId === selectedReviewEntryId) as HTMLElement | undefined : undefined;
  const copy = row?.querySelector('small');
  const entry = selectedReviewEntryId && technicalValueReview?.entries[selectedReviewEntryId];
  if (copy && entry) copy.textContent = `${selectedEvidenceElement?.status ?? 'observedText'} · ${entry.status} · origem: ${entry.sourceRef.kind}`;
}

function renderTechnicalDocumentInsight(result: ImageAnalysisResult): void {
  const documentData = result.document;
  const mechanical = document.querySelector<HTMLElement>('#demo-mechanical-analysis');
  const domainPanel = document.querySelector<HTMLElement>('#demo-domain-analysis');
  if (mechanical) mechanical.hidden = true;
  if (domainPanel) domainPanel.hidden = false;
  setText('#demo-image-result-badge', `${documentData.primaryDomain.replaceAll('_', ' ').toUpperCase()} · ${Math.round(documentData.classification.confidence * 100)}%`);
  setText('#demo-image-result-summary', documentData.summary);
  setText('#demo-document-domain', documentData.documentType);
  setText('#demo-document-summary', documentData.summary);
  setText('#demo-document-classification-evidence', `Estado: ${documentData.analysisState}; domínio principal: ${documentData.primaryDomain}; evidência: ${documentData.classification.evidence}${documentData.secondaryDomains.length ? `; secundários: ${documentData.secondaryDomains.join(', ')}` : ''}.`);
  const recognitionText = result.recognition ? `A: ${result.recognition.primaryDomain}; encaminhamento ${result.recognition.route}. ${result.recognition.summary}` : 'Reconhecimento inicial indisponível.';
  const stageUsage = result.meta?.usage;
  const tokenText = stageUsage?.totalTokens === undefined ? '' : ` · ${stageUsage.totalTokens} tokens${stageUsage.reasoningTokens === undefined ? '' : ` (${stageUsage.reasoningTokens} raciocínio)`}${result.meta?.estimatedCostUsd === undefined ? '' : ` · ~US$${result.meta.estimatedCostUsd.toFixed(4)}`}`;
  setText('#demo-image-recognition-status', `${recognitionText}${result.extraction?.status && result.extraction.status !== 'complete' ? ` Extracção especializada: ${result.extraction.status}.` : ''}${tokenText}`);
  setText('#demo-image-status', `${documentData.elements.length} elementos · ${documentData.relations.length} relações · ${result.meta?.stages?.length ?? 0} fases Meta`);

  const facts = document.querySelector<HTMLElement>('#demo-document-facts');
  const uncertain = document.querySelector<HTMLElement>('#demo-document-uncertainty');
  const missing = document.querySelector<HTMLElement>('#demo-document-missing');
  const answers = document.querySelector<HTMLElement>('#demo-document-answers');
  const semanticIssues = document.querySelector<HTMLElement>('#demo-document-semantic-issues');
  facts?.replaceChildren(); uncertain?.replaceChildren(); missing?.replaceChildren(); answers?.replaceChildren(); semanticIssues?.replaceChildren();
  if (!facts || !uncertain || !missing || !answers) return;
  const verifyButton = document.querySelector<HTMLButtonElement>('#demo-image-verify-region');
  const detailClick = (item: TechnicalDocumentV1['elements'][number]) => () => {
    selectedEvidenceElement = item;
    selectedReviewEntryId = item.id;
    selectedReviewEntryLabel = item.label;
    documentFocusId = item.id;
    if (verifyButton) { verifyButton.hidden = item.rawValue === null; verifyButton.disabled = item.rawValue === null; }
    setText('#demo-image-detail', `${item.label} · origem indicada pelo modelo: ${item.status}; validação: ${technicalValueReview?.entries[item.id]?.status ?? 'unreviewed'}; evidência textual declarada: ${item.evidence}${item.rawValue ? `; leitura original imutável: ${displayDocumentValue(item.rawValue, item.unit)}` : ''}. Sem região automática fundamentada; seleccione manualmente na imagem se necessário.`);
    renderSelectedEvidence();
  };
  const elementLabels = new Map(documentData.elements.map((item) => [item.id, item.label]));
  documentData.elements.forEach((item) => {
    addInsightItem(facts, `${item.kind}: ${item.label}${item.rawValue ? ` · ${displayDocumentValue(item.rawValue, item.unit)}` : ''}`, `${item.status} · ${technicalValueReview?.entries[item.id]?.status ?? 'unreviewed'} · ${item.evidence}`, detailClick(item));
    const row = facts.lastElementChild as HTMLElement | null;
    if (row) row.dataset.reviewId = item.id;
  });
  documentData.relations.forEach((item) => addInsightItem(facts, `${elementLabels.get(item.fromId) ?? item.fromId} → ${elementLabels.get(item.toId) ?? item.toId} · ${item.kind}`, `${item.status} · ${item.evidence}`));
  documentData.observedText.forEach((item, index) => {
    const id = `observedText-${index}`;
    const reviewable = Boolean(technicalValueReview?.entries[id]);
    addInsightItem(facts, item, `texto transcrito · ${technicalValueReview?.entries[id]?.status ?? 'sem valor para revisão'}`, reviewable ? () => {
      selectedEvidenceElement = undefined;
      selectedReviewEntryId = id;
      selectedReviewEntryLabel = item;
      documentFocusId = undefined;
      if (verifyButton) { verifyButton.hidden = false; verifyButton.disabled = false; }
      setText('#demo-image-detail', `${item} · observação textual original do modelo, sem componente estruturado associado. Seleccione manualmente a região antes de qualquer releitura.`);
      renderSelectedEvidence();
    } : undefined);
    const row = facts.lastElementChild as HTMLElement | null;
    if (row && reviewable) row.dataset.reviewId = id;
  });
  documentData.ambiguities.forEach((item) => addInsightItem(uncertain, item, 'ambiguidade da interpretação; requer confirmação'));
  documentData.elements.filter((item) => item.status !== 'observed').forEach((item) => addInsightItem(uncertain, `${item.label} · ${item.status}`, item.evidence));
  documentData.missingInformation.forEach((item) => addInsightItem(missing, item, 'não confirmado no documento'));
  documentData.capabilities.forEach((item) => addInsightItem(missing, `${item.id}: ${item.state}`, `${item.reason}${item.missing.length ? ` Falta: ${item.missing.join('; ')}` : ''}`));
  result.assessment?.issues.forEach((issue) => semanticIssues && addInsightItem(semanticIssues, `${issue.code} · REVISÃO`, issue.message));
  if (!facts.childElementCount) addInsightItem(facts, 'Sem itens confirmados', 'A classificação não produziu elementos suficientemente sustentados.');
  if (!uncertain.childElementCount) addInsightItem(uncertain, 'Sem ambiguidades declaradas', 'A confiança do modelo não substitui revisão independente.');
  if (!missing.childElementCount) addInsightItem(missing, 'Sem lacunas declaradas', 'Isto não equivale a validação independente.');

  documentData.questions.forEach((answer) => addInsightItem(answers, answer.question, `${answer.basis.toUpperCase()} · ${answer.answer}`, () => { void runCommand(answer.question); }));
  if (!answers.childElementCount) addInsightItem(answers, 'Peça uma explicação', 'Use a barra de comandos para perguntar sobre este documento.');
  const circuitPanel = document.querySelector<HTMLElement>('#demo-electrical-sandbox');
  if (circuitPanel) circuitPanel.hidden = documentData.primaryDomain !== 'electrical_installation';
  const spatialHandoff = document.querySelector<HTMLButtonElement>('#demo-build-spatial');
  if (spatialHandoff) spatialHandoff.hidden = documentData.primaryDomain !== 'architecture' || !selectedImageFile;
  const architectureNote = document.querySelector<HTMLElement>('#demo-architecture-limitations');
  if (architectureNote) architectureNote.hidden = documentData.primaryDomain !== 'architecture';
  const readinessStatus = document.querySelector<HTMLElement>('#demo-image-readiness-status');
  if (readinessStatus) readinessStatus.textContent = 'BLOCKED';
  const readiness = assessTechnicalDocumentSimulation(documentData);
  if (readinessStatus) readinessStatus.textContent = readiness.status.toUpperCase();
  setText('#demo-image-readiness-copy', 'Compreensão documental, visualização geométrica e simulação são capacidades independentes. A fotografia não foi convertida em CAD.');
  const readinessMissing = document.querySelector<HTMLElement>('#demo-image-readiness-missing');
  readinessMissing?.replaceChildren();
  readiness.missing.forEach((item) => readinessMissing && addInsightItem(readinessMissing, item, 'dependência de simulação'));
  if (verifyButton) { verifyButton.hidden = true; verifyButton.disabled = true; }
  const regionResult = document.querySelector<HTMLElement>('#demo-image-region-result');
  if (regionResult) { regionResult.hidden = true; regionResult.textContent = ''; }
  const regionZoom = document.querySelector<HTMLImageElement>('#demo-image-region-zoom');
  if (regionZoom) { regionZoom.hidden = true; regionZoom.removeAttribute('src'); }
  setText('#demo-image-detail', 'Seleccione um item para consultar a evidência textual. Não há coordenadas automáticas; a área de releitura será escolhida manualmente.');
  renderDocumentCorrections();
  renderElectricalCircuit();
  const example = document.querySelector<HTMLButtonElement>('#demo-image-example');
  if (example) { example.hidden = false; example.innerHTML = 'Abrir Four-Bar Lab independente <span>→</span>'; }
}

function displayDocumentValue(rawValue: string, unit: string | null): string {
  if (!unit) return rawValue;
  const normalizedValue = rawValue.toLowerCase().replace(/\s/g, '').replace('²', '2');
  const normalizedUnit = unit.toLowerCase().replace(/\s/g, '').replace('²', '2');
  return normalizedValue.endsWith(normalizedUnit) ? rawValue : `${rawValue} ${unit}`;
}

function renderDocumentCorrections(): void {
  const container = document.querySelector<HTMLElement>('#demo-document-corrections');
  if (!container) return;
  container.replaceChildren();
  for (const correction of documentCorrections) {
    const item = document.createElement('span');
    item.className = 'demo-image-item';
    const title = document.createElement('strong');
    title.textContent = `${correction.field}${correction.targetId ? ` · ${correction.targetId}` : ''}: ${correction.value}${correction.unit ? ` ${correction.unit}` : ''}`;
    const copy = document.createElement('small');
    copy.textContent = `explicit_user_correction · confirmado pelo utilizador · ${correction.createdAt}`;
    item.append(title, copy);
    container.append(item);
  }
}

function renderElectricalCircuit(): void {
  const result = document.querySelector<HTMLElement>('#demo-electrical-result');
  if (!result) return;
  if (!electricalCircuit) { result.hidden = true; return; }
  result.hidden = false;
  const calculated = calculateElectricalSandbox(electricalCircuit);
  setText('#demo-electrical-provenance', calculated.evidenceStatus === 'independent_example'
    ? 'EXEMPLO INDEPENDENTE · NÃO CORRESPONDE À IMAGEM'
    : 'MODELO CONFIGURADO E CONFIRMADO PELO UTILIZADOR · NÃO É ENSAIO FÍSICO');
  const readout = document.querySelector<HTMLElement>('#demo-electrical-readout');
  readout?.replaceChildren();
  if (!readout) return;
  addInsightItem(readout, `Fonte monofásica nominal: ${calculated.source.voltageV} V`, 'Parâmetro do modelo seleccionado.');
  calculated.loads.forEach((load) => addInsightItem(readout, `${load.name}: ${load.apparentPowerVA} VA`, load.energized ? 'ENERGIZADA pelo caminho fechado definido.' : 'SEM ENERGIA no modelo actual.'));
  calculated.branches.forEach((branch) => addInsightItem(readout, `${branch.name}: ${branch.currentA.toFixed(3)} A / limite ${branch.currentLimitA} A`, branch.overloaded ? 'SOBRECARGA NOMINAL · limite excedido; não representa disparo.' : branch.energized ? 'Dentro do limite nominal configurado.' : 'Ramo sem alimentação no modelo actual.'));
  calculated.limitations.forEach((limitation) => addInsightItem(readout, 'Limite do modelo', limitation));
  const load = electricalCircuit.loads.find((item) => item.id === 'outlet-1');
  const input = document.querySelector<HTMLInputElement>('#demo-electrical-load-value');
  if (input && load && document.activeElement !== input) input.value = String(load.apparentPowerVA);
  const branch = electricalCircuit.branches[0];
  const feed = electricalCircuit.connections.find((connection) => connection.id === 'feed-1');
  const toggle = document.querySelector<HTMLButtonElement>('#demo-electrical-toggle-branch');
  const open = document.querySelector<HTMLButtonElement>('#demo-electrical-open-feed');
  if (toggle && branch) toggle.textContent = branch.enabled ? 'Desligar ramo' : 'Ligar ramo';
  if (open && feed) open.textContent = feed.closed ? 'Abrir ligação à fonte' : 'Fechar ligação à fonte';
}

async function runImageInsight(): Promise<void> {
  const file = selectedImageFile;
  if (!file || imageAbortController) return;
  const currentSequence = ++imageSequence;
  const abort = new AbortController();
  imageAbortController = abort;
  setImagePanelState('processing');
  setCommandState('PROCESSING', 'A fotografia está a ser interpretada pelo pipeline multimodal.');
  setText('#demo-image-status', 'A analisar a imagem…');
  setText('#demo-chat-attachment-state', 'Enviada para análise · a aguardar resposta.');
  const confirm = document.querySelector<HTMLButtonElement>('#demo-image-confirm');
  if (confirm) confirm.disabled = true;
  try {
    const result = await requestImageAnalysis(file, abort.signal);
    if (currentSequence !== imageSequence) return;
    await prepareTechnicalValueReview(result);
    if (currentSequence !== imageSequence) return;
    setImagePanelState('success');
    renderImageInsight(result);
    const attachmentState = document.querySelector<HTMLElement>('#demo-chat-attachment-state');
    if (attachmentState) attachmentState.textContent = 'Análise concluída · disponível como contexto da conversa.';
    addMessage('user', `Enviei uma imagem: ${file.name}`);
    const ambiguityNote = result.document.ambiguities.length ? ` Ambiguidades: ${result.document.ambiguities.slice(0, 2).join('; ')}.` : '';
    reply(`${result.document.summary}${ambiguityNote} A interpretação não cria geometria nem confirma propriedades físicas.`, `IMAGEM · ${result.document.primaryDomain.toUpperCase()}`);
    setCommandState('COMPLETE', 'Interpretação recebida. As limitações permanecem visíveis.');
    setDemoState('IMAGE INSIGHT', 'A fotografia foi interpretada sem converter observações em geometria.');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (currentSequence === imageSequence) { setImagePanelState('cancelled'); setText('#demo-chat-attachment-state', 'Análise cancelada · resultado não confirmado.'); setCommandState('IDLE', 'Análise cancelada.'); }
      return;
    }
    if (currentSequence !== imageSequence) return;
    setImagePanelState('error');
    setText('#demo-chat-attachment-state', 'A análise falhou · sem interpretação disponível.');
    setText('#demo-image-status', error instanceof Error ? error.message : 'A análise falhou.');
    setCommandState('ERROR', 'A fotografia não foi interpretada. A cena permaneceu intacta.');
  } finally {
    if (currentSequence === imageSequence) { imageAbortController = undefined; if (confirm) confirm.disabled = false; }
  }
}

function selectImageFile(file: File): void {
  imageSequence += 1;
  imageAbortController?.abort();
  imageAbortController = undefined;
  try {
    validateImageDemoFile(file);
    clearImagePreview();
    const results = document.querySelector<HTMLElement>('#demo-image-results');
    if (results) results.hidden = true;
    const confirm = document.querySelector<HTMLButtonElement>('#demo-image-confirm');
    if (confirm) { confirm.hidden = false; confirm.disabled = false; }
    selectedImageFile = file;
    imageAnalysis = undefined;
    technicalValueReview = undefined;
    technicalDocumentSha256 = undefined;
    selectedEvidenceElement = undefined;
    selectedReviewEntryId = undefined;
    selectedReviewEntryLabel = undefined;
    documentFocusId = undefined;
    documentCorrections = [];
    electricalCircuit = undefined;
    resetConversation();
    imagePreviewUrl = URL.createObjectURL(file);
    const preview = document.querySelector<HTMLImageElement>('#demo-image-preview');
    if (preview && imagePreviewUrl) preview.src = imagePreviewUrl;
    const chatPreview = document.querySelector<HTMLImageElement>('#demo-chat-attachment-preview');
    if (chatPreview && imagePreviewUrl) chatPreview.src = imagePreviewUrl;
    const chatAttachment = document.querySelector<HTMLElement>('#demo-chat-attachment');
    if (chatAttachment) chatAttachment.hidden = false;
    setText('#demo-chat-attachment-name', file.name);
    setText('#demo-chat-attachment-state', 'Pré-visualização · confirme a análise para enviar à Meta.');
    showConversation(true);
    setText('#demo-image-file-name', file.name);
    setText('#demo-image-status', 'Pré-visualização pronta. Confirme o envio para a Meta.');
    setImagePanelState('selected');
    setCommandState('IDLE', 'A fotografia está pronta para análise.');
  } catch (error) {
    selectedImageFile = undefined;
    clearImagePreview();
    setImagePanelState('error');
    setText('#demo-image-status', error instanceof Error ? error.message : 'Ficheiro inválido.');
    setCommandState('ERROR', 'Ficheiro rejeitado antes do envio.');
  }
}

function openImagePicker(): void {
  const target = hasActiveSpatialCommandHandler()
    ? spatialEditorHost?.querySelector<HTMLInputElement>('#plan-file')
    : document.querySelector<HTMLInputElement>('#demo-image-input');
  target?.click();
}

function setSpatialCommandBarMode(active: boolean): void {
  const add = document.querySelector<HTMLButtonElement>('#demo-image-add');
  const analyze = document.querySelector<HTMLButtonElement>('#demo-image');
  const chatImage = document.querySelector<HTMLButtonElement>('#demo-chat-image');
  if (add) { add.setAttribute('aria-label', active ? 'Importar planta como referência' : 'Adicionar imagem'); add.title = active ? 'Importar planta como referência' : 'Adicionar imagem'; }
  if (analyze) { analyze.setAttribute('aria-label', active ? 'Carregar planta para tracing' : 'Analisar fotografia'); analyze.title = active ? 'Carregar planta para tracing' : 'Analisar fotografia'; }
  if (chatImage) chatImage.textContent = active ? '＋ Referência' : '＋ Imagem';
}

type NormalizedImageRegion = ImageRegionRequest['region'];

function imageContentBounds(image: HTMLImageElement): { left: number; top: number; width: number; height: number } | undefined {
  if (!image.naturalWidth || !image.naturalHeight) return undefined;
  const box = image.getBoundingClientRect();
  const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

function normalizedPoint(image: HTMLImageElement, clientX: number, clientY: number): { x: number; y: number } | undefined {
  const bounds = imageContentBounds(image);
  if (!bounds || clientX < bounds.left || clientY < bounds.top || clientX > bounds.left + bounds.width || clientY > bounds.top + bounds.height) return undefined;
  return { x: (clientX - bounds.left) / bounds.width, y: (clientY - bounds.top) / bounds.height };
}

function displayRegionSelection(): void {
  const frame = document.querySelector<HTMLElement>('#demo-image-preview-frame');
  const selection = document.querySelector<HTMLElement>('#demo-image-region-selection');
  const image = document.querySelector<HTMLImageElement>('#demo-image-preview');
  if (!frame || !selection || !image || !regionSelection.start || !regionSelection.current) return;
  const bounds = imageContentBounds(image);
  if (!bounds) return;
  const origin = frame.getBoundingClientRect();
  const left = Math.min(regionSelection.start.x, regionSelection.current.x);
  const top = Math.min(regionSelection.start.y, regionSelection.current.y);
  const width = Math.abs(regionSelection.current.x - regionSelection.start.x);
  const height = Math.abs(regionSelection.current.y - regionSelection.start.y);
  selection.hidden = false;
  selection.style.left = `${bounds.left - origin.left + left * bounds.width}px`;
  selection.style.top = `${bounds.top - origin.top + top * bounds.height}px`;
  selection.style.width = `${width * bounds.width}px`;
  selection.style.height = `${height * bounds.height}px`;
}

function cropImageRegion(image: HTMLImageElement, region: NormalizedImageRegion): string {
  const x = Math.max(0, Math.floor(region.x * image.naturalWidth));
  const y = Math.max(0, Math.floor(region.y * image.naturalHeight));
  const width = Math.min(image.naturalWidth - x, Math.max(1, Math.ceil(region.width * image.naturalWidth)));
  const height = Math.min(image.naturalHeight - y, Math.max(1, Math.ceil(region.height * image.naturalHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível recortar a região seleccionada.');
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

async function runRegionVerification(region: NormalizedImageRegion): Promise<void> {
  const image = document.querySelector<HTMLImageElement>('#demo-image-preview');
  const targetId = selectedReviewEntryId;
  const targetLabel = selectedReviewEntryLabel;
  if (!image || !targetId || !targetLabel || !technicalValueReview?.entries[targetId] || !image.naturalWidth || !image.naturalHeight || regionVerifyAbort) return;
  const currentSequence = ++regionVerifySequence;
  const abort = new AbortController();
  regionVerifyAbort = abort;
  const result = document.querySelector<HTMLElement>('#demo-image-region-result');
  if (result) { result.hidden = false; result.textContent = 'A reler apenas o recorte escolhido…'; }
  setText('#demo-image-region-status', 'Análise localizada em curso; não altera o valor original.');
  try {
    const cropDataUrl = cropImageRegion(image, region);
    technicalValueReview = selectManualEvidenceRegion(technicalValueReview, targetId, region, { width: image.naturalWidth, height: image.naturalHeight });
    saveTechnicalValueReview();
    renderSelectedEvidence();
    const zoom = document.querySelector<HTMLImageElement>('#demo-image-region-zoom');
    if (zoom) { zoom.src = cropDataUrl; zoom.hidden = false; }
    const request: ImageRegionRequest = {
      cropDataUrl, targetId, targetLabel,
      question: 'Qual é exactamente a transcrição impressa nesta região? Indique unidade apenas se visível.', region,
      originalSize: { width: image.naturalWidth, height: image.naturalHeight },
    };
    const answer: ImageRegionResult = await requestImageRegionVerification(request, abort.signal);
    if (currentSequence !== regionVerifySequence) return;
    technicalValueReview = recordRegionalReading(technicalValueReview, targetId, { status: answer.verification.status, rawValue: answer.verification.reading, unit: answer.verification.unit, explanation: answer.verification.explanation });
    saveTechnicalValueReview();
    renderSelectedEvidence();
    const reading = answer.verification.reading === null ? 'sem leitura segura' : `${answer.verification.reading}${answer.verification.unit ? ` ${answer.verification.unit}` : ''}`;
    if (result) result.textContent = `RELEITURA DO MESMO MODELO · ${answer.verification.status.toUpperCase()} · ${reading}. Alternativas: ${answer.verification.alternatives.join(' / ') || 'nenhuma indicada'}. Texto visível: ${answer.verification.visibleText ?? 'não indicado'}. ${answer.verification.explanation} Referência: ${answer.verification.regionReference}. Região escolhida manualmente: x=${region.x.toFixed(3)}, y=${region.y.toFixed(3)}, w=${region.width.toFixed(3)}, h=${region.height.toFixed(3)}. ${answer.limitation} O valor original não foi alterado.`;
    setText('#demo-image-region-status', 'Releitura registada separadamente. Compare com a fotografia e confirme manualmente.');
  } catch (error) {
    if (currentSequence !== regionVerifySequence || error instanceof DOMException && error.name === 'AbortError') return;
    if (result) result.textContent = error instanceof Error ? error.message : 'Falha na releitura localizada.';
    setText('#demo-image-region-status', 'A releitura não foi concluída; o resultado original mantém-se inalterado.');
  } finally {
    if (currentSequence === regionVerifySequence) regionVerifyAbort = undefined;
  }
}

function beginRegionSelection(): void {
  if (!imageAnalysis || !selectedReviewEntryId || !technicalValueReview?.entries[selectedReviewEntryId] || regionVerifyAbort) return;
  regionSelection = { active: true };
  const frame = document.querySelector<HTMLElement>('#demo-image-preview-frame');
  if (frame) { frame.dataset.selecting = 'true'; frame.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  setText('#demo-image-region-status', `Arraste sobre a leitura “${selectedReviewEntryLabel}” na imagem original. Esta região manual será enviada como recorte e continuará não verificada.`);
}

function completeRegionSelection(pointerId: number): void {
  const current = regionSelection;
  const frame = document.querySelector<HTMLElement>('#demo-image-preview-frame');
  const selection = document.querySelector<HTMLElement>('#demo-image-region-selection');
  if (frame) { delete frame.dataset.selecting; try { frame.releasePointerCapture(pointerId); } catch { /* captura já libertada pelo browser */ } }
  regionSelection = { active: false };
  if (selection) selection.hidden = true;
  if (!current.start || !current.current) { setText('#demo-image-region-status', 'Selecção vazia; tente novamente.'); return; }
  const region = { x: Math.min(current.start.x, current.current.x), y: Math.min(current.start.y, current.current.y), width: Math.abs(current.current.x - current.start.x), height: Math.abs(current.current.y - current.start.y) };
  if (region.width < 0.015 || region.height < 0.015) { setText('#demo-image-region-status', 'A região seleccionada é demasiado pequena; arraste uma área maior.'); return; }
  void runRegionVerification(region);
}

async function executeExperiment(instruction: string, expectedValue: number): Promise<boolean> {
  if (!lab || !lengths || demoBusy || lab.currentVisualState === 'inspection') {
    setCommandState('ERROR', 'A alteração exige uma montagem activa fora do modo de inspecção.');
    return false;
  }
  const current = lab.currentResult;
  const request = createPhase4AExperimentRequest(instruction, lengths, current.inputAngleRad, lab.currentBranch);
  const currentSequence = ++sequence;
  abortController?.abort();
  const abort = new AbortController();
  abortController = abort;
  demoBusy = true;
  setCommandState('PROCESSING', 'A validar a instrução no backend local.');
  try {
    const response = await fetch(`${API_BASE_URL}/experiments/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: abort.signal });
    const payload: unknown = await response.json();
    if (currentSequence !== sequence) return false;
    if (!response.ok) throw new Error('A API de experiências devolveu um erro.');
    const validation = validatePhase4AExperimentResponse(payload, lengths, current.inputAngleRad, lab.currentBranch, expectedValue);
    if (validation.status === 'blocked') throw new Error(validation.message);
    const operation = validation.response.operation;
    const nextLengths = { ...lengths, crank: operation.newValue };
    const nextResult = solveFourBar({ lengths: nextLengths, inputAngleRad: current.inputAngleRad, branch: lab.currentBranch });
    if (nextResult.status !== validation.response.after.result.status) throw new Error('A resposta não corresponde ao solver determinístico.');
    if (nextResult.status !== 'solved') {
      lastOperation = `Alteração da manivela de ${current.lengths.crank} para ${operation.newValue} mm: ${nextResult.status} no ângulo ${current.inputAngleRad} rad. ${nextResult.reason ?? ''} A montagem original foi preservada.`;
      setText('#demo-solver', `PROPOSED ${nextResult.status.toUpperCase()}`);
      setCommandState('ERROR', `Configuração impossível neste ângulo (${nextResult.status}). A montagem válida foi preservada.`);
      setText('#demo-status-copy', `A alteração proposta para ${operation.componentId} não é válida neste ângulo.`);
      return false;
    }
    lengths = nextLengths;
    lastOperation = `Manivela alterada de ${current.lengths.crank} para ${operation.newValue} mm; solver antes ${current.status}, depois ${nextResult.status}, no ângulo ${current.inputAngleRad} rad.`;
    lab.setLengths(nextLengths);
    fitLab(true);
    setText('#demo-crank-length', `${operation.newValue} mm`);
    setText('#demo-solver', nextResult.status.toUpperCase());
    setText('#demo-status-copy', `${operation.componentId}: ${current.lengths.crank} → ${operation.newValue} mm. A cena segue as coordenadas do solver.`);
    setCommandState('COMPLETE', `${current.lengths.crank} → ${operation.newValue} mm aplicado.`);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    setCommandState('ERROR', error instanceof Error ? error.message : 'Não foi possível aplicar a experiência.');
    return false;
  } finally {
    if (currentSequence === sequence) { demoBusy = false; abortController = undefined; }
  }
}

function dispatch(action: SpatialAction): Promise<boolean> {
  if (!lab || !lengths || project.status !== 'ready') {
    setCommandState('ERROR', 'Ainda não existe um mecanismo aberto. Explore o exemplo ou crie uma montagem manual.');
    return Promise.resolve(false);
  }
  switch (action.kind) {
    case 'explode': frameVisualState(true); return Promise.resolve(true);
    case 'reassemble': frameVisualState(false); return Promise.resolve(true);
    case 'fit': fitLab(true); return Promise.resolve(true);
    case 'home': if (homeView) startCameraMotion(homeView); return Promise.resolve(true);
    case 'focus': focusRole(action.componentId); return Promise.resolve(true);
    case 'update_length':
      if (action.componentId !== 'crank') {
        setCommandState('ERROR', 'Nesta fase apenas o comprimento da manivela pode ser alterado por esta experiência.');
        return Promise.resolve(false);
      }
      return executeExperiment(`Aumenta a manivela para ${action.value} ${action.unit}.`, action.value);
  }
}

const orchestrator = new SpatialActionOrchestrator({
  focus: (role) => { void dispatch({ kind: 'focus', componentId: role }); },
  fit: () => { void dispatch({ kind: 'fit' }); },
  home: () => { void dispatch({ kind: 'home' }); },
  explode: () => { void dispatch({ kind: 'explode' }); },
  reassemble: () => { void dispatch({ kind: 'reassemble' }); },
  updateLength: (action) => dispatch(action),
  cancelPending: () => { sequence += 1; abortController?.abort(); abortController = undefined; demoBusy = false; },
});

function showConversation(open: boolean): void {
  document.querySelector<HTMLElement>('#demo-conversation')!.hidden = !open;
  document.querySelector('#demo-chat-toggle')?.setAttribute('aria-expanded', String(open));
}
function addMessage(role: ConversationMessage['role'], text: string, basis?: string): void {
  history.push({ role, text: text.slice(0, 300) });
  history = history.slice(-8);
  const item = document.createElement('div');
  item.className = `demo-message demo-message-${role}`;
  const label = document.createElement('strong');
  label.textContent = role === 'user' ? 'TU' : `UNFOLD${basis ? ` · ${basis}` : ''}`;
  const content = document.createElement('p');
  content.textContent = text;
  item.append(label, content);
  const messages = document.querySelector<HTMLElement>('#demo-messages')!;
  messages.append(item);
  while (messages.childElementCount > 8) messages.firstElementChild?.remove();
  messages.scrollTop = messages.scrollHeight;
  showConversation(true);
}
function reply(text: string, basis: string): void {
  addMessage('assistant', text, basis);
  setCommandState('COMPLETE', text);
  voiceOutput.speak(text);
}
function conversationContext(): ConversationContext {
  const document = imageAnalysis ? (() => {
    const documentData = imageAnalysis.document;
    const facts = { facts: documentData.elements.map((item) => `${item.label} [${item.status}; ${item.evidence}]`).concat(documentData.relations.map((item) => `${item.fromId} ${item.kind} ${item.toId} [${item.status}]`)), missing: documentData.missingInformation, uncertainty: documentData.ambiguities };
    return {
      domain: documentData.primaryDomain,
      summary: documentData.summary,
      facts: facts.facts.slice(0, 20),
      missing: facts.missing.slice(0, 20),
      uncertainty: facts.uncertainty.slice(0, 20),
      corrections: documentCorrections.map((item) => `${item.field}${item.targetId ? ` (${item.targetId})` : ''}: ${item.value}${item.unit ? ` ${item.unit}` : ''} [${item.provenance}]`).slice(0, 20),
    };
  })() : undefined;
  if (!lab || !lengths || project.status !== 'ready') return { mode: 'EMPTY', project: null, ...(document ? { document } : {}) };
  return { mode: lab.currentVisualState === 'inspection' ? 'INSPECTION' : 'EXPLORATION', ...(document ? { document } : {}), project: { mechanism: 'planar_four_bar', lengths: { ...lengths }, selected: selectedComponent ?? null, solverStatus: lab.currentResult.status, angleRad: lab.currentResult.inputAngleRad, provenance: project.evidenceStatus, lastOperation } };
}

function documentAgentRequest(query: string): SpatialAgentRequestV1 | undefined {
  if (!imageAnalysis) return undefined;
  const doc = imageAnalysis.document;
  const mode: SpatialAgentRequestV1['mode'] = doc.primaryDomain === 'architecture' ? 'architecture' : doc.primaryDomain === 'mechanical' ? 'mechanical' : doc.primaryDomain === 'electrical_installation' || doc.primaryDomain === 'electronics' ? 'electrical' : 'general';
  const id = `doc-${(technicalDocumentSha256 ?? '0'.repeat(64)).slice(0, 20)}`;
  return {
    schema: SPATIAL_AGENT_REQUEST_SCHEMA, query, mode, capabilities: [], scene: null,
    document: {
      id, domain: doc.primaryDomain, summary: doc.summary.slice(0, 500),
      elements: doc.elements.slice(0, 30).map((item) => ({ id: item.id, label: item.label.slice(0, 140), status: item.status, detail: `${item.rawValue ?? item.value ?? ''}${item.unit ? ` ${item.unit}` : ''}${item.evidence ? ` · ${item.evidence}` : ''}`.slice(0, 240) })),
      relations: doc.relations.slice(0, 30).map((item) => ({ id: item.id, from: item.fromId, to: item.toId, kind: item.kind, status: item.status })),
      uncertainties: doc.ambiguities.slice(0, 20).map((item) => item.slice(0, 240)),
      missing: doc.missingInformation.slice(0, 20).map((item) => item.slice(0, 240)),
    },
    history: history.slice(-6).map((item) => ({ role: item.role, text: item.text.slice(0, 300) })),
  };
}

async function runCommand(value: string, origin: SpatialCommandOrigin = 'local_deterministic'): Promise<boolean> {
  value = value.trim();
  if (!value) return false;
  cancelConversation();
  orchestrator.cancel();
  const requestSequence = conversationSequence;
  addMessage('user', value);
  if (selectedImageFile && !imageAnalysis) {
    reply('A análise desta imagem não foi concluída; não tenho conteúdo validado para responder sobre ela. Pode voltar a executar a análise ou perguntar sobre outro assunto.', 'IMAGEM NÃO ANALISADA');
    return false;
  }
  const documentAnswer = imageAnalysis ? answerTechnicalDocumentQuestion(value, imageAnalysis.document, documentFocusId, technicalValueReview) : undefined;
  if (documentAnswer) {
    if (documentAnswer.sourceIds.length || documentAnswer.basis === 'missing' && /dominio|tipo de documento|o que (e|representa)|compreend|falta|necessari|precisa/i.test(value)) {
      if (documentAnswer.sourceIds.length) {
        documentFocusId = documentAnswer.sourceIds.at(-1);
      selectedEvidenceElement = imageAnalysis?.document.elements.find((item) => item.id === documentFocusId);
        if (selectedEvidenceElement) {
        selectedReviewEntryId = selectedEvidenceElement.id;
        selectedReviewEntryLabel = selectedEvidenceElement.label;
          const verifyButton = document.querySelector<HTMLButtonElement>('#demo-image-verify-region');
          if (verifyButton) { verifyButton.hidden = selectedEvidenceElement.rawValue === null; verifyButton.disabled = selectedEvidenceElement.rawValue === null; }
          renderSelectedEvidence();
        }
      }
      reply(documentAnswer.answer, `DOCUMENTO · ${documentAnswer.basis.toUpperCase()}`);
      return true;
    }
  }
  if (hasActiveSpatialCommandHandler()) {
    setCommandState('UNDERSTANDING', 'Muse interpreta; o executor resolve o contexto e valida antes do preview.');
    const spatialAbort = new AbortController();
    conversationAbort = spatialAbort;
    const outcome = await executeActiveSpatialCommand(value, origin, spatialAbort.signal);
    if (requestSequence !== conversationSequence) return false;
    if (conversationAbort === spatialAbort) conversationAbort = undefined;
    if (!outcome) { setCommandState('ERROR', 'O editor espacial deixou de aceitar comandos.'); return false; }
    const label = outcome.status === 'preview' ? 'PREVIEW · CONFIRMAÇÃO NECESSÁRIA' : outcome.status === 'clarification' ? 'ESCLARECIMENTO' : outcome.status === 'rejected' ? 'COMANDO RECUSADO' : outcome.status === 'failed' ? 'FALHA' : outcome.message.startsWith('Muse indisponível;') ? 'CENA · LOCAL' : 'MUSE · CENA';
    reply(outcome.message, label);
    setCommandState(outcome.status === 'preview' ? 'AWAITING_CONFIRMATION' : outcome.status === 'clarification' ? 'CLARIFICATION' : outcome.status === 'rejected' ? 'REJECTED' : outcome.status === 'failed' ? 'ERROR' : 'COMPLETE', outcome.message);
    return outcome.status === 'completed' || outcome.status === 'preview';
  }
  const parsed = parseSpatialCommand(value, selectedComponent);
  if (project.status === 'ready' && parsed.status === 'recognized') {
    setCommandState(parsed.action.kind === 'update_length' ? 'PROCESSING' : 'EXECUTING', 'A executar a acção.');
    const result = await orchestrator.dispatch(parsed.action);
    if (requestSequence !== conversationSequence) return false;
    const status = document.querySelector('#demo-command-message')?.textContent ?? '';
    if (result) {
      if (parsed.action.kind !== 'update_length') lastOperation = `Acção espacial executada: ${parsed.action.kind}.`;
      reply(parsed.action.kind === 'update_length' ? (lastOperation ?? 'Alteração concluída.') : `Acção executada: ${parsed.action.kind}.`, 'ACÇÃO');
    } else reply(status || 'A operação não foi executada.', 'RESULTADO');
    return result;
  }
  if (project.status === 'ready' && parsed.status === 'unknown' && parsed.reason.startsWith('Qual é a barra')) {
    reply(parsed.reason, 'ESCLARECIMENTO');
    return false;
  }
  const projectAnswer = answerProjectQuestion(value, conversationContext());
  if (projectAnswer) { reply(projectAnswer.text, projectAnswer.basis); return projectAnswer.basis !== 'ESCLARECIMENTO'; }
  const documentRequest = documentAgentRequest(value);
  if (documentRequest) {
    const abort = new AbortController(); conversationAbort = abort;
    setCommandState('PROCESSING', 'Muse está a consultar o documento aceite; não serão propostas alterações sem cena e capacidade compatível.');
    try {
      await verifyBackendCompatibility(fetch);
      const response = await fetch(`${API_BASE_URL}/spatial-agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(documentRequest), signal: abort.signal });
      const payload: unknown = await response.json();
      if (requestSequence !== conversationSequence) return false;
      if (!response.ok || !payload || typeof payload !== 'object' || !('result' in payload)) throw new Error('A interpretação documental não passou na validação.');
      const result = parseSpatialAgentResult(JSON.stringify((payload as { result: unknown }).result), documentRequest);
      if (result.kind === 'PROPOSE_ACTION') { reply('Este documento não está ligado a uma cena compatível para edição. Nenhuma operação foi proposta.', 'CAPACIDADE BLOQUEADA'); return false; }
      reply(result.kind === 'ANSWER' ? result.text : result.question, result.kind === 'ANSWER' ? `MUSE · DOCUMENTO · ${result.basis.toUpperCase()}` : 'ESCLARECIMENTO · DOCUMENTO');
      return result.kind === 'ANSWER';
    } catch (error) {
      if (requestSequence !== conversationSequence || error instanceof DOMException && error.name === 'AbortError') return false;
      reply('Não foi possível obter uma resposta contextual validada. A análise aceite e as respectivas evidências permanecem disponíveis.', 'MUSE · INDISPONÍVEL');
      return false;
    } finally { if (requestSequence === conversationSequence) conversationAbort = undefined; }
  }
  const abort = new AbortController();
  conversationAbort = abort;
  setCommandState('PROCESSING', 'A consultar o assistente.');
  try {
    await verifyBackendCompatibility(fetch);
    if (requestSequence !== conversationSequence || abort.signal.aborted) return false;
    const response = await fetch(`${API_BASE_URL}/conversation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: value, history: history.slice(0, -1), context: conversationContext() }), signal: abort.signal });
    const payload: unknown = await response.json();
    if (requestSequence !== conversationSequence) return false;
    if (!response.ok || !payload || typeof payload !== 'object' || !('response' in payload)) throw new Error('O assistente está indisponível. Tente novamente.');
    const answer = parseConversationResponse(JSON.stringify(payload.response));
    if (answer.action) {
      if (project.status !== 'ready' || !authorizeProposedAction(value, selectedComponent, answer.action)) {
        reply('Não foi possível confirmar a acção solicitada. Indique explicitamente o componente e a operação.', 'ESCLARECIMENTO');
        return false;
      }
      const executed = await orchestrator.dispatch(answer.action);
      if (requestSequence !== conversationSequence) return false;
      if (!executed) { reply(document.querySelector('#demo-command-message')?.textContent || 'A acção não foi executada.', 'RESULTADO'); return false; }
      lastOperation = answer.action.kind === 'update_length' ? lastOperation : `Acção espacial executada: ${answer.action.kind}.`;
      reply(answer.action.kind === 'update_length' ? (lastOperation ?? 'Alteração concluída.') : `Acção executada: ${answer.action.kind}.`, 'ACÇÃO');
      return true;
    }
    reply(answer.text, answer.basis === 'general' ? 'EXPLICAÇÃO GERAL · IA' : answer.basis === 'unknown' ? 'INCERTO · IA' : 'RESPOSTA DA IA · NÃO VERIFICADA');
    return true;
  } catch (error) {
    if (requestSequence !== conversationSequence || error instanceof DOMException && error.name === 'AbortError') return false;
    reply('Não foi possível consultar o assistente. Pode continuar a usar os comandos locais.', 'INDISPONÍVEL');
    return false;
  } finally {
    if (requestSequence === conversationSequence) conversationAbort = undefined;
  }
}

function actionFromButton(button: HTMLElement): void {
  cancelConversation();
  orchestrator.cancel();
  const action = button.dataset.demoAction;
  toggleActionMenu(false);
  if (action === 'explode' || action === 'reassemble' || action === 'fit' || action === 'home') void dispatch({ kind: action });
  if (action === 'focus') void dispatch({ kind: 'focus', componentId: 'crank' });
  if (action === 'restore') restoreOriginalDesign();
}

document.querySelector('#demo-chat-toggle')?.addEventListener('click', () => showConversation(document.querySelector<HTMLElement>('#demo-conversation')!.hidden));
document.querySelector('#demo-chat-close')?.addEventListener('click', () => showConversation(false));
document.querySelector('#demo-stop-speech')?.addEventListener('click', () => voiceOutput.cancel());
document.querySelector('#demo-voice-output')?.addEventListener('click', (event) => {
  if (!voiceOutput.supported) { setCommandState('ERROR', 'Resposta por voz não está disponível neste browser.'); return; }
  const spokenReplies = voiceOutput.setEnabled(!voiceOutput.enabled);
  const button = event.currentTarget as HTMLButtonElement;
  button.setAttribute('aria-pressed', String(spokenReplies));
  button.textContent = spokenReplies ? 'Voz: ligada' : 'Voz: desligada';
});

document.querySelector('#demo-submit')?.addEventListener('click', () => { const input = document.querySelector<HTMLTextAreaElement>('#demo-question'); if (input) void runCommand(input.value.trim()); });
document.querySelector('#demo-question')?.addEventListener('input', (event) => {
  const input = event.currentTarget as HTMLTextAreaElement;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 88)}px`;
  if (!['PROCESSING', 'EXECUTING', 'LISTENING'].includes(commandState)) setCommandState(input.value.trim() ? 'TYPING' : 'IDLE', input.value.trim() ? 'Comando pronto para enviar.' : 'O laboratório está pronto.');
});
document.querySelector('#demo-question')?.addEventListener('keydown', (event) => { const keyboard = event as KeyboardEvent; if (keyboard.key === 'Escape') { voiceInput.stop(); cancelConversation(); if (commandState === 'AWAITING_CONFIRMATION' || commandState === 'PREVIEW') document.querySelector<HTMLButtonElement>('#cancel-preview')?.click(); } else if (keyboard.key === 'Enter' && !keyboard.shiftKey) { keyboard.preventDefault(); const input = event.currentTarget as HTMLTextAreaElement; void runCommand(input.value.trim()); } });
document.querySelector('#demo-question')?.addEventListener('paste', (event) => {
  handlePastedImage(event as ClipboardEvent, selectImageFile);
});
document.querySelectorAll<HTMLElement>('[data-demo-action]').forEach((button) => button.addEventListener('click', () => actionFromButton(button)));
document.querySelectorAll<HTMLButtonElement>('[data-demo-command]').forEach((button) => button.addEventListener('click', () => {
  const input = document.querySelector<HTMLTextAreaElement>('#demo-question');
  if (!input) return;
  input.value = button.dataset.demoCommand ?? '';
  void runCommand(input.value);
}));
document.querySelector('#demo-empty-photo')?.addEventListener('click', openImagePicker);
document.querySelector('#demo-image-add')?.addEventListener('click', openImagePicker);
document.querySelector('#demo-chat-image')?.addEventListener('click', openImagePicker);
document.querySelector('#demo-empty-manual')?.addEventListener('click', () => {
  const setup = document.querySelector<HTMLElement>('#demo-manual-setup');
  if (setup) setup.hidden = false;
  document.querySelector<HTMLInputElement>('#demo-manual-form input')?.focus();
});
document.querySelector('#demo-empty-example')?.addEventListener('click', () => {
  openFourBarProject('example', PHASE4A_LENGTHS, 0);
});
document.querySelector('#demo-manual-close')?.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#demo-manual-setup')!.hidden = true;
});
document.querySelector('#demo-manual-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const parsed = parseManualFourBarParameters(Object.fromEntries(['ground', 'crank', 'coupler', 'rocker', 'angle'].map((key) => [key, data.get(key)])));
  if (parsed.status === 'invalid') {
    setText('#demo-manual-error', `Valor inválido em ${parsed.field}. Comprimentos têm de ser positivos; o ângulo deve estar entre 0° e 360°.`);
    return;
  }
  setText('#demo-manual-error', '');
  openFourBarProject('manual', parsed.value.lengths, parsed.value.angleDegrees);
});
document.querySelector('#demo-return-empty')?.addEventListener('click', returnToEmptyLab);
function toggleActionMenu(force?: boolean): void {
  const menu = document.querySelector<HTMLElement>('#demo-actions');
  const expanded = force ?? Boolean(menu?.hidden);
  if (menu) menu.hidden = !expanded;
  document.querySelector('#demo-tools-toggle')?.setAttribute('aria-expanded', String(expanded));
  document.querySelector('#demo-nav-experiences')?.setAttribute('aria-expanded', String(expanded));
}
document.querySelector('#demo-tools-toggle')?.addEventListener('click', () => toggleActionMenu());
document.querySelector('#demo-nav-experiences')?.addEventListener('click', () => toggleActionMenu());
document.querySelector('#demo-inspector-toggle')?.addEventListener('click', () => setInspector(shell.dataset.inspectorOpen !== 'true'));
document.querySelector('#demo-readout-close')?.addEventListener('click', () => setInspector(false));
document.querySelectorAll<HTMLButtonElement>('[data-demo-flow]').forEach((button) => button.addEventListener('click', () => {
  setActiveFlow(button.dataset.demoFlow as 'capture' | 'understand' | 'explore');
  if (button.dataset.demoFlow === 'capture') openImagePicker();
  if (button.dataset.demoFlow === 'understand') {
    const panel = document.querySelector<HTMLElement>('#demo-image-insight');
    if (panel && !panel.hidden) panel.focus();
    else setCommandState('IDLE', 'Seleccione uma fotografia para iniciar a interpretação.');
  }
  if (button.dataset.demoFlow === 'explore') {
    closeImageInsight();
    setInspector(false);
    setActiveFlow('explore');
    if (project.status === 'empty') openFourBarProject('example', PHASE4A_LENGTHS, 0);
    else { fitLab(true); setDemoState('EXPLORAR', 'Four-Bar Lab: projecto independente de qualquer fotografia.'); }
  }
}));
document.querySelector('#demo-hand-toggle')?.addEventListener('click', () => { if (handControlEnabled) stopHandControl(); else void startHandControl(); });
document.querySelector('#demo-hand-stop')?.addEventListener('click', stopHandControl);
const commandBar = document.querySelector<HTMLElement>('.demo-command');
const commandDragHandle = document.querySelector<HTMLButtonElement>('#demo-command-drag');
function applyCommandOffset(x: number, y: number): void {
  if (!commandBar) return;
  const rect = commandBar.getBoundingClientRect();
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const centerX = viewportWidth / 2;
  const bottom = Number.parseFloat(getComputedStyle(commandBar).bottom) || 24;
  const baseTop = viewportHeight - bottom - rect.height - commandOffset.y;
  const minX = 12 - (centerX - rect.width / 2);
  const maxX = viewportWidth - 12 - (centerX + rect.width / 2);
  const minY = 12 - baseTop;
  const maxY = viewportHeight - 12 - (baseTop + rect.height);
  commandOffset = { x: Math.min(Math.max(x, minX), maxX), y: Math.min(Math.max(y, minY), maxY) };
  commandBar.style.setProperty('--command-offset-x', `${commandOffset.x}px`);
  commandBar.style.setProperty('--command-offset-y', `${commandOffset.y}px`);
}
commandDragHandle?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  commandDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: commandOffset.x, offsetY: commandOffset.y };
  commandDragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});
commandDragHandle?.addEventListener('pointermove', (event) => {
  if (!commandDrag || event.pointerId !== commandDrag.pointerId) return;
  applyCommandOffset(commandDrag.offsetX + event.clientX - commandDrag.startX, commandDrag.offsetY + event.clientY - commandDrag.startY);
});
const endCommandDrag = (event: PointerEvent) => { if (commandDrag?.pointerId === event.pointerId) commandDrag = undefined; };
commandDragHandle?.addEventListener('pointerup', endCommandDrag);
commandDragHandle?.addEventListener('pointercancel', endCommandDrag);
window.addEventListener('resize', () => applyCommandOffset(commandOffset.x, commandOffset.y));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const imagePanel = document.querySelector<HTMLElement>('#demo-image-insight');
  const actionMenu = document.querySelector<HTMLElement>('#demo-actions');
  if (imagePanel && !imagePanel.hidden) closeImageInsight();
  else if (actionMenu && !actionMenu.hidden) toggleActionMenu(false);
  else if (shell.dataset.inspectorOpen === 'true') setInspector(false);
});
document.addEventListener('pointerdown', (event) => {
  const menu = document.querySelector<HTMLElement>('#demo-actions');
  if (menu && !menu.hidden && !(event.target instanceof Element && (event.target.closest('#demo-actions') || event.target.closest('#demo-tools-toggle') || event.target.closest('#demo-nav-experiences')))) toggleActionMenu(false);
});
document.querySelector('#demo-image')?.addEventListener('click', openImagePicker);
document.querySelector('#demo-image-input')?.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) selectImageFile(file);
});
document.querySelector('#demo-image-confirm')?.addEventListener('click', () => { void runImageInsight(); });
document.querySelector('#demo-image-cancel')?.addEventListener('click', closeImageInsight);
document.querySelector('#demo-image-close')?.addEventListener('click', closeImageInsight);
document.querySelector('#demo-image-verify-region')?.addEventListener('click', beginRegionSelection);
const imagePreviewFrame = document.querySelector<HTMLElement>('#demo-image-preview-frame');
imagePreviewFrame?.addEventListener('pointerdown', (event) => {
  if (!regionSelection.active) return;
  const image = document.querySelector<HTMLImageElement>('#demo-image-preview');
  const point = image && normalizedPoint(image, event.clientX, event.clientY);
  if (!point) { setText('#demo-image-region-status', 'Comece a selecção dentro da área visível da fotografia.'); return; }
  regionSelection = { active: true, pointerId: event.pointerId, start: point, current: point };
  imagePreviewFrame?.setPointerCapture(event.pointerId);
  event.preventDefault();
});
imagePreviewFrame?.addEventListener('pointermove', (event) => {
  if (!regionSelection.active || regionSelection.pointerId !== event.pointerId) return;
  const image = document.querySelector<HTMLImageElement>('#demo-image-preview');
  const point = image && normalizedPoint(image, event.clientX, event.clientY);
  if (!point) return;
  regionSelection.current = point;
  displayRegionSelection();
});
imagePreviewFrame?.addEventListener('pointerup', (event) => {
  if (regionSelection.pointerId !== event.pointerId) return;
  const image = document.querySelector<HTMLImageElement>('#demo-image-preview');
  const point = image && normalizedPoint(image, event.clientX, event.clientY);
  if (point) regionSelection.current = point;
  completeRegionSelection(event.pointerId);
});
imagePreviewFrame?.addEventListener('pointercancel', (event) => { if (regionSelection.pointerId === event.pointerId) completeRegionSelection(event.pointerId); });
document.querySelector('#demo-value-confirm')?.addEventListener('click', () => {
  if (!technicalValueReview || !selectedReviewEntryId) return;
  try {
    technicalValueReview = applyHumanValueDecision(technicalValueReview, selectedReviewEntryId, { action: 'confirm' });
    saveTechnicalValueReview(); refreshSelectedReview();
    setCommandState('COMPLETE', 'Confirmação humana registada; a extracção original foi preservada.');
  } catch (error) { setCommandState('ERROR', error instanceof Error ? error.message : 'Não foi possível confirmar a leitura.'); }
});
document.querySelector('#demo-value-correct-button')?.addEventListener('click', () => {
  if (!technicalValueReview || !selectedReviewEntryId) return;
  const rawValue = document.querySelector<HTMLInputElement>('#demo-value-corrected')?.value.trim() ?? '';
  const unit = document.querySelector<HTMLInputElement>('#demo-value-unit')?.value.trim() || null;
  const number = rawValue.match(/[-+]?\d+(?:[.,]\d+)?/);
  try {
    technicalValueReview = applyHumanValueDecision(technicalValueReview, selectedReviewEntryId, { action: 'correct', rawValue, value: number ? Number(number[0]!.replace(',', '.')) : null, unit });
    saveTechnicalValueReview(); refreshSelectedReview();
    setCommandState('COMPLETE', 'Correcção humana registada em separado; valor original intacto.');
  } catch (error) { setCommandState('ERROR', error instanceof Error ? error.message : 'Correcção inválida.'); }
});
document.querySelector('#demo-value-reject')?.addEventListener('click', () => {
  if (!technicalValueReview || !selectedReviewEntryId) return;
  try {
    technicalValueReview = applyHumanValueDecision(technicalValueReview, selectedReviewEntryId, { action: 'reject', note: 'Leitura declarada incorrecta pelo utilizador após comparação visual com a imagem original.' });
    saveTechnicalValueReview(); refreshSelectedReview();
    setCommandState('COMPLETE', 'Leitura rejeitada explicitamente; o registo original foi preservado.');
  } catch (error) { setCommandState('ERROR', error instanceof Error ? error.message : 'Não foi possível rejeitar a leitura.'); }
});
document.querySelector('#demo-document-correction')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  try {
    const correction = createDocumentCorrection({
      field: String(data.get('field')) as DocumentCorrection['field'],
      targetId: String(data.get('targetId') ?? '').trim() || undefined,
      value: String(data.get('value') ?? ''),
      unit: String(data.get('unit') ?? '').trim() || undefined,
    });
    documentCorrections = [...documentCorrections, correction].slice(-40);
    renderDocumentCorrections();
    (event.currentTarget as HTMLFormElement).reset();
    setCommandState('COMPLETE', 'Correcção registada com proveniência explícita do utilizador.');
  } catch (error) {
    setCommandState('ERROR', error instanceof Error ? error.message : 'Correcção inválida.');
  }
});
document.querySelector('#demo-electrical-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  try {
    electricalCircuit = createUserElectricalCircuit({
      voltageV: Number(data.get('voltageV')),
      currentLimitA: Number(data.get('currentLimitA')),
      lightingVA: Number(data.get('lightingVA')),
      outletVA: Number(data.get('outletVA')),
      confirmedTopology: data.get('confirmedTopology') === 'on',
    });
    renderElectricalCircuit();
    setCommandState('COMPLETE', 'Electrical Sandbox criado com parâmetros introduzidos e topologia confirmada pelo utilizador.');
  } catch (error) {
    setCommandState('ERROR', error instanceof Error ? error.message : 'Parâmetros eléctricos inválidos.');
  }
});
document.querySelector('#demo-electrical-example')?.addEventListener('click', () => {
  electricalCircuit = createIndependentElectricalExample();
  renderElectricalCircuit();
  setCommandState('COMPLETE', 'Exemplo eléctrico independente carregado; não corresponde à imagem analisada.');
});
document.querySelector('#demo-electrical-update-load')?.addEventListener('click', () => {
  if (!electricalCircuit) return;
  try {
    electricalCircuit = applyElectricalOperation(electricalCircuit, { kind: 'update_load_apparent_power', loadId: 'outlet-1', valueVA: Number(document.querySelector<HTMLInputElement>('#demo-electrical-load-value')?.value) });
    renderElectricalCircuit();
    setCommandState('COMPLETE', 'Corrente nominal e estado de sobrecarga recalculados deterministicamente.');
  } catch (error) { setCommandState('ERROR', error instanceof Error ? error.message : 'Valor VA inválido.'); }
});
document.querySelector('#demo-electrical-toggle-branch')?.addEventListener('click', () => {
  const branch = electricalCircuit?.branches[0];
  if (!electricalCircuit || !branch) return;
  electricalCircuit = applyElectricalOperation(electricalCircuit, { kind: 'set_branch_enabled', branchId: branch.id, enabled: !branch.enabled });
  renderElectricalCircuit();
});
document.querySelector('#demo-electrical-open-feed')?.addEventListener('click', () => {
  const feed = electricalCircuit?.connections.find((connection) => connection.id === 'feed-1');
  if (!electricalCircuit || !feed) return;
  electricalCircuit = applyElectricalOperation(electricalCircuit, { kind: 'set_connection_closed', connectionId: feed.id, closed: !feed.closed });
  renderElectricalCircuit();
});
document.querySelector('#demo-image-example')?.addEventListener('click', () => {
  closeImageInsight();
  openFourBarProject('example', PHASE4A_LENGTHS, 0);
});
document.querySelector('#demo-build-spatial')?.addEventListener('click', async () => {
  if (!selectedImageFile || imageAnalysis?.document.primaryDomain !== 'architecture') return;
  const button = document.querySelector<HTMLButtonElement>('#demo-build-spatial');
  if (button) button.disabled = true;
  try {
    const technicalDocument = imageAnalysis.document;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(technicalDocument)));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    await saveSpatialSourceImage(selectedImageFile, { documentId: `doc-${hash.slice(0, 20)}`, sha256: hash }, technicalDocument);
    await openSpatialEditor('accepted-document');
  } catch (error) {
    if (button) button.disabled = false;
    setText('#demo-image-status', error instanceof Error ? error.message : 'Não foi possível transferir a imagem para o tracing espacial.');
  }
});
document.querySelector('#demo-open-spatial')?.addEventListener('click', () => { void openSpatialEditor(); });
document.querySelector('#demo-nav-plans')?.addEventListener('click', () => { void openSpatialEditor(); });
const micButton = document.querySelector<HTMLButtonElement>('#demo-mic');
const startPushToTalk = () => { if (voiceInput.status !== 'LISTENING' && voiceInput.status !== 'PROCESSING') { cancelConversation(); orchestrator.cancel(); voiceInput.start(); } };
micButton?.addEventListener('pointerdown', (event) => { if ((event as PointerEvent).button !== 0) return; event.preventDefault(); startPushToTalk(); });
micButton?.addEventListener('pointerup', () => voiceInput.finish());
micButton?.addEventListener('pointercancel', () => voiceInput.stop());
micButton?.addEventListener('keydown', (event) => { const key = event as KeyboardEvent; if ((key.key === ' ' || key.key === 'Enter') && !key.repeat) { key.preventDefault(); startPushToTalk(); } else if (key.key === 'Escape') voiceInput.stop(); });
micButton?.addEventListener('keyup', (event) => { const key = event as KeyboardEvent; if (key.key === ' ' || key.key === 'Enter') { key.preventDefault(); voiceInput.finish(); } });
document.querySelector('#demo-scene')?.addEventListener('pointerdown', (event) => { if (!lab) return; const pointerEvent = event as PointerEvent; const rect = renderer.domElement.getBoundingClientRect(); const pointer = new Vector2(((pointerEvent.clientX - rect.left) / rect.width) * 2 - 1, -((pointerEvent.clientY - rect.top) / rect.height) * 2 + 1); const raycaster = new Raycaster(); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(lab.selectableMeshes())[0]; const role = hit?.object.userData.labRole as BarName | undefined; if (role) { cancelConversation(); orchestrator.cancel(); focusRole(role); } });

voiceInput = new BrowserVoiceInput({
  onStatus: (status: VoiceStatus, message?: string) => { if (status === 'COMPLETE' && commandState === 'AWAITING_CONFIRMATION') return; setCommandState(status === 'LISTENING' ? 'LISTENING' : status === 'ERROR' ? 'ERROR' : status === 'PROCESSING' ? 'PROCESSING' : status === 'EXECUTING' ? 'EXECUTING' : status === 'COMPLETE' ? 'COMPLETE' : 'IDLE', message ?? 'Entrada de voz pronta.'); document.querySelector('#demo-mic')?.setAttribute('aria-pressed', String(status === 'LISTENING')); document.querySelector('#demo-mic')?.setAttribute('aria-label', status === 'LISTENING' ? 'A ouvir; solte para terminar' : 'Mantenha premido para falar'); },
  onTranscript: (value) => { const input = document.querySelector<HTMLTextAreaElement>('#demo-question'); if (input) input.value = value; },
  onCommand: (value) => runCommand(value, 'speech_transcript'),
});

controls.addEventListener('start', () => {
  if (cameraMotion || labEntryStarted !== undefined) {
    cameraMotion = undefined;
    labEntryStarted = undefined;
    if (lab) { lab.root.scale.setScalar(1); lab.root.position.y = 0; }
    shell.dataset.demoPhase = 'MANUAL';
    setDemoState('MANUAL', 'Controlo manual da câmara activo.');
  }
});
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

function updateReadouts(now: number): void {
  fpsFrames += 1;
  if (now - fpsStarted >= 1000) { fps = fpsFrames * 1000 / (now - fpsStarted); fpsFrames = 0; fpsStarted = now; }
  setText('#demo-fps', `${fps.toFixed(0)} FPS`);
  if (lab) {
    setText('#demo-asset', lab.crankAssetStatus.toUpperCase());
    setText('#demo-metrics', `${document.querySelectorAll('canvas').length} WEBGL RENDERER · ${formatResidual(fourBarLabResidual(lab.currentResult))} MM MAX RESIDUAL`);
  } else {
    setText('#demo-asset', 'NOT LOADED');
    setText('#demo-metrics', 'EMPTY LAB · NO MECHANISM LOADED');
  }
}

function animate(): void {
  if (!demoLoopActive) return;
  demoFrame = requestAnimationFrame(animate);
  const now = performance.now();
  if (labEntryStarted !== undefined && lab) {
    const progress = reducedMotion ? 1 : Math.min((now - labEntryStarted) / 1050, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    lab.root.scale.setScalar(0.72 + 0.28 * eased);
    lab.root.position.y = -0.8 + 0.8 * eased;
    if (progress >= 1) {
      labEntryStarted = undefined;
      shell.dataset.demoPhase = 'READY';
      setDemoState('EXPLORATION', 'O mecanismo está pronto para exploração espacial.');
    }
  }
  if (cameraMotion) {
    const progress = Math.min((now - cameraMotion.started) / cameraMotion.duration, 1);
    const motionEase = 1 - Math.pow(1 - progress, 4);
    camera.position.lerpVectors(cameraMotion.fromPosition, cameraMotion.toPosition, motionEase);
    controls.target.lerpVectors(cameraMotion.fromTarget, cameraMotion.toTarget, motionEase);
    if (progress >= 1) { cameraMotion = undefined; setDemoState(lab?.currentVisualState === 'inspection' ? 'INSPECTION' : 'READY'); }
  }
  lab?.update(now);
  controls.update();
  renderer.render(scene, camera);
  updateReadouts(now);
}

resize();
setDemoState('EMPTY LAB', 'Uma ideia é suficiente para começar.');
animate();

async function openSpatialEditor(source?: 'accepted-document'): Promise<void> {
  if (spatialEditorUnmount || spatialEditorOpening) return;
  spatialEditorOpening = true;
  shell.classList.add('is-spatial-editing');
  demoLoopActive = false;
  if (demoFrame) cancelAnimationFrame(demoFrame);
  voiceInput.stop(); stopHandControl(); controls.enabled = false; if (lab) lab.root.visible = false;
  const command = document.querySelector<HTMLTextAreaElement>('#demo-question');
  const submit = document.querySelector<HTMLButtonElement>('#demo-submit');
  setCommandState('IDLE', 'Editor arquitectónico activo. Comandos locais passam por preview e confirmação; a IA não escreve directamente na cena.');
  command?.setAttribute('placeholder', 'Pergunte ou comande a cena arquitectónica…');
  if (command) command.disabled = false;
  if (submit) submit.disabled = false;
  if (!await suspendDemoRenderer()) {
    spatialEditorOpening = false;
    shell.classList.remove('is-spatial-editing'); controls.enabled = true; if (lab) lab.root.visible = true; demoLoopActive = true; demoFrame = requestAnimationFrame(animate);
    setCommandState('ERROR', 'Este browser não permitiu libertar o contexto WebGL mecânico; o editor não foi aberto para evitar dois contextos activos.');
    return;
  }
  spatialEditorHost = document.createElement('div');
  spatialEditorHost.className = 'demo-spatial-host';
  spatialEditorHost.setAttribute('aria-label', 'Editor espacial integrado');
  app!.append(spatialEditorHost);
  const commandBar = document.querySelector<HTMLElement>('.demo-command');
  if (commandBar?.parentElement) { commandReturnSlot = document.createComment('UNFOLD command bar return point'); commandBar.before(commandReturnSlot); }
  try {
    const { mountSpatialEditor } = await import('./spatial-editor');
    spatialEditorUnmount = mountSpatialEditor(spatialEditorHost, { source, onCommandState: (state: SpatialCommandState, message: string) => {
      const uiState = state === 'Idle' ? 'IDLE' : state === 'Listening' ? 'LISTENING' : state === 'Understanding' ? 'UNDERSTANDING' : state === 'ProposedAction' ? 'PROPOSED_ACTION' : state === 'Preview' ? 'PREVIEW' : state === 'AwaitingConfirmation' ? 'AWAITING_CONFIRMATION' : state === 'Executing' ? 'EXECUTING' : state === 'Completed' ? 'COMPLETE' : state === 'Rejected' ? 'REJECTED' : 'ERROR';
      setCommandState(uiState, message);
    }, onExit: () => {
      spatialEditorUnmount = undefined;
      if (commandBar && commandReturnSlot?.parentElement) commandReturnSlot.replaceWith(commandBar);
      commandReturnSlot = undefined;
      spatialEditorHost?.remove(); spatialEditorHost = undefined;
      setSpatialCommandBarMode(false);
      shell.classList.remove('is-spatial-editing');
      command?.setAttribute('placeholder', 'Pergunta, constrói ou transforma...');
      void restoreDemoRenderer().then((restored) => {
        if (!restored) throw new Error('O contexto WebGL do Four-Bar não recuperou após sair da arquitectura.');
        controls.enabled = true; if (lab) lab.root.visible = true;
        demoLoopActive = true; resize(); demoFrame = requestAnimationFrame(animate);
      }).catch((error: unknown) => setCommandState('ERROR', error instanceof Error ? error.message : 'Falha ao recuperar o renderer mecânico.'));
    } });
  } catch (error) {
    if (commandBar && commandReturnSlot?.parentElement) commandReturnSlot.replaceWith(commandBar);
    commandReturnSlot = undefined;
    spatialEditorHost?.remove(); spatialEditorHost = undefined;
    shell.classList.remove('is-spatial-editing');
    setSpatialCommandBarMode(false);
    void restoreDemoRenderer().then((restored) => { if (!restored) throw new Error('O contexto Three.js não recuperou.'); controls.enabled = true; if (lab) lab.root.visible = true; demoLoopActive = true; demoFrame = requestAnimationFrame(animate); }).catch(() => setCommandState('ERROR', 'Não foi possível iniciar o editor nem recuperar o renderer anterior.'));
    setCommandState('ERROR', error instanceof Error ? error.message : 'Não foi possível abrir o editor espacial.');
  }
  spatialEditorOpening = false;
  if (commandBar && spatialEditorHost) spatialEditorHost.append(commandBar);
  if (hasActiveSpatialCommandHandler()) setSpatialCommandBarMode(true);
}
window.addEventListener('beforeunload', () => {
  cancelConversation();
  orchestrator.cancel();
  voiceInput.stop();
  stopHandControl();
  imageAbortController?.abort();
  clearImagePreview();
  lab?.dispose();
  controls.dispose();
  renderer.dispose();
  spatialEditorUnmount?.();
  window.visualViewport?.removeEventListener('resize', resize);
  floor.geometry.dispose();
  (floor.material as MeshStandardMaterial).dispose();
  grid.geometry.dispose();
  (grid.material as LineBasicMaterial).dispose();
  delete window.__UNFOLD_DEMO_METRICS__;
});

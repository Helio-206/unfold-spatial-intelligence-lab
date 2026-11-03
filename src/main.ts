import './brand.css';
import { applyMotionTokens } from './motion/tokens';
import './style.css';

applyMotionTokens();
const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Elemento #app não encontrado.');

switch (window.location.pathname) {
  case '/landing':
    window.location.replace('/landing/');
    break;
  case '/circuit':
    void import('./circuit-lab').then(({ mountCircuitLab }) => mountCircuitLab(app));
    break;
  case '/spatial-editor':
    void import('./spatial-editor').then(({ mountSpatialEditor }) => mountSpatialEditor(app));
    break;
  case '/universal-spatial':
    void import('./universal-spatial/harness').then(({ mountUniversalSpatialHarness }) => mountUniversalSpatialHarness(app));
    break;
  case '/phase-4a':
    void import('./phase4a');
    break;
  case '/cinema':
    void import('./living/cinema/cinema-page').then(({ mountCinema }) => mountCinema(app));
    break;
  case '/living':
    void import('./living/unified-workspace/shell').then(({ mountLivingShell }) => mountLivingShell(app));
    break;
  case '/workspace':
    void import('./workspace');
    break;
  case '/':
  case '/demo':
  default:
    void import('./demo');
    break;
}

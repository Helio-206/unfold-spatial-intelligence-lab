import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Elemento #app não encontrado.');

switch (window.location.pathname) {
  case '/spatial-editor':
    void import('./spatial-editor').then(({ mountSpatialEditor }) => mountSpatialEditor(app));
    break;
  case '/phase-4a':
    void import('./phase4a');
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

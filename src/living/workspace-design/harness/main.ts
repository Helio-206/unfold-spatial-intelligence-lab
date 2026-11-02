/**
 * Isolated workspace harness (Vite dev: /src/living/workspace-design/harness/index.html).
 * Query: agent=fixture|auto (default auto: live route, fixture when unavailable), profile=realtime|export, rm=1 reduced
 * motion, dpr=<n>. Exposes window.__workspace for browser tests and captures.
 */
import '../../../brand.css';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../contracts/fixtures/excavator.assembly.v1';
import { SpatialWorkspace } from '../workspace';

const q = new URLSearchParams(location.search);
document.body.style.margin = '0';
const ws = new SpatialWorkspace(document.querySelector<HTMLElement>('#app')!, {
  assembly: EXCAVATOR_ASSEMBLY_V1,
  agent: { mode: q.get('agent') === 'fixture' ? 'fixture' : 'auto' },
  profile: q.get('profile') === 'export' ? 'export' : 'realtime',
  reducedMotion: q.has('rm') ? q.get('rm') === '1' : undefined,
  preserveDrawingBuffer: true,
  pixelRatio: q.has('dpr') ? Number(q.get('dpr')) : undefined,
});
ws.renderNow();
Object.assign(window, { __workspace: ws, __foundry: { ready: true, stats: () => ws.stats(), render: () => ws.renderNow() } });

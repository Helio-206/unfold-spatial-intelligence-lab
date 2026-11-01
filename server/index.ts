import { createMetaServer, defaultStateFile } from './meta-server';

const port = Number(process.env.UNFOLD_BACKEND_PORT ?? 8787);
const localTokenFile = process.env.UNFOLD_LOCAL_TOKEN_FILE ?? defaultStateFile('local-token');
const server = createMetaServer({ localTokenFile });
server.listen(port, '127.0.0.1', () => {
  console.log(`UNFOLD backend listening on http://127.0.0.1:${port}`);
  console.log(`Local token file (header X-Unfold-Local-Token, scripts without Origin): ${localTokenFile}`);
});

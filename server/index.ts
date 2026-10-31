import { createMetaServer } from './meta-server';

const port = Number(process.env.UNFOLD_BACKEND_PORT ?? 8787);
const server = createMetaServer();
server.listen(port, '127.0.0.1', () => {
  console.log(`UNFOLD backend listening on http://127.0.0.1:${port}`);
});

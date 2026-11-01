import { createMetaServer } from '../server/meta-server.ts';

const server = createMetaServer({
  apiKey: 'fixture-only',
  maxMetaCalls: 1,
  metaCallBudgetFile: process.env.UNFOLD_TEST_BUDGET_FILE,
  fetchImpl: async () => new Response(JSON.stringify({
    id: 'interprocess-fixture',
    status: 'completed',
    output_text: 'ok',
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }),
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(2);
  process.stdout.write(JSON.stringify({ port: address.port }) + '\n');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));

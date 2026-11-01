import { createMetaServer, defaultStateFile, formatBudgetStartupLine } from './meta-server';

const port = Number(process.env.UNFOLD_BACKEND_PORT ?? 8787);
const localTokenFile = process.env.UNFOLD_LOCAL_TOKEN_FILE ?? defaultStateFile('local-token');
// O orçamento de chamadas Meta sobrevive a reinícios por omissão; apagar o ficheiro recomeça-o.
const metaCallBudgetFile = process.env.UNFOLD_ACCEPTANCE_BUDGET_FILE ?? defaultStateFile('meta-call-budget.json');
const server = createMetaServer({ localTokenFile, metaCallBudgetFile });
server.listen(port, '127.0.0.1', () => {
  console.log(`UNFOLD backend listening on http://127.0.0.1:${port}`);
  console.log(`Local token file (header X-Unfold-Local-Token, scripts without Origin): ${localTokenFile}`);
  console.log(formatBudgetStartupLine(server.metaCallBudget(), metaCallBudgetFile));
});

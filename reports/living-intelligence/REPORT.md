# UNFOLD — Fase 02: Living Intelligence — relatório consolidado

Branch: `claude/unfold-fase-01-reality-engine-lvhbn9`. Sem PR, sem merge.
Veredicto: **NO-GO** para declarar a Fase 02 certificada (ver 10). A execução de engenharia está concluída e demonstrada onde indicado; o que não está demonstrado está listado.

## 1. Arquitectura funcional

Tudo em `src/living/intelligence/`, sobre o `/living`, o Spatial Core e os motores existentes. Sem segundo visualizador.

| Módulo | Papel |
|---|---|
| `mechanism.ts` | Modelo de mecanismo: partes, juntas (revolute/prismatic/fixed/acoplamentos), limites, chão, parâmetros físicos. Cada afirmação tem origem `extracted`, `user` ou `ai`; a confirmação é um evento de pessoa separado (`proposed/accepted/rejected/edited`). `basisOf` devolve confirmed/hypothesis/mixed. |
| `plan-geometry.ts`, `inference.ts` | Geometria dos componentes (caixas, pistas de eixo, repetições radiais) e hipóteses de juntas. Toda a junta proposta nasce por confirmar; não inventa mecanismos internos. |
| `kinematics.ts` | Cinemática (ver 2). |
| `dynamics.ts`, `collision.ts` | Dinâmica de cadeias abertas e colisões de caixas orientadas. |
| `explain.ts` | Explicações categorizadas (observado / indicado por si / inferência da IA / cálculo determinístico / hipótese / desconhecido), ligadas a componentes, equações e valores do traço do solver. |
| `experiment.ts`, `store.ts` | Laboratório de experiências e persistência por Space. |
| `agent*.ts` | Agente (ver 4). |
| `controller.ts`, `panel.ts` | Controlador e painel «Inteligência do objecto» montado no mesmo palco do `/living`; usa a selecção, o inspector e o sistema de transacções existentes. |

A separação das quatro categorias (extraído / hipótese da IA / confirmação humana / solver) vale em todo o fluxo. Correcção herdada da Fase 01: uma proposta da IA aceite mantém `by: 'person'` e preserva `origin: 'ai_proposal'` com a proposta e `acceptedAt`; a aceitação é um evento distinto (`ai-proposals.ts`, `evidence.ts`, testes em `reality-phase01-closure`).

## 2. Sistemas cinemático e físico

Cinemática (`kinematics.ts`): produto de exponenciais; árvore de cobertura por BFS (juntas percorridas em ambos os sentidos); laços fechados resolvidos por Levenberg-Marquardt com Jacobiano por diferenças centrais e lista de arranques determinística; mobilidade pelo rank numérico ao lado do Grübler-Kutzbach; resíduo de rotação por vector de rotação do quaternião (o resíduo antissimétrico falhava a 180°, apanhado por um teste); IK, limites, varrimentos, velocidade de ponto. Estados: `solved`, `limit_violated`, `no_solution_found`, `invalid_input`. «Sem solução encontrada» não prova impossibilidade.

Dinâmica (`dynamics.ts`): Lagrange para cadeias abertas (M(q) por Jacobianos compostos, Coriolis por Christoffel, gravidade), RK4 de passo fixo. **Recusa** sem massa, centro de massa, inércia, gravidade e unidades, e lista o que falta. Forças, velocidades e acelerações só existem com esses parâmetros. Cinemático válido não é fisicamente validado, e as experiências dizem-no.

Colisão: caixas orientadas (SAT). É uma aproximação declarada; partes ligadas por junta não são testadas entre si.

## 3. Operações espaciais

`add-component`, `remove-component`, `merge-components`, `split-component` em `contracts-v2.ts`, como propostas que passam por pré-visualização, autorização e commit, num único undo, incluindo no servidor real (sessões, revisões, idempotência).
- Componentes não afectados byte-idênticos (medido).
- Fusão: proveniência = a mais fraca dos membros; transformações compostas; recusa de transformações com cisalhamento (`SPATIAL_V2_MERGE_TRANSFORM_NOT_REPRESENTABLE`); referências e restrições reapontadas.
- Divisão exige um grupo (`SPATIAL_V2_SPLIT_REQUIRES_GROUP`).
- No palco, `PlanSpaceLayer.proposeStructural` leva a operação ao mesmo fluxo de pré-visualização; a cena é recompilada no commit (ids, selecção e proveniência preservam-se; sem reutilização incremental de geometria medida).
- Poses transitórias (`applyTransientPoses`) movem a cena sem escrever no plano; repor posição original devolve o estado.

## 4. Integração Muse Spark

- Ferramentas tipadas, de quatro tipos: ler, calcular, propor, vista. Nenhuma altera estado. Propostas ficam pendentes até uma pessoa aceitar.
- Validador de ancoragem: cada afirmação cita resultados de ferramentas; números, referências ou categoria sem suporte rebaixam a afirmação para `ai` com razão escrita.
- Rota de servidor `POST /api/living/agent`: valida o pedido, limita o prompt, reserva a chamada (`reserveMetaCall`), pede texto estruturado, valida a resposta (502 se inválida). `MODEL_API_KEY` só no servidor.
- Caminho simulado: `SimulatedClient` (`simulated-planner.v1`) determinístico, rotulado «SIMULADO — não é o Muse Spark» na interface e no resultado. O painel só oferece a chamada paga com sessão do servidor, em caixa de opção explícita.
- **Não validado com o Muse Spark real**: não houve credenciais nem chamada real. Testes usam um `fetch` simulado que conta chamadas; o E2E mede 0 chamadas pagas. Registado como dívida D13 (bloqueada).

## 5. Experiências executadas e reproduzidas

Tipos: pose, varrimento, dinâmica. Cada experiência guarda entradas, condições, parâmetros, versão do objecto (hash do mecanismo; para as cinemáticas ignora física, unidades, eventos e afirmações), resultados, limitações e a etiqueta HIPOTÉTICA quando os parâmetros são hipotéticos.
- Reprodução: resultado byte a byte idêntico, ou recusa se o objecto mudou.
- Dinâmica sem parâmetros: resultado `insufficient_parameters`, sem números (visível na captura 03).
- Persistência por Space (chave = sha do plano, ≤ 40 experiências, detecção de corrupção e de ficheiro alheio); reabrir reproduz.
- E2E no `/living` (objecto reconstruído de 8 vistas + duas divisões assistidas): 3 experiências, guardar, reabrir, reproduzir com resultado idêntico.
- Nenhum resultado científico foi fabricado; as experiências são sobre o modelo indicado, não sobre o objecto real.

## 6. Testes e benchmarks

- `npm test`: 210 ficheiros, 2918 testes, **2915 passam, 3 falham** — as 3 falhas são ambientais e conhecidas (a sessão corre como root, logo `chmod 0o555` não impede a escrita: `spatial-persistence-failures` ×2, `spatial-review-binding-transition`). Não existe skip.
- `npm run build` passa.
- Testes novos desta fase: `spatial-structural-ops` (6), `intelligence-kinematics` (14), `-dynamics` (10), `-inference` (5), `-explain-experiments` (10), `-agent` (19), `-layer-controller` (8), `-compat-budget` (6). Incluem servidor HTTP real, casos negativos, integridade do undo, compatibilidade com Spaces antigos e orçamentos de recursos.
- Referências independentes (`reports/living-intelligence/benchmark.json`, regenerado por `scripts/benchmark/intelligence-bench.ts`):
  - 2R directa vs analítico: 2.7e-11.
  - Quatro barras vs solver independente: 7.4e-11. Biela-manivela vs forma fechada: 5.4e-11.
  - Período do pêndulo vs integral elíptico: erro ≤ 3.2e-10. Deriva de energia ≤ 7.3e-11.
  - Determinístico entre execuções: sim.
- Desempenho: quatro barras 0.245 ms; cadeia de 12 juntas 1.17 ms; varrimento de 100 posições 16 ms; dinâmica de 5 s 210 ms; fusão de 4 em 80 componentes 0.64 ms; remoção 0.44 ms; heap 30 MB.
- E2E (`tests/e2e/living-intelligence.pw.ts`): todos os passos passam; 0 erros de browser; 0 chamadas pagas. `reality-capture.pw.ts` passa.
- `reality-engine.pw.ts`: passa até V2 e **falha no caso negativo do ToyCar** (`[data-rl-refusal]` não aparece em 60 s). Falha igualmente em dois commits atrás, antes da Fase 02 (verificado), logo não é regressão desta fase, mas não está investigada.

## 7. Evidência visual e funcional

`reports/living-intelligence/e2e/`: `01-space-with-panel.png` (Space com o painel), `02-moved.png` (junta a 34.5°, «Válido (cinemática) · 1 GL · resíduo 2.4e-12», aviso «não é uma simulação física»), `03-ask.png` (3 experiências, dinâmica HIPOTÉTICA e a recusa por parâmetros em falta), `04-reopened.png`, `05-pending.png`, mais `e2e-result.json`. A cena é a reconstrução de vistas, com os limites da Fase 01 visíveis no painel Reality.

## 8. Limitações herdadas da Fase 01

Ver `reports/reality-engine/TECHNICAL-DEBT.md`. Fidelidade geométrica continua não demonstrada (classe `unvalidated`, nunca «fiel» para vistas do utilizador); os contornos automáticos não estão confirmados; a forma é um limite superior (casco). Toda a inteligência funcional herda esta incerteza: um mecanismo sobre uma forma não fiel é um mecanismo sobre um modelo.

## 9. Novas limitações

1. Muse Spark real não validado (D13, bloqueada por credenciais).
2. Exactidão da inferência funcional não medida (D12, bloqueada por mecanismos anotados por pessoas): regras heurísticas testadas só em exemplos. Na captura 02 há colisão de caixas em repouso entre duas partes, resultado da aproximação OBB.
3. Dinâmica só para cadeias abertas; sem contactos, impactos, atrito (excepto amortecimento viscoso) nem flexibilidade (D14, aberta).
4. Colisão por caixas orientadas, não por malhas.
5. As trajectórias de varrimento são gravadas mas não desenhadas na cena; não há vista em corte nem explosão além da ferramenta de isolar/explodir já existente.
6. Painéis flutuantes (Inteligência à esquerda, Reality à direita) podem sobrepor o inspector em larguras estreitas.
7. A cena é recompilada em cada commit estrutural.
8. Sem E2E em dispositivo móvel real.

## 10. GO / NO-GO

**NO-GO** para certificação. Razões, por ordem de peso:
- A integração real com o Muse Spark nunca foi exercitada.
- A inferência funcional não foi medida contra referência humana.
- A geometria subjacente não é fiel (herdado).
- Cinemática, dinâmica de cadeias abertas, operações estruturais, experiências e persistência estão demonstradas contra referências analíticas/independentes e em E2E; isto não chega para declarar GO, porque interfaces e testes unitários não equivalem a validação de utilizador nem de fidelidade.

## 11. Branch e commits

Branch `claude/unfold-fase-01-reality-engine-lvhbn9`. Commits da Fase 02 (mais recentes primeiro): `6c6e138` painel, controlador, poses transitórias, propostas estruturais no palco, E2E, benchmarks, manifesto e dívida D12–D14; `e7dee48` agente espacial; `bfaa7fc` inferência, explicação, experiências e correcção de proveniência; anteriores: cinemática/dinâmica e operações estruturais. Sem PR; sem merge.

## 12. Condições para a Fase 03

1. Chamadas reais ao Muse Spark autorizadas, gravadas e verificadas contra o validador de ancoragem (D13).
2. Conjunto de mecanismos anotados por pessoas independentes e F1 de juntas medido (D12).
3. Pelo menos um objecto com ground truth 3D independente, para sair de `unvalidated` na fidelidade geométrica.
4. Decisão do dono do produto sobre dinâmica com contactos/laços (D14) ou a sua exclusão explícita.
5. Parâmetros físicos medidos em pelo menos um objecto real, para comparar a simulação com uma medição.
6. Investigar a falha do caso negativo do `reality-engine.pw.ts` (anterior à Fase 02).
7. Resolver a sobreposição dos painéis flutuantes antes de adicionar mais UI.

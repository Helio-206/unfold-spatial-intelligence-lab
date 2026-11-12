# Fase 02 — Living Intelligence: integração sobre o Reality Engine

Este documento prepara a integração; não a implementa. Fonte de verdade do que existe: `src/living/reality/capabilities.ts`. Fonte de verdade da dívida: `reports/reality-engine/TECHNICAL-DEBT.md`.

## 1. Regra de base
A Living Intelligence **consome** o Reality Engine através dos seus contratos e **nunca afirma mais do que o manifesto**. Em particular:
1. Toda a saída que descreva uma reconstrução cita a classe de fidelidade **e** os três eixos (`assessReconstruction().axes`) e os bloqueios. «Fiel» não existe para vistas do utilizador.
2. As quatro categorias nunca se misturam: dado extraído, hipótese da IA, confirmação humana, resultado de solver. Uma proposta da IA só vira confirmação por acção explícita da pessoa (`acceptProposal` → edição `by: 'person'`).
3. Quando falta evidência, diz «desconhecido»; não preenche. A estrutura de partes automática e a forma do casco são hipóteses.
4. Nenhuma chamada paga em testes (fetch simulado que conta chamadas); `MODEL_API_KEY` só no servidor.

## 2. Pontos de integração (todos já existem e estão testados)
| Ponto | Contrato | Uso na Fase 02 |
|---|---|---|
| Evidência | `RealityEvidence` (v1, `validateRealityEvidence`) | Âncora de memória e de proveniência: guardar o hash, nunca o resultado sem a evidência. |
| Anfitrião | `RealityHost` (`create/open/preview/apply/step/assess`) | Operar versões; toda a alteração é uma versão desfazível. |
| Plano | `SpatialPlanV2` via `planFromModel` + Spatial Core | A IA edita componentes pelas operações tipadas existentes (`set-transform/geometry/material/repeat`); não escreve estado directamente: preview → autorização → commit. |
| Avaliação | `assessReconstruction` → `axes`, `ledger`, `statements`, `unknowns` | Base de qualquer explicação ao utilizador. |
| Gate de captura | `assessGate` | A IA pode reformular a orientação, **não** alterar códigos, severidades nem contornar o bloqueio. |
| Correcção de partes | `StoredPartEdit` (`by: 'person'`) | Destino das propostas aceites. |
| Propostas da IA | `ProposalSet` / `validateProposalSet` / `acceptProposal` (`ai-proposals.ts`) | Contrato novo: propostas de nome/fusão/divisão ligadas ao hash da evidência; propostas de outra evidência são recusadas. |

## 3. O que a Fase 02 pode construir já (sobre capacidades «demonstradas»)
1. **Interpretar a estrutura reconstruída:** propor nomes, fusões e divisões de partes como `AiPartProposal` com justificação e confiança; a pessoa aceita ou rejeita; aceitar escreve uma edição humana versionada.
2. **Explicar um Space:** conversa ancorada no livro de evidência (o que foi observado, inferido, assumido; classe e eixos; o que falta). Cada afirmação sobre forma cita a sua categoria.
3. **Orientar a captura:** transformar os itens do gate em instruções passo a passo, com a mesma severidade.
4. **Memória do Space:** lembrar decisões da pessoa (confirmações, nomes, correcções) ligadas ao hash da evidência.

## 4. O que a Fase 02 NÃO pode pressupor (dívida activa)
| Funcionalidade | Depende de | Estado actual |
|---|---|---|
| Medições em unidades reais, tolerâncias, ajustes mecânicos | D1 (fidelidade em fotografias reais), D8 | **bloqueada** — o plano é `unitless` |
| Reconhecer peças sem a pessoa («isto é uma roda») como facto | D4/D5 | **aberta** — só como hipótese etiquetada |
| Aceitar contornos automáticos em captura à mão sem confirmação | D2 | **aberta** |
| Materiais fisicamente correctos (metal/vidro) | D9 | **bloqueada** — material mate assumido |
| Editar a estrutura de um Space já construído em directo | D11 | **aberta** — exige reconstruir |
| Garantias de fluidez por dispositivo | D10 | **bloqueada** |
Uma funcionalidade da Fase 02 que dependa de um item acima só pode ser ligada quando o respectivo critério em `TECHNICAL-DEBT.md` estiver «cumprido» (regenerado pelo script indicado), não por decisão de calendário.

## 5. Testes de contrato que a Fase 02 tem de manter verdes
- Nenhuma saída da IA altera `outline`, `partEdits` ou a classe de fidelidade sem edição humana (`tests/reality-phase01-closure.test.ts`, `tests/reality-part-edits.test.ts`).
- A classe de fidelidade com contornos automáticos por confirmar nunca é «parcialmente verificada» (`tests/reality-spatial-core.test.ts`).
- O gate de captura em baixa confiança nunca é contornado (`tests/reality-capture-gate.test.ts`, E2E de captura).
- Propostas de outra evidência são recusadas; propostas de IA nunca entram como `by: 'person'` sem aceitação.

## 6. Ordem de trabalho sugerida (sem checkpoints de autorização)
1. Camada de propostas: ligar `ProposalSet` ao fluxo do Meta (servidor), com custo contabilizado e `fetch` simulado nos testes.
2. Painel de propostas no `/living` (aceitar/rejeitar por proposta, com proveniência visível).
3. Explicador ancorado no ledger.
4. Orientação de captura conversacional sobre o gate.
Em paralelo e com prioridade técnica contínua: D2, D3, D4, D6 (reconstrução).

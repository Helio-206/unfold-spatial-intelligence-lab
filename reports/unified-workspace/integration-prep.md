# Unified Spatial Workspace — preparação da integração (camada não visual)

Base: PR #17 em `9a3b3e0` (`feat/living-real-reconstruction`). Branch: `feat/unified-workspace-integration-prep`.
Âmbito: clientes, tipos, adaptadores, sessão e testes de contrato. **Não** há componentes visuais, nem alterações à Foundry, ao solver ou às branches de outros agentes.

## Módulos (`src/living/unified-workspace/`)

| Ficheiro | Função |
|---|---|
| `types.ts` | Contrato de `POST /api/living/reconstruction` (proposta, revisão, falhas tipadas). |
| `review-model.ts` | Itens que exigem decisão, rascunho de revisão e bloqueios (espelha `reviewReconstruction`). |
| `reconstruction-client.ts` | Cliente: validação de entrada antes de enviar, mapeamento de todos os estados HTTP, validação das respostas. |
| `reconstruction-session.ts` | Máquina de estados da conversa propor → rever, com cancelamento, expiração e descarte de respostas obsoletas. |
| `workspace-adapter.ts` | Única passagem de uma reconstrução para o workspace (`adoptReviewed`) e textos de falha/proveniência. |

## Estados da sessão (para o Design)

`idle → proposing → awaiting_review → reviewing → reviewed`, mais `proposal_failed`, `proposal_blocked`, `review_blocked` (422; o rascunho é mantido), `review_failed` (rede/servidor; rascunho mantido) e `expired` (404 ou 30 min).
Cada estado traz o que a interface precisa (`blockers`, `reasons`, `failure`, `draft`). `describeFailure()` dá o texto em português; `provenanceNotes()` dá as cinco notas de proveniência.

## Garantias testadas

- Nenhuma confirmação é pré-preenchida: família, caçamba, revisor, largura e cada decisão começam por fazer, e a submissão incompleta é recusada localmente sem rede.
- A resposta de revisão é descartada se afirmar mais do que o contrato permite (identidade, participação humana ou medição "verificadas", geometria fotográfica, `sessionId` diferente, montagem inválida).
- Uma proposta nunca habilita engenharia: `engineering.status` tem de ser `blocked`.
- `adoptReviewed` só aceita sessões `reviewed`, revalida a montagem, exige que a largura resumida coincida com a forma canónica `bucket-box`, recusa proveniência promovida a `verified`/`corrected` e devolve uma cópia. `motionAuthorized` é sempre `false`.
- Respostas de uma proposta substituída ou cancelada são ignoradas; um segundo envio durante `reviewing` é ignorado.
- O cliente nunca usa o token local por omissão: um browser envia `Origin`, e o token só se configura para chamadores sem browser.
- Contrato verificado contra o **handler real** do servidor (modo offline, sem chamada paga: o fetch do provider falha se for usado). A montagem adotada é aceite pelo Engineering Engine (quadro de referência válido, 13 peças, `boom_cylinder` 0,65 m aceite, 5 m recusado).

## Evidência (esta branch)

`npx vitest run --testTimeout=15000`: 95 ficheiros, 1771 testes (a base tinha 90 e 1698; +73 em `tests/unified-workspace/`). `tsc`, `npm run build` e `git diff --check` limpos. Duas mutações deliberadas (guarda de promoção desligada; verificação de participação humana invertida) fizeram falhar os testes, e foram revertidas.

## O que falta (por ordem de dependência)

1. **Entregas dos outros agentes** (Design, Cloud): não consultadas nem usadas. Nada aqui assume o seu conteúdo.
2. **Ligar `adoptReviewed` ao `SpatialWorkspace`.** Hoje a montagem é fixa na construção (`WorkspaceEngineeringSession` clona-a). Adotar uma montagem exige reconstruir a sessão do motor e o registo de componentes, ou um `loadAssembly` explícito. Depende do PR #15 (ainda não fundido); esta branch não o contém.
3. **Foundry:** a caçamba usa `halfW = 0.55` fixo (`visual-foundry/excavator/arm.ts`); mudar o contrato não muda a malha. Pertence ao dono da Foundry (ver `reports/living-real-reconstruction/integration.md`, ponto 5).
4. **Teste ponta a ponta no browser** da experiência integrada.
5. **Modelo real:** o cliente não foi exercitado com o Muse Spark (sem chamadas pagas). NOT VERIFIED.

## Limitações conhecidas

- A sessão do servidor está só em memória (30 min, 100 sessões); reiniciar o servidor invalida-a, e o cliente trata isso como `expired`.
- O relógio de expiração local parte do momento de envio da proposta, nunca depois do do servidor.
- `reviewerId` não autentica ninguém; a identidade e a participação humana ficam `unverified` em todo o fluxo.
- Uma geometria "reconstruída" é a fixture sintética com a largura da caçamba alterada; não é forma recuperada da imagem.

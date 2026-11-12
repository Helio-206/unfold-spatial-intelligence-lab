# UNFOLD — regras para sessões do Claude Code

## Regra de produto (inegociável)

O UNFOLD nunca confunde quatro categorias de informação:

1. **Dados extraídos** — lidos de uma fonte (vector, cota escrita, documento) ou detectados por heurística.
2. **Hipóteses da IA** — propostas por um modelo (Muse Spark ou outro).
3. **Confirmação humana** — valores que uma pessoa confirmou ou corrigiu.
4. **Resultados de solver** — calculados por um motor determinístico.

Esta separação tem de sobreviver a todas as migrações, novos domínios e interfaces.
Nenhuma conversão pode promover uma categoria para outra sem evidência.
Uma migração nunca fabrica certeza: o que não se consegue recuperar fica `unknown`.

## Princípios de arquitectura

- A IA interpreta e propõe; motores determinísticos validam e executam.
- Quando falta evidência, o sistema diz "desconhecido" em vez de inventar.
  Geometricamente possível não significa estruturalmente seguro.
- Uma operação de domínio nunca escreve directamente no estado; propõe uma alteração
  que passa por preview → autorização (quando toca dados confirmados) → commit.
- O Core (quando existir) não depende de nenhum domínio. Isto verifica-se de forma
  estrutural (imports, tipos, API pública), não por procura de palavras.

## Regras de trabalho

- Trabalhar por checkpoints internos (commits/verificações). Regra geral: no fim de cada checkpoint, parar, resumir e mostrar resultados dos testes.
  **Excepção (autorizada pelo dono do produto): a execução de engenharia da FASE 01 — REALITY ENGINE foi encerrada em 2026-11-12 com certificação NO-GO; durante as macrofases contínuas não se criam checkpoints de autorização.** Mantêm-se todas as restantes regras (testes antes de commit, sem merge sem autorização, sem skip, sem mocks apresentados como prova real, segredos fora do repo). Encerrar a execução não é aprovar a qualidade.
- Para cada defeito: primeiro um teste que falha, confirmar que falha, depois a correcção.
- Não marcar testes como `skip` para fazer passar a suite. Se um teste antigo
  assumia comportamento inseguro, actualizá-lo com o novo código de erro esperado e explicar porquê.
- Não fazer migrações em massa. Preservar as APIs actuais; mudanças grandes passam por fachadas.
- Não tocar no renderer Three.js nem na integração visual sem pedido explícito.
- Nunca fazer chamadas pagas ao Meta em testes. Usar `fetch` simulado que conte chamadas.
- `MODEL_API_KEY` só existe no servidor; nunca no frontend, em logs ou em commits.
- Antes de cada commit: `npm test` e `npm run build` têm de passar.

## Git e PRs

- Commits por fatias lógicas, cada uma com o seu teste; rever o diff e os testes antes de commitar.
- Abrir PR para `main`; nunca fazer merge sem autorização explícita.
- Descrições de PR e comentários públicos: curtos, naturais, informais e tecnicamente precisos. Sem tom de assistente, sem emojis, sem frases de enchimento.

## Reality Engine e Fase 02 (Living Intelligence)

- O que o Reality Engine faz, com que condições e o que não está demonstrado está em `src/living/reality/capabilities.ts`; a dívida de reconstrução, com critérios verificáveis, em `reports/reality-engine/TECHNICAL-DEBT.md` (gerado por `npx tsx scripts/reality-debt-report.ts`; um teste impede que o documento se afaste das medições).
- Nenhuma funcionalidade pode afirmar mais do que o manifesto. Fidelidade geométrica não está demonstrada: citar sempre a classe e os três eixos de `assessReconstruction`; «fiel» não existe para vistas do utilizador.
- Propostas da IA usam `ai-proposals.ts` e só entram na evidência como edição `by: 'person'` por aceitação explícita. Integração planeada em `docs/PHASE-02-LIVING-INTELLIGENCE-INTEGRATION.md`.
- Os problemas de reconstrução são dívida técnica prioritária e não geram novas fases: um item só passa a «cumprido» quando o ficheiro de medição é regenerado pelo script indicado e o critério se verifica.

# Critérios de aceitação para a integração (Claude Terminal)

O protótipo define a experiência; a integração liga-a à reconstrução real e ao laboratório unificado (`/living`).
Cada critério é verificável no browser. «Deve» significa bloqueante.

## A. Porta de reconstrução real

1. Deve implementar `ReconstructionPort` (`intake.ts`) com `mode: 'live'`, chamando a rota de servidor existente que usa
   `observeExcavatorImage` / `observeExcavatorText`. Não deve chamar a Meta a partir do browser nem expor `MODEL_API_KEY`.
2. Deve mapear o resultado com `classifyObservation` (a mesma regra do protótipo): `machineType !== 'excavator'` ou zero entidades → `not_identified`.
3. Deve mapear erros com `failureMessage(code)`: `MODEL_API_KEY_MISSING` → `unavailable`; budget, timeout, rede e contrato inválido → `failed`, com o código visível.
4. Deve passar o `AbortSignal`: «Cancelar» interrompe o pedido e a resposta tardia é ignorada.
5. Deve devolver `provenance: { mode: 'live', model, requestId }`. O banner de demonstração não pode aparecer com a porta real.
6. O modo de demonstração continua disponível só com um parâmetro explícito, e sempre rotulado.

## B. Revisão

7. Nenhum `unknown` pode chegar ao laboratório ou ao adaptador como confirmado. Para um desconhecido, «Confirmar» não existe.
8. Correcções e valores introduzidos devem seguir para o adaptador como dados `human_entered`, com a interpretação original preservada.
   Nunca como `observed`.
9. O laboratório só abre com `readiness === 'ready_for_engine'`. Com `insufficient`, a lista do que falta tem de estar à vista.
10. `adaptReviewedProposalToAssembly` só deve ser chamado com `reviewerId` e `authorizationId` reais, nunca preenchidos automaticamente.
11. O portão 2 só pode mostrar `valid` depois de uma resposta do motor (solver id visível no inspector). A revisão humana nunca o altera.

## C. Laboratório unificado

12. O laboratório deve ser o de `/living` (workspace + motor + Digital Hand + conversa), não uma segunda interface. Esta página é o protótipo de transição e estado.
13. A geometria mostrada deve vir da montagem aprovada. Enquanto vier do fixture canónico, o inspector diz «forma de demonstração».
14. As peças rejeitadas aparecem em fantasma e as desconhecidas com marca. Peças confirmadas não levam etiqueta.
15. Simular movimentos e experiências do motor ficam desactivados, com o motivo escrito, até o portão 2 ser `valid`.
16. A miniatura do desenho volta à revisão com as decisões intactas.

## D. QA (como `tests/e2e/living-experience.pw.mjs`)

17. A 390, 768 e 1440 px: sem scroll horizontal; fonte e cartão sem sobreposição; banner e cabeçalho sem colisão.
18. No laboratório em retrato, a caçamba e o corpo superior ficam dentro do ecrã.
19. As etiquetas sobre a máquina não se sobrepõem entre si nem à coluna lateral.
20. A revisão faz-se só com teclado (←/→, C, X, Tab). Os problemas usam `role="alert"`; a espera usa `aria-live`.
21. Com `prefers-reduced-motion`, a transição não anima.
22. Os testes não fazem chamadas à Meta: a porta real testa-se com um `fetch` simulado que conta chamadas.
23. Textos longos (descrição de 2 000 caracteres, nomes corrigidos de 120) ficam dentro dos cartões.

## E. Fora do âmbito desta entrega

- Persistência da revisão (hoje é local e não é gravada).
- Localização das regiões numa imagem real: o contrato de observação não traz coordenadas. Até existirem, a revisão mostra a fonte sem regiões e di-lo.
- Edição de valores observados: é uma modificação (`AssemblyModification`), não uma correcção de revisão.

# UNFOLD — Full Spatial Intelligence Convergence

**Branch:** `integration/unfold-full-living-experience` · **Base:** `integration/universal-foundry-e1-4@84a22a2` · **SHA final:** o commit que contém este relatório (ver `git log -1`).

**Activação (nunca por omissão):** `/living?debug-living&experimental-foundry&experimental-living-intelligence&experimental-photoreal` (cada flag continua independente e opcional).

## Veredicto

**GO condicionado** para a experiência convergente atrás das três flags experimentais. **NO-GO** para activação em produção e para qualquer leitura de «image-to-3D universal» ou «física universal»: o fitting fotográfico está completo numa família (vehicle), o movimento em Spaces activos é uma demonstração inferida e rotulada, e as fotografias de teste são fixtures raster nossos (não fotografias de câmara). Os critérios A–F foram exercidos no `/living` real:

- **A RECONSTRUCTION** — fitting por silhueta muda a geometria vehicle a partir dos pixels (testes com silhuetas distintas, controlo negativo de cor, gate de câmara frontal).
- **B RENDERING** — photoreal activo no mesmo palco do Space (`photorealActive=true` no e2e), identidade preservada (e2e photoreal existente: select/move/undo/restore, revisão 2).
- **C LIVING INTELLIGENCE** — Space activo real (porta) com explicação ancorada no plano e movimento transitório aplicado ao grupo real do componente (ângulo medido 0.60 rad no browser).
- **D EXPERIMENTATION** — experiências da escavadora (missão anterior) continuam verdes; no Space, a amplitude conceptual é o parâmetro experimental declarado.
- **E AUTHORITY** — poses transitórias nunca escrevem no plano (teste de imutabilidade), transacções E1.4.1 e undo cobertos pela suite (2598 testes) e pelo e2e photoreal com backend real.
- **F PRODUCT** — tudo corre dentro de `/living`; não há aplicações novas.

## Integração e resolução de conflitos

- `feat/unfold-photorealistic-renderer-v1@61abb1a` e `feat/unfold-living-intelligence-engine@4d04fd3` (ambos filhos directos da base) integrados por merge. Único conflito: `shell.ts` — resolvido à mão mantendo o vestido photoreal por polling, o `__photoreal` de debug, e acrescentando disposals dos dois subsistemas no mesmo `pagehide`; `workspace.ts` fundiu sem conflito e conserva `photorealStage()`/`spaceActive` (photoreal) e `livingAssembly()`/`applyLivingFrame()` (living).
- Foundry V1.1 (`a502f9f`, ancestralidade distinta): **port selectivo por ficheiro**, nunca merge da história de auditoria. Portado: `provider.ts` (evidência ligada por fingerprint/hashes do plano, chaves de parâmetros por json canónico do plano, época anti-stale), `families/tool.ts` (chave de boca aberta contínua + `ring-wrench` + grip steel), `families/vehicle.ts` (arco de roda em torus semi-circular em vez de disco, rodas expostas), `families/construction.ts` (cilindro com `frameOf(ctx, true)` e nota «attachment not verified»), `panel.ts` (aviso de evidência indisponível) e os testes `universal-foundry-image-integrity` + `universal-foundry-v11-geometry`. As garantias A/B/A, prepared-source hashes, generation guards e source-bound storage vêm desse port.
- Ligação da evidência no shell: a imagem é retida no submit e só é ligada quando **esse** plano é mostrado (`onPlanShown` novo no `SpaceFlow`, +2 linhas), com `spatialPlanFingerprintV2`, sha256 do original e geração anti-stale; o provider recompila com a evidência ligada.
- Bug de lifecycle photoreal corrigido com teste que falha antes: `revert()` antes de `dispose()` marcava o cleanup único e o ambiente procedural nunca era libertado. Agora restaurar o palco e libertar o estúdio são deveres one-shot separados (`tests/photoreal.test.ts`: revert→dispose liberta exactamente uma vez; dispose→revert mantém-se idempotente).

## Ponte LivingScene para Spaces activos (`space-bridge.ts`)

- Identidades são as do plano; `source.sha256` e o fingerprint acompanham a cena (`unfold.living-scene.space.v1`).
- Papéis semânticos são **inferidos** de rótulos; relações `attached_to` viram ligação fixa suportada; capacidade de rotação só com evidência no plano (rótulo articulado ou restrição coaxial), **sem limites nem actuador fabricados**: demonstração em torno do eixo coaxial declarado, amplitude conceptual de ±0.6 rad rotulada em todo o lado.
- Sem evidência mecânica, a cena declara o que falta (`missingForMotion`) e oferece identificar/explicar/seleccionar/enquadrar. Nunca anima um fixture sintético a fingir ser o objecto carregado: o regressão da escavadora vive na sua secção própria do painel.
- Movimento: `PlanSpaceLayer.applyTransientRotation` roda o grupo real `spatialComponentRoot` em torno da sua origem (a folha da porta do fixture tem a geometria deslocada para a aresta da dobradiça, por isso o pivô é a dobradiça), guarda o quaternion original e restaura exactamente em clear/rebuild/dispose. O workspace expõe geração do Space (`activeSpaceGeneration`), plano activo e as duas operações; o shell liga/desliga a ponte por geração (padrão do vestido photoreal). Trocar de Space cancela o movimento anterior.
- Autoridade: nenhum destes caminhos chama operações do plano; um teste prova `JSON.stringify(plan)` idêntico antes/depois de poses e experiências.

## Fitting fotográfico (família vehicle)

`src/living/universal-foundry/fitting.ts`: procura em grelha limitada e determinística sobre `cabinHeight × rearSlope` (25 candidatos, lod 0, com `AbortSignal`). O objectivo usa os pixels: perfil de alturas por coluna da máscara de evidência + aspecto da bounding box contra o perfil de projecção lateral da geometria compilada (`buildAll()` por candidato). A cor está fora do objectivo — mudar só a cor devolve exactamente os mesmos parâmetros (teste). Silhueta quase frontal (simetria > 0.72 e aspecto < 1.7) ou primeiro plano < 2% ⇒ `insufficient_evidence` e apresentação conceptual, sem fitting. O provider corre o fitting uma vez por plano+silhueta (cache ≤ 4) e regista o resumo nos `unknowns` da receita como parâmetros **inferidos**, nunca dimensões verificadas. Custo medido: ~2–3 s por fitting completo em CPU (25 compilações), amortizado pela cache; a interacção não refaz fitting.

Antes/depois (testes): silhueta baixa/comprida vs alta/curta produzem overrides diferentes e aspectos compilados ordenados como a evidência; o erro de perfil do vencedor é ≤ ao do default. Screenshots do fitting isolado não foram produzidas em browser (o caminho browser usa evidência ligada quando há plano de imagem; o e2e de convergência usa o modelo de porta). Registo honesto desta limitação abaixo.

## Demonstração completa (browser real, sem inferência paga)

`npx tsx tests/e2e/full-living-experience.pw.ts` — **OK**: upload de `tests/fixtures/photos/door-photo.png` pelo painel do Space → revisão humana (keep-all + ack) → construir → painel vivo ligado ao Space (`02`) → explicação da folha ancorada (`03`, cita `door-hinge`, relações e unknowns) → «Mover» roda a malha real 0.60 rad em torno da dobradiça (`04`) → fechar/repor → regressão da escavadora com as três flags (`05`). A resposta do plano é um fixture **rotulado** (`model: 'labelled-fixture (not Muse Spark)'`), casado com a imagem pelo sha256 do pedido — declarado no plano, nos unknowns e na UI. `photorealActive=true` no mesmo palco. Sem backend neste e2e, o adopt falha e o fluxo degrada para «sem sessão» (comportamento existente), sem afectar a demonstração local.

Reutilizados e verdes: `tests/e2e/living-intelligence.pw.ts` (7/7) e `tests/e2e/photoreal-living.pw.mjs` (exit 0; select/move/undo/restore com backend real, revisão 2 — evidência das transacções fenced + undo no browser).

Fixtures raster (`tests/fixtures/photos/`, gerados por `tests/e2e/gen-photo-fixtures.pw.ts`): desenhos nossos em canvas, direitos limpos. **Não são fotografias de câmara** — servem o caminho de pixels; a validação com fotografias reais de objectos reais continua por fazer e é a maior limitação restante do critério A.

## Testes

- Novos: `tests/space-living-bridge.test.ts` (6), `tests/universal-foundry-fitting.test.ts` (6), caso revert→dispose em `tests/photoreal.test.ts`, port V1.1 (image-integrity + v11-geometry).
- Suite completa: **2598/2598 testes, 168/168 ficheiros** (`npx vitest run --testTimeout=30000`); `tsc --noEmit` e `npm run build` verdes.
- Timeouts herdados: como na entrega anterior, testes pesados podem falhar por timeout de 5 s sob carga paralela; com 30 s a suite está totalmente verde. Nenhuma asserção foi enfraquecida.

## Limitações precisas

1. Fitting completo só na família **vehicle** e só com hipótese de vista lateral; outras famílias e outras câmaras caem para conceptual declarado.
2. Fotografias de câmara reais ainda não foram validadas (fixtures raster desenhados por nós). O plano semântico do e2e é fixture rotulado, não saída da Muse Spark.
3. Movimento em Spaces é demonstração inferida (sem juntas, limites ou actuadores do objecto real); mecanismos verificados continuam a ser os da montagem `assembly.v1` (escavadora e fixtures FK).
4. O fitting (~2–3 s) corre sincronamente na compilação quando a evidência liga; está limitado a 25 candidatos e cacheado, mas pode notar-se na primeira abertura de um Space vehicle com imagem.
5. Sem vídeo (sem ferramenta de gravação); sequência de screenshots em `reports/product-integration/full-living-evidence/` e `living-intelligence-evidence/`.
6. Attachments mecânicos da escavadora Foundry continuam «appearance inferred; attachment not verified» (declarado nas detail rules) — não foram criadas juntas falsas.

## Hardening de aceitação (sobre `48c22fa`)

Quatro correcções dirigidas, cada uma com teste de regressão:

1. **Identidade da cache de fitting.** A chave era `plano|aspecto|simetria|rácio` — duas silhuetas com esses três números iguais mas perfis diferentes partilhavam o resultado. Agora a identidade é `fit-v2 + json canónico do plano + hash determinístico da máscara` (`evidenceMaskHash`, sobre bytes da máscara, dimensões e bbox). Teste: mesma bbox/aspecto/rácio, cabina deslocada → perfis, hashes e chaves diferentes; chave determinística.
2. **Baseline genuíno.** O baseline era procurado dentro da grelha por coincidência com os defaults e, se não fosse encontrado, era substituído pelo objectivo do vencedor (erro reportado optimista). Agora é calculado independentemente a partir da geometria compilada por omissão (`overrides {}`), e a ausência de baseline é `insufficient_evidence` — nunca o valor do vencedor. Teste recomputa o baseline por uma via independente e exige igualdade.
3. **Fitting fora do caminho de render.** `compile()` já não corre a grelha sincronamente (2–3 s): com cache aplica já; sem cache agenda `fitGeometryToEvidenceAsync` (blocos de 2 candidatos com cedência ao event loop, progresso observável, `AbortSignal`, rejeição de resultados stale por época/plano, cancelamento em `dispose` e em nova evidência) e apresenta o conceptual com estado `pending`; ao terminar, `onFitted` regenera o Space. Teste do provider: `compile` devolve `pending` sem bloquear, `onFitted` entrega `fitted`, e só a compilação seguinte aplica os parâmetros. A versão síncrona continua a existir para testes/regressões determinísticas e produz exactamente o mesmo resultado que a assíncrona (teste de igualdade).
4. **Fotografias reais de câmara.** `car.jpg` (CC0) e `bus.jpg` (CC BY-SA 4.0) do manifest de referências da auditoria, hashes verificados, em `tests/fixtures/photos-real/` com atribuição. A primeira medição expôs um defeito real: a extracção por mediana da borda classificava 84–91% de uma fotografia real como primeiro plano. Corrigido em `evidence.ts` com clusters dominantes da borda (céu+estrada+edifícios) e bbox robusta por ocupação: as duas fotografias passam a 26–29% de primeiro plano, simetria 0.27–0.31 (vista lateral plausível). Novo gate de qualidade: máscara > 80% ⇒ `insufficient_evidence`, sem fitting. Limite que permanece: a bbox ainda toca as bordas nas duas fotografias (fundo texturado nas margens), por isso o aspecto usado é próximo do da imagem — registado nos diagnósticos, não escondido.

**Demonstração com fotografia real** (`npx tsx tests/e2e/real-photo-fitting.pw.ts`, OK): para as duas fotografias — upload em `/living` com as três flags → plano semântico offline **rotulado como fixture** e casado por sha256 do pedido (contagem de chamadas ao provider pago: 0; nunca apresentado como Muse Spark) → revisão humana → **adopt aceite pelo backend local real** (`layer.synced === true`; correr o Vite na porta 5173 da allowlist do backend foi necessário — com outra porta o adopt é rejeitado 421, facto verificado) → fitting assíncrono aplicado (carro: cabinHeight 0.38→0.52, rearSlope 0.7→0, objectivo genuíno 0.188→0.186; autocarro: 0.40→0.52, 0.9→0, 0.440→0.438) → photoreal activo → explicação ancorada → roda real do Space roda 0.60 rad em delta medido (a primeira medição comparava com a identidade e foi substituída por delta antes/depois; uma falha por espera fixa foi substituída por polling da condição). Evidência em `reports/product-integration/real-photo-evidence/`: screenshots por fotografia, `diagnostics.json` e `side-by-side.png` (fotografia | vista 3D ajustada).

Melhoria medida do fitting nas fotografias reais é **pequena** (0.188→0.186; 0.440→0.438) e os parâmetros batem no limite da grelha (cabinHeight máximo): com máscaras de fotografias com fundo complexo, o perfil de silhueta é fraco. É um resultado mensurável e reprodutível, não uma reconstrução fiel — afirmar mais seria falso.

**Revalidação:** suite completa **2602/2602** (168 ficheiros; inclui as transacções fenced E1.4.1 e o undo), `tsc` e `build` verdes, e2e de convergência (porta) e living-intelligence reexecutados verdes. Os fixtures raster desenhados continuam apenas como regressões determinísticas.

## Correcção final de fidelidade fotográfica (sobre `bb8514d`)

**Critérios de aceitação documentados antes do veredicto:** máscara com IoU ≥ 0.50 contra anotação manual e erro de bbox ≤ 8 px (a 160 px de largura); fitting aceite só com melhoria de IoU de silhueta projectada ≥ 5% relativa sobre o baseline genuíno, sem esconder saturação da grelha; melhoria visível nas comparações de câmara fixa. **Nenhuma das três fotografias reais cumpre os critérios de máscara. A fidelidade fotográfica NÃO está aceite (NO-GO)** — o que está aceite é o comportamento fail-closed do pipeline.

**Máscaras medidas contra anotação manual** (`tests/fixtures/photos-real/annotations.json`, 1 anotador, não revisto; `gen-mask-comparisons.pw.ts` regenera `comparisons/*.png` e `mask-metrics.json`):

| Fotografia | Vista real | IoU extraída vs anotação | Erro bbox | O que a máscara realmente capturou |
|---|---|---|---|---|
| `car.jpg` (CC0) | 3/4 frontal (o nome do ficheiro dizia «side view») | 0.199 | 29 px | fragmento superior (edifícios/outro carro) |
| `bus.jpg` (CC BY-SA 4.0) | lateral 3/4 traseira | 0.222 | 14 px | corpo parcial + chão |
| `porsche-911.jpg` held-out (CC BY-SA 2.0) | perfil lateral, camiões atrás | 0.263 | 20 px | faixa de sombra no chão sob o carro (visível na comparação) |

Duas tentativas de melhoria foram medidas e rejeitadas com dados: flood-fill de fundo por gradiente local piorou o IoU para 0.01–0.12 (vaza por asfalto/sombra); clusters + maior componente + buracos fica em 0.20–0.27. Sem um segmentador aprendido (fora do âmbito e das regras desta missão), não há máscara de confiança para estas fotografias — e fingir o contrário foi exactamente o defeito das rondas anteriores.

**Fail-closed calibrado.** `assessSilhouetteReliability` (maior componente ≥ 75%, preenchimento de bbox ≥ 55%, contaminação de borda ≤ 15%, rácio em [3%, 70%]). Um primeiro gate mais frouxo **aprovava as três máscaras más**; os limiares finais foram calibrados no conjunto anotado e recusam as três, mantendo aceites as silhuetas sintéticas limpas das regressões. No `/living`, as três fotografias terminam em `insufficient_evidence` com os motivos numéricos, parâmetros nos defaults (zero geometria enganadora aplicada), photoreal activo e a experiência (explicação, interacção transitória) funcional — `real-photo-fitting.pw.ts` actualizado para esperar e afirmar exactamente isto, incluindo o held-out.

**Objectivo por silhueta projectada.** O objectivo já não é um perfil de alturas de AABBs: `projectedSilhouette` rasteriza os triângulos compilados em vista lateral ortográfica (72×36, hipótese de câmara declarada, atalho sub-célula por centróide) e o objectivo é `1 − IoU` contra a máscara reamostrada. Determinístico; baseline recomputado independentemente no teste (mesmo lod).

**Saturação e graus de liberdade.** Medido: para uma silhueta sintética baixa/comprida, o baseline (IoU 0.896) bate **todos** os candidatos — a grelha nem inclui os defaults (0.38/0.70) e dois parâmetros de cabina não reproduzem a forma; a conclusão `insufficient_dof` dispara abaixo de 5% de melhoria relativa, e vencedores na fronteira são reportados em `gridSaturated` em vez de a grelha ser estendida para embelezar. Na silhueta alta sintética há ajuste genuíno (IoU 0.773 → 0.800, saturado nos dois parâmetros — declarado).

**Responsividade medida.** Cada candidato custa ~300 ms em CPU (compilação+build+rasterização), muito acima de um frame de 16 ms. O fitting interactivo corre agora num **Web Worker** dedicado (`fitting.worker.ts`; o caminho de compilação não usa DOM — verificado), com timeout e fallback assíncrono por blocos; o transporte usado é observável (`fittingTransport: 'worker'` afirmado no e2e das três fotos) e o chunk do worker é emitido no build de produção.

**Comparações de câmara fixa** em `real-photo-evidence/comparisons/` (input | máscara extraída | anotação | veredicto) para os três casos — todos insucessos, preservados como tal. O `side-by-side.png` da ronda anterior foi removido: mostrava um «fitted» que hoje seria uma recusa, e mantê-lo seria evidência enganadora. Os testes sintéticos determinísticos continuam como regressões do mecanismo.

**Revalidação:** suite **2604/2604**, `tsc`/`build` verdes (inclui chunk do worker), e2e de convergência da porta verde, adopt real e transacções E1.4.1 cobertos como antes.

## GO/NO-GO

**GO** para a experiência convergente atrás de flags e para o comportamento fail-closed do pipeline fotográfico. **NO-GO** para produção e — explicitamente — **NO-GO para fidelidade fotográfica**: com o segmentador clássico actual, as máscaras de fotografias reais medidas têm IoU 0.20–0.27 contra anotação manual, e o sistema recusa correctamente em vez de ajustar. Aceitar reconstrução fotográfica exigiria um segmentador de outra classe, fora do âmbito desta correcção.

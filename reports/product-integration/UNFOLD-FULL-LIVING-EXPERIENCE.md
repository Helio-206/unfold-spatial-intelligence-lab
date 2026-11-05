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

## GO/NO-GO

**GO** para a experiência convergente atrás de flags, como base de avaliação do produto. **NO-GO** para produção, para fitting multi-família, e para apresentar movimento de Spaces ou dimensões ajustadas como verificados a partir de fotografias reais.

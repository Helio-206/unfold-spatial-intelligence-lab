# UNFOLD Photorealistic Renderer V1

- Branch isolada: `feat/unfold-photorealistic-renderer-v1`, a partir de `integration/universal-foundry-e1-4@84a22a2cd44d9ffd2dc308191b526ee8809570f5`. Sem merge, sem activação por defeito, sem serviços pagos, sem tocar em geradores do Foundry, evidência de imagem, receitas, contratos transaccionais ou revisão/autorização.
- SHA final: ver `git log -1` nesta branch (o relatório entra no commit final).

## Baseline (Milestone A)

O `/living` já tinha: renderer WebGL com composer (RenderPass → GTAO opcional → OutputPass com tone mapping único), sombras PCFSoft, estúdio procedural PMREM do Cinema, materiais `MeshPhysicalMaterial` no look premium e `MeshStandardMaterial` gerados pelo Foundry (`createUniversalMaterials`) com mapas procedurais. Por isso **não** foi criado outro composer, outro tone mapping nem outro sistema de sombras: duplicá-los só traria dupla conversão de cor. O harness de comparação ficou congelado antes das alterações ao pipeline: mesma geometria (fixture da escavadora do Foundry), mesmo enquadramento depois de esgotar upgrades e `settle()`, mesma câmara via `frameAll`.

## Arquitectura (novo: `src/living/photoreal/`)

- **`brdf.ts`** — o modelo próprio em matemática explícita: Cook–Torrance com distribuição GGX (Trowbridge–Reitz), termo conjunto de Smith correlacionado em altura (Heitz, finito no rasante), Fresnel de Schlick e difuso consciente de energia (`(1−F)(1−metallic)/π`). Inclui a versão GLSL textualmente alinhada. Testado numericamente: pico GGX, limites de Smith no rasante, Fresnel F0→1, teste de forno branco sem criação de energia (limite single-bounce ≤ ~1), metais tintam o especular e matam o difuso, zero roughness é clampeado (nunca NaN).
- **`reference-material.ts`** — um `ShaderMaterial` standalone que implementa esse GLSL de ponta a ponta (até 4 luzes direccionais), usado nas esferas de referência neutras. Existe para o BRDF próprio ser compilado e comparado honestamente; **não** é o caminho do produto.
- **`materials.ts`** — o caminho do produto: kinds físicos por declaração do Foundry (metal, paint, glass, rubber, fabric, plastic, wood) com parâmetros próprios, clearcoat para paint, transmissão para glass, e microdetalhe procedural local (mapas de normal e roughness gerados por ruído com semente, `DataTexture`, sem assets) para desgaste subtil, grão de borracha, trama de tecido, direcção de metal escovado (streaks) e variação de tinta. A troca preserva `userData` (identidade dos componentes), é restaurável ao material exacto e dispõe tudo o que cria. Onde a geometria não tem UVs, o three.js ignora os mapas — limitação declarada, nunca um artefacto inventado.
- **`look.ts`** — `PhotorealGeometry` envolve o provider do Foundry: em cada compilação (build inicial, regeneração visual, mutação autorizada, undo) os materiais são trocados, por isso a representação segue sempre o plano autoritativo que a camada detém; o swap nunca escreve plano, revisão, revisão humana ou recibos. `applyPhotorealStage` instala o ambiente de estúdio (PMREM procedural reutilizando `createStudioEnvironment` com um painel próprio key/fill/rim/top/bounce), um rig key/fill/rim com sombras suaves e uma sombra de contacto no chão, e uma exposição — tudo restaurável e descartável. Tone mapping e espaço de cor continuam propriedade do OutputPass existente: uma só conversão, sempre.
- **`presets.ts`** — presets cinematic/balanced/performance e detecção de capacidades pura: sem WebGL2 devolve `null` (o renderer stock fica exactamente como estava); rendering por software (SwiftShader/llvmpipe) cai para performance (sombras 512, sem sombra de contacto extra).

A base GGX do three.js **não foi reescrita**: é mantida e medida, e nenhuma superioridade é alegada por o código ser nosso. O contributo próprio é a matemática de referência testada, o microdetalhe, o estúdio, os presets e a integração com garantias.

## Integração (Milestone G)

`/living?debug-living&experimental-foundry&experimental-photoreal`: o shell envolve o provider e veste o palco quando um Space está activo (seam mínimo `workspace.photorealStage()`, que expõe renderer/scene/camera e nada mais). Sem a flag, nenhum destes objectos existe e o comportamento é o anterior — provado pelo lado "before" do harness, que corre o mesmo fluxo sem a flag. Selecção, isolamento, câmara, inspecção, regeneração, review, transacções e undo foram exercitados no estado photoreal (edição autorizada + undo exacto no ensaio).

## Comparação visual (Milestone H) — leitura honesta

Screenshots em `/tmp/unfold-photoreal-*/`: `before-stock.png` vs `after-photoreal.png` (mesma geometria e câmara), `material-spheres.png` (metal/dieléctrico rugoso/áspero com o BRDF próprio), `foundry-visualisation.png` no ensaio E1.

O que se vê no par: reflexos de borda (rim) mais definidos nas lagartas, vidro da cabina transparente em vez de opaco, sombra de contacto mais presente sob o objecto, saturação média 0.016 → 0.022 com luminância média praticamente igual (0.169 → 0.169) e desvio-padrão ligeiramente menor (0.097 → 0.090). É uma melhoria **modesta e real** de material e luz — não uma transformação. O que não mudou e não devia mudar: a geometria da escavadora desta fixture é descontínua (peças separadas no espaço, do plano guardado), e continua a sê-lo nos dois lados; isso é um limite da geometria, não do renderer, e fica registado como tal.

Medições do ensaio (Chromium + SwiftShader, **rendering por software — não são desempenho de GPU real**): preset efectivo `performance` (512px de sombras, detecção correcta), 3 luzes de rig, frame desenhado sem erros de página; os números de tempo de frame em SwiftShader não são apresentados como desempenho porque não representam hardware.

## Verificação (Milestone I)

- `tests/photoreal.test.ts`: 9/9 (matemática BRDF, kinds, swap/restore/dispose exactos, fallback de presets, wrapper nunca escreve o plano).
- Browser: `photoreal-living` (before/after idênticos em geometria e câmara, estatísticas distintas, interacções e undo no modo novo, esferas compilam o GLSL próprio sem erros) e `v4-e1-review-browser` (fluxo revisto completo) verdes.
- Build verde. Suite completa: 2546 testes, 6 falhas por timeout de 5 s nesta corrida (os 4 herdados `rendering-lifecycle`, `universal-spatial-buried` ×2, `bucket-width`, mais 2 de `reconstruction-hierarchy`, todos «timed out» e verdes isolados — o conjunto varia com a carga, como documentado desde a baseline). Sem assertions enfraquecidas.

## Limites e artefactos conhecidos

- Microdetalhe depende de UVs quando usa mapas; geometrias sem UV não o mostram.
- O `ShaderMaterial` de referência não recebe sombras nem ambiente PMREM; serve para comparar BRDF, não para substituir o caminho do produto.
- Sem SSAO/TAA próprios novos: o GTAO existente do palco continua a ser o AO; bloom cinematográfico não foi adicionado (o OutputPass existente basta para o objectivo físico; bloom extra seria efeito, não correcção).
- Em software rendering o ganho é subtil; em GPU real o preset balanced/cinematic (sombras 1024/2048, microdetalhe completo) não foi medido aqui.

## GO/NO-GO

**GO experimental.** O subsistema está integrado atrás de flag, melhora mensuravelmente reflexos, vidro e contacto sem artefactos novos maiores, mantém todas as garantias transaccionais (o renderer nunca escreve estado autoritativo) e cai com segurança para o renderer stock. Não activar por defeito até haver medição em GPU real e revisão visual humana em mais categorias.

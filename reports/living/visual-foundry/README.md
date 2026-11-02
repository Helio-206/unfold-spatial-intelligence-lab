# Visual Foundry + espaço de trabalho espacial — relatório

Protótipo isolado em `src/living/visual-foundry/` (renderer, materiais, modelo de exibição da escavadora) e
`src/living/workspace-design/` (espaço de trabalho, Digital Hand, compositor). Não toca no editor arquitectónico, no
renderer da aplicação, no solver, na API de reconstrução nem nos tokens globais.

- D0 — auditoria do design system: [`D0-design-system-audit.md`](D0-design-system-audit.md)
- Capturas reais (Chromium + Three.js, nada gerado por IA): [`captures/`](captures/)
- Verificações no browser: [`browser-report.json`](browser-report.json) · desempenho: [`performance.json`](performance.json)
- Como reproduzir: `node tests/e2e/living-visual-foundry.pw.mjs` (arranca o próprio Vite; `/api` é interceptado no browser)

## Capturas pedidas

| # | Captura | Ficheiro |
|---|---|---|
| 1 | Espaço de trabalho completo, modo assistido | `captures/01-workspace.png` |
| 2 | Golden Frame, sem UI, perfil export (3200×2000, GTAO) | `captures/02-golden-frame.png` |
| 3 | Modo assistido, Digital Hand no cilindro da lança | `captures/03-assisted-digital-hand.png` |
| 4 | Conversa expandida com o objecto visível + proposta | `captures/04-conversation.png`, `04b-fixture-preview-result.png` |
| 5 | Modo foco | `captures/05-focus.png` |
| 6 | Grande plano de uma articulação hidráulica | `captures/06-hydraulic-joint.png` |
| 7 | Caçamba e rastos | `captures/07-bucket.png`, `07b-tracks.png` |
| 8 | Ecrã estreito (390×844) | `captures/08-mobile.png`, `08b-mobile-conversation.png` |
| D5 | Pergunta → alvo → explicação → interrupção → foco → regresso | `captures/d5-*.png` |

Mesma resolução (1600×1000 CSS) e as mesmas posições de câmara em todas as rondas.

## Rondas de crítica visual (4)

1. **Primeiro render.** Câmara do lado errado (cabina escondida pela lança); pintura plana; caçamba lida como caixa.
   → câmara frontal-esquerda, luz principal e softbox do lado da câmara.
2. **Grande plano.** Extrusões curvas facetadas (normais por segmento); linha de cintura da cabina muito alta (bloco cego);
   metais escuros esmagados a preto. → normais suavizadas com ângulo de vinco, cabina com vidro até 0,5 m, metais mais claros.
3. **Golden Frame export.** Silhueta, proporções e pinos credíveis; GTAO dá profundidade. Ainda: pintura uniforme
   (lê-se como maquete de estúdio, não como aço industrial gasto), placas de reforço da lança com sombreamento «almofada»,
   caçamba domina o enquadramento. → ângulo de vinco 34° → 20°.
4. **Interface.** Chips de evidência em branco (cor herdada do botão), etiqueta da mão por cima do inspector, avisos por
   cima do inspector, rail por cima da folha de conversa no telemóvel. → corrigidos (referências com contorno, colocação
   da etiqueta que evita sobreposições abertas, inspector desce com os avisos, rail escondido com a conversa no telemóvel).

**Avaliação honesta face ao turbofan da Airsup:** ainda não está ao nível. O que falta: variação de material (desgaste,
sujidade contida, chapa com ondulação), geometria da caçamba e do capô menos «caixa», mais densidade de detalhe na
estrutura superior (grelhas, dobradiças, degraus), e uma luz de recorte mais forte para separar a silhueta do fundo Void.
Não passei nenhuma captura só por estar melhor do que a anterior.

## Verificações funcionais

Vitest (`tests/living/visual-foundry/`, 67 testes): modos e restauro, Esc, nível das sobreposições, avisos críticos e
aprovações nunca escondidos, árbitro da câmara (utilizador ganha, período de silêncio, gestos bloqueiam o assistente),
resolução por id canónico, projecção mundo→ecrã, alvo atrás da câmara, ocluído e desconhecido, rótulos de incerteza,
pedido `spatial_agent_request.v1` em modo `mechanical`, `fetch` simulado que conta chamadas (fixture = 0 chamadas),
fallback rotulado só para indisponibilidade, acções não suportadas recusadas pelo parser do produto, evidência desconhecida
recusada, experiências suportadas, orçamento de desempenho (triângulos, meshes, materiais, texturas, tempo de build),
libertação de recursos, quadros de fixture válidos e rotulados, fronteiras de módulos e conformidade do CSS com os tokens.

Browser (`tests/e2e/living-visual-foundry.pw.mjs`, 51 verificações, todas a passar): as mesmas regras no Chromium real,
mais retículo desenhado na projecção do âncora (±1 px), seguimento durante a órbita, interrupção de um movimento do
assistente por pointerdown, pose final igual ao último quadro do fixture (o renderer não resolve nada), aviso de fixture
visível em modo foco, ordem de Tab, câmara/microfone nunca pedidos sem clique, reduced-motion, layout móvel, `dispose`.

## Desempenho

Medido no contentor com **SwiftShader (WebGL por software)**: cerca de 0,5–1 fps a 1600×1000, ~1,9 s por quadro,
139 draw calls, ~510 mil triângulos no ecrã (o modelo tem ~250 mil; a contagem inclui a passagem de sombras).
Isto não é desempenho de GPU e não deve ser lido como tal. O renderer só desenha a pedido (sem loop perpétuo).
Tentei uma resolução reduzida durante o movimento; sob SwiftShader piorou (o custo está nos vértices e nas sombras,
e redimensionar os alvos custa um quadro), por isso ficou desligada até ser medida numa GPU.
Perfis: `realtime` (pixel ratio ≤ 1,5, MSAA 4×, sombras 2048, sem AO) e `export` (pixel ratio 2, MSAA 4×, sombras 4096, GTAO).

## Limitações

- O motor de engenharia não está ligado. A única «simulação» é uma pré-visualização de fixture (FK independente em Python,
  `fixtures/generate_boom_extension_preview.py`), rotulada em todos os quadros (`FIXTURE_NOT_ENGINE`) e na interface.
  Só existe para o cilindro da lança; os outros dizem que não há nada para mostrar.
- Sem Muse Spark real nesta sessão: todas as respostas foram de fixture ou de um `/api` simulado no browser.
- A montagem é sintética (`fixture`/`unreviewed`). Geometria de exibição é ilustrativa; a cabina passa acima do envelope
  de colisão canónico e o barril de exibição segue o comprimento fechado (o cilindro de colisão do fixture é mais curto).
- A montagem tem um só cilindro da lança, ao centro; a resposta diz «um cilindro», não «estes cilindros».
- Mangueiras flexíveis são só de exibição: não têm id canónico e nunca são alvo nem bloqueiam a mão.
- Imagens anexadas ficam na conversa como referência; a rota `spatial_agent_request.v1` não as aceita, e a interface diz isso.
- O compositor replica a estrutura do compositor do produto em classes `uw-` (o original está preso a `style.css` global).
- O harness corre no Vite dev; não foi adicionado a `vite.config.ts` (ficheiro partilhado).
- Sem cutaway nem medição interactiva: não estão no rail porque não funcionam.

## Licenças

Técnicas adaptadas do Airsup machine-skill (MIT) — aviso completo em `src/living/visual-foundry/NOTICE.md`. Sem activos 3D,
HDRIs ou texturas externas.

### Ronda final (após as correcções)

`06-hydraulic-joint.png` mostra bem o barril, a cabeça com parafusos, o porto e o tubo de retorno, mas o enquadramento
apanha o corpo do cilindro e não o pino da base; e os metais escuros (rastos, barris) continuam demasiado próximos do
preto no fundo Void. Ficam como trabalho em aberto: reposicionar essa câmara sobre o pino `boom_cyl_base` e subir o
albedo/recorte dos metais escuros.

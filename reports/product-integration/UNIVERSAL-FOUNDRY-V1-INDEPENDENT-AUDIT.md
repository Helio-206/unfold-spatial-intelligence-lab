# Universal Visual Foundry V1 — auditoria independente

**NO-GO para o objectivo universal.** O provider real foi executado no `/living?debug-living&experimental-foundry` a partir de `feat/universal-visual-foundry@587854bcb9f3a7a9f5fd20a524f56fbbb14d92a8`. A instrumentação e a triagem são independentes do provider, mas os oito planos são fixtures grosseiras, escritas manualmente depois dos geradores, incluídas no próprio branch do provider. Não são planos gerados de fotografias, nem holdout confidencial. A análise visual abaixo é do agente, não uma revisão humana independente; o gate formal mantém-se `NOT_EVALUATED` sem ela.

A comparação usa o router normal do produto e depois o Foundry real. **O router escolheu `procedural_v2` para todos os componentes das oito fixtures**: não há aqui uma comparação com malhas efectivamente geradas pelo V3. As imagens emparelhadas usam a mesma pose de câmara e viewport por caso. O Foundry acrescenta detalhe visível em vários exemplos, mas os defeitos identificados impedem extrapolar para qualidade universal. Sem a fotografia original de cada plano, não se mede fidelidade fotográfica.

## Metodologia e reprodução

```sh
npm ci
npm run dev -- --port 5310
# outro terminal; API de plano é servida localmente com fixtures, as restantes recebem 503
node scripts/visual-quality/provider-v1-audit.mjs
python3 scripts/visual-quality/provider-contact-sheet.py
npx tsx scripts/visual-quality/connection-diagnostics.ts
node scripts/visual-quality/resource-lifecycle-audit.mjs
node scripts/visual-quality/image-lifecycle-audit.mjs
npx vitest run --maxWorkers=2
npm run build
```

`UVF_CASES=wrench,miniExcavator` selecciona casos; `UVF_APPEND=1` preserva os restantes resultados. A captura regista hashes dos planos, decisões do router, contagem de malhas/triângulos, câmara, tempos, recursos, selecção, isolamento, três regenerações e guardar/reabrir. Não há qualquer inferência Meta live: o transporte da API é interceptado e os 503 na consola são recusas locais intencionais do endpoint de adopção. O Chromium é headless 1440×900, ANGLE/SwiftShader; tempo até prontidão é apenas uma amostra e não mede GPU nem latência de inferência. O primeiro processo terminou inesperadamente durante o sexto caso; outro terminou durante a regeneração da mini-escavadora. Os resultados foram retomados com um processo Chromium novo por caso; a mini-escavadora completou uma regeneração numa repetição isolada. A causa dos fechos não foi estabelecida.

Fotos e licença constam em `visual-quality/references/manifest.json`. O ensaio de imagem usa fotografias efectivas e um plano hatchback artificialmente ligado ao hash de cada imagem **apenas para testar o ciclo de vida**. Nenhuma destas ligações prova que o plano foi gerado a partir da imagem. Para V2 futura, reter original e hash, hash da imagem enviada após transcoding, resposta realmente produzida, SHA do provider e metadados de câmara; nunca reaproveitar fixtures como resultados de imagem. Falta calibração e máscaras para IoU legítimo.

## Defeitos prioritários

1. **Evidência de imagem de outro Space contamina o Space reaberto**: o ensaio `node scripts/visual-quality/image-lifecycle-audit.mjs` carrega a fotografia A (`car.jpg`, SHA `a4705cec…55ac3ec`), guarda, carrega B (`chair.jpg`, SHA `21f1ba12…db5eca9`), guarda e reabre A. O plano reaberto conserva o hash de A, mas a paleta e o resumo de evidência passam de A (`#060a12`, foreground 90%) para B (`#938e8e`, foreground 60%). Ver `uvf-independent/image-lifecycle/result.json` e capturas A/B/A reaberto. O ensaio associa manualmente o mesmo plano fixture às imagens para testar estado; não é inferência. Em `shell.ts`, `onImage` actualiza o provider de forma assíncrona; `SpaceFlow.openRecord` não restitui a imagem e `FoundryGeometry.dispose()` não limpa `evidence`. Uma extracção que chega tarde também não tem guarda de geração, risco identificado por leitura de código ainda não reproduzido.
2. **Chave de boca gera uma cabeça fechada**: `wrench` é identificada como `Open-end spanner`; a cabeça obtida tem contorno fechado e um furo hexagonal, e o cabo passa a borracha vermelha inferida. A geometria não corresponde a uma boca aberta. Reproduzir com `UVF_CASES=wrench`, ver `uvf-independent/wrench-foundry-front.png` e `src/living/universal-foundry/families/tool.ts` (`head`, ramos de `wrench`, `grip`). Não se trata de fidelidade a uma fotografia.
3. **Cavas do automóvel formam discos negros deslocados**: na fixture `hatchback`, as regiões negras tapam/duplicam parcialmente as rodas; a função cria cilindros cheios para arcos (`families/vehicle.ts`, `buildHull`, linhas dos wheel arches). Reproduzir com `UVF_CASES=hatchback` e ver `hatchback-foundry-side.png` e `hatchback-foundry-threeQuarter.png`. A cabine e a carroçaria são aproximações genéricas com detalhe inferido.
4. **Ligações da mini-escavadora não são verificadas como juntas**: o gerador recebe bounds e papéis, constrói cada peça separadamente e não estabelece restrições de contacto entre lança, braço, balde e cilindro. O diagnóstico reproduzível `connection-diagnostics.ts` mede separação entre AABBs do cilindro e da lança de 0,0160 e entre cilindro e corpo de 0,1726 em unidades da fixture não calibrada; AABB separadas demonstram distância entre caixas envolventes, não erro físico absoluto. A sobreposição de outras AABBs não prova juntas correctas. Ver `families/construction.ts`, `foundry.ts`, e capturas `miniExcavator-*`.

## Limitações de avaliação

As fotografias candidatas não são um benchmark completo nem confidencial. A robustez contra objectos desconhecidos, qualidade de materiais sob iluminação independente, alinhamento com silhuetas e precisão de propriedades continuam não verificados. Não existe amostragem estatística de tempos, dispositivo móvel, Safari ou GPU física. Os detalhes adicionados pelo gerador são inferências e não evidência da fonte. Uma sessão prolongada foi interrompida pelo fecho inesperado do Chromium; os resultados recuperados com processos separados não demonstram estabilidade de longa duração.

## Resultados por categoria

Observações do agente sobre as capturas, sem classificação humana formal. Os tempos são uma única execução, do clique em construir até o relatório não ter upgrades pendentes; incluem o ambiente de teste e não medem tempo de GPU.

| Fixture / categoria | Triângulos router (V2) → Foundry | Prontidão router → Foundry (ms) | Observação visual |
|---|---:|---:|---|
| hatchback / veículo | 684 → 45 832 | 611 → 3 491 | Automóvel reconhecível; carroçaria e vidro mais detalhados; discos negros nas rodas. |
| sofa / mobiliário | 3 000 → 18 728 | 1 096 → 5 132 | Sofá reconhecível, almofadas mais arredondadas; materiais e proporções não comparados com foto. |
| washer / electrodoméstico | 900 → 4 760 | 730 → 3 239 | Máquina de lavar reconhecível, porta e comandos acrescentados; detalhes inferidos. |
| pavilion / arquitectura | 1 176 → 5 544 | 900 → 1 413 | Pavilhão de colunas reconhecível; lajes com superfície e bordas detalhadas. |
| apple / orgânico | 816 → 5 668 | 783 → 1 492 | Fruto reconhecível; forma e haste inferidas, acabamento muito brilhante. |
| wrench / ferramenta | 600 → 1 960 | 888 → 801 | Cabeça fechada incompatível com a chave de boca aberta pedida; punho inferido. |
| monitor / electrónica | 900 → 3 172 | 833 → 1 555 | Monitor reconhecível; moldura e câmara sugeridas; suporte básico. |
| miniExcavator / construção | 2 196 → 18 640 | 5 461 → 5 629 | Máquina reconhecível, com lagartas e cabina; juntas e hidráulica não demonstradas. |

[Contact sheet emparelhada](uvf-independent/contact-sheet.jpg). A coluna esquerda é o router do produto com V2 efectivo, não geometria V3 efectiva. Capturas completas de frente, lado e três quartos, isolamento, decisões e hashes estão em `uvf-independent/`. Na construção, o plano do Foundry era igual ao do router. Guardar/reabrir preservou os valores e o plano guardado nas oito fixtures; a igualdade de IDs e plano após cada regeneração não foi registada neste ensaio. Foram concluídas três regenerações nas primeiras sete e uma na mini-escavadora, após o fecho inesperado do Chromium durante o ensaio mais longo.

## Ciclo de vida e recursos

Na mini-escavadora, `resource-lifecycle-audit.mjs` guardou uma vez e executou quatro ciclos fechar/reabrir. Em cada fecho, os 27 objectos `BufferGeometry` e 14 materiais acompanhados emitiram eventos `dispose`; `renderer.info.memory.geometries` passou de 31 para 4 e, ao reabrir, voltou a 31, 31, 31 e 30. Texturas passaram de 13 para 7 e voltaram a 13. Os 4 recursos de geometria e 7 texturas restantes não foram identificados individualmente; a contagem não prova ownership. A heap reportada pelo Chromium variou aproximadamente de 59 MB a 156 MB sem GC forçado. Quatro ciclos e contadores de objectos não provam ausência de fugas nem quantificam VRAM. Ver `uvf-independent/resource-lifecycle.json`.

O ensaio isolado do par de imagens confirmou um problema mais sério: reabrir A depois de B atribui evidência B ao hash A, como descrito acima. Corrigir a associação e invalidar resultados de extracção obsoletos antes de considerar qualquer uso de imagens. A validação humana de semântica e a comparação com V3 efectivo continuam pendentes.

## Verificação final

- `npx vitest run --maxWorkers=2`: **161 ficheiros, 2 544 testes passaram**.
- `npm run build`: passou; Vite assinalou variável de contacto da landing não definida e bundle superior a 500 kB.
- Browser: oito pares capturados, todos com router em V2; três regenerações em sete casos, uma na mini-escavadora; quatro ciclos adicionais de fecho/reabertura na mini-escavadora; defeito de associação de imagem A/B reproduzido. Consola: respostas 503 esperadas do mock offline. Em dois momentos Chromium fechou inesperadamente (`Target page, context or browser has been closed`); causa não identificada.
- Não foi feita inferência paga, merge ou modificação do provider de origem. Não há validação fotográfica de geometria nem ensaio com GPU física.

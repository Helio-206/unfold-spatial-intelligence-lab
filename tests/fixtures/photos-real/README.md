# Fotografias reais de validação (câmara, direitos limpos)

Copiadas do manifest de referências da auditoria visual
(`reports/product-integration/visual-quality/references/manifest.json` no ramo
`feat/universal-foundry-v1-1-image-integrity`), com hashes verificados:

| Ficheiro | sha256 | Autor | Licença | Fonte |
|---|---|---|---|---|
| `car.jpg` | `a4705cecb298ba521a46baeb4ba1acd7cf75bdf3500d1c927d45788aa55ac3ec` | OathOn | CC0 | Wikimedia Commons: 2015 Vauxhall Astra SRi hatchback, vista lateral |
| `bus.jpg` | `b98059c978b56795f3c6419b41e0b8bc276c3e65aaee1e57b7ad2e7cc47d86df` | GK tramrunner RU | CC BY-SA 4.0 | Wikimedia Commons: Novabus LFS, vista lateral |
| `porsche-911.jpg` (held-out) | `7bc7fd8cdeb3f64914cefff0f2d25a4c65709a91fee10e20bd58a803c6750423` | (Wikimedia Commons: «Silver 911 right side profile») | CC BY-SA 2.0 | Wikimedia Commons, perfil lateral verdadeiro com camiões atrás |
| `skoda-kodiaq.jpg` (não visto até à recuperação) | `36f6299516b704e3c51563d8e32582125f219bf8572da4f7e6960be53e5954b5` | (Wikimedia Commons: «Skoda-kodiaq-side-profile») | CC BY 4.0 | Wikimedia Commons, perfil lateral de SUV |

`corrections.json` contém os contornos de correcção (segunda passagem do mesmo
anotador) usados para medir se a máscara corrigida pelo utilizador coincide com a
referência: IoU 0.935–0.962 nas quatro fotografias.

`annotations.json` contém polígonos de silhueta desenhados manualmente pelo
implementador (um só anotador, não revistos) para medir IoU e erro de bbox das
máscaras extraídas. Resultado actual: IoU 0.20–0.27 nas três — abaixo de qualquer
critério de confiança; o fitting recusa as três (fail-closed).

Estado do manifest (honesto): «INCOMPLETE CANDIDATES: no frozen benchmark, no
confidential holdout, annotations not independently reviewed». São fotografias de
câmara reais usadas para validar máscara, silhueta e fitting — não um benchmark
congelado. Os fixtures raster desenhados em `tests/fixtures/photos/` continuam a
existir apenas como regressões determinísticas e nunca como evidência fotográfica.

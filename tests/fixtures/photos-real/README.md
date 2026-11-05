# Fotografias reais de validação (câmara, direitos limpos)

Copiadas do manifest de referências da auditoria visual
(`reports/product-integration/visual-quality/references/manifest.json` no ramo
`feat/universal-foundry-v1-1-image-integrity`), com hashes verificados:

| Ficheiro | sha256 | Autor | Licença | Fonte |
|---|---|---|---|---|
| `car.jpg` | `a4705cecb298ba521a46baeb4ba1acd7cf75bdf3500d1c927d45788aa55ac3ec` | OathOn | CC0 | Wikimedia Commons: 2015 Vauxhall Astra SRi hatchback, vista lateral |
| `bus.jpg` | `b98059c978b56795f3c6419b41e0b8bc276c3e65aaee1e57b7ad2e7cc47d86df` | GK tramrunner RU | CC BY-SA 4.0 | Wikimedia Commons: Novabus LFS, vista lateral |

Estado do manifest (honesto): «INCOMPLETE CANDIDATES: no frozen benchmark, no
confidential holdout, annotations not independently reviewed». São fotografias de
câmara reais usadas para validar máscara, silhueta e fitting — não um benchmark
congelado. Os fixtures raster desenhados em `tests/fixtures/photos/` continuam a
existir apenas como regressões determinísticas e nunca como evidência fotográfica.

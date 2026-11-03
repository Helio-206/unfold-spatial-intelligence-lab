# Integração com o palco cinemático (Claude Cloud)

Ponto de entrada: `createExcavatorProvider(assembly)` em `provider.ts`. A partir daqui, o desenvolvimento visual fica parado.

## O que o provider entrega

- `root`: grupo pronto a adicionar à cena do palco, no referencial do mundo da montagem (+X frente, +Y cima, +Z direita, metros).
- `parts`: um `Group` por parte canónica (`part:<id>`, `userData.partId`). As mangueiras flexíveis têm `userData.displayOnly`, sem id canónico.
- `registry`: componentes canónicos (partes, actuadores, juntas) com proveniência; é o que a Digital Hand usa.
- `applyFrame(frame)`: só aceita `unfold.motion-frame.v1` válido, com `status: 'ok'` e o mesmo `assemblyId`. Tudo o resto é
  recusado e a pose actual mantém-se. Quadros com `FIXTURE_NOT_ENGINE` aplicam-se, mas voltam com `source: 'fixture'`.
- `applyReferencePose()`, `stats()`, `dispose()`.

## O que fica do lado do palco

O renderer, a câmara, as luzes, o pós-processamento e a exposição são do palco. `studio.ts` e `renderer.ts` são só a referência
deste protótipo; o palco pode substituí-los. Os materiais usam `MeshPhysicalMaterial` com mapas gerados localmente (sem activos
externos) e esperam espaço de cor linear, saída sRGB e tone mapping no fim da cadeia.

## Regras que o palco tem de manter

1. As transformações das partes vêm só do motor (ou da pose de referência). O palco não interpola nem resolve laços.
2. Para destacar, isolar ou explodir: troca de material ou deslocamento de exibição rotulado. Nunca editar a geometria nem
   os quadros.
3. Ids canónicos estáveis: não renomear grupos nem fundir partes diferentes numa só malha.

## Orçamento actual (perfil realtime)

Cerca de 250 mil triângulos no modelo, menos de 90 malhas, 12 materiais e 14 texturas pequenas (ver `foundry.test.ts`).

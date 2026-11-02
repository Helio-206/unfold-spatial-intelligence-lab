# Contratos «living»: `unfold.assembly.v1` e `unfold.motion-frame.v1`

Fonte de verdade em TypeScript: `assembly.v1.ts` e `motion-frame.v1.ts` (com validadores). Tudo importa-se de `src/living/contracts`.

## O que cada um é

- **`unfold.assembly.v1`**: uma montagem articulada: partes (com pontos nomeados e formas), juntas (árvore), restrições de fecho de laço,
  actuadores (cilindros hidráulicos e accionamentos rotativos), política de colisão. Todo o número tem unidade e proveniência (Core).
- **`unfold.motion-frame.v1`**: o instantâneo que o motor devolve para um instante: poses das partes no mundo, estado das juntas e
  dos actuadores, medidas, estado do solver, colisões, avisos e referências de evidência.

## Convenções (fixas na v1)

| | |
|---|---|
| Eixos | direitos; +X frente da máquina, +Y cima, +Z lado direito do operador |
| Unidades | m, rad, s (qualquer outra é recusada) |
| Quaterniões | `[x, y, z, w]`, unitários |
| Pose filha | `T_filha = T_pai · origem_da_junta · movimento(eixo, q)` |
| Desconhecido | `null`, nunca zero (massa, dados hidráulicos, caudal máximo) |
| Proveniência | Core: `origin` + `validation`. O fixture é `fixture` + `unreviewed` em todo o lado |

## Como consumir o quadro (renderer, cinema)

Desenhar `parts[].translationM` / `rotation` (referencial `worldFrameId`), mostrar `status`, `blocked`, `warnings` e `measurements`
tal como vêm. **Não resolver relações de engenharia**: curso→ângulo, fecho de laços e limites são do motor. Se `status !== "ok"`,
`poseBasis` diz que pose é mostrada (`held_last_valid`, `reference` ou `none`); nunca se inventa uma.

## Fixture

- `fixtures/excavator.assembly.v1.json` (fonte) e `fixtures/excavator.assembly.v1.ts` (`EXCAVATOR_ASSEMBLY_V1`, igual ao JSON).
- `fixtures/excavator.reference-pose.json`: poses das partes na configuração de referência, calculadas por um script Python
  independente do motor (`fixtures/generate_excavator.py`, que também gera os dois ficheiros acima). Serve de verificação cruzada.
- Sintético: dimensões escolhidas por plausibilidade, não são de nenhum fabricante.

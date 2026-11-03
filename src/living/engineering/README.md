# Motor de engenharia «living» (fase 1–5)

Calcula o movimento de uma montagem `unfold.assembly.v1` (contratos em `src/living/contracts/`). Só calcula: quem desenha ou
filma recebe quadros `unfold.motion-frame.v1` e usa as transformações tal como vêm.

## API

| Função | Para quê |
|---|---|
| `evaluateReferencePose(assembly)` | quadro da pose de referência (todas as juntas nos valores de referência) |
| `evaluateActuators(assembly, values)` | quadro a partir do curso dos cilindros (m) e do ângulo dos accionamentos rotativos (rad) |
| `evaluateConfiguration(assembly, joints)` | quadro a partir dos valores de todas as juntas móveis |
| `createEngineeringSession(assembly)` | sessão: comandos, amostragem no tempo, reprodução, alteração de parâmetros |
| `commandMove(session, {targets, durationS?})` | pede um movimento; recusa com código se a trajectória não for válida |
| `sampleEngineeringMotion(session, t)` | quadro no instante `t` (função pura do instante) |
| `createPlayback` / `play` / `pause` / `seek` / `advance` / `samplePlayback` | reprodução com passos dados pela chamada (não pelo ecrã) |
| `evaluateParameterChange(session, patch)` | altera um parâmetro, valida a montagem de novo, devolve antes e depois |
| `primitiveCollisionBackend` | verificação de colisões (caixas e chão); `CollisionBackend` é a interface para outros verificadores |

## Convenções (as da montagem)

Direito; +X frente da máquina, +Y cima, +Z direita. Metros, radianos, segundos. Quaterniões `[x, y, z, w]` unitários.
Desconhecido é `null`, nunca zero: a massa, a pressão e a força não são calculadas porque a montagem não as tem.

## Quadros

- `status: "ok"` — pose resolvida, `poseBasis: "solved"`, `solver.status: "solved"`.
- `status: "blocked"` — configuração recusada. `poseBasis: "reference"`: as poses mostradas são as de referência. `blocked.code`
  diz porquê: `STROKE_OUT_OF_RANGE`, `CYLINDER_UNREACHABLE`, `CYLINDER_OUT_OF_JOINT_RANGE`, `JOINT_LIMIT_EXCEEDED`,
  `LOOP_CLOSURE_VIOLATED`, `COLLISION`, `UNSUPPORTED_GEOMETRY`, `UNCOVERED_JOINT`, `TARGET_BLOCKED`, `TRAJECTORY_BLOCKED`.
- Um cilindro num quadro bloqueado pode não ter `lengthM` (`null`): o solver não resolveu a configuração.

## Limites conhecidos

- O solver cobre as duas topologias do excavador (triângulo directo, e balancé de duas barras). Outra geometria devolve
  `UNSUPPORTED_GEOMETRY`; não há um solver de mecanismos genérico.
- A trajectória é verificada em 50 intervalos. Entre dois pontos verificados não se examina a configuração. Para a montagem
  actual os limites são monótonos no curso, por isso isto não esconde bloqueios; outra montagem pode ter um bloqueio mais estreito.
- Colisões: caixas contra caixas e contra o chão; cilindros só contra o chão. O relatório diz o que foi verificado.
- Nada disto prova capacidade hidráulica nem segurança estrutural.

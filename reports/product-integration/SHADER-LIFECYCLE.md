# Shader lifecycle — correção e validação

## Alteração

A reconstrução de `PlanSpaceLayer` continua a compilar novos materiais independentes por componente, sem cache global ou partilha de materiais mutáveis. A geometria antiga é libertada de imediato. Os materiais e texturas próprios da última cena apresentada ficam vivos até a nova cena ser renderizada; então são libertados. Se várias reconstruções ocorrerem antes dessa frame, só a última cena apresentada fica retida; as cenas intermédias são libertadas imediatamente. Ao fechar o Space, tudo é libertado. Um timeout de 1 s liberta os materiais pendentes se não chegar outra frame (sujeito ao agendamento do browser). Materiais/texturas de ofertas externas conservam a política de ownership existente.

A manutenção temporária evita que o contador de referências de programas Three.js chegue a zero entre as cenas. A verificação de erros de shader permanece ativa; não há partilha de estado mutável entre materiais novos e antigos. A libertação antecipada por timeout pode permitir recompilação, mas impede retenção indefinida enquanto o Space continua aberto.

## Comparação antes/depois

Mesma harpa guardada e reproduzida, `/living`, 1440×900, mesma câmara e ações locais, Chromium headless/SwiftShader, sem calls pagas, 3 ciclos de aquecimento e 12 medidos por série. Mediana/máximo do tempo síncrono `renderNow` após edição/undo em ms; não é tempo de GPU nem tempo de apresentação. Antes: código `57467a14`; depois: correção neste branch. Séries sequenciais num único host, não extrapoláveis para GPU física.

| Ensaio | Edição antes | Edição depois | Undo antes | Undo depois |
|---|---:|---:|---:|---:|
| V2 sem screenshots | 1186,2 / 1857,3 | 3,7 / 6,2 | 1201,3 / 1317,9 | 3,4 / 5,1 |
| V3 ativo, sem screenshots | 1842,8 / 1912,5 | 3,5 / 8,5 | 1824,4 / 1880,2 | 3,7 / 6,4 |
| V3 gerado, sem substituição | 1975,4 / 2099,9 | 3,8 / 8,4 | 1067,7 / 2117,9 | 4,1 / 6,7 |
| V3 sem probes detalhados | 1912,2 / 1964,7 | 3,3 / 6,8 | 1901,2 / 1967,3 | 3,3 / 6,4 |

O cenário V3 com screenshot continua a gastar tempo na captura: mediana/máximo da captura 1911,5/2477,0 ms antes e 1935,0/2421,0 ms depois; não é uma medição isolada do render da cena. A melhoria acima aplica-se ao benchmark sem capturas. Não se atribui uma garantia rígida de frame.

No trace V2 de três edições e três undo, antes foram contados 12 `deleteProgram`, 24 `compileShader`, 12 `linkProgram`, 12 `getProgramInfoLog`; depois, nenhum desses eventos ocorreu durante os seis ciclos observados. São contagens pontuais para a mesma fixture, não garantia para alterações de material que exijam variantes de shader ou para um timeout antes do render.

Seis ciclos reais de criação, edição, undo e fecho em `/living` devolveram o renderer ao baseline em todos os ciclos: 4 geometrias, 7 texturas e 7 programas. Em cena: 19 geometrias, 9 texturas, 9 programas; `geometryBytes` da camada 157408 no ponto de medição. `performance.memory.usedJSHeapSize` ao fechar oscilou de 106553712 a 153568130 bytes, com baseline 128445176: é estimativa sujeita a GC, não memória GPU nem demonstração universal de ausência de fugas.

Os resultados locais estão em `/tmp/unfold-rca/` (antes), `/tmp/unfold-shader-fixed/`, `/tmp/unfold-shader-trace-final/` e `/tmp/unfold-shader-lifecycle/` (depois). Os scripts de reprodução são `tests/e2e/performance-root-cause.pw.mjs`, `performance-shader-trace.pw.mjs` e `shader-lifecycle.pw.mjs`. Os testes de unidade verificam material independente, cor, seleção, libertação após frame, timeout e dispose antecipado.

## Limites

Não foram medidos GPU física, VRAM de pico, apresentação efetiva, áudio real, Safari/iOS ou todas as combinações de materiais e assets externos. As contagens do renderer e os seis ciclos não provam ausência de fugas noutras plataformas. A decisão de produção continua condicionada à revisão e à validação nesses ambientes; V4 não foi integrado nem ativado.

# UNFOLD — Living Intelligence Engine

**Branch:** `feat/unfold-living-intelligence-engine` · **Base:** `integration/universal-foundry-e1-4@84a22a2cd44d9ffd2dc308191b526ee8809570f5` · **SHA final:** ver cabeçalho do commit desta entrega (relatório incluído no mesmo commit; o SHA é o do commit que contém este ficheiro).

**Activação (nunca por omissão):** `/living?debug-living&experimental-living-intelligence` (com `&example=1` para a escavadora de exemplo).

## Veredicto

**GO condicionado** para a experiência Living Intelligence experimental atrás de flag, com os limites declarados em «Não suportado». As três provas de aceitação foram demonstradas no workspace real:

- **MOVEMENT** — o cilindro da lança estende e a lança, o braço e a caçamba movem-se ligados, com fecho de laço resolvido pelo solver em cada instante (residual medido: 1.83e-15 m; screenshot `03-animated-paused.png` mostra a lança levantada e o cilindro destacado).
- **UNDERSTANDING** — «O que faz a lança?» responde com explicação ancorada na entidade real `boom`, dependências reais e unknowns declarados (screenshot `02-explain-boom.png`).
- **EXPERIMENTATION** — experiência cilindro→lança com antes/depois calculados das poses do motor; parâmetro de braço de alavanca avaliado numa cópia transitória via `evaluateParameterChange`, sem mutar a montagem (provado por teste de imutabilidade).

## Arquitectura e contratos

Subsistema independente em `src/living/living-intelligence/` (sem tocar nos módulos nucleares do Universal Foundry nem no renderer experimental):

| Ficheiro | Conteúdo |
|---|---|
| `contracts.ts` | `unfold.living-scene.v1`: `LivingEntity`, hierarquia, `MotionCapability` (supported/inferred/unavailable), parâmetros known/inferred/unknown com proveniência, estado de revisão, nível de evidência. Constrói-se de `unfold.assembly.v1` validada; sem junta/actuador, a capacidade é `unavailable`. |
| `engineering-bridge.ts` | Única ponte para a API pública verificada de `src/living/engineering` (+ `loopResiduals` do módulo FK). Não duplica solver nem sistema de transacções. |
| `motion.ts` | `LivingMotionEngine`: revolute/prismatic/fixed via FK e solver de actuadores; limites fail-closed; interpolação **nos actuadores** (o solver fecha os laços; interpolar ângulos dependentes media ~5e-6 m de residual); play/pause/resume/reverse/reset/seek/velocidade; tempo de simulação separado do frame rate (`step(dt)`); geração anti-stale, cancelamento, dispose, reduced-motion (salta para o fim). |
| `behaviours.ts` | Comportamentos reutilizáveis (cilindro hidráulico, braço revolute, roda, direcção, porta, accionamento rotativo) + adaptador de engrenagens com razão declarada (`mechanically_plausible`, sem modelo de contacto) + força hidráulica `F = P·A` **só** com pressão/diâmetro conhecidos; caso contrário, resultado conceptual normalizado. |
| `tutor.ts` | Explicações beginner/intermediate/technical ancoradas em IDs reais, dependências pela hierarquia/juntas/actuadores, unknowns, nota de evidência; `whoMoves`; walkthrough passo-a-passo (câmara via `pointAt`, destaque, animação sincronizada, next/prev/pause/replay). |
| `intents.ts` | Intérprete offline PT/EN determinístico → `InteractionCommand` tipado validado contra a cena e a revisão (`STALE_SCENE`, `UNKNOWN_COMPONENT`, `UNKNOWN_ACTUATOR`, `AUTHORITATIVE_REVIEW_REQUIRED`, destrutivos recusados). Sem inferência paga; texto externo nunca executa directamente. |
| `experiments.ts` | 3 experiências da escavadora (cilindro→lança; ângulo→alcance; braço de alavanca→relação curso/ângulo), repetíveis, com reset, antes/depois comparáveis. |
| `fixtures.ts` | Roda+direcção e porta de dobradiça como montagens `assembly.v1` válidas resolvidas pelo mesmo FK (multi-domínio sem código específico de escavadora no motor). |
| `scenario-store.ts` | `unfold.living-scenario.v1`: guardar/reabrir estado interactivo (actuadores, experiência, passo) em `localStorage`, validado por assembly; nunca o plano autoritativo. |
| `panel.ts` + CSS | Painel dentro do `/living` real: modos Explorar/Compreender/Animar/Experimentar, lista de componentes, comando em linguagem natural, controlos de reprodução, experiências, walkthrough, demos multi-domínio, guardar cenário. |

**Integração estreita (2 ficheiros existentes, +15 linhas):** `workspace.ts` ganha `livingAssembly()` (cópia) e `applyLivingFrame(PartPose[])` (poses transitórias no `SceneController` existente); `shell.ts` monta o painel atrás de `debug-living` + flag, depois de `mountExperience` (que reconstrói a app), com dispose em `pagehide`. Nenhum módulo do Universal Foundry, do renderer experimental ou do sistema de transacções E1.4.1 foi alterado.

## Movimento e matemática

Poses vêm de `evaluateActuators`/`evaluateConfiguration` do motor de engenharia existente (FK hierárquica `T_filha = T_pai · origem · movimento(eixo, q)`, quaterniões unitários, SI). A trajectória é validada em 20 amostras de actuadores (limites, colisão e fecho pelo solver) antes de animar; cada frame intermédio interpola actuadores com smoothstep e resolve — componentes ligados permanecem ligados por construção. Níveis de evidência são declarados na UI: cinemática validada ≠ plausível ≠ física validada (nunca afirmada).

## Autoridade e segurança (J)

Movimento/experiência/cenário são estado transitório: não há escrita em `SpatialPlanV2`, revisão não incrementa, comandos com revisão de cena stale são recusados, geração invalida callbacks após cancelamento/substituição, dispose rejeita acções pendentes, e alterações autoritativas de parâmetros são recusadas com encaminhamento para a revisão existente. Proveniência (`fixture/unreviewed`) é preservada nas explicações.

## Demonstração (L) — executada, não descrita

`npx tsx tests/e2e/living-intelligence.pw.ts` (Chrome real, rendering por software, sem chamadas pagas) — **7/7 PASS**: abrir escavadora → seleccionar lança → perguntar o que faz → destacar actuador → estender com movimento ligado → pausa/retoma/reset → experiência com parâmetro → walkthrough passo 1→2 → guardar e reabrir. Screenshots em `living-intelligence-evidence/01..06`. Vídeo: não produzido (sem ferramenta de gravação neste ambiente); a sequência de screenshots cobre os estados.

Demos multi-domínio: roda+direcção (steer 0.5 rad + spin resolvidos por FK) e porta (dobradiça até 1.2 rad, limite recusado a 9 rad) — testes unitários sobre montagens reais; no palco visual mantém-se a escavadora (o builder visual actual é o da escavadora), e o painel apresenta as poses calculadas para essas montagens.

## Testes e desempenho (M/K)

- Novos: `tests/living-intelligence.test.ts` — **17/17** (cena, fecho, limites, determinismo, pausa/inversão/reset, reduced-motion, stale/dispose, multi-domínio, engrenagem, força, tutor, walkthrough, intents PT/EN, 3 experiências, imutabilidade, cenário, flag).
- Regressão completa: **2563/2563 testes, 163/163 ficheiros** (`npx vitest run --testTimeout=30000`). Nota factual: com o timeout por omissão de 5 s, 3 testes pesados falharam por timeout sob carga paralela e passam isolados e na suite com timeout de 30 s.
- Build: `npm run build` verde; `tsc --noEmit` verde.
- Desempenho: avaliação de frame do solver ≈ 5.1 ms/frame (1000 frames, residual de fecho 1.83e-15 m) em CPU; nenhuma regeneração de geometria por frame (só `setPoses`).

Critérios de aceitação congelados (secção M da missão) estão cobertos por testes, excepto: gravação de vídeo (indisponível) e compatibilidade com o renderer fotorealista experimental (a integração consome só `PartPose[]`, sem depender de materiais/iluminação — compatível por construção, não exercitada contra esse renderer por ele estar a ser modificado por outro agente).

## Não suportado (declarado)

- Solver de mecanismos genérico para além das topologias do motor existente (`UNSUPPORTED_GEOMETRY` continua a vir do motor).
- Física validada: sem capacidade de elevação, segurança estrutural ou desempenho real — parâmetros desconhecidos mostram-se como conceptuais normalizados.
- Simulação eléctrica/médica/universal: apenas interfaces e o adaptador de engrenagens declarado.
- Demos roda/porta sem modelo visual próprio no palco (poses calculadas apresentadas no painel).
- Fala: o tutor é textual; a voz existente do workspace não é requisito nem foi alterada.

## GO/NO-GO

**GO** para uso experimental atrás de flag (`debug-living&experimental-living-intelligence`), sem activação por omissão e sem merge para `main`/`produto`. **NO-GO** para qualquer afirmação de física validada ou para activar por omissão.

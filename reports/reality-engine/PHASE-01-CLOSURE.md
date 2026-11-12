# Fase 01 — Reality Engine: encerramento da execução de engenharia

**Data:** 2026-11-12 · **Branch:** `claude/unfold-fase-01-reality-engine-lvhbn9` · **Certificação: NO-GO.**

Encerrar a execução **não é aprovar a qualidade**. A engenharia da Fase 01 está concluída no que o ambiente permite construir e medir; a certificação de fidelidade não foi obtida e as razões estão abaixo, com critérios verificáveis em [`TECHNICAL-DEBT.md`](TECHNICAL-DEBT.md). O contrato legível por máquina do que existe está em `src/living/reality/capabilities.ts` (verificado por `tests/reality-phase01-closure.test.ts`).

## 1. O que está comprovadamente a funcionar
- **Percurso integrado em `/living`** (E2E de browser, 16 verificações + captura): importar vistas → analisar → gate de captura → corrigir contornos e partes → construir → rever → refinar com nova vista (pré-visualização antes de aplicar) → editar componentes → guardar → reabrir com as mesmas malhas. Mesmo Spatial Core, mesmas transacções, mesma representação geométrica; sem geometria de demonstração no caminho real; sem chamadas pagas aos modelos.
- **Evidência versionada e determinística**, com contratos validados, proveniência por vista (contorno automático/confirmado, método), câmara declarada/estimada, correcções de partes feitas pela pessoa, e histórico desfazer/refazer.
- **Classificação de fidelidade em três eixos** (consistência interna, evidência visual independente, fidelidade geométrica); nunca «fiel» a partir de vistas do utilizador; consistência sozinha dá «não validado». Corrigiu a falsa confiança do AntiqueCamera.
- **Gate de captura** com o que falta e o que fazer; sem avanço silencioso em baixa confiança; reconhecimento gravado na evidência.
- **Correcção assistida da estrutura** (fundir, dividir, nomear) com proveniência humana, reversível, integrada antes de construir.
- **Editor de contornos** com acessibilidade e layout medidos em browser (e três defeitos reais corrigidos por essa medição).
- **Representação visual:** LOD com erro limitado e medido, normais auditadas, aparência mate com a base declarada.
- **Infra de validação:** benchmarks reproduzíveis (14 activos licenciados, split desenvolvimento/aceitação congelado), harnesses de segmentação, componentes, câmara; ingestão de scans externos por ficheiros locais e avaliação pinhole testadas com dados sintéticos.

## 2. O que funciona só com condições (medido em renders)
| Capacidade | Condições | Medição |
|---|---|---|
| Casco multivista | contornos confirmados, ≥ 8 vistas, opaco e rígido | chamfer mediano 2,57% da diagonal (1,2–6%) |
| Contorno automático, câmara fixa | fundo estático | IoU médio 0,754; 48% das vistas aceites com IoU < 0,8 |
| Câmara perspectiva | estimativa com portão de ganho | 65°: mediana 3,48→3,16; 0 activos piores |

## 3. O que NÃO está demonstrado
- **Fidelidade geométrica em fotografias reais** — todo o benchmark é de renders; nenhum número DTU/ETH3D existe.
- **Contorno automático com fundo a mudar** — 59–67% dos contornos aceites estão errados.
- **Estrutura de partes automática** — 8/27 (nós) e 4/45 (cascas físicas) nos activos de aceitação; cor, SAM e decomposição convexa foram medidos e não melhoram os dois referenciais.
- **Materiais PBR fundamentados** — a reflectância não é medida.
- **Desempenho em GPU real** — medido em renderização por software.

## 4. Dependências externas (não simuláveis)
Datasets externos descarregados (política de rede: ingestão por ficheiros locais pronta) · fotografias reais com contorno de referência · **avaliadores humanos independentes** (protocolo em `HUMAN-EVALUATION-PROTOCOL.md`; nenhum número do projecto é uma avaliação humana) · GPU real.

## 5. Alternativas investigadas e rejeitadas com medição (não repetir sem novo argumento)
Escolha de contorno por concordância geométrica (AUC 0,23–0,31); alinhamento de arestas e contraste como detector de contornos errados (AUC 0,63–0,65); SAM, U²-Net, GrabCut com caixa central (IoU 0,42–0,51); co-segmentação multivista por votação; carving por foto-consistência; subdivisão de partes por cor, por propostas SAM elevadas a 3D e por decomposição convexa; câmara perspectiva com FOV verdadeiro como regra (a estimação recupera só parte do ganho). Detalhe: `REPORT.md` §11–12, `INVESTIGATION.md`.

## 6. Estado dos testes
`npm test`: 2796 testes (2793 passam); as 3 falhas (`spatial-persistence-failures` ×2, `spatial-review-binding-transition`) são de ambiente — o contentor corre como root e não dispara a injecção de falhas de disco por permissões — e ocorrem igualmente sem as alterações desta fase. `npm run build` passa. Nenhum teste foi marcado `skip`.

## 7. Veredicto
**NO-GO.** O Reality Engine é um sistema funcional, honesto sobre a sua evidência e utilizável com correcção humana; **não** é uma reconstrução fiel demonstrada. A Fase 02 pode assentar nas capacidades «demonstradas» e «condicionais» do manifesto sem pressupor fidelidade; ver `docs/PHASE-02-LIVING-INTELLIGENCE-INTEGRATION.md`. A dívida de reconstrução é prioridade técnica contínua, com critérios em `TECHNICAL-DEBT.md`, e **não gera novas fases**.

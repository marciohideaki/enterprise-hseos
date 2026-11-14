# Manifesto da remoção de higiene — 2026-11-13/14

Registro dos arquivos de andaime removidos do repositório pela run `20261113-repo-hygiene`
(`.hseos/runs/dev-squad/20261113-repo-hygiene/`). Nenhum arquivo foi perdido: todos continuam no histórico git
e na tag de arquivo.

- **Tag de arquivo:** `hseos-hygiene-archive-20261113` (anotada, aponta para `56478fa4`, publicada no remoto antes da remoção: `git ls-remote --tags origin 'hseos-hygiene*'`)
- **Base da remoção:** `56478fa4` (master)
- **Critério:** cadeia fechada pelo grafo de referências (`docs/hygiene/20261113/reference-graph.mjs`): o arquivo
  não é citado por nenhum arquivo versionado fora do próprio conjunto removido, e os citantes que sobram são
  não citantes por regra declarada. A revisão cética está em `REVIEW-HA.md`, na pasta da run.
- **Prova:** `removable_by_graph: true` na evidência versionada (`docs/hygiene/20261113/reference-graph.json`, base
  `ddde51e9`, ponta da task no momento da execução; a árvore analisada é a de `a4fabbd5` mais `docs/hygiene/`, que fica fora da análise) e reexecutado em `56478fa4` sem contar os registros da própria run
  (145 arquivos, 562188 bytes, conjunto idêntico ao da evidência: true).

## Limites

- Uma citação pelo nome da run, sem caminho (ex.: `MAPA.md` e `w5/STATUS.md` citam runs pelo id), não protege arquivo: todas as encontradas citam a run como conceito ou arquivos que ficam (`STATUS.md` e relatórios citados). Ver `CLASSIFICATION.md` e `REVIEW-HA.md` da run.
- Caminho montado dinamicamente não aparece no grafo; a remoção simulada com a suíte completa (registrada no `STATUS.md` da run) cobre esse caso.
- Citantes `0` significa que o grafo não encontrou nenhum citante, nem histórico.

## Como recuperar

```bash
git show hseos-hygiene-archive-20261113:<caminho>
git checkout hseos-hygiene-archive-20261113 -- <caminho>
```

## Totais por área

| Área                                                                  | Arquivos |  Bytes |
| --------------------------------------------------------------------- | -------: | -----: |
| `.hseos/runs/dev-squad/(raiz)`                                        |        1 |     34 |
| `.hseos/runs/dev-squad/20260425-1900-state-w1-foundation`             |        3 |   9780 |
| `.hseos/runs/dev-squad/20260425-1942-state-w7-kanban`                 |        4 |  12097 |
| `.hseos/runs/dev-squad/20260425-1950-state-w2-cli-hooks`              |        1 |   1942 |
| `.hseos/runs/dev-squad/20260425-2010-state-w3-validation`             |        2 |   7053 |
| `.hseos/runs/dev-squad/20260425-2124-state-w8-central-kanban`         |        4 |   7526 |
| `.hseos/runs/dev-squad/20260425-2154-state-w4-mcp-cron`               |        4 |  11993 |
| `.hseos/runs/dev-squad/20260425-2216-state-w5a-skill-instrumentation` |        4 |   6773 |
| `.hseos/runs/dev-squad/20260425-2220-state-w5b-resume-purge`          |        4 |   4722 |
| `.hseos/runs/dev-squad/20260425-2224-state-w6-governance`             |        4 |   3526 |
| `.hseos/runs/dev-squad/20260528-0900-ado-ops-module`                  |        6 |   8191 |
| `.hseos/runs/dev-squad/20260603-0553-telemetry-swarm-coherence`       |        5 |  11910 |
| `.hseos/runs/dev-squad/20260606-prod-ready-waves`                     |        6 |   4334 |
| `.hseos/runs/dev-squad/20261001-0040-ecp-contract-authority`          |        6 |  29715 |
| `.hseos/runs/dev-squad/20261006-2040-pendencies-closeout`             |        2 |   3711 |
| `.hseos/runs/dev-squad/20261007-2130-guard-tokenizer`                 |        2 |  22197 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes`                     |        9 |  42413 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions`                 |       60 | 252440 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a`                    |       11 |  20358 |
| `.hseos/runs/dev-squad/20261113-docs-reconcile`                       |        2 |   4295 |
| `.hseos/runs/standalone-migration`                                    |        3 |   8767 |
| `docs/audits`                                                         |        2 |  88411 |

Resumo por raiz:

| Raiz                               | Arquivos |      Bytes |
| ---------------------------------- | -------: | ---------: |
| `.hseos/runs/dev-squad`            |      140 |     465010 |
| `.hseos/runs/standalone-migration` |        3 |       8767 |
| `docs/audits`                      |        2 |      88411 |
| **Total**                          |  **145** | **562188** |

## Arquivos removidos

Classe `ANDAIME`: registro de run ou auditoria pontual sem citante fora do conjunto. A coluna de citantes conta os citantes históricos registrados pelo grafo; todos estão dentro do conjunto removido ou são não citantes declarados.

| Caminho                                                                                    | Classe  | Prova (`removable_by_graph` em ddde51e9 e 56478fa4) |  Citantes |
| ------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------- | --------: |
| `.hseos/runs/dev-squad/.current-run-id`                                                    | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-1900-state-w1-foundation/INTAKE.md`                        | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260425-1900-state-w1-foundation/PLAN.md`                          | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260425-1900-state-w1-foundation/RESUME-PROMPT.md`                 | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-1942-state-w7-kanban/INTAKE.md`                            | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-1942-state-w7-kanban/PLAN.md`                              | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260425-1942-state-w7-kanban/RESUME-PROMPT.md`                     | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-1942-state-w7-kanban/WAVE-7-REPORT.md`                     | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-1950-state-w2-cli-hooks/INTAKE.md`                         | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2010-state-w3-validation/INTAKE.md`                        | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2010-state-w3-validation/WAVE-3-REPORT.md`                 | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2124-state-w8-central-kanban/INTAKE.md`                    | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2124-state-w8-central-kanban/PLAN.md`                      | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260425-2124-state-w8-central-kanban/RESUME-PROMPT.md`             | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2124-state-w8-central-kanban/WAVE-8-REPORT.md`             | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2154-state-w4-mcp-cron/INTAKE.md`                          | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2154-state-w4-mcp-cron/PLAN.md`                            | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260425-2154-state-w4-mcp-cron/RESUME-PROMPT.md`                   | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2154-state-w4-mcp-cron/WAVE-4-REPORT.md`                   | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2216-state-w5a-skill-instrumentation/INTAKE.md`            | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260425-2216-state-w5a-skill-instrumentation/PLAN.md`              | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260425-2216-state-w5a-skill-instrumentation/RESUME-PROMPT.md`     | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2216-state-w5a-skill-instrumentation/WAVE-5a-REPORT.md`    | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2220-state-w5b-resume-purge/INTAKE.md`                     | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2220-state-w5b-resume-purge/PLAN.md`                       | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2220-state-w5b-resume-purge/RESUME-PROMPT.md`              | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2220-state-w5b-resume-purge/WAVE-5b-REPORT.md`             | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2224-state-w6-governance/INTAKE.md`                        | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2224-state-w6-governance/PLAN.md`                          | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2224-state-w6-governance/RESUME-PROMPT.md`                 | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260425-2224-state-w6-governance/WAVE-6-REPORT.md`                 | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260528-0900-ado-ops-module/INTAKE.md`                             | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260528-0900-ado-ops-module/PLAN.md`                               | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260528-0900-ado-ops-module/WAVE-1-REPORT.md`                      | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260528-0900-ado-ops-module/WAVE-2-REPORT.md`                      | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260528-0900-ado-ops-module/WAVE-3-REPORT.md`                      | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260528-0900-ado-ops-module/WAVE-4-REPORT.md`                      | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260603-0553-telemetry-swarm-coherence/INTAKE.md`                  | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260603-0553-telemetry-swarm-coherence/PLAN.md`                    | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260603-0553-telemetry-swarm-coherence/PR-BODY.md`                 | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260603-0553-telemetry-swarm-coherence/WAVE-1-REPORT.md`           | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260603-0553-telemetry-swarm-coherence/WAVE-2-REPORT.md`           | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260606-prod-ready-waves/PLAN.md`                                  | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260606-prod-ready-waves/WAVE-1-REPORT.md`                         | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260606-prod-ready-waves/WAVE-2-REPORT.md`                         | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20260606-prod-ready-waves/WAVE-3-REPORT.md`                         | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260606-prod-ready-waves/WAVE-4-REPORT.md`                         | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/dev-squad/20260606-prod-ready-waves/WAVE-5-READINESS.md`                      | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/dev-squad/20261001-0040-ecp-contract-authority/handoffs/W0-to-W1.md`          | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261001-0040-ecp-contract-authority/INTAKE.md`                     | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261001-0040-ecp-contract-authority/PLAN.md`                       | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261001-0040-ecp-contract-authority/prompts/W1-T0.md`              | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261001-0040-ecp-contract-authority/prompts/W1-T4a.md`             | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261001-0040-ecp-contract-authority/WAVE-0-REPORT.md`              | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261006-2040-pendencies-closeout/INTAKE.md`                        | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261006-2040-pendencies-closeout/PLAN.md`                          | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261007-2130-guard-tokenizer/GOAL-GRAPH.md`                        | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261007-2130-guard-tokenizer/workflow.js`                          | ANDAIME | sim / sim                                           |        33 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/INTAKE.md`                                | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T1.md`                             | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T2.md`                             | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T3.md`                             | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T4.md`                             | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T5.md`                             | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T6a.md`                            | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T6b.md`                            | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261027-1900-audit-fixes/logs/R-T7.md`                             | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/CLOSE.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/E10.md`                          | ANDAIME | sim / sim                                           |         4 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/E11.md`                          | ANDAIME | sim / sim                                           |         4 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/E12.md`                          | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/F1.md`                           | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/F2.md`                           | ANDAIME | sim / sim                                           |         4 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/F3.md`                           | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/G1.md`                           | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/G2.md`                           | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-D3.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-D4.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-D5.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-D6.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-D7.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-D8a.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-D8b.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E1.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E11.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E12.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E2.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E3.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E4.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E5.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E6.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E7.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E8.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-E9.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-F1.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-F2.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-F3.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-G1.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/R-G2.md`                         | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/logs/REAUDITORIA-W0-W5-2026-10-30.md` | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/PLAN.md`                              | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/CLOSE.md`                     | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/COMMON.md`                    | ANDAIME | sim / sim                                           |        25 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/D3.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/D4.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/D5.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/D6.md`                        | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/D7.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/D8a.md`                       | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/D8b.md`                       | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E1.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E10.md`                       | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E11.md`                       | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E12.md`                       | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E2.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E3.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E4.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E5.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E6.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E7.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E8.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/E9.md`                        | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/F1.md`                        | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/F2.md`                        | ANDAIME | sim / sim                                           |         4 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/F3.md`                        | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/G1.md`                        | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/G2.md`                        | ANDAIME | sim / sim                                           |         3 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/handoffs/T2-to-T4.md`                    | ANDAIME | sim / sim                                           |         2 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/INTAKE.md`                               | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/PLAN.md`                                 | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T1a.md`                          | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T1b.md`                          | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T1c.md`                          | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T1d.md`                          | ANDAIME | sim / sim                                           |         1 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T2.md`                           | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T3.md`                           | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T4.md`                           | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261106-1721-stab2-wave-a/prompts/T5.md`                           | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261113-docs-reconcile/prompts/audit-common.md`                    | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/dev-squad/20261113-docs-reconcile/prompts/fix-common.md`                      | ANDAIME | sim / sim                                           |         0 |
| `.hseos/runs/standalone-migration/handoffs/.gitkeep`                                       | ANDAIME | sim / sim                                           |         6 |
| `.hseos/runs/standalone-migration/README.md`                                               | ANDAIME | sim / sim                                           |         5 |
| `.hseos/runs/standalone-migration/STATUS.md`                                               | ANDAIME | sim / sim                                           |         6 |
| `docs/audits/2026-09-07-repository-consolidation/inventory.json`                           | ANDAIME | sim / sim                                           |         6 |
| `docs/audits/2026-09-07-repository-consolidation/README.md`                                | ANDAIME | sim / sim                                           |         6 |

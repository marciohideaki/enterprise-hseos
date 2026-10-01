# WAVE-0-REPORT — Governança e schemas (Commander/Opus)

Run: `20261001-0040-ecp-contract-authority`. Data: 2026-10-01. Status: **CONCLUÍDA e ACEITA pelo owner em 2026-10-01** (ver STATUS.md).

## Entregas

### ECP — `feature/contract-authority-w0` (base `develop`; local, sem push)
| Task | Commit | Merge | Conteúdo |
|---|---|---|---|
| 0042 | `10fd3ba` | `7ce8767` | intent `docs/intents/0042-contract-authority-governance.md` + Decision 0006 |
| 0042b | `c6e5768` | `835c42a` | Decision 0007 (Proposed; 0002/0003 seguem em vigor) |
| 0042c | `0b69f01` | `7f9995a` | Decision 0008 (autor configurável) |
| 0042d | `76a05fa` | `f80f8ce` | schemas v2: contrato, implementações, registro |
| 0042e | `b8bfb17` | `88d81cf` | correções da revisão, rodada 1 + fixture de 25 vetores |
| 0042f | `da65bf7` | `1bb67fb` | correções da revisão, rodada 3 (evidência de migração, registro `deprecated`) |

Quality gates do ECP (`bash scripts/governance/quality-gates.sh`: 187 testes, 1 skip, validação de contratos) verdes antes de cada commit.
Autor: `Hideaki Solutions Architect <architect@hideakisolutions.local>` (regra vigente; Decision 0008 ainda não implementada).

### HSEOS — `feature/platform-bindings-w0` (base `master`; local, sem push)
| Task | Commit | Conteúdo |
|---|---|---|
| w0-adr-0046 | `02204b14` | ADR-0046 + `_INDEX.md`; inventário do pacote 1458 → 1459 |
| w0-bindings-schema | `adb18afe` | `platform-bindings.schema.json`; inventário 1459 → 1460 |
| w0-review-corrections | `383cf032` | ADR-0046 §1/§3/§4/§5/§6 + schema (regras cruzadas) |
| w0-review-round3 | `8bbbb9be` | precedência `registry` × `workspace.ecp_root`; `snapshot` sem `path/uri/ref`; fixture de vetores |
| w0-run-dir | este commit | este run-dir |

Cada task: `worktree-manager.sh validate` (6 gates, suíte completa) + hook de pre-commit completo, verdes.

## Verificação

- Schemas ECP: Draft 2020-12 válidos; **26 vetores** com veredito idêntico em Python `jsonschema` 4.19.2 e Ajv 2020 strict.
- Schema de bindings HSEOS: **19 vetores** (6 válidos, 13 inválidos) com veredito idêntico nos dois motores.
- Inventário do pacote HSEOS: elevado só pelos 2 ativos de governança publicados, com justificativa no teste (padrão dos commits anteriores).

## Revisão cética isolada (§3h)
| Rodada | Resultado |
|---|---|
| 1 | 0 BLOCKER, 5 MAJOR, 6 MINOR; C5 refutado em parte (regressão em host com `jq` sem CLI) |
| 2 | 0 BLOCKER, 0 MAJOR; 9 resolvidos, 1 parcial, 1 aberto (MINOR) + 3 MINOR novos |
| 3 | correções dos MINOR aplicadas (ECP 0042f, HSEOS w0-review-round3) |
Limite de 3 rodadas de correção respeitado.

## Desvios e observações
- `TMPDIR` precisou apontar para `/build/hseos-tmp`: `/tmp` e `/build/tmp` têm `.codex` e quebram os testes ACP (gotcha conhecida).
- Os testes do ECP reescrevem `mcps/ecp.mcp.manifest.json` com caminhos absolutos; restaurado antes de cada commit (W1 T4 corrige).
- Branches `task/*` do ECP mantidas até o closeout da PR (`git branch -d` compara com `develop`).
- Regras que o schema não expressa de forma portátil (caminhos com `..`, datas de calendário) ficam para o validador da W1 — registradas em `handoffs/W0-to-W1.md`.

## Gate de saída (humano)
1. Aceitar, emendar ou rejeitar: ECP **0006**, **0008**; HSEOS **ADR-0046** (depende da 0006). ECP **0007** permanece Proposed até a Fase 2.
2. Autorizar push das duas branches de feature e abertura das PRs (W0 = 1 PR por repositório).
Nenhuma task da W1 começa antes do item 1.

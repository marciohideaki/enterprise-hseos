# STATUS — 20261001-0040-ecp-contract-authority

Atualizado: 2026-10-01. Wave atual: **W0 concluída e aceita** — W1 liberada.

## Branch map
| Repo | Base | Feature | Estado |
|---|---|---|---|
| ECP | `develop` | `feature/contract-authority-w0` | local, sem push |
| HSEOS | `master` | `feature/platform-bindings-w0` | local, sem push |

## W0 — tasks
| Task | Repo | Commit | Estado |
|---|---|---|---|
| E0.1 intent 0042 + Decision 0006 | ECP | `10fd3ba` (merge `7ce8767`) | OK |
| E0.2 Decision 0007 | ECP | `c6e5768` (merge `835c42a`) | OK |
| E0.3 Decision 0008 | ECP | `0b69f01` (merge `7f9995a`) | OK |
| E0.4 schemas v2 | ECP | `76a05fa` (merge `f80f8ce`) | OK |
| E0.5 correções da revisão (rodada 1) | ECP | merge `88d81cf` | OK |
| H0.1 ADR-0046 + índice | HSEOS | `02204b14` (merge `90791563`) | OK |
| H0.2 platform-bindings schema | HSEOS | `adb18afe` (merge `c6c59aa2`) | OK |
| H0.3 correções da revisão (rodada 1) | HSEOS | `383cf032` (merge `8ba3b2a7`) | OK |
| E0.6 correções rodada 3 | ECP | `da65bf7` (merge `1bb67fb`) | OK |
| H0.3b correções rodada 3 | HSEOS | `8bbbb9be` (merge `22e5efea`) | OK |
| H0.4 run-dir | HSEOS | este commit | OK |

## Revisão cética (§3h) — rodada 1
0 BLOCKER, 5 MAJOR, 6 MINOR. C5 refutado em parte (regressão em host com `jq` e sem CLI).
Correções: rodada 1 (E0.5, H0.3); rodada 2 sem MAJOR; rodada 3 fechou os MINOR (E0.6, H0.3b).

## Observações operacionais
- ECP: commits com a identidade da regra vigente (`architect@hideakisolutions.local`) via `GIT_CONFIG_*`,
  sem alterar a config do repositório, até a Decision 0008 ser aceita e implementada.
- ECP: os testes reescrevem `mcps/ecp.mcp.manifest.json` com caminhos absolutos; restaurado antes de cada
  commit (correção prevista em W1 T4).
- HSEOS: `TMPDIR=/build/hseos-tmp` (sem `.codex` em ancestrais); `/tmp` e `/build/tmp` têm `.codex`.
- HSEOS: limite de inventário do pacote elevado só pelos ativos de governança novos (ADR-0046, schema).

## Gate de saída da W0
Revisão rodada 2 sem MAJOR + **aceitação humana das ADRs** (ECP 0006/0007/0008, HSEOS ADR-0046).

## Decisão do gate W0 (owner, 2026-10-01)
- Aceitas: ECP Decisions 0006, 0007 e 0008; HSEOS ADR-0046. A 0007 é aceita com a migração executada na Fase 2.
- Autorizado: push, abertura das PRs e merge das duas PRs da W0 (ECP → `develop`, HSEOS → `master`), com checks verdes.
- ECP: `origin/develop` estava à frente do `develop` local (7 commits, sem colisão de numeração); integrado na feature por merge, gate verde.
- PR ECP: HideakiSolutions/enterprise-capability-platform#31.


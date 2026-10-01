# STATUS — 20261001-0040-ecp-contract-authority

Atualizado: 2026-10-01. Wave atual: **W2b e W3 mergeadas** (2026-10-01) — W0, W1, W2a/b/c e W3 concluídas; Fase 2 (migração em massa) depende de plano próprio e de autorização.

## Branch map
| Repo | Base | Feature | Estado |
|---|---|---|---|
| ECP | `develop` | `feature/contract-authority-w0` | local, sem push |
| HSEOS | `master` | `feature/platform-bindings-w2b` (W2b-1..6 + rodada 1 de correção) | PR #186 mergeada em `master` (`b09ee770`); branch removida |
| backend-core | `develop` | `feature/ecp-contracts-w3` | PR #21 mergeada em `develop` (`409d243`) |

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


## W1 — ECP foundation (2026-10-01)
| Task | Commit | Revisão | Estado |
|---|---|---|---|
| T0 loader YAML restrito | `d53a040` | 2 rodadas (2 MAJOR corrigidos) | merge `b871788` |
| T1a perfil de keywords (validador stdlib) | `67478ba` | 2 rodadas; diferencial ~38k casos, 0 divergência | merge `e94ea2c` |
| T1b validador v2 + migração dos 9 contratos | `28ccd03` | 3 rodadas (~100 mutações) | merge `279db62` |
| T3 gate de compatibilidade | `0efe86e` | 3 rodadas (1 BLOCKER: $ref em oneOf) | merge `4fd01e4` |
| T2 registro + CI | `94d0b81` | 2 rodadas | merge `9a08d37` |
| T5 vetores + bundle reprodutível | `94628f6` | 1 rodada, 4 MINOR documentados | merge `981f445` |
| T4a autor configurável (PR #32) | `5d63f01` | 2 rodadas | merge `3fc9483` |
| T4b portabilidade (PR #32) | `eb2b4ca` | 2 rodadas | merge em `feature/ecp-portability-author` |

Integração `feature/contract-authority-w1`: 381 testes OK, registro em dia, `check_compat --base develop` OK, bundle reprodutível.
PR #32 (T4) verde e aguardando autorização de merge. Conflitos previstos W1 × #32: `validate_contracts.py`, `mcps/ecp.mcp.manifest.json` (regenerar).
Decisões registradas na W1: pacotes `planned` inventados removidos; remoção de capability falha salvo `deprecated` com sunset vencido;
perfil restringe `enum/const` a escalares e `$id/$schema` à raiz; publish do bundle imutável (sem `--clobber`); registro descreve o repo e o bundle é subconjunto;
`expected_keyword` nos vetores inválidos fica para W2. Pendente do owner: revisores obrigatórios no environment `contracts-release`.
Pendências fora do escopo: `.agents/*` e `.axon/config.toml` do ECP ainda apontam `/opt/hideakisolutions`; repos da org que usam `make` no CI.

## W1 — merged (2026-10-01)
ECP #32 (autor configurável + portabilidade) e #33 (validador v2, registro, gate de compatibilidade, bundle) mergeadas em `develop`; tag `contracts-v0.2.0`.
Infra: scale set `arc-runners/hideaki-k3s` migrado para `actions-runner:2.337.0` (Helm rev 9) — CI da org voltou a rodar.
CI expôs dependência de versão do Python no perfil de regex → T1c: gramática permitida (allowlist) + `$`→`\Z`; suítes verdes em 3.12 e 3.14.

## W2 — estado
| Frente | Repo | Estado |
|---|---|---|
| W2a pilotos library (cache.typed, security.authn, messaging.event-envelope) | ECP | #34 mergeada; tag `contracts-v0.3.0` |
| W2b platform-bindings | HSEOS | W2b-1..6 concluídas em `feature/platform-bindings-w2b`: loader, registro, capability-check, wiring CLI, guard, snapshot ECP `contracts-v0.3.1`, policies/docs, ADR-0046 §8 (esclarecimentos) e CHANGELOG. PR #186 **mergeada** (`b09ee770`); revisão cética aprovada com MINOR (rodada 1 corrigida); limite de inventário 1468→1472 aprovado pelo owner |
| W2c resolvedores vendorizados fail-closed (4 stacks) | backend-core | #20 mergeada |

## W3 — estado
| Frente | Repo | Estado |
|---|---|---|
| hints de descoberta | ECP | #35 mergeada; tag `contracts-v0.3.1` |
| stubs de deprecação dos pilotos | platform-core | #12 mergeada |
| vendor 0.3.0 + conformidade dos pilotos (.NET, Node, Python, Go) | backend-core | `feature/ecp-contracts-w3`; paridade 45/45 vetores em todas as stacks |
| correções classe A/B (.NET 0.3.0; Node/Python 0.2.0; Go v0.2.0 documentado) | backend-core | commitadas |
| ponteiros ECP + carimbo de versão de contrato + checker | backend-core | commitado |
| stub auth-middleware + resync snapshot platform-core | backend-core | commitado |
| correção da corrida do JsonSchema.Net (lock global de avaliação) + hop limit fail-closed | backend-core | revisão cética aprovada com MINOR; PR #21 mergeada (`409d243`) |

Lacunas documentadas em `backend-core/docs/contracts/conformance-gaps.md` (classes C/D); candidato de evolução de contrato: `token_type` case-insensitive na entrada.
Pendências do owner: revisores obrigatórios no environment `contracts-release` (ECP); `validate` como check obrigatório no backend-core.

## Decisões do owner (2026-10-01, pós-merge)
- ADR-0046 (esclarecimentos §3/§8 editados no lugar): **aprovada**.
- Limite de inventário do pacote 1468→1472 (4 espelhos do compilador): **aprovado**.
- Follow-ups backend-core: MINOR-2 (`$defs` em sub-schema de `LoadAt`), MINOR-3 (`FromText` fora do gate), avaliar JsonSchema.Net 9.x, vendor `contracts-v0.3.1`, `validate` obrigatório na branch protection.

## Fechamento de escopo da W3 (owner, 2026-10-01)
- A W3 fecha com o backend-core (#21), o ECP (#35, `contracts-v0.3.1`) e o platform-core (#12).
- **frontend-core e mobile-core não participam da W3.** Os pilotos (`cache.typed`, `security.authn`, `messaging.event-envelope`) são capacidades de backend e esses cores não implementam nenhuma; verificado em 2026-10-01: sem branch nem PR ECP em ambos, e os ponteiros existentes (`platformCapability` nos `ui-react-*` e `ds-tokens`, `.platform-capability.json` do `mobile-tokens`) apontam para ids do `design-system-core`. Esses ponteiros seguem na Fase 2 (design system).
- `implementations.json` dos pilotos (ECP, `develop` `394e80d`): verificado que o `contract_version` (0.1.0) já bate com o carimbo do backend-core em todas as stacks (`.csproj`, `golang/*`, `node/package.json`, `PLATFORM_CONTRACTS` do Python) e com `version: 0.1.0` das capabilities; nada a alinhar. Os 6 avisos do `contracts:pointers` do backend-core são de `package_version` (código 0.3.0/0.2.0 contra 0.2.1/0.1.0 no registro, que lista versões publicadas): só mudam após publicar os pacotes, com autorização.

## W2b — limitações conhecidas
- Aliases `Login`/`Authn` ausentes no registro `contracts-v0.3.1`: pedir ao ECP.
- Job de drift snapshot × ref do ECP (previsto no PLAN, W2b item 8) ainda não existe.
- Ruído de formatação do compile em `.claude-plugin/marketplace.json` e `.codex-plugin/plugin.json`: o gerador não emite `\n` final
  (`plugins-emit.js:115,121`); a saída não é commitada.
- Espelho em `.agents/capabilities/` (4 arquivos) é efeito do compilador; limite de inventário do pacote em 1472 por decisão do owner.

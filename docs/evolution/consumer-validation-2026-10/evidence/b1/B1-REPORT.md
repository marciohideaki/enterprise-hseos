# B1 - Harness HSEOS 4.0.0-rc.0 sobre cambio-real-platforms (CRP)

Harness: master e079409c, pacote /tmp/hseos-crp/pack/hseos-4.0.0-rc.0.tgz (sha256 fcb81c1a... confere), instalado em prefixo separado /tmp/hseos-crp/b1/hseos. Consumidor: clone descartavel /tmp/hseos-crp/b1/repo (develop 8fe5747, remote removido). O repositorio real nao foi tocado: inventario de arquivos (path, tamanho, mtime) identico antes/depois; nenhum processo residual.

Premissa do clone: `.hseos/` e `.axon/` sao gitignored no CRP e nao vem no clone; foram copiados com `cp -a` do repo real (leitura). Os 4 arquivos `docs/goals/*` nao rastreados da outra sessao nao entram no clone.

## Passos

| # | Passo | Resultado | Evidencia |
|---|---|---|---|
| 1a | `--version`, `status` | PASS | 4.0.0-rc.0; status sem manifesto antes do install (esperado) |
| 1b | `install-plan` (sem --directory) | PASS | plano developer, 11 componentes |
| 1c | `install-plan --directory <clone>` | FAIL | "Unsupported capability profiles schema: missing (expected 2.0)" (F8) |
| 1d | `install` sem TTY e sem flags | PASS | fail-fast exit 1: "Cannot prompt for the installation directory: stdin is not a terminal" |
| 1e | `install --directory . --tools none --yes` sobre adocao existente (.hseos com runs/state) | FAIL | "Legacy HSEOS v4 detected", `--yes` escolhe "exit", exit 0, nada instalado (F1) |
| 1f | mesmo install apos mover `.hseos` de lado | PASS c/ ressalvas | +921 arquivos nao rastreados (.agents 173, .enterprise 446, .hseos +300, .claude-plugin 1, .codex-plugin 1); 0 arquivos rastreados alterados; AGENTS.md e repository-contract.yaml intactos; runs/state restaurados por merge manual e `hseos status` OK (F7) |
| 1g | reinstall/upgrade sobre instalacao 4.0.0-rc.0 valida | FAIL | "LEGACY INSTALLATION DETECTED", `--yes` cancela, exit 0 (F1), tambem com `--action update` |
| 2a | `governance-context` | PASS | capsula minima, G = pacote instalado |
| 2b | `capability-check "formatacao monetaria"` | PASS fraco | "no platform capability matches", 0 candidatos (F5, F6) |
| 2c | validacao de `repository-contract.yaml` | PASS (sem CLI) | nao ha subcomando; so `scripts/governance/validate-repository-contract.js` no pacote (nao e copiado ao consumidor). Contrato do CRP: OK. Contrato invalido sintetico: 5 FAIL corretos, exit 1 |
| 2d | `sandbox engineering-check --json` | FAIL/BLOCKED | `workspace_write_confirmed:false` (node e python), exit 2; reproduz no repo do harness; `sandbox doctor` PASS (F9) |
| 2e | `plugin doctor` / `plugin list` | PASS vazio | 4 plugins inativos, "behavior checks skipped": nada verificado |
| 2f | `compatibility-audit` | PASS | blocked-on-evidence (120 lacunas horarias; evidencias `harness-g9-*.json` ausentes no consumidor): resultado do harness, nao do CRP |
| 2g | `compatibility-evidence-inventory` | NOT_EXERCISED | exige manifesto git de downstreams (operacao de mantenedor) |
| 2h | `agent-core doctor` / `verify` | PASS | 9/9 e 81/81 |
| 3 | Guard lexico sobre o corpus real | PASS com achados | ver numeros (F2 a F5) |
| 4a | MCP governance (`query_constitution`, `check_authority`, `validate_adr`) | PASS | cwd=clone; constitution vem do pacote |
| 4b | MCP swarm `list_runs` / `plan_squad` / `get_run_state` | PASS | lista os 4 runs existentes; plan_squad escreve so em `<clone>/.hseos/runs/dev-squad/<id>` (F10 sobre outro arquivo) |
| 4c | MCP project-state com `HSEOS_STATE_DB` temp | PASS | write/read/tasks ok; `project.db` do clone intacto |
| 4d | MCP axon-bridge stdio, axon 1.7.0 | PASS | `get_overview`, `code_search` (achou `formatMoney` em packages/formatting/src/index.ts e DataTable), `get_skeleton`; path fora do escopo nao vaza |
| 5 | Higiene | PASS | repo real inalterado; zero processos do teste restantes |

## Numeros do guard (entrada: `evaluateGuard` de tools/cli/lib/capability-intake-guard.js, a mesma do `hseos platform-bindings guard`; 3 repos scratch committados com modos platform/hybrid/local)

- Corpus: 581 arquivos JS/TS/TSX rastreados (apps 312, packages 248, e2e 12, scripts 3, infra 3, outros 3). Lidos 581, ilegiveis 0, excecoes do detector 0. Tempo total 8,9 s para 3 modos; por arquivo p50 8 ms, p95 45 ms, max 66 ms (CLI isolado em arquivo grande: 83 ms, longe do timeout de 4 s do hook).
- Com export detectado: 366. Observados pelo guard (WATCHED e nao excluidos): 124, todos em `packages/`.
- Negacoes: platform 124/124, hybrid 0, local 0.
- `incomplete`: 0. A amostra de 10 `incomplete` nao existe neste corpus. Alternativa: classifiquei as 16 saidas `anonymous`: 13 `export default` genuinos, 3 listas `export { local }` (packages/auth/src/index.tsx `export { useAuth }`, packages/domain-ui/src/corridor-selector.tsx `export { ArrowRightLeft as CorridorIcon }`, design-reference/support.js falso positivo lexico em string/comentario). Nenhum erro de leitura real.
- Verdade-base (AST do TypeScript do repo do harness) contra o scanner: 1310 exports nomeados; 1 perdido (`useAuth` em `export { useAuth }`); 9 arquivos so com re-export (`export {..} from`) com resultado nulo, inclusive 4 barrels `packages/{api-client,domain,domain-ui,ui}/src/index.ts` (207/130/56/138 nomes); 2 falsos positivos lexicos, ambos fora do escopo observado.

## Achados do harness

| ID | Sev | Achado | Reproducao minima | Onde (harness) |
|---|---|---|---|---|
| F1 | ALTA | Qualquer `.hseos/` existente e tratado como legado, inclusive instalacao 4.0.0-rc.0 recem-feita. Sem TTY, `--yes` escolhe "exit/cancel" e sai com **exit 0** sem instalar; a orientacao e apagar `.hseos` (destruiria runs/state). Reinstall/upgrade nao e alcancavel de forma nao interativa; falso sucesso. | Consumidor com `.hseos/{runs,state}` e `hseos install --directory . --tools none --yes` (exit 0, 0 arquivos). Apos instalar com sucesso, repetir o comando: "LEGACY INSTALLATION DETECTED", exit 0. | tools/cli/lib/ui.js:72-74, 89, 113, 150; tools/cli/installers/lib/core/detector.js:223-250 (243: `.hseos` sem `_config` vira legado); installer.js:3292 (`default: 'exit'`) |
| F2 | MEDIA | O guard nao observa `apps/*`: WATCHED_FILE cobre so `*/applications/*/src/*`, `*/packages/*`, `*/src/Services/*`. No CRP, 312 arquivos / 205 com export (apps/*), alem de e2e, scripts, infra, ficam invisiveis. Pode ser intencional (shared-first), mas nao esta documentado como limite. | `evaluateGuard` com `apps/plataforma/src/x.ts` exportando algo: allowance sem contexto | tools/cli/lib/capability-intake-guard.js:19 |
| F3 | MEDIA | Deteccao de stack so produz `node` (package.json). O registry usa `typescript`/`react`/`react-native`. Resultado: `capability-check login` sugere "extend (implement the contract for node in the owning core)" para `design.login-pattern`, que ja tem implementacao react; "design tokens" idem. Alem disso 0 das 40 implementacoes do registry snapshot sao `stable` (39 experimental, 1 planned): em hybrid o guard nunca nega em codigo real, e em platform nega 100% dos arquivos observados, sem sinal discriminante. | `hseos capability-check login` no clone; script do registry | tools/cli/lib/platform-bindings.js:34 (STACK_ROOTS), :504 (stackFor) |
| F4 | MEDIA | O `CORE_INTAKE_ACK` so aceita token em `docs/decisions/*intake*.md`; os registros de intake do proprio CRP (`docs/decisions/intake/*.json`, `request_id` `cambio-real-platforms/intake/...`) nao servem. Ack positivo funciona (verificado com token em .md), mas a adocao existente nao e aproveitada. | `CORE_INTAKE_ACK=cambio-real-platforms/intake/2026-09-01-data-table-promote` -> exit 2 | capability-intake-guard.js `validAck`/`overrideRefResolves` |
| F5 | BAIXA | Re-exports (`export {..} from`, barrels) sao apagados de proposito (`blankReexports`) e `export { local }` vira anonimo sem nome; a API publica dos pacotes e invisivel e, em hybrid, `export { useAuth }` nao e comparado por simbolo com o registry. | `export { useAuth }` -> `symbols:[]`, `anonymous:true` | capability-intake-guard.js:1380-1475 |
| F6 | BAIXA | `capability-check`: candidatos de filesystem usam substring do nome de arquivo com a consulta inteira. Consulta de varias palavras ou em portugues nunca acha nada ("money formatting", "formatacao monetaria", embora existam `catalog-money.tsx` e `packages/formatting`); `money` sozinho acha. Sem aviso. SKIP nao inclui `.worktrees`. | `capability-check "money formatting"` vs `capability-check money` | tools/cli/commands/capability-check.js:15, 77 |
| F7 | BAIXA | `install --tools none` ainda grava `.claude-plugin/` e `.codex-plugin/`. O pre-commit instalado chama `scripts/governance/quality-gates.sh`, que nao e entregue ao consumidor: imprime "not found - skipping" enquanto o resumo diz "governance quality gate wired" (gate inerte). `--no-git-hooks` e o padrao do mcp-journey. | `ls .claude-plugin .codex-plugin`; `.git/hooks/pre-commit` | installer.js:3800 |
| F8 | BAIXA | `install-plan --directory` seleciona o repositorio do catalogo (o projeto e o cwd), contra o `--help` ("Repository directory to inspect"); apontar para um consumidor da erro criptico de schema. | `hseos install-plan --directory <consumidor>` | tools/cli/commands/install-plan.js:164 |
| F9 | MEDIA (host) | `sandbox engineering-check` bloqueia por `workspace_write_confirmed:false`, mesmo com `sandbox doctor` PASS e a sonda lockdown passando; o relatorio nao informa a causa (`observation.write` nao e exposto). Reproduz fora do consumidor. Nao classificavel como defeito do harness vs. host sem mais diagnostico. | `hseos sandbox engineering-check --json` | tools/cli/lib/engineering-sandbox-check.js:101-148 |
| F10 | BAIXA | Toda chamada MCP (inclusive leitura: `list_runs`, `get_overview`, `check_authority`) regrava `<cwd>/.hseos/state/mcp-legacy-usage.db`, mesmo com `HSEOS_STATE_DB` definido. Cai no tema de compatibilidade legada ja conhecido, mas contradiz "plan_squad escreve so em .hseos/runs". | mtime do db muda a cada chamada | tools/lib/compatibility-audit.js, native-mcp-server.js (referencias a `mcp-legacy-usage`) |

Pendencias conhecidas do STATUS.md: nenhuma reproduzida de forma direta (loop-guard/node_modules e riscos do swarm nao foram exercitados).

## Util vs. ruido
Util: fail-fast sem TTY, governance-context, validador de contrato (mensagens claras), MCP stdio completo no projeto, axon-bridge real, `agent-core doctor/verify`. Ruido ou falso positivo: F1 (bloqueia o proprio fluxo de upgrade), F3 (verdict "extend ... node" errado), `plugin doctor` (nada verificado), guard em platform (nega tudo).

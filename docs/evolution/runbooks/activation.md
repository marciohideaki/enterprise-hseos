# Runbook F3 — ativação pós-G6 (W8)

Status: **preparação (W7). Nada deste documento foi executado.** Cada passo da seção 3 em diante **exige autorização própria do owner**, dada com o commit final identificado; autorização de um passo não vale para o seguinte. Valem só sobre a `master` final já mergeada (G6).

Fontes da decisão: ativação autorizada pelo owner em 2026-10-13 (vault `_knowledge/projects/enterprise-hseos/decisions/2026-10-13-ativacao-da-w5-liveness-coordenacao-hooks-codex-store-pnpm-au.md`: "Hooks, timer e contratos rodam depois do merge da W5 (G6) e da atualização da distribuição global, já que o runtime global (2b4d6f37) não tem `hseos liveness` nem `hseos activity`"), `docs/evolution/w5/STATUS.md:119` (ativação fora de escopo da W5) e `:321` (plugins `scaffolded`, migration 017 pendente, merge/publicação/instalação/ativação como decisões separadas).

## 1. Estado de partida (verificado em 2026-10-20, somente leitura)

| Item                                          | Valor                                                                                                                                               | Fonte                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Distribuição global vigente                   | `2b4d6f37caf748947cca8195f16b8534b5c8ab9e`, `4.0.0-rc.0`, tarball sha256 `3d130c8b…2942`, 1458 entradas                                             | `~/.local/state/hseos/distributions/2b4d6f37…/verification.json` |
| Diretório imutável de release                 | `/workspace/local/tooling/hseos-releases/<sha>` (tree extraída com `node_modules`)                                                                  | idem, `global_hooks_distribution`                                |
| CLI global                                    | `/workspace/local/sdk/nvm/versions/node/v24.15.0/lib/node_modules/hseos`                                                                            | idem, `global_cli_path`                                          |
| Hooks Codex                                   | `~/.codex/hooks.json` + `[hooks.state."<hooks.json>:<evento>:<g>:<i>"] trusted_hash` em `~/.codex/config.toml` (secção `[hooks.state]`, linha ~226) | `~/.codex/config.toml`                                           |
| MCPs Codex                                    | `hseos-governance`, `hseos-state-tracking`, `hseos-swarm` apontando para o release `2b4d6f37…`                                                      | `~/.codex/config.toml:173-196`                                   |
| Rollback anterior                             | pacote anterior + `host-backup/` (`.claude`, `.codex`)                                                                                              | verification.json `rollback`                                     |
| `hseos liveness` / `hseos activity` no global | **ausentes** (existem na W5, não no pin)                                                                                                            | decisão de 2026-10-13                                            |
| Timer systemd do watchdog                     | nenhum `hseos` listado em `systemctl --user list-timers`                                                                                            | consulta de 2026-10-20                                           |
| Store pnpm no controlador                     | **já configurado** (inerte até o código entrar): `/workspace/.pnpm-store` em `~/.config/hseos/config.yaml` (`toolchain.pnpm_store_dirs`)            | `~/.config/hseos/config.yaml:5-7`                                |
| Contratos                                     | `enabled: false` em `.hseos/config/agent-liveness.yaml` e `.hseos/config/activity-coordination.yaml` (padrão do repositório)                        | arquivos do repositório                                          |

Risco do wrapper, **não corrigido aqui**: o wrapper `~/.local/bin/hseos` escolhe a maior versão do `nvm` (`sort -V`) e executa `<bin>/hseos`. Se um Node maior que o da instalação (`v24.15.0`) for instalado sem o pacote, o `hseos` global quebra com "No such file" (incidente de 2026-10-20, com um `v24.22.0` já removido). Hoje o maior Node é `v24.15.0`, então funciona; a ativação deve **fixar a versão do release** (PATH do `v24.15.0/bin`) em vez de ordenar o `nvm`. Por isso os comandos abaixo prefixam `PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH`. O `better-sqlite3` do pacote foi compilado para o ABI do Node 24.15; outro Node causa `ERR_DLOPEN_FAILED` (comentário do próprio wrapper).

Convenções: `SHA` = commit final da master (a ser fixado); `DIST=~/.local/state/hseos/distributions/$SHA`; `REL=/workspace/local/tooling/hseos-releases/$SHA`; `P=PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH`. Scratch em `$TMPDIR` (`/build/tmp`), nunca em `/tmp` literal. Segredos: este runbook não os manuseia.

## 2. Pré-condições gerais (todos os passos)

1. G6 aprovado; PRs da W5 e da W6/W7 (docs) mergeados; `git -C <repo> rev-parse origin/master` = `SHA`; árvore limpa; autorização do owner citando o `SHA`.
2. Gates verdes no `SHA` (`VALIDATION_ENFORCED=true bash scripts/governance/quality-gates.sh --phase ci`); o `npm pack --dry-run --json` dentro do inventário (G3).
3. `uptime` e `heavy-run --check` antes de qualquer job pesado; um por vez (global §3f). Nenhuma sessão de dev-squad ativa escrevendo em `~/.codex` ou `~/.claude` durante os passos 1 e 2.
4. Backup **antes** de cada passo (seção de cada passo) e registro no receipt do passo.

## 3. Passo 1 — distribuição global do commit final

**Exige autorização própria do owner.** Procedimento reaproveitado das distribuições anteriores (`d62187c4…`, `e709368e…`, `6402726d…`, `a305a899…`, `2b4d6f37…`): tarball do commit, release imutável, instalação do CLI no prefixo do Node 24.15, receipt com rollback. O `ROLLBACK.md` de `6402726d…` define o rollback pela reinstalação do tarball anterior; os recibos **não gravam os comandos exatos de extração**, então o executor registra os comandos usados no receipt (desvio explícito, não inventado).

Pré-condições: seção 2; `$DIST` e `$REL` ainda não existem; `previous` = `2b4d6f37…` (tarball e `host-backup/` preservados).

Comandos (formato a confirmar contra o procedimento anterior antes de executar):

```bash
P=PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH
mkdir -p "$DIST"
# 1. tarball do commit (checkout limpo em $SHA, Node 24 do npm)
env $P npm pack --pack-destination "$DIST" --json > "$DIST/pack.json"
sha256sum "$DIST"/hseos-*.tgz | tee "$DIST/package.sha256"
# 2. backup da configuração do host (antes de tocar em qualquer coisa)
mkdir -p "$DIST/host-backup/.claude" "$DIST/host-backup/.codex"
cp -a ~/.codex/config.toml ~/.codex/hooks.json "$DIST/host-backup/.codex/"
cp -a ~/.claude/settings.json ~/.claude/AGENTS.md ~/.claude/CHANGELOG.md "$DIST/host-backup/.claude/"
# 3. release imutável + instalação global no prefixo do Node 24.15
#    (extrair o tarball para $REL, instalar dependências nativas com o Node 24.15;
#     env $P npm install -g "$DIST"/hseos-*.tgz)
```

Verificação (todas precisam passar; cada falha é BLOCKED, nunca PASS):

```bash
env $P hseos --version                       # 4.0.0-rc.0 (a versão não muda entre commits: NÃO identifica o commit)
readlink -f "$(env $P which hseos)"          # aponta para .../v24.15.0/lib/node_modules/hseos
env $P hseos liveness --help                 # existe (o pin 2b4d6f37 não tem)
env $P hseos activity --help                 # existe
env $P hseos governance-context --directory "$TMPDIR" --json   # capsule resolve
env $P hseos init --help
# smoke de MCP que PROVA tools/list: o cliente MCP existente do repositório, contra o pacote instalado
#   (test/journeys/mcp-journey.mjs, 4 servidores em stdio e HTTP; descrição em test/journeys/README.md)
#   node test/journeys/mcp-journey.mjs --prefix <consumidor com o tarball instalado> --tgz "$DIST"/hseos-*.tgz --out "$TMPDIR/mcp"
#   conferir mcp-journey-result.json: todos os passos PASS (axon real pode ser NOT_EXERCISED sem axon no PATH)
#   contagens esperadas (receipt 6402726d, reconferir na W5): hseos-governance 15, hseos-project-state 15, hseos-swarm 5
#   Nome do servidor: o receipt chama de `hseos-project-state` o servidor que o Codex registra como
#   `hseos-state-tracking` (~/.codex/config.toml:180); é o mesmo servidor (tools/mcp-project-state/index.js).
#   Sem rodar o journey, `node "$REL/tools/mcp-hseos-governance/index.js" </dev/null` só prova que o módulo carrega, não tools/list.
sha256sum "$DIST"/hseos-*.tgz                # igual ao receipt
```

Receipt: `$DIST/verification.json` com os campos do anterior (`source_commit`, `checked_at_utc` via `date -u`, `scope`, `owner_authorization`, `risk`, `package{version,path,sha256,entry_count}`, `validation{…}`, `host_config_sha256`, `rollback{previous_package,previous_package_sha256,global_config_backup}`, `public_registry_publication: "not_performed"`, `governed_execution_operational_activation: "not_performed"`, `session_reload_note`).

Rollback (testável): reinstalar o tarball de `2b4d6f37…` com o prefixo do Node 24.15, restaurar `host-backup/` (comparar hashes e restaurar **somente** o que este passo mudou, preservando edições posteriores), repetir a verificação da distribuição anterior (`hseos --version`, `governance-context`, `codex mcp list`, trust dos hooks). Testar em prefixo descartável (`npm install --prefix "$TMPDIR/rb" <tarball anterior>`) **antes** de declarar o passo concluído. Não restaurar bancos SQLite automaticamente (ROLLBACK.md).

Riscos: sessões Claude/Codex já abertas mantêm as conexões MCP anteriores (`session_reload_note`); reabrir sessões após o passo. O release imutável é referenciado pelos hooks e MCPs: não apagar `$REL` nem os releases anteriores até a W9 e só com autorização.

## 4. Passo 2 — hooks Codex com `trusted_hash`

**Exige autorização própria do owner.** Depende do passo 1. A guarda "no silent idle" no Codex 0.162.1 usa `Stop` (`stop_hook_active`) e `UserPromptSubmit` com `additionalContext` (spike CO0, `docs/evolution/w5/evidence/w5-co0/spike.md`; paridade no SKILL dev-squad, "Liveness parity", `.agents/skills/dev-squad/SKILL.md:234-256`). Instalação: template `docs/activity-coordination/codex-hooks.template.json` e `docs/activity-coordination/README.md:11-19`.

Pré-condições: passo 1 verificado; `codex --version` = 0.162.1 (ou revalidar o spike para a versão em uso); backup de `~/.codex/{hooks.json,config.toml}` feito no passo 1 e refeito agora (`cp -a … "$DIST/host-backup/.codex/pre-step2/"`); nenhuma sessão Codex em andamento.

Comandos:

1. Copiar o template e substituir `{{HSEOS_REPO}}` pelo **release imutável** `$REL` (não pelo checkout de dev, que pode ser removido na W9); mesclar o objeto `hooks` em `~/.codex/hooks.json` **preservando as entradas existentes** (second-brain, governance-context).
2. Atualizar também os comandos do `governance-context` que apontam para `…/hseos-releases/2b4d6f37…` se o passo 1 os trocou; cada comando alterado muda o hash.
3. Confiar os hooks por uma das vias do README: (a) obter o hash de cada hook via `hooks/list` do `codex app-server` e gravar `[hooks.state."<hooks.json>:<evento>:<grupo>:<idx>"] trusted_hash = "sha256:…"` em `~/.codex/config.toml`; ou (b) confiar no TUI. O hash muda a **cada edição** de hook: repetir se o template mudar. Os recibos anteriores guardam a evidência em `codex-hooks-trusted.json` (4 hooks confiados em `6402726d…`).
4. Projetos sem `tools/cli` vendorizado: exportar `HSEOS_CLI_PATH` (CLI do próprio usuário, não gravável por grupo/outros; `docs/activity-coordination/README.md:18`, A1 aceito em `docs/evolution/w5/STATUS.md:115`).
5. `codex exec` fica bloqueado sem stdin: usar `</dev/null`.

Verificação:

```bash
codex exec --skip-git-repo-check "responda OK" </dev/null     # sessão nova dispara SessionStart/UserPromptSubmit/Stop
# via app-server: hooks/list mostra trustStatus "trusted" para TODOS os hooks da seção, hash == currentHash
sha256sum ~/.codex/hooks.json ~/.codex/config.toml            # registrar no receipt
```

Verificado na W5/CO0 só em `codex exec`; **NÃO VERIFICADOS**: `SubagentStart/Stop`, `PreCompact`, `Interrupt`, sessão interativa, e o caso `permission_mode: bypassPermissions` sob `exec -s read-only` (`docs/activity-coordination/README.md:23`; `docs/evolution/w5/evidence/w5-co2/receipt.json:not_verified`). A forma `HSEOS_AGENT_TOOL=codex bash <handler>` também não foi exercitada no Codex real: este passo é o primeiro uso real e o resultado fica no receipt.

Receipt: `$DIST/step2-codex-hooks.json` com hash antes/depois de `hooks.json` e `config.toml`, lista dos hooks e `trustStatus`, versão do Codex.

Rollback: restaurar `~/.codex/hooks.json` e `~/.codex/config.toml` do backup `pre-step2` (os `trusted_hash` voltam junto), repetir `hooks/list` e confirmar que os hooks pré-existentes seguem `trusted`. Testar a restauração comparando hashes contra o backup.

## 5. Passo 3 — timer systemd do watchdog

**Exige autorização própria do owner.** Depende do passo 1 (o CLI global precisa conter `hseos liveness`). O timer é `systemd --user` e só gera efeito em projeto com `enabled: true` (passo 4): sem contrato, nada roda.

Pré-condições: passo 1 verificado; decidir o `--directory` (um timer por projeto vigiado; proposta: o repositório HSEOS primeiro); `loginctl show-user "$USER" -p Linger` informado ao owner (sem _linger_ o timer só roda em sessão aberta).

Comandos. Imprimir os units **a partir do release instalado**, não do checkout de dev: o unit grava caminhos absolutos do `WorkingDirectory` e de `tools/cli/hseos-cli.js`; impresso do worktree, ele apontaria para um diretório que a W9 remove (conferido: a saída embute o caminho de onde o comando rodou).

```bash
cd "$REL" && env $P node tools/cli/hseos-cli.js liveness watch --print-systemd \
  --directory <projeto> > "$TMPDIR/hseos-liveness-units.txt"      # revisar antes de instalar
# separar nos dois arquivos (os dois blocos vêm com cabeçalho "# --- <nome> ---"):
#   ~/.config/systemd/user/hseos-liveness-watch.service
#   ~/.config/systemd/user/hseos-liveness-watch.timer
systemd-analyze --user verify ~/.config/systemd/user/hseos-liveness-watch.{service,timer}
systemctl --user daemon-reload
systemctl --user enable --now hseos-liveness-watch.timer
```

Verificação: `systemctl --user list-timers | grep hseos` (próxima execução em até 120 s); `systemctl --user start hseos-liveness-watch.service && journalctl --user -u hseos-liveness-watch.service -n 20` (um ciclo, exit 0); `env $P hseos liveness check --json --directory <projeto>`; `<projeto>/.hseos/state/liveness/` com os arquivos do watchdog (nome do diretório vem de `LIVENESS_DIR_PARTS`, `tools/lib/agent-liveness.js:45`). Intervalo `OnUnitActiveSec=120s`, `Nice=10`, `DBUS_SESSION_BUS_ADDRESS` fixado no unit.

Não verificados na W5 (resíduo LV2, `docs/evolution/w5/STATUS.md:112`): systemd real, `notify-send` e sessões reais; escalonamento falha com aviso, e `escalations.jsonl` é o registro durável (`tools/lib/agent-liveness.js:871`). Este passo é a primeira verificação real; registrar o resultado.

Receipt: `$DIST/step3-liveness-timer.json` (units instalados com sha256, saída de `list-timers`, um ciclo do serviço com exit code, UID, linger).

Rollback: `systemctl --user disable --now hseos-liveness-watch.timer`, `rm ~/.config/systemd/user/hseos-liveness-watch.{service,timer}`, `systemctl --user daemon-reload`, `systemctl --user list-timers | grep -c hseos` = 0. O estado em `.hseos/state/liveness/` permanece (auditoria).

## 6. Passo 4 — contratos ligados nos projetos, um por vez

**Exige autorização própria do owner, por projeto.** Depende dos passos 1 a 3 verificados. Ligar um projeto, observar um ciclo completo, só então o próximo (decisão de 2026-10-13: "validação de um ciclo por item").

Pré-condições por projeto: projeto nomeado pelo owner; sem trabalho de outro dev-squad em curso nele; `git status` limpo; **o HSEOS não pode rodar de um checkout que é o próprio projeto verificado**: o `HSEOS_CONFIG` é relativo ao módulo (pré-condição de implantação da W5-02b2, `docs/evolution/w5/STATUS.md:110`), por isso o runtime vem do release `$REL`, não do checkout do projeto.

Comandos (por projeto):

1. Backup dos dois arquivos; editar `<projeto>/.hseos/config/agent-liveness.yaml` (`enabled: true`) e, se autorizado, `<projeto>/.hseos/config/activity-coordination.yaml` (`enabled: true`; `store.backend`, `hot_files`, `enforce.publish_guard` ficam **como estão**, salvo decisão do owner). Os contratos são relidos a cada execução e, se ficarem inválidos, vale a última configuração válida com aviso (`docs/activity-coordination/README.md:42`).
2. Não adicionar skills/hooks/workflows do HSEOS ao projeto (global §HSEOS runtime): só adaptadores de escopo; verificar drift do compilador com `agent-core compile --check` (risco registrado, `docs/evolution/w5/STATUS.md:117`).

Verificação:

```bash
env $P hseos liveness check --json --directory <projeto>
env $P hseos activity register --directory <projeto> --session <id> --tool claude-code --json
env $P hseos activity check --directory <projeto> --session <id> --json
# 1 ciclo do watchdog sem escalonamento indevido; hook Claude 'activity-coordination.sh' registra/encerra
```

Receipt por projeto: `$DIST/step4-<projeto>.json` (hash dos dois YAML antes/depois, saída de `check`, ciclo observado).

Rollback: `enabled: false` nos dois arquivos (efeito imediato: arquivo ausente ou desligado = nenhum comportamento) ou restaurar o backup; confirmar `hseos liveness check --json` sem sessões vigiadas. Os dados em `~/.local/state/hseos/activity.db` permanecem.

## 7. Passo 5 — repasse ao Codex (design-system)

**Exige autorização própria do owner e é entrega humana, não comando.** O que é: texto pronto em `/build/tmp/hseos-w5/codex-design-system-relay.md`, mensagem para as sessões Codex em `design-system-core` (origem: sessão Claude Code de cambio-real-platforms, 2026-10-12; repasse autorizado em 2026-10-13). Conteúdo: rebasear em `origin/main` (checkouts 22–58 commits atrás); renumerar o pacote de contratos a partir de `experimental.7` (`experimental.4/5` já publicados, `.6` reservado ao truncate do Text); reconciliar StepNavigator e Button com as versões publicadas; conferir próxima versão livre antes de mexer nos arquivos quentes; checar duplicação dos pilotos Cambio.

Quem entrega: **o owner**, até a coordenação estar ativa (decisão de 2026-10-13). O agente não envia o texto a sessões de terceiros. Com os passos 1 a 4 concluídos, o `hseos activity reserve --kind version` passa a ser o mecanismo que substitui o repasse manual para colisões de versão.

Pré-condição: confirmar que o texto ainda é atual (releitura por quem entrega; os números de versão podem ter avançado). `/build/tmp` é volátil: guardar cópia durável do texto em local indicado pelo owner antes da W9.

Verificação: owner confirma a entrega; as sessões Codex respondem com a numeração nova. Sem receipt automático; registrar data e canal na nota do passo.

Rollback: não aplicável (mensagem); se estiver desatualizada, enviar errata.

## 8. Ordem, dependências e o que fica de fora

Ordem obrigatória: 1 → 2 → 3 → 4; o passo 5 é independente e pode ocorrer a qualquer momento (decisão do owner). Passos 2 e 3 só têm efeito real com o passo 4; ligar contrato antes dos hooks/timer é permitido, mas deixa o watchdog sem backstop.

Fora desta ativação (decisões separadas):

- **Publicação no npm**: não há; `public_registry_publication: "not_performed"`.
- **Servidor MCP moderno / sunset de 2026-11-30**: não é ativado por este runbook (ver dívida em riscos transversais).
- **Migration 017** (`tools/mcp-project-state/migrations-pending-activation/017-agent-memory-events.sql`): continua pendente; **renumerar se outra migration for criada antes da ativação** (`docs/evolution/w5/STATUS.md:264`, padrão do schema em `tools/mcp-project-state/lib/execution-ledger-schema.js:9`). A ativação em banco real depende da janela de compatibilidade do ADR.
- **Plugins** seguem `scaffolded` (`docs/evolution/w5/STATUS.md:321`); consumidores F14/F15/F20 `real_consumers: not_verified`.
- **Push das tags** `hseos-w5-g6` e `hseos-w5-closeout-wN`: só com autorização (PLAN da W5-closeout, W8).
- **Limpeza W9** (worktrees, branches, `/tmp/hseos-executor-filter-*`).

## 9. Riscos transversais

- **Hash dos hooks depende do caminho do release**: toda nova distribuição muda os comandos e invalida `trusted_hash`; refazer o passo 2 após cada redistribuição.
- **Sessões abertas** mantêm MCPs/hook anteriores; reabrir (`session_reload_note` do receipt de `2b4d6f37…`). `fresh_claude_client_lifecycle: not_verified` no receipt de `6402726d…`.
- **Wrapper `hseos` quebrado** com o `nvm` mais novo (seção 1): fixar sempre o PATH do Node 24.15 (risco condicional da seção 1: um Node maior sem o pacote quebra o `hseos` global).
- **`hseos --version` não identifica o commit**: usar sha256 do tarball e o diretório `$REL`.
- **Renumeração de migration** e **atualização da master com `executor.js`**: a PR #216 já está na master; esperar conflito manual se a W5 ainda não absorveu (`docs/evolution/w5/STATUS.md:120`).
- **`notify-send`/systemd reais não verificados**: aceitar como primeira verificação, com escalonamento persistido em `escalations.jsonl`.
- **Concorrência de agentes** escrevendo em `~/.codex`/`~/.claude` durante os passos 1 e 2: serializar.
- **Dívida do sunset MCP (decisão do owner):** os 4 servidores MCP instalados (`mcp-project-state`, `mcp-hseos-governance`, `mcp-hseos-swarm`, `mcp-axon-bridge`) sobem o servidor legado (`tools/lib/legacy-mcp-server.js`) e **não aplicam** o sunset de 2026-11-30 (só metadado de telemetria). O servidor moderno, o único que recusa o legado depois do sunset (`tools/lib/mcp-2026-adapter.js:695`), está bloqueado por `EXECUTION_ACTIVATION_PENDING` (`tools/lib/governed-execution/native-mcp-server.js:101`) até a ativação ADR-0022/0023, que exige 30 dias completos de zero requests legados e por isso não cabe antes de 30/11. O sunset só vale ao ativar o servidor moderno; a data de 2026-11-30 precisa ser revista por ADR antes de vencer. O passo 1 não resolve isto: os MCPs registrados continuam legados.

## 10. Decisões que cabem ao owner

1. Autorização de cada passo (1 a 5), com o `SHA` final.
2. Projeto(s) do passo 4 e a ordem; se `activity-coordination` liga junto com `agent-liveness`.
3. Projeto vigiado pelo timer e _linger_ do usuário.
4. Quem e quando entrega o repasse ao Codex, e onde guardar a cópia durável do texto.
5. Confirmar o método de extração/instalação do release imutável (os recibos anteriores não o registram).
6. Rever por ADR a data de sunset MCP de 2026-11-30 antes de vencer (o sunset só vale ao ativar o servidor moderno; ver riscos transversais).

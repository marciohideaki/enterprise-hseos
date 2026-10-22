# Runbook F3 — ativação pós-G6 (W8)

Status: **preparação (W7, atualizada na W6-E7b e na W10). Nada deste documento foi executado.** Cada passo da seção 3 em diante **exige autorização do owner**, dada com o commit final identificado. Desde a decisão de 2026-10-22 a autorização pode ser dada **em lote com gates**: os passos rodam na ordem da seção 8, cada um com backup, verificação e receipt próprios, e a execução **para no primeiro BLOCKED** (falha vira BLOCKED, nunca PASS). Autorização de um passo fora do lote não vale para o seguinte. Valem só sobre a `master` final já mergeada (G6).

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

## 3b. Passo 1b — ativação do banco e servidor MCP moderno

**Entregue pela W10 e passa a existir na `master` quando a PR da W10 for mergeada.** O comando `hseos execution-activation plan|apply|rollback` (K2) e o servidor moderno sobre banco ativado (K4) estão na branch `feature/hseos-w5-closeout-w10`; a evidência está em `docs/evolution/w10/evidence/k1`, `k3`, `k7` e `k10`. **Nada foi executado:** nenhum `project.db` real foi ativado e nenhum registro de cliente foi trocado. Este passo é o contrato do que a W8 vai executar. **Exige autorização própria do owner** (ou o lote com gates descrito no cabeçalho e nas seções 8 e 10) e depende do passo 1 verificado.

Pré-condições:

- O **ADR-0048** (critério de ativação, W10/G0, hoje **Proposed**, em `feature/hseos-w5-closeout-w10`) está **Accepted** pelo owner (ao aceitar, a linha de status deve ficar curta, `Accepted — AAAA-MM-DD`: o parser do comando recusa prosa depois da data). Ele substitui o critério de 30 dias de zero legado do ADR-0022 e do ADR-0023 por um critério por banco e torna o sunset do legado condicional à evidência de que os clientes registrados falam `2026-07-28`. O comando recusa `--adr` que não aponte para um ADR Accepted.
- O owner aceitou **expressamente a exceção de rollback** do ADR-0048 (item 5) e foi **avisado da perda das escritas pós-ativação antes** deste passo (ver Rollback abaixo).
- **Critério do ADR-0048, todos com evidência arquivada:** (a) suíte de contrato do servidor moderno verde sobre banco existente já ativado; (b) ensaio de ativação e rollback em cópia (`agentic-activation-rehearsal.js`) concluído, com backup do banco real com `integrity_check` = `ok` e sha256 do original e do backup; (c) journey MCP moderna (`mcp-journey.mjs --mode modern`, K10: 503 PASS / 0 FAIL / 4 NOT_EXERCISED) com contagens conferidas (governance 15, project-state 15, swarm 5, axon-bridge 6; `memory.*` +3 e `environment.*` +6 só no project-state com a seção `environment:`); (d) prova com cliente real (Codex instalado) por `tools/list` e `tools/call`, com a versão de protocolo registrada; (e) compat legado-dentro-do-moderno mantida.
- **Critério (f), entregue pelo K4 (`b639f965`; achado do K1 em `task/w10-k1`, `docs/evolution/w10/evidence/k1/`):** o servidor moderno atende `initialize` das revisões legadas `2024-11-05`, `2025-03-26`, `2025-06-18` e `2025-11-25` no modo de compatibilidade, negociando para `2024-11-05`, sem executar ferramentas que exigem aprovação a esses clientes (a ferramenta continua listada; o adaptador devolve `MCP_LEGACY_APPROVAL_UNSUPPORTED` na chamada). O Codex 0.163.0 envia `2025-06-18` (antes do K4 o adaptador só aceitava `2024-11-05` exato e recusava com `-32022`; K7 mostrou o handshake do Codex concluir contra o banco ativado); o Claude Code 2.1.305 fala `2026-07-28` por padrão. Sem (f), a troca do `~/.codex/config.toml` para o moderno quebraria o Codex.
- Escopo: **um banco por vez**; o piloto é o `project.db` do enterprise-hseos. Os outros `project.db` ficam fora até ADR ou autorização própria.
- Passo 1 verificado: o CLI global contém `execution-activation`.
- **Janela supervisionada.** Nenhum servidor, CLI, hook ou sessão que mantém o `project.db` aberto pode estar rodando; a lista nominal é levantada na hora (os MCPs do Codex, hooks, sessões do Claude Code). A varredura de processos do `apply` deixa cerca de 390 processos não inspecionáveis (K3): o `apply` prossegue, mas a prova de que o banco não está aberto em outro lugar é parcial, por isso os consumidores são parados e conferidos por outro meio (`lsof`/`fuser`). O `apply` recusa se o lock de escrita falhar. O banco piloto tem **WAL com dados não checkpointados**: o `apply` recusa com "WAL sidecar still holds data" se o checkpoint não limpar o WAL; esse caminho não foi exercitado no ensaio (a cópia nasce sem sidecars) e é conferido na ativação real.
- **Gate `g9-zero-legacy-window` do ensaio oficial** (`agentic-activation-rehearsal`): ele ainda lista o critério de 30 dias que o ADR-0048 substitui. Reconciliar esse gate é trabalho **pendente, não entregue**; o ensaio passa (`rehearsal-passed`) mas continua listando o g9 como gate restante.
- **Consumidores a re-registrar** (lista nominal, a fechar na hora): no `~/.codex/config.toml`, `hseos-governance`, `hseos-state-tracking` (project-state) e `hseos-swarm`, que apontam para o `project.db` do enterprise-hseos via `HSEOS_STATE_DB`; `hseos-axon-bridge` está desabilitado e não usa o `project.db`. O `~/.claude.json` só tem `axon` e `playwright` (nenhum servidor HSEOS). **Não verificados:** `.mcp.json` por projeto, hooks e CLIs que abram o banco. Depois da ativação o servidor legado **recusa** o banco ativado, com mensagem que manda re-registrar o servidor no release governado, então todos precisam trocar antes do `apply`.

**Modo por banco** (K4/K2): `user_version` 4 sem tabelas pendentes é o legado; ativado é `user_version` 17 com `application_id` `0x48534f53` ("HSOS"), as tabelas do ledger e `integrity_check` = `ok`, e serve o modo moderno; qualquer outro estado é recusado como `inconsistent`, **sem fallback** para nenhum dos dois modos. O sunset do legado vem de **`HSEOS_MCP_LEGACY_SUNSET`**: sem valor a compat não expira; valor inválido aborta o boot (exit 78 segundo o relato da K4, a reconfirmar). A data só é fixada pelo owner depois da evidência do K1.

Procedimento (a W8 confirma contra o comando entregue):

0. **1b.0 — seção `environment:` do `~/.config/hseos/config.yaml`** (ver seção 3c). Backup antes (`cp -a ~/.config/hseos/config.yaml "$DIST/host-backup/.config-hseos/pre-step1b/"`), escrita da seção `environment:` (cache de toolchain, `memory.rules`, `memory.operator`, perfis de isolamento) e hash do arquivo antes e depois no receipt. Sem a seção, a verificação de `tools/call` de `environment.*` e `memory.*` falha com `ENV_CAPABILITY_UNAVAILABLE`.
1. **Parar as sessões que usam os MCPs hseos** (`hseos-governance`, `hseos-state-tracking`, `hseos-swarm`, `mcp-axon-bridge`, quando registrado) e informar o owner.
2. `hseos execution-activation plan --db <path> --adr <id>`: só relata (dry-run), sem alterar o banco.
3. `hseos execution-activation apply --db <path> --adr <id>` (recusa sem `--adr` Accepted). Em ordem: checkpoint do WAL; **backup** com `db.backup` num diretório datado, com `integrity_check` e sha256 do backup e do original; migrations 005 a 017 numa transação; receipt de ativação (commit, ADR, hashes, `user_version`).
4. **Trocar o `~/.codex/config.toml`** (os 3 MCPs do Codex) para apontar para o release novo `$REL`. Backup antes (`cp -a … "$DIST/host-backup/.codex/pre-step1b/"`); o hash do arquivo muda e vai para o receipt.

Verificação (cada falha é BLOCKED):

```bash
env $P hseos execution-activation plan --db <path> --adr <id>   # banco ativado: nada a aplicar
# Codex real (config.toml novo, CODEX_HOME de produção só depois do ensaio em CODEX_HOME descartável):
#   tools/list mostra as ferramentas modernas, incluindo environment.* e memory.*, com contagens conferidas
#   e uma tools/call de cada família (governance, state, swarm, environment, memory)
env $P hseos liveness check --json
```

Receipt: `$DIST/step1b-activation.json` com hashes do banco antes e depois, caminho e sha256 do backup, `user_version`, ADR, hashes de `config.toml` e de `~/.config/hseos/config.yaml` antes e depois, a evidência de cada critério (a) a (f) e a saída da verificação.

Rollback: `hseos execution-activation rollback`, que confere o hash do backup e restaura atomicamente com os servidores parados; re-registrar o servidor legado no `~/.codex/config.toml` a partir do backup `pre-step1b`; restaurar o `~/.config/hseos/config.yaml` do backup `pre-step1b`. **Isto não é a reconciliação com o ADR-0022:** restaurar o backup pré-migração contraria a letra do §Rollback do ADR-0022, e o **ADR-0048 (Proposed) propõe uma exceção delimitada ao banco piloto**, que o owner precisa **aceitar expressamente**. Sem essa aceitação, o rollback fica restrito ao procedimento original do ADR-0022 e o passo 1b não pode ser executado. Em qualquer caso o banco ativado é **preservado ao lado como evidência** (ADR-0022: nunca apagar o ledger durante o rollback). A **perda das escritas feitas depois da ativação** é declarada ao owner **antes** do passo 1b. O rollback é testado numa cópia do banco e num prefixo descartável antes de declarar o passo concluído; o rollback real fica documentado, não exercitado.

Riscos: a troca para o moderno sem o critério (f) quebra o Codex (`initialize` `2025-06-18` recusado com `-32022`); sessões abertas mantêm o MCP anterior (reabrir após o passo); depois do sunset definido pelo ADR, o servidor moderno recusa o cliente que pedir o legado, com mensagem acionável; o legado só sai quando o ADR o permitir.

## 3c. Composição de host de referência (entregue pela W10, K5)

**Entregue pela W10 (K5 na CLI, K5b no MCP) na branch `feature/hseos-w5-closeout-w10`; passa a existir na `master` com a PR da W10.** Antes dela nenhum código de produção montava o store de memória governado nem o `environmentHost` (dívida registrada em `docs/evolution/w5/STATUS.md`, seção "Fecho da não conformidade central"). A W10 entrega `createProductionEnvironmentHost(config)` em `tools/cli/lib/engineering-task-extensions.js`, que compõe:

- o ambiente da tarefa e os bundles (`createTaskEnvironment`, `createEnvironmentBundles`);
- a memória governada (`createGovernedMemory`, `MemoryStore` sobre o ledger de execução);
- o gate de aprovação do computer-use (`createApprovalGate`) e as aprovações de exclusão de memória (`createMemoryDeleteApprovals`);
- o sink do ledger (`createEnvironmentLedgerSink`) e o `ExecutionApprovalStore`.

A configuração vive em uma seção nova `environment:` de `~/.config/hseos/config.yaml`:

- raiz do **cache de toolchain** (provisionado pelos pins);
- **`memory.rules`**: regras de escrita por projeto, com **deny por padrão**;
- **`memory.operator`**: ator com `kind: operator`, exigido para `memory.delete`;
- **`isolation`**: informativo, uma restrição de valor único. O ambiente da tarefa sempre isola com bwrap (único backend implementado); a chave não escolhe backend, apenas recusa qualquer outro valor;
- **`toolchain_cache`** deve ser um caminho absoluto, normalizado, sem `..`, de um diretório existente e que não seja symlink (só o componente final é verificado); caso contrário a seção é recusada com `ENGINEERING_ENVIRONMENT_CONFIG_INVALID`. Seção vazia ou chave parecida com `environment` (ex.: `enviroment`) emite aviso no stderr e o host continua ausente.

Servidor MCP `project-state` (banco ativado), mesma seção, com estas particularidades:

- A chave `environment.workspace` da seção liga LSP e DAP (abaixo). `--config=<caminho>` escolhe o arquivo (padrão `~/.config/hseos/config.yaml`); a seção só é lida com o banco ativado, nunca no modo legado ou fixture. Seção inválida: aviso no stderr e servidor sem a capability.
- **`workspace`** (`host_workspace`, `main_checkout`, `protected_paths`): só o host MCP lê; liga LSP e DAP junto com `toolchain_cache`. `host_workspace` é o **diretório real do usuário**, montado **somente leitura** no sandbox (escrita falha com EROFS). `file` das ferramentas LSP é relativo a essa raiz: caminho absoluto (inclusive a grafia do sandbox, `/workspace/index.ts`) e `..` são recusados com `ENV_LSP_OUT_OF_SCOPE`, por desenho.
- **O DAP executa programas do workspace por design** (esse é o seu objetivo); a contenção é o sandbox (somente leitura, sem rede, toolchain pinado), não a escolha do diretório. Aponte `host_workspace` apenas para um checkout em que você aceite executar o código.
- **Memória via MCP é sempre `origin: agent` e `trust: untrusted`.** O cliente que enviar outro `origin`/`trust` recebe `MEMORY_WRITE_FIELD_NOT_ALLOWED` e nada é gravado; o `memory.operator` da config é só a identidade vista pelas regras de escrita, não a origem da memória. A recuperação padrão não devolve `untrusted` (precisa de `include_untrusted`). Promoção a `trusted` fica fora desta fase (exigiria um caminho de operador futuro).
- `memory.delete` com `project_id` de outro projeto é recusado antes de qualquer pedido de aprovação ao humano.
- **LSP e DAP exigem cgroup delegado (achado F4 do K7).** O isolamento só funciona com um cgroup pai delegado ao usuário (controladores `memory` e `pids`) e com `/usr/bin/bwrap`. Um servidor lançado por um cliente MCP herda o cgroup do cliente, que normalmente não é delegado. Por isso o host verifica as duas condições **na inicialização**, com a mesma checagem de cgroup que o executor aplica a cada chamada. Sem elas (cgroup delegado mais bwrap), `environment.lsp.*` e `environment.dap.*` ficam **omitidas do `tools/list`** e o stderr traz uma linha `hseos mcp: environment.lsp and environment.dap are off: <causa>` com a instrução de lançamento. Não há ferramenta anunciada que falhe em toda chamada. Se a composição do host falhar mesmo passando nas checagens, o servidor reinicia **uma única vez sem o host** (um segundo erro propaga); se nenhuma família puder ser composta e não houver memória configurada, ele sobe sem a capability (K9).
- **Lançamento delegado** (formato de referência: `run-in-cgroup.sh` da run de fechamento; **não foi testado com Codex nem com Claude Code**): `systemd-run --user -p Delegate=yes --wait --collect --pipe -- <comando do servidor>`, por exemplo o `node tools/mcp-project-state/index.js --db=<project.db>` que o cliente executaria. O `--pipe` mantém o stdio do servidor ligado ao cliente.
- **`memory.*` não depende de isolamento** e continua anunciada com o banco ativado e `memory.operator` configurado, com ou sem cgroup delegado.
- **NOT_EXERCISED:** nenhuma `tools/call environment.*` foi feita por cliente real (Codex ou Claude Code). A omissão sem cgroup e a presença com cgroup estão provadas por teste do próprio servidor (`test/test-mcp-environment-host.js`), não por cliente.

**Sem a seção `environment:` o host fica ausente** e o comportamento atual se mantém: `ENV_CAPABILITY_UNAVAILABLE` no servidor MCP e `ENGINEERING_ENVIRONMENT_HOST_REQUIRED` na CLI. A seção é escrita no passo 1b.0, com backup e rollback: ela só vale com o banco ativado (memória durável no `project.db`); na CLI sem banco ativado a memória usa o ledger da tarefa, com aviso. Pré-condição de segurança: o `agent run` admite o contrato (K6) antes de montar o host. A seção não carrega segredo, e este runbook não os manuseia.

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

Ordem obrigatória: 1 → 1b → 2 → 3 → 4, seguida do push das tags e da W9 (higiene); o passo 5 é independente e pode ocorrer a qualquer momento (decisão do owner). O passo 1b depende do 1 e do ADR Accepted. Passos 2 e 3 só têm efeito real com o passo 4; ligar contrato antes dos hooks/timer é permitido, mas deixa o watchdog sem backstop.

Fora desta ativação (decisões separadas):

- **Publicação no npm**: não há; `public_registry_publication: "not_performed"`.
- **Servidor MCP moderno / sunset**: a ativação do banco e a troca dos MCPs são o passo 1b, condicionadas ao ADR-0048 (Proposed; critério de ativação, entregue na W10/G0, ainda não está na master) em Accepted. O código (K2, K4, K5, K5b, K8, K9, K11) está na `feature/hseos-w5-closeout-w10` e chega à `master` com a PR da W10. Este runbook não afirma que nada disso foi executado.
- **Migration 017** (`tools/mcp-project-state/migrations-pending-activation/017-agent-memory-events.sql`): continua pendente; **renumerar se outra migration for criada antes da ativação** (`docs/evolution/w5/STATUS.md:264`, padrão do schema em `tools/mcp-project-state/lib/execution-ledger-schema.js:9`). A ativação em banco real depende da janela de compatibilidade do ADR.
- **Plugins** seguem `scaffolded` (`docs/evolution/w5/STATUS.md:321`); consumidores F14/F15/F20 `real_consumers: not_verified`.
- **Push das tags** `hseos-w5-g6` e `hseos-w5-closeout-wN`: depois dos passos, com a autorização do lote ou própria (PLAN-CONCLUSAO, W8).
- **Limpeza W9** (worktrees, branches, `/tmp/hseos-executor-filter-*`): autorizada, depois das tags.

## 9. Riscos transversais

- **Hash dos hooks depende do caminho do release**: toda nova distribuição muda os comandos e invalida `trusted_hash`; refazer o passo 2 após cada redistribuição.
- **Sessões abertas** mantêm MCPs/hook anteriores; reabrir (`session_reload_note` do receipt de `2b4d6f37…`). `fresh_claude_client_lifecycle: not_verified` no receipt de `6402726d…`.
- **Wrapper `hseos` quebrado** com o `nvm` mais novo (seção 1): fixar sempre o PATH do Node 24.15 (risco condicional da seção 1: um Node maior sem o pacote quebra o `hseos` global).
- **`hseos --version` não identifica o commit**: usar sha256 do tarball e o diretório `$REL`.
- **Renumeração de migration** e **atualização da master com `executor.js`**: a PR #216 já está na master; esperar conflito manual se a W5 ainda não absorveu (`docs/evolution/w5/STATUS.md:120`).
- **`notify-send`/systemd reais não verificados**: aceitar como primeira verificação, com escalonamento persistido em `escalations.jsonl`.
- **Memória MCP sempre `agent`/`untrusted`:** promoção a `trusted` é limitação conhecida (ver seção 3c), sem caminho de operador nesta fase.
- **Gate g9 do ensaio oficial** ainda lista o critério de 30 dias (ver passo 1b); a reconciliação é trabalho pendente.
- **Concorrência de agentes** escrevendo em `~/.codex`/`~/.claude` durante os passos 1 e 2: serializar.
- **Dívida do sunset MCP (decisão do owner de 2026-10-20, a resolver pelo ADR-0048 na W10):** os 4 servidores MCP instalados sobem o servidor legado e só gravam o sunset de 2026-11-30 como metadado de telemetria; o moderno, o único que recusa o legado depois do sunset, está bloqueado por `EXECUTION_ACTIVATION_PENDING` até a ativação. O ADR-0048 (Proposed; W10/G0, passo 1b) substitui a data fixa por um sunset condicional à evidência dos clientes, e o código do sunset configurável (`HSEOS_MCP_LEGACY_SUNSET`, K4) já está na feature; até o ADR estar Accepted e o passo 1b executado, os MCPs registrados continuam legados. O Codex estável, sem flag, ainda não envia `server/discover` `2026-07-28` (K1/K7), o que mantém a condição do sunset **não atendida**. O passo 1 não resolve isto.

## 10. Decisões que cabem ao owner

1. Autorização de cada passo (1, 1b, 2 a 5), com o `SHA` final, ou o lote com gates (para no primeiro BLOCKED).
2. Projeto(s) do passo 4 e a ordem; se `activity-coordination` liga junto com `agent-liveness`.
3. Projeto vigiado pelo timer e _linger_ do usuário.
4. Quem e quando entrega o repasse ao Codex, e onde guardar a cópia durável do texto.
5. Confirmar o método de extração/instalação do release imutável (os recibos anteriores não o registram).
6. Aceitar o ADR-0048 (W10/G0), que fixa o critério de ativação e o sunset do legado; é pré-condição do passo 1b.
   Aceitar **expressamente a exceção de rollback** do ADR-0048 (item 5) e tomar ciência, antes do passo 1b, da perda das escritas pós-ativação do banco piloto.
7. Autorizar o passo 1b no `project.db` do enterprise-hseos, único banco do piloto, e a troca do `~/.codex/config.toml`.

# K7 — prova ponta a ponta do modo moderno sobre banco ativado

Prova, não implementação: nenhum código de produção mudou e nenhum defeito foi corrigido (os achados estão em "Achados"). Data da medição: 2026-10-22. Base: `feature/hseos-w5-closeout-w10` (a9c36468), Node 24.15. Clientes: `codex-cli 0.163.0` e Claude Code `2.1.305`, os instalados em `~/.local/bin`.
Todos os bancos, configs e `CODEX_HOME` são descartáveis (`/build/tmp/hseos-w5/closeout/`). O ADR-0048 usado nas ativações é um **ADR de fixture** `Accepted` em diretório temporário (opção interna `internal.decisionsDirectory`); o ADR real continua `Proposed`.

## Conclusão por critério do ADR-0048

| Critério                                          | Estado                           | Evidência                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) suíte de contrato moderna sobre banco ativado | **parcial**                      | `test/test-mcp-activated-mode.js` (suíte da K4, banco ativado pela biblioteca): 17/17 (`runs/activated-mode-suite.txt`). `test/test-mcp-2026-adapter.js` e `test/test-mcp-contract.js`, citados no ADR, **não foram executados** nesta task (a prova delas é o CI); não verifiquei se aceitam um banco ativado externo.                                                                   |
| (b) ensaio de ativação e rollback em cópia        | **atendido** (b2 fora do escopo) | `../k3/README.md`. O backup do banco **real** com `integrity_check` e sha256 (b2) só existe na ativação real.                                                                                                                                                                                                                                                                             |
| (c) journey MCP moderno com contagens conferidas  | **atendido com ressalvas**       | `journeys/modern-journey-result.json`: 4 servidores, stdio e HTTP, banco ativado: governance **15**, swarm **5**, project-state **15**, axon-bridge **6**; project-state com `environment:` e memória **18**, com `workspace` também **24**. Ressalvas nos achados F2 e F3: o `mcp-journey.mjs` atual não mede o modo moderno, e as contagens 15/15/5 do ADR não incluem `environment.*`. |
| (d) prova com cliente real                        | **parcial**                      | Codex: `initialize` e `tools/list` concluem contra o servidor ativado (`frames/codex-activated-default.json`); `tools/call` **NOT_EXERCISED** (exige modelo/login). Claude Code: 8/8 execuções no `2026-07-28` com `tools/call` de `state_read` (`runs/claude-runs-cost.jsonl`, `frames/claude-activated-run1.json`).                                                                     |
| (e) compat legado-dentro-do-moderno mantida       | **atendido**                     | `journeys/modern-journey-result.json` (`counts[].legacy_compat`, `host` h07), `runs/legacy-counters.txt`; controle v4 em `counts[]` com `label: controle v4/legado`.                                                                                                                                                                                                                      |
| (f) compat negocia as revisões legadas conhecidas | **atendido**                     | `initialize` com `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25` negocia `2024-11-05` nos 4 servidores, stdio e HTTP; aviso de depreciação, `sunset: none-configured` e contador de uso; `memory.delete` de cliente legado devolve `MCP_LEGACY_APPROVAL_UNSUPPORTED` e nada é apagado (h07).                                                                                       |

Limitações que o ADR deve registrar: Codex `tools/call` e aprovação MRTR do Codex = **NOT_EXERCISED** (dependem de autorização do owner para login e gasto); o Codex estável, sem flag, continua falando `initialize` `2025-06-18` e é atendido pela compat, portanto a condição de sunset do ADR-0048 (Codex enviando `server/discover` `2026-07-28` sem flag) **segue não atendida**.

## Método e resultados

### 1. Pacote instalado como usuário final (com um desvio declarado)

`npm pack` da árvore com o npm do Node 24.15 (`hseos-4.0.0-rc.0.tgz`, 1539 arquivos) para `/build/tmp/hseos-w5/closeout/k7/pack/`, extraído em `consumer/node_modules/hseos`. **Desvio:** não houve `npm install` do registro (sem rede/autorização); as dependências de `node_modules` foram **symlinks para o checkout** (inclui `better-sqlite3` compilado para o Node 24). Os consumidores `cl` (banco v4), `cm` (ativado, contagens), `ch` (ativado, host) e `cc` (ativado, clientes reais) compartilham esse `node_modules`. Não rodei `hseos install` neles: criei só `.hseos/state/project.db`.

Bancos: todos derivam do mesmo backup v4 verificado da K3 (cópia do `project.db` real, sha256 `c9dfebafc5a0…`), ativado por `activate-db.cjs` com o ADR de fixture (`modern-db-activation.json`).

### 2. `mcp-journey.mjs` (inalterado) e o harness moderno

- **Controle, banco v4** (`journeys/mcp-journey-legacy-control/`): veredito **PASS**, 4 servidores legados, contagens 15/5/15/6, 0 órfãos. O axon real ficou `NOT_EXERCISED` (PATH sem `axon`, como o runner de CI).
- **Cliente legado do `mcp-journey` sobre banco ativado** (`journeys/mcp-journey-legacy-client-on-modern/`): veredito **FAIL** (85 PASS, 34 FAIL, 4 NOT_EXERCISED). O journey só fala o protocolo legado; classificação dos 34 em `classification.json`: 12 do envelope governado (a chamada devolve `ok:true`, mas a forma difere da esperada pelo journey), 3 de aprovação não suportada no legado (esperado, ADR-0023 item 15), **3 de um crash real do servidor moderno com uma linha `null`** (achado F1) e 16 de cascata (timeouts depois do crash). Não é prova de regressão do modo moderno; é a prova de que esse journey não serve de gate moderno.
- **Harness moderno** `modern-journey.mjs` (veredito **PASS**, `journeys/modern-journey-result.json`): `server/discover` + `tools/list` em `2026-07-28` (HTTP com `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`) e, em conexão própria, `initialize`+`tools/list` das quatro revisões legadas.

| Servidor (pacote instalado)              | Moderno stdio | Moderno HTTP | Cliente legado (as 4 revisões) | Controle v4 |
| ---------------------------------------- | ------------- | ------------ | ------------------------------ | ----------- |
| hseos-governance                         | 15            | 15           | 15 (negocia `2024-11-05`)      | 15 (legado) |
| hseos-swarm                              | 5             | 5            | 5                              | 5           |
| hseos-project-state                      | 15            | 15           | 15                             | 15          |
| axon-bridge                              | 6             | 6            | 6                              | 6           |
| project-state + `environment:` (memória) | 18            | 18           | 18                             | n/a         |

`scheduler_sweep_orphans` existe só no project-state moderno (o log diz `tools=16`) e não aparece em `tools/list`. Em stdio a era do protocolo fica fixada por conexão (`-32022 MCP protocol era is pinned…`): o cliente legado precisa de conexão própria.

### 3. Host de produção (`host` h01–h10 do `modern-journey.mjs`, todos PASS)

Servidor `mcp-project-state` do pacote instalado, banco ativado `ch`, `--config` com seção `environment:` (`project_id`, `toolchain_cache` = `/build/cache/hseos-toolchain`, `memory.rules` com allow, `memory.operator`, `workspace` com um `index.ts` sintético). Executado no cgroup delegado (`run-in-cgroup.sh`).

| Passo | Resultado                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| h01   | `tools/list` moderno anuncia `memory.write/retrieve/delete` e `environment.lsp.*`, `environment.dap.run` (24 ferramentas); `computer`/`browser` seguem desligados                                 |
| h02   | `environment.lsp.hover` **real** (typescript-language-server do cache pinado) devolve `function calculate(n: number): number`                                                                     |
| h03   | `memory.write` → `memory.retrieve` (autoridade `data`)                                                                                                                                            |
| h04   | **memória durável:** o servidor é encerrado e um novo processo recupera a mesma memória do `project.db`                                                                                           |
| h05   | `memory.delete` → `input_required`; **decline não apaga**                                                                                                                                         |
| h06   | `memory.delete` → `input_required`; **accept apaga**                                                                                                                                              |
| h07   | cliente legado (`initialize` `2025-06-18` → `2024-11-05`) → `memory.delete` = `MCP_LEGACY_APPROVAL_UNSUPPORTED`, nada apagado                                                                     |
| h08   | memória com uma credencial de exemplo é recusada                                                                                                                                                  |
| h09   | ledger do `project.db` ativado: `agent_memory` = `memory.written` ×2 e `memory.deleted` ×1; `environment_session` = `environment.lsp.completed` ×1; a credencial **não** aparece em nenhum evento |
| h10   | controle: sem a seção `environment:` nenhuma capability é anunciada e `memory.retrieve` responde `Unknown tool`                                                                                   |

Sem `workspace`/`toolchain_cache` o host só traz `memory.*` (18). Fora de um cgroup delegado o hover falha com `ENGINEERING_ISOLATION_UNAVAILABLE` (primeira tentativa desta task; ver F4).

### 4. Clientes reais, config isolada

- **Codex 0.163.0**, `CODEX_HOME` descartável com um único servidor (`hseos-project-state`) via `stdio-tee-activated.cjs`, sobre o banco ativado `cc`; `codex exec --skip-git-repo-check --ephemeral -s read-only "list the tools of the hseos-project-state MCP server"`. Sem login: o `exec` termina em 401 antes da inferência (`runs/codex-exec-activated-output.txt`, saída redigida). **Antes da K4 (K1) o mesmo handshake terminava em `-32022`.** Agora (`frames/codex-activated-default.json`): `initialize` `2025-06-18` → resposta `2024-11-05` com `_meta.deprecation` e `sunset: none-configured` → `notifications/initialized` → `tools/list` → **15 ferramentas** (project-state). O contador de uso legado do banco registrou `codex-mcp-client@0.163.0`, protocolo `2024-11-05`, 3 requisições (`runs/legacy-counters.txt`). `tools/call` e aprovação: **NOT_EXERCISED**.
- **Claude Code 2.1.305**, Haiku, `--mcp-config <descartável> --strict-mcp-config --setting-sources "" --no-session-persistence`, 8 execuções, uma `tools/call` de `state_read` cada (`runs/claude-runs-cost.jsonl`). **8/8** falaram `server/discover` → `tools/list` → `tools/call` em `2026-07-28`, todos `resultType: complete`, resposta `DONE`; o contador legado não registrou nenhum cliente Claude. A anomalia do K1 (1 de 8 em `initialize` `2025-11-25`) **não se repetiu**, então esta amostra não exercitou, com o cliente real, o `initialize` `2025-11-25`; essa revisão foi exercitada sintéticamente (seção 2). 8 execuções não provam que nenhuma cai no caminho legado; provam que, quando caírem, a compat negocia (seção 2).
- **Custo:** Codex US$ 0; Claude Code (Haiku 5.5) **US$ 0,00759** no total das 8 execuções (limite US$ 0,02).
- **Configs reais intocadas:** `~/.codex/config.toml` (`a88469244998687e`, mtime 2026-10-13 23:17:53) e `~/.claude/settings.json` (`8a2b93a3a01bc135`, mtime 2026-10-22 00:01:51) com o mesmo hash e mtime antes e depois (`runs/home-config-before.txt`, `runs/home-config-after.txt`, `diff` vazio). Ressalva herdada do K1: o Claude Code reescreve `~/.claude.json` a cada execução e não há hash dele; só se afirma que nenhuma configuração do usuário foi editada.

## Achados (reportados, nada corrigido)

- **F1 — uma linha JSON `null` derruba o servidor moderno em stdio.** `printf 'null\n' | node tools/mcp-hseos-governance/index.js` sobre banco ativado sai com 1 e `TypeError: Cannot convert undefined or null to object` em `tools/lib/mcp-2026-adapter.js:1194` (`Object.hasOwn(message, 'id')`); o legado responde `-32600`. Os valores `1`, `"x"`, `[]` e `true` recebem `-32600` normalmente. Reproduzido nos 3 servidores nativos de stdio; `runs/null-line-crash.txt`. Exposição baixa (o par stdio é o cliente que o iniciou), mas é regressão de robustez em relação ao legado e o `mcp-journey` a detecta. Falta o ramo de `null` antes de `hasOwn`.
- **F2 — o `mcp-journey.mjs` não mede o modo moderno.** Ele remove `HSEOS_STATE_DB` do ambiente, deixa o axon-bridge legado nesse journey (causa não investigada; o `cwd` e a ausência de `HSEOS_STATE_DB` são os suspeitos) e declara em `limitacoes` que só exercita o caminho legado; sobre banco ativado ele falha pelos motivos de F1 e do envelope. O ADR-0048 (c) e o PLAN pedem "mcp-journey em modo moderno": isso exige alterar o journey (flag `--mode modern`, cliente 2026-07-28), o que está fora do escopo desta task. `modern-journey.mjs` cobre contagens e host, mas **não** os negativos de escopo (travessia de caminho, symlink) do swarm no modo moderno: esses 16 negativos ficaram sem prova por causa da cascata de F1.
- **F3 — as contagens do ADR-0048 (c) estão imprecisas.** O texto diz "contagens 15/15/5 por servidor, inclusive `environment.*` e `memory.*`". Medido: governance 15, project-state 15, swarm 5 (catálogos próprios, sem `environment.*`/`memory.*`), axon-bridge 6. As ferramentas `memory.*` (+3) e `environment.*` (+6 com `workspace`) entram **somente no project-state e somente com a seção `environment:`**. Hoje nenhum outro `index.js` passa `environmentHost` (o runbook §3c já diz que é só o project-state; o PLAN K5 falava dos quatro).
- **F4 — o hover real exige cgroup delegado.** Fora dele, `environment.lsp.hover` devolve `ENGINEERING_ISOLATION_UNAVAILABLE` ("A delegated parent cgroup is required"), como visto na primeira execução desta task. Um MCP iniciado por Codex ou Claude Code a partir de `~/.codex/config.toml` **não** roda em cgroup delegado por padrão. Sem tratar isso (por exemplo, lançar o servidor com `systemd-run --user -p Delegate=yes`, como o `run-in-cgroup.sh`), a verificação de `environment.*` do passo 1b do runbook tende a falhar no cliente real. **Não verificado com cliente real:** nenhuma `tools/call` de `environment.*` foi feita por Codex/Claude Code.
- **F5 — achados herdados da K3** que afetam o `apply` real: `unscannable_processes` ≈ 390; WAL com dados no banco piloto (caminho do checkpoint não exercitado); `g9-zero-legacy-window` ainda listado pelo ensaio; 18 `project.db` encontrados em vez dos 21 do ADR (ver `../k3/README.md`).

## NOT_EXERCISED

- Codex `tools/call` e aprovação MRTR (modelo/login; autorização do owner).
- Claude Code MRTR com `accept` por humano e modo interativo (só `-p`).
- `tools/call` de `environment.lsp.hover`, `memory.write`/`retrieve` **por cliente real** (feitas apenas pelo harness `modern-journey.mjs`).
- `test/test-mcp-2026-adapter.js` e `test/test-mcp-contract.js` (critério (a)).
- Axon real (sem `axon` no PATH do journey; `AXON_UNAVAILABLE` conferido).
- Instalação a partir do registro (dependências por symlink do checkout).

## Arquivos

- `modern-journey.mjs` — harness moderno (contagens, compat legada, host).
- `activate-db.cjs`, `modern-db-activation.json` — preparo do banco ativado descartável.
- `stdio-tee-activated.cjs` — proxy de frames sobre o servidor do pacote instalado (derivado de `../k1/stdio-tee.cjs`).
- `claude-runs.sh` — as execuções do Claude Code.
- `journeys/` — resultados do `mcp-journey` (controle v4, cliente legado sobre ativado, `classification.json`) e do `modern-journey`.
- `frames/` — frames resumidos (Codex e Claude Code run 1; catálogos colapsados em nomes e contagem, tokens de estado truncados).
- `runs/` — saída redigida do `codex exec`, custos e sequência de frames das 8 execuções, contador legado, hashes de configuração, suíte `test-mcp-activated-mode.js`, reprodução de F1.

## Reproduzir

```bash
export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH
npm pack --pack-destination "$K/pack"                      # depois extrair em $K/consumer/node_modules/hseos e ligar node_modules do checkout
node docs/evolution/w10/evidence/k7/activate-db.cjs "$PWD" <backup-v4> "$K/cm/.hseos/state/project.db" "$K/cm-backups/b"
/build/tmp/hseos-w5/bin/run-in-cgroup.sh "$PWD" "node docs/evolution/w10/evidence/k7/modern-journey.mjs --modern $K/cm --control $K/cl --host $K/ch --toolchain /build/cache/hseos-toolchain --scratch $K/scratch --out $K/out"
```

O scratch (`/build/tmp/hseos-w5/closeout/k7*`, `k3*`, o `CODEX_HOME`) foi removido ao final; a evidência arquivada é este diretório.

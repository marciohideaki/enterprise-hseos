# Plano — Conclusão: W6, ativação governada do servidor moderno, ativação global (W8) e higiene (W9)

## Context

O fechamento W1–W5 já está na master: W0 a W5 mergeadas (#235–#241, `953949a0`). A W6 está integrada em `feature/hseos-w5-closeout-w6` (`5962ae66`) com CI verde, mas ainda sem PR.

O owner pediu para entregar **compilado, validado e funcional no global** tudo o que foi listado como "o que falta":
- fechar a W6;
- fazer a ativação W8;
- fazer a higiene W9;
- resolver as dívidas:
  - host de produção;
  - admissão no `agent run`;
  - ADR do sunset.

**Decisões do owner (2026-10-21/22):**

| Tema | Decisão |
|---|---|
| Dívidas | As três entram |
| W8 | Autorização em lote com gates: cada passo só avança com verificação e rollback testado; falha para e reporta |
| Contratos e timer | Só no enterprise-hseos |
| Tags e higiene | Push das tags + remoção de worktrees/branches mergeados + limpeza de temporários |
| Gate MCP | **Mudar o critério de ativação por ADR e ativar o servidor MCP moderno** com o host de ambiente/memória |
| Modelo | Execução em Sonnet |

**Fatos que moldam o plano (mapeamento somente leitura, 2026-10-22):**
- **Ninguém monta o host em produção.** Nenhum chamador de produção monta `environmentHost` nem o store de memória. As ferramentas MCP de `environment.*`/`memory.*` existem **só no servidor moderno**, que sobe apenas em fixture: exige `NODE_ENV=test` + `HSEOS_GOVERNED_EXECUTION_FIXTURE=1`, banco novo em `tmpdir` e lança `EXECUTION_ACTIVATION_PENDING` (`tools/lib/governed-execution/native-mcp-server.js:118-129`).
- **Não existe caminho de ativação sobre banco existente.** As migrations 005–017 ficam em `tools/mcp-project-state/migrations-pending-activation/`, e o runner só avança, sem downgrade. O servidor legado se recusa a abrir banco ativado (`assertOperationalSchemaBoundary`, `operational-state-db.js:26-37`).
- **O critério dos ADRs é inalcançável no prazo.** ADR-0022 L117 e ADR-0023 L71 (Accepted, em `.enterprise/.specs/decisions/`) exigem 30 dias de zero uso legado e ativação até 2026-10-31. A telemetria mostra uso legado em 10-20, e o próprio uso normal do Codex conta como legado. Mudar isso exige **ADR novo aceito por humano**.
- **O escopo global real é um banco só.** O Codex global fixa `HSEOS_STATE_DB` no `project.db` do enterprise-hseos para os 3 MCPs. O Claude Code não registra MCPs hseos. Há 22 `project.db` no host; só o do enterprise-hseos (`user_version` 4) será migrado. Os outros ficam intocados.
- **`agent run` não passa pela admissão.** `readEngineeringTask` usa `admission=false` (`engineering-task-contract.js:407`). O caminho admitido é `parseCreationInput(..., {admission:true})` (`engineering-control.js:71`).
- **G3 sem folga:** tools 393/393 e packages 137/137. Nenhum arquivo novo em `tools/` ou `packages/`. ADR novo cabe em `.enterprise/.specs/decisions/`, e testes cabem em `test/`.

## Execution Protocol

**Coordenação:** skill `dev-squad` / agente `SWARM`. Fontes: `.enterprise/governance/agent-skills/dev-squad/SKILL.md` e `.hseos/workflows/dev-squad/workflow.md`. A run continua em `.hseos/runs/dev-squad/20261020-w5-closeout/`: PLAN.md ganha seção nova, STATUS.md e `prompts/COMMON.md`.

**Modelo, por decisão do owner "Execução em Sonnet":**
- Após aprovar este plano, a sessão principal troca para **Sonnet** (`/model sonnet`) e atua como Commander: coordena, extrai handoffs, integra e não implementa.
- Todo executor e todo revisor é um Agent com `model: "sonnet"` explícito.
- Opus não executa.

**Tier matrix:**

| Tamanho | Tier | Tasks |
|---|---|---|
| small | Sonnet | E7, K1, K6, W9 |
| medium | Sonnet | G0 (ADR), K3, K4, K7 |
| large | Sonnet, com revisor independente obrigatório e escalada de rigor | K2 (ativação/backup do banco), K5 (host de produção) |

**Invariantes de governança** (iguais às da run; detalhes em `prompts/COMMON.md`):
- 1 task = 1 commit em `task/<id>`, worktree isolado. Merges `chore(merge): integrate <task> into <feature>`.
- Commit via `/build/tmp/hseos-w5/bin/commit-in-cgroup.sh` com `NO_ADD=1` e Node 24.15 no PATH. Sem `--no-verify`, sem `git stash`, sem bypass de hook.
- Mensagens e PRs sem menção a IA e sem `Co-Authored-By`. Nada em `/tmp` literal.
- §3f: `uptime`/`heavy-run`; no máximo 1 suíte pesada por vez; no máximo 2 executores com build.
- Revisão cética isolada em duas passagens (cega + confronto), presa ao SHA, com mutação que prova cada teste. No máximo 3 rodadas de correção.
- Nunca afrouxar gate, threshold, assert nem o teste `test-environment-production-callers.js`. Esse teste muda **só** para permitir os chamadores novos com as mesmas garantias (ledger real, host só após admissão).
- G3: nenhum arquivo novo em `tools/` ou `packages/`; `npm pack --dry-run --json` (npm do Node 24) em toda task que toque `tools/`.
- CI no GitHub: polling ≥120 s, sem `gh run watch`.
- NO SILENT IDLE + linha LIVENESS em todo prompt de executor.

**Gates humanos:**
- **G-ADR:** o ADR novo é escrito como `Proposed`. A migração do banco real (W8 passo 1b) e a troca dos MCPs para o moderno **só acontecem depois que o owner marcar o ADR como Accepted**. O agente nunca marca Accepted.
- **Merge:** autorização durável do owner para as PRs da W6 e da W10 (CI verde + CLEAN, `hseos pr closeout --approved --keep-branch`).
- **W8:** autorização em lote com gates. Para no primeiro BLOCKED.
- **Credenciais/gasto:** nenhum previsto.

**Versionamento por onda:**

| Momento | Ação |
|---|---|
| Após o merge da W6 | Tag `hseos-w5-closeout-w6` |
| Após o merge da W10 | Tag `hseos-w5-closeout-w10` |
| Na W8 | Push de `hseos-w5-g6` e de todas as `hseos-w5-closeout-*` (autorizado) |

Ao fechar cada onda: `docs/evolution/w5/STATUS.md` e vault (work-log, state, activity-log).

**Mapa de ondas:**

| Onda | Branch | Depende de |
|---|---|---|
| W6 | `feature/hseos-w5-closeout-w6` | — |
| W10 | `feature/hseos-w5-closeout-w10` | master pós-W6 |
| W8 | sem branch | W10 mergeada + ADR Accepted |
| W9 | — | W8 verificada |

Ordem e paralelismo:
- DAG: `W6 → W10 (G0 ∥ K1 ∥ K6) → (K2 → K3) ∥ (K5 após K6) → K4 → K7 → W8 → W9`.
- G0 (ADR) corre em paralelo e precisa estar Accepted antes da W8.

## Ondas

### W6 — fechar (feature já integrada)
- **E7 (small, docs):** registro final de resíduos em `docs/evolution/w5/STATUS.md`, um a um, com justificativa e dono, a partir de "Desvios registrados" do PLAN.md:
  - flakies e mutantes;
  - PEM/JSON.parse no diagnóstico;
  - (f)/(h) sem detecção de fator constante;
  - fio legado MCP sem `error.data.code`;
  - SIGKILL do zip;
  - CSP sem console;
  - varredura de `pids_max` limitada a 5 arquivos;
  - flaky do hook leve;
  - 5 falhas ambientais de `test-provider-campaign-adapters` fora do cgroup.

  Itens que a W10 resolve ficam marcados "→ W10".
- **E7b (small, docs):** atualizar `docs/evolution/runbooks/activation.md`:
  - novo passo 1b (ativação do banco + troca dos MCPs para o moderno);
  - referência ao ADR novo;
  - composição de host;
  - remover "servidor moderno fora desta ativação".
- **Fechamento:** revisão cética → merge na feature → PR da W6 → merge (autorização durável) → tag local.

### W10 — ativação governada e host de produção (`feature/hseos-w5-closeout-w10`)

**G0 — ADR novo (medium, `.enterprise/.specs/decisions/ADR-00NN-governed-execution-activation-criterion.md`, Proposed)**
- Supersede ADR-0022 L117 e ADR-0023 L71. Atualiza o ADR-0024 L132 por referência.
- Novo critério de ativação, por banco (piloto = `project.db` do enterprise-hseos):
  - (a) suíte de contrato moderna verde sobre **banco existente ativado**;
  - (b) ensaio de ativação + rollback em cópia (`agentic-activation-rehearsal.js`) e backup com `integrity_check` + sha256;
  - (c) journey MCP moderno com contagens de ferramentas conferidas;
  - (d) prova com cliente real (Codex) via `tools/list`/`tools/call`;
  - (e) janela de compatibilidade legado-dentro-do-moderno mantida.
- Sunset do legado: deixa de ser a data fixa 2026-11-30 e passa a ser condicional à evidência de que os clientes registrados (Codex, Claude Code) falam `2026-07-28` (resultado do K1). Data-limite nova proposta com base no K1. Sem essa evidência, a compat continua.
- Rollback: restaurar o backup + re-registrar o legado. A perda de escritas pós-ativação fica aceita explicitamente, reconciliando com o ADR-0022 L160-164.
- Escopo: um banco por vez. Os outros 21 `project.db` ficam fora até ADR/autorização própria.
- Checklist de compliance (ADR-0022 L138-144, ADR-0023 L87-91) ligado à evidência.
- Atualizar o índice de ADRs e os documentos citados em ADR-0022 L133.
- **Owner aceita (G-ADR).**

**K1 — spike de protocolo dos clientes (small, somente leitura + fixture)**
- Verificar com o servidor moderno em fixture:
  - quais versões de protocolo MCP o Codex instalado (`codex --version`) e o Claude Code negociam;
  - se executam `tools/list`/`tools/call` em `2026-07-28` ou só via compat `2024-11-05`;
  - se o fluxo de aprovação MRTR (`input_required`) funciona.
- Saída: evidência para o G0 e o K7, em `docs/evolution/w10/evidence/k1/`.

**K6 — admissão no `agent run` (small)**
- `readEngineeringTask(filename, {admission})` repassa a opção até `parseEngineeringTask`, cobrindo também o caminho `hydrateProjectTask`/schema v2 (`engineering-task-contract.js:407,427`).
- `runEngineeringTask` e `validate-task` leem com `admission:true` (`engineering-task-runtime.js:603`, `tools/cli/commands/agent.js:59,77`).
- O worker continua com `admission:false` por design (`job-worker.js:151-157`).
- Testes adversariais: contrato sem cobertura de aceite → `ENGINEERING_ACCEPTANCE_UNCOVERED`; config protegida ausente; contrato v2.
- Mutação: admissão desligada → vermelho.

**K2 — ativação do banco existente com backup (large)**
Em `tools/mcp-project-state/lib/operational-state-db.js`, sem arquivo novo: `activateExecutionLedger(path, {backupDir, dryRun})`.
1. Recusa se houver servidor/CLI com o banco aberto (lock exclusivo).
2. Checkpoint do WAL.
3. Backup via `db.backup` para diretório datado, com `integrity_check` + sha256 do backup e do original.
4. Aplica 005–017 numa transação, reaproveitando o runner `migrations.js` e o `PENDING_MIGRATIONS_DIR`.
5. Grava o receipt de ativação no próprio banco/diretório: commit, ADR, hashes, `user_version`.
6. `dryRun` só relata.

Mais:
- Rollback (`restoreExecutionLedgerBackup`): confere o hash do backup e restaura atomicamente, com servidores parados.
- Comando CLI num arquivo existente (`tools/cli/commands/agent-activation-rehearsal.js` ou `compatibility-audit.js` + `tools/cli/command-manifest.json`): `hseos execution-activation plan|apply|rollback --db <path> --adr <id>`. Exige `--adr` apontando para ADR Accepted e recusa sem isso.
- Testes em `test/`, com banco v4 populado real:
  - apply preserva dados;
  - `user_version` 17;
  - legado passa a recusar;
  - rollback volta a v4 com hash idêntico;
  - lock recusa;
  - backup corrompido recusa;
  - ADR ausente/Proposed recusa.

**K3 — ensaio integrado (medium):** rodar o ensaio (`agentic-activation-rehearsal.js`) sobre **cópia** do `project.db` real do enterprise-hseos, com apply e rollback. Evidência em `docs/evolution/w10/evidence/k3/`. Somente cópia, nunca o original.

**K4 — servidor moderno e CLI aceitam banco ativado fora de fixture (medium)**
- `native-mcp-server.js` e os 4 `index.js` (`mcp-hseos-governance`, `mcp-hseos-swarm`, `mcp-project-state`, `mcp-axon-bridge`) e `tools/cli/lib/governed-action.js`.
- Modo moderno quando o banco tem receipt de ativação válido (ADR Accepted + `user_version` 17). Caso contrário, legado como hoje. O caminho de fixture fica intacto.
- Recusa explícita e acionável se o banco estiver ativado e o cliente pedir o legado após o sunset definido pelo ADR.
- O sunset passa a vir da constante/config definida pelo G0 (`mcp-2026-adapter.js:33`), sem afrouxar a recusa.
- Testes:
  - banco v4 → legado;
  - ativado → moderno;
  - ativado sem receipt → recusa;
  - paridade de `tools/list` com contagens;
  - `scheduler_sweep_orphans` só no project-state.

**K5 — host de produção (large, depois do K6)**
- `createProductionEnvironmentHost(config)` em `tools/cli/lib/engineering-task-extensions.js` (sem arquivo novo), reaproveitando:
  - `createTaskEnvironment`, `createEnvironmentBundles`, `createGovernedMemory` (`memory-context-source.js:23`);
  - `createMemoryDeleteApprovals`, `createApprovalGate` (`environment-approval.js:47`), `createEnvironmentLedgerSink` e `ExecutionApprovalStore`;
  - o modelo de `test/helpers/environment-fixtures.js`.
- Config em `~/.config/hseos/config.yaml`, seção nova `environment:`:
  - raiz do cache de toolchain (provisionado por `prepareLspToolchain`/pins);
  - `memory.rules` (deny por padrão, regras do enterprise-hseos);
  - `memory.operator` (`kind: operator`);
  - perfis de isolamento (bwrap).
  - Sem config → host ausente → comportamento atual (`ENV_CAPABILITY_UNAVAILABLE` / `ENGINEERING_ENVIRONMENT_HOST_REQUIRED`).
- Ligações:
  - **MCP moderno:** os 4 `index.js` passam `environmentHost` (factory sobre o wiring `{ledger, approvalStore, resolveMemoryDeleteApproval}`) quando o banco está ativado. A memória fica **durável no `project.db` ativado**.
  - **CLI `agent run`:** `agent.js` passa o host. `inspect`/`resume` recebem o mesmo host, ligado ao contrato admitido (K6). A memória usa o ledger da tarefa. Memória durável pela CLI só se o banco do projeto estiver ativado: se ativado, `store` no `project.db`, senão no ledger da tarefa, com aviso.
- `test-environment-production-callers.js`: incluir os novos chamadores **mantendo** as garantias (ledger real obrigatório, nenhum ledger no-op, host só após admissão, `createGovernedMemory` só no compositor) e acrescentar o assert de que `agent run` admite antes de montar o host.
- Testes:
  - host montado da config;
  - LSP hover real via CLI;
  - `memory.write` → `memory.retrieve` em **duas tarefas** com banco ativado;
  - `memory.delete` exige operador + aprovação;
  - `computer.*` exige aprovação;
  - config ausente → indisponível;
  - credencial nunca no ledger.

**K7 — prova ponta a ponta no modo moderno (medium)**
- `test/journeys/mcp-journey.mjs` em modo moderno sobre o tarball instalado num prefixo descartável, com banco ativado (cópia): 4 servidores, stdio e HTTP, contagens conferidas.
- `w5-environment-journey.mjs` com host de produção.
- Cliente real: Codex `exec` contra o servidor moderno numa config **isolada** (`CODEX_HOME` descartável), fazendo `tools/list` + uma `tools/call` de `environment.lsp.hover` e `memory.write/retrieve`.
- Evidência em `docs/evolution/w10/evidence/k7/`.

**Integração W10:** revisão cética por task → feature → CI → PR → merge (autorização durável, já que o owner pediu o pacote completo; o ADR precisa estar Accepted antes do merge do K4, que só liga com receipt) → tag local.

### W8 — ativação global (lote com gates; só sobre a master final; pré-condição ADR Accepted)

Runbook: `docs/evolution/runbooks/activation.md` (atualizado na E7b). Fixar `PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH`. Cada passo segue a sequência backup → execução → verificação → rollback testado em descartável → receipt em `~/.local/state/hseos/distributions/<SHA>/`. A primeira falha vira BLOCKED e para.

1. **Distribuição global do SHA final:**
   - tarball + release imutável `/workspace/local/tooling/hseos-releases/<SHA>`, instalação global, `verification.json` no formato dos anteriores;
   - smoke: `hseos --version`, `liveness --help`, `activity --help`, `governance-context`, `execution-activation --help`, journey MCP;
   - rollback para `2b4d6f37` testado em prefixo descartável.
   - Atualizar o pin do `governance-context` em `~/.claude/AGENTS.md` §0.6 e nos hooks que apontam para o release antigo. Backup antes.
2. **1b — ativação do banco + MCP moderno:**
   - parar as sessões que usam os MCPs hseos;
   - `hseos execution-activation plan` → `apply --adr <id>` no `project.db` do enterprise-hseos, com backup e receipt;
   - trocar o `~/.codex/config.toml` (3 MCPs) para o release novo.
   - Verificar: Codex real lista as ferramentas modernas (incluindo `environment.*`/`memory.*`) e faz uma chamada de cada família; `hseos liveness check --json`.
   - Rollback testado em cópia; o rollback real fica documentado.
3. **Hooks Codex com `trusted_hash`:** template `docs/activity-coordination/codex-hooks.template.json` apontando para o release; trust via `hooks/list`; receipt.
4. **Timer do watchdog:** units impressos do release (`liveness watch --print-systemd --directory <enterprise-hseos>`); `systemd-analyze verify`; enable; um ciclo com exit 0; informar o linger.
5. **Contratos no enterprise-hseos:** `agent-liveness.yaml` e `activity-coordination.yaml` `enabled: true` em commit próprio via PR curta (autorização durável de merge). Observar um ciclo; `activity register/check`.
6. **Push das tags** `hseos-w5-g6` e `hseos-w5-closeout-w0..w6,w10`.
7. **Repasse ao Codex (design-system):** fica com o owner, por ser entrega humana. Apenas lembrar.

### W9 — higiene (autorizada)
- Remover os worktrees `.worktrees/*` e as branches `task/*`/`feature/hseos-w5-*` já mergeadas, local e remoto.
  - Antes de remover: `git status` limpo e `merge-base --is-ancestor` com a master.
  - Preservar `HSEOS-GOAL-HARNESS-AUTONOMO.md` e qualquer worktree com mudança não mergeada (reportar).
- Limpar `/tmp/hseos-executor-filter-*`, `/build/hseos-qg-tmp` e o scratch de `/build/tmp/hseos-w5`.
  - Preservar `codex-design-system-relay.md`, copiando-o antes para o vault.
  - **Não** apagar releases em `/workspace/local/tooling/hseos-releases/` nem receipts.
- `dotnet`/daemons: não aplicável. Encerrar os agentes da run.
- `/end-session` final (vault, CONTINUITY).

## Arquivos críticos
- `tools/mcp-project-state/lib/{operational-state-db,migrations,execution-ledger-schema,mcp-legacy-usage-store}.js`
- `tools/lib/governed-execution/{native-mcp-server,operational-runtime}.js`, `tools/lib/mcp-2026-adapter.js`, `tools/lib/legacy-mcp-server.js`
- `tools/{mcp-hseos-governance,mcp-hseos-swarm,mcp-project-state,mcp-axon-bridge}/index.js`, `tools/cli/lib/governed-action.js`
- `tools/cli/lib/{engineering-task-extensions,engineering-task-runtime,engineering-task-contract,memory-context-source,environment-approval}.js`
- `tools/cli/commands/{agent,agent-activation-rehearsal}.js`, `tools/cli/command-manifest.json`, `tools/lib/agentic-activation-rehearsal.js`
- `test/test-environment-production-callers.js`, `test/test-package-surface.js` (G3), `test/helpers/environment-fixtures.js`
- `.enterprise/.specs/decisions/ADR-0022/0023/0024` e o ADR novo
- `docs/evolution/runbooks/activation.md`, `docs/evolution/w5/STATUS.md`

## Verificação
- **Por task:**
  - testes vermelhos primeiro;
  - arquivos tocados rodados um por vez no cgroup;
  - prettier/eslint `--max-warnings=0`;
  - `test:kernel-coverage` (90/80) se tocar o kernel;
  - G3 via `npm pack`;
  - revisão cética com mutação.
- **Por onda:** CI 22.x/24.x + governance + smoke de ambiente limpo verdes; WAVE-REPORT.
- **W10 (aceite):**
  - banco v4 real copiado → `apply` → moderno serve 4 servidores com contagens conferidas;
  - Codex real faz `tools/list` e chamadas `environment.lsp.hover` e `memory.write/retrieve` entre duas sessões;
  - rollback restaura v4 com hash idêntico;
  - `agent run` recusa contrato sem cobertura de aceite;
  - `agent run` com host faz hover LSP real e memória entre tarefas.
- **W8 (aceite global):**
  - `hseos` global = SHA final (sha256 do tarball = receipt);
  - Codex global usa o moderno sobre o `project.db` ativado;
  - hooks `trusted`;
  - timer com um ciclo exit 0;
  - contratos ligados com um ciclo observado;
  - tags no remoto;
  - todos os receipts gravados;
  - rollback de cada passo testado.
- **Final:** master verde; W9 sem worktree/branch órfão; vault e CONTINUITY atualizados.

## Riscos e decisões humanas
- **ADR Accepted pelo owner** é pré-requisito duro da W8 passos 1b em diante. Sem ele, a W10 mergeia com o moderno inativo, porque o K4 só liga com receipt, e a W8 para no 1b.
- **Rollback do banco perde escritas pós-ativação** (aceito no ADR).
- **Clientes legados:**
  - Se o K1 mostrar que o Codex/Claude Code só falam `2024-11-05`, o ADR mantém a compat sem data fixa até haver suporte.
  - Se o Codex não funcionar com o moderno, a W8 1b fica BLOCKED e o banco não é migrado.
- **Os outros 21 `project.db` ficam intocados.** Abrir o moderno com `HSEOS_STATE_DB` de outro projeto continua no legado, já que não há receipt.
- **Hash dos hooks muda a cada redistribuição:** o passo 3 vem depois do 1/1b.

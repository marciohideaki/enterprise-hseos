# Plano — Fechamento completo da fundação W1–W5 (pré-W6)

## Context

Depois da W5 (G6 #230) e da bateria em sessão ligada (T2 #231, T3 #232 mergeadas; T4 #233 aberta), o inventário spec × código mostrou que a fundação **não está conforme**. Os problemas:

- **Master com CI vermelho em dois pontos:**
  - Testes de liveness do state-ui. É uma bomba-relógio, consertada na #234, ainda aberta.
  - `test-engineering-model.js` no Node 24.22, ainda sem diagnóstico. Hipótese: o broker de egress por socket Unix.
- **Não conformidade central da W5:**
  - LSP, DAP, navegador, computer-use e memória existem como pacotes testados, mas **sem chamador de produção**. Não passam por ToolRuntime nem por política.
  - `browser.run`, `computer.*` e `memory.*` seguem stubs `NOT_IMPLEMENTED` (`tools/lib/governed-execution/contract-registry.js:219-225`).
  - Os eventos `environment.*` vão para um ledger no-op (`ledger = () => {}`).
  - `memory-context-source.js` não alimenta o `memory[]` do assembler. A spec exige isso em FR03 e FR06-FR09.
- **Achados de produto da bateria:**
  - O contrato gerenciado recusa arquivo acima de 64 KB, o que impede a T1 (guard de 123 KB).
  - O contador de tokens reprova a sessão no último passo, e `budget_exceeded` vira `session-not-completed` sem dica.
  - A faixa de `pids_max` está duplicada.
  - O state-ui não envia CSP.
- **Waiver da W5-10b:** ainda falta o schema que liga cada critério de aceite a um check executável.
- **Docs desatualizadas:**
  - `verification-receipt` ainda diz "contexto v1".
  - `docs/evolution/STATUS.md` diz "sem merge para a master".
  - `requirements.json` tem famílias `not_verified` sem evidência citável.
  - A traceability não tem caso negativo para FR04, FR11, FR13 e FR15.
  - Os mutantes M09, M18b e N5 contradizem o receipt.
- **Pendências operacionais:** ativação pós-G6, T1 e L4 da bateria, tag `hseos-w5-g6` não enviada e higiene de worktrees e `/tmp`.

**Resultado esperado:** master verde e a fundação W1–W5 conforme a spec. As capacidades passam a estar ligadas e testadas em produção, os achados de produto ficam corrigidos e os docs coerentes. A ativação fica executada passo a passo com a autorização de cada passo. A matriz evolutiva e a 4ª família ficam **preparadas, sem execução**. O que restar fica registrado como resíduo aceito com justificativa.

**Decisões do owner já tomadas (2026-10-20):**
- Protocolo dev-squad.
- Escopo: código/testes/docs, ativação, preparação da matriz e da 4ª família, e bateria restante.
- As PRs em voo (#233 e #234) entram no plano.
- Capacidades: ligar tudo.
- Matriz e 4ª família: preparar, sem executar.
- Arquivo grande: leitura e patch por janela.
- Orçamento de tokens: checado antes do passo, com causa explícita. Uma sessão concluída com `stop` não falha por estimativa.
- Migration 017: edição no lugar.
- `forget`: exige operador **e** aprovação.
- Branches: uma `feature/*` por onda.

## Execution Protocol

**Coordenação:** skill `dev-squad` / agente `SWARM`.
- Fontes: `.enterprise/governance/agent-skills/dev-squad/SKILL.md` e `.hseos/workflows/dev-squad/workflow.md`.
- **Commander** = sessão principal em Opus: planeja, extrai handoffs de no máximo 40 linhas, consolida e não implementa.
- **Squad** = subagentes Sonnet com `model: "sonnet"` explícito, em worktree isolado. Opus em execução não é permitido.
- **Revisores céticos** = Sonnet, isolados, em duas passagens (cega, depois confronto) e presos ao SHA. Reportam e não corrigem.
- Run dir: `.hseos/runs/dev-squad/20261020-w5-closeout/`, com INTAKE, PLAN, STATUS, `handoffs/`, `prompts/`, `logs/` e `WAVE-N-REPORT.md`.

**Tier matrix:**

| Tamanho | Tier | Tasks |
|---|---|---|
| trivial | Haiku | — |
| small / medium | Sonnet | maioria |
| large | Sonnet (high), com revisor independente obrigatório | C6 (bundles + aprovação + teardown) |

Escalada de um tier por segurança: C2 (`forget` com aprovação) e C6.

**Invariantes de governança:**
- 1 task = 1 commit numa `task/<id>` criada por `scripts/governance/worktree-manager.sh create <id> feature/hseos-w5-closeout-wN`.
- Validação e commit via `worktree-manager.sh validate|commit`, rodados dentro do cgroup (`/build/tmp/hseos-w5/bin/run-in-cgroup.sh`), com o túnel Postgres 39317 aberto só durante o commit. Na W0 confirmo que `worktree-manager.sh commit` e `commit-in-cgroup.sh` aplicam o mesmo `validate-commit-msg.sh`.
- Hooks do husky gerados em cada worktree novo (`node node_modules/husky/bin.js`).
- Mensagens sem `Co-Authored-By` e sem citar IA ou fornecedor (assunto e corpo). Sem `--no-verify`, sem `git stash`, sem push de `task/*`.
- Arquivo da mensagem de commit fora do `$TMPDIR` compartilhado, em `/build/tmp/hseos-w5/<run>/`.
- Cláusula **NO SILENT IDLE**, copiada verbatim do SKILL.md, em todo prompt de executor. Espera em primeiro plano em blocos de no máximo 540 s, com a linha `LIVENESS` final. O Commander trata LIVENESS ausente como BLOCKED.
- Fila do `heavy-run` morta com exit 143 por job alheio: repetir desacoplado (`setsid nohup`), sem tocar em processo alheio.
- §3f: `uptime` antes; no máximo 1 suíte ou build pesado por vez; no máximo 2 executores com build simultâneo.
- §3k: nada em `/tmp` literal.
- **G3 sem folga:** nenhum arquivo novo em `tools/` (393/393), `packages/` (137/137) nem em área publicada.
  - Arquivos novos só em `test/`, `docs/evolution/` e `.specs/`, todos fora do pacote.
  - Cada task confere `npm pack --dry-run --json` com o npm do Node 24.
  - O gate é `test/test-package-surface.js:120-143`.
- Cobertura 90/80 por arquivo do kernel (`.c8-kernel.json`). Nunca afrouxar gate, threshold ou assert. Bloqueio é reportado como BLOCKED ou FAIL, nunca PASS.
- No máximo 3 rodadas de correção por task. Na terceira sem progresso: análise de causa raiz e mudança de estratégia registrada no PLAN.md.

**Gates humanos:**

| Gate | O que é |
|---|---|
| G2 | Aprovação deste plano (ExitPlanMode) |
| G3 | Onda com BLOCKED ou flag de risco |
| G4 | Abertura da PR da onda, com OK do owner |
| G5 | Merge só com "merge autorizado" explícito, via `hseos pr closeout <n> --approved --keep-branch` |

Ativação, push de tag, gasto e credencial: autorização própria para cada um.

**Versionamento por onda:**
- Após o merge de cada onda: tag anotada local `hseos-w5-closeout-wN` (push só com autorização).
- `docs/evolution/w5/STATUS.md` e `WAVE-N-REPORT.md` atualizados.
- Vault ao fechar cada onda: work-log, state e uma linha no activity-log.

## Ondas (DAG)

`W0 → (W1 ∥ W3) → W2 → W4 → W5 → W6 → W8`. A W7 corre em paralelo a partir da W1, porque é só documentação. A W9 fecha o plano.

### W0 — Master verde e PRs em voo (PR por item; exceção: já em voo)
- **W0-1 (small, investigação):** diagnosticar `test/test-engineering-model.js:109` no Node 24.22.
  - Reproduzir só esse arquivo.
  - Imprimir `terminal_event.payload` da sessão.
  - Suspeito: `createUnixSocketFetch` em `tools/cli/lib/provider-egress-broker.js:250`.
  - Corrigir a causa sem afrouxar o teste. Fixar o Node no `ci.yaml` só se for regressão do próprio Node, com issue registrada.
- **W0-2:** rebase da #234 (relógio do liveness) depois da W0-1, CI 7/7 e merge autorizado.
- **W0-3:** rebase da #233 (T4) sobre a master, CI 7/7 e merge autorizado.
- **W0-4 (small):**
  - Varrer `test/`, `tools/mcp-project-state/lib/*` e `tools/state-ui*` por default de relógio real contra janela de idade.
  - Criar um modo de teste com relógio avançado (`HSEOS_TEST_CLOCK_OFFSET_DAYS`, harness em `test/`) que prova que nada depende do relógio real.
  - Os 9 arquivos listados na #234 foram classificados como seguros (relógio injetado). O alvo é o restante.

### W1 — Contrato por janela e orçamento de tokens (`feature/hseos-w5-closeout-w1`)
- **A1 (trivial):** mensagem de `budget_exceeded` com os números (projetado, máximo, usado, request e reserva) em `packages/agent-runtime/runtime.js:497-505`.
- **A2 (small):** `engineering-task-runtime.js:~718` passa a ler `terminal_event.payload`.
  - `budget_exceeded` vira `reason: 'session-budget-exceeded'`.
  - As demais falhas viram `session-failed:<code>`.
  - `session-not-completed` fica só para sessão sem terminal.
  - Atualizar `docs/engineering-control-api.md` e os tipos do control SDK.
- **A3 (small):** a checagem pós-passo (`runtime.js:985`) só falha se outro passo for necessário. Uma sessão concluída com `stop` não falha por estimativa.
- **A4 (small):** `PROJECT_LIMITS`:
  - `large_file_chars: 262_144`, `large_files_max: 4` e soma de até 1 MiB.
  - `read_window_bytes: 12_288` e `read_window_lines: 300`.
  - `projectSchema.file.content` aceita até 256 KiB. O v1 continua com 64 KB.
  - Arquivos: `engineering-task-contract.js:25,57` e `engineering-workspace.js:252`.
- **A5 (medium):** `engineering.read` com `start_line`/`end_line` em `tools/cli/lib/engineering-tools.js`.
  - Arquivo grande sem faixa → `ENGINEERING_RANGE_REQUIRED`.
  - Faixa inválida → `ENGINEERING_RANGE_INVALID`.
  - Faixa acima da janela → truncada com `truncated: true`.
  - Respostas trazem `total_lines` e `total_bytes`, campos aditivos.
- **A6 (medium):** `engineering.patch` com `within` opcional para desambiguar `before`.
  - Arquivo grande devolve resultado enxuto (sha, total e linha), sem `content`.
  - `engineering.write` em arquivo grande → `ENGINEERING_WRITE_REQUIRES_PATCH`.
  - Patches sequenciais encadeiam a sha.
- **A7 (medium):** `engineering.diff` por faixas em arquivo grande, com teste ponta a ponta sobre um arquivo sintético de cerca de 123 KB: search → read por faixa → patch → diff → verificador.
- **A8 (trivial):** a instrução do runtime (`profile://engineering/candidate`) orienta search, leitura por faixa e patch curto.
- **Testes adversariais** (faixa inválida, sha velha, `before` ambíguo dentro e fora da janela, path traversal, symlink, quinto arquivo grande) vão em `test/test-engineering-{tools,workspace,task-contract,task-runtime}.js` e `test/test-agent-runtime.js`.

### W2 — Aceite por critério (`feature/hseos-w5-closeout-w2`; depois da W1, mesmo arquivo de contrato)
- **B1 (small):** schema opcional `acceptance[].check_ids` e `verifier.checks[].id`.
  - Espaço de ids único com `command_checks[].command_id`.
  - O id não vai ao script do probe.
  - "Se um critério declara `check_ids`, todos declaram."
  - Novos erros: `ENGINEERING_CHECK_ID_UNKNOWN` e `ENGINEERING_CHECK_ID_DUPLICATE`.
  - Contratos antigos mantêm o `contract_sha256`.
- **B2 (medium):** migrar fixtures e exemplos:
  - `tools/examples/{project-task,engineering-task}.js`;
  - `test-engineering-{task-contract,project,control}.js`;
  - `test-w5-{mutations,negative-matrix}.js`;
  - `docs/engineering-task-contract.md`.
- **B3 (small):** a admissão passa a exigir cobertura por critério (`ENGINEERING_ACCEPTANCE_UNCOVERED`), com mutante novo em `test-w5-mutations.js`.
  - Encerrar o waiver em `docs/v4-migration.md` e no receipt da W5-10b.
  - Oficializar a leitura (b): em `*-module-v1` o que fica protegido são as expectativas fixadas na sha do verificador. Teste negativo: `expected` alterado após o pin.

### W3 — Capacidades: base e contratos (`feature/hseos-w5-closeout-w3`; paralela à W1, sem arquivo em comum)
- **C1 (small):**
  - Confirmar que a 017 nunca foi aplicada a nenhum banco.
  - Editar no lugar `tools/mcp-project-state/migrations-pending-activation/017-*.sql` com os 16 tipos `environment.*`.
  - `test/test-agent-memory.js:464` passa a afirmar 20 tipos, com o trigger recusando tipos desconhecidos em SQLite real.
- **C2 (small, escalado):** `forget` em `packages/agent-memory/{store,policy}.js` exige ator `operator` e aprovação de uso único ligada à operação.
  - A aprovação vem do `ExecutionApprovalStore` do host, nunca do payload do modelo.
  - Sem ela → `AGENT_MEMORY_APPROVAL_REQUIRED`.
  - Testes adversariais: sem aprovação, aprovação de outra operação, aprovação reutilizada, ator `agent`.
- **C3 (small):** `createEnvironmentLedgerSink` em `packages/agent-environment/index.js`.
  - Converte em `ledger.append` (`aggregate_type: 'environment_session'`, `expected_version`, ator e correlação), com redação de credencial.
  - Falha de append nunca é silenciosa: fail-closed em ação mutadora.
- **C4 (medium):** trocar os 7 stubs de `contract-registry.js:219-225` por contratos reais (reutilizando os schemas `BROWSER_*`/`COMPUTER_*` dos `*-contract.js` e de `agent-memory/policy.js`), com aprovação para `computer.start/act` e `memory.delete`.
  - **C5** junto: `test/test-mcp-contract.js:487-501` passa de `NOT_IMPLEMENTED` a validação positiva e negativa.

### W4 — Capacidades: ligação ao runtime e ao MCP (`feature/hseos-w5-closeout-w4`; depois de W1, W2 e W3)
- **C6 (large, revisor independente):** `createEnvironmentBundles` em `tools/cli/lib/engineering-task-extensions.js` (sem arquivo novo).
  - Campo opcional `environment.capabilities` no contrato de tarefa.
  - `engineering-task-runtime.js` compõe `tools.bundles`/`allowedTools`.
  - A política devolve `requires_approval: true` para `computer.*` e `memory.delete` via `createApprovalGate` (`tools/cli/lib/environment-approval.js`).
  - `drain()` e `assertQuiescent()` incluem os serviços de ambiente.
  - Capacidade não declarada é negada.
- **C7 (medium):** providers MCP de `environment.*` e `memory.*` em `tools/lib/governed-execution/operational-runtime.js:169` e `native-mcp-server.js`. Sem host → `ENV_CAPABILITY_UNAVAILABLE`.
- **C8 (medium):** memória no assembler. O `context_profile_resolver` monta `memory[]` com `collectMemorySources` governado.
  - A v1 é síncrona, só `store.retrieve`, sem bridge axon.
  - Memória entra como `authority data`. Entrada `untrusted` fica fora, e injeção não vira diretiva.
  - O digest de replay fica fixado.
  - C6 e C8 rodam em sequência, porque tocam o mesmo arquivo.
- **C9 (small):** teste estático de "chamador de produção". `createDefault*Service` precisa ser usado fora do pacote, e nenhum chamador de produção usa o ledger default.
- **C10 (medium):** integração ponta a ponta em SQLite real, com executor fake injetado. Linhas `environment_session` e `agent_memory` no ledger, `memory[]` na segunda tarefa, positivos, adversariais e controles.
- **C11 (small):** a jornada `w5-environment-journey.mjs` passa a afirmar as linhas do ledger, e o CI muda só se for preciso. Atualizar `tasks.md` e o STATUS.
- **C12 (trivial):** os plugins continuam `scaffolded`. Fica registrado que `plugins/` fora de `files` é decisão de ativação.

### W5 — Bateria restante (depende da W1; despacho exige reconfirmação, pois a autorização de 2026-10-17 expirou)
- **D1:** T1, o tokenizer do guard (lacunas de CommonJS).
  - Reaproveitar os testes vermelhos não commitados de `.worktrees/hseos-w5-live-t1` (rebase sobre a master), `/build/tmp/hseos-w5/live/t1/verify-t1.sh` e o harness da T2 (UUID corrigido).
  - Usar o contrato por janela da W1.
  - O despacho (no máximo 3 requisições, custo 0) depende do seu OK. Mesmo fluxo da bateria: prompt mostrado antes, revisão cética e PR.
- **D2:** consolidação L4. Recibo da bateria e custo por atividade (`/build/tmp/hseos-w5/bin/interaction-metrics.py`) sobre executores e revisores de L0, T1–T4 e das correções de liveness, mais o README da live-battery.

### W6 — Conformidade de docs e resíduos de código (`feature/hseos-w5-closeout-w6`)
- **E1 (docs):**
  - Atualizar `w5/evidence/final/verification-receipt.json` (`known_limitations` ainda diz v1).
  - `docs/evolution/STATUS.md` e `spec.md:3`: tirar "sem merge para a master".
  - Tabela de pins do `design.md` (`chrome-headless-shell`).
  - Corrigir a contradição M09/M18b/N5 entre o STATUS e o receipt da W5-07.
- **E2 (docs + evidência):** `requirements.json`, ligando F04, F06, F08, F12, F13, F17, F18 e F21–F23 a evidência citável. Onde não houver evidência, o item fica `not_verified` com a justificativa.
- **E3 (tests):** casos negativos para FR04, FR11, FR13 e FR15 na matriz `test-w5-negative-matrix.js`, e a traceability atualizada.
- **E4 (code):** extração do `chrome-headless-shell` em streaming, sem materializar todas as entradas (`tools/lib/environment-toolchain-pins.js:454-459`), mantendo os limites de 201/335 MB.
- **E5 (code):** fonte única da faixa 32–256 de `pids_max` (`engineering-task-contract.js:104`, `execution-plugin-manifest.js:27`, `profiles.js:67`), respeitando camadas (`test-package-surface`).
- **E6 (code):** header CSP no `state-ui-server` (achado da T4), com teste.
- **E7 (docs):** registro final dos resíduos aceitos em `docs/evolution/w5/STATUS.md`, um a um, com justificativa e dono, incluindo os que passam à W6–W8.
  - Itens: mutantes, LV/CO, `init`/`rate_limit`, `test-plugin-marketplace` sob cgroup, revalidação e consumer-validation.

### W7 — Preparação, sem execução (docs em `docs/evolution/`; paralela a partir da W1)
- **F1:** runbook da matriz evolutiva (18 rodadas iniciais mais ≥30 tarefas ×3, duas famílias e duas stacks, intervalos de confiança agrupados por tarefa).
  - Harness e catálogo de tarefas propostos.
  - Orçamento proposto por campanha (binding, teto e escopo).
  - Nada é despachado.
- **F2:** runbook da 4ª família (Gemini API ou compatível): credencial a pedir, teto, critérios de PASS e a rota Antigravity já validada. A reserva da W4-07b não é reutilizável.
- **F3:** runbook único da ativação pós-G6, com comandos, verificação, rollback e o receipt `~/.local/state/hseos/distributions/<sha>/verification.json`, reaproveitando o procedimento das distribuições anteriores.

### W8 — Ativação pós-G6 (cada passo com autorização própria; só sobre a master final mergeada)
1. Distribuição global do commit final: tarball, smoke de CLI, adapter e MCP, receipt e rollback. O pin atual `2b4d6f37` não tem `hseos liveness` nem `activity`.
2. Hooks Codex com `trusted_hash` em `~/.codex`.
3. Timer systemd do watchdog (`hseos liveness watch --print-systemd`).
4. Contratos ligados nos projetos, um por vez.
5. Texto de repasse ao Codex (`/build/tmp/hseos-w5/codex-design-system-relay.md`) entregue ao owner.

Junto da W8: push da tag `hseos-w5-g6` e das tags `hseos-w5-closeout-wN`, só com autorização.

### W9 — Higiene e registro
- Remover worktrees e branches já mergeados, com autorização: `-l0`, `-t1` (depois de recuperar os testes na D1), `-t2`, `-t3`, `-t4` e `fix-liveness`.
- Limpar os `/tmp/hseos-executor-filter-*` (de 2026-10-12, anteriores ao fix) e `/build/hseos-qg-tmp`.
- Preservar `HSEOS-GOAL-HARNESS-AUTONOMO.md`.
- Vault: CONTINUITY, state, roadmap e work-log.
- `/end-session`.

## Arquivos críticos
- `tools/cli/lib/{engineering-tools,engineering-task-contract,engineering-workspace,engineering-task-runtime,engineering-task-extensions,environment-approval,memory-context-source}.js`
- `packages/agent-runtime/runtime.js`
- `packages/agent-environment/{index,lsp,dap,browser,computer}.js`
- `packages/agent-memory/{store,policy}.js`
- `tools/lib/governed-execution/{contract-registry,operational-runtime}.js`, `native-mcp-server.js`
- `tools/mcp-project-state/migrations-pending-activation/017-*.sql`
- `tools/cli/lib/provider-egress-broker.js`
- `tools/lib/environment-toolchain-pins.js`
- `tools/state-ui-server/`
- `test/test-package-surface.js` (G3)

## Reaproveitar
- `assembleTemporaryKernel` e o formato de bundle de `engineering-tools.js:219-250`.
- `createApprovalGate` (`environment-approval.js`) e `ExecutionApprovalStore` (migration 007).
- `applyExecutionLedgerFixtureSchema` + SQLite `:memory:` (padrão de `test/test-agent-memory.js:28`).
- `collectMemorySources` e `createGovernedMemory`.
- `scanCredential`/redação.
- Schemas lazy no padrão `lspSchema`/`dapSchema`.
- Helpers `/build/tmp/hseos-w5/bin/{run-in-cgroup,commit-in-cgroup}.sh` e `interaction-metrics.py`.
- Harness da bateria T2/T3 (`live-dispatch.mjs` com UUID).

## Verificação
- **Por task:**
  - Testes vermelhos primeiro, que passam depois.
  - Arquivos tocados rodados um por vez no cgroup.
  - Prettier e eslint `--max-warnings=0`.
  - `test:kernel-coverage` quando tocar o kernel (90/80 por arquivo).
  - `npm pack --dry-run --json` com o npm do Node 24: `packages` 137, `tools` 393, total de no máximo 1556.
  - Node 22 e 24 quando o ABI permitir.
  - Revisão cética isolada presa ao SHA.
- **Por onda:**
  - Hook de pre-commit (`quality-gates --phase code` com o `npm test` completo).
  - CI da PR 7/7 verde.
  - `WAVE-N-REPORT.md`.
- **Fechamento:**
  - Master com CI verde.
  - Modo de relógio avançado (W0-4) verde.
  - C10 ponta a ponta mostrando eventos `environment.*` e `memory.*` no ledger e `memory[]` no contexto.
  - Contrato por janela provado sobre o guard real na T1.
  - Docs e `requirements.json` coerentes com o código.
  - `docs/evolution/w5/STATUS.md` com o registro final de resíduos.
- **Ativação:** cada passo com receipt e smoke (`hseos --version`, `hseos liveness check --json`) e rollback testado.

## Desvios registrados durante a execução
- 2026-10-20 (W0): `worktree-manager.sh validate` reprova 5 casos de `test/test-kernel-mutations.js` (task_cancellation, job_shutdown, job_acceptance, job_ledger, job_preparation) fora do cgroup, também na master pura; `worktree-manager.sh commit` exige `status=validated`, faz `git add -A` e roda o hook fora do cgroup. Commits passam a ser feitos por `/build/tmp/hseos-w5/bin/commit-in-cgroup.sh` (hook completo no cgroup + `validate-commit-msg.sh`), com a mensagem validada antes. A plausibilidade do motivo está em revisão (w0-5-reviewer).
- 2026-10-20 (W0): `feature/hseos-w5-closeout-w0` avançada pelo Commander para `f0653af1` (master + conserto do relógio da #234, já revisado) para desfazer a dependência cruzada entre a #234 (precisa do conserto do broker no Node 24) e o hook dos commits da W0 (precisa do conserto do relógio).
- 2026-10-20 (W0): nova task W0-5 (relógio dos servidores MCP legados só em teste), decisão do owner, após a W0-4 achar o sunset de 2026-11-30.
- 2026-10-20 (owner): DECISÃO — mover a suíte completa para o GitHub Actions (repo público). Nova task W0-6: `ci.yaml` com gatilho `push` em `task/**` e `feature/**` e job `test` fatiado em shards paralelos; hook local leve (testes dos arquivos tocados, lint/prettier, commit-msg, G3 `npm pack`) no lugar do `npm test` completo. O gate completo passa do commit local para o CI de cada push; merge continua exigindo CI 7/7 verde + "merge autorizado"; revisor cético confere CI verde do SHA revisado. Push de `task/*`/`feature/*` para disparar CI fica autorizado por esta decisão (nunca push para `master`, nunca force-push, nunca tags sem autorização). As tasks atuais da W0 terminam pelo hook completo.
- 2026-10-20 (owner): "paralelize" — linha C (W6 docs/resíduos e W7 runbooks) começa já; linhas A (W1→W2→W4) e B (W3→C7/C9) após a W0. Branches `feature/hseos-w5-closeout-w6` e `-w7` criadas a partir da `feature/hseos-w5-closeout-w0`.
- 2026-10-20 (incidente, corrigido): o `nvm install 24.22.0` da W0-1 quebrou o `hseos` global (wrapper escolhe a maior versão do nvm). Node 24.22.0 movido para `/build/tmp/hseos-w5/closeout/node-v24.22.0`; `hseos --version` voltou a `4.0.0-rc.0`. Regra adicionada ao COMMON.md. Achado para a W8/F3: o wrapper global `~/.local/bin/hseos` é frágil (ordena versões do nvm em vez de fixar a do release).
- 2026-10-20 (owner): achado (d) da revisão da W0-5 — os 4 servidores MCP instalados sobem o legado e ignoram o sunset de 2026-11-30 (só metadado de telemetria em `tools/lib/legacy-mcp-server.js`); o moderno (único que recusa pós-sunset) está bloqueado por `EXECUTION_ACTIVATION_PENDING` até a ativação ADR-0022/0023, que exige 30 dias de zero legado e não cabe antes de 30/11. DECISÃO: registrar como dívida da ativação, sem mexer na produção agora. Entra na W6-E7 (registro de resíduos em `docs/evolution/w5/STATUS.md`) e no runbook F3 (`docs/evolution/runbooks/activation.md`): "o sunset só vale ao ativar o moderno; a data de 30/11 precisa ser revista por ADR antes de vencer".
- 2026-10-20 (débito registrado, revisão W0-7): `test/test-engineering-task-runtime.js` (~60 s) roda 3× na suíte completa (test:engineering-task, test:kernel sob c8 no kernel-coverage, e a conformance de providers). Não é bug; reduzir exige redesenhar gates. Entra no registro de resíduos da W6-E7.
- 2026-10-20 (W0-5 aprovada após 3 rodadas; ressalvas baixas viram itens da W6): (a) apertar `test/test-mcp-contract.js` ~926/943 (`body.error !== undefined`) para casar `'required'` (mensagens de `tools/mcp-project-state/index.js:108,120`) — entra na W6-E3; (b) dívida: expor `error.data = {code}` no fio legado (`tools/lib/mcp-transport.js:205` usa `buildMcpError(id,-32000,error.message)` sem código estável; `MCP_SCOPE_DENIED` não chega ao cliente) para que os testes casem por código — entra no registro de resíduos da W6-E7 (mexe na superfície legada que tem sunset).
- 2026-10-20 (W0-7 aprovada após 2 rodadas; ressalva baixa vira dívida da W6-E7): o supervisor de suítes da conformance mata o grupo também no fim normal, o que limpa mas mascara vazamento de processo sem aviso; sugestão registrada: emitir aviso no relatório quando o `killGroup` do fim normal encontrar processos vivos. Neto com `setsid` escapa do grupo e segura o pipe até o backstop (caso de borda).
- 2026-10-20 (INCIDENTE de governança, W0-INT): o integrador fez o merge da W0-7 com `git -c core.hooksPath=/dev/null` (bypass do commit-msg, equivalente a --no-verify) porque a mensagem que o Commander mandou usar (`merge: …`) não é conventional; os 4 merges anteriores saíram sem hook porque o worktree ainda não tinha o husky. Nenhuma menção a IA/fornecedores nas mensagens; o defeito é só de formato. Causa raiz: instrução do Commander. Correção: merges passam a usar `chore(merge): integrate <task> into <feature>` pelo hook; proibição reiterada. Decisão pendente do owner: aceitar os 5 merges com mensagem fora do formato (já no remoto em feature/hseos-w5-closeout-w0) ou reconstruir a feature com mensagens conformes (exige force-push de feature/*).
- 2026-10-20 (owner): DECISÃO — reconstruir a feature/hseos-w5-closeout-w0 com merges `chore(merge): integrate …` pelo hook; force-push autorizado SÓ dessa branch, uma vez (--force-with-lease contra d80577c2).
- 2026-10-20: W0 integrada e reconstruída em `feature/hseos-w5-closeout-w0` = 5e0eb11c (árvore idêntica a ee995318; 22 commits validados por validate-commit-msg.sh pelo Commander; CI 39500766902 verde). Cadeia empilhada declarada: `feature/hseos-w5-closeout-{w1,w3,w6,w7}` partem de 5e0eb11c; PRs dessas ondas apontam para `feature/hseos-w5-closeout-w0` até a W0 ser mergeada na master, depois são redirecionadas; ordem de merge base→ponta.
- 2026-10-20 (flaky observado): `cancellation during workflow dispatch drains before settlement` falhou uma vez no shard 22.x 1/6 do CI da W7 (run 39505105700, tentativa 1; mudança só de docs) e passou no re-run. Registrar e investigar em task própria se reaparecer (W6-E7 lista flakies conhecidos).
- 2026-10-20 (correção de fato do planejamento): `packages/agent-environment/index.js` NÃO está em `.c8-kernel.json` (os demais arquivos do pacote estão, linhas 75-92). Decisão do Commander na W3: registrar `environment.computer.approval_outcome` na 017 (21 tipos) porque o gate de `tools/cli/lib/environment-approval.js` será ligado ao sink na W4-C6.
- 2026-10-20 (desvio de escopo): o w1-tokens-exec alterou scripts/governance/quality-gates.sh (41ecd395, 02cbcf45) para contornar o mesmo defeito que a W0-9 (f1d1f72e) corrige; fora do escopo da task. Na integração da W1, esses dois commits devem ser descartados/resolvidos em favor da W0-9 (a seleção da W0-9 só aceita test/test-* e *.test.*, o que já exclui test/fixtures e test/journeys).
- 2026-10-20 (dívida W1, revisão w1-tokens): com max_tokens abaixo de ~12000 o contrato de engenharia termina em `session-failed:internal_error` com mensagem genérica (overflow de montagem de contexto descartado por normalizedFailure) — o mesmo opaco que a W1 quer eliminar. Candidato: validar um mínimo de max_tokens no contrato ou expor um código `context_overflow`. Registrar na W6-E7 se não for tratado na W1.
- 2026-10-21 (owner): AUTORIZAÇÃO DURÁVEL — PR de cada onda (#236, W1, W2, W3, W4, W6) aberta pelo Commander quando integrada, revisada e com CI verde; merge via `hseos pr closeout --approved --keep-branch` somente com todos os checks verdes e estado CLEAN. Ativação, tags e despacho da T1 continuam exigindo autorização própria.
- 2026-10-21 (owner): `memory.write` sem aprovação do runtime (provider idempotente pelo memory_id); o controle é a política `admitWrite` do store (deny por padrão) + scan de credencial. A W4 (C6/C8) deve fornecer as regras de escrita por projeto ao store. `computer.stop` idempotente sem aprovação (só encerra).
- 2026-10-21: W4 começa empilhada sobre feature/hseos-w5-closeout-w3 (cda40acf = master com W0/T4/W1 + W3); a W2 (aceite por critério) será trazida para a feature w4 quando mergeada. PR da W3 = #238.
- 2026-10-21 (W4-C7 REPROVADA na 1ª revisão): fluxo de aprovação MCP quebrado para contratos de capacidade (begin assina hseos-operational-v1, resolve devolve a versão do contrato; adapter recusa); política passou a ecoar a versão do contrato (checagem tautológica); runtime auto-aprovava o gate do computer; derivedDeleteApprovals sem limpeza; ferramentas não expostas em tools/list. Rodada 1 aberta com correção e testes ponta a ponta.
- 2026-10-21 (flaky observado): `test-environment-computer.js` "the dialog is drawn: more than the empty black root" (display real) falhou na 1ª tentativa do CI da W4-C8 (run 39535516377) e passou no re-run. Registrar na W6-E7.
- 2026-10-21 (flaky observado, 3º distinto): `parallel tasks share the declared aggregate budget` (test/test-engineering-workflow-runtime.js) falhou na Node 22 shard 1/6 do CI da W6-E3 (run 39536874211) e passou no re-run. Com os outros dois (cancellation during workflow dispatch; the dialog is drawn), vira task própria de investigação de flakies (W6-E8) antes do fechamento.
- 2026-10-21 (W6-E4, revisão): alegação de memória do executor estava inflada (297→1 MB era crescimento sobre fixture sintética); no chrome real o pico do pai caiu só de 551.656 kB para 417.044 kB. Rodada 1 exige redução real (meta < 200 MB no pai), timeout no filho e cobertura das duas defesas em profundidade.
- 2026-10-21 (W6-E6 aprovada; limitação registrada para W6-E7): ausência de violação de CSP no console não foi observada num navegador; o serviço de browser (`createDefaultBrowserService`) não expõe mensagens de console/violações de CSP — candidato a capacidade futura.
- 2026-10-21 (flaky #3, leitura do revisor): `parallel tasks share the declared aggregate budget` falhou porque a tarefa `addition` terminou `blocked` (`engineering-execution-blocked`) enquanto `clamp` foi aprovada; orçamento íntegro. Suspeita: bloqueio de isolamento/recursos sob carga do shard. Investigar na W6-E8.
- 2026-10-21 (pré-condição C10/C11): ao ligar um environmentHost à CLI (`agent run`) ou ao worker, o caminho readEngineeringTask sem admissão passaria a rodar tarefas novas com environment sem a admissão da W2 — exigir entrada só pelo controle admitido ou aplicar admissão no agent run.
- 2026-10-21 (W6-E4 aprovada): pico do pai no chrome real 541 MB → 95 MB, filho 68 MB, extração byte-idêntica (e52dba7f…), TOCTOU recusado com ENV_TOOLCHAIN_DIGEST_MISMATCH. Resíduo baixo: o uso de SIGKILL (vs SIGTERM) no timeout do filho não é provado por teste.
- 2026-10-21 (owner): despacho da T1 autorizado (até 3 requisições, custo 0, uma binding, 45 min); registrado em /build/tmp/hseos-w5/live/owner-decision.md.
- 2026-10-21 (T1 despacho 1/3): CONTROL_OUTCOME_UNCERTAIN após 142 s (reserved, sem recibo, sem saída retida; comando 97481ea4 pendente). Causa não capturada pelo harness. Antes da 2ª requisição: diagnóstico nos artefatos, instrumentação de erro no live-dispatch, reconciliação governada do comando pendente e, se for o caso, max_output_tokens maior que 4096.
- 2026-10-21 (achado de produto, T1): o worker do adapter da conta Claude (provider-claude-account-worker.js) roda com stdio "ignore" e converte qualquer falha em CONTROL_OUTCOME_UNCERTAIN, engolindo o erro real; sessões não persistidas. Dívida de observabilidade: registrar na W6-E7 (ou task própria) — capturar código/causa/stderr do worker no evento uncertain, sem vazar credencial.
- 2026-10-21 (T1 despacho 2/3): CONTROL_OUTCOME_UNCERTAIN de novo; diagnóstico: cliente claude terminou com stop_reason "refused" (resultado != success/is_error=false), 156 bytes, sem usage, ~155 s. 3ª requisição NÃO usada. Próximo: reconciliar, instrumentar subtype/texto, e decidir com o owner entre a 3ª (diagnóstica) ou concluir a T1 por executor comum.
- 2026-10-21 (owner): liberada a 3ª e última requisição da T1 (mesmo prompt, diagnóstico completo). Sem 4ª.
- 2026-10-21 (owner): T1 com nova autorização: até 2 requisições, max_output_tokens 16384. Achados de produto para a W6 (task nova E9): (1) estouro de max_output_tokens no cliente claude é classificado como refused/CONTROL_OUTCOME_UNCERTAIN em vez de estouro de orçamento com código próprio; (2) o worker do adapter descarta o stderr (stdio ignore) e engole o erro real.
- 2026-10-21 (T1 despacho 4 = 1/2 da nova autorização): cliente concluiu (end_turn, ~227 s, patch de 3913 B), mas o adapter lançou dentro de adapter.run/validação do recibo e o erro virou CONTROL_OUTCOME_UNCERTAIN; reconciliado. Reproduzir offline com a saída capturada antes de usar a última requisição.
- 2026-10-21 (owner): T1 última requisição com tetos 32768 (saída) / 200000 (entrada) / 300 s. Defeito de produto para a W6-E9: o limite de saída do manifesto é comparado com usage.output_tokens que inclui raciocínio (provider-claude-account-adapter.js:212), e a entrada somada com cache tem teto 65536 (provider-campaign-control.js:651); ambos viram uncertain sem causa.
- 2026-10-21 (T1 PASS no 5º despacho): recibo válido (entrada 7977; saída 14971 com 12824 de raciocínio), verificador protegido exit 0 (cjs gaps 12/12, suíte 101/101, shell ok); diff +98/-0 em capability-intake-guard.js. Bateria: 9 de 12 requisições.
- 2026-10-21 (sensível a carga): teste do guard `ambiguous slashes cost a constant number of passes (1 MB)` tem teto absoluto de 200 ms e reprova sob load ~20 até na master (250–300 ms). Entra na W6-E8 (instáveis): medir em termos relativos/passadas em vez de tempo absoluto, sem afrouxar a garantia de complexidade.
- 2026-10-21 (pendente do Commander): levar ao runbook docs/evolution/runbooks/activation.md (W7) a composição de host de referência para a ativação (MemoryStore sobre o ledger de execução, regras de escrita e operador por projeto, serviços de ambiente com o sink do ledger e o gate do computer-use) — dívida registrada no STATUS pela W4-C11 (063adf5d). Fazer na integração W6+W7.
- 2026-10-21 (owner): merge da W5 (T1 + L4) autorizado quando pronta (revisão aprovada + CI verde + CLEAN), via hseos pr closeout --approved --keep-branch.
- 2026-10-21 (owner): ao finalizar W0, W4, W5 e W6, rodar /end-session (atualizar vault e CONTINUITY).

### W6-E9 — revisão 2026-10-21
- Revisão cética em 5e30586e: PASS-WITH-NOTES. Rodada 1 pedida: teste do ramo do worker (CONTROL_PROVIDER_OUTPUT_LIMIT), validação de blocos antes do retorno de max_output_tokens no driver, teste fixando cache no total de entrada.
- Resíduos para a E7: (3) segredo multilinha sem marcador (corpo PEM) fora da janela de 4096 do stderr pode chegar ao diagnóstico; (4) mensagens de JSON.parse do Node 24 trazem ~10 caracteres da entrada, então trecho de prompt/saída em texto livre pode chegar ao diagnóstico (a redação só barra credenciais).
- W4 #241: smoke em ambiente limpo sem cache de toolchain (corrigido em 766f13ab); flaky "realistic 1 MB took 203 ms" (teto absoluto de parede) virou caso (h) da W6-E8, job reexecutado.
- W6-E9 rodada 1 (4b31f653): revisão PASS (achados 1, 2 e 5 travados por testes que ficam vermelhos ao reverter). Instabilidade de "aborting the campaign kills the client through the cgroup" sob carga = caso (g), consertado em task/w6-flakies (b1ba8bff).
- W6-E5 (84746de5, task/w6-pids): fonte única em profiles.js LIMIT_FLOOR/LIMIT_CEILING; escopo estendido a 3 adapters de provider com o mesmo literal; feature/hseos-w5-closeout-w6 ainda não criada (worktree manual).
- W6-E8 revisão em abf2c7bb: PASS-WITH-NOTES. Rodada 2 pedida: (g) não discrimina (todos os kills desligados e o teste segue verde; ponto cego pré-existente). Resíduos para a E7: (f)/(h) não detectam lentidão linear de fator constante (<2,5x / <7x); cobertura restante pelos orçamentos absolutos do guard (5k lines <1000 ms, unclosed export <1000 ms, listas de export <400 ms), também sensíveis a carga. (a): join em fallback após deadline agora relança rejeições de runtime, inclusive da própria cancelação (efeito aceito). Master trazida para task/w6-flakies em 555d9cfd (guard 102/102).
- W6-E5 rodada 1 em 5d35b336 (só test/): fronteiras dos adapters native/antigravity e varredura independente de formatação. Infra flakes no CI: apt 403 em packages.microsoft.com e fetch do chrome-headless-shell no provisionamento (re-run sem mudança).
- W6-INT-1 (97a5ac14, feature/hseos-w5-closeout-w6 sobre 953949a0): docs, negatives, zip-stream, csp, adapter-errors e w7 integrados sem conflito; testes tocados verdes no cgroup; G3 393/137/1538. Desvio: commits de merge feitos fora do commit-in-cgroup (hook commit-msg passou, sem bypass). E5 (w6-pids 5d35b336) aprovada, integração pendente; E8 em rodada 2.
- W6-E8 rodada 2 (2cf09f86): revisão PASS. (g) agora discrimina: o cliente morria antes pelo timeout do próprio worker; fixture `immortal` (ignora sinais, neto com setsid) exige o cgroup.kill; defesa em camadas (stop + drain) — o teste só fica vermelho com os dois desligados. E8 aprovada; integração W6-INT-2 pedida.
- W6-INT-2: w6-flakies integrada em d341cc04 (merge textual limpo com imports fs/path duplicados em test-claude-account-process.js, corrigido no merge) + 5962ae66 (prettier). CI do HEAD 5962ae66 em andamento (run 39708057912). Hook leve falhou uma vez em "Tests (touched + referencing)" sem identificar o teste; reexecução verde (flaky não identificado → E7).
- Pendente para a próxima sessão: E7 (registro final de resíduos), composição de host de referência no activation.md, PR da W6 (merge com autorização durável), W8 ativação, W9 higiene.

## Conclusão (plano aprovado 2026-10-22) — ver PLAN-CONCLUSAO.md
- Owner: dívidas entram (host de produção, admissão no agent run, ADR do sunset); W8 em lote com gates; contratos/timer só no enterprise-hseos; push de tags + W9 autorizados; mudar critério de ativação por ADR (G0, Proposed → owner aceita) e ativar o servidor MCP moderno; execução em Sonnet.
- Ondas: W6 (E7, E7b) → W10 (G0 ∥ K1 ∥ K6 → K2 → K3, K5, K4, K7) → W8 → W9.
- 2026-10-21 (relato do revisor W6-E5, 5d35b336/84746de5; NÃO reproduzido pelo Commander): `test/test-provider-campaign-adapters.js` tem 5 falhas rodando fora do cgroup (testes de worker real, supervisor e perfil de recursos), idênticas em 84746de5 e 953949a0; leitura "exigem cgroup delegado" é inferência do revisor pelos nomes, não verificada. Distinto do relato anterior de `test-kernel-mutations.js` (task_cancellation, job_shutdown +3, PLAN.md ~277).
- 2026-10-22 (K1, b64ffa2c): Codex 0.163.0 envia initialize 2025-06-18 e o adaptador moderno só aceita 2024-11-05 exato (mcp-2026-adapter.js:978) → trocar para o moderno quebraria o Codex; Claude Code 2.1.305 fala 2026-07-28 por padrão. K4 passa a incluir compat de initialize das revisões legadas conhecidas (2024-11-05, 2025-06-18, 2025-11-25) no modo legado do servidor moderno.

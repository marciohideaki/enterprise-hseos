> Relatório da auditoria de conformidade W0–W5 de 2026-10-27, sobre o commit `f96c6e9c`.
> Os achados são tratados pela run `audit-fixes` (PRs das ondas W1–W3); o estado de cada um está em [MAPA §8](../pendencias-w0-w5/MAPA.md).
> O texto do relatório abaixo não foi editado.

# Conformidade W0–W5 do aprimoramento canônico do HSEOS — 2026-10-27

- Repositório: `enterprise-hseos`. Commit auditado: `origin/master` = `f96c6e9ce3f204d1cea9c4435f5a67f7aaf15dd9`, em worktree descartável (`/build/tmp/audit-20261027`, removido ao fim).
- Especificação: `/build/tmp/hseos-w5/closeout/PROMPT-CONFORMIDADE-W0-W5.md`.
- Papel: auditor independente. Este relatório reporta e não corrige. Nenhum arquivo do repositório foi alterado.
- Fontes lidas, todas no SHA acima:
  - `AGENTS.md` (raiz e global)
  - `docs/evolution/{PLAN,STATUS,_INDEX}.md`, `requirements.json`, `w5/STATUS.md`
  - `pendencias-w0-w5/{PLAN,MAPA}.md`, `revalidation-2026-10/STATUS.md`
  - ADR-0042 a ADR-0048 e `_INDEX.md` de `.enterprise/.specs/decisions/`
  - `.github/workflows/ci.yaml`, `.c8-kernel.json`
  - as runs `.hseos/runs/dev-squad/20261020-w5-closeout/` e `20261023-pendencias-w0-w5/`
  - as PRs #175–#254, as tags e a branch protection.

## 1. Veredito executivo

| Onda | Veredito | Motivo determinante |
|---|---|---|
| W0 | **NÃO-CONFORME** | Docs não reconciliadas: `requirements.json`, `STATUS.md`, `PLAN.md` e `MAPA.md` dão respostas diferentes sobre ativação e pendências. A prova de que o CI cobre a suíte inteira é falsa: 9 arquivos de teste nunca rodam no CI. Lint, c8 90/80 por arquivo e inventário estão conformes. |
| W1 | CONFORME-COM-RESSALVA | Determinístico verde. A dívida 18 foi reduzida, não fechada. O mutante H-4 sobrevive. Não há consumidor real em F02, F03, F05, F09, F10 e F19. |
| W2 | CONFORME-COM-RESSALVA | Verde em cgroup delegado. Consumidor real só em escopo instalado local. |
| W3 | **NOT VERIFIED** | F08, F17 e F18 estão `not_verified_for_evolution`. A 4ª integração, `tools/call` e o MRTR do Codex não foram exercitados (decisão do owner). Onze corpos de PR trazem atribuição de IA. |
| W4 | **NÃO-CONFORME** | O gate `test:w4-mutations` falha por construção (20/20 passam e o script sai com 1). ADR-0045 continua Proposed. Plugins seguem `scaffolded`. Determinístico verde. |
| W5 | **NÃO-CONFORME** | A promessa da onda ("consumidores reais demonstram delimitação e proveniência") não foi cumprida em F14, F15 e F20. O adaptador MCP vaza `data.issues`, e o transporte legado vaza `error.message`. As provas centrais do fecho (`production-callers`, `w5-environment-ledger`) não rodam no CI. O gate `test:w5-mutations` falha por construção. |
| P1–P4 | **NÃO-CONFORME** | O guard do T-6 (`pids_max`) e o teste do lock M-8 não rodam no CI. O H-7 entregou a variante marcada como decisão do Owner. O H-9 deixa vazar corpo de chave em linha única. |
| **Agregado** | **NÃO-CONFORME** | Prevalece o pior estado. Nenhum achado foi classificado como Crítico. Os itens de segurança são Alta ou Média. |

Fatos executados que sustentam o veredito:
- Suíte completa via runner do repo: 102/102 itens, 3827 testes, 0 falhas, 1 skip (Postgres sem URL local), 4 todo, exit 0, em cgroup delegado com Node 24.
- c8 do kernel: aprovado por arquivo.
- Os 8 arquivos fora do CI passam quando executados manualmente. O código funciona; o defeito é a proteção ausente, não o comportamento.

## 2. Tabela por onda

As linhas estão na matriz do §3: 46 linhas para 22 famílias de onda ≤5 de `requirements.json` mais os itens do fechamento e de P1–P4. Uma família pode ter mais de uma linha.

| Onda | Linhas | CONFORME | COM-RESSALVA | NÃO-CONFORME | NOT VERIFIED | OWNER |
|---|---|---|---|---|---|---|
| W0 | 6 | 1 | 3 | 1 | 1 | 0 |
| W1 | 7 | 0 | 7 | 0 | 0 | 0 |
| W2 | 3 | 0 | 3 | 0 | 0 | 0 |
| W3 | 5 | 0 | 0 | 1 | 3 | 1 |
| W4 | 8 | 0 | 6 | 1 | 0 | 1 |
| W5 + W10 (dependência) | 12 | 4 | 2 | 6 | 0 | 0 |
| P1–P4 | 10 | 3 | 5 | 2 | 0 | 0 |
| **Total** | **51** | **8** | **26** | **11** | **4** | **2** |

F14, F15 e F20 contam como NÃO-CONFORME pelo critério de consumidor real da onda; o plano determinístico delas está verde.

Reconciliação com `requirements.json`: 27 famílias e 27 requisitos (1 por família); 22 são de onda ≤5. As 22 aparecem na matriz. F07, F24, F25, F26 e F27 (ondas 6–8) estão fora do escopo.

## 3. Matriz de rastreio

Colunas: ID | origem | promessa | artefato | teste que prova | evidência executada | veredito.

Sobre as evidências:
- "Suíte" é a execução completa de 2026-10-27, 20:06–20:38Z, com exit 0.
- "Manual" é execução por arquivo em cgroup delegado com Node 24.
- C1–C4 e R1 são os coletores e o revisor. As execuções que eles fizeram foram reconferidas pelo Commander onde o veredito depende delas.

### W0

| ID | origem | promessa | artefato | teste | evidência | veredito |
|---|---|---|---|---|---|---|
| W0-1 | PLAN.md:54 | lint integral | `eslint.config`, `npm run lint` | `test-kernel-quality-surface.js` (guarda com erro injetado) | Suíte: `npm run lint` pass; kernel-quality 3/3 | CONFORME |
| W0-2 | PLAN.md:54,123 | cobertura 90/80 por arquivo crítico | `.c8-kernel.json:100-103` (`per-file`) | `test:kernel-coverage` | Suíte: pass. Menores margens de branches: `engineering-model.js` 80,95, `plugin.js` 81,01 | COM-RESSALVA: ficam fora do gate o ledger e o banco da ativação (`execution-event-ledger.js`, `operational-state-db.js` e outros), `agent-environment/index.js`, `governed-execution/*` e as implementações de F17, F18, F21 e F22 (achado A-09) |
| W0-3 | PLAN.md:54 | inventário das 27 famílias com fontes, testes e lacunas | `requirements.json` | — | C2: `implementation` e `tests` existem em 27/27 | COM-RESSALVA: `status.operational` está desatualizado (A-07) |
| W0-4 | PLAN.md:54 | docs reconciliadas | STATUS, PLAN, MAPA, `requirements.json` | — | ver §5 | NÃO-CONFORME (A-07, A-13) |
| W0-5 | PLAN.md:100 | CI em 6 shards Node 24, subset Node 22 por PR, suíte Node 22 à noite | `ci.yaml:31-160` | `ci-test-shards verify`; `test-ci-light-hook.js` | Run 40548440249 (push `f96c6e9c`): `test (22.x)` rodou só o subset. Run 40490163410 (schedule): 12 shards | COM-RESSALVA: `verify` não prova a cobertura dos arquivos (A-01); não há noturno posterior a `863fec28` (A-14) |
| F23 | requirements F23-R1 | governança de engenharia | — | — | O próprio repo declara `not_verified_for_evolution` | NOT VERIFIED |

### W1

| ID | origem | promessa | artefato | teste | evidência | veredito |
|---|---|---|---|---|---|---|
| F02 | F02-R1 | contrato de objetivo, aceite e escopo | `engineering-task-contract.js` | `test:engineering-task` | Suíte pass. `test:kernel-mutations` pass (mutantes `task_*` rejeitados) | COM-RESSALVA (consumidor real não verificado) |
| F03 | F03-R1 | trabalhar em código | `requirements.json` F03 | idem | Suíte pass | COM-RESSALVA (idem) |
| F05 | F05-R1 | política e aprovação | idem | `test:agent-policy-lattice`, mutante `authority` | Suíte pass | COM-RESSALVA (idem) |
| F09 | F09-R1 | aceite independente | `ENGINEERING_ACCEPTANCE_UNCOVERED` (W5-10b) | mutantes `weak_acceptance`, `acceptance_uncovered` | Suíte pass; `check-w5-mutations` 44/44 | COM-RESSALVA: a rota de API paga da A5b não foi refeita |
| F10 | F10-R1 | correção após rejeição | idem | `test-engineering-corrections.js` | Suíte pass | COM-RESSALVA (consumidor real) |
| F19 | F19-R1 | estado e observabilidade | idem | idem | Suíte pass | COM-RESSALVA (consumidor real) |
| D18 | MAPA.md:101 | piso de `max_tokens` com causa explícita | `engineering-task-contract.js:262-303` | casos H-4 (suite.log:3910, 3960, 4117) | Suíte pass | COM-RESSALVA: faixa opaca residual de 752–753 e 2359 tokens; o mutante `admission &&` em `engineering-control.js:363` sobrevive em 5 suítes (C2, A-11) |

### W2

| ID | origem | promessa | artefato | teste | evidência | veredito |
|---|---|---|---|---|---|---|
| F01 | F01-R1 | encerrar, interromper e retomar sem repetir efeitos | `agent-runtime/runtime.js`, `terminal-executor.js`, `terminal-control.js` | `test-agent-runtime.js:384,497,1117`; `test-terminal-*` | Suíte pass. C2: sem cgroup, executor 1/8 e control 0/13; com cgroup, 8/8 e 13/13 | COM-RESSALVA: exige cgroup v2 delegado; consumidor real só instalado local |
| F11 | F11-R1 | reconciliação de efeitos incertos | `engineering-reconciliation.js` | `test-engineering-reconciliation.js` | Suíte pass (c8 branches 81,63) | COM-RESSALVA (idem) |
| F16 | F16-R1 | persistência e replay | ledger, session store | `test:agentic-session-store`, `test:kernel` | Suíte pass | COM-RESSALVA: bytes anteriores à persistência podem se perder em crash (declarado) |

### W3

| ID | origem | promessa | artefato | teste | evidência | veredito |
|---|---|---|---|---|---|---|
| F08 | F08-R1 | segredos e egress | `provider-egress-broker.js` | `test:provider-egress-broker` | Suíte pass (6 casos) | NOT VERIFIED: a família está `not_verified_for_evolution`; não há certificação de binding |
| F17 | F17-R1 | model providers | `packages/model-providers/index.js` (fora do c8) | `test:model-providers` | Suíte pass | NOT VERIFIED (idem) |
| F18 | F18-R1 | quatro ecossistemas executam a jornada | `runtime-providers/index.js` (fora do c8) | `test:runtime-providers` | Suíte pass | NOT VERIFIED: 3 de 4 |
| W3-4 | PLAN.md:57,146 | 4ª família, `tools/call` e MRTR do Codex | — | — | `NOT_EXERCISED` | OWNER |
| W3-J | AGENTS global §3i | sem atribuição de IA em PRs | corpos das PRs #186–#195 e #197 | — | `gh pr view 186/195/197`: "Generated with [Claude Code]" presente; #198 ausente; 0 nos commits | NÃO-CONFORME (Baixa, histórico; ver A-17) |

### W4

| ID | origem | promessa | artefato | teste | evidência | veredito |
|---|---|---|---|---|---|---|
| F04 | F04-R1 | gateway de tools | ToolRuntime | `test:tool-runtime` | Suíte pass | COM-RESSALVA (consumidor real) |
| F06 | F06-R1 | agendamento de efeitos | `job-*.js` | mutantes `job_*` | Suíte pass | COM-RESSALVA (agendamento persistente não certificado) |
| F12 | F12-R1 | subagentes e workflows | `agent-orchestration` | mutantes `workflow_*` | Suíte pass | COM-RESSALVA: descendentes dinâmicos não certificados |
| F13 | F13-R1 | orçamento | `workflow-reservations` | mutante `budget` | Suíte pass | COM-RESSALVA: falha sem causa no instável "parallel tasks share the declared aggregate budget" (resíduo 1 do w5/STATUS) |
| F21 | F21-R1 | perfis e instalação | `capability-catalog.js` (fora do c8) | `test:install` | Suíte pass | COM-RESSALVA |
| F22 | F22-R1 | extensões | `adapter-sdk/index.js` (fora do c8) | `test:adapter-sdk` | Suíte pass | COM-RESSALVA: catálogo certificado pendente |
| W4-M | recibo W4 | "W4 mutation matrix: 18 rejected" | `scripts/governance/check-w4-mutations.js:12-20` | `test-kernel-mutations.js` (20 casos) | Manual: `# tests 20 / # pass 20 / # fail 0`, exit 1 "did not reject all 18 mutants" | NÃO-CONFORME (A-04) |
| W4-G | ADR-0045 | aceite de plugins e jobs | ADR-0045:3 "Proposed" | — | — | OWNER |

### W5 e W10 (na medida da dependência)

| ID | origem | promessa | artefato | teste | evidência | veredito |
|---|---|---|---|---|---|---|
| F14 | F14-R1; PLAN.md:59 | contexto e memória com fonte e autoridade; consumidores reais | `context-assembler.js`, `authority.js` | `test:agent-context`, mutantes `context_authority`, `memory_*`, `provenance_*` | Suíte pass; mutação W5 44/44 | Determinístico conforme. **Consumidor real: NÃO-CONFORME** (consumidor B sintético; `real_consumers: not_verified`) |
| F15 | F15-R1 | compactação | `agent-compaction` | `test:agent-compaction` | Suíte pass | idem: NÃO-CONFORME no consumidor real |
| F20 | F20-R1 | MCP | `mcp-2026-adapter.js` | `test:mcp-2026` | Suíte pass; adapter 28/28 | idem, mais A-02 e A-03 |
| W5-C | w5/STATUS.md:326-337 | contratos reais e chamador de produção (browser, computer, memory) | `contract-registry.js`, host K5 | `test-environment-production-callers.js`, `test-w5-environment-ledger.js`, `test-environment-journey.js` | Manual: 9/9, 3/3 e 4/4, exit 0. **Fora do CI** | NÃO-CONFORME na proteção (A-01); comportamento conforme |
| W5-H2 | pend. PLAN.md:96 | adaptador não repassa `error.message` interno | `mcp-2026-adapter.js:231-243` | `test-mcp-2026-adapter.js:340-427` | C1: mutantes M2 e M2b mortos (2 falhas cada) | CONFORME |
| W5-IS | MAPA.md:103 | envelope de erro sem dados da tool | `mcp-2026-adapter.js:860,943` | nenhum teste lê `issues` | C1: mutação M3 (o `result` inteiro em `issues`) sobrevive, 28/28 | NÃO-CONFORME (A-02) |
| W5-MW | w5/STATUS item 23 | `memory.write` sem aprovação do runtime, como decidiu o owner | `contract-registry.js:479-490`, `agent-memory/store.js:157-162` | `test:agent-memory` (via suíte) | Suíte pass | COM-RESSALVA: a decisão só está registrada em `.hseos/runs/.../PLAN.md:295` |
| W5-M | recibo final W5 | "28 mutants rejected, exit 0" | `check-w5-mutations.js:6` (`EXPECTED = 29`) | `test-w5-mutations.js` (43 mutantes + 1 caso de grupo) | Manual: `# tests 44 / # pass 44 / # fail 0`, exit 1 | NÃO-CONFORME (A-04) |
| K-ACT | PLAN.md:98; ADR-0048 | `execution-activation plan\|apply\|rollback` com backup verificado | `operational-state-db.js:528-529,588-681,702-` | `test-execution-ledger-activation.js:248,573-622` | C2 e R1: 29/29. Mutações: cruzamento com o receipt e `integrity_check` mortos; os dois hashes só morrem juntos | CONFORME |
| K-MIG | PLAN.md:104 | migrations v4→v17 | `migrations-pending-activation/005..017` | `test-execution-ledger-activation.js:160-168` | 29/29 | CONFORME |
| K-RB | ADR-0048 | rollback verificado | `operational-state-db.js:683-684,742` | — | Receipt ausente é ignorado em silêncio | COM-RESSALVA (A-12) |
| K-SURF | G3 | tetos tools 393 e packages 137 | `test-package-surface.js:131-141` | o próprio | C4 e R1: `npm pack` dá tools 393/393 e packages 137/137 | CONFORME, com folga zero |

### P1–P4

| ID | origem | promessa | artefato | teste | evidência | veredito |
|---|---|---|---|---|---|---|
| T-1 | pend. PLAN.md:86 | teste de apply pela CLI real | `test-execution-ledger-activation.js:573` | o próprio | 29/29; no CI via `test:state` | CONFORME |
| T-3 | pend. PLAN.md:88 | K9 correto com e sem cgroup | `test-mcp-environment-host.js` | o próprio | C2: sem cgroup 46 pass e 1 skip; com cgroup 47/47 | CONFORME (o PLAN.md:116 ainda o lista como aberto, A-13) |
| T-5 | pend. PLAN.md:90 | mutantes sem detecção ganham teste | `test-w5-mutations.js` (+161 linhas em `79e1c066`) | o próprio | Mutação W5 44/44 | COM-RESSALVA: M18b e N5 seguem sem evidência; ao expandir a matriz, o gate `check-w5-mutations` não foi atualizado (A-04) |
| T-6 | pend. PLAN.md:92 | a varredura de `pids_max` cobre a árvore e falha com literal novo | `test-pids-max-single-source.js` (+106 linhas em `79e1c066`) | o próprio | Manual 6/6. **Não roda no CI** | NÃO-CONFORME: o guard não é executado (A-01) |
| H-2 | pend. PLAN.md:96 | idem W5-H2 | — | — | — | CONFORME no escopo do adaptador. O legado fica fora do escopo declarado (A-03) |
| H-4 | pend. PLAN.md:98 | piso de `max_tokens` | `engineering-task-contract.js:292-300` | casos H-4 | Suíte pass | COM-RESSALVA (mutante sobrevive, A-11) |
| H-7 | pend. PLAN.md:100 | `detail.code` nas regras cruzadas | commit `67b24c43` | `test-engineering-task-contract.js` | Suíte pass | NÃO-CONFORME (governança): entregou a variante que o MAPA §6 atribui ao Owner, sem registro de decisão (A-06) |
| H-9 | pend. PLAN.md:102 | corpo PEM multilinha sem marcador redigido | `provider-campaign-process.js:15-111` | `test-campaign-key-body-redaction.js` | C3: 21/21, mutação morta. Commander, com chaves geradas em memória (ver lista abaixo da tabela) | COM-RESSALVA (A-05) |
| M-8 | pend. PLAN.md:107 | lock de install, exit 75 | `installer.js:22-80,291-392`; `install.js:186-188` | `test-install-lock.js` | Manual 13/13; mutações A e B mortas, C sobrevive. **Não roda no CI** | COM-RESSALVA (A-01, A-15) |
| M-10 | pend. PLAN.md:109 | órfão vira falha | `suite-orphans.mjs`, `ci-test-shards.mjs:92-104` | `test-ci-light-hook.js` (19/19, no CI via `test:governance`) | Suíte: só órfãos de fixture, detectados e mortos; nenhum órfão real | COM-RESSALVA: nenhum noturno Node 22 depois do #253 (A-14); `env: {}` escapa e `provider-campaign-process.js:152` usa esse padrão (A-16) |

Resultado da redação no H-9, com chaves geradas em memória:

| Chave | Multilinha | Linha única |
|---|---|---|
| Ed25519 | vaza | vaza |
| RSA | redigida | vaza |
| EC | redigida | vaza |

## 4. Achados (ordem de severidade)

Formato: ID | severidade | categoria | requisito | evidência | impacto | quem decide. Cada achado traz a reprodução em até 5 comandos, a partir de um checkout em `f96c6e9c`, com Node 24 e `npm ci`.

**A-01 | Alta | gate que não prova o que diz | "verify prova que os shards cobrem a suíte"; T-6; M-8; fecho W5 | Commander**
- `ci-test-shards.mjs:70-88` prova só a partição de `scripts.test`, não a cobertura de `test/`.
- Oito arquivos de teste nunca rodam no CI:
  - `test-install-lock.js` (P4)
  - `test-pids-max-single-source.js` (T-6)
  - `test-environment-production-callers.js` e `test-w5-environment-ledger.js`, citados como prova em `w5/STATUS.md:337` e no `PLAN-CONCLUSAO.md`
  - `test-environment-journey.js`, `test-platform-bindings-downgrade.js`, `test-bound-kernel-state-snapshot.js` e `agent-core-compile-check.test.js`
- `test-toolchain-zip-streaming.js` só roda dentro de 4 mutantes.
- Manualmente, todos passam: 13, 6, 9, 3, 4, 22, 3 e 1 casos.
- Impacto: uma regressão nesses requisitos fica verde no CI.
- Reprodução: `for f in test/test-install-lock.js test/test-pids-max-single-source.js test/test-environment-production-callers.js test/test-w5-environment-ledger.js; do grep -c "$(basename $f)" package.json; done` (todos 0), seguido de `grep -rn "install-lock" .github scripts` (vazio).

**A-02 | Alta | segurança/vazamento | envelope de erro do adaptador MCP | Owner (formato do envelope); Commander (teste que fixe o conteúdo)**
- `mcp-2026-adapter.js:860` e `:943` enviam `data.issues` com os erros brutos do Ajv. No ramo do `outputSchema`, a origem é a saída da tool: nomes de chave (`additionalProperty`) chegam ao cliente.
- Nenhum teste lê `issues`. A mutação que despeja o resultado inteiro passa 28/28.
- Reprodução: `sed -n 856,862p tools/lib/mcp-2026-adapter.js`, `sed -n 938,946p tools/lib/mcp-2026-adapter.js`, `grep -c issues test/test-mcp-2026-adapter.js` (0).

**A-03 | Alta | segurança/vazamento | "erro interno com segredo não chega ao cliente" | Commander; Owner se mudar mensagens autorais**
- `tools/lib/mcp-transport.js:57` (`Internal error: ${error.message}`) e `:205` (`buildMcpError(id, -32000, error.message)`) devolvem a mensagem de qualquer exceção.
- É o transporte dos 4 servidores MCP legados instalados. O H-2 corrigiu só o adaptador 2026, que era o escopo declarado.
- O MAPA não registra o legado.
- Reprodução: `sed -n 53,58p tools/lib/mcp-transport.js; sed -n 203,206p tools/lib/mcp-transport.js`.

**A-04 | Alta | gate quebrado por construção, recibo falso | recibos W4 e W5 de mutação | Commander**
- `check-w5-mutations.js:6` tem `EXPECTED = 29`; a matriz tem 44 testes desde a P2 (`79e1c066`).
- `check-w4-mutations.js:14-15` exige 18; o arquivo tem 20.
- Execução manual: W5 com 44/44 pass e exit 1; W4 com 20/20 pass e exit 1.
- Os dois scripts estão fora de `scripts.test`, então o CI não acusa. O comando que o recibo final cita como prova hoje reprova com tudo verde.
- A matriz em si roda no CI via `test:kernel` e passa. A falha é do gate e do recibo.
- Reprodução: `node scripts/governance/check-w5-mutations.js; echo $?` e `node scripts/governance/check-w4-mutations.js; echo $?`, em cgroup delegado.

**A-05 | Média | segurança/redação | H-9 | Commander, ou Owner para aceitar o limite**
- `sanitizeDiagnostic` vaza o corpo de chave privada sem marcador em linha única para Ed25519, RSA e EC, e o corpo multilinha de Ed25519.
- O MAPA §6 documenta só "Ed25519 PKCS8 de uma linha" e a "última linha <16".
- `containsCredential` não tem a heurística em `campaign-evidence-store.js:63` nem em `engineering-task-runtime.js:525,812`. `platform-bindings.js:758,764,772,849,1010` repassa o `stderr` do git sem varredura alguma, o que contradiz o comentário em `provider-campaign-process.js:37-39`.
- Reprodução: o `node -e` com `generateKeyPairSync` descrito no §3, H-9, comparando `body.join("")` com `body.join("\n")`.

**A-06 | Média | governança | H-7: decisão presumida | Owner**
- O MAPA §6 (H-7) atribui ao Owner a escolha entre `detail.code` próprio e `detail.rule`, porque a primeira "muda valores já publicados".
- O commit `67b24c43` entregou `detail.code`, e o MAPA §7 diz "O H-7 (P3) fechou na #252". Não há registro de decisão do owner.
- Reprodução: `grep -n "H-7" docs/evolution/pendencias-w0-w5/MAPA.md`.

**A-07 | Média | dupla verdade | estado operacional | Owner (semântica de `operational`); Commander (texto)**
- `requirements.json` tem `operational: not_authorized` em 27/27 famílias.
- `STATUS.md:24` e `PLAN.md:102-110` registram o ledger ativado em 2026-10-22/23.
- `STATUS.md:12,20` ainda dizem "nada ativado". A nota que marca esse trecho como histórico existe, mas o JSON, que é o artefato legível por máquina, não foi atualizado.
- Reprodução: `grep -c not_authorized docs/evolution/requirements.json` (27).

**A-08 | Média | teste com falso verde | `test-mcp-hseos-swarm-scope.js` | Commander**
- O `finally` aguarda um `exit` que já ocorreu. Se o servidor não sobe, o processo sai com 0 sem linha de contagem.
- Reproduzido por C3 e C4 com o binário nativo da ABI errada. Com o ambiente correto: 27 passed.
- O MAPA §6 atribui o sintoma ao Node 22; o mecanismo independe da versão.
- Reprodução: com `better-sqlite3` de outra ABI, `node test/test-mcp-hseos-swarm-scope.js; echo $?` (0, sem contagem).

**A-09 | Média | cobertura fora do gate | c8 90/80 | Owner (MAPA §5.9)**
- `.c8-kernel.json` não inclui o ledger e o banco da ativação (`tools/mcp-project-state/lib/{execution-event-ledger,operational-state-db,execution-approval-store,migrations,...}.js`), `packages/agent-environment/index.js` e `governed-execution/*`.
- Também ficam fora as implementações de F17, F18, F21 e F22.
- Reprodução: `jq .include .c8-kernel.json | grep -c operational-state-db` (0).

**A-10 | Média | segurança, residual | riscos do swarm | Commander**
- As mitigações de TOCTOU, hardlink e symlink existem (`run-scope.js:105-146`) e são testadas (27 casos).
- Ficam por caminho, sem fd:
  - o `mkdirSync` recursivo (`plan_squad.js:61`, `consolidate_handoff.js:64`)
  - o `readdir` e o `stat` (`get_run_state.js:27`, `list_runs.js:21-23`)
- O `cwd` aceita qualquer diretório não-raiz.
- Análise de código; nada foi reproduzido com corrida.

**A-11 | Média | mutante sobrevivente | H-4 | Commander**
- `engineering-control.js:363` (o MAPA cita 362): trocar `admission && binding` por `binding` sobrevive em 5 suítes (60, 25, 49, 40 e 22 casos).
- O recheck com `admission:false` (job claim e recovery) não tem teste.
- Reprodução, em cópia: `sed -i '363s/if (admission \&\& binding)/if (binding)/'` e rodar `test-engineering-control.js` (25/25).

**A-12 | Média | fail-open parcial | rollback da ativação | Commander; Owner para mudar o comportamento**
- `operational-state-db.js:683-684,742`: sem o arquivo de receipt, o cruzamento com `original_sha256_before` é pulado em silêncio. O rollback segue com o sha informado pelo operador, mais o `integrity_check`.

**A-13 | Baixa | doc desatualizada | `PLAN.md:116` e MAPA | Commander**
- Pendências que o PLAN e o MAPA dão como abertas, mas já estão fechadas:
  - "apply sem teste pela CLI real" e "K9 falha fora de cgroup": fechadas por T-1 e T-3.
  - Divergência de nome entre receipt e backup (MAPA §6): refutada por dois verificadores independentes, porque o nome é o mesmo (`:528-529` e `:727`).
  - "varredura de `pids_max` em 5 arquivos": hoje é a árvore toda.
  - Decision 0006 do ECP "não confirmada": está Accepted em 2026-10-01.
  - Linhas citadas defasadas: `:1079` é hoje `:1102`, e `:362` é `:363`.

**A-14 | Média | prova ausente | M-10 em suíte Node 22 | Commander**
- Último schedule: 40490163410, em `67b24c43`, anterior ao #253. O supervisor nunca rodou numa suíte completa Node 22.
- Reprodução: `gh run list --workflow CI --event schedule --limit 3`.

**A-15 | Baixa | concorrência | M-8 | Commander**
- O mutante C (sem `holder.alive`) sobrevive, porque a recusa ainda sai por `attempt>=200`, depois de cerca de 2 s.
- Há corrida possível no takeover do mutex velho (`installer.js:71-72`, só por análise).
- `ensureDir` é feito antes do lock.
- `uninstall`, `init` e `agent-core compile` ficam fora do lock.
- Os três resíduos do MAPA §7 se confirmam no código.

**A-16 | Baixa | limite do supervisor | M-10 | Owner**
- Processo com `env: {}` escapa da marca do supervisor. `provider-campaign-process.js:152` usa esse padrão, então um órfão desse caminho não é detectado.
- O limite está documentado no MAPA §7.

**A-17 | Baixa | processo | atribuição de IA | Owner (não reescrever sem autorização)**
- Os corpos das PRs #186–#195 e #197 (2026-10-01 a 2026-10-07) contêm "Generated with [Claude Code]". Os commits estão limpos.
- Reprodução: `gh pr view 197 --json body --jq .body | grep -c "Generated with"`.

**A-18 | Baixa | distribuição | global | Owner**
- O global instalado é o build de `795e6540` e não contém o M-8: `grep -c hseos-install.lock` no `installer.js` global dá 0.
- O `AGENTS.md` global diz "pinned to 2b4d6f37", o que diverge do instalado.

**A-19 | Baixa | contagem | MAPA §3 | Commander**
- O MAPA diz "17 aceitos". O `w5/STATUS.md` tem 20 com destino "aceito": itens 1–7, 10–19 e 23–25.
- O MAPA §2 lista M09 como "sem detecção", mas o recibo da W5-07 o dá como morto.

**A-20 | Info | rastreabilidade | W3 e W4 | Commander**
- `w3/STATUS.md` e `w4/STATUS.md` não têm rastro promessa→teste legível por máquina: 0 referências a `test/*.js`.
- Os runs do dev-squad não têm handoffs nem logs; a revisão por task aparece só como nome do revisor no STATUS.
- O STATUS do closeout mantém linhas "em execução" para trabalho já mergeado.

## 5. Divergências alegação × realidade

| Alegação | Fonte | Realidade |
|---|---|---|
| "W5 mutation matrix: 28 mutants rejected", exit 0 | `w5/evidence/final/verification-receipt.json:33,66` | O comando sai com 1 e 44/44 (A-04) |
| "W4 mutation matrix: 18 rejected" | `check-w4-mutations.js` | 20 casos; o comando sai com 1 (A-04) |
| "proves the split loses nothing" | `ci-test-shards.mjs:1` | 8 arquivos fora (A-01) |
| `test-w5-environment-ledger.js` como prova do fecho C11 | `w5/STATUS.md:337` | Não roda no CI (A-01) |
| "O H-7 (P3) fechou na #252" | MAPA §7 | Item com dono Owner, sem decisão registrada (A-06) |
| Backup e rollback com nomes de receipt diferentes | MAPA §6 | O nome é o mesmo; afirmação falsa (A-13) |
| "`apply` sem teste pela CLI real"; "K9 falha fora de cgroup" | `PLAN.md:116` | Ambos fechados (A-13) |
| "nada ativado operacionalmente"; `operational: not_authorized` | `STATUS.md:12,20`; `requirements.json` | Ledger ativado em 2026-10-22/23 (A-07) |
| "17 estão 'aceito'" | MAPA §3 | 20 (A-19) |
| `test-mcp-hseos-swarm-scope` sem contagem "no Node 22" | MAPA §6 | Com a ABI correta, Node 22 e Node 24 dão 27 passed; o falso verde vem do `finally` (A-08) |
| Varredura de `pids_max` em 5 arquivos | MAPA, linha do `pids_max` | A árvore toda, mas fora do CI (A-01, A-13) |
| Registry "now reference … HideakiSolutions" | `CHANGELOG.md:37` | Snapshot e fixtures ainda citam `Hideaki-Solutions-Core` (bloqueio legítimo de proveniência, frase imprecisa) |
| "Tags locais hseos-pend-p2/p3/p4" | STATUS da run de pendências | As tags estão no remoto |
| CLI global "pinned to 2b4d6f37" | `AGENTS.md` global | Instalado = `795e6540` (A-18) |

## 6. Gates que passam por construção e requisitos sem teste que falhe

**Gates que passam por construção:**
- `ci-test-shards verify`: verde com 8 arquivos de teste fora (A-01). Pelo mesmo motivo, o guard do T-6 e o teste do M-8 nunca falham no CI.
- `test (22.x)` em push e PR: roda o subset `check:cli` mais 3 arquivos. É por desenho e está documentado, mas o nome do check sugere a suíte.
- `check:cli`: coerência estrutural do manifesto, não do comportamento.
- `test-mcp-hseos-swarm-scope.js`: exit 0 sem executar casos quando o servidor não sobe (A-08).
- Hipótese **não verificada**: se o job `plan` falhar, o `test` (`if: always()`) recebe `fromJSON('')`. O provável é falhar fechado, mas não foi provado com um run.

**Gates que falham por construção** (o inverso, igualmente inútil como prova): `check-w4-mutations.js` e `check-w5-mutations.js` (A-04).

**Requisitos sem teste que falhe sem a implementação:**
- conteúdo de `data.issues` (mutação M3 sobrevive);
- valor exato do teto de 1 MiB (dobrar o default sobrevive);
- recheck com `admission:false` (A-11);
- latência da recusa do lock (mutante C);
- cada uma das duas checagens de hash do rollback isoladamente (só morrem juntas; defesa em profundidade, não defeito).

**Arquivos do kernel e da W5 fora do `.c8-kernel.json`:** ver A-09.

## 7. Lacunas de verificação e decisões do owner

**Lacunas (não inspecionado e por quê):**
- Postgres: a integração `managed-governance-postgres` foi pulada localmente por falta de URL. O CI cobre.
- Consumidores reais (W3 a W5): nenhuma campanha com modelo real foi reexecutada, porque exigiria gasto e login. F08, F17 e F18 não foram certificados.
- Node 22: a suíte completa não rodou localmente; rodaram só testes pontuais (C3).
- O banco `project.db` ativado e os outros 21 bancos do host não foram tocados nem lidos.
- macOS e Windows; navegador e computer-use reais fora do cgroup do CI.
- `fromJSON('')` no CI (hipótese em aberto). A corrida do mutex do M-8 e o `mkdir` do swarm só foram analisados, não reproduzidos.
- Os recibos por task de W5-01 a W5-12, LV/CO, B1–B4 e cl1 não foram abertos um a um; só a tabela FR→teste (41 arquivos, todos existem).
- O rastro promessa→teste de W3 e W4 não foi reconstruído task a task.
- Mutação: 16 mutações em cópia descartável cobriram 8 requisitos de risco (limite HTTP, vazamento de erro e `issues`, backup do rollback, H-4, lock, redação de PEM). Não houve mutação de orçamento (F13) nem de ACP.
- A W6 não foi auditada: a W5 não depende dela, e o PLAN declara "nada".

**Decisões do owner que bloqueiam o fechamento (não são defeitos):**
1. ADRs 0042 (candidata), 0043 e 0044 (draft) e 0045 (Proposed). W1 a W5 foram mergeadas sobre eles.
2. Certificação de bindings (F08, F17, F18), quarta família, `tools/call` e MRTR do Codex, liberação da reserva de US$ 9.
3. Semântica de `operational` depois do piloto (A-07).
4. Formato do envelope (`issues`, A-02), H-7 (`detail.code` ou `detail.rule`, A-06), digest de conta sem sal (também em `provider-native-adapter.js:185`).
5. Conjunto do gate c8 (A-09), G3 sem folga (tools 393, packages 137), retenção de saída dos adapters.
6. Data do sunset do legado; navegador e computer-use na CLI.
7. Se os 8 aceites do Commander com dono Owner valem como decisão (itens 4, 5, 11, 15, 16, 19, 23 e 24 do `w5/STATUS`). Só o item 23 cita uma decisão do owner, e apenas no PLAN da run.
8. Reinstalação da distribuição global (A-18) e corpos de PR com atribuição (A-17).

## 8. Plano de correção sugerido (não executado)

| Prioridade | Grupo | Ação | Quem |
|---|---|---|---|
| 1 | Proteção de CI | Incluir os 8 arquivos em `scripts.test` (ou `test:kernel`). Fazer o `verify` falhar quando um `test/**` não estiver em nenhum passo. Corrigir o `finally` do swarm-scope para falhar alto. | Commander |
| 1 | Gates de mutação | Derivar `EXPECTED` da lista de mutantes, sem afrouxar. Pôr `test:w4-mutations` e `test:w5-mutations` na suíte ou retirá-los dos recibos. Reemitir os recibos. | Commander |
| 2 | Vazamento MCP | Teste que fixe o conteúdo de `issues`. Decidir o formato (filtrar `params` e `instancePath` do `outputSchema`). Estender o H-2 ao `mcp-transport.js:57,205`, preservando as mensagens autorais (`Task not found`) e com nota no `v4-migration.md`. | Owner (formato); Commander (teste e legado) |
| 2 | Redação | Cobrir corpo de chave em linha única e Ed25519. Aplicar a heurística em `campaign-evidence-store`, na sonda de `engineering-task-runtime` e no `stderr` do git em `platform-bindings`. Usar fixture com chave gerada em memória. | Commander |
| 3 | Governança | Registrar a decisão do owner sobre H-7 e sobre os 8 aceites. Aceitar ou rejeitar os ADRs 0042–0045. | Owner |
| 3 | Dupla verdade | Atualizar `requirements.json` depois de decidida a semântica de `operational`. Corrigir PLAN.md:116, MAPA §2, §3, §6 e §7 e o `CHANGELOG.md:37` (A-13, A-19). | Owner, depois Commander |
| 4 | Robustez | Teste com `admission:false` (H-4). Teste de latência do lock e da janela de lock vazio. Aviso ou recusa quando o receipt do rollback está ausente. `mkdir` do swarm por fd. | Commander; o rollback é do Owner |
| 4 | Prova operacional | Conferir o primeiro noturno depois do `863fec28` ou disparar `workflow_dispatch`. Provar a semântica de `fromJSON('')` com o `plan` falhando. | Commander |
| 5 | Cobertura | Incluir o ledger e o banco da ativação no `.c8-kernel.json`, ou registrar a exclusão como decisão. | Owner |

## 9. Registro de custo por atividade

| Atividade | Executor | Tempo de parede | Tokens / uso |
|---|---|---|---|
| Ancoragem, leitura de fontes, plano | Commander (Opus) | ~25 min | não medido no thread principal |
| C1: contratos, MCP, governança | Sonnet | 9,2 min | 141,7 k tokens, 60 tool calls |
| C2: execução, bindings, dados, W1–W2 | Sonnet | 15,7 min | 146,7 k tokens, 70 tool calls |
| C3: segurança, CLI, processo | Sonnet | 11,3 min | 174,4 k tokens, 74 tool calls |
| C4: CI, gates, W3–W5 | Sonnet | 9,3 min | 177,4 k tokens, 63 tool calls |
| Suíte completa (cgroup, Node 24) | Commander via `heavy-run` | 31,8 min (20:06–20:38Z), load 2,8–4,0 | — |
| Testes fora do CI e gates de mutação | Commander via `heavy-run` | ~5 min | — |
| R1: revisor cético, passagem cega | Sonnet | 35,3 min | 204,4 k tokens, 107 tool calls |
| Confronto (passagem 2) e relatório | Commander (Opus) | ~20 min | não medido |
| **Subagentes, total** | 5 agentes Sonnet | — | **~844,6 k tokens, 374 tool calls** |

## Revisão cética (registro)

- **Passagem 1 (cega, R1):** 10 itens julgados sem acesso aos vereditos dos coletores.
- **Passagem 2 (confronto, Commander):**
  - **W4 de mutação.** R1 dizia que o gate estava coerente. Foi refutado por execução: 20/20 passam e o script sai com 1. O achado foi mantido.
  - **Redação de PEM.** R1 apontou o vazamento em linha única para todos os tipos de chave. Confirmei com sonda própria e passei o achado de "limite conhecido" para A-05.
  - **Receipt da ativação.** C2 e R1 refutaram o MAPA de forma independente. Virou divergência de documentação, não defeito.
  - **swarm-scope "Node 22".** C3 e C4 divergiam. Com a ABI correta deu 27 passed. O defeito é o `finally`, não a versão do Node.
  - **Vereditos rebaixados.** Os `CONFORME` de W5-C e de T-6 caíram porque nenhum teste do CI falharia sem a implementação. Os vereditos de família não chegaram a `CONFORME`, porque o consumidor real não foi verificado.

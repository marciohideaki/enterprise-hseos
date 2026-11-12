# UNDERSTANDING — o que o terminal é e promete (fase 3)

## Superfície

| Superfície | Onde | Prova atual |
|---|---|---|
| CLI `hseos` | `tools/cli/hseos-cli.js`, manifesto `npm run check:cli` | suíte + `core-journey` instalado |
| API local versionada (`/v1/...`, loopback, Bearer) | `tools/cli/lib/engineering-control-http.js`, `hseos control serve` | `test-engineering-control*.js`, `test-terminal-api.js`, `core-journey` |
| SDK JS/TS e Python | `packages/control-sdk/**`, `sdk_py_client.py` | `core-journey` (TS `tsc --strict` + contrato negativo; Python stdlib) |
| MCP moderno (`2026-07-28`) e compat | `tools/lib/mcp-2026-adapter.js`, `tools/lib/governed-execution/native-mcp-server.js` | `mcp-journey --mode modern`, MRTR provado com cliente real (F20) |
| Terminais e jobs | `tools/cli/lib/terminal-control.js`, `job-control.js` | `test:terminals`, `test-job-*.js` |

## Invariantes do PLAN (§ "Invariantes de todas as ondas") e onde são aplicados

| Invariante | Mecanismo | Lacuna desta run |
|---|---|---|
| Identidade, sequência esperada, idempotência | CAS e chaves de idempotência no ledger; `test-terminal-control.js`, `test-job-recovery.js:323` | — |
| Cursor de eventos recuperável | `test-terminal-api.js`, replay `packages/agent-session-store/replay.js` | GM-07 (execução registrada) |
| API autenticada e restrita | Bearer global antes do roteamento (`engineering-control-http.js:46-49`) | GM-02 (401 por ação) |
| Terminais: entrada, saída, resize, attach sob a mesma autoridade | `terminal-control.js:256`, `test-terminal-api.js` | GM-02 |
| Aceite separado de sessão concluída | `ENGINEERING_ACCEPTANCE_UNCOVERED`, verificadores protegidos | — |
| Crash em cada fronteira sem repetição nem órfãos | `test-terminal-control.js:135-192` (6 pontos), `test-terminal-executor.js` | — |
| Orçamento finito e acumulado | reservas de campanha/jobs; `test-job-campaign.js`, `test-job-faults.js` | GM-03 (N processos) |
| Segredos fora de prompt, workspace, log e artefato | broker de egress, redação pontual | GM-04 (varredura ponta a ponta) |
| Sem pool de identidades | `credential_pool:false` (`engineering-model.js:106,188`; `test-engineering-model.js:275`) | — |
| Contratos/eventos antigos legíveis, sem reescrever histórico | migrations versionadas, testes do ledger | GM-06 (upgrade/rollback do pacote instalado) |

## Fronteiras de falha que o terminal declara (não são defeitos desta run)

Bytes antes da persistência (L-05), dependência de cgroup v2 delegado + bubblewrap + pidfd (sem eles a criação de tarefa recusa com `ENGINEERING_ISOLATION_UNAVAILABLE`), só Linux, API só loopback.

## Decisões e precedência aplicada

| # | Decisão | Regra |
|---|---|---|
| U1 | Nenhuma promoção de `real_consumers` nesta run | Seção 1 do prompt exige reauditoria sem ressalva impeditiva; o ADR-0050 §2 restringe `verified_installed_local_scope_only` a binding local instalado e só o F20 foi ratificado. Estender o valor a F19/F04/F12 é decisão do owner (precedência: ADR aceito > prompt da run). Opção conservadora e reversível |
| U2 | Não rebaixar F01/F11/F16/F21 | Seção 1 só autoriza a mudança para `verified_installed_local_scope_only`; rebaixar é outra mudança de status. Declarar a base e o conflito no inventário e abrir OWNER-GATE |
| U3 | Corrigir o teste de boot governado (GM-01) isolando o banco, sem tocar o produto | `AGENTS.md` §11 (causa conhecida: dependência do estado do host); nunca afrouxar o caso: a asserção `EXECUTION_ACTIVATION_PENDING` continua |
| U4 | Ondas: TA (análise), TB (invariantes por teste), TC (aceite instalado), TD (fechamento). Quatro em vez de cinco | A TC do prompt (promoções) fica vazia por U1; o aceite instalado (TD do prompt) passa a ser a TC. Tags `hseos-terminal-wa` a `hseos-terminal-wd` |
| U5 | Documento de usuário do terminal fora de `files` do pacote | `docs/` empacotado é lista explícita (`package.json` `files`); arquivo novo em `docs/` não listado não conta no G3. Empacotá-lo seria mudança de orçamento (`docs` 7) |
| U6 | Gate de prontidão (`terminal-readiness.json` + teste) em `docs/evolution/terminal-closeout/` e `test/` | Fora do pacote; não conta no G3 |

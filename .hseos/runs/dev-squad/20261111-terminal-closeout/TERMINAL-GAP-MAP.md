# TERMINAL-GAP-MAP — W0 a W5 (fase 1, 2026-11-11)

Base: `master` `99a54dcc`. Fontes: relatórios dos 3 exploradores Sonnet somente leitura (prompt em `prompts/TA-explorer-common.md`) e reconferência do Commander nos itens que mudam registro (marcados **[R]**: conferido pelo Commander no código ou na ferramenta). Classes da seção 7.3 do prompt. "Muda veredito" = muda um item T1–T12 ou um status.

## Linha de base (fatos de ferramenta)

| Item | Resultado |
|---|---|
| `heavy-run --mem 4G -- npm test` (Node 24.15.0, 2026-11-11) | **exit 1**: `test:mcp-governance` → `test/test-mcp-hseos-governance.js` 32 passed, 1 failed (`governed boot: … fail closed`); a cadeia `&&` parou no script 58 de 112 |
| Cauda da cadeia (scripts 59–112), um a um | ver `STATUS.md` (fase 1, "Linha de base da cauda") |
| CI na `master` `99a54dcc` | `CI` push 42732249163 success; `CI` agendado 43023191758 e 42825441132 success; `Core journey (installed package)` 42732249377 success; `Standalone Smoke Test` 42732249149 success (`gh run list --branch master`) |

**[R] Causa da falha local:** o caso de `test/test-mcp-hseos-governance.js:150-155` roda `startNativeMcpServer` em `NODE_ENV=production` sem `dbPath` nem `HSEOS_STATE_DB`; o servidor resolve `DEFAULT_STATE_DB` (`tools/lib/governed-execution/native-mcp-server.js:132`), que neste host é o `.hseos/state/project.db` **ativado** em 2026-10-22 (log `governed mode=activated user_version=17`), então não lança `EXECUTION_ACTIVATION_PENDING` (`:148-153`) e falha depois com `TypeError: Explicit execution governance is required for governance:noop`. No CI o checkout não tem banco ativado e o caso passa. Defeito de isolamento do teste (depende do estado do host e abre o banco real em modo ativado), não do produto.

## Lacunas

| id | família / critério | lacuna | evidência | classe | funcional? | muda veredito? | destino |
|---|---|---|---|---|---|---|---|
| GM-01 | T1 / F20 | Teste de boot governado depende do banco do checkout | acima **[R]** | FECHÁVEL | não (teste) | **sim** (T1 local) | TB |
| GM-02 | F11, F16 / T7 | Recusa sem credencial só testada em `GET /v1/terminals/<id>`; `POST /v1/terminals/commands` (input, resize, EOF) e `/events` sem teste 401 | `test/test-terminal-api.js:39`; autenticação global em `tools/cli/lib/engineering-control-http.js:46-49` | FECHÁVEL | não (o código é uniforme) | sim (T7 "aprovações/autoridade" por ação) | TB |
| GM-03 | F13 / T7 | Sem teste de N processos reservando contra o mesmo teto agregado; o mais próximo usa 2 engines no mesmo processo | `test/test-agent-orchestration.js:457`; `test-job-faults.js:427` prova despacho único, não soma | FECHÁVEL (parte determinística) | sim (invariante "orçamento acumulado") | sim (T7) | TB |
| GM-04 | F08 / T7 | Sem varredura automatizada de segredo canário sobre prompt, workspace, log e artefato de uma execução ponta a ponta; só redação pontual | `test-campaign-key-body-redaction.js`, `test-agent-memory.js`, `test-mcp-transport-robustness.js`; busca negativa: `test/*.js` por `secret|canary|leak|redact` e nomes `secret|leak` | FECHÁVEL | sim (invariante "segredos fora de…") | sim (T7) | TB |
| GM-05 | F06 | Nenhum teste reabre o controlador com job adiado (`not_before`) ainda pendente; o gap fala em "agendamento persistente" para o que o código tem como adiamento único | `test-job-control.js:26,41-42`; `test-job-faults.js:397,427,478` | FECHÁVEL | sim | não (F06 já `verified_w4_scope_only`; fecha a certificação do que existe) | TB |
| GM-06 | T5 | Jornada instalada cobre CLI, API, SDK JS/TS/Python e MCP fora do checkout, mas não cobre instalação offline, upgrade e rollback sem reescrever eventos | `core-journey.mjs:1679` ("no migration"); `.github/workflows/core-journey.yaml` | FECHÁVEL | sim | **sim** (T5) | TC |
| GM-07 | T5 / T8 | Nenhuma execução local registrada das jornadas nesta revisão; continuidade (fechar/reabrir, resume/replay/fork) provada só por testes de unidade e integração | `test-compaction-resume-fork.js:383-768`, `test-compaction-agent-run.js:145`, `test-terminal-control.js:135-192` | FECHÁVEL | não | sim (T5, T8 pedem execução registrada) | TC |
| GM-08 | T9 | Sem documentação de usuário do terminal (instalar, usar, limites, o que não está certificado) | busca em `README.md`, `docs/README.md`, `docs/getting-started.md`, `docs/engineering-control-api.md` | FECHÁVEL | não | sim (T9) | TD |
| GM-09 | T2 / F01, F11, F16 (F21 em parte) | **[R]** F01, F11 e F16 têm `real_consumers: verified_installed_local_scope_only` sem `evolution_evidence` nem `evolution_scope`; promovidas em `52f891f2` (2026-09-26) com base em "CLI/API/SDKs instalados … jornadas instaladas" (`docs/evolution/w2/STATUS.md:42,61`), clientes roteirizados. O ADR-0050 (aceito em 2026-10-31) diz depois que os itens da sua §5 "não contam para nenhum nível acima de L1, em nenhuma família" (L133), entre eles o consumidor sintético (L136), e que o valor "continua restrito a binding local instalado" (L95); só o F20 teve o uso ratificado (L241). F21 tem `evolution_evidence` e `evolution_scope` (tarball + `plugin doctor`, `w4/CONSUMERS.md`), mas usa o valor fora de binding, como F01/F11/F16 | `requirements.json`; ADR-0050 L95, L133, L136, L241 | OWNER-DECISÃO (rebaixar não é autorizado nesta run; manter exige ratificação) | não | sim (T2: contradição) | TD (declarar evidência e conflito no inventário de F01/F11/F16) + OWNER-GATE (F01, F11, F16, F21) |
| GM-10 | T2 | **[R]** `PLAN.md:123` diz A-09 e A-15 abertos; o código tem `init`/`uninstall` sob `_withInstallLock` (`tools/cli/commands/init.js:88`, `uninstall.js:122`) e os adapters nativos e índices no `.c8-kernel.json` | `.c8-kernel.json` (102 entradas) | FECHÁVEL | não | sim (T2) | TD |
| GM-11 | T2 / F23 | `MAPA.md:24` diz F23 `not_verified_for_evolution`; o inventário tem `verified_w0_scope_only` desde 2026-11-04 | `MAPA.md:24`; `requirements.json` F23 | FECHÁVEL | não | sim (T2) | TD |
| GM-12 | T2 / F12 | Gap "descendentes dinâmicos ainda não certificados" contradiz `test/test-workflow-expansion.js` (filhos tardios, expansão concorrente, 2 processos, `:180,471-488`) registrado no `package.json`; o campo `tests` não o cita | `requirements.json` F12 | FECHÁVEL | não | sim (T2) | TD |
| GM-13 | T2 / F22 | O gap mistura contratos de plugin (W4, testados) e catálogo de extensões da IDE (W6) | `requirements.json` F22; `PLAN.md:42,89` | FECHÁVEL (texto) + FORA-DO-TERMINAL (catálogo) | não | não | TD |
| GM-14 | T2 / F06 | `evolution_scope` de F06 cita `w4/STATUS.md:582`, texto geral, como base do agendador | `requirements.json` F06 | FECHÁVEL | não | não | TD |
| GM-15 | T1 | `.c8-kernel.json` não inclui `tools/cli/commands/control.js`, `installer.js`, `packages/agent-context/index.js`; mudar o conjunto do gate é decisão do owner (`MAPA.md` §5 item 9) | `.c8-kernel.json` | OWNER-DECISÃO | não | não (o gate atual é o vigente) | OWNER-GATE |
| GM-16 | T12 | Sem `W6-ENTRY.md` nem gate legível por máquina do terminal | busca negativa `terminal-readiness` em `.js/.md/.json` (exclui `node_modules`, `.git`) | FECHÁVEL | não | sim (T2, T12) | TD |

## Limites declarados (não entram no plano; classe registrada)

| id | item | classe | fonte |
|---|---|---|---|
| L-01 | TypeScript verificado por remoção de tipos, não por `tsc` (`engineering-project-verifier.js:38,130`); `tsc` não está no pacote | DESENHO-ABERTO | `w1/STATUS.md` |
| L-02 | Verificador web só por conteúdo estático (`web-content-v1`) | OWNER-DECISÃO (navegador na CLI adiado, `MAPA.md` §5 item 4) | `engineering-project-verifier.js:17` |
| L-03 | Repositórios com filtros Git recusados (`PROJECT_GIT_FILTERS_UNSUPPORTED`) | DESENHO-ABERTO (recusa de segurança, testada em `test-engineering-workspace.js:142`) | `engineering-workspace.js:42` |
| L-04 | Workflows sem aplicação agregada de patches | DESENHO-ABERTO | `engineering-workflow-runtime.js` |
| L-05 | Bytes anteriores à persistência podem se perder em crash; vira reconciliação | DESENHO-ABERTO | gap F16, `test-terminal-executor.js:125` |
| L-06 | Agendamento recorrente (cron) inexistente; só `not_before` | DESENHO-ABERTO | GM-05 |
| L-07 | Plugins de capacidade `scaffolded` (não emitidos); plugin de terceiro só por definição local com pin no catálogo | OWNER-DECISÃO (ativação/pacotes: W8) | `plugins-source.js:13`, `tools/cli/commands/plugin.js` |
| L-08 | Quarta família (API compatível) e ACP de terceiro | OWNER-DECISÃO (C6, C4 BLOCKED sem chave) | `MAPA.md` §9 |
| L-09 | MRTR e `tools/call` com o Codex | DEPENDÊNCIA-EXTERNA (Codex 0.166.0 negocia `2024-11-05`) | `PLAN.md` "Pendências antes de abrir a W6", item 2 |
| L-10 | F17 `deterministic` `not_verified_for_evolution` | OWNER-DECISÃO (depende de C4) | `REAUDIT-BLIND-2026-11-05.md` |
| L-11 | Navegador e computer-use na CLI; elicitação sem imagem | OWNER-DECISÃO (adiados; override desligado em produção) | `MAPA.md` §5 item 4, §8 decisão (d) |
| L-12 | Resíduo A-05 (redação: corpo de 2 a 4 linhas curtas, PKCS8 cifrado); item 4 do `w5/STATUS` condicionado | OWNER-DECISÃO | `MAPA.md` §8 |
| L-13 | macOS, Windows, servidores próprios, acesso remoto | FORA-DO-TERMINAL (W7) | `PLAN.md:61` |
| L-14 | Catálogo de extensões da IDE (F22), F25 | FORA-DO-TERMINAL (W6) | `PLAN.md:60` |

## Eixo `real_consumers` (17 famílias de W0 a W5 em `not_verified`)

Nenhuma promoção é proposta nesta run: as candidatas a custo zero dependem de estender o uso de `verified_installed_local_scope_only` além de binding local instalado, o que o ADR-0050 §2 restringe e só o owner ratificou para o F20 (GM-09).

| Família | Classe | O que falta (fonte) |
|---|---|---|
| F02, F03, F05, F09, F10 | GASTO-NECESSÁRIO | `agent run` com modelo real; F05 com ferramenta que exija aprovação e mudança de baseline; F10 com `max_failed_corrections ≥ 1` e reprovação não encenada (C10). Binding local de 4096 tokens não admite a tarefa (piso `max_tokens` 12962 medido no fixture `addition.json`, `MAPA.md` §6; inferência para a tarefa real) |
| F19 | OWNER-DECISÃO | Cliente real sobre CLI/API de controle seria custo zero, mas o valor é restrito a binding local (ADR-0050 §2) |
| F04, F12 | OWNER-DECISÃO | Padrão do F21 (tarball + execução instalada, `w4/CONSUMERS.md`) já existe; aplicar o valor exige a mesma ratificação de GM-09 |
| F06, F13 | GASTO-NECESSÁRIO | Campanha de jobs com binding real; F13 com mais de um binding concorrente (C10; `traceability.md:25-31`) |
| F22 | FORA-DO-TERMINAL (catálogo IDE) / OWNER-DECISÃO (parte de plugins segue F04) | C10 |
| F08, F18 | GASTO-NECESSÁRIO + OWNER-DECISÃO (C6) | Campanha L2 completa com varredura de segredos (ADR-0050 §2) |
| F17 | OWNER-DECISÃO | C4 BLOCKED |
| F14, F15 | OWNER-DECISÃO (decidido 2026-11-09) | Não repetir campanha |
| F23 | DESENHO-ABERTO | Não há critério de consumidor real definido para a família de governança |

## Hipóteses da seção 4 do prompt

| Hipótese | Resultado |
|---|---|
| TS por remoção de tipos | confirmada (L-01) |
| Web só estático | confirmada (L-02) |
| F06 agendamento persistente não certificado | parcial: `not_before` persistente testado; falta reabertura com job pendente (GM-05); recorrência inexistente (L-06) |
| F12 descendentes dinâmicos | refutada no determinístico (GM-12); `real_consumers` segue `not_verified` |
| F13 orçamento concorrente | confirmada (GM-03) |
| Plugins `scaffolded` | confirmada para plugins de capacidade (L-07) |
| Bytes antes da persistência | confirmada como limite declarado (L-05) |
| A-05, A-09, A-15 | A-09 e A-15 fechados no código **[R]** (GM-10); A-05 residual (L-12) |
| 8 resíduos do `w5/STATUS` com o owner | todos com decisão registrada (`w5/STATUS.md:540-553`), exceto o item 4, condicionado (L-12) |
| Quatro integrações, três provadas | confirmada; a quarta BLOCKED por decisão do owner (L-08) |

## Revisão cética do GAP-MAP (Sonnet isolado, duas passagens) e decisão do Commander

| Achado do revisor | Sev | Reconferência do Commander | Decisão |
|---|---|---|---|
| GM-01 bloqueia T1 | BLOCKER | causa reconferida (acima) | já é TB1; o fallback para `DEFAULT_STATE_DB` em produção é comportamento pretendido do produto (servidor do projeto), a correção é isolar o teste |
| O1 downgrade de schema sem linha | MAJOR | **refutado em parte:** `test/test-mcp-activated-mode.js:200-201` cobre "newer unknown user_version" (`user_version = 18`) com recusa `EXECUTION_ACTIVATION_PENDING`; não há prova sobre o **pacote instalado** | GM-06 passa a incluir explicitamente o downgrade (release anterior sobre banco mais novo: recusa sem escrita) |
| O2 equivalência CLI/API/SDK sem linha | MAJOR | **parcial:** `core-journey.mjs:683` (prepare → command → query → events via SDK JS, TS e Python na mesma instância, "equivalência") e `:920` (leitura cruzada pelo SDK Python); a CLI participa como `hseos control serve`, não como cliente das mesmas operações | nova linha **GM-17** (abaixo) |
| GM-09 citações e F21 | MAJOR | aceito: âncora corrigida para L133/L136; F21 tem evidência | linha GM-09 reescrita |
| O3 credenciais concorrentes | MINOR | `credential_pool:false` + testes de conta; "2 processos com a mesma credencial" não conferido | declarado como limite **L-15** |
| O4 cancelamento transitivo, múltiplos clientes, tools desconhecidas | MINOR | `test-terminal-control.js:107,194`, `test-job-recovery.js:108`, `test-tool-runtime.js:321,531` (explorador W3–W4) | conferido sem lacuna |
| GM-02 busca estreita | MINOR | `grep -rln "terminals/commands" test/` → só `test/journeys/core-journey.mjs`; nenhum 401 de terminal fora de `test-terminal-api.js:39` | GM-02 mantido |
| GM-10 A-09 "vai para W6/E7" | MINOR | "W6/E7" é a onda W6 da run `20261030-1810-owner-decisions` (MAPA §8, A10 "Feito no E7 (`a65eade5`)"), não a W6 canônica; `packages/model-providers/index.js`, `packages/runtime-providers/index.js`, `packages/adapter-sdk/index.js`, `native-mcp-adapters.js` e `entrypoint-adapters.js` estão no `.c8-kernel.json` | GM-10 mantido |
| O5 edição concorrente e entrega incorreta | NOTE | F10 e o aceite independente (F09) já são `verified_w1_scope_only` | sem lacuna nova |
| Piso 12962 é do fixture | NOTE | aceito | a tabela `real_consumers` diz "piso medido no fixture `addition.json`; inferência para a tarefa real" |

| id | família / critério | lacuna | evidência | classe | funcional? | muda veredito? | destino |
|---|---|---|---|---|---|---|---|
| GM-17 | T5 / F19 | Equivalência entre superfícies provada para API e SDKs na mesma instância; a CLI não repete as mesmas operações como cliente | `core-journey.mjs:683,920` | FECHÁVEL só como execução registrada (TC1 consulta pela CLI o que o SDK criou) | não | não | TC |

| id | item | classe | fonte |
|---|---|---|---|
| L-15 | Credenciais concorrentes (dois processos com a mesma credencial ou cota) sem teste dedicado; sem pool por desenho | DESENHO-ABERTO | `engineering-model.js:106,188` |

## Lacunas achadas durante a execução

| id | família / critério | lacuna | evidência | classe | funcional? | muda veredito? | destino |
|---|---|---|---|---|---|---|---|
| GM-18 | T9 | `README.md` diz 52 skills em 7 linhas (L17, L331, L367, L409, L432, L442, L708); `.agents/skills/` tem 54 (`scripts/governance/verify-doc-facts.sh` rc=1, 7 discrepâncias). Defasado desde #292/#294 (skill `legacy-code-review` e validador do catálogo) | `verify-doc-facts.sh` | FECHÁVEL | não | sim (T9 cita o mecanismo) | TC (TD0) |
| GM-19 | T5 | Banco **ativado** não tem caminho de migração entre schemas (TC1 caso c) | `docs/evolution/terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md` | DESENHO-ABERTO | não hoje (todas as instalações no schema 17) | não (risco para a W6) | OG-16 |

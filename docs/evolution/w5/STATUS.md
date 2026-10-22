# W5 — estado de execução

Tipo: evidência de progresso, iniciado em 2026-10-10 e atualizado em 2026-10-17 (fechamento W5-12). Base dos contratos `e079409c`, rebaseados sobre a master `0dd3bb89`; upstream `master`;
feature `feature/hseos-evolution-w5`. Governança: Constituição §§2.6/5/7, AGENTS.md, ADR-0047 Accepted (2026-10-11).

## W5-01

Contratos redigidos na task `task/hseos-w5-contracts`: `.specs/features/harness-w5/{spec,design,tasks,_INDEX}.md`,
`docs/decisions/harness-w5-intake.md`, ADR-0047 (Accepted em 2026-10-11), `docs/evolution/w5/{PLAN,STATUS,README}.md` e nós
`proposed` no fragmento do grafo de capacidades (fonte `.enterprise` e espelho `.agents`).
Estado: **concluída em 2026-10-11** com a aplicação das decisões do gate G2 (G2 aprovado pelo owner na mesma data; ver [PLAN.md](PLAN.md) seção 7). Nenhum código de produção alterado.
Próximo passo: **onda B1** (W5-02a, W5-02b1 seguida de W5-02b2, e W5-04; 3 agentes simultâneos, builds serializadas).
As verificações registradas pela task (diff, validador de grafo, suítes focadas, contagem do pacote) devem
ser reexecutadas por quem integrar; este arquivo não as certifica por antecipação.

Fatos novos verificados pela task (2026-10-10), com fonte em `design.md` seção 2: o seccomp atual bloqueia
`socket`, `socketpair` e `connect`; `pids_max` padrão é 32; saída do executor é limitada a 64 KiB; o broker de
egresso existente atende uma única rota de provider; em `bwrap --unshare-all` o loopback funciona e não há rota
externa; `xdotool`, `pyright`, `typescript-language-server`, `debugpy` e `python-xlib` estão ausentes no host.

## Matriz de entrega

| Etapa                                    | Determinístico                                                      | Consumidor real                                         | Ativação       |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | -------------- |
| W5-01                                    | contratos concluídos; verificação a reexecutar por quem integrar    | não aplicável                                           | não autorizada |
| W5-02a / W5-02b1 / W5-02b2 / W5-04       | integradas e verificadas na B1 (seção "Integração da onda B1")      | não verificado                                          | não autorizada |
| W5-LV1 / W5-LV2 / W5-CO1 / W5-CO2        | integradas e verificadas na B1 (seção "Integração da onda B1")      | não verificado                                          | não autorizada |
| W5-03 / W5-05 / W5-06                    | integradas e verificadas na B2 (seção "Integração da onda B2")      | não verificado                                          | não autorizada |
| W5-07 / W5-08 / W5-09                    | integradas (B3, B3b); verificação final no recibo de fechamento     | não verificado                                          | não autorizada |
| W5-10 / W5-10b / W5-11a / W5-11b / W5-12 | integradas; verificação final no recibo de fechamento (seção W5-12) | prova de integração local: A real, B sintético (W5-11b) | não autorizada |

## Gate G2 (aprovado em 2026-10-11)

Decisões do owner aplicadas em PLAN seção 7, spec, design, tasks e ADR-0047:

1. Consumidores reais A (`cambio-real/apps/platform-web`, prova principal) e B (`axon-web`, teste e defeito sintéticos declarados); instalação offline do cache.
2. Distribuição híbrida: contratos e runtime de todas as capacidades no core com carregamento tardio; empacotáveis em `plugins/*` a partir do mesmo código; binários como pins fora dos tarballs.
3. Inventário: elevar o teto (sem realocação); `packages` 123 para 137 e teto 1554 (G3 de 2026-10-11); acima disso só pelo número medido, com novo G3 (projeção alta ≈1565, estimativa); plugins ≤40 entradas e ≤1 MB.
4. Isolamento: P1 e P2 aprovados; seccomp por argumento (permite `AF_UNIX`/`AF_INET*`; bloqueia `AF_NETLINK`, `AF_PACKET`, `AF_VSOCK`, `io_uring`); Chromium com `--no-sandbox` dentro do `bwrap`.
5. Entrada X11 por `xdotool` (BSD), pin externo; `python-xlib` descartado.
6. Modelo nos ensaios (W5-11b): local ou custo zero; assinaturas Claude/Codex com no máximo 3 despachos por binding; API paga com teto de US$ 1; reserva e recibo por despacho; sem rota, BLOCKED; acima do teto, G4.
7. Aceite endurecido na W5: task nova W5-10b (B4), com os resíduos REVIEW3-C1 e N1.
8. Itens menores: B1 com 3 agentes; pins e licenças com "sem download em runtime, sem cache = BLOCKED" e conferência de licença no artefato fixado por task; pendências fora da W5 registradas; W5-02b2 absorve a leitura do virtual store do pnpm e os testes nativos do verificador.
9. G2 fechado; ADR-0047 Accepted.

## Decisões do Commander sobre as inconsistências (2026-10-11)

- **Soma dos orçamentos:** a opção "elevar o teto" do owner implica teto 1554 com `packages` 137, aprovado no G3 de 2026-10-11. A alteração de `test/test-package-surface.js` entra na W5-02a, primeira task que adiciona entradas em `packages`. O extra do híbrido (≈1565, estimativa) só vale pelo número medido no fechamento da onda, com novo G3.
- **`plugins/memory`:** aceito como está; distribui o mesmo código e a persistência continua no ledger do host (a memória não pode ter store próprio fora do ledger). Justificativa no design §5.5.
- **W5-02b dividida** em W5-02b1 (perfis P1/P2, seccomp, artefatos) e W5-02b2 (virtual store do pnpm e verificador com testes nativos), no mesmo slot da B1, em sequência (02b2 depende de 02b1). A W5-10b depende da W5-02b2.
- **Risco `packages` sem folga:** 24 arquivos novos contratados em `packages/` (113 + 24 = 137); se a medição passar de 137, a onda para em G3 com o número medido, sem aumentar o orçamento por conta própria. Lista em PLAN §7.3 e `tasks.md`.
- **Risco `.agents` sem folga:** 5 plugins com 2 ou mais entradas por definição mais o espelho gerado (cerca de 10 ou mais) contra folga de 7; primeiro estouro provável na W5-05 (primeiro plugin). Se a medição estourar, a onda para em G3 com o número medido; nenhum orçamento sobe por conta própria.
- **Cobertura:** por task, c8 focado (`.c8-kernel.json` com `--include` dos arquivos da task); o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração. Testes novos e os existentes citados entram na lista `test:kernel` de `package.json` (W5-02b1, W5-04 e W5-09 registram os já existentes).
- **Mapa de ondas:** B2 é `W5-03 ∥ (W5-05 → W5-06)` e B3 é `(W5-07 → W5-08) ∥ W5-09`; arquivos compartilhados (`.c8-kernel.json`, `package.json`, registro de plugins) são resolvidos por merge na integração da onda.
- **Gerador de plugins:** pertence à W5-05; as demais reutilizam.
- **Projeções por área:** são estimativa, não decisão; vale o medido.
- **Grafo de capacidades:** os nós `proposed` do fragmento descrevem spec, design e intake; continuam coerentes com o híbrido e não foram alterados.

## Limites e continuidade

- Teto do pacote 1554 e `packages` 137 aprovados (G3 de 2026-10-11), mas ainda não aplicados no teste (hoje 1540/123): a alteração entra na W5-02a. Acima de 1554, só pelo número medido, com novo G3.
- ADR Accepted aprova o design da W5; merge, publicação, instalação global e ativação continuam não autorizados.
- Pendências fora da W5, apenas registradas: `loop-guard.sh` em `node_modules`, evidência de saída nos adapters API/ACP/local, digest de conta `claude/account` sem sal, hook de commit que bloqueia nomes de fornecedor.
- AEW: aplicação/enforcement não verificados. axon: integração opcional.
- Arquivo alheio `HSEOS-GOAL-HARNESS-AUTONOMO.md` preservado fora desta worktree.

## Decisão do owner em 2026-10-12: pin de navegador

O pin de navegador passa a ser o `chrome-headless-shell-1228`. O `chromium-1228` saiu dos pins porque é a build do Google Chrome e só traz o LICENSE do Widevine, sem o texto BSD-3, e por isso o critério de licença ficava BLOCKED. O headless-shell traz o BSD-3 (`LICENSE.headless_shell`) e passou no ensaio da W5-02b1 dentro do bwrap no P1. O Chrome completo (`--headless=new`) trava no sandbox. Este host não tem Chromium da distro.

## Integração da onda B1 e das trilhas LV/CO (2026-10-13)

Branch `integration/hseos-w5-b1`, parte de `feature/hseos-evolution-w5` (07bd5e97). HEAD verificado: `0a7b9582` (a verificação foi feita nos SHAs anteriores à reescrita; as árvores são idênticas). Ordem dos merges (`--no-ff`):
contratos `5afa6501` (merge `938e1f1d`), 02a `2a2f15eb` (`b04ff03d`), 04 `0ce6b4eb` (`d20b4a34`), LV1 `3a0a5ae6` (`14be5f5a`), LV2 `46431c03` (`1b84dbe1`),
CO1 `d82eaa09` (`c3d22990`), CO2 `a7783abb` (`e3c6e14e`) e 02b (02b1 `a4343171` + 02b2 `51be92f6`, merge `90900208`).
Receipt: [evidence/integration-b1/receipt.json](evidence/integration-b1/receipt.json).

Correções da integração (um commit cada): teto do pacote `.hseos` 64 / 1556 (`028244e2`, G3 do owner de 2026-10-12); `.gitignore` de coverage (`27b46258`);
LV1 alinhada ao contrato do CLI de report (`c3ee484c`); inbox compartilhada da LV2 ignora entradas de coordenação (`8bdaed44`); eventos espelhados da CO1 com `id` e recusa do alias do adaptador (`e8a3e44b`);
aviso em stderr quando o CLI gravável por grupo é recusado (`5c2219e5`); teste de composição CO1 + CO2 reais (`197ecdd3`); critério da W5-04 em `tasks.md` (`895a3df4`);
manifest do CLI (`460b0c8b`, `0a7b9582`); simetria de chave desconhecida em `agent-liveness.yaml` (`baba84ac`).

**Critério da W5-04 (decisão do owner, 2026-10-12):** o legado só é alcançável pelo gateway, com registro durável. Substitui a redação anterior em `tasks.md`.

**Simetria do `agent-liveness.yaml` (resolvida):** chave conhecida com valor inválido torna o arquivo inválido e vale a última configuração válida, com aviso; chave desconhecida gera aviso em stderr
e é ignorada, sem rejeitar o arquivo. Vale igual no guard, no `check` e no `watch` (antes, a CLI e o watch rejeitavam o arquivo e um typo parava o watchdog). Provado em processo real por
`test/test-liveness-composition.js`, com o guard compilado e o canônico.

### Resultados da verificação (Fase 3)

| Verificação                                                                    | Resultado                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify de W5-01, 02a, 02b1, 02b2, 04                                           | verde, em `baba84ac` (o commit seguinte só regenera o manifest)                                                                                                                           |
| verify de LV1, LV2, CO1, CO2 (c8 com includes dos receipts, 90/80 por arquivo) | verde, em `baba84ac`; o spec dessas trilhas não fixa um comando único, os includes vêm dos receipts                                                                                       |
| `npm run test:kernel-coverage` completo (uma vez)                              | sem falhas e sem erro de cobertura, em `baba84ac`: all files 97,34% linhas / 91,86% branches; exit code não capturado; conclusão pelo log (10 blocos com 0 falhas, sem erro de cobertura) |
| `npm test` completo, Node 24.15.0                                              | exit 0, em `0a7b9582`                                                                                                                                                                     |
| `npm test` completo, Node 22.23.3 (clone separado, better-sqlite3 no ABI 22)   | exit 0, em `0a7b9582`                                                                                                                                                                     |
| inventário (npm 24)                                                            | 1483 de 1556; `.enterprise` 449/484, `tools` 387/393, `src` 245/250, `.agents` 188/193, `packages` 118/137, `.hseos` 63/64, `scripts` 19/21, `docs` 7/7, raiz 7/7. Sem G3                 |
| `validate-capability-graph`, `agent-core compile --check`                      | 0 findings; 242 checks, sem escrita                                                                                                                                                       |
| eslint (`--max-warnings=0`) nos arquivos tocados                               | verde                                                                                                                                                                                     |
| prettier nos arquivos js/cjs/mjs/json/yaml tocados                             | 4 JSONs de evidência fora do estilo (não reformatados por serem artefatos de receipt com hash); `format:check` não faz parte de `npm test`                                                |

Não verificado nesta integração: a jornada MCP pelo pacote instalado (pendência da W5-04), consumidores reais, e qualquer ativação.

### Resíduos a registrar

- **W5-04:** P01, P04, P06 e M03 (equivalente); a negação do FIFO não foi testada ponta a ponta.
- **W5-02b1:** launch forjado congelado com o filtro correto; `socketpair` no P0 (anterior à task).
- **W5-02b2:** Y4 (a conferência antes do comando não é distinguível no teste); janela até o bwrap; R3-2 (`v<N>` na base confiável); Y12 equivalente.
  Pré-condição de implantação: o `HSEOS_CONFIG` é relativo ao módulo, então o HSEOS não pode rodar de um checkout que é o próprio projeto verificado.
- **LV1:** status desconhecido de `background_tasks` só gera aviso; TeammateIdle e teammates nomeados não verificados; inbox no contexto do Commander.
- **LV2:** tabelas fora de migração numerada e sem retenção de eventos; notificação em duplicata; F5; `--project-dir` sem aviso; ramo morto em `parseLivenessLine`; systemd, `notify-send` e sessões reais não verificados.
- **CO1:** F13 (epoch do fence: a liberação não confere o dono depois de o banco ser recriado; baixa); sidecars `-wal`/`-shm` do project-aggregate (baixa; a spec deve mencioná-los em "somente leitura");
  N1 (`register --path` não espelha ao axon, conforme a spec); o loader aceita `HSEOS_ACTIVITY_GUARD_MODULE` só com `NODE_ENV=test`, e a injeção por API interna dos testes é preferível.
- **CO2:** A1 (CLI gravável por grupo só em grupo privado do usuário, UPG); os mutantes `pg_getent`, `pg_groupfail` e `pg_passwdfail` são redundantes com os testes de saída vazia.
- **Fora da trilha (Symphony):** timeout de silêncio nos drivers; snapshot de rate limit; POST de reconcile; W6: dispatcher, dashboard, template estrito, varredura de worktrees, logs `key=value`; W7: pool SSH.
- **Drift do compilador (item 6 do checklist):** não houve mudança de `settings:`/`mcp:`, de transport do axon-bridge nem arquivos `.claude/{settings.json,agents,skills}` ou `.mcp.json` nesta integração; `compile --check` passa limpo. Continua sendo risco de `agent-core compile` (sem `--check`) em worktrees.
- **Formatação:** 4 JSONs de evidência fora do estilo do prettier (listados no receipt).
- **Ativação fora de escopo, por decisão do owner:** hooks no `~/.codex` (trusted_hash); `/workspace/.pnpm-store` na allowlist do controlador; timer systemd; contratos ligados em projetos.
- **`executor.js` (02b1):** o vazamento de `hseos-executor-filter-*` é corrigido pela PR #216 na master; esperar conflito manual no `executor.js` quando a W5 for atualizada com a master.
- **Desvio de processo:** os testes focados da Fase 2 rodaram sem `heavy-run` durante o lock de outra sessão, no mesmo cgroup.
- **Hooks ausentes:** o `.husky/_` (gerado pelo `prepare` do husky e ignorado pelo git) não existia nos worktrees da LV1, da LV2 e da integração até `baba84ac`, nem nos primeiros commits da CO1 e da CO2. Nessa janela o git commitou sem pre-commit e sem commit-msg: o manifest stale deixado por `baba84ac` foi pego só pelo `npm test` (corrigido em `0a7b9582`), e a mensagem do commit da LV2 passou com o nome de uma ferramenta. Remediação: o helper `commit-in-cgroup.sh` recusa com exit 72 sem os hooks; commit-msg retroativo aprovou 36 de 36 commits do intervalo; e o gate compensatório `VALIDATION_ENFORCED=true bash scripts/governance/quality-gates.sh --phase ci` no HEAD `de0b3dad` passou (GATE_EXIT=0, 0 falhas, 2 avisos de placeholders não resolvidos).
- **Reescrita de histórico (2026-10-13):** a mensagem do commit da LV2 foi reescrita (`16c52664` → `46431c03`, mesma árvore `285b90bc`) e a cadeia first-parent da integração foi reconstruída; `task/hseos-w5-lv2` foi movido junto. Mapa antigo → novo e prova (árvore idêntica, commit-msg 36/36) em `history_rewrite` no receipt. Os SHAs deste documento já estão no valor novo.

### Rodada 1 de correção da integração (2026-10-13)

Origem: revisão da integração (aprovada em `260da30f` com ressalvas F1 a F5). Detalhes e hashes dos logs em `correction_round_1` do receipt.

- **F3 (`53ed7624`):** guard e CLI passam a usar as mesmas faixas, tipos, valores de enum e regras entre chaves. `max_stop_refusals: 0` vale nos dois (antes desligava o guard) e `foreground_wait_max_s: 9999` é inválido nos dois (antes só a CLI recusava). O guard mantém uma cópia da tabela, porque é copiado sozinho para `.agents`; um teste compara a cópia com `CONFIG_RANGES` do contrato em todas as bordas.
- **F4 (`78b617f1`):** a composição afirma que a CLI real gravou o `turn_end`, e o aviso de chave desconhecida em ciclo posterior do `watch` tem teste; os três mutantes sobreviventes da revisão morrem.
- **F1:** o `npm test` **não encadeia o `test:kernel`**, então as execuções do Node 22 e do 24 da Fase 3 não exercitaram as suítes novas de LV, CO e 02b. A matriz Node 22/24 passa a ser `npm test` mais `test:kernel` nas duas versões. `test:kernel` em Node 22.23.3 no HEAD `78b617f1`: `KERNEL22_EXIT=0`, 10 blocos com 0 falhas. Em Node 24, a revisão rodou `test:kernel` e `test:kernel-coverage` no HEAD `260da30f` (exit 0 nos dois).
- **Cobertura focada** dos arquivos alterados (90/80 por arquivo): 141 testes, 0 falhas, `COV_EXIT=0`.

### Resíduos acrescentados pela revisão da integração

- **CO1 N2.2:** um conflito de reserva ainda gera 2 handoffs no axon (`service.js:224`, via `this.mirror(entry)`, e `service.js:541`, o evento tipado). O teste de composição não afirma a contagem.
- **LV2, revisão 4, itens 3 a 6:** reuso de `outbox_id` com o jsonl; corrida `existsSync`/`renameSync` em `drainPendingReports`; `pending-reports.invalid.jsonl` sem poda; entrega após `gave_up`. Os itens 1 e 2 (o marcador some junto com o outbox; ledger legado só em leitura) já constavam.
- **LV1 R5:** um agente pode declarar `WAITING_ON` por até 4 h sem ser acordado pelo guard (desenho do Adendo 3; o controle fica no watchdog).
- **02b1:** K2 e K3 (`verifiedSeccomp(launch)` contra `launch.seccomp`), K9 (`makeRemovable` entra em symlinks), M17 (corrida lstat/fstat) e 3 diretórios `/dev/shm/hseos-artifacts-*` ilegíveis.
- **CO2:** o template do Codex não foi verificado no Codex real (coberto pela ativação fora de escopo dos hooks no `~/.codex`).
- **04 e 02a:** a drenagem do 413 mantém a conexão até 16 MiB; informativo sobre cabeçalho sem decodificação.
- **G1 (revisão 2 da integração, baixa):** grafias YAML exóticas (`1.0`, `0x10`, `+5`, `1e3`, `enabled: True`) são aceitas pela CLI (parser YAML completo) e recusadas pelo guard (parser mínimo sem dependências), que então mantém a última configuração válida. Nenhuma aparece nos exemplos nem na spec, e o teste de tabelas não as cobre. Use inteiros decimais e `true`/`false` em minúsculas no `agent-liveness.yaml`.

### Revisão final da integração

A revisão cética aprovou a integração em `260da30f` com as ressalvas F1 a F5. A rodada 1 de correção (`53ed7624`, `78b617f1`, `778bc5e7`) fechou todas, e a revisão do delta aprovou `778bc5e7`, ficando só o G1 como resíduo baixo. Relatórios: `REVIEW-W5-INT.md` e `REVIEW2-W5-INT.md`.

## Integração da onda B2 (2026-10-14)

Branch `integration/hseos-w5-b2`, parte de `feature/hseos-evolution-w5` (`1816e9e5`, depois da PR #218). HEAD verificado: `577207c5` (o código não mudou depois dele; os commits seguintes só mexem em documentação). Ordem dos merges (`--no-ff`):
W5-03 `833fcd20` (merge `7205977e`; 2 rodadas de revisão) e W5-06 `d5fb5a28` (merge `39eb7d06`; 2 rodadas), que traz a W5-05 `7c8623ee` (4 rodadas de revisão, 3 de correção), porque a W5-06 é empilhada sobre ela.
Único conflito: a lista `test:kernel` do `package.json`, resolvida por união. Receipt: [evidence/integration-b2/receipt.json](evidence/integration-b2/receipt.json).

Correções da integração (um commit cada): design §5.1, o LSP roda em P1 (`d432538e`); design §5.2, desvios aprovados do DAP (`ac1e1d99`); testes do LSP restritos aos pins do LSP (`577207c5`).

**Decisão G3 pendente de confirmação do owner.** O owner decidiu em 2026-10-13 `.agents` 205 com o teto 1556 inalterado. Como a soma dos orçamentos por área já era exatamente o teto, o Commander aplicou a realocação `.enterprise` 484 → 472 (o owner não respondeu à pergunta corrigida dentro do prazo). Medido nesta integração: `.agents` 194 e `.enterprise` 455.
Com o orçamento anterior da `.agents` (193) o medido já estourava por 1; a `.enterprise` passa com 17 entradas de folga em 472, e essa folga é a que as ondas seguintes (W5-07 a W5-12) consumiriam.
Alternativas: (a) confirmar `.agents` 205 e `.enterprise` 472; (b) subir o teto para 1568 e manter a `.enterprise` em 484; (c) só o medido, `.agents` 194 e `.enterprise` 483.

**Risco aberto R1 (CI), decisão do owner.** `test/test-environment-lsp.js` e `test/test-environment-dap.js` exigem o cache de toolchain dos pins em `/build/cache/hseos-toolchain` (ou `HSEOS_TOOLCHAIN_CACHE`): o `before()` afirma `toolchain.status === 'ready'`. O `.github/workflows/ci.yaml` roda `npm ci`, `npm test` e `npm run test:kernel-coverage` no ubuntu-latest e não provisiona esse cache. Sem ele, os dois arquivos falham 67 de 67, inclusive testes puros (`crc32`, framing), e o `test:kernel`, que agora cita os dois, reprova junto. A cobertura do kernel cairia também (esperado, não medido).
Achado pela revisão cética e confirmado pelo Commander na leitura do hook e do workflow; **a execução real do CI não está verificada** até os checks da PR terminarem. Contraria a regra do `tasks.md` de que insumo ausente termina em BLOCKED com a causa, e não em falha vermelha nem em threshold afrouxado.
Opções: (1) provisionar o cache no CI a partir dos artefatos com SHA-256 fixado (mudança de workflow); (2) separar os testes de servidor real dos puros e fazer os primeiros reportarem BLOCKED sem cache, o que exige decidir como os thresholds de cobertura tratam esses arquivos; (3) aceitar CI vermelho na branch da onda até uma etapa própria. Mudar workflow ou threshold está fora da alçada do Commander.

**Desvios aprovados registrados no design:** o LSP roda em P1 (P0 falha com `spawn EPERM`, recusa `ENV_LSP_PROFILE_INSUFFICIENT`); no DAP, breakpoint só com `file` e `line` (sem `condition`, `hitCondition`, `logMessage`), frames fora do workspace com `path: null` e `external: true`, e `startDebugging` por allow-list estrita (necessário ao `js-debug`).

### Resultados da verificação (Fase 3, B2)

| Verificação                                                               | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify literal da W5-06                                                   | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| verify literal da W5-03                                                   | **exit 1**: `schemas.js` 87,75% linhas / 65,78% branches. O `tasks.md` manda a task de só teste tirar do `--include` o que não alterou; o recibo aprovado fez isso e nenhuma task tocou `schemas.js`                                                                                                                                                                                                                                                                   |
| W5-03 com o comando do recibo aprovado                                    | exit 0, 48 testes; `context-assembler.js` 90,07% linhas / 85,63% branches (margem de 0,07 pp, igual à da task isolada)                                                                                                                                                                                                                                                                                                                                                 |
| verify literal da W5-05                                                   | **exit 1, duas vezes.** Antes da correção: 45 de 47 testes (os 2 defeitos de integração) e `environment-toolchain-pins.js` 77,31% branches. Reexecutado em `4b66aae4`: 47 de 47, mas o arquivo fica em 70,31% linhas / 95,08% branches. O arquivo é compartilhado: a W5-06 acrescentou o leitor de zip e a extração dos pins do DAP, que os testes da W5-05 não rodam (antes um teste com `debugpy` "real" os exercitava sem querer). Na união dos testes, 100 / 98,57 |
| `npm run test:kernel-coverage` completo, rodada 1                         | **exit 1**, 3 testes reprovados: 2 defeitos reais de integração (corrigidos em `577207c5`) e 1 corrida de relógio pré-existente no teste de liveness (resíduo abaixo)                                                                                                                                                                                                                                                                                                  |
| `npm run test:kernel-coverage` completo, rodada 2 (`577207c5`)            | exit 0; 0 blocos com falha; todos os arquivos 97,51% linhas / 92,25% branches; `environment-toolchain-pins.js` 100 / 98,57                                                                                                                                                                                                                                                                                                                                             |
| `npm test` e `npm run test:kernel`, Node 24.15.0                          | exit 0 e exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm test` e `npm run test:kernel`, Node 22.23.3 (clone, ABI 22)          | exit 0 e exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| inventário (npm 11.12.1, o do Node 24) e `test-package-surface.js`        | 1505 de 1556; `.enterprise` 455/472, `tools` 389/393, `src` 245/250, `.agents` 194/205, `packages` 126/137, `.hseos` 63/64, `scripts` 19/21, `docs` 7/7, raiz 7/7. Exit 0 no teste. G3 pendente                                                                                                                                                                                                                                                                        |
| `validate-capability-graph`, `agent-core compile --check`                 | exit 0; 242 checks, sem escrita                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh --phase ci` | exit 0; 0 falhas, 2 avisos (placeholders em `epics-template.md` e `docs/activity-coordination/README.md`, não tocados pela B2)                                                                                                                                                                                                                                                                                                                                         |
| eslint (`--max-warnings=0`)                                               | roda dentro do `npm test`; exit 0 nas duas versões do Node                                                                                                                                                                                                                                                                                                                                                                                                             |
| prettier nos arquivos tocados                                             | 7 arquivos da W5-05 fora do estilo, todos já reprovando em `7c8623ee`; `format:check` não faz parte de `npm test` nem do pre-commit. Não reformatados                                                                                                                                                                                                                                                                                                                  |

Os dois verifies literais com exit 1 ficam registrados como FAIL medido, e não como PASS: a causa de cada um está na tabela, e o gate de cobertura que vale para arquivos compartilhados é o `test:kernel-coverage` completo (rodada 2).

### Resíduos a registrar (B2)

- **Plugins:** `hseos-plugin-lsp` e `hseos-plugin-dap` ficam `scaffolded`; a ativação vem depois do G6.
- **`contract-registry.js`:** os stubs `environment.lsp.*` e `environment.dap.*` seguem intocados. Os schemas `LSP_INPUT_SCHEMA` e `LSP_OUTPUT_SCHEMA` já estão exportados para a troca futura.
- **W5-03:** a guarda de partição do `context-assembler.js` é inalcançável pela API pública (defesa em profundidade); a margem de cobertura de linhas é de 0,07 pp.
- **W5-05:** a licença dos pins é conferida por marcadores de texto, não pelo texto integral; `/usr/bin/node` fixo no comando do sandbox do LSP; o decode do URI inteiro recusa `%` inválido fora de `file:` (fail-closed).
- **W5-06:** `childConfiguration.name` sem validação de tipo nem de tamanho; filhos: o controlador aceita até 50 e o host corta em 20.
- **02b1:** `profiles.js` `openSeccompDescriptor` usa só `rmdirSync`, o que pode vazar `hseos-profile-filter-*` em falha depois do `wx`.
- **Liveness (pré-existente, não tocado pela B2):** `test/test-agent-liveness.js:1950` tem uma corrida de relógio. Com `watch_interval_s: 0` o orçamento de `deliverOutbox` é 0 ms e o laço sai se `Date.now() - startedAt > 0`; o `DELETE` e o `SELECT` anteriores normalmente cabem no mesmo milissegundo, mas sob c8 com 815 testes podem passar dele e a entrega fica em 0. Reprovou na rodada 1 do `test:kernel-coverage` e passou 3 de 3 isolado. Correção própria, na onda de liveness.
- **Verify literal da W5-05 sobre arquivo compartilhado:** o per-file de 90/80 da task não vale para `environment-toolchain-pins.js` depois da W5-06; o gate é o `test:kernel-coverage` completo. Vale ajustar o `tasks.md` para as próximas ondas (a W5-03 e a contagem de plugins já foram corrigidas nesta integração).
- **Formatação:** os 7 arquivos da W5-05 listados no receipt.
- **`plugins/` fora do pacote:** `plugins/` não está em `files` do `package.json` e nada além dos testes chama `packPlugin`; o gerador é publicado em `tools/**` sem os manifestos e sem CLI. Coerente com `scaffolded`, mas é preciso decidir antes da ativação.
- **Dependência da versão do npm no inventário:** a medição de 1505 vale com o npm 11.12.1 do wrapper do Node 24. Segundo a revisão (não reproduzido aqui), com o npm 9.2.0 do shell padrão o mesmo `npm pack` conta 1507 entradas e `test-package-surface.js` falha em `docs` 9 > 7.
- **Achados menores da revisão, sem alteração:** o jsdoc de `installToolchain` (`pins.js`) descreve `<destination>/<name>/package`, mas zip e `js-debug` extraem com outra raiz; no host DAP o `op` de step só é validado no controlador; `childConfiguration` aceita `request` ausente (`?? 'launch'`), mais frouxo que o texto do design; o design §5.1 fala em tmpfs de `/tmp` e o código usa `/dev/shm`; um teste do DAP que falha deixa o runner pendurado até o timeout (provável handle vazado do adaptador).
- **`/build` cheio:** o volume chegou a 100% (62 MB livres) e a primeira tentativa de commit do merge da W5-06 reprovou no pre-commit com `ENOSPC`. Foi liberado só o scratch dos gates (`/build/hseos-qg-tmp`, 1,5 GB de resíduo de testes). Margem atual de cerca de 1,4 GB: precisa de limpeza antes da B3. O scratch voltou a acumular durante a própria revisão (189 MB, 1752 entradas) porque o `run-in-cgroup.sh` fixa `TMPDIR=/build/hseos-qg-tmp` e os testes deixam diretórios lá; a causa é recorrente e não está corrigida (o scratch foi limpo de novo ao fim desta integração).

### Revisão cética da integração B2

Revisor isolado (agente separado, sem o raciocínio do Commander), preso a `4b66aae4` / árvore `3292ad38`, com passagem cega e passagem de confronto contra o receipt. Relatório: `REVIEW-W5-B2-INT.md` (em `/build/tmp/hseos-w5/b2/rev/`, hash no receipt).
**Veredito: APPROVED_WITH_RESERVATIONS, sem blocker.** HEAD e árvore idênticos do início ao fim; os 24 hashes de log do primeiro receipt bateram; exit codes, contagens (815 testes, 1505 de 1556, soma dos orçamentos igual ao teto) e a análise da corrida de relógio do liveness conferem. O commit `577207c5` não enfraqueceu nenhuma asserção e acrescentou uma mais forte.
**Mutações: 8 executadas, 8 mortas, nenhuma sobrevivente** (allow-list de `startDebugging`, `evaluate` na allow-list, `condition` em breakpoint, recusa textual de `..` no LSP, resolução de symlink, modo unix no zip, pin removido de manifest, retorno do caminho do duplicado de compactação). Observação: a recusa textual de `..` no LSP só é morta por um teste.
Disposição dos achados: **R1** (CI sem o cache de toolchain, major) e **R2** (confirmação do G3) seguem abertos e dependem do owner; F-C1 (causa do literal da W5-05), F-C2 e F-C3 (`tasks.md`) e F-C4 (rótulo do npm no receipt) foram corrigidos nesta documentação; os resíduos faltantes foram registrados acima. Depois do `4b66aae4` só mudou documentação (`tasks.md`, receipt e este STATUS); nenhum código.

## Onda de limpeza cl1: resíduos da B2 e pendências antigas (2026-10-15)

Branch `task/hseos-w5-cl1` a partir de `40a7e420` (B2 mergeada). Sem contrato em `tasks.md`: o escopo foi a lista de resíduos da seção anterior, um commit por item. Revisão cética isolada, duas rodadas, presa a SHA: **APPROVED_WITH_RESERVATIONS sem blocker** em `9e87412a` (relatórios `REVIEW-CL1.md` e `REVIEW-CL1-R2.md`; 25 mutações na rodada 1 e 7 mutantes do kind da filha na rodada 2). Recibo: `docs/evolution/w5/evidence/cl1/receipt.json`.

| Item | Resíduo                                           | Commit                 | Resultado                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | stubs `environment.lsp.*` e `environment.dap.run` | `faa457e4`, `ef1ff8e1` | contratos reais (`read_only`, `implemented`); saída LSP presa à action                                                                                                                                                                                                                                 |
| 2    | guarda de partição do `context-assembler.js`      | `d01253cc`             | removida: inalcançável, o store e o `replay.js:728-735` recusam a linhagem inválida (teste novo)                                                                                                                                                                                                       |
| 3    | `childConfiguration.name` sem tipo                | `f09bbfbd`             | string de até 256                                                                                                                                                                                                                                                                                      |
| 4    | filhos 50 contra 20                               | `5863708a`             | `MAX_CHILDREN` 20 compartilhado                                                                                                                                                                                                                                                                        |
| 5    | `openSeccompDescriptor` só com `rmdirSync`        | `08762ffa`             | limpeza recursiva, erro original preservado, sem vazar diretório nem fd                                                                                                                                                                                                                                |
| 6    | `/usr/bin/node` fixo e decode de `%`              | `b572b37b`             | debuggee em `/hseos-runtime/node`; decode só nos segmentos de caminho de `file:`                                                                                                                                                                                                                       |
| 7    | F-B3, F-B4, F-B5, F-B6                            | `82b4ec52`, `9a3ff661` | `op` validado no host; kind `launch                                                                                                                                                                                                                                                                    | attach`obrigatório, lido de`arguments.request` (o js-debug não o põe na configuração); design e teardown de teste corrigidos |
| 8    | corrida de relógio do liveness                    | `85b1edca`             | orçamento de 500 ms, asserção intacta; 20 execuções isoladas e 10 sob carga sem falha                                                                                                                                                                                                                  |
| 9    | `loop-guard.sh` gravando em `node_modules`        | `44c66f01`             | raiz pelo toplevel git, recusa `/node_modules/`; teste novo                                                                                                                                                                                                                                            |
| 12   | deriva do `compile`                               | `1a3042d2`             | causa: o manifest derivado ficou em `http` depois do commit `bf4239b5` mudar a fonte para `stdio`; corrigida uma linha e teste de coerência manifest e bundles. As linhas `settings:` e `mcp:` que o `compile` acrescenta com os arquivos gerados em disco são o comportamento da PR #212, não defeito |

**Fora da onda, com a causa:**

- **Item 10 (BLOCKED, externo):** `ecp-registry.snapshot.json` e as fixtures citam `Hideaki-Solutions-Core` porque o snapshot é cópia travada por SHA-256 da tag upstream `contracts-v0.4.0` de `HideakiSolutions/enterprise-capability-platform`, e não existe tag mais nova. Editar à mão quebra a proveniência; precisa de um novo bundle publicado no upstream.
- **Item 11 (adiado):** o tokenizer do guard (`capability-intake-guard.js`) é uma task própria, com testes adversariais.
- **Reformatação:** `lsp.js` e `test-environment-lsp.js` foram reformatados; `lsp-host.js`, `framing.js` e `index.js` seguem fora do estilo e ficam para a `cl2`, junto da licença por digest e do jsdoc de `installToolchain`.

**Resíduos aceitos pela revisão:** `dap.js:138` é mais estrito que o LSP novo (recusa `%2e%2e` literal em caminho simples; fail-closed); o limite de 256 do `name` recusaria um basename de 246 a 255 caracteres (medido 16 e 71 com o js-debug real); o SHA histórico de `loop-guard.sh` em `harness-cli-outcome/baseline.json` ficou desatualizado e nenhum teste o usa; `test-mcp-contract.js` não roda em Node 22 local (ABI do `better-sqlite3`), coberto pelo CI.

## Integração da onda B3, parcial (2026-10-15)

Branch `integration/hseos-w5-b3`, parte de `feature/hseos-evolution-w5` (`e1fb158a`, depois da PR #221 da limpeza `cl1`). HEAD de código verificado: `600a520e`; os commits seguintes só mexem em documentação e no recibo. Receipt: [evidence/integration-b3/receipt.json](evidence/integration-b3/receipt.json).

**Escopo.** Entram a W5-07 (navegador sem estado, `addf771e`, merge `91e7be47`, 2 rodadas de revisão) e a W5-09 (memória governada, `b77382e3`, merge `96dcbe37`, 2 rodadas), além das emendas de contrato da B3 (`4616a9da`). **A W5-08 (computer-use) está BLOCKED**: o pin externo `xdotool` não existe no host (decisão G2: só o owner instala). Ela não foi despachada e vira PR própria sobre esta onda, depois que o owner instalar o `xdotool`. A B3 desta PR, portanto, não está completa.

Conflitos: os dois `registry.yaml` de plugins e a lista `test:kernel` do `package.json`, todos resolvidos por união (115 entradas = 110 da base + 3 da W5-07 + 2 da W5-09, sem duplicata).

Correções da integração: o teste do marketplace passa a esperar 8 plugins (`96dcbe37`); o `code_tree_sha` do recibo da W5-07 passa a `5bf228d9` e o contrato da W5-09 foi emendado com a migration 017, o espelho e os ajustes de contagem (`99c35d49`); a checagem "cada pin pertence a exatamente uma capacidade" dos testes de paridade de `lsp`, `dap` e `browser` ignora plugins sem `toolchain_pins`, como o `memory` (`600a520e`).

### Resultados da verificação (Fase 3, B3)

| Verificação                                                                        | Resultado                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| primeira passada em `99c35d49`, `test:kernel` e `test:kernel-coverage`             | **exit 1**: 3 testes de paridade reprovados (causa acima), corrigidos em `600a520e`                                                                                                        |
| verify literal da W5-07                                                            | exit 0; 37 testes, 0 falhas, 0 skips; 99,12% linhas / 96,46% branches                                                                                                                      |
| verify literal da W5-09                                                            | exit 0; 23 testes, 0 falhas, 0 skips; 100% linhas / 99,53% branches                                                                                                                        |
| `npm test`, `npm run test:kernel` e `test:kernel-coverage`, Node 24.15.0           | exit 0 nos três; 401 testes; 97,61% linhas / 92,55% branches                                                                                                                               |
| `npm test`, `npm run test:kernel` e `test:kernel-coverage`, Node 22 (clone ABI 22) | exit 0 nos três; 97,63% linhas / 92,55% branches                                                                                                                                           |
| inventário (`npm pack --dry-run --json`) e `test-package-surface.js`               | 1528 de 1556 (npm 11.12.1 do Node 24; a medição de 1530 fora feita por engano com o npm do Node 22); `.agents` 200/205, `.enterprise` 461/472, `packages` 134/137, `tools` 392/393; exit 0 |
| `validate-capability-graph`, `agent-core compile --check`                          | exit 0                                                                                                                                                                                     |
| `VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh --phase ci`          | exit 0                                                                                                                                                                                     |

O `npm test` do Node 24 foi repetido sozinho porque o primeiro log ficou intercalado com o de uma instância duplicada do meu script (a duplicata foi encerrada); o log intercalado fica guardado, e o exit 0 do rerun é o que vale no recibo.

### Resíduos a registrar (B3)

- **Plugins:** `hseos-plugin-browser` e `hseos-plugin-memory` ficam `scaffolded`; a ativação vem depois do G6.
- **`contract-registry.js`:** os stubs `environment.browser.*` e `memory.*` seguem intocados. `memory.delete` exige aprovação no contrato, mas `forget` não verifica nenhuma; a reconciliação cabe à troca dos stubs.
- **W5-07:** o teste de admissão não admite o tarball real de `plugins/browser`; os testes in-process com `--no-sandbox` ficam fora do bwrap; o recibo registra M09 e M18 como mortos por testes novos (`evidence/w5-07/receipt.json:183,185`); M18b e N5 não constam em nenhum recibo, no código nem no histórico (`git log -S M18b`: só os commits que escreveram esta linha), então a afirmação anterior de que sobreviviam **não está verificada** (correção W6-E1, 2026-10-20). Bibliotecas de sistema do Chromium no `ubuntu-latest` não verificadas (o CI real dirá).
- **W5-09:** sem quota por projeto; exclusão e expiração são lógicas (o conteúdo permanece no ledger); sem varredura de PII; formato de `search_memory` do axon presumido; nenhum consumidor de produção; Node 22 e ativação da migration 017 em banco real não verificados na task. O plugin só funciona em um host que injete `rules`, `approved`, `actor` e `execution_mode` fora do payload e que tenha `agent-policy-lattice` e `campaign-evidence-store`.
- **Migration 017** (`memory.*`) está em `migrations-pending-activation`; renumerar se outra task criar migration antes da ativação.
- **Orçamento G3:** a margem restante (28 entradas; 1 em `tools`, 3 em `packages`, 5 em `.agents`) é apertada para a W5-08 e a B4.
- **`test-plugin-marketplace.js`:** em clone com `node_modules` por symlink sob o wrapper de cgroup, 3 asserções falham; no worktree real passa 88/0. Dependência do layout do checkout, não da B3.
- **Instalação do `chrome-headless-shell`:** decodifica o zip inteiro antes de gravar (pico de ~455 MB). O `design.md` não documenta o pin `chrome-headless-shell` na tabela de pins além da emenda do contrato.
- **CI real:** execução do CI da PR não verificada no momento da revisão; ver o resultado dos checks na PR.

### Revisão cética da integração B3

Revisor isolado (`b2-int-reviewer`), preso a `600a520e` / árvore `a9f7efd7`, passagem cega e passagem de confronto. Relatório: `REVIEW-B3-INT.md` (em `/build/tmp/hseos-w5/b3/rev/`). **Veredito: APPROVED_WITH_RESERVATIONS, sem blocker e sem major.** HEAD e árvore idênticos do início ao fim.

Confirmado: `test:kernel` sem perda nem duplicata; `.c8-kernel.json` e registries com as duas tasks; espelhos `.agents` e `.enterprise` idênticos; migration 017 e contadores corretos; `contract-registry.js` intocado; `code_tree_sha` `5bf228d9` do recibo da W5-07 reproduz; a checagem de pin segue estrita. **Mutações: 6 executadas, 6 mortas** (pin duplicado entre lsp e dap, duplicado entre memory e browser, pin sem dono, TTL opcional, allow-list de host do broker, remoção de `memory.expired` da 017).

Disposição: F2 (total de G3) procede: a medição de 1530 usara o npm do Node 22; com o Node 24 são 1528, corrigido no recibo e acima. F1 (folga de 1 em `tools`) e F7 (`memory.delete` com `requires_approval` contra `forget` que só exige ator operador) ficam como resíduos, para a próxima onda e a troca dos stubs. F3, F4, F5, F6 e F8 estão registrados acima.

## B3b: W5-08 computer-use (2026-10-15)

PR #223 (`task/hseos-w5-08`) mergeada em `4c152844` (tag `hseos-w5-b3b`); commit final da task `4ff4cac0`. CI 6/6 verde. Receipt: [evidence/w5-08/receipt.json](evidence/w5-08/receipt.json). A capacidade abre sessões de computer-use aprovadas por ação, num Xvfb privado dentro do sandbox, com o plugin `computer-use`.

**Revisão cética em 3 rodadas.** R1 **REPROVADO**: MAJOR-1 (sessão única sob `start()` concorrente: o slot agora é reservado de forma síncrona antes de qualquer `await`) e MAJOR-2 (o teste do `DISPLAY` era vacuamente verdadeiro: a sonda do host passou a conectar no socket abstrato e há controle positivo com um Xvfb aberto). R2 e R3 **APROVADO COM RESSALVAS**.

**Falha de CI e correção.** O runner `ubuntu-noble` só conhece o `xdotool` `1:3.20160805.1-5build1`, não o do host de desenvolvimento. O pin `xdotool` virou pin de sistema com uma variante por distro: `ubuntu-resolute` `1:3.20160805.1-5.1build1` e `ubuntu-noble` `1:3.20160805.1-5build1`, cada uma com artefato, SHA-256 e tamanho próprios. O provisionador deixou de usar `apt-get download` e baixa cada variante pela URL do pool do Ubuntu, verificando tamanho e SHA-256 antes de guardar. Em execução, a variante é escolhida pela versão que o `dpkg-query` reporta; versão sem variante é BLOCKED.

**Inventário (G3).** 1538 de 1556 entradas; `packages` 137/137 e `tools` 393/393, **sem folga** nas duas áreas (`.agents` 203/205, `.enterprise` 464/472, `.hseos` 63/64).

**MINOR aceitos:** URLs do pool do Ubuntu podem desaparecer; o provisionador não tem teste direto; a sonda do socket abstrato não tem timeout; não existe renovação de timeout da sessão; `start` com alvo em `/usr/bin` fica fora do gate; teto de 14 KiB por screenshot; Node 22 não verificado (ABI do `better-sqlite3`); o cache de pins ganhou `apt/` fora do repositório; o binário `xdotool` do host é só informativo (o critério é a versão do `dpkg-query`); a sonda de isolamento olha apenas `:0`, `:1` e o `DISPLAY` do operador (o isolamento real é o namespace de rede); os mutantes M04, M24 e M22 sobrevivem; `EAGAIN` no `abstractSocketReachable` é tratado como inalcançável.

## Onda cl2 (2026-10-15)

Branch `task/hseos-cl2`, base `4c152844`. Resíduos da B2/W5-05 aceitos pela revisão. Receipt: [evidence/cl2/receipt.json](evidence/cl2/receipt.json).

1. **Licença por digest** (`a3b3b2e6`). Cada pin e cada variante do `xdotool` carrega `license_sha256`, o SHA-256 do texto da licença extraído do artefato fixado do cache (`/build/cache/hseos-toolchain`). `verifyPin` o compara depois dos `license_markers`; divergência é BLOCKED com `ENV_TOOLCHAIN_LICENSE_DIGEST`. Um pin sem digest também é BLOCKED (fail-closed). Teste novo em LSP, DAP e computer-use: uma licença com todos os markers presentes, mas com texto diferente, que os markers sozinhos aceitariam, agora é BLOCKED por digest. As duas variantes do `xdotool` têm o mesmo texto de licença, logo o mesmo digest.
2. **jsdoc de `installToolchain`** (`603a9ebe`). Contrato com parâmetros, retorno, códigos de erro, recusa de pins de sistema (fora do conjunto padrão), efeitos em disco e atomicidade (verificação de todos antes de gravar; gravação por pin, não transacional). Só comentário.
3. **Prettier** (`c21fc308`). Reformatados `tools/lib/environment-plugin-pack.js`, `packages/agent-environment/lsp-host.js`, `test/test-environment-plugin-pack.js` e `test/test-lsp-plugin-parity.js`; `framing.js` e `index.js` já estavam no estilo. A árvore sintática de cada arquivo é idêntica antes e depois (comparação de AST com `espree`). O pack dos plugins é montado em tempo de teste a partir desses arquivos e nenhum espelho `.agents`/`plugins` os contém, então nada foi regenerado; as paridades e `agent-core compile --check` (242 checks) passam. Fora do escopo da W5 e não tocados: `package.json`, `design.md`, `STATUS.md` e o `SKILL.md` do plugin memory seguem fora do prettier.
4. **Rodada de correção 1 (revisão cética, APROVADO COM RESSALVAS, 0 blocker, 0 major).**
   - O jsdoc de `installToolchain` dizia que o alvo de um pin ficava intocado e que toda recusa carregava `code`, mas `extractZip` (flag `wx`) ou o `tar -xzf` podiam falhar depois do `rmSync`, apagando o alvo e lançando erro cru. **Escolha: corrigir o código** (a mudança é pequena e testável). Cada pin é extraído num diretório de staging `<alvo>.staging-<pid>` e só então substitui o alvo; o staging é removido em qualquer falha; erro que não seja `ToolchainBlockedError` vira `ENV_TOOLCHAIN_INSTALL_FAILED`. O jsdoc foi reescrito para o comportamento real, inclusive que a troca por pin é remove-e-renomeia (uma queda entre os dois passos deixa o pin ausente, nunca pela metade) e que a atomicidade entre pins continua sendo só "verificação de todos antes de gravar".
   - Testes novos: pin sem `license_sha256` é BLOCKED (fail-closed); digest que coincide nos 20 primeiros caracteres e difere depois é BLOCKED (o digest é comparado inteiro); extração que falha mantém a instalação anterior, devolve `ENV_TOOLCHAIN_INSTALL_FAILED` e não deixa staging.
   - **Rodada 2.** O staging passou a convir com o jsdoc: o alvo antigo é movido para `<alvo>.previous-<pid>` e só removido depois que o novo entra; se o rename final falhar, o antigo volta (só se a restauração também falhar o pin fica ausente). `ENV_TOOLCHAIN_INSTALL_FAILED` preserva o erro original em `cause`, e a limpeza do staging não mascara o erro. O teste da falha de extração passou a usar um tarball que lista limpo mas quebra no `tar -x` depois de o staging existir (arquivo seguido de caminho abaixo dele), provando staging criado e removido, instalação anterior intacta e `cause` presente; não depende de privilégio, então não há skip. A falha do rename final não tem teste (não há injeção possível sem mudar a API).
   - **Rodada 3 (MINOR aceitos).** A restauração após falha do rename final não tem teste; um `previous-<outro pid>` deixado por um processo morto nunca é limpo (o `removeQuietly` só cobre o do próprio pid); se a restauração também falha, o `cause` é o erro da restauração e o do rename se perde, e só `previous-<pid>` permanece (o staging é limpo); mutantes T01, T06 e T07 sobrevivem. Removido do teste de extração um `t.skip` residual num callback sem `t` (daria `ReferenceError` como root; o teste não depende de privilégio).
   - O digest da licença é calculado sobre o texto **decodificado em UTF-8** (o mesmo texto que os markers inspecionam), não sobre os bytes brutos.
5. **Medições.** Testes focados (`test-environment-*`, paridades, `test-browser-plugin-surface`, `test-package-surface`, memory): 186 de 186 passam (0 falhas, 0 skips) na execução da rodada 2; o `test-plugin-marketplace.js` ficou fora dessa execução. Na execução original (que o incluía), ele foi a única reprovação, sob `node --test` no wrapper de cgroup (85/3). A explicação anterior (`node_modules` por symlink) estava errada: a revisão reproduziu a falha com `node_modules` copiado. Fica registrada como dependência do layout/ambiente do wrapper, **causa não determinada, preexistente**; rodado direto com Node 24 passa 88/0. **G3 após a cl2** (`npm pack --dry-run --json`, npm 11.12.1 do Node 24): **1538 de 1556**, igual ao pós-W5-08; `packages` 137 e `tools` 393, nenhum arquivo novo.

## B4 e fechamento: W5-10, W5-10b, W5-11a, W5-11b e W5-12 (2026-10-17)

Base desta seção: `b4160d87` (feature `feature/hseos-evolution-w5` depois da PR #228). Recibos por task em `evidence/<task>/receipt.json`; rastreabilidade FR → task → teste → recibo em [evidence/final/traceability.md](evidence/final/traceability.md); verificação final em [evidence/final/verification-receipt.json](evidence/final/verification-receipt.json).

- **W5-10** (PR #225): proveniência de contexto e sinais do executor expostos em `/v1/tasks/{id}/evidence`, nos eventos e nas superfícies CLI e SDK. `context_provenance.sources[]` fica vazio para sessões v1; desde a T3 da bateria viva o runtime de engenharia declara a proveniência das próprias fontes e as tarefas reais saem v2 (constituição e projeto `directive`, critérios protegidos `data`). `init` e `rate_limit` seguem declarados desconhecidos.
- **W5-10b** (PR #226): endurecimento do aceite de engenharia para **novas admissões**; claim e recuperação não reaplicam. Códigos novos `ENGINEERING_ACCEPTANCE_WEAK`, `ENGINEERING_COMMAND_ARG_INVALID` e `ENGINEERING_PROTECTED_CONFIG_MISSING`. Nota de migração em `docs/v4-migration.md`. Cobertura de critérios de aceite é global (waiver do owner de 2026-10-16); `agent run --task-contract` e o caminho de workflow da CLI não passam pela admissão.
- **W5-11a** (PR #227): matriz negativa (20 casos) e mutantes (28 rejeitados, 0 falhas). Mutantes sem detecção são declarados no recibo da task: `dap_survivor` sem mutante oficial, segunda guarda de localização do LSP, `RUN_ID_PATTERN` do MCP (defesa em profundidade); FR04, FR11, FR12, FR13 e FR15 sem caso na matriz.
- **W5-11b** (PR #228): **prova de integração, instalação e admissão governada**. Instala o core e os cinco plugins offline fora do checkout e conduz o consumidor real A (`cambio-real/apps/platform-web`) e o consumidor B (`axon-web`) por admissão governada com verificador fixado antes da primeira reserva. **Não** afirma que LSP ou DAP guiaram a correção: o despacho do modelo recebeu o defeito e o verificador externo aceitou o resultado. B é consumidor **sintético** (teste e defeito declarados). A jornada **não roda no CI**. Foram feitos **2 de 3 despachos** permitidos na assinatura; o custo **não é medido** (`cost_microusd` nulo; `max_cost_microusd` 0 só proíbe gasto pago; teto de API paga US$ 1, sem uso). Sem o despacho, a jornada termina com 24 PASS e 9 BLOCKED (exit 3), nunca PASS.
- **W5-12** (esta task): rastreabilidade final, recibo de verificação final, nota de migração (`limit`/`stale_minutes` da W5-04 e aceite da W5-10b), status das famílias F14, F15 e F20 em `requirements.json` e nós `proposed` do grafo de capacidades.

### Limitações aceitas na entrega

- **Contexto v2 nas tarefas reais (T3 da bateria viva)**: o runtime de engenharia declara `authority` e `provenance` das fontes constituição, projeto e critérios protegidos; fontes de extensão seguem sem declaração (autoridade derivada da camada). O `retrieved_at` dessas fontes é a constante convencional `1970-01-01T00:00:00.000Z`: o resolver não recebe `occurred_at` e a constante mantém o evento estável entre a tarefa e o resume.
- **Node 22**: a verificação final usa um clone com ABI do Node 22 (`better-sqlite3`); onde o recibo disser "não verificado", o motivo está registrado. O worktree da feature tem ABI do Node 24.
- **Mutantes sem detecção** declarados na W5-11a (acima); três mutantes da W5-08 (M04, M24, M22) e, na W5-07, o recibo declara apenas M01, M07 e M21 como equivalentes documentados (`evidence/w5-07/receipt.json:191-195`); M09 e M18 estão mortos (linhas 183 e 185) e M18b e N5 não têm evidência em recibo algum (não verificado; a citação anterior de três sobreviventes na W5-07 estava errada).
- **Consumidores reais**: F14, F15 e F20 ficam `real_consumers: not_verified`. A jornada exerceu LSP, DAP e navegador em consumidor real, mas isso não é consumidor real de F14: memória sem consumidor, DAP depurou um reprodutor do harness, o navegador renderizou uma página do harness e o verificador é uma regex.
- **Ativação**: plugins permanecem `scaffolded`; migration 017 de memória em `migrations-pending-activation`; merge, publicação, instalação global e ativação seguem como decisões separadas (G6).
- **Teste do marketplace** (`test-plugin-marketplace.js`): passou 88/0 em Node 22 e 24 na verificação final. Histórico: em waves anteriores 3 asserções falhavam sob `node --test` no wrapper de cgroup, causa não determinada e preexistente; segue como nota, sem reprodução nesta rodada.
- **Inventário (G3)**: 1538 de 1556; `packages` 137/137 e `tools` 393/393 sem folga. Valor final medido no recibo de verificação.

## Fecho da não conformidade central (fechamento W1–W5, onda W4, 2026-10-21)

A não conformidade central registrada no plano de fechamento era: LSP, DAP, navegador, computer-use e memória existiam como pacotes testados, sem chamador de produção, sem ToolRuntime nem política, com os eventos `environment.*` num ledger no-op, com `browser.run`, `computer.*` e `memory.*` como stubs `NOT_IMPLEMENTED` e com a memória fora do `memory[]` do contexto. Estado depois da onda W4, sobre a base `7fbeb0f9` da `feature/hseos-w5-closeout-w4`:

| Ponto                                                                                                                                                                                                                 | Fechado por | Evidência                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| Contratos reais no lugar dos stubs (browser, computer, memory)                                                                                                                                                        | W3, C4 e C5 | PR #238 (`0ad8a7da`), `f337c2fa`, `e9920773`                                                                    |
| Ledger real para `environment.*` e `memory.*` (migration 017 no fixture, sink do ledger de execução, `approval_outcome`)                                                                                              | W3          | PR #238 (`0ad8a7da`)                                                                                            |
| Caminho do runtime de tarefa, ToolRuntime e política (sem chamador de CLI/worker) (`environment.capabilities` no contrato de tarefa, `requires_approval` para `computer.*` e `memory.delete`, `drain` e `assertQuiescent` com os serviços) | C6          | `32e4e568`, correções `410d4eb6`, `0d4ddd0e`, `7fbeb0f9`                                                        |
| Memória no contexto (`memory[]` como `authority data`, só `store.retrieve`)                                                                                                                                           | C8          | `559eb7f2`                                                                                                      |
| MCP com aprovação (providers `environment.*` e `memory.*`, elicitação com ação e digest do screenshot, gate do serviço resolvido só depois do aceite, `ENV_CAPABILITY_UNAVAILABLE` sem host)                          | C7          | `61c9d40e`, `abaeff99`, `ae1072be`                                                                              |
| Jornada afirma as linhas do ledger                                                                                                                                                                                    | C11         | esta entrada; verificador em `test/journeys/environment-ledger.mjs`, teste `test/test-w5-environment-ledger.js` |

Fecho condicionado: C9 (teste estático de "chamador de produção") e C10 (integração ponta a ponta em SQLite real) não estavam na base `7fbeb0f9`. A PR da W4 só declara a não conformidade fechada com os dois integrados; até lá a tabela acima descreve o que está em código, não o fecho.

**Jornada (C11).** `test/journeys/w5-environment-journey.mjs` deixou de depender só do `replay-ledger` estático. LSP, DAP, navegador e computer-use (serviço e gate de aprovação) escrevem agora num ledger de execução real (SQLite no schema do fixture), e dois passos novos leem as linhas de volta: `s10b-memory` (escreve, recupera e apaga com aprovação, sem modelo e sem despacho) e `s11c-environment-ledger`, que falha se faltar uma linha esperada (`environment.lsp.completed` e `.refused`, `dap.completed`, `browser.completed`, o ciclo do computer-use, `memory.written` e `memory.deleted`), se um evento estiver no agregado errado ou sem `project_id`, se uma ação do computer-use não tiver `requested`, `approved` e `consumed` antes, ou se um `memory.deleted` não trouxer `approval_id` nem `memory.written` anterior. Capacidade cujo passo não passou deixa o `s11c` em BLOCKED (nunca PASS), depois de checar as linhas das demais. A jornada não foi executada com consumidores reais nem com despacho nesta task. Prova: o verificador tem teste unitário em `test/` (ledger real populado pelos serviços e pelo `MemoryStore`, casos de capacidade ausente e seis linhas adversariais, cada uma rejeitada pela própria regra), e `--only s10b,s11c` com consumidores vazios deu `s10b` PASS e `s11c` BLOCKED.

**Limitações aceitas.**

- **Dívida de produção da memória e do host (ativação, W8).** Nenhum código de produção monta o store de memória governado nem o `environmentHost` do servidor MCP: ambos chegam por injeção do embedder, e hoje só testes os injetam. O FR03 fica atendido em biblioteca, mas não é alcançável em produção até existir um embedder real. Sugestão para o runbook de ativação (`docs/evolution/runbooks/activation.md`): uma composição de host de referência, com o `MemoryStore` sobre o ledger de execução, as regras de escrita e o operador por projeto, os serviços de ambiente com o sink do ledger e o gate de aprovação do computer-use. O runbook ainda não está na master (vive na branch `feature/hseos-w5-closeout-w7`); esta entrada registra a dívida até o Commander levá-la para lá.
- As capacidades de ambiente são **opt-in**: a tarefa precisa declarar `environment.capabilities`; capacidade não declarada é negada.
- Não há chamador de CLI nem de worker até existir admissão que declare `environment.capabilities`; o que existe é o caminho do runtime de tarefa e do MCP.
- O servidor MCP moderno, único que serve esses providers, só roda em fixture (`EXECUTION_ACTIVATION_PENDING` fora dele); a ativação segue pendente (ADR-0022/0023).
- A elicitação mostra o digest do screenshot, não a imagem: quem aprova depende do cliente para tê-la visto.
- O console do navegador (violações de CSP) não é observável pelo serviço; a CSP do state-ui segue sem prova de console.
- A jornada com consumidores reais continua fora do CI e exige despacho de modelo para os passos de campanha; o fecho dos ledgers dos passos de LSP, DAP, navegador e computer-use só é provado de ponta a ponta nessa execução.

### Plugins das capacidades continuam `scaffolded` (C12)

Os plugins `plugins/lsp`, `plugins/dap`, `plugins/browser`, `plugins/computer-use` e `plugins/memory` seguem com `status: scaffolded` em `.agents/plugins/registry.yaml`. Ligar as capacidades ao runtime de tarefa e ao MCP (onda W4) não os promove: a promoção é decisão de ativação. Pelo mesmo motivo, `plugins/` fica fora de `files` do `package.json`: o pacote publicado carrega o runtime e os contratos das capacidades (`packages/**`, `tools/**`), não os plugins empacotados. Incluir `plugins/` em `files`, mudar o `status` e instalar os plugins pertencem à ativação (W8), no passo e com a autorização próprios descritos em `docs/evolution/runbooks/activation.md`. Esse runbook ainda não está na master: hoje vive na branch `feature/hseos-w5-closeout-w7` e passa a ser citável quando a onda W7 for mergeada.

## Registro final de resíduos — fechamento W1–W5

Registro da onda W6 (task E7), sobre a base `5962ae66` de `feature/hseos-w5-closeout-w6`. Fontes: a seção "Desvios registrados durante a execução" de `.hseos/runs/dev-squad/20261020-w5-closeout/PLAN.md`, as revisões céticas das tasks W6 e os registros de integração acima. Este registro não executa nem ativa nada. "Dono" é quem decide se o resíduo muda de destino: o **owner** (decisão de produto ou de risco) ou o **Commander** (planejamento e revisão da run). Destino: **aceito** (fica como está, com a justificativa), **→ W10** (resolvido pela onda W10 do `PLAN-CONCLUSAO.md`) ou **→ ativação** (tratado no runbook `docs/evolution/runbooks/activation.md`).

### Testes instáveis e mutantes

1. **Instáveis observados no CI: causa e correção por teste.**
   - Descrição: quatro instáveis foram investigados na W6-E8 e na W6-E3; o relato do Commander está nas últimas linhas de `.hseos/runs/dev-squad/20261020-w5-closeout/PLAN.md`.
     - `cancellation during workflow dispatch drains before settlement` (shard 22.x 1/6 da W7, run 39505105700): a cancelação relançava a rejeição do filho e o teardown não liberava a reserva. Corrigido em `05356840`; `1b211da1` fecha a regressão do join com deadline. Frequência de ~8% antes e 0 em 110 execuções depois.
     - `the dialog is drawn: more than the empty black root` (CI da W4-C8, run 39535516377): a janela estava mapeada mas ainda em branco. Corrigido em `6f70aaed`; 2 falhas em 60 antes, 100 de 100 depois. Pode exceder o prazo sob carga extrema, e isso é resíduo aceito.
     - `parallel tasks share the declared aggregate budget` (Node 22 shard 1/6 da W6-E3, run 39536874211): a tarefa `addition` terminou `blocked` (`engineering-execution-blocked`) com o orçamento íntegro. **Sem causa determinada** (0 falhas em 130 execuções); `a30c97d0` só registra o motivo do bloqueio por erro sem código, para o próximo caso.
     - Testes do host de browser sob contenção: `46953631` dimensiona o orçamento de chamada pelo custo medido no host (o commit registra que a chamada falhava em 22 de 25 execuções sob contenção de CPU; sem contagem pós-correção no commit; o executor w0-6-exec relatou 3 de 25 passando antes e 25 de 25 depois, sob 4 laços em 1 CPU, relato do executor da E8).
     - Teto de parede do guard (`ambiguous slashes cost a constant number of passes (1 MB)`, 200 ms, e `realistic 1 MB took 203 ms` no CI da #241): tratado na W6-E8 (`abf2c7bb`, depois `2cf09f86`), que prova o custo por escala.
   - Justificativa: os três primeiros têm causa e correção com medição antes e depois; o terceiro fica aceito sem causa.
   - Dono: Commander (investigação na W6-E8); owner se algum reaparecer como bloqueio de merge.
   - Destino: **aceito**, sem afrouxar asserção. Reaparecimento vira task própria de investigação.
2. **Instabilidade de `aborting the campaign kills the client through the cgroup` (caso g).**
   - Descrição: sob carga o cliente morria antes pelo timeout do próprio worker, e o teste não discriminava o `cgroup.kill`. A W6-E8 consertou o estado do processo (`b1ba8bff`) e, na rodada 2 (`2cf09f86`), a fixture `immortal` (ignora sinais, neto com `setsid`) passou a exigir o `cgroup.kill`.
   - Justificativa: a defesa é em camadas (stop e drain), então o teste só fica vermelho com os **dois** kills desligados; desligar só um deles segue verde. É o desenho da defesa, e a revisão da rodada 2 aprovou.
   - Dono: Commander.
   - Destino: **aceito**.
3. **Mutantes sem detecção, declarados nos recibos.**
   - Descrição: W5-11a: `dap_survivor` sem mutante oficial, a segunda guarda de localização do LSP e o `RUN_ID_PATTERN` do MCP (defesa em profundidade). W5-08: M04, M24 e M22. W5-07: o recibo declara M01, M07 e M21 como equivalentes documentados (`evidence/w5-07/receipt.json:191-195`); M18b e N5 não têm evidência em recibo algum. cl2: T01, T06 e T07. W5-04: P01, P04, P06, M03 (equivalente). 02b2: Y12 (equivalente).
   - Justificativa: equivalentes ou defesa em profundidade sem caminho público que os distinga; cada um foi aceito na revisão cética da respectiva task, com o motivo no recibo.
   - Dono: Commander (revisor da task).
   - Destino: **aceito**.

### Diagnóstico e redação de segredos (W6-E9, achados 3 e 4)

4. **Corpo PEM multilinha sem marcador.**
   - Descrição: um segredo multilinha sem marcador (corpo PEM) fora da janela de 4096 bytes do stderr pode chegar ao diagnóstico.
   - Justificativa: a redação cobre credenciais com marcador e a janela limitada; a revisão da E9 (5e30586e, PASS-WITH-NOTES) a registrou como resíduo para este registro, sem exigir correção.
   - Dono: owner (risco de vazamento de credencial).
   - Destino: **aceito**.
5. **Trecho de entrada nas mensagens de `JSON.parse`.**
   - Descrição: as mensagens de `JSON.parse` do Node 24 trazem ~10 caracteres da entrada, então um trecho de prompt ou de saída em texto livre pode chegar ao diagnóstico; a redação só barra credenciais.
   - Justificativa: o volume é de ~10 caracteres e a redação não tem como distinguir texto livre de dado inofensivo sem descartar a mensagem de erro inteira, que é o que o diagnóstico precisa mostrar.
   - Dono: owner.
   - Destino: **aceito**.

### Guard de captura de capacidades (W6-E8, itens f e h)

6. **Lentidão linear de fator constante não detectada.**
   - Descrição: os casos (f) e (h) provam o custo por escala e não detectam lentidão linear de fator constante (< 2,5x no (f), < 7x no (h)).
   - Justificativa: a cobertura restante vem dos orçamentos absolutos do guard (5k linhas < 1000 ms, `export` não fechado < 1000 ms, listas de `export` < 400 ms), que continuam sensíveis a carga. Trocar um pelo outro perderia ou a garantia de complexidade ou a de tempo, e nenhuma das duas pode ser afrouxada.
   - Dono: Commander.
   - Destino: **aceito**.
7. **Join com fallback após o deadline relança rejeições.**
   - Descrição: caso (a) da W6-E8, o join em fallback depois do deadline relança as rejeições de runtime, inclusive a da própria cancelação. A regressão do join com deadline foi fechada em `1b211da1`.
   - Justificativa: efeito aceito explicitamente na revisão da E8 (`abf2c7bb`); a alternativa de engolir a rejeição esconderia falha de runtime.
   - Dono: Commander.
   - Destino: **aceito**.

### Fio legado do MCP e sunset

8. **Fio legado sem `error.data.code`.**
   - Descrição: `tools/lib/mcp-transport.js:205` usa `buildMcpError(id, -32000, error.message)` sem código estável, então `MCP_SCOPE_DENIED` não chega ao cliente do servidor legado e os testes casam por mensagem. A ressalva (a) da W0-5, `test/test-mcp-contract.js` casando `'required'`, foi tratada na W6-E3.
   - Justificativa: expor `error.data = {code}` mexe numa superfície legada que tem sunset (revisão da W0-5).
   - Dono: owner (data do sunset).
   - Destino: **→ W10** (G0, ADR-0048, e K4: o sunset do legado deixa de ser a data fixa). Até o legado sair, o fio legado segue **aceito** como está.
9. **O servidor legado ignora o sunset de 2026-11-30.**
   - Descrição: os 4 servidores MCP instalados sobem o legado (`tools/lib/legacy-mcp-server.js`) e só gravam o sunset como metadado de telemetria; o moderno, o único que recusa o legado depois do sunset, está bloqueado por `EXECUTION_ACTIVATION_PENDING` até a ativação ADR-0022/0023, que exige 30 dias de zero legado e não cabe antes de 30/11. Decisão do owner de 2026-10-20: registrar como dívida da ativação, sem mexer na produção.
   - Justificativa: o sunset só vale ao ativar o moderno.
   - Dono: owner.
   - Destino: **→ W10** (G0: ADR de critério de ativação em Proposed, que o owner aceita; K4: servidor moderno sobre banco ativado). A execução fica no passo 1b do runbook de ativação.

### Isolamento, extração e navegador

10. **`SIGKILL` do timeout do filho de extração do zip.**
    - Descrição: o filho que descomprime entradas do zip do `chrome-headless-shell` usa `killSignal: 'SIGKILL'` (`tools/lib/environment-toolchain-pins.js:427`); nenhum teste prova `SIGKILL` em vez de `SIGTERM`.
    - Justificativa: o timeout, o teto de memória do filho (pico do pai de 541 MB para 95 MB no chrome real) e a extração byte-idêntica estão provados (E4, aprovada); o sinal em si é detalhe de implementação.
    - Dono: Commander.
    - Destino: **aceito**.
11. **CSP sem leitura de violação no console.**
    - Descrição: o serviço de browser (`createDefaultBrowserService`) não expõe mensagens de console nem violações de CSP, então a ausência de violação na CSP do state-ui não foi observada num navegador (W6-E6, aprovada).
    - Justificativa: a revisão da E6 aprovou com a limitação registrada; observar o console exige capacidade nova no serviço de browser.
    - Dono: owner.
    - Destino: **aceito**; leitura de console é candidata a capacidade futura.
12. **Varredura de `pids_max` limitada a 5 arquivos.**
    - Descrição: a W6-E5 (`84746de5`, `5d35b336`) derivou a faixa de `pids_max` de uma fonte única (`LIMIT_FLOOR`/`LIMIT_CEILING` em `profiles.js`), estendeu o escopo a 3 adapters de provider com o mesmo literal e fixou as fronteiras dos adapters native e antigravity; a varredura independente de formatação cobre só os arquivos listados na task.
    - Justificativa: um literal novo em arquivo fora da varredura não seria detectado; o risco é de manutenção, não de comportamento atual.
    - Dono: Commander.
    - Destino: **aceito**.

### Ambiente de teste e CI

13. **Hook leve falhou uma vez em "Tests (touched + referencing)".**
    - Descrição: na integração W6-INT-2 o hook leve falhou uma vez sem identificar o teste; a reexecução passou.
    - Justificativa: não reproduziu e o log não nomeou o teste; a prova completa é o CI de cada push.
    - Dono: Commander.
    - Destino: **aceito**; reaparecimento exige capturar o nome do teste antes de reexecutar.
14. **Falhas ambientais fora do cgroup (dois relatos distintos).**
    - Descrição: (a) `worktree-manager.sh validate` reprova 5 casos de `test/test-kernel-mutations.js` (`task_cancellation`, `job_shutdown`, `job_acceptance`, `job_ledger`, `job_preparation`) fora do cgroup, também na master pura (desvio de 2026-10-20, PLAN.md). (b) **Relato do revisor da W6-E5 (`5d35b336`/`84746de5`), não reproduzido pelo Commander e com causa não verificada:** `test/test-provider-campaign-adapters.js` tem 5 falhas rodando fora do cgroup (testes de worker real, supervisor e perfil de recursos), idênticas em `84746de5` e `953949a0`. A leitura "exigem cgroup delegado" é inferência do revisor pelos nomes dos testes.
    - Justificativa: os dois relatos são de arquivos diferentes e não se confundem; nenhum afirma causa comprovada além de rodar fora do cgroup. Commits e testes passam a rodar por `/build/tmp/hseos-w5/bin/commit-in-cgroup.sh` e `run-in-cgroup.sh`.
    - Dono: Commander.
    - Destino: **aceito**; confirmar a causa de (b) fica para quem reproduzir.
15. **Falhas de infra do CI.**
    - Descrição: `apt` com HTTP 403 em `packages.microsoft.com` e falha no fetch do `chrome-headless-shell` durante o provisionamento (CI da W6-E5), resolvidos por re-run sem mudança. O smoke em ambiente limpo sem cache de toolchain na #241 foi corrigido em `766f13ab`.
    - Justificativa: falha externa ao código, sem mudança de teste ou de workflow.
    - Dono: owner (workflow).
    - Destino: **aceito**.
16. **`test-engineering-task-runtime.js` roda 3 vezes na suíte completa.**
    - Descrição: ~60 s, nos jobs `test:engineering-task`, `test:kernel` sob c8 no kernel-coverage e na conformance de providers.
    - Justificativa: não é bug; reduzir exige redesenhar gates.
    - Dono: owner.
    - Destino: **aceito**.
17. **O supervisor de suítes mascara vazamento de processo.**
    - Descrição: o supervisor da conformance mata o grupo também no fim normal (W0-7); um neto com `setsid` escapa do grupo e segura o pipe até o backstop. Sugestão da revisão: emitir aviso quando o `killGroup` do fim normal encontrar processos vivos.
    - Justificativa: a limpeza é o efeito desejado; o aviso é melhoria.
    - Dono: Commander.
    - Destino: **aceito**.

### Dívidas de produto

18. **Opacidade com `max_tokens` abaixo de ~12000.**
    - Descrição: o contrato de engenharia termina em `session-failed:internal_error` com mensagem genérica (overflow de montagem de contexto descartado por `normalizedFailure`); candidato é validar um mínimo ou expor `context_overflow`.
    - Justificativa: **não tratado**. Nenhum termo `context_overflow`, `MIN_MAX_TOKENS` ou mínimo de `max_tokens` aparece em `git grep` no SHA `333828f2`; o PLAN.md mandava registrar aqui se a W1 não tratasse.
    - Dono: Commander.
    - Destino: **aceito** como dívida aberta; tratar exige task própria.
19. **Elicitação mostra o digest do screenshot, não a imagem.**
    - Descrição: quem aprova o `computer.*` depende do cliente para ter visto a imagem.
    - Justificativa: limitação registrada na W4 (C7); mostrar a imagem depende do cliente.
    - Dono: owner.
    - Destino: **aceito**.
20. **Host de produção do ambiente e da memória governada.**
    - Descrição: nenhum código de produção monta o store de memória governado nem o `environmentHost` do servidor MCP; ambos chegam por injeção do embedder (dívida de `063adf5d`). Sem o host, o comportamento é `ENV_CAPABILITY_UNAVAILABLE` ou `ENGINEERING_ENVIRONMENT_HOST_REQUIRED`.
    - Justificativa: depende da ativação do banco; o plano de conclusão a resolve com `createProductionEnvironmentHost` (K5) e a seção `environment:` em `~/.config/hseos/config.yaml`.
    - Dono: owner.
    - Destino: **→ W10** (K5); a composição de referência está descrita no runbook de ativação.
21. **Admissão do `agent run`.**
    - Descrição: `agent run --task-contract` e o caminho de workflow da CLI não passam pela admissão (aceite da W5-10b); ao ligar um `environmentHost` à CLI ou ao worker, o caminho `readEngineeringTask` sem admissão rodaria tarefas novas com `environment` sem a admissão da W2 (pré-condição C10/C11).
    - Justificativa: hoje não há host na CLI, então nada roda sem admissão; a pré-condição vale a partir do K5.
    - Dono: owner.
    - Destino: **→ W10** (K6: `readEngineeringTask` com `admission`, `runEngineeringTask` e `validate-task`; o worker segue com `admission:false` por design).
22. **Ativação do banco existente e do servidor MCP moderno.**
    - Descrição: nenhum comando de ativação existe; a migration 017 segue em `migrations-pending-activation`.
    - Justificativa: depende do ADR de critério de ativação aceito pelo owner (G0) e do comando `hseos execution-activation plan|apply|rollback` (K2).
    - Dono: owner.
    - Destino: **→ W10** (G0, K2, K3, K4, K7) e **→ ativação** (passo 1b do runbook, só com autorização própria).

### Decisões e desvios de processo

23. **`memory.write` sem aprovação do runtime.**
    - Descrição: decisão do owner de 2026-10-21; o provider é idempotente pelo `memory_id` e o controle é a política `admitWrite` do store (deny por padrão) mais a varredura de credencial. `computer.stop` é idempotente e sem aprovação (só encerra). Fonte: PLAN.md, desvio de 2026-10-21.
    - Justificativa: decisão explícita do owner.
    - Dono: owner.
    - Destino: **aceito**; as regras de escrita por projeto entram no host de produção (→ W10, K5).
24. **`packages/agent-environment/index.js` fora de `.c8-kernel.json`.**
    - Descrição: correção de fato do planejamento: o arquivo não está no gate de cobertura 90/80 por arquivo do kernel (os demais arquivos do pacote estão, linhas 75-92). Fonte: PLAN.md, desvio de 2026-10-20.
    - Justificativa: registrado na W3 como correção de fato; mudar o conjunto do gate de cobertura é decisão do owner.
    - Dono: owner.
    - Destino: **aceito**.
25. **Merges da W6-INT-1 fora do `commit-in-cgroup`.**
    - Descrição: desvio da integração (`97a5ac14`): os commits de merge saíram fora do `commit-in-cgroup.sh`; o hook commit-msg passou e não houve bypass (PLAN.md, W6-INT-1).
    - Justificativa (inferência, não registrada na fonte): merge sem testes selecionados; a prova completa é o CI de cada push.
    - Dono: Commander.
    - Destino: **aceito**.
26. **Wrapper global `~/.local/bin/hseos` frágil.**
    - Descrição: o wrapper escolhe a maior versão do `nvm` (`sort -V`); um Node maior sem o pacote o quebra (incidente de 2026-10-20, runbook §1).
    - Justificativa: corrigir o wrapper está fora do repositório; o runbook mitiga fixando o PATH do Node 24.15.
    - Dono: owner.
    - Destino: **→ ativação** (passo 1: PATH fixado em todos os comandos).
27. **Worker do adapter engolia o stderr (FECHADO).**
    - Descrição: o worker do adapter `claude/account` rodava com stdio `ignore` e convertia qualquer falha em `CONTROL_OUTCOME_UNCERTAIN` sem causa (achado do T1).
    - Justificativa: fechado por `d83d8907`, que mantém a causa real no evento `uncertain`.
    - Dono: Commander.
    - Destino: **fechado**.

### Resíduos anteriores que seguem como estão

Nenhum dos itens abaixo é reaberto por este registro; cada um continua aceito pela revisão que o registrou, na fonte citada:

- **LV/CO e integração B1** (seções "Resíduos a registrar" e "Resíduos acrescentados pela revisão da integração" acima): LV1 (status desconhecido de `background_tasks`, TeammateIdle, R5 com `WAITING_ON` de até 4 h); LV2 (tabelas sem migração numerada, retenção de eventos, itens 3 a 6 da revisão 4, systemd e `notify-send` não verificados); CO1 (F13, sidecars `-wal`/`-shm`, N1, N2.2); CO2 (A1, template do Codex não verificado no Codex real); G1 (grafias YAML exóticas).
- **`init`, `rate_limit` e `pids_peak`:** sinais declarados desconhecidos e não expostos no recibo (W5-10 e `revalidation-2026-10/STATUS.md`).
- **Revalidação de 2026-10** (`docs/evolution/revalidation-2026-10/STATUS.md`): `pids_max=64` insuficiente para clientes reais; critérios de aceite fracos (endurecimento na W5-10b, só para novas admissões); adapters de API, ACP e local sem retenção da saída; divergência `-32600` do adapter `mcp-2026`; transporte HTTP legado sem limite de corpo; `$ref` não resolvível só falha na chamada; riscos residuais no `swarm` (TOCTOU, hardlink, `cwd`); digest de conta sem sal; `requirements.json` sem atualização das 27 famílias.
- **Validação de consumidor de 2026-10** (`docs/evolution/consumer-validation-2026-10/STATUS.md`, "Resíduos aceitos e pendências"): F6 parcial; F9 (`sandbox engineering-check` bloqueado sem causa exposta); dois installs simultâneos sem lock; recall menor em consultas genéricas; `react` em `devDependencies` da raiz; mensagem de escopo; `e2e`, `scripts` e `infra` fora do guard; registry sem implementação `stable`; A7, A8 e A9 reconfirmados.
- **Limitações aceitas na entrega** (W5-12, seção acima): contexto v2 com `retrieved_at` convencional, Node 22, mutantes, consumidores reais, ativação, marketplace e inventário.
- **Fora da W5, só registradas:** `loop-guard.sh` em `node_modules` (corrigido na cl1, item 9), evidência de saída nos adapters API/ACP/local, digest de conta sem sal, hook de commit que bloqueia nomes de fornecedor.

Os plugins seguem `scaffolded` (C12), `real_consumers: not_verified` para F14, F15 e F20, e a ativação (hooks, timer, contratos, tags, distribuição) segue não executada e dependente de autorização.

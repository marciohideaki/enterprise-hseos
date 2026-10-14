# W5 — estado de execução

Tipo: evidência de progresso, iniciado em 2026-10-10 e atualizado em 2026-10-13. Base dos contratos `e079409c`, rebaseados sobre a master `0dd3bb89`; upstream `master`;
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

| Etapa                                    | Determinístico                                                   | Consumidor real | Ativação       |
| ---------------------------------------- | ---------------------------------------------------------------- | --------------- | -------------- |
| W5-01                                    | contratos concluídos; verificação a reexecutar por quem integrar | não aplicável   | não autorizada |
| W5-02a / W5-02b1 / W5-02b2 / W5-04       | integradas e verificadas na B1 (seção "Integração da onda B1")   | não verificado  | não autorizada |
| W5-LV1 / W5-LV2 / W5-CO1 / W5-CO2        | integradas e verificadas na B1 (seção "Integração da onda B1")   | não verificado  | não autorizada |
| W5-03 / W5-05 / W5-06                    | integradas e verificadas na B2 (seção "Integração da onda B2")   | não verificado  | não autorizada |
| W5-07 / W5-08 / W5-09                    | não verificado                                                   | não verificado  | não autorizada |
| W5-10 / W5-10b / W5-11a / W5-11b / W5-12 | não verificado                                                   | não verificado  | não autorizada |

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

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
| W5-03 / W5-05 / W5-06                    | não verificado                                                   | não verificado  | não autorizada |
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

Branch `integration/hseos-w5-b1`, parte de `feature/hseos-evolution-w5` (07bd5e97). HEAD verificado: `35440fa5`. Ordem dos merges (`--no-ff`):
contratos `5afa6501` (merge `938e1f1d`), 02a `2a2f15eb` (`b04ff03d`), 04 `0ce6b4eb` (`d20b4a34`), LV1 `3a0a5ae6` (`14be5f5a`), LV2 `16c52664` (`e807c62c`),
CO1 `d82eaa09` (`17f06c6c`), CO2 `a7783abb` (`569d1007`) e 02b (02b1 `a4343171` + 02b2 `51be92f6`, merge `e818b826`).
Receipt: [evidence/integration-b1/receipt.json](evidence/integration-b1/receipt.json).

Correções da integração (um commit cada): teto do pacote `.hseos` 64 / 1556 (`32affa38`, G3 do owner de 2026-10-12); `.gitignore` de coverage (`b8c8a85d`);
LV1 alinhada ao contrato do CLI de report (`1551e020`); inbox compartilhada da LV2 ignora entradas de coordenação (`852b15d4`); eventos espelhados da CO1 com `id` e recusa do alias do adaptador (`354c6b4c`);
aviso em stderr quando o CLI gravável por grupo é recusado (`94a09cde`); teste de composição CO1 + CO2 reais (`7dcc1dc9`); critério da W5-04 em `tasks.md` (`8aa63437`);
manifest do CLI (`1966b391`, `35440fa5`); simetria de chave desconhecida em `agent-liveness.yaml` (`c251318a`).

**Critério da W5-04 (decisão do owner, 2026-10-12):** o legado só é alcançável pelo gateway, com registro durável. Substitui a redação anterior em `tasks.md`.

**Simetria do `agent-liveness.yaml` (resolvida):** chave conhecida com valor inválido torna o arquivo inválido e vale a última configuração válida, com aviso; chave desconhecida gera aviso em stderr
e é ignorada, sem rejeitar o arquivo. Vale igual no guard, no `check` e no `watch` (antes, a CLI e o watch rejeitavam o arquivo e um typo parava o watchdog). Provado em processo real por
`test/test-liveness-composition.js`, com o guard compilado e o canônico.

### Resultados da verificação (Fase 3)

| Verificação                                                                    | Resultado                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify de W5-01, 02a, 02b1, 02b2, 04                                           | verde, em `c251318a` (o commit seguinte só regenera o manifest)                                                                                                                           |
| verify de LV1, LV2, CO1, CO2 (c8 com includes dos receipts, 90/80 por arquivo) | verde, em `c251318a`; o spec dessas trilhas não fixa um comando único, os includes vêm dos receipts                                                                                       |
| `npm run test:kernel-coverage` completo (uma vez)                              | sem falhas e sem erro de cobertura, em `c251318a`: all files 97,34% linhas / 91,86% branches; exit code não capturado; conclusão pelo log (10 blocos com 0 falhas, sem erro de cobertura) |
| `npm test` completo, Node 24.15.0                                              | exit 0, em `35440fa5`                                                                                                                                                                     |
| `npm test` completo, Node 22.23.3 (clone separado, better-sqlite3 no ABI 22)   | exit 0, em `35440fa5`                                                                                                                                                                     |
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
- **Desvio de processo:** os testes focados da Fase 2 rodaram sem `heavy-run` durante o lock de outra sessão, no mesmo cgroup; e os hooks do husky só passaram a existir no worktree às 10:01 de 2026-10-13, de modo que `e818b826` e `c251318a` podem ter sido commitados sem pre-commit. O manifest stale deixado por `c251318a` foi pego pelo `npm test` e corrigido em `35440fa5`.

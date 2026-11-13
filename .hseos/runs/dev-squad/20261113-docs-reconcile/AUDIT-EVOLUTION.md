# Auditoria — documentação viva de evolução (achados aceitos)

Fonte do estado: `docs/evolution/requirements.json` (ler com `node -e`), `.hseos/runs/dev-squad/20261111-terminal-closeout/FINAL-REPORT.md` e `OWNER-GATES.md`, `docs/evolution/terminal-closeout/`.

- **E1** `docs/evolution/_INDEX.md` (lista de links ~25-43): acrescentar o fechamento do terminal (2026-11-11, TERMINAL PRONTO COM GATES DECLARADOS) com links `terminal-closeout/W6-ENTRY.md`, `terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md`, `terminal-closeout/terminal-readiness.json`, `../terminal.md`.
- **E2** `_INDEX.md:3`: "recibos das ondas 0 a 4 e da revalidação 2026-10" — existem `w5/` e `w10/`; atualizar a descrição e acrescentar links que faltem (`w5/STATUS.md`, `w10/`, confira o que existe).
- **E3** `_INDEX.md:11-12`: "todos os estados de evolução começam não verificados" — dizer que começavam assim em 2026-09-25 e que o estado atual está em `requirements.json` e no `STATUS.md`.
- **E4** `PLAN.md`, tabela "Estado consolidado", linha W0, "Ainda falta": "9 das 27 famílias seguem not_verified_for_evolution (entre elas F08, F17, F18, F24, F25, F27)" — hoje são 6 (F07, F17, F24, F25, F26, F27); F08/F18 `verified_w3_scope_only`. Atualizar com data e citar OG-01..OG-09 para `real_consumers`.
- **E5** `PLAN.md` linha W3: "F17 e F18 sem verificação de evolução" — F18 `deterministic` verificada em 2026-11-05; F17 `not_verified_for_evolution` (OG-05, depende de C4); C6 BLOCKED (sem chave); `tools/call`/MRTR do Codex bloqueado pelo cliente.
- **E6** `PLAN.md` linha W5: "Consumidor real não verificado em F14, F15 e F20" — F20 é `verified_installed_local_scope_only` (escopo declarado); F14 e F15 `not_verified` (decisão do owner de 2026-11-09, sem nova campanha; OG-06).
- **E7** `PLAN.md` linha W4: acrescentar "(F01/F11/F16/F21 sob ratificação do OG-01)" à menção de consumidor real.
- **E8** `PLAN.md` tabela de estado consolidado: acrescentar nota/linha apontando o fechamento do terminal (W1–W5 provadas em instalação limpa; `terminal-closeout/`).
- **E9** `STATUS.md:28` (entrada do fechamento): completar com PRs #314–#318, tags `hseos-terminal-wa`..`wd` e `hseos-terminal-close`, aceite instalado (`terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md`) e `docs/terminal.md`.
- **E10** `STATUS.md:20` (acima do marcador de histórico): "F14, F15, F20 sem consumidor real verificado" — acrescentar nota datada de que F20 foi promovida depois (escopo instalado local).
- **E11–E13** `pendencias-w0-w5/MAPA.md` §8 (tabela de 2026-10-27; linhas ~135-154 e §6 ~106): NÃO reescrever as células; acrescentar após a tabela uma nota "Estado das PRs (conferido em 2026-11-13)": #255 mesclada `af1c4529`, #256 mesclada `773d8ccc`, #257 mesclada `f953992b` (confirme com `gh pr view <n> --json state,mergeCommit`).
- **E15** `MAPA.md:1` e `:8-9`: acrescentar linha de que o documento foi atualizado até 2026-11-11 (§9 e §10) e que §1–§8 são retratos datados.
- **E16** `MAPA.md` §10: acrescentar os OG de maior efeito (OG-01, OG-16, OG-17) e links para `../terminal-closeout/` e `../../terminal.md`.
- **E17** `runbooks/activation.md:365`: a frase sobre resolver o sunset pelo ADR-0048 e MCPs legados até o passo 1b está defasada — ativação executada em 2026-10-22 (PLAN, "Ativação"); sunset decidido sem data em 2026-10-30 (MAPA §5 item 5); `2026-11-30` só em fixture. Acrescentar nota datada ou atualizar a frase.
- **E18** `runbooks/activation.md:374`: "o owner fixar a data de sunset do legado" — já decidido: sem data.
- **E19** `runbooks/activation.md:3` e `:363`: status "nada deste documento foi executado" e "as flags ainda não existem" — ativação executada em 2026-10-22 (SHA `795e6540`) e reinstalada em `25e673ff` (PLAN); flags existem desde a #266: `node tools/cli/hseos-cli.js execution-activation --help` lista `--db`, `--adr`, `--backup-dir`, `--window`, `--backup`, `--expected-sha256`, `--receipt`, `--allow-missing-receipt`, `--json`. Atualizar o status e a linha 363 com nota datada.
- **E20** `runbooks/activation.md:350`: "consumidores F14/F15/F20 real_consumers: not_verified" — F20 `verified_installed_local_scope_only`.
- **E21** `runbooks/f14-f15-real-consumers.md:18` e `:53`: campanhas reais da F14 foram executadas (v1–v4 até 2026-11-09; `docs/evolution/w3/F14-V4-2026-11.md`), sem critério L2 atendido; F14 encerrada sem nova campanha pelo owner. Atualizar com nota datada.
- **E22** `runbooks/f14-f15-real-consumers.md` §4 (~105-127): F15 L2 executada em 2026-11-09 (`docs/evolution/w3/F15-L2-2026-11.md`, `fail`); nota datada no topo da §4.
- **E23** `runbooks/fourth-family.md:3`: acrescentar estado 2026-11-11: C6 BLOCKED (sem chave), OWNER-GATES OG-04.
- **E25** `terminal-closeout/W6-ENTRY.md`: nota curta de que o campo `revision` do `terminal-readiness.json` é a revisão do veredito (antes dos merges de registro), não a `master` atual.
- Recusado: E24 (sem divergência). E14 (A-13/A-19/A-20 "sem merge"): só cite PR se `git log` confirmar; caso contrário, inclua na mesma nota de estado das PRs como "mesclado nas PRs da run audit-fixes" somente se comprovado.

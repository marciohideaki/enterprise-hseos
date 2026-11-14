# PLAN — run `20261113-repo-hygiene`

Plano aprovado pelo owner no terminal em 2026-11-13, a partir do prompt citado em `INTAKE.md` e ajustado pela análise da HA (`INVENTORY.md`, `CLASSIFICATION.md`). Base: `master` `a4fabbd5`.

## Ondas

| Onda | Branch | Entrega | Tasks |
|---|---|---|---|
| HA | `feature/repo-hygiene-ha` | PR de documentação: grafo de referências (`docs/hygiene/20261113/`) e registros da run | HA1-refgraph (grafo: execução e rodadas de correção 1 e 2, 3 commits), HA2-run-records |
| HB | sem PR (host e remoto) | `GIT-HYGIENE.md`: `git worktree prune`; branches locais contidas ou patch-equivalentes apagadas; bundles verificados antes de apagar as que têm commit sem equivalente; remotas MERGED e patch-equivalentes apagadas com `ls-remote` conferido na hora | HB1 (executor em série) |
| HC | `feature/repo-hygiene-hc` | Tag `hseos-hygiene-archive-20261113` na `master` antes; `git rm` dos 145 arquivos de `REMOVAL-SET.txt`; `docs/hygiene/20261113/MANIFEST.md`; nota no índice vivo | HC1-remove (1 lote: todos os itens são da mesma natureza) |
| HD | `feature/repo-hygiene-hd` | Guard de reacúmulo (teste, ADR-0052: mecanismo declarado) | HD1-guard |
| HE | `feature/repo-hygiene-he` | Limpeza local (LIXO-LOCAL), reauditoria cega, `FINAL-REPORT.md`, tag `hseos-hygiene-close` | HE1-close |

Riscos:
- Leitura dinâmica de `.hseos/runs` não aparece no grafo. A cobertura vem da remoção simulada com a suíte completa e da passagem (b) do revisor.
- O OG-17 (desempenho intermitente sob carga) pode reprovar a suíte. A suíte roda pelo supervisor `ci-test-shards run`, que executa todos os itens. Uma falha só do teste OG-17 é reconfirmada isolada e registrada, nunca convertida em PASS.
- O OG-11 (o hash da F14 v4 cobre o `package.json`): o guard da HD entra sem mudar o `package.json`.

## Execution Protocol

- **Coordenação:** `dev-squad` sob **SWARM** (`.hseos/agents/swarm.agent.yaml`, `.hseos/workflows/dev-squad/workflow.md`; fonte canônica `.enterprise/governance/agent-skills/dev-squad/`, ADR-0015). O Commander roda em Opus na thread principal. O Squad é Sonnet, com `model: "sonnet"` declarado em toda chamada. Não há opt-in de Opus em execução.
- **Invariantes:**
  - worktree por task (`worktree-manager.sh create|validate|commit|remove`; `validate` com arquivos staged, `GATE_CODE_MODE=light` e Node 24 na frente do `PATH`);
  - 1 task = 1 commit (a rodada de correção é um commit novo); 1 onda = 1 PR;
  - build e teste em série via `heavy-run --mem 4G`, com uma suíte completa por onda;
  - revisor isolado de duas passagens, que reporta e não corrige;
  - nunca converter bloqueio em PASS; nunca afrouxar gate nem orçamento G3;
  - sem `--no-verify`, sem force-push, sem reescrever histórico, sem commit na `master`;
  - sem atribuição de IA em commit e PR; scratch em `$TMPDIR`.
- **Ações destrutivas:** só as da seção 1, depois da preservação (bundle e `verify`, tag de arquivo) e com recibo antes e depois. `git push origin --delete` só com a ponta conferida por `git ls-remote` na hora.
- **Gates humanos:** nenhum de espera. O que exige o owner está em `OWNER-GATES.md`. O merge está autorizado por PR com checks verdes e `CLEAN` (seção 1), via `hseos pr closeout <n> --approved`.
- **Versionamento:**
  - `hseos-hygiene-wa` depois da HA;
  - `hseos-hygiene-archive-20261113` antes da HC;
  - `hseos-hygiene-wc`, `-wd` por onda com PR;
  - `hseos-hygiene-close` no fim.
- **Liveness:** todo turno despachado termina com `LIVENESS: {...}`.

| Onda | Squad | Tier |
|---|---|---|
| HA | 3 exploradores, 1 executor do grafo e 1 revisor | Sonnet; o Commander classifica |
| HB | 1 executor em série e 1 revisor | Sonnet |
| HC | 1 executor e 1 revisor | Sonnet |
| HD | 1 executor e 1 revisor | Sonnet |
| HE | 1 executor e 1 auditor final | Sonnet; o Commander emite o veredito |

# CLOSE — Registros de fechamento das ondas W4–W7 (MAPA §5 e §8) e commit da run

Leia primeiro e siga: /workspace/github/marciohideaki/enterprise-hseos/.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/COMMON.md

- **Worktree:** /workspace/github/marciohideaki/enterprise-hseos/.worktrees/od-close-records
- **Branch:** `task/od-close-records`, feature `feature/owner-decisions-close`, base master `55d3d1aa`
- **Task id:** `od-close-records`
- **Tier:** small
- **Escopo:** só documentação e registros

## Fontes (leia inteiras)
- **STATUS da run (fonte de verdade):** `/workspace/github/marciohideaki/enterprise-hseos/.hseos/runs/dev-squad/20261030-1810-owner-decisions/STATUS.md`, no checkout principal; esse diretório ainda não está rastreado.
- `PLAN-2.md` da mesma run, com as decisões M e A1–A19.
- `docs/evolution/pendencias-w0-w5/MAPA.md`, em especial o §5 item 9 (linha ~89) e o §8 (linha ~130 em diante).

## Entregas
1. **Copiar o diretório da run para o worktree.** A origem é `.hseos/runs/dev-squad/20261030-1810-owner-decisions/`, no checkout principal, e o destino é o mesmo caminho no worktree.
   - Use `cp -a`; a cópia só lê a origem. Não mova e não apague a origem: o Commander remove depois do merge.
   - Antes de copiar, confira se o `.gitignore` ignora algo em `.hseos/runs`; se ignorar, reporte e pare.
   - Varra os arquivos copiados atrás de credenciais (`rg -n "BEGIN .*PRIVATE KEY|ghp_|sk-|xox[bp]-|AKIA"`) e de caminhos de `$HOME` com segredos. Se achar algo, PARE e reporte, sem commitar.
2. **MAPA §5, item 9.** Atualize o trecho do g9: diga que foi substituído por `g9-adr0048-activation-criterion` em W5/E6 (PR #262, `75b472e0`), com 4 condições verificáveis e 9 que ficam sempre pendentes. Mantenha as demais partes do item.
3. **MAPA §8.** Acrescente a subseção `### Estado em 2026-10-31 (ondas W4–W7)` com uma tabela de onda, PR, merge, tag e tasks:
   - W4 #261 `e6239c2a`;
   - W5 #262 `75b472e0`: E4, E5, E6, mais E10 e E11, que nasceram do CI;
   - W6 #263 `55d3d1aa`: E7, E8, E9.

   Depois da tabela:
   - o resultado de cada decisão A1–A19 (feito, onde, ou pendente);
   - o achado E11, a corrida real no takeover do lock de install, já corrigida;
   - os pendentes listados no STATUS:
     - A12 parcial: release pronto, janela do owner pendente;
     - divergência do pin do AGENTS.md global;
     - watchdog `hseos-liveness-watch` falhando;
     - A18 sem login;
     - A15 com o que foi removido e mantido;
     - as decisões abertas (a)–(e) do STATUS, as 14 questões do ADR-0049 e as 12 do ADR-0050.

   Seja factual e cite os SHAs do STATUS. Não declare conformidade nova.
4. Não edite código, contratos, policies nem gates.

## Critérios de aceite
- Verdes via cg.sh (`timeout 540 /build/tmp/owner-decisions/bin/cg.sh <worktree> '<cmd>'`, com Node 24 no PATH; exit 75 = espere 60 s e repita):
  - `node --test --test-concurrency=1 test/test-documentation-neutrality.js`;
  - `node .github/scripts/ci-test-shards.mjs verify --shards 6`.
- Prettier no MAPA, se o projeto formata markdown (confira o `.prettierignore`).
- node_modules: se faltar, `npm ci` com Node 24 via `heavy-run --mem 4G --`.
- 1 commit: `docs(evolution): record owner decisions W4-W7 and the run records` (≤100 chars), com o hook ativo, sem atribuição de IA e sem push.
- Relatório em `logs/CLOSE.md` **no worktree** (ele entra no commit).

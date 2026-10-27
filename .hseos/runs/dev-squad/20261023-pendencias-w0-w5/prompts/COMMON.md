# Regras comuns (dev-squad pendências W0–W5) — leia antes de agir
- Português (BR). Você é executor Sonnet do squad; o Commander decide escopo. Projeto com .axon/: use mcp__axon__* via ToolSearch (`select:mcp__axon__get_context_capsule,mcp__axon__get_skeleton`) começando por `get_context_capsule`.
- Worktree: `scripts/governance/worktree-manager.sh create <task-id> <feature-branch>` (feature indicada no prompt). Depois: `cp -a` do node_modules do checkout principal para o worktree e `node node_modules/husky/bin.js` (sem isso o commit sai com exit 72).
- Node: `export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH` em todo comando (o /usr/bin/node 22 não serve: ABI do better-sqlite3 e G3).
- Testes/builds: `uptime` antes; via `heavy-run --mem 2G -- <cmd>` ou `/build/tmp/hseos-w5/bin/run-in-cgroup.sh <worktree> '<cmd>'` quando o teste precisa de cgroup delegado; um job pesado por vez; nunca a suíte completa (`npm test`); só os arquivos que você tocou e os que os importam.
- Nada em /tmp literal: use $TMPDIR (/build/tmp) e, para arquivos que precisam sobreviver (mensagem de commit), `/build/tmp/hseos-w5/closeout/`.
- G3 SEM FOLGA: nenhum arquivo novo em tools/ (393/393) ou packages/ (137/137); arquivos novos só em test/, docs/, .specs/. Confira com `npm pack --dry-run --json` (npm do Node 24) em toda task que toque tools/ ou packages/. O gate é test/test-package-surface.js.
- Cobertura 90/80 por arquivo do kernel (.c8-kernel.json). NUNCA afrouxe gate, limiar, assert ou teste; nunca pule/apague teste. Bloqueio = BLOCKED com causa, nunca PASS. Se a task depender de decisão do owner (contrato público, retenção de dados, gate), PARE e reporte BLOCKED.
- Git: sem `git stash`, sem `--no-verify`, sem sudo, sem push, sem PR (o Commander abre). Mensagem de commit sem menção a IA e sem Co-Authored-By; assunto ≤ 100 caracteres; Prettier nos arquivos staged. Commit direto com `git commit -F <arquivo>` DENTRO do cgroup: `NO_ADD=1 /build/tmp/hseos-w5/bin/commit-in-cgroup.sh` (ou `run-in-cgroup.sh <worktree> 'git commit -F ...'`). 1 task = 1 commit em `task/<task-id>`.
- Testes vermelhos primeiro (prove a falha pelo motivo certo), depois o conserto; prove cada teste novo por mutação quando a task disser. `eslint --max-warnings=0` e prettier nos tocados.
- Não toque no banco real (`.hseos/state/project.db`), em credenciais, em `~/.config`, `~/.codex` ou `~/.claude`.

- NUNCA mate processos por padrão amplo (`pkill -f`, `killall`, `pgrep | xargs kill` por nome): a máquina é compartilhada com outros agentes e sessões (testes, heavy-run, serviços). Para abortar uma rodada sua, mate APENAS o PID que VOCÊ iniciou (guarde o `$!` ou use o grupo de processos do seu job) e confirme com `ps` que o alvo é seu antes de matar.

## NO SILENT IDLE
- Nunca termine um turno dizendo "aguardando". Rode comandos longos em primeiro plano, em blocos de no máximo 540 s.
- Termine o turno final com exatamente uma última linha:
  `LIVENESS: {"state":"DONE"|"BLOCKED"|"FAILED"|"WAITING_ON","reason":"...","evidence":"<hash|path>"}`
- `BLOCKED` só para impedimento real, com a causa em `reason`.

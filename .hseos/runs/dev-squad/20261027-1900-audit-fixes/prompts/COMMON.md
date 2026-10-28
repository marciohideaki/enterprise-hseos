# Regras comuns (dev-squad audit-fixes 2026-10-27) — leia antes de agir

- Português (BR). Você é executor Sonnet do squad; o Commander decide escopo. Projeto com .axon/: para explorar código use mcp__axon__* via ToolSearch (`select:mcp__axon__get_context_capsule,mcp__axon__get_skeleton`), começando por `get_context_capsule`; se falhar, Read e `BYPASS_AXON=1 rg`.
- Seu worktree já existe (indicado no prompt), em `task/<task-id>`, a partir da feature da onda. Trabalhe SOMENTE nele. Ele já tem `node_modules` (Node 24) e hooks do husky. Não toque no checkout principal nem em outros worktrees.
- Node: `export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH` em todo comando (o /usr/bin/node 22 não serve: ABI do better-sqlite3).
- Testes: `uptime` antes; via `heavy-run --mem 2G -- <cmd>` ou, quando o teste precisa de cgroup delegado, `/build/tmp/hseos-w5/bin/run-in-cgroup.sh <worktree> '<cmd>'`. Um job pesado por vez. NUNCA a suíte completa (`npm test`) nem `npm run` de grupos grandes na raiz; só os arquivos que você tocou e os que os importam (`node --test --test-concurrency=1 <arquivos>`).
- Nada em /tmp literal: use $TMPDIR (/build/tmp). Mensagem de commit em `/build/tmp/audit-fixes/<task-id>.msg`.
- G3 SEM FOLGA: nenhum arquivo novo em tools/ (393/393) ou packages/ (137/137); arquivos novos só em test/, docs/, .github/. Rode `node --test test/test-package-surface.js` se tocar tools/ ou packages/.
- Cobertura 90/80 por arquivo do kernel (.c8-kernel.json): se tocar arquivo incluído, rode o c8 dele (`npx c8 --config .c8-kernel.json --check-coverage=false node --test <testes>` e confira o arquivo) e mantenha ≥90/80. NUNCA afrouxe gate, limiar, assert ou teste; nunca pule/apague teste. Bloqueio = BLOCKED com causa, nunca PASS. Se a task exigir decisão do owner não prevista no prompt, PARE e reporte WAITING_ON (wake_via commander).
- Testes vermelhos primeiro (prove a falha pelo motivo certo, registre a saída), depois o conserto. Prove por mutação quando o prompt pedir: mutação só em cópia descartável sob $TMPDIR, nunca no worktree; remova a cópia.
- `npx eslint --max-warnings=0 <arquivos>` (se o rtk distorcer, `rtk proxy npx eslint ...`) e `npx prettier --check <arquivos>` (corrija com --write) nos tocados.
- Git: sem `git stash`, sem `--no-verify`, sem sudo, sem push, sem PR, sem merge. 1 task = 1 commit em `task/<task-id>`. Commit com `NO_ADD=1 /build/tmp/hseos-w5/bin/commit-in-cgroup.sh <worktree> /build/tmp/audit-fixes/<task-id>.msg` depois de `git -C <worktree> add <arquivos>` explícitos (o hook pre-commit roda dentro do cgroup). Formato `<type>(<scope>): <resumo>` ≤ 100 caracteres. PROIBIDO na mensagem: `Co-Authored-By`, menção a IA/assistente/modelo/fornecedor (Claude, Anthropic, GPT, Codex como autor, Copilot, LLM, "Generated with").
- Não toque no banco real (`.hseos/state/project.db`), em credenciais, em `~/.config`, `~/.codex`, `~/.claude`, `~/.local/state/hseos`.
- NUNCA mate processos por padrão amplo (`pkill -f`, `killall`, `pgrep | xargs kill`). Só o PID que VOCÊ iniciou, conferido com `ps`.
- Relatório final (vai para o Commander e para o revisor no confronto): o que mudou (arquivo:linha), testes vermelhos antes/verdes depois com contagem e exit LITERAIS, mutações e resultado, SHA do commit, o que ficou de fora e por quê.

## NO SILENT IDLE
- Nunca termine um turno dizendo "aguardando". Rode comandos longos em primeiro plano, em blocos de no máximo 540 s.
- Termine o turno final com exatamente uma última linha:
  `LIVENESS: {"state":"DONE"|"BLOCKED"|"FAILED"|"WAITING_ON","reason":"...","evidence":"<hash|path>"}`
- `BLOCKED` só para impedimento real, com a causa em `reason`. Esperar decisão do Commander/humano é `WAITING_ON` com `"waiting_on":{"condition":"...","wake_via":"commander","deadline_at":"<ISO-8601 via date -u, até 4 h>"}`.

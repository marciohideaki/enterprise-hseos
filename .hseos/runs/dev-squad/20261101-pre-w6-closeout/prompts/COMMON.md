# Regras comuns (dev-squad pre-w6-closeout 2026-11-01) — leia antes de agir

- Português (BR). Você é executor Sonnet do squad; o Commander decide escopo. Projeto com .axon/: para explorar código use mcp__axon__* via ToolSearch (`select:mcp__axon__get_context_capsule,mcp__axon__get_skeleton`); se falhar, Read e `BYPASS_AXON=1 rg`.
- Seu worktree já existe (indicado no prompt), em `task/<task-id>`, a partir da feature da onda. Se faltar `node_modules`, rode `heavy-run --mem 4G -- npm ci --no-audit --no-fund` com Node 24 no PATH. Trabalhe SOMENTE nele. Verify do CI: `node .github/scripts/ci-test-shards.mjs verify --shards 6` (obrigatório se criar arquivo de teste: todo teste novo precisa estar num script da suíte).
- Node: `export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH` em todo comando.
- Testes: em primeiro plano, `timeout 540 /build/tmp/pre-w6/bin/cg.sh <worktree> 'node --test --test-concurrency=1 <arquivos>'` (cgroup delegado; exit 75 = host não normal: espere 60 s em primeiro plano e repita). NUNCA a suíte completa (`npm test`) nem `npm run` de grupos grandes; só os arquivos tocados e os que os importam. `test-campaign-evidence.js` e `test-provider-campaign-*` só no cgroup.
- Nada em /tmp literal: use $TMPDIR (/build/tmp). Mensagem de commit em `/build/tmp/pre-w6/<task-id>.msg`.
- G3 SEM FOLGA: nenhum arquivo novo em tools/ (393/393) ou packages/ (137/137); arquivos novos só em test/, docs/, .github/, .enterprise/.specs/decisions/. Rode `node --test test/test-package-surface.js` se tocar tools/ ou packages/ ou adicionar arquivo.
- Cobertura 90/80 por arquivo do kernel (.c8-kernel.json): se tocar arquivo incluído, meça e mantenha ≥90/80. NUNCA afrouxe gate, limiar, assert ou teste; nunca pule/apague teste. Bloqueio = BLOCKED com causa, nunca PASS. Se a task exigir decisão do owner não prevista, PARE e reporte WAITING_ON (wake_via commander).
- Teste vermelho primeiro, depois o conserto. Mutação só em cópia descartável sob $TMPDIR (removida ao fim).
- `node_modules/.bin/eslint --max-warnings=0 <arquivos>` (NUNCA `npx eslint`, que resolve uma v6) e `node_modules/.bin/prettier --check <arquivos>`. Use `rtk proxy git diff` para ver/salvar diffs completos (o `rtk git diff` condensa).
- Git: sem stash, sem `--no-verify`, sem push/PR/merge. 1 task = 1 commit: depois de `git add` explícito, `timeout 540 /build/tmp/pre-w6/bin/cg.sh <worktree> 'git commit -q -F /build/tmp/pre-w6/<task-id>.msg'` (amend em correção: `git commit -q --amend -F ...`). Formato `<type>(<scope>): <resumo>` ≤ 100 chars. PROIBIDO: `Co-Authored-By` e menção a IA/assistente/modelo/fornecedor.
- Não toque no banco real (`.hseos/state/project.db`), credenciais, `~/.config`, `~/.codex`, `~/.claude`, `~/.local/state/hseos`.
- NUNCA mate processos por padrão amplo. Só o PID que VOCÊ iniciou, conferido com `ps`.
- Relatório final: o que mudou (arquivo:linha), vermelho/verde com contagem e exit LITERAIS, mutações, SHA do commit, o que ficou de fora.

## NO SILENT IDLE
- Nunca termine um turno "aguardando". Comandos longos em primeiro plano, blocos ≤540 s.
- Última linha: `LIVENESS: {"state":"DONE"|"BLOCKED"|"FAILED"|"WAITING_ON","reason":"...","evidence":"<hash|path>"}`; WAITING_ON com `"waiting_on":{"condition":"...","wake_via":"commander","deadline_at":"<ISO-8601 via date -u, até 4 h>"}`.

## Neutralidade de documentação (gate `test-documentation-neutrality.js`)
- Relatórios, logs e docs desta run NÃO podem citar fornecedores restritos pelo nome, como o provedor do binding ACP de terceiro. Escreva "binding ACP de terceiro" ou o nome do arquivo genérico (`*-acp*.example.yaml`).
- O gate varre também os arquivos não rastreados do diretório da run, então um log seu com o nome bloqueia o commit de outro executor.

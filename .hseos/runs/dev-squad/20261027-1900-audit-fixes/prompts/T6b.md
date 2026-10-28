# T6b — Swarm: escopo por fd em mkdir/readdir e o falso verde do teste de escopo (achados A-08, A-10)

Leia primeiro e siga: /workspace/github/marciohideaki/enterprise-hseos/.hseos/runs/dev-squad/20261027-1900-audit-fixes/prompts/COMMON.md
Worktree: /workspace/github/marciohideaki/enterprise-hseos/.worktrees/audit-t6b-swarm (branch task/audit-t6b-swarm, feature feature/audit-fix-w3). Task id: audit-t6b-swarm. Tier: medium (segurança de escopo). G3: só edições em arquivos existentes de tools/.

Testes: rode cada um em primeiro plano com `timeout 540 /build/tmp/audit-fixes/bin/cg.sh <worktree> '<comando>'`. Se sair com 75, o host não está normal: espere 60 s em primeiro plano e repita. Commit: faça `git add` explícito e depois `timeout 540 /build/tmp/audit-fixes/bin/cg.sh <worktree> 'git commit -q -F /build/tmp/audit-fixes/audit-t6b-swarm.msg'`. ESLint via `node_modules/.bin/eslint`.

## A-08: falso verde
`test/test-mcp-hseos-swarm-scope.js` é um runner próprio que imprime `N passed, M failed`.

O bloco governado (:466-483) chama `await waitForPort(child)` em :474. O `finally` em :480-483 faz `child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r))`. Se o filho já morreu no boot, o evento `exit` não dispara de novo e a promessa fica pendente. O event loop esvazia e o processo sai com 0 sem linha de contagem. Isso foi reproduzido carregando `better-sqlite3` de outra ABI. O bloco legado (:668-671) tem o mesmo padrão. `waitForPort` está em :32-47.

**Entrega:**
- Só aguarde `exit` se `child.exitCode === null && child.signalCode === null`. Alternativa equivalente: criar a promessa de `exit` antes do `try`.
- Garanta que falha de boot reprova o arquivo com exit 1 e mensagem.
- Revise o mesmo padrão em `test/test-mcp-hseos-swarm.js` (~:52 e ~:201) e corrija se aplicável.
- Prove com um teste ou um harness: rode o arquivo com o servidor forçado a morrer no boot. Por exemplo, numa cópia descartável, faça `tools/mcp-hseos-swarm/index.js` lançar no início, ou use uma variável de ambiente que o teste já suporte. O resultado tem que ser exit ≠ 0. Antes da correção, o mesmo cenário saía com 0.

## A-10: mkdir e readdir por caminho
Em `tools/mcp-hseos-swarm/lib/run-scope.js`:
- `openContained` (:117-146) abre o diretório pai com `O_DIRECTORY|O_NOFOLLOW`, valida o realpath de `/proc/self/fd/<fd>` com `isInside` e abre o arquivo relativo ao fd.
- `readContained` (:149) e `writeContained` (:167) usam esse mecanismo.
- O gancho de teste é `hooks.afterCheck` (:95). Os exports estão em :178-188.

Ainda por caminho:
- `tools/mcp-hseos-swarm/tools/plan_squad.js:61` e `consolidate_handoff.js:64`: `fs.mkdirSync(runDir, { recursive: true })`, logo depois de `resolveRunDir`.
- `get_run_state.js:27`: `fs.readdirSync(runDir)`, com `existsSync` em :21.
- `list_runs.js:21-23`: `readdirSync(RUNS_DIR)` e `statSync(assertFileInside(...))`.

**Entrega:**
- `mkdirContained(base, dir)`:
  - abra o ancestral existente mais profundo com `O_DIRECTORY|O_NOFOLLOW`;
  - valide o realpath do fd dentro de `base`;
  - crie cada componente restante via `fs.mkdirSync('/proc/self/fd/<fd>/<nome>')`;
  - reabra cada novo componente com `O_NOFOLLOW` e revalide;
  - chame `hooks.afterCheck` no mesmo ponto lógico que `openContained`, para que os testes de troca de ancestral o alcancem;
  - feche todos os fds, inclusive em erro.
- `readdirContained(base, dir)`: abre o diretório pelo fd, valida e lista via `/proc/self/fd/<fd>`.
- Use os dois nos quatro sites. Para o `statSync` de `list_runs`, use `fs.fstatSync` do fd do arquivo aberto contido, ou `lstat` relativo ao fd do diretório via `/proc/self/fd`.
- Fora do Linux, onde não há `/proc/self/fd`, mantenha o comportamento atual por caminho. Declare isso num comentário, como o código já faz.
- Exporte as funções novas.

**Testes** em `test/test-mcp-hseos-swarm-scope.js`, no padrão do caso "ancestor swapped" (~:361), que usa `hooks.afterCheck`:
- "ancestral trocado por symlink durante o mkdir": nada é criado fora do escopo e a recusa é `MCP_SCOPE_DENIED`;
- "diretório trocado por symlink antes do readdir": a recusa não lista o conteúdo externo.

Prove por mutação, em cópia descartável, que voltar ao `mkdirSync` por caminho derruba o teste.

## Critérios de aceite
Verdes, com contagem literal:
- `node test/test-mcp-hseos-swarm-scope.js` (todos os casos, com a linha `N passed, 0 failed`);
- `node test/test-mcp-hseos-swarm.js`;
- `node --test --test-concurrency=1 test/test-mcp-hseos-swarm-scope.js`, que é a forma do CI.

Depois:
- confira se `tools/mcp-hseos-swarm/lib/run-scope.js` está no `.c8-kernel.json`; se estiver, mantenha 90/80 e registre os números;
- `node --test test/test-package-surface.js` verde;
- eslint e prettier limpos.

1 commit: `fix(swarm): create and list run directories through contained descriptors` (≤100 chars). O commit também cobre o teste.

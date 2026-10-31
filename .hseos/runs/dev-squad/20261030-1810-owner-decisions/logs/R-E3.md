# R-E3 — revisão cética de b9f3eb57 (od-e3-n1-install-lock)

Veredito: **PASS-WITH-NOTES** (nenhum FAIL; 1 achado MEDIUM de cobertura da decisão N-1 e 2 lacunas de teste).

## Achados
1. MEDIUM — `redactPaths` vaza parte do caminho quando há espaço (tools/lib/mcp-transport.js:67). Repro (regex copiada, node):
   - `db at "/home/my user/x/state.db"` -> `"<path> user/x/state.db"` (vaza `user/x/state.db`)
   - `C:\Users\a b\x.db` -> `<path> b\x.db`; `"C:\Program Files\x\y.db"` -> NÃO redigido (vaza inteiro)
   - `\\server\share\x.db` (UNC) -> NÃO redigido
   - `/etc` (1 componente) não redigido (conforme spec, aceitável); `~/x/y` -> `~<path>` (aceitável).
   - Efeito colateral: URLs `http://host/a/b` viram `http:<path>`.
   A decisão N-1 diz "nenhuma mensagem leva caminho absoluto"; caminhos com espaço (ex.: `Program Files`, home com espaço) violam. Hoje o único emissor (operational-state-db) usa caminho do projeto, sem aspas; o risco é latente.
2. LOW — teste não cobre concorrência no mesmo processo: mutação M3 (reentrância global por processo via Set em `global`) sobrevive aos 23 testes de test-install-lock.js. O código real está correto (ver item 2), mas a regressão não é detectada.
3. LOW — liberação no evento `exit` não tem teste: mutação M4 (remover `process.once('exit', release)`) sobrevive a 23/23. O comportamento real está correto (ver item 3).
4. INFO — `uninstall`: `getStatus` e os prompts rodam antes do lock (TOCTOU/espera antes de recusar); recusa só aparece depois da confirmação. Sem corrupção, só UX.
5. INFO — contagem "32/32 + 30 passed": test-install-lock.js dá 23 tests; 30 do robustness confere; 32 não reproduzido como número único (provável soma de arquivos). Sem impacto.

## Itens
1. redactPaths: PASS-WITH-NOTES. POSIX e `X:\` ok; `file:///` ok; `../..` relativo preservado; `Unknown tool: ghost_tool`, `a/b/c` em run id, `MCP_SCOPE_DENIED: Path escapes allowed directory`, `and/or`, `1/2` intactos. stderr recebe o original (teste + código). Falhas: achado 1. Testes autorais existentes passam sem asserção alterada (diff só adiciona).
2. Reentrância: PASS. Sonda (`probe.js`, 2 Installers e mesma instância via Promise.all): 1 fulfilled + 1 `EHSEOS_INSTALL_LOCKED`, maxConcurrent=1; M3 dá maxConcurrent=2. Reentrância aninhada (a->b) retorna `reent`; sem resto no diretório.
3. Exit: PASS. `process.exit(3)` durante o trabalho remove o lock; com lock substituído por pid=1 durante o trabalho, o exit NÃO o apaga (checa pid === process.pid). Listener removido no finally.
4. uninstall: PASS. Lock em projectDir (fora de `.hseos/`), liberado antes de `process.exit(0)`; teste "uninstall alone" confirma zero resto; recusa com holder vivo: exit 75, `.hseos` e lock do holder intactos (teste verde).
5. init interativo abandonado: PASS-WITH-NOTES (LOW). SIGINT/SIGTERM/SIGHUP liberam; Ctrl-C/cancel do clack via process.exit libera pelo `exit`; terminal fechado (SIGHUP) libera; kill -9/queda -> pid morto, takeover cobre. Ctrl-Z (SIGTSTP) mantém o processo vivo: lock preso até `fg`/kill, e a mensagem de recusa indica remover o lock manualmente — é o comportamento esperado de holder vivo, severidade LOW. Os prompts do próprio init rodam antes do lock; só os do install ficam sob lock.
6. Mutações (cópia sob /build/tmp/rev-e3/): M1 redact só POSIX -> teste novo falha (29/1); M2 redact no-op -> falha (29/1); M3 reentrância global -> sobrevive (achado 2); M4 sem listener exit -> sobrevive (achado 3).
7. Verdes via cg.sh: test-install-lock 23/23; test-init-command 9/9; install-non-interactive 3/3; install-upgrade-path 16/16; mcp-transport-robustness 30/0; mcp-contract 1/1; smoke-install-emit 26/0; package-surface (G3) 1/1.
8. c8 mcp-transport.js: 98.81 stmts / 94.5 branch / 100 funcs (>=90/80). eslint OK; prettier OK. Mensagem do commit sem atribuição de IA (0 ocorrências).

## Confronto (alegações do executor)
- Sanitização no clientMessage, original no stderr: CONFIRMADA (com ressalva do achado 1).
- Reentrância por AsyncLocalStorage: CONFIRMADA (sonda), NÃO coberta por teste (achado 2).
- Liberação em exit: CONFIRMADA (sonda), NÃO coberta por teste (achado 3).
- init com lock antes dos prompts do install: CONFIRMADA (init.js:85-97).
- 32/32 + 30 passed: 30 confirmado; 23+9 etc. plausível, não verificado como "32".
- 3 mutações mortas: REFUTADA em parte — as 2 de sanitização/lock em uninstall/init morrem; M3 (reentrância) e M4 (exit) sobrevivem; confirmar quais 3 o executor usou.
- Sem vermelho prévio: sem evidência contrária; o teste de MCP falha sem a implementação (M2).

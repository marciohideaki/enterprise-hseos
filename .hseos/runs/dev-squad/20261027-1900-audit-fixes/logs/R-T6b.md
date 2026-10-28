# R-T6b — revisão cética (commit 2bde7a88, base f96c6e9c; HEAD confirmado = 2bde7a88)

Veredito: PASS-WITH-NOTES

## Itens
1. mkdirContained/TOCTOU: OK. Cada componente é criado via /proc/self/fd/<fd>/<nome>, reaberto com O_DIRECTORY|O_NOFOLLOW e revalidado. Executado: `a/lnk/x/y` (lnk -> fora) = MCP_SCOPE_DENIED e nada criado fora; `inlnk/x` (symlink para dentro) = DENIED; `dang/x` (dangling) = DENIED; `a/n1/n2` = OK. EEXIST em componente symlink cai no open O_NOFOLLOW (ELOOP -> DENIED). fds: 100 chamadas (OK e erro) deixaram /proc/self/fd em 21 -> 21 (sem vazamento).
2. Base projectRoot(): aceitável com ressalva (N2).
3. readdirContained/list_runs: symlinks continuam excluídos (Dirent de symlink: isDirectory() = false; antes assertFileInside também rejeitava symlink). Teste "swapped before readdir" verde.
4. Boot morto (preload `--require /build/tmp/rev-t6b/die.js` que lança em tools/mcp-hseos-swarm/index.js): HEAD `node test/...scope.js` rc=1 com `fatal: server exited (1)`; `node --test` rc=1 (fail 1). Base f96c6e9c, mesmo cenário: rc=0 (reproduz A-08). test-mcp-hseos-swarm.js já rejeita no `exit` precoce (:52); não precisava de mudança.
5. Mutações (cópia /build/tmp/rev-t6b/mut): M4 mkdirSync(dir,{recursive}) por caminho -> 1 falha (derruba). M5 remover assertFdInside do ancestral inicial -> 1 falha (derruba). SOBREVIVERAM: M1 (remover assertFdInside por componente), M2 (readdir por caminho após validar o fd), M3 (mkdir de cada componente por caminho em vez de via fd). Ver N1.
6. Nenhuma asserção alterada: as únicas linhas removidas do teste são as duas `child.kill; await once('exit')` substituídas por stopChild.
7. Verdes: scope.js 29 passed, 0 failed (rc 0); swarm.js 6 passed, 0 failed; `node --test --test-concurrency=1 scope.js` pass 1 fail 0; transport-robustness 28 passed, 0 failed; package-surface pass 1 fail 0.
8. c8 (só o teste scope, --check-coverage=false): run-scope.js 95.92 stmts / 88.76 branch / 100 funcs / 95.92 lines; está no .c8-kernel.json:59 (90/80). Não rodei o test:kernel-coverage completo.
9. eslint rc 0; prettier "All matched files use Prettier code style"; mensagem do commit sem menção a IA/Co-Authored-By (grep = 0).

## Achados
- N1 (baixa, cobertura): tools/mcp-hseos-swarm/lib/run-scope.js:224-233 (laço por componente). Os testes só trocam o ancestral em `hooks.afterCheck`, antes do open do fd. Uma troca entre a criação de um componente e o reabrir, ou a revalidação por componente, não é exercida; M1/M3 sobrevivem. A proteção real existe (O_NOFOLLOW + fd), mas a alegação "reabre e revalida cada componente" não é provada por teste. Sugestão: segundo ponto de hook dentro do laço. M2 é equivalente (sem hook entre open e read).
- N2 (baixa): base = projectRoot() amplia a janela: uma troca de `.hseos/runs/dev-squad` (ou `.hseos`) por symlink para outro diretório dentro do projeto não é detectada pelo mkdir (só falha se sair do projeto). Antes não havia nenhuma proteção; aceitável, mas vale registrar.
- N3 (info): run-scope.js:195-196, 207-209, 228-229 sem cobertura (ramos de erro).

## Alegação -> veredito
| Alegação | Veredito |
|---|---|
| stopChild só aguarda exit se vivo, promessa antes do kill | confirmada |
| boot quebrado: antes 0 sem contagem, depois 1 com fatal | confirmada (base rc=0, HEAD rc=1) |
| test-mcp-hseos-swarm.js já tratava boot quebrado | confirmada |
| mkdir/readdir por fd, afterCheck, fallback declarado | confirmada |
| aplicado nos 4 sites; list_runs com isDirectory | confirmada |
| base mkdir = projectRoot, resolveRunDir restringe antes | confirmada (ver N2) |
| mutação para mkdir por caminho: 28/1 | confirmada (M4 reproduzida, 28 passed 1 failed) |
| red 27/2 | NOT VERIFIED (não reconstruí o estado pré-correção do código com os testes novos) |
| 29/29, 6/6, node --test 29/29, package-surface | confirmadas |
| c8 95,92/88,76/100 | confirmada |

## Não verificado
Estado vermelho 27/2; test:kernel-coverage completo; comportamento fora do Linux; deleção do /build/tmp/rev-t6b feita ao fim.

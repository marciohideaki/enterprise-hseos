# R-T1 — revisão cética de T1 (commit f38d0c37, base f96c6e9c)

HEAD do worktree == f38d0c37 durante toda a revisão (sem REVIEW_TARGET_MOVED).

## Veredito: PASS-WITH-NOTES

## Achados
| # | Sev | Onde | Descrição / reprodução |
|---|-----|------|------------------------|
| 1 | baixa | .github/scripts/ci-test-shards.mjs, `testCoverageProblems` (`text.includes(file)`) | Casamento por substring sem fronteira: `test/test-zz.js` é "referenciado" por um script que cita `test/test-zz.json` (ou `.jsx`, ou `x/test/test-zz.js`). Reprodução em cópia descartável: test-zz.js + test-zz.json rastreados, script `node test/test-zz.json` -> verify sai OK (228 arquivos) em vez de falhar. Falso negativo (under-build), improvável hoje, mas o gate é o ponto da task. Sugestão: casar com fronteira (`(^|[\s'"/])` + path + `(?=[\s'"]|$)`). |
| 2 | info | `NOT_TESTS` (fixtures/helpers/journeys) | Exclusão não exercida por nenhum teste: mutação removendo `fixtures\|helpers` deixa 22/22 verde (e o repo real também, pois os padrões de 3 níveis não casam test/fixtures/pnpm-store/project-sum.test.js). Equivalente à `is_test_file` do shell, só não há prova de que a exclusão é necessária. |
| 3 | info | `expandedSuiteText` | Só segue `npm run <nome>`; `npm test`, `npm run-script`, `pnpm run`, `npm run -s x` não são expandidos (falso positivo "not run", falha alto, nunca silencioso). Aceitável. |

## Verificações (passagem 1)
1. Cadeia: confirmado por script que os 9 arquivos estão em scripts alcançados de `scripts.test` (test:install, test:agent-transitive-isolation, test:engineering-task, test:platform-bindings, test:bound-kernel-agent, test:compiler-hooks). O shard roda tudo em `systemd-run ... Delegate=yes` (ci.yaml, passo "Shard of the tests ... delegated cgroup"), logo os 4 de test:engineering-task rodam no cgroup.
2. Padrões equivalentes a `is_test_file` (quality-gates.sh:202-211): sim. Busca só no texto dos scripts: sim. `git ls-files` ausente (mv .git): falha alto com mensagem, exit 1. Ciclo: guarda `seen`; caso de ciclo coberto pelo teste. Substring: ver achado 1.
3. Verify falha de verdade: cópia com test/test-zz.js no índice -> exit 1, `FAIL not run by any suite step: test/test-zz.js`. No worktree: `OK 102 items (101 + 1 extra) ... 227 test files each run by a suite step`.
4. Allowlist: sem motivo -> throw `needs a reason`; arquivo não rastreado -> problema; já referenciado -> problema; válida dispensa (fixture end-to-end). `{}` entregue.
5. ci.yaml: YAML parseia (pacote `yaml`); primeiro passo do job `test`, `if` e `run` corretos; ao ser o único passo com `if` de plan, no caminho Node 22 com plan ok é pulado. Mutação trocando o `if` derruba o caso do fan-in.
6. Mutações próprias em cópia (22 testes de test-ci-light-hook.js): M1 allowlist ignorada -> 2 falhas; M2 sem "já referenciado" -> 1; M3 sem "não rastreado" -> 1; M4 verify não acrescenta problemas -> 1 (o fixture end-to-end); M5 sem recursão -> 3; M6 passo do ci.yaml neutralizado -> 1. Todas mortas. M7 (remover exclusão de fixtures/helpers) sobrevive (achado 2).
7. Execuções no estado final: test-ci-light-hook.js 22/22; verify --shards 6 OK; test-install-lock 13/13; test-pids-max-single-source 6/6; test-platform-bindings-downgrade 22/22; no cgroup (run-in-cgroup.sh): test-environment-journey + test-toolchain-zip-streaming + agent-core-compile-check.test.js 19/19.
8. Peso 697 (+11): não medi o tempo dos 4 arquivos; coerente em ordem de grandeza com a alegação (+10,4 s), plano continua válido (verify OK).
9. eslint (ci-test-shards.mjs, test-ci-light-hook.js) limpo; prettier limpo em todos os tocados; mensagem do commit sem atribuição de IA nem trailer; nenhum arquivo novo em tools/ ou packages/.

## Alegação -> resultado (passagem 2, logs/T1.md)
| Alegação | Resultado |
|---|---|
| Edições de package.json nos 6 scripts | confirmada |
| Funções novas, falha alto em git ls-files, guarda de ciclo | confirmada |
| Saída `OK ...; 227 test files` | confirmada |
| allowlist `{}` | confirmada |
| Peso 686 -> 697 (+10,4 s medidos) | diff confirmado; medição não verificada |
| ci.yaml: primeiro passo no job test | confirmada |
| test-ci-light-hook: asserção do passo + 3 casos | confirmada |
| Vermelho em HEAD lista exatamente os 9 | não reexecutado (equivalente: os 9 estão agora cobertos e o verify passa) |
| verify com test-zz-unref no índice exit 1 | confirmada (com outro nome) |
| 9 arquivos passam; environment-journey só no cgroup | passam (confirmado); "só no cgroup" não testei fora dele |
| test-ci-light-hook 22/22 | confirmada no estado final (executor não reexecutara; eu sim) |
| Mutação 3(b) | relato truncado; refeita por mim, morta (M1/M4) |

## Não verificado
Peso medido; execução fora do cgroup de environment-journey; shard run real; comportamento do YAML no GitHub Actions (só parse); verify com --shards 8; suites completas dos 6 scripts de grupo.

# Reauditoria cega final do terminal (T11) — run `20261111-terminal-closeout`, 2026-11-11

Auditor independente (subagente isolado, sem o raciocínio dos executores), duas passagens. Worktree auditado: topo da onda TD
(`d5a1ed41`, depois `51acdc27` com a `master` integrada). **NÃO DETERMINÍSTICO** (critério T11): controle compensatório = duas passagens,
confronto com as alegações do Commander e fatos conferidos pela ferramenta. Este documento resume o relatório do auditor; os números são
os que ele copiou das ferramentas.

## Passagem 1 (cega)

| Verificação (fato de ferramenta) | Resultado |
|---|---|
| `test-terminal-readiness.js`, `test-kernel-quality-surface.js`, `test-evolution-trace.js` | 26/26, 14/14, 14/14 |
| Testes novos: governance, terminal-api, budget-concurrency, secret-canary-scan, job-control | 1/1, 9/9, 2/2, 3/3, 13/13 |
| Extras: terminal-control, compaction-resume-fork, provider-egress-broker, mcp-preapproval-refusal | 13/13, 13/13, 9/9, 8/8 |
| `test-package-surface.js`; arquivos em `tools/`, `packages/`, `src/` desde `99a54dcc` | 1/1; nenhum mudou |
| `verify-doc-facts.sh`, neutralidade | rc=0, rc=0 |
| PRs #314, #315, #316 | MERGED (`4c9352c7`, `4a489344`, `a0a09757`) |
| Tags | `hseos-terminal-wa`, `-wb`, `-wc` |
| Atribuição de IA em `99a54dcc..origin/master` | nenhuma (grep rc=1) |
| `status.*` do `requirements.json` desde `99a54dcc` | nenhuma mudança; `operational` `not_authorized` em todas |
| Famílias de W0–W5 | 22 no inventário, 22 no `terminal-readiness.json`, zero divergência |

| # | Passagem 1 | Evidência |
|---|---|---|
| T1 | parcial | Node 22 local inviável (ABI do nativo) e CI da `master` pós-#316 ainda em curso; texto delegava a "ver STATUS" |
| T2–T9, T12 | sustentados | guards, testes, jornadas instaladas, docs |
| T10 | parcial | `result_source` antecipava a PR e a tag da onda TD |

Achados: MAJOR-1 (T10 antecipa fato), MAJOR-2 (T1 sem evidência fechada), MINOR-1 (suíte completa não rodada no topo da TD), MINOR-2 (o gate valida a existência da evidência, não o texto do `result_source`). Notas: a regeneração do ensaio da F14 v4 **não** é afrouxamento (o teste de frescor não mudou e o hash bate); a edição em `test-mcp-hseos-governance.js` reforça o teste; nenhum bloqueio convertido em PASS; nenhuma certificação operacional afirmada.

## Passagem 2 (confronto)

| Alegação do Commander | Resultado |
|---|---|
| A1: suíte no topo `51acdc27`: lint 0; script 40 (`test:capability-intake-guard`, asserção de desempenho relativo em `:1440`, 7,05x contra limite 7x) falhou; arquivo e `tools/` inalterados; cauda 40–115 76/76 exit 0 | confirmada (`td-tail.codes`, `td-suite.log`, `git diff --stat` vazio); "1 de 3 isolado" não reproduzido pelo auditor |
| A2: `test:kernel-coverage` exit 0 | confirmada (`t1.codes`) |
| A3: Node 22 local inviável (`ERR_DLOPEN_FAILED`, 137 vs 127); CI 43137154415 `test (22.x)` success | confirmada |
| A4: CI da `master` `a0a09757`: CI, Core journey e Standalone smoke success | confirmada |

Correções aprovadas: C1 (T1 com cada componente ligado a um resultado de ferramenta e id de run) e C2 (T10 sem afirmar fato futuro). **Veredito do auditor:** com C1 e C2, `TERMINAL_PRONTO_COM_GATES_DECLARADOS` se sustenta; **T11 aprovado sem ressalva impeditiva**. Recomendação: declarar no relatório final a instabilidade de `test-capability-intake-guard.js:1440` como risco e levá-la ao owner (sem afrouxar).

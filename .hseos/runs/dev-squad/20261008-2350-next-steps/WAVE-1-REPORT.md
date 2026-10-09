# WAVE-1-REPORT: 20261008-2350-next-steps

| Tarefa | Status | Commits / artefato | Revisão cética | Correções |
|---|---|---|---|---|
| T1: spike do compilador TS no guard | OK (spike, sem PR) | `3983930b` em `feature/guard-ts-parser-spike` | PASS-WITH-NOTES ([REVIEW-T1.md](REVIEW-T1.md)) | 1 rodada: limite 1473 (exceção do owner), mitigação de FP em fragmentos, cache, testes discriminantes, relatório corrigido |
| T2: grupo c das divergências | OK (somente leitura) | [REPORT-T2.md](REPORT-T2.md) | recontagem independente do Commander: 305 = 103 + 163 + 39 | — |
| T3: superfícies MCP do claude-code | OK | `67b907c9` e `dd2b26cb` em `feature/platform-surfaces-claude-mcp` | PASS-WITH-NOTES | 1 rodada (T3b): teste do settings.json do usuário e CHANGELOG |
| Item 4: snapshot ECP | PENDENTE | — | — | Sem tag `contracts-v*` posterior a 0.4.0 |

## Resultados para decisão do owner

**T1. Recomendação revisada:** adotar com condições, só como opt-in, sem ligar por padrão. A estratégia é a união TS ∪ léxico, nunca TS sozinho.

Medido:
- 0 perdas em 6.036 entradas.
- Fecha os gaps de layout quando o texto parseia.
- +160 ms a frio por chamada do hook.
- 1,7x a 3,5x a quente.
- `typescript` acrescenta 23,6 MB se virar dependência dura.

O que ainda pesa contra:
- 4,0% das janelas de fragmento viram negação nova, mesmo depois da mitigação. A mitigação zerou os FP sem export visto pela master, mas esse residual continua.
- Buracos de CommonJS que nem o TS fecha: `??=`, `module['exports']`, alias de `module`.

Alternativas mais baratas:
- fechar os 2 gaps no scanner léxico;
- analisar o arquivo em disco depois da edição.

**T2.** 0 REAL, 3 CONTEXTUAL, 36 NOISE. Item 2 encerrado sem mudança no repo.

**T3.**
- Teste local do arquivo alterado: 57/57.
- Quality gates completos passaram (via cgroup delegado).
- Pronto para PR (G4).

## Gotchas da wave
- Os quality gates (`worktree-manager.sh validate` e pre-commit) só passam via `systemd-run --user --property=Delegate=yes --property=DelegateSubgroup=tests` + `node .github/scripts/enable-test-cgroup.mjs` + Node 24. Com o node 22 do PATH, `test-kernel-mutations` falha 14/18.
- O harness bloqueia arquivos de relatório gravados por subagente ("Subagents should return findings as text"). O Commander grava os artefatos do run.
- Retornos longos de subagente chegam truncados. Peça o restante via SendMessage antes de consolidar.
- Prompt de subagente precisa de seções explícitas de Objetivo, Contexto e Critério de aceite. O hook `[SPEC CONTRACT]` bloqueia sem elas.
- Executor de spike ficou ~7 h parado esperando a fila do `heavy-run` sem se reavaliar. Cutucar após inatividade.

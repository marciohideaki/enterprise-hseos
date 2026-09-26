# Tasks W2 — sequência isolada

Base imediata: feature/hseos-evolution-w1-engineering. Feature de entrega:
feature/hseos-evolution-w2-terminals. Task: task/hseos-evolution-w2.
Importação sem commit no índice, tree em docs/evolution/w2/evidence/baseline.json.
Não confundir base importada com delta W2. execution_mode=isolated para todas.

| ID  | Escopo / entrada → saída                                                   | Dependência | Verify step / aceite                                                                                   | Estado     |
| --- | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ | ---------- |
| T1  | Medium: executor.js/policy → terminal-executor.js + broker Python + testes | W1          | node --test --test-concurrency=1 test/test-terminal-executor.js; PTY, pipes, limites, descendentes     | verificado |
| T2  | Large: control/task-state → terminal-control.js, budget + testes           | T1          | node --test --test-concurrency=1 test/test-terminal-control.js; CAS, replay, incerteza, cancel/recover | verificado |
| T3  | Medium: HTTP/CLI/SDK → métodos terminal e testes consumidores              | T2          | testes HTTP/SDK, autenticação/cursor, jornadas reais locais                                            | verificado |
| T4  | Medium: fontes/testes → evidências, docs e continuidade                    | T3          | regressão, lint/format, matriz Node22/24 sequencial; hashes vinculados                                 | verificado |

Arquivos adicionais ou mudanças de contrato devem ser registrados no design antes
da implementação. Cada aceite será marcado somente com evidência observada.

Evidência: `docs/evolution/w2/evidence/receipt.json`; matriz sequencial com 914
testes integrais e 440 críticos por versão, gate 90/80 e instalações externas.
Os 24 testes W2 cobrem FR01–FR08; mapa de aceite em `docs/evolution/w2/STATUS.md`.
Modelos reais e ativação operacional não fazem parte do aceite determinístico.

T5 — Revisão funcional autorizada em 2026-09-26 (execution_mode=isolated):
entrada `terminal-attach.js`, testes de terminal e recibo W2; saída correções de
cleanup/entrada, testes e `docs/evolution/w2/REVIEW.md`. Dependência T4; escopo
Medium. Aceite: regressões falham antes/passam depois, matriz integral 22/24,
cobertura 90/80 por arquivo e recibo separado. Estado: verificado;
`docs/evolution/w2/evidence/review/receipt.json`, 917 integrais/443 críticos por
versão e instalações externas aprovadas.

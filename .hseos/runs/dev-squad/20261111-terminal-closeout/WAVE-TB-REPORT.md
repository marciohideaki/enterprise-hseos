# WAVE-TB-REPORT — invariantes do terminal provados por teste

Branch `feature/terminal-closeout-tb` (base `master`; integra a `master` depois do merge da TA para trazer os registros da run).

| Task | Lacuna | Commit | Arquivos | Prova principal |
|---|---|---|---|---|
| TB1 | GM-01 | `9020f4ef` | `test/test-mcp-hseos-governance.js` | boot governado recusa banco não ativado sem depender do banco do host (antigo `32 passed, 1 failed` com banco ativado; novo `33 passed, 0 failed`) |
| TB2 | GM-02 | `aedb9441` | `test/test-terminal-api.js` | input, resize, interrupt, eof e leitura de eventos/estado recusados com 401 sem efeito; mutantes da checagem de credencial mortos |
| TB3 | GM-03 | `5f3518d2`, rodada 2 `3fe35e2f` | `test/test-budget-concurrency.js`, `test/helpers/budget-attempt-process.js`, `package.json` | 6 processos com barreira de largada e disputa observada (`contention > 0`); teto de custo e de requisições nunca excedido |
| TB4 | GM-04 | `26d1fb5d`, rodada 2 `f2a7b4d7` | `test/test-secret-canary-scan.js`, `package.json` | canário injetado pela credencial só aparece no `Authorization`; varredura não cega; eco recusado com causa no ledger; defesa em profundidade observada |
| TB5 | GM-05 | `7b745cbd` | `test/test-job-control.js` | job adiado sobrevive a fechamento e SIGKILL; despacho único e nunca antes do horário |
| TB6 | consequência da TB3/TB4 | `420a23b2` | `docs/evolution/w3/evidence/stab3-f14v4/rehearsal/**` | ensaio fixture da F14 v4 regenerado para o `package.json` atual (hash `d2652177…`); veredito e totais iguais |

Nenhum arquivo de produto (`tools/`, `packages/`, `src/`) mudou. Capacidade do pacote inalterada (testes e evidência fora do `files`).

Achados para o owner: acoplamento do gate de frescor da F14 v4 ao `package.json` (OWNER-GATE); defesa em profundidade broker + supervisor não provada por camada isolada (limite declarado).

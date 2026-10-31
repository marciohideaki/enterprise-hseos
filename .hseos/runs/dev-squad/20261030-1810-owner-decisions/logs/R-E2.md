# R-E2 — revisão cética do commit 1b20a7a6 (od-e2-ci-retry-segments)

Veredito: PASS-WITH-NOTES

## Itens
1. Workflows: PASS. Diff não toca nenhuma linha `name:`; YAML de todos os workflows parseia (`yaml`). `net_retry` testado em bash -e e -eo pipefail: falha final propaga exit 1; sucesso na 3a tentativa devolve 0; 3 tentativas, esperas 10 e 30 s. Nota: o provisionamento (ci.yaml:104) não usa `net_retry`; o retry vive no script (aceito pela spec).
2. provision-toolchain-cache.mjs: PASS. Baseline 0efe5698 repetia hash divergente 3x; agora `PinMismatchError` falha na hora (`not retried`). Tamanho divergente entra em retry (truncamento transitório; justificável, o hash segue obrigatório depois). Backoff 10/30/60 existe em BACKOFF_MS, mas com 3 tentativas só 10 e 30 são usados (o 60 é código morto; a mensagem do commit diz 10 e 30). Guard `import.meta.url` funciona com caminho relativo (execução direta com `relative/dir` chegou em `main` e deu o erro de uso). Também há retry no lookup pypi.
3. describeSegments: PASS. Só `log(...)` adicionado; `{ok:false}`/`{ok:true}` idênticos; item verde não imprime nada (teste cobre). Nota kernel-coverage presente só para esse item. Mutação que inverte o retorno derruba teste.
4. Mutações (cópia em /build/tmp/rev-e2/c): M2 hash retriado, M3 sem backoff, M4 aviso removido, M5 exit invertido, M6 nota removida, M7 apt sem net_retry: todas MORTAS (29/30). M1 (`net_retry` que devolve 0 no fim, engole a falha final) SOBREVIVE (30/30).
5. Execução: test-ci-light-hook.js 30/30 (pass 30, fail 0) via cg.sh; `ci-test-shards verify --shards 6` OK (102 itens, 230 arquivos); eslint sem saída; prettier ok; mensagem do commit sem atribuição de IA.

## Achados
- MÉDIA (lacuna de teste), .github/workflows/*.yaml `net_retry` / test/test-ci-light-hook.js ~linha 436: o teste só confere texto (`net_retry()`, `for delay in 10 30 0`), não executa a função. Mutação `return 1` -> `return 0` no ci.yaml passa 30/30; isso mascararia falha persistente de apt como sucesso. Repro: sed em cópia + o teste. Sugestão: extrair e executar o corpo da função com comando que falha sempre e afirmar exit != 0.
- BAIXA, suite-orphans.mjs describeSegments: se `test:kernel-coverage` falhar por limiar de cobertura (todos os segmentos rodaram), o relatório ainda lista "inside it ... stops at first failing" e a nota; a nota é condicional ("segmentos que não rodaram") então não é falsa, mas pode confundir. Não bloqueante.
- BAIXA: BACKOFF_MS[2]=60000 nunca usado (spec dizia "por exemplo 10, 30, 60"; aceitável).

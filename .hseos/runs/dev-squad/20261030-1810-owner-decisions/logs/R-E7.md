# R-E7 — revisão cética de 6237deac (od-e7-c8-rest)

Veredito: PASS-WITH-NOTES

1. .c8-kernel.json: PASS. Só 6 acréscimos ao include; lines/branches/per-file/check-coverage/exclude/reporter/clean intactos (comparação programática com e6239c2a). Nenhum `c8 ignore` no diff nem nos 6 arquivos-alvo.
2. package.json: PASS. test:kernel só acrescenta 8 testes (5 existentes + 3 novos), nada removido. `ci-test-shards.mjs verify --shards 6`: OK (102 itens, 233 arquivos). Peso 680 -> 920: coerente com +8 arquivos (~+35%); NÃO verificado contra tempo medido do kernel-coverage completo (não rodado, por restrição).
3. Testes novos: PASS. Amostra de 12+ casos (catalog: refusals por regex de mensagem, readYaml/parseCsv, install path inseguro; sdk: mensagens de AdapterBase, listas `missing` exatas; entrypoints: erro tipado + mensagem com path, catálogo duplicado/vazio) afirmam mensagem/estado reais. Stub de fs.readdirSync restaurado em finally, e o teste reafirma o catálogo real depois. Temporários via os.tmpdir() (TMPDIR=/build/tmp), removidos em finally; sem /tmp literal.
4. Mutações (cópia em /build/tmp/rev-e7, removida): (a) desligar checagem de catálogo duplicado/vazio em native-mcp-adapters.js -> refusals 1 falha; (b) remover `path.win32.isAbsolute` em capability-catalog.js -> validation 1 falha; (c) AdapterBase.id deixar de lançar -> sdk-contract 2 falhas. Todas mortas.
5. c8 (seleção de 10 testes, 193 pass/0 fail, exit 0), linhas/branches: native-mcp-adapters 100/100; entrypoint-adapters 100/100; model-providers/index.js 100/100; runtime-providers/index.js 100/100; adapter-sdk/index.js 100/100; capability-catalog.js 100/95.01. Confirma as alegações do executor.
6. Isolados e com --test-concurrency=1: 17/7/97 pass, 0 fail. eslint 0; prettier ok (incl. json); G3 test-package-surface pass. Mensagem de commit sem atribuição de IA; worktree limpo.

Notas (baixas):
- test/test-governed-entrypoints-refusals.js:225 — o título "is appended to the catalog" contradiz a asserção (extra.probe NÃO aparece em catalog.swarm). O teste é válido (imutabilidade/cópia), mas o título engana.
- Branches de capability-catalog 95.01 (acima do limiar 80); não há ramo exigido faltando.
- Alegação "kernel-coverage definitivo exit 0, 1224 testes no 1º segmento": NÃO confirmada nem refutada (test:kernel completo não foi executado aqui; só a seleção). Os 6 arquivos individualmente passam 90/80 com folga.

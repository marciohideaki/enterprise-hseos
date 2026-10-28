# R-T2 — revisão cética de 770964e4 (audit-t2-mutgates)

Alvo: 770964e4 (HEAD confirmado, base f96c6e9c). Veredito: PASS-WITH-NOTES.

## Achados
| Sev | Onde | Achado |
|---|---|---|
| Baixa | check-w4-mutations.js / check-w5-mutations.js (`checkTap`) | Mutação nos checkers: remover `['fail','0']` ou `['pass',expected]` sobrevive aos testes novos (cada caso de teste varia `pass` junto com `fail`, então a outra checagem cobre). Falta um caso `tests=n, pass=n, fail=1` e um `pass=n-1` isolado. Remover `skipped`/`todo`, alterar EXPECTED derrubam testes (mortos). |
| Baixa | `checkTap` | Usa só a primeira ocorrência de cada linha: `# tests 20` seguido de `# tests 1` é aceito. Não é regressão (o checker antigo usava `.test()` de regex, igualmente permissivo). Subteste indentado não engana (âncora `^#`). O `main` ainda exige exit 0 do processo. |
| Info | test/fixtures/*.cjs | Fora do eslint por `ignores: test/fixtures/**` na eslint.config.mjs (regra pré-existente do repo); eslint emite só 2 warnings "file ignored". Prettier cobre e passou. Aceitável. |
| Info | checkTap duplicado nos 2 checkers | Escolha declarada (G3: módulo em scripts/ iria ao tarball). Aceitável. |

## Verificações
1. Tabelas: reconstruí os arrays originais de f96c6e9c (fatiando o fonte) e comparei por `assert.deepStrictEqual` com os módulos novos: idênticos (W5 43, W4 20; ids, ordem, regex, templates, opções).
2. Títulos: o código de geração dos testes não mudou (diff só troca a definição por `require`). W4 rodou inteiro no cgroup: 20/20 com os mesmos títulos. W5: 4 mutantes + teste de grupo passaram; checker W5 completo rodou: `43 mutants rejected`, EXIT=0.
3. checkTap adversarial: duplicata com a primeira ruim reprova; indentado sem linha de topo reprova; zeros à esquerda reprovam; vazio/indefinido reprova. Aceitos (ver achados): duplicata com primeira boa.
4. Esperado sem circularidade: vem de `cases.length` / `MUTANTS.length + 1`, não da saída do teste. OK.
5. Os 4 testes novos: mutações próprias em cópia descartável (removida) mataram skipped, todo e EXPECTED=99 nos dois checkers (ver achado de sobreviventes).
6. `check-w4-mutations.js` no cgroup: "W4 mutation matrix: 20 rejected", exit 0.
7. Lint: coberto acima.
8. verify --shards 6: OK 102 itens. G3 (test-package-surface): 1/1. quality-surface 7/7. eslint e prettier limpos. Commit sem menção a IA. Nenhum arquivo em evidence/ tocado. rg por contagens vivas (fora de evidence): só as mensagens dos próprios checkers.

## Alegações do executor
| Alegação | Resultado |
|---|---|
| Tabelas idênticas em ids/ordem | Confirmada (e também conteúdo completo) |
| EXPECTED 20 / 44 derivados | Confirmada |
| Checkers saem 0 no cgroup (W4 20, W5 43) | Confirmada (reexecutei ambos) |
| quality-surface 7/7 | Confirmada |
| Mutação de `skipped` derruba 1 teste | Confirmada |
| eslint limpo, .cjs ignorados | Confirmada (warnings de arquivo ignorado) |
| verify OK | Confirmada |
| Sem texto vivo a atualizar | Confirmada |
| Comparação TAP antes/depois não feita | Confirmado que não foi; supri com deepStrictEqual das tabelas + código de geração inalterado |

## Não verificado
c8/`test:kernel` com cobertura; execução dos 43 mutantes W5 individualmente além do checker completo; `HEAD` do worktree não mudou durante a revisão.

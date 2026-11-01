# R-A6 — Revisão cética de A6 (A-20, commit c28f061a)

Veredito: APROVADO COM RESSALVAS (nenhum bloqueio; 3 achados menores).

## Passagem 1 (cega)
Fidelidade (6 amostras: W3-FR05, W3-FR07-CURRENT, W3-F08, W4-FR04, W4-FR05, W4-REAL-CODEX):
- Texto da promessa presente na linha citada em todas (spec.md:31/33 e :25, CLOSEOUT.md:13, requirements.json:196, STATUS.md:546). Requisitos coerentes com requirements.json (F12-R1, F18-R1, F08-R1). Status coerentes com STATUS/CLOSEOUT (W4-REAL-CODEX partial: um dos dois despachos teve recibo rejeitado; W3-FR07-FOURTH e W4-FOURTH not_delivered, tests []).
- Cobertura: W3 FR01-FR08 e W4 FR01-FR08 do spec presentes, mais itens de CLOSEOUT/STATUS. Nenhuma promessa entregue omitida encontrada. Nenhum vínculo inventado: nomes de teste existem.

Achados:
- M1 (menor): W4-FR04 ("DAG rejeita ciclos") cita o teste "two controllers race for one revision and cancellation wins..." que NÃO exercita ciclos. O teste de ciclo existe: test-workflow-expansion.js:114 (variante 'cycle') e test-engineering-workflow-runtime.js:49 ("workflow validation rejects cycles..."). O segundo arquivo é citado sem nome; o nome citado sustenta outra parte do FR04 (descendentes/pai). Vínculo parcialmente fraco, não falso.
- M2 (menor): a checagem de nome de teste é substring no arquivo inteiro (`includes`), não nome de `test(...)`. Um nome que só aparece em comentário/string passaria. Fraqueza aceitável, mas vale declarar.
- M3 (menor): W3-F08 usa requirements.json:196 (campo acceptance) como "promessa" de W3; não é linha de STATUS/PLAN. Aceitável como f08 parcial, mas a fonte é atípica.

Guard (test/test-evolution-trace.js): schema estrito (chaves, id único, source arquivo:linha, status, evidência obrigatória para delivered/partial), linha citada, requisitos, arquivos/nomes de teste, recibos; caminhos confinados à raiz. Registrado: `verify --shards 6` OK, 103 itens (executor disse 235 arquivos; agora 236, diferença só de contagem).
- SHAs só com formato: aceitável aqui. Nenhum dos dois TRACE contém evidência `commit` (verifiquei: zero), então o ponto fraco declarado é hoje inócuo. Se algum dia entrarem SHAs, vale `git cat-file -e` com fallback para clone raso. Mutação (f) confirma que SHA falso `deadbeef` passa.

Mutações (cópia via git archive em /build/tmp/rev-a6, removida):
- (a) linha errada: derrubou. (b) requisito F99-R9: derrubou. (c) recibo inexistente: derrubou. Extras: (d) nome de teste inexistente derrubou; (e) delivered sem evidência derrubou; (f) SHA falso passou (esperado, ver acima).

Execução (cg.sh, Node 24): guard 10/10; documentation-neutrality 2/2; verify OK; eslint limpo; prettier limpo (TRACEs, MAPA, package.json, teste). Sem atribuição de IA na mensagem do commit. package.json: script test:evolution-trace + encadeado em test. MAPA §8 A-20 atualizado (a tabela foi reformatada em largura de coluna, ruído de diff pelo prettier).

## Passagem 2 (confronto com logs/A6.md)
Alegações confirmadas: 12+12 entradas, guard 10 testes, verde/vermelho, mutação, verify OK, SHAs só formato, FOURTH not_delivered. Divergência trivial: 235 vs 236 arquivos. Não alegado pelo executor: M1 e M2.

Nota: gravei por engano um arquivo em /tmp/x durante a mutação (cp); removido na hora.

## Reconferência rodada 1 (8d902e5d, amend de c28f061a)
Veredito: APROVADO. M1 e M2 resolvidos; SHAs alcançáveis.
- M1: W4-FR04 agora cita expansion rejects ${variant} (inclui 'cycle'), "workflow validation rejects cycles..." e o teste de invalidação de dependente. Amostra W4-FR04, W4-FR05, W3-FR04, W4-FR07: testes exercitam a promessa. Ressalva menor: o título de FR07 não cobre "resolver dependências" (teste de dependências existe em test-execution-plugin-install.js:91, sem nome citado).
- M2: guard lê só títulos de test(/it( (regex de linha, comentários de bloco removidos); teste próprio prova que comentário/mensagem são recusados.
- SHAs: feee73c (W4-FR01) e 00e2881 (W4-FR02) são os únicos; ambos passam em `git merge-base --is-ancestor <sha> origin/master` e em `cat-file -e`. CI usa `fetch-depth: 0` (ci.yaml:184), então o clone é completo: o guard roda a verificação real e falha só se o objeto faltar (absent). Em clone raso degrada a só formato com aviso; coerente.
- Execução via cg.sh: guard 14/14, neutralidade 2/2, verify OK (103 itens), eslint e prettier limpos; sem atribuição de IA no commit.

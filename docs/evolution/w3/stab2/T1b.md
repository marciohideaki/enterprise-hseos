# T1b - triagem de feature/guard-ts-parser-spike

Run dev-squad 20261106-1721-stab2-wave-a. Proposta para decisão do owner. Nenhum produto foi alterado.

## Veredito proposto: descartar (arquivar o relatório, não integrar o código)

Razão em uma linha: o ganho que o spike media (fechar os gaps de layout do guard) já foi obtido na master por outro caminho, e o custo medido (latência fria, 23,6 MB de dependência, negações novas em fragmentos) não se paga.

## Entrada

- Bundle de resíduo: `feature/guard-ts-parser-spike` buscado sem falta de pré-requisito. Um commit sobre a base `b35ac0dc`: `3983930b feat(guard): add opt-in TypeScript parser reader as a spike`.
- Arquivos: `SPIKE-REPORT.md`, `test/spike/guard-ts-measure.js`, `test/test-capability-intake-guard-ts-parser.js`, `tools/cli/lib/capability-intake-guard-ts.js` (novos); `capability-intake-guard.js` (+54/-8) e `test/test-package-surface.js` (limite de entradas 1472 para 1473).
- A ref temporária `refs/tmp-stab2/T1b` foi removida ao final.

## Conclusão do SPIKE-REPORT.md (citada)

"Adotar com condições, restrita ao opt-in; não recomendo ligar por padrão. Estratégia: união (TS ∪ views léxicos), nunca TS sozinho." Números do relatório (medidos por ele, não reproduzidos aqui):

- Latência fria: +160 ms por chamada em arquivo com `export` (p50 72 ms para 231 ms).
- Quente: 1,7x a 1,9x o custo da master (até 3,5x segundo a revisão).
- `typescript` 5.9.3 pesa 23,6 MB desempacotado (cerca de 3,4x o footprint do pacote hseos) e não está em `package.json`.
- Fragmentos: 4,0% das janelas aleatórias viram negação nova onde a master já via export.
- Os gaps de layout (type operator no fim da linha, corpo de classe/função em linha própria) fecham só quando o texto parseia.
- Relatório admite que o caminho mais barato era fechar os casos no scanner léxico.

## O que o guard faz hoje na master

`tools/cli/lib/capability-intake-guard.js` (3056 linhas) tem tokenizador próprio (`tokenizeCore`, `tokenizeJsViews`) com contexto de regex/divisão, acrescentado como vista extra sobre as vistas legadas. `detectExports` é a união das vistas, sem parser externo. Desde a base do spike a master tocou o arquivo em 5 commits, entre eles:

- `54dc29d2` fix(guard): read declarators after a type operator or a class/function body on its own line
- `9b068841` fix(guard): detect CommonJS logical, bracket and alias export forms

## As lacunas do spike ainda existem?

Executei `detectExports(..., 'ts')` da master (leitura local, sem rede) nos casos do relatório:

| Caso                                               | Símbolos vistos na master |
| -------------------------------------------------- | ------------------------- |
| `export let a: readonly\nstring[] = 1, Denied = 1` | a, Denied                 |
| `export let a: unique\nsymbol = 1, Denied = 1`     | a, Denied                 |
| `export const a = class Foo\n{}, Denied = 1`       | a, Denied                 |
| `export const a = function f()\n{}, Denied = 1`    | a, Denied                 |
| `exports.a ??= 1`                                  | a                         |
| `module["exports"] = {A}`                          | anônimo (flag), sem nomes |
| `const m = module; m.exports = {A}`                | anônimo (flag), sem nomes |

Os 4 gaps de layout estão fechados. As formas CommonJS que o relatório listava como limite do leitor TS (`??=`) também são vistas. Resta uma diferença de precisão: `module.exports = {A}` e alias saem como "anônimo" em vez de nomes. Isso é conservador (o guard trata como export desconhecido), não é buraco de bypass, e o relatório mostra que o ganho do TS ali é parcial.

## merge-tree

`git merge-tree --write-tree master <spike>` saiu com código 1 e conflitos de conteúdo em dois arquivos:

- `tools/cli/lib/capability-intake-guard.js`
- `test/test-package-surface.js`

Como conflitou, não fiz merge sem commit nem rodei `test/test-capability-intake-guard-ts-parser.js` (conforme o critério de aceite: não forçar). `git merge --abort` não foi necessário e `git status` ficou limpo. O teste do spike, portanto, não foi executado contra a master: não verificado.

## Custo da dependência

- `typescript` não é dependência do projeto; está em `node_modules` 5.9.3 apenas como transitiva de dev (via eslint-plugin-n).
- Promovê-lo a `dependencies` soma 23,6 MB ao consumidor; como `optionalDependencies` mantém o fail-closed do spike, mas deixa o comportamento do guard dependente do ambiente.
- O módulo novo faria o `entryCount` do pacote passar do limite de `test-package-surface.js`, que o spike só contornou por exceção na branch. A master já moveu esse limite, daí o conflito.
- Usa `sourceFile.parseDiagnostics`, API interna do compilador.

## Alternativas para o owner

1. Descartar (proposto): guardar o `SPIKE-REPORT.md` como registro; o bundle pode ser removido do resíduo depois da decisão.
2. Reescrever: só se houver motivo novo, por exemplo ler o arquivo em disco após a edição (texto completo e parseável), que é o caminho que o próprio relatório aponta para convergência real. Isso exigiria nova medição de latência e de taxa de negação com edições reais.
3. Integrar como está: não recomendado (conflita, exige porte manual e deixa a dependência de 23,6 MB).

## Não verificado

- O teste do spike contra a master (conflito).
- Os números de latência, falso positivo e diferencial do relatório (citados, não reproduzidos).
- Que não haja outros gaps da master que o TS fecharia; só os casos do relatório foram executados.
- A taxa de negação em edições reais.

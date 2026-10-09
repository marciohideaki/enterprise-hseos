# WAVE-2-REPORT: 20261008-2350-next-steps

**Origem:** instrução do owner em 2026-10-09: "Feche os 2 gaps de layout no scanner léxico". O spike T1 tinha recomendado essa correção barata no lugar de adotar o compilador TS. Na mesma mensagem, o owner autorizou a PR e o merge (G4/G5) da #212.

| Tarefa | Status | Branch | Revisão | Correções |
|---|---|---|---|---|
| T5: gaps de layout no scanner léxico | OK | `feature/guard-lexer-layout-gaps` | PASS-WITH-NOTES ([REVIEW-T5.md](REVIEW-T5.md)) | nenhuma |

## Entregue
- **Operador de tipo no fim de uma linha de anotação** (`readonly`, `unique`, `keyof`, `typeof`, `asserts`): o operador agora continua a expressão em modo `types`.
- **Corpo de `class`/`function` em linha própria:** novo estado `headOpen` em `skipTo`. Enquanto o corpo não fecha, o `\n` não encerra a expressão.
- **Fail-closed:** uma linha que começa com `{` sem `headOpen` marca `listAbandoned`, porque pode ser o corpo de um cabeçalho que o scanner não viu.
- 0 regressão em 585 arquivos, em 13.247 fragmentos e no corpus reescrito em Allman.

## Lacunas que continuam
- `class`/`function` sem corpo seguido de `export {…}` / `default` / `*` / `=` fica oculto. É JS inválido e acontece igual na master.
- Buracos de CommonJS que nem o TS fecha: `exports.a ??= 1`, `module['exports']`, alias de `module`.

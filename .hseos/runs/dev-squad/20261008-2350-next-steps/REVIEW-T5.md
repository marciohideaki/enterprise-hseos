# REVIEW-T5: revisão cética isolada (Sonnet)

**Veredito:** PASS-WITH-NOTES. Não houve rodada de correção: todas as notas são de baixa severidade e pendem para o lado seguro.

## Medido
- Os 4 inputs do brief dão `Denied` na branch e ficavam ocultos na base (`d4ee5c75`, guard idêntico ao de `b35ac0dc`).
- Os testes novos discriminam: contra a guard da base, 76/78; os 2 que falham são os novos. Na branch, 78/78.
- Corpus:

  | Corte | Tamanho | `incomplete` novo | Símbolos perdidos |
  |---|---|---|---|
  | Arquivos reais | 585 | 0 | 0 (nenhum ganho) |
  | Janelas de fragmento (1 a 15 linhas, seed fixa) | 13.247 | 0 | 0 |
  | Corpus reescrito em Allman | 585 arquivos / 14.118 janelas | 0 | 0 |

- 15 cenários adversariais de 1 MB, comparados com a base no mesmo instante: crescimento linear. Pior caso `annot`, 81 ms contra 46. Nenhum passa de 100 ms.
- Sem falso `headOpen` em `x.class`, `{class: 1}`, strings, templates, regex, comentários, `functionName`, `className` e `typeof function`.

## Achados
1. **Baixa.** Falso `incomplete` em bloco avulso depois de uma declaração sem `;` (`guard.js` ~l.1727, `if (after[0] === '{') listAbandoned = true`). Exemplos: `export const x = foo(1)\n{ a: 1 }` e `export const a = 1\n{ const z = 1 }`. Só aparece em entradas sintéticas; 0 no corpus. Os 11 formatos Allman de export continuam `false`.
2. **Baixa.** Parte dos casos fail-closed depende da regra heurística `listAbandoned`, por exemplo `function foo(): {x: 1}\n{}, Denied = 1;` e `function foo<A, B>()\n{}, Denied = 1;`. A direção é segura: a base escondia `Denied`.
3. **Nota.** `export const a = class\nexport { Denied }` (e `export default`, `export *`, `export =`) continua oculto com `incomplete:false`. É JS inválido e se comporta igual na base, então não é regressão.
4. **Nota.** A justificativa do executor para a falha de 248 ms estava errada: o teste da l.1427 mede `detectExports`, não `lexLegacy`. A hipótese de ruído se sustenta, porque o 1 MB "realista" tem mínimo de 86 ms na base e 87 ms na branch, com picos de 153 e 170 ms nos dois lados.

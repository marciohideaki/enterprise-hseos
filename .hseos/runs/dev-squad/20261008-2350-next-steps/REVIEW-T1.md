# REVIEW-T1: revisão cética isolada (Sonnet)

**Veredito:** PASS-WITH-NOTES.

**Confirmado:**
- O caminho padrão é idêntico ao da master: sem require ansioso e 76/76 nos testes.
- A união é superconjunto por construção (fuzz de 4000 entradas, 0 violações).
- Nenhum caminho fail-open novo.

## Achados
1. **ALTA.** Falso positivo em fragmentos (`capability-intake-guard.js:2467-2473`). Basta a substring `export` num identificador, comentário ou string de um fragmento de Edit que não parseia, e a edição vira `incomplete` e é negada. Na master o resultado é `null`.
   Exemplos provados:
   - `const exportedRows = …;\n }`
   - `exportData(rows,`
   - `return exportCsv(a);\n}\n\nfunction other() {`
   - `// we export this later\n }`
2. **MÉDIA.** Os gaps `readonly`/`unique` e de corpo em linha própria só fecham quando o arquivo é completo e válido. Em fragmento, o resultado é negação, não leitura.
3. **MÉDIA.** Há buracos de CommonJS também no TS:
   - `exports.a ??= 1` (só `EqualsToken` é tratado, `-ts.js:141`);
   - `module['exports']` (`-ts.js:51-60`);
   - alias `m = module`;
   - `(module).exports`.

   Não é regressão, mas contradiz a ideia de "converge por construção".
4. **BAIXA.** `exports.foo = …` fica oculto, porque o atalho `mentionsExport` (`-ts.js:30-32`, `:208`) roda antes do parser. Não é regressão.
5. **BAIXA.** Parte dos testes não discrimina: divisão→regex (l.61), união (l.187) e TSX passam sem o leitor TS.
6. **BAIXA.** O cache `lastTypeScriptRead` (`guard.js:2461`) usa só o conteúdo como chave e não é invalidado por `resetTypeScript`.
7. **INFO.** `parseDiagnostics` é API interna e não está no `.d.ts`.

## Alegações do executor
| Alegação | Status |
|---|---|
| 11/11 e 76/76 | confirmada |
| a frio 231 vs 72 ms | confirmada (o revisor mediu 211 vs 63, razão 3,3x) |
| 1 MB a quente 308 vs 172 | parcial: a razão depende do conteúdo (1,8x a 3,5x) |
| typescript 23,6 MB, transitivo via eslint-plugin-n | confirmada |
| entryCount 1473 | confirmada |
| 0 perdas no diferencial | confirmada por amostra própria |
| TS sozinho perde 2682/6000 | não verificada |
| gaps fechados | confirmada, com a ressalva do achado 2 |
| divisão→regex não reproduz na master | confirmada para as 4 entradas |

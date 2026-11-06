# Recibo da F14 com efeito comportamental, dois modelos e custo medido, 2026-11-06

Escopo: requisito F14-R1 (`docs/evolution/requirements.json`: contexto e memória mantêm fonte e autoridade). Responde às lacunas da segunda reauditoria cega: o efeito era um marcador desenhado para ser detectado, havia um só modelo e uma só execução, e o custo era estimado. Autorização do owner: "proponha e execute as novas campanhas", com teto de US$ 1,00 por campanha; a promoção da memória foi feita pelo owner no terminal dele. Caminho de produção: `hseos agent run` com a configuração do operador `environment.memory.source_db` (PR #285). Binding `openai-compatible` na API oficial, chave `openai/api-key` do `pass`. Roteiro: `evidence/stab-f14c/f14cents.cjs`; guard e resumidor: `evidence/shared/`. Este recibo não altera `requirements.json`.

**Resultado: com `gpt-4o`, a tarefa passou em 1 de 3 execuções sem a memória promovida e em 2 de 3 com ela, e o modelo usou 4,7 chamadas de ferramenta em média contra 8,0. Com `gpt-4o-mini` nada passou em nenhuma condição, então não há sinal. Com n=3 por célula isso é direcional, não estatisticamente significativo, e o controle também passou uma vez. Rótulo: indício direcional, sem prova de causa (o controle também passou uma vez, com o mesmo tipo de código); custo medido; sem promoção da F14 `real_consumers`. A reauditoria cega concluiu manter `not_verified` (`REAUDIT-BLIND-3-2026-11-06.md`).**

## O desenho

- **Sem marcador.** A nota é uma convenção de projeto: _valores monetários (preços, totais e impostos) são centavos inteiros; uma função que devolve um total ou um imposto arredonda meio-para-cima para centavos inteiros e nunca devolve fração_. O efeito é verificado pelo **verificador protegido**, não por um token plantado.
- **Sem citar a memória nem a unidade.** O requisito é: _exportar `totalWithTax(amount, rate)` que devolve o preço total depois de aplicar a taxa ao valor_. Os três testes protegidos: `[1999, 0.085] → 2169`, `[1250, 0.0825] → 1353`, `[999, 0.5] → 1499`.
- **Mesmo contrato, mesmo binding e mesmos limites nas duas condições** (10 chamadas de ferramenta, contexto declarado de 100.000 tokens, saída de 1.024). Só a promoção difere.
- Seis execuções de controle com a nota ainda não confiável, depois a promoção pelo owner, depois seis execuções com a nota confiável.

## Promoção (prova arquivada)

Ledger do `project.db`, lido depois do fato: `memory.written` de `f14-money-1:promoted` com `origin: operator`, `trust: trusted`, `promoted_by: owner`, digest `e209c090bc54…`, motivo "F14 behavioral campaign: reviewed money convention", operação `memory.promote:f14-cents:f14-money-1:e209c090…`, e `memory.superseded` da nota original. Uma cópia consistente do banco (API de backup do SQLite, integridade `ok`, 3 eventos) está em `/build/artifacts/stab-f14c-run1/project.db.after-promotion`, sha256 `67da8fdfd966a64be94811815f3ec657ef82df1bd99ba58ddd13f93ffaf2989e`. O ator `owner` é um rótulo declarado, não uma identidade verificada.

## Resultados

| Modelo        | Condição              | Execução 1   | Execução 2 | Execução 3   | Aprovadas | Chamadas de ferramenta |
| ------------- | --------------------- | ------------ | ---------- | ------------ | --------- | ---------------------- |
| `gpt-4o`      | sem memória promovida | reprovada    | reprovada  | **aprovada** | 1 de 3    | 6, 9, 9 (média 8,0)    |
| `gpt-4o`      | memória promovida     | **aprovada** | reprovada  | **aprovada** | 2 de 3    | 4, 7, 3 (média 4,7)    |
| `gpt-4o-mini` | sem memória promovida | reprovada    | reprovada  | reprovada    | 0 de 3    | 10, 10, 10             |
| `gpt-4o-mini` | memória promovida     | reprovada    | reprovada  | reprovada    | 0 de 3    | 10, 0, 10              |

Todas as execuções do `gpt-4o-mini` reprovaram por `session-budget-exceeded` (esgotaram as 10 chamadas de ferramenta); a `after-mini-2` nem chamou uma ferramenta e deixou o `index.js` intacto. Em todas as execuções com memória a fonte entrou como `trusted`, `authority: data`, com o digest da nota, e o banco da fonte ficou intacto (contagem e última posição do ledger iguais antes e depois, nas 12).

**O que cada `gpt-4o` escreveu:**

- Sem memória: `amount * (1 + rate)` (fração, reprovou); converteu para centavos e voltou a dólares (fração, reprovou); `Math.round(amount + amount * rate)` (arredondou por acaso e passou).
- Com memória: `Math.round(amount * (1 + rate))` (passou), `Math.round(amount * (1 + rate))` (passou) e `amount + Math.round(amount * (rate / 10000))`, que **aplicou a convenção errado** e reprovou.

## Custo medido

116 requisições, 0 ilegíveis. Os preços são **declarados por mim e não verificados** (US$ 0,15 e 0,60 por milhão para `gpt-4o-mini`; 2,50 e 10,00 para `gpt-4o`); é uma estimativa, não uma fatura.

| Modelo        | Requisições | Tokens de entrada | Tokens de saída | US$ estimado |
| ------------- | ----------- | ----------------- | --------------- | ------------ |
| `gpt-4o-mini` | 64          | 163.063           | 6.780           | 0,0285       |
| `gpt-4o`      | 52          | 132.950           | 5.187           | 0,3842       |
| Total         | 116         | 296.013           | 11.967          | 0,4128       |

## Lacunas (`does_not_prove`)

1. **n=3 por célula e dois modelos do mesmo provedor.** A diferença de 1 para 2 aprovações não é estatisticamente significativa; é um indício, não uma prova.
2. **O controle não é limpo:** o `gpt-4o` passou uma vez sem a convenção. A tarefa não obriga a falha sem a memória.
3. **O modelo pequeno não discrimina nada** nesta tarefa e neste orçamento.
4. **A tarefa e a nota foram desenhadas pelo executor.** A convenção é realista, mas inventada; não é uma tarefa do operador. Os testes protegidos têm um caso em `.5` que premia o arredondamento específico.
5. **O contexto é montado pelo host:** nenhum modelo chamou `memory.retrieve`. Mede o uso de memória injetada, não uma recuperação espontânea.
6. **Memória de autoridade `data` moldou o comportamento** e, em um caso, foi aplicada errado. Se isso é desejável é questão de política, não decidida aqui.
7. **Banco de teste.** O `project.db` é um fixture temporário, não o banco real; o contrato e o workspace vêm de um fixture de teste (`test/helpers/engineering-project`).
8. **Custo por tokens medidos e preços declarados**, sem ledger e sem conferência na console do provedor; a conta dona da chave não foi identificada.
9. **Não há prova de causa.** Um teste exato de Fisher sobre 1 de 3 contra 2 de 3 dá p próximo de 1; o controle aprovado e as duas execuções promovidas aprovadas escrevem o mesmo tipo de código (`Math.round`), e nenhum código aprovado mostra uso da convenção além disso. Controles e promovidas rodaram em blocos separados no tempo, sem aleatorização.
10. **O `prepare-*.json` traz outro motivo de promoção** ("production-path campaign") que o do ledger ("behavioral campaign"): o comando que o owner executou levava o segundo. O ledger é a fonte.
11. Estados completos, SSE bruto e a cópia do banco ficam em `/build/artifacts/stab-f14c-run1/`, com hashes; não versionados.

# Recibo da F15 com compactação natural, dois modelos e custo medido, 2026-11-06

Escopo: requisito F15-R1 (`docs/evolution/requirements.json`: compactação, retomada e fork preservam critérios e lineage). Responde às lacunas da segunda reauditoria cega: o arquivo inicial era preenchido para forçar a compactação, havia um só modelo e o custo era estimado. Autorização do owner: "proponha e execute as novas campanhas", com teto de US$ 1,00 e janela de 45 minutos por campanha. Binding `openai-compatible` na API oficial, chave `openai/api-key` do `pass`. Roteiro: `evidence/stab-f15c/orchestrate.cjs`; guard e resumidor: `evidence/shared/` (PR #288). Este recibo não altera `requirements.json`.

**Resultado: em 5 de 6 execuções reais (2 modelos, 3 repetições cada), a referência, a execução compactada com crash e retomada, e o `fork` foram aprovados, e em todas elas a compactação caiu na sequência 17, logo depois da leitura e antes de qualquer escrita, com o limiar padrão e sem preenchimento; o `fork` nasceu depois dela e a carregou no prefixo. Uma execução (`gpt-4o`) falhou na retomada compactada. A igualdade de bytes dos artefatos com a referência só ocorreu em 4 de 10 comparações. Rótulo: `fork` com compactação natural observado em 5 de 6 execuções com custo medido; sem promoção da F15 `real_consumers`.**

## O que mudou em relação à rodada anterior

| Ponto da reauditoria                                  | Tratamento                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arquivo inicial preenchido para induzir a compactação | Módulo realista de 2.063 bytes (`numeric-helpers.fixture.txt`: ajudantes numéricos com JSDoc e um defeito em `add`, que subtrai). Sem preenchimento e com o limiar **padrão** (2.800 pontos-base): o resultado da leitura já é grande o bastante para a compactação cair sozinha |
| Um só modelo                                          | `gpt-4o-mini` e `gpt-4o`, 3 repetições cada                                                                                                                                                                                                                                      |
| Custo estimado, `usage` ilegível                      | Guard compartilhado: tokens por requisição lidos quadro a quadro, 0 requisições ilegíveis                                                                                                                                                                                        |
| Comparação por bytes                                  | `artifacts_equal` não foi afrouxado; ao lado ficam o campo informativo de conteúdo sem espaço no fim e os valores comparados                                                                                                                                                     |

A tarefa continua desenhada pelo executor (o módulo é realista, mas o defeito foi inserido).

## Execuções

| Execução | Modelo        | Requisições | Referência | Compactada + crash + retomada                           | `fork`    | Compactação / checkpoint | Bytes iguais (compactada, `fork`) |
| -------- | ------------- | ----------- | ---------- | ------------------------------------------------------- | --------- | ------------------------ | --------------------------------- |
| `mini-1` | `gpt-4o-mini` | 12          | aprovada   | aprovada                                                | aprovado  | 17 / 93                  | não, não                          |
| `mini-2` | `gpt-4o-mini` | 13          | aprovada   | aprovada                                                | aprovado  | 17 / 98                  | sim, sim                          |
| `mini-3` | `gpt-4o-mini` | 12          | aprovada   | aprovada                                                | aprovado  | 17 / 90                  | não, não                          |
| `4o-1`   | `gpt-4o`      | 12          | aprovada   | aprovada                                                | aprovado  | 17 / 52                  | não, sim                          |
| `4o-2`   | `gpt-4o`      | 12          | aprovada   | aprovada                                                | aprovado  | 17 / 282                 | sim, não                          |
| `4o-3`   | `gpt-4o`      | 9           | aprovada   | **reprovada** (`criteria-not-satisfied` na 2ª retomada) | não rodou | n/a                      | n/a                               |

Em todas as execuções que chegaram ao `fork`, a compactação veio antes do checkpoint e o prefixo do `fork` contém ao menos uma compactação. A verificação protegida aprovou os dois lados em todas as comparações. `single_compaction` é falso e a execução compactada escreve mais de uma vez, como nas rodadas anteriores.

## Custo medido

Tokens lidos do log de requisições (0 ilegíveis). O custo usa preços **declarados por mim e não verificados** (US$ 0,15 e 0,60 por milhão para `gpt-4o-mini`; 2,50 e 10,00 para `gpt-4o`) e é uma estimativa, não uma fatura.

| Execução | Requisições | Tokens de entrada | Tokens de saída | US$ estimado |
| -------- | ----------- | ----------------- | --------------- | ------------ |
| `mini-1` | 12          | 24.733            | 3.492           | 0,0058       |
| `mini-2` | 13          | 27.864            | 3.456           | 0,0063       |
| `mini-3` | 12          | 23.071            | 3.099           | 0,0053       |
| `4o-1`   | 12          | 26.011            | 2.667           | 0,0917       |
| `4o-2`   | 12          | 25.303            | 2.533           | 0,0886       |
| `4o-3`   | 9           | 18.106            | 1.649           | 0,0618       |

Total das seis: 70 requisições, cerca de US$ 0,26. Duas tentativas preliminares com o módulo anterior de 4,4 KB (descartadas; `mini-0-attempt-*`) somam 19 requisições e cerca de US$ 0,013. Total geral: cerca de US$ 0,27 contra o teto de US$ 1,00.

## Parâmetros de campanha ajustados (não são limites de gate)

O módulo inicial de 4,4 KB foi encolhido para 2,1 KB depois de a chamada do CLI estourar o limite de 280 s: cada fragmento da resposta vira um evento no ledger, e reescrever o arquivo inteiro levava de 1 a 2 minutos por requisição. Ficaram: saída do binding de 4.096 tokens, orçamento do contrato de 150.000 tokens, duração do contrato de 600 s, 8 chamadas de ferramenta, limite de tempo do CLI de 600 s, contexto declarado de 20.000 tokens e limiar de compactação padrão. Nenhum gate, critério de aceite ou limiar de compactação foi alterado.

## Lacunas (`does_not_prove`)

1. **Uma execução de seis reprovou na etapa de compactação com retomada** (`gpt-4o`, `4o-3`). O recibo não afirma estabilidade; três repetições por modelo é pouco.
2. **A tarefa é desenhada pelo executor**: o módulo é realista, mas o defeito foi inserido, e o resultado da leitura é grande por construção (2 KB). Mostra que a compactação cai sozinha com o limiar padrão para um arquivo desse tamanho, não que isso ocorra numa tarefa qualquer.
3. **Igualdade de bytes dos artefatos em 4 de 10 comparações**; o resto difere porque os modelos reescrevem o arquivo de formas diferentes. O que sustenta "preserva critérios" é a verificação protegida aprovada em todos os casos completos, não a igualdade de bytes.
4. **O custo é medido em tokens, mas precificado por preços declarados por mim**, sem ledger de custo e sem conferência na console do provedor. A conta dona da chave e o saldo não foram identificados.
5. **Mesmo provedor para os dois modelos**; não há outra família.
6. **`single_compaction` falso e escritas a mais** na execução compactada, como antes.
7. Estados completos e SSE bruto ficam em `/build/artifacts/stab-f15c-*`, com hashes; não versionados.

# Recibo da F15 com compactação antes de qualquer escrita, 2026-11-05

Escopo: requisito F15-R1 (`docs/evolution/requirements.json`: compactação, retomada e fork preservam critérios e lineage). Responde à lacuna da reauditoria cega: o `fork` anterior saía de um checkpoint **anterior** à compactação, então não provava a compactação preservada nele. Decisão do owner de 2026-11-05: "compactar antes de qualquer escrita". Binding `gpt-4o-mini` na API oficial, teto de US$ 1,00. Roteiro: `evidence/stab-f15b/orchestrate.cjs` (derivado do `stab-f15`). Este recibo não altera `requirements.json`.

**Resultado: em 3 de 4 execuções reais com o desenho novo, a referência, a execução compactada com crash e retomada, e a retomada do `fork` foram aprovadas, e o `fork` nasceu de um checkpoint posterior à compactação e anterior à primeira escrita. A quarta execução falhou na referência por limite de saída. Rótulo: `fork` com compactação preservada observado em 3 execuções reais; sem promoção da F15 `real_consumers`.**

## O desenho

1. **Nenhuma mudança de produto.** A compactação de resultado de ferramenta já dispara na primeira continuação com pressão, e o produto já recusa checkpoint depois de efeito no workspace.
2. **Causa de a compactação cair sempre depois da escrita antes:** o resultado da leitura do `add.js` vazio era pequeno demais, e a substituição da compactação não o encolhia; o runtime descarta em silêncio uma substituição rejeitada. Baixar o limiar (`run1`, 600 pontos-base) não mudou nada: a compactação continuou na sequência 62, depois da escrita.
3. **O que mudou:** a tarefa começa de um `add.js` com defeito e **preenchido** (`/* padding × 400 */`, o mesmo desenho de `test/test-compaction-agent-run.js`), com `F15_INITIAL_PAD=400`. O resultado da leitura passa a ser grande, a compactação o encolhe e ocorre logo depois da leitura.

## Execuções

| Execução   | Parâmetro                        | Requisições | Referência                                                            | Compactada + crash + retomada | `fork`    | Compactação / checkpoint | `fork` com compactação no prefixo |
| ---------- | -------------------------------- | ----------- | --------------------------------------------------------------------- | ----------------------------- | --------- | ------------------------ | --------------------------------- |
| `run1`     | limiar 600 bp, sem preenchimento | 13          | aprovada                                                              | aprovada                      | aprovado  | 62 / 58                  | **não** (0)                       |
| `run2-pad` | preenchimento 400                | 14          | aprovada                                                              | aprovada                      | aprovado  | 17 / 93                  | **sim** (1)                       |
| `run3-pad` | preenchimento 400                | 14          | aprovada                                                              | aprovada                      | aprovado  | 17 / 95                  | **sim** (1)                       |
| `run4-pad` | preenchimento 400                | 13          | aprovada                                                              | aprovada                      | aprovado  | 17 / 95                  | **sim** (1)                       |
| `run5-pad` | preenchimento 400                | 2           | **falhou** (`session-budget-exceeded`: limite de saída de 256 tokens) | não rodou                     | não rodou | n/a                      | n/a                               |

A `run1` é a tentativa que não funcionou e fica registrada. A `run2-pad` rodou antes de o roteiro ganhar o campo informativo de conteúdo; `run3-pad` e `run4-pad` usam o roteiro final. Total: 56 requisições, estimativa abaixo de US$ 0,03 (não é fatura; a rota não passa por ledger de custo).

## Comparação de artefatos

`artifacts_equal` compara bytes e **não foi afrouxado**. Ele deu falso em `run2-pad` (compactada e `fork`) e `run3-pad` (compactada e `fork`) e na compactada da `run4-pad`; foi verdadeiro só no `fork` da `run4-pad`. O conteúdo gravado é o mesmo código (`module.exports = (a, b) => a + b;`); a diferença é o fim de linha. O roteiro grava agora, ao lado, o campo separado `artifacts_content_equal_trimmed` (conteúdo por arquivo sem espaço no fim), verdadeiro nas duas execuções finais, e as pré-visualizações e hashes dos artefatos comparados. Esse campo é informativo e não substitui `artifacts_equal`.

## Lacunas (`does_not_prove`)

1. **Três aprovações em quatro tentativas com o desenho novo**, mais uma tentativa anterior sem efeito. A falha é de variação do modelo diante de um teto de saída de 256 tokens, não do mecanismo; ainda assim mostra que não há estabilidade garantida.
2. **A tarefa foi escolhida para a compactação cair antes da escrita** (arquivo inicial preenchido). Prova que o `fork` preserva uma compactação anterior ao checkpoint, não que isso ocorra numa tarefa qualquer.
3. **Mais de uma compactação** (`single_compaction: false`) e duas escritas na execução compactada contra uma na referência, como antes; o `fork` herda uma compactação no prefixo e faz mais de uma no total (`compactions_in_fork`).
4. **A comparação com o histórico integral** segue por critérios e artefatos; a igualdade de bytes dos artefatos não se sustentou em todas as execuções (ver acima).
5. **Instrução de reconciliação ajustada contra um único modelo** (nota da reauditoria anterior): não foi reavaliada com outro modelo.
6. **Custo estimado e sem ledger; L2 incompleto.**
7. Estados completos e SSE bruto ficam em `/build/artifacts/stab-f15b-*`, com hashes; não versionados.

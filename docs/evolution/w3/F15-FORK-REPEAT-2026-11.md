# Recibo da repetição da F15 (fork), 2026-11-05

Escopo: repetição autorizada pelo owner da jornada da C9 (compactação, SIGKILL, retomada com reconciliação, `fork`), com binding `gpt-4o-mini` na API oficial, teto de US$ 1,00 e 45 minutos por campanha. Roteiro: `evidence/stab-f15/orchestrate.cjs` (cópia da C9 que preserva os estados). Evidência: `evidence/stab-f15/run1` a `run5`. Este recibo não altera `requirements.json`.

**Resultado: depois de correções da instrução da volta de reconciliação, a retomada do `fork` foi aprovada com o modelo real em duas execuções (`run4` e `run5`, `criteria-satisfied`); só a `run5` usa o texto final da instrução. Rótulo: `fork` aprovado em execuções reais, sem promoção da F15 `real_consumers`, que depende de reauditoria cega.**

## Execuções

| Execução | Código sob teste                                                                             | Requisições | Retomada do `fork`                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| run1     | master antes da correção                                                                     | 11          | `failed` / `criteria-not-satisfied`                                                                                   |
| run2     | correção 1 (instrução não manda "diagnosticar")                                              | 11          | `failed` / `criteria-not-satisfied`: o modelo parou e perguntou "Would you like to proceed?"                          |
| run3     | correção 2 (arquivo vazio é ponto de partida esperado; perguntar só se contradiz o original) | 12          | `failed` / `session-failed:provider_unavailable`: o `fork` seguia agindo e bateu no teto de 12 requisições do roteiro |
| run4     | correção 2, teto do roteiro em 20                                                            | 12          | **`approved` / `criteria-satisfied`**                                                                                 |

Os contadores de requisições são acumulados dentro de cada execução. Custo: 58 requisições nas cinco execuções, estimativa abaixo de US$ 0,03 (não é fatura; a rota não passa por ledger de custo). Muito abaixo do teto de US$ 1,00.

## Causa e correção (lidas do ledger preservado)

1. A instrução da volta de reconciliação dizia "Diagnose remaining work before acting". O modelo chamava a ferramenta `engineering.diagnose`, que só aceita um review rejeitado, e a chamada falhava (`No rejected review requires a diagnosis`).
2. Depois que a instrução deixou de induzir isso (correção 1), o modelo passou a parar e perguntar, porque a mesma instrução mandava perguntar diante de nova incerteza e o arquivo vazio do `fork` lhe parecia uma.
3. A correção 2 declarou o arquivo vazio como ponto de partida esperado. A revisão cega apontou que isso estreitava demais o gatilho de pergunta; a correção 3 limita a regra ao caso sem escrita registrada e mantém a pergunta para contradição ou operação incerta.

Nenhum gate, limite ou critério de aceite foi alterado.

## Lacunas (`does_not_prove`)

1. **Duas aprovações em cinco, uma com o texto final.** As três falhas têm causas distintas e documentadas. Duas aprovações não mostram estabilidade.
2. **`artifacts_equal` oscila entre as execuções** (falso no `fork` da `run4`, falso na compactada da `run5`). O roteiro compara serializações e não grava os valores comparados; a diferença não foi investigada.
3. **Teto do roteiro.** O teto de requisições passou de 12 para 20 na `run4`, só como parâmetro do roteiro; o teto financeiro não mudou.
4. **Instrução ajustada contra um modelo pequeno.** O ajuste foi guiado pelo comportamento de um modelo; outros modelos não foram exercitados.
5. **Gatilho e quantidade de compactações, conta dona da chave, uma execução por etapa:** como na C9.
6. Os estados completos e o SSE bruto ficam em `/build/artifacts/stab-f15-run1` a `run5` com hashes, fora do git.

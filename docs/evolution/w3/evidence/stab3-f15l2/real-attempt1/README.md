# Execução real 1 da F15 L2 (2026-11-09)

- `summary.json`: recibo agregado da campanha real (`model_source: real`, 10 execuções, 136 requisições), veredito do roteiro `fail` (série de 2.800).
- `campaign.log`: saída padrão do roteiro, uma linha por execução e o resumo final.
- `spend.json` e `spend-series.json`: livro de gasto do roteiro (estimativa pelo preço declarado, não fatura).
- `secret-sweep.json`: varredura de segredos do roteiro sobre a saída pública.
- Hash de confirmação do owner: `1e16088fac419a8637c28d11c2a36c515c24cd7ff8478e1907f27f07a3d589e4`.
- Os arquivos passaram por `secret-scan.cjs` (5 arquivos, 0 achados, inclusive contra o valor literal da chave) antes da cópia.
- `runs/`, ledgers e o banco NÃO foram copiados. O roteiro não tem semente sorteada, por isso não há `seed.json`.

Leitura e ressalvas: seção "Resultado real" de `docs/evolution/w3/F15-L2-2026-11.md`.

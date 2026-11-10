# Execução real 1 da F14 v4 (2026-11-09)

- `campaign.json`: recibo agregado da campanha real (36 execuções iniciadas de 42 planejadas, 348 requisições), `promotion_method: owner-terminal`, parada `STOPPED: cumulative ceiling` (saída 5).
- `seed.json`: semente sorteada e gravada antes da primeira chamada.
- Hash de confirmação do owner: `49a20e6418ae326a99e53fdc25b083570ff42163210e63c1fa5de4df669d38a7`.
- Os dois arquivos passaram por `secret-scan.cjs` (2 arquivos, 0 achados, inclusive contra o valor literal da chave) antes da cópia.
- `runs/` (incluindo o SSE bruto de cada execução), ledgers e o banco NÃO foram copiados.

Leitura e ressalvas: `docs/evolution/w3/F14-V4-2026-11.md`.

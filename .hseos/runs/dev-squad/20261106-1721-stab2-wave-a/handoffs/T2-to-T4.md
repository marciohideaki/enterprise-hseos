# Handoff T2 → T4

Causa da reprovação da `4o-3`: erro do modelo (`expected_sha256` errado, com o hash certo na mensagem de reconciliação). Defeito de produto concorrente, em 6 de 6 execuções compactadas: `tool_result_prune` remove o resultado da ferramenta antes de o modelo vê-lo, inclusive `sha256` e texto de erro (`packages/agent-compaction/deterministic-provider.js:34-52`).

O que exige do protocolo: decidir a poda antes de gastar; declarar o limiar como parâmetro (2.800 é da campanha; o padrão do produto é 8.500); não tratar as aprovações atuais como preservação, porque dependeram do relatório reinjetado depois do crash.

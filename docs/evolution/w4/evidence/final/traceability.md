# Rastreabilidade W4

As células e os limites seguem [verification.md](../../../../../.specs/features/harness-w4/verification.md).
Os recibos de [matriz determinística](../deterministic/verification-receipt.json)
e [consumidores reais](../real/verification-receipt.json) identificam revisão,
hashes, comandos, versões, contagens e resultados, com as limitações de
proveniência declaradas no recibo R1: o snapshot exato do script da primeira
tentativa não foi preservado e o comando inicial da instalação foi reconstruído.
Os testes listados exercitam
aceite e recusa; o recibo final registra a suíte integral.

| Requisito | Tasks | Aceite e recusa | Recibo |
| --- | --- | --- | --- |
| FR01 — identidade, capacidade e rejeição antes do efeito | W4-01, W4-02, W4-07a | P1 `test-execution-plugin-manifest.js`: import sem efeito, manifesto válido, incompatibilidade, hash e autoridade inválidos | determinístico P1 |
| FR02 — tool/provider/contexto e isolamento | W4-02, W4-07a/b | P2 `test-execution-plugin-runtime.js`: execução e conformance; saída inválida, timeout, órfão e acessos negados. R1: plugins reais instalados fora do checkout | determinístico P2; real R1 |
| FR03 — jobs duráveis e recuperação | W4-03, W4-06c, W4-07a/b | J1/J2/F1 `test-job-control.js`, `test-job-recovery.js`, `test-job-faults.js`: elegibilidade, persistência e replay; concorrência, owner morto/incerto, crash antes e depois do efeito | determinístico J1/J2/F1; real R1 |
| FR04 — DAG, join, drift e expansão | W4-04a2a/b/c, W4-04b, W4-06d, W4-07a | D1 `test-workflow-expansion.js`: dependências, filhos tardios e join; ciclo, baseline alterado, expansão dupla/concorrente e limite | determinístico D1 |
| FR05 — cancelamento transitivo e drenagem | W4-04b, W4-07a/b | P2/J2/F1/D1: cancelamento, timeout, fencing, processo e descendentes drenados; R1 cancela job enfileirado | determinístico P2/J2/F1/D1; real R1 |
| FR06 — orçamento composto e incerteza | W4-05, W4-07a/b | B1/F1 `test-job-campaign.js` e `test-job-faults.js`: autorização→reserva→despacho→recibo; rejeição por saldo, binding trocado, recibo perdido e segunda reserva | determinístico B1/F1; real R1 |
| FR07 — distribuição offline e seleção fixada | W4-06b, W4-07a/b | I1 `test-execution-plugin-install.js`: instalação externa, upgrade, rollback e versão selecionada; incompatibilidade, dependência ausente e versão não selecionada inerte | determinístico I1; real R1 |
| FR08 — CLI/API/SDK, auth e cursor | W4-06a/c, W4-07a | S1 `test-job-surfaces.js`: paridade JS/TS/Python, cursor e replay; acesso negado, comando inválido e reconciliação sem novo efeito | determinístico S1 |

## Interpretação dos resultados

R1 não substitui a matriz adversarial: os quatro consumidores reais foram
instalados via tarball offline em um projeto externo, enquanto a drenagem de
processos e descendentes ativos é provada pelos testes P2/F1. O primeiro
despacho Codex externo teve recibo rejeitado por limite de entrada e permaneceu
reservado após reconciliação do efeito. Somente o segundo despacho foi aceito.
Nenhum despacho adicional está autorizado. A campanha de plugins no projeto
externo concluiu com custo adicional zero e sem saldo incerto.

Os artefatos de [W4-07a](../deterministic/) e [W4-07b](../real/) preservam
provas separadas. A execução da suíte integral, cobertura e gates nos dois Node
consta no [recibo final](./verification-receipt.json). Nenhum resultado de W3
foi contado como prova W4.

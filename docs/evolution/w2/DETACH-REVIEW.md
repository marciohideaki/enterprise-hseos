# W2 — revisão adicional de detach

Complementa `REVIEW.md`; os recibos anteriores permanecem históricos e intactos.
Task `hseos-w2-detach-fence`, depois da consolidação W2.

A revisão final reproduziu uma janela entre Ctrl-] e o finally do attach: os
listeners ainda ativos admitiam novos input, EOF e resize na fila. Isso podia
encerrar um job após uma ação que deveria apenas desanexar o cliente. As duas
regressões falharam antes da correção, com e sem input previamente aceito.

`mutate` agora recusa novas entradas assim que `stopped` é definido. Comandos
aceitos antes do detach continuam sendo drenados. A mudança não repete bytes,
não cancela o job remoto e não modifica o protocolo de controle.

Verificação focada: API/attach Node 24, 8/8 testes; attach Node 22, 7/7 testes.
Cobertura de terminal-attach: 98,92% linhas e 100% branches. Lint passou.
A task exige gates/hooks completos e a matriz de CI Node 22/24 antes do closeout;
a evidência focada não substitui essas etapas. Artefatos e hashes em
`evidence/detach/receipt.json`.

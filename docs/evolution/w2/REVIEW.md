# Revisão funcional W2 — 2026-09-26

Autorização da sessão: revisar funcionalmente W2, validar e corrigir a falha,
integrar Git W1/W2, definir e executar W3. Execução sequencial, sem subagentes.
Publicação e ativação operacional continuam fora desta entrega.

## Achados e correções

1. A inicialização de raw mode ocorria antes do `try/finally`; falha deixava
   listeners de input, end, resize e SIGTERM registrados. Inicialização agora
   está protegida; restauração ocorre somente após ativação e pausa do input
   ocorre mesmo se a restauração falhar.
2. Rejeição de uma mutação resolvia a cadeia de promises pelo catch e permitia
   executar entradas já enfileiradas. A fila agora é barrada após a primeira
   falha, sem repetir efeitos ou criar novas identidades de comando.
3. O cliente ignorava `effect.bytes` em recibos de entrada parcial. Agora informa
   `CONTROL_TERMINAL_INPUT_PARTIAL` e encerra a anexação, exigindo inspeção do
   recibo antes de novos envios. Nenhum sufixo é reenviado automaticamente.

Três regressões falharam antes das respectivas correções. Cinco testes de
anexação passaram após os ajustes. A revisão também leu o controle persistente,
reservas, executor e broker, confrontando intenção/efeito/recibo, recuperação,
cancelamento e limites com FR01–FR08. Testes reais completos seguem na matriz.

## Rastreabilidade

| Requisito                       | Evidência executável                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| FR01 intenção, CAS e identidade | test-terminal-control: reserva, replay, CAS e SIGKILL                                         |
| FR02 saída cursorada e entrada  | test-terminal-control + test-terminal-api, incluindo entrada parcial                          |
| FR03 PTY/jobs e controles       | test-terminal-executor: tty, resize, input, EOF, pause/continue e interrupt                   |
| FR04 limites e orçamento        | test-terminal-executor + test-terminal-control: limites, deadline e reservas compartilhadas   |
| FR05 lifecycle e recuperação    | test-terminal-control: SIGKILL, recuperação e cancelamento remoto; executor: árvore destacada |
| FR06 reconciliação              | test-terminal-control: perda de recibo e digest; anexação para após erro                      |
| FR07 concorrência               | test-terminal-control: sessões isoladas, cancelamento e parent bloqueado                      |
| FR08 consumidores               | test-terminal-api + jornadas instaladas CLI/JS/Python e contrato TypeScript                   |

Logs históricos foram recontados: 914 integrais/440 críticos por versão Node,
zero falhas/skips. Os 56 artefatos, 35 fontes W2 e 2.139 arquivos da W1 original
correspondiam aos hashes antes desta correção. Esses recibos permanecem históricos;
não certificam o novo delta. A nova matriz terá recibo separado.

## Resultado da nova matriz

Recibo: [evidence/review/receipt.json](evidence/review/receipt.json).
Node 24.15.0 e 22.23.3: 917 testes integrais e 443 críticos por versão,
zero falhas/skips. Cobertura: 95,64% linhas nas duas versões; 88,49% branches
em Node 24 e 88,48% em Node 22; gate por arquivo 90/80 aprovado. Pacote instalado
externamente nas duas versões: jornadas CLI/HTTP/JS/Python PTY/job aprovadas.
Logs e manifestos vinculados por hash; fontes congeladas durante a matriz.

Risco de revisão: alto, por lifecycle e efeitos de processos. Os três achados
confirmados estão corrigidos e cobertos. Contratos HTTP/eventos anteriores
preservados; novo erro de entrada parcial é comportamento explícito da anexação.
API loopback continua autenticada e recusa origens/hosts não permitidos. Não houve
mudança de dependência, isolamento ou credenciais. Revisão de código aprovada;
integração continua condicionada aos gates e checks da revisão Git correspondente.

## Integração planejada

Preservar a candidata e W0 como base identificada, antes de W1. A árvore importada
por W1 é `28f6ba59233e80bc35cdf51e12f433ec9efed9b8`; a árvore W1 importada por
W2 é `0a3dbeecc043127438a9aa16eeb689bf6bc57deb`. Integrar cada delta em task
isolada, com gates e PR por onda, sem reescrever o histórico existente.
Os worktrees originais e recibos não serão removidos durante a integração.

Referências: AGENTS.md §§4–9, ADR-0017, Constituição §§2.3/2.6/5/7,
`.specs/features/harness-w2/{spec,design,tasks}.md`. AEW não verificado nesta revisão.

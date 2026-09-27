# Campanha Claude — exceção autorizada e recusa de saldo

Em 2026-09-26, o proprietário respondeu: “Autorizada a exceção limitada,
antigravoty nao temos nada no ambiente”. A exceção refere-se a até duas chamadas
Claude, no máximo US$ 2 por chamada, dentro do teto global já existente de US$ 10.

## Execução observada

A campanha usou o adapter nativo real, SDK 0.3.283, cliente 2.1.283, modelo
`claude-haiku-4-5-20251001` e credencial referenciada por
`pass://claude/anthropic-api-key`, injetada somente no ambiente privado do worker.
O acesso de inspeção autenticou; o controlador admitiu a quota desconhecida pela
exceção explícita com prazo e binding fixados. O grant limitou este piloto a duas
requisições e US$ 4; o SDK recebeu `maxBudgetUsd=2` por chamada.

A primeira tentativa terminou sem recibo de sucesso. O histórico nativo específico
da sessão registrou `billing_error`, resposta sintética “Credit balance is too low”
e zero tokens de entrada, saída e cache. Não se trata de uma resposta gerada pelo
modelo. Isso refuta a hipótese de que a autenticação validada garante saldo para
inferência. Não houve segunda tentativa nem retomada.

O controlador cancelou a campanha sem liberar a reserva incerta. A evidência
filtrada está em `evidence/claude-live/native-session-observation.json`; o histórico
original, com anexos e instruções locais, não foi copiado para o repositório.

## Orçamento e continuidade

- Teto global: US$ 10; não houve nova autorização de US$ 10.
- Despachos acumulados: seis, sendo cinco Codex e um Claude.
- Recibos de sucesso: três Codex; zero Claude.
- Reserva conservadora retida: US$ 2. Saldo global não comprometido: US$ 8.
- A reserva não representa cobrança confirmada; a fatura não foi verificada.
- Campanha Claude cancelada, sem comando vivo, com uma tentativa não reconciliada.
- Duas incertezas históricas Codex já foram reconciliadas para encerramento.
- A exceção Claude permite no máximo uma tentativa adicional após resolver o
  bloqueio; não autoriza repetição ilimitada ou ignorar saldo conhecido insuficiente.

Foi apresentado questionário para disponibilizar créditos, indicar outra referência
Claude no cofre ou adiar a rota. Nenhuma compra, recarga ou troca de conta foi feita.
Uma futura execução precisa reconciliar o relatório atual e transportar as reservas
e a contagem de chamadas; não deve reabrir este grant nem reiniciar seu saldo.

## Antigravity e demais dependências

O proprietário confirmou que não dispõe do ambiente Antigravity. Da preparação
anterior resta somente o SDK 0.1.18 em um venv temporário; a inspeção desse venv
confirmou que `litert-lm` não está instalado. Não há checkpoint provisionado para
a campanha. Foi solicitado escolher provisionamento local ou adiamento.

A [documentação oficial de modelos locais](https://antigravity.google/docs/sdk/local-models/)
exige runtime LiteRT e checkpoint `.litertlm` para essa rota. O exemplo Gemma 4
26B A4B usa download de aproximadamente 16,8 GB e recomenda pelo menos 24 GB de
memória de vídeo/unificada; isso excede o perfil de memória de até 2 GiB do
adapter candidato. É necessário validar um modelo menor compatível antes de
provisionar, ou propor explicitamente outro perfil. Nenhum modelo foi baixado e
nenhuma compatibilidade com modelo pequeno foi presumida.

A referência de credencial da API compatível/ACP continua pendente. FR07 permanece
aberto. Neste incremento não houve mudança de runtime; a validação foi a execução
real e a conferência dos registros de estado, sem repetir a regressão anterior.

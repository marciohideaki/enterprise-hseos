# Claude — correção do protocolo e recibo real confirmado

O proprietário autorizou duas chamadas adicionais, cada uma limitada a US$ 2,
sem ampliar o teto global de US$ 10. Ambas foram usadas: diagnóstico e validação.

## Causa comprovada e correção

A captura do SDK real registrou `system/init` com ferramentas vazias e modo
`plan`, seguido de `system/thinking_tokens`. O driver rejeitou esse segundo
evento como mensagem não suportada. O contrato `SDKThinkingTokensMessage` do SDK
oficial 0.3.283 define os campos `estimated_tokens` e `estimated_tokens_delta`
como estimativas de progresso, não consumo faturável autoritativo.

O driver passou a reconhecer exclusivamente esse subtipo, validando os dois
campos como inteiros seguros não negativos e preservando a validação de identidade
da sessão. O evento não gera saída do modelo, não concede ferramentas e não
altera os tokens contabilizados a partir de `result.usage`. Subtipos desconhecidos,
estimativas inválidas e identidades de outra sessão continuam sendo recusados.

A primeira chamada usou um worker temporário instrumentado que apenas observava
os eventos encaminhados ao driver. A segunda usou o worker normal, sem essa
instrumentação. O digest dos artefatos dessa segunda execução coincide com as
fontes atuais. Não foi presumido que qualquer mensagem `system` seja inofensiva.

## Resultado observado

A chamada final confirmou recibo no controlador e devolveu exatamente
`{"value":42,"phase":"initial"}`. O runner verificou replay idempotente e encerrou
a campanha cancelada, sem comandos ativos ou pendentes. O SDK informou custo de
US$ 0,003338 nessa chamada, sujeito à precisão de ponto flutuante do campo original.

A sessão persistida foi localizada pelo SDK e reanexada pelo driver real com a
mesma identidade. O ensaio de reanexação bloqueou `query()` e registrou zero
chamadas de modelo. Isso comprova descoberta e reanexação, **não** uma segunda
inferência com continuidade semântica. A retomada com novo turno permanece aberta.

As tentativas incertas anteriores foram reconciliadas para encerramento, mantendo
histórico, reservas e sua classificação original. A reconciliação não criou
recibos de sucesso retroativos.

## Orçamento acumulado

- Teto global: US$ 10, preservado.
- Nove despachos: cinco Codex e quatro Claude.
- Recibos concluídos: três Codex e um Claude.
- Reservas conservadoras no ledger: US$ 8; saldo não comprometido: US$ 2.
- Custo informado pelos quatro históricos Claude: aproximadamente US$ 0,00925.
- Fatura do provedor não verificada; reserva e custo informado são medidas distintas.
- As duas chamadas adicionais autorizadas foram consumidas. Nenhuma terceira foi feita.

O adapter mantém a reserva máxima quando não há custo liquidado pelo contrato;
a leitura dos registros de custo não foi usada para liberar automaticamente
reservas. `cost-summary.json` conserva os valores originais, inclusive a precisão
numérica original, e os hashes dos históricos consultados.

## Validação e revisão cética

Regressão focada: **76/76 em Node 24 e 76/76 em Node 22**, sem falhas/skips.
Lint e formato das fontes alteradas passaram. Os testes incluem estimativa válida
separada do consumo real, estimativa negativa, sessão estrangeira e subtipo
não conhecido. O primeiro ensaio dos novos testes encontrou uma constante de
fixture incorreta; ela foi corrigida e o log da falha foi preservado. Matriz
completa, cobertura global e consumidor instalado não foram repetidos.

- “Créditos disponíveis corrigem o adapter”: refutado; o protocolo ainda falhava.
- “Estimativa de pensamento equivale a token faturado”: refutado pelo contrato SDK.
- “Ignorar todo evento de sistema resolve com segurança”: não adotado; allowlist
  restrita e testes negativos preservam a rejeição dos demais eventos.
- “Resposta nativa correta basta para confirmar o controlador”: refutado pelo
  ensaio anterior; neste ensaio o recibo e o replay também foram confirmados.
- “Reanexação prova retomada com inferência”: falso; só a reanexação foi exercitada.
- “Custo informado liquida reservas e comprova fatura”: falso; nenhum desses
  efeitos foi presumido.

Evidências: `evidence/claude-verified/receipt.json`. FR07 permanece aberto para
retomada Claude com novo turno, API compatível/ACP, Antigravity real e os demais
critérios operacionais previamente registrados. As decisões de provisionamento
Antigravity e a referência de credencial ACP ainda não foram fornecidas.

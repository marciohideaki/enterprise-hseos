# Claude após disponibilização de créditos

O proprietário informou a adição de US$ 10 à console Anthropic. Isso disponibiliza
saldo no provedor, sem ampliar o teto global de US$ 10 da campanha nem a exceção
anterior de duas chamadas de até US$ 2 cada.

## Resultado real

Foi usada a única tentativa restante dessa exceção. O cliente real executou
`claude-haiku-4-5-20251001`, produziu exatamente
`{"value":42,"phase":"initial"}` e registrou custo de **US$ 0,002483**. O histórico
nativo contém 1.483 tokens de entrada e 200 de saída, sem tokens de cache. As
mensagens parciais compartilham a identidade da resposta; o recibo de observação
deduplica essa identidade para não somar o mesmo consumo duas vezes.

O controlador, porém, recebeu `CONTROL_OUTCOME_UNCERTAIN`, sem recibo concluído do
adapter. Portanto, a inferência e a resposta esperada estão comprovadas pelo
histórico nativo, mas o fechamento pelo adapter e a retomada Claude não estão.
O custo informado pelo cliente não é uma fatura verificada. Não foi atribuída uma
causa específica ao erro de fechamento sem a captura do protocolo correspondente.

## Estado preservado

A campanha anterior foi reconciliada a partir de relatório fresco, mantendo a
reserva de US$ 2 e seu estado cancelado. O novo ensaio foi limitado a uma chamada
e US$ 2. Após a falha de fechamento, também foi cancelado, sem comandos vivos e
com a tentativa incerta preservada. Não houve repetição automática.

O acumulado é de sete despachos: cinco Codex e dois Claude. O ledger conserva
US$ 4 de reservas, deixando **US$ 6 não comprometidos** do teto global. Reserva não
equivale a cobrança. Há três recibos de sucesso Codex; a resposta Claude foi
observada fora do recibo do adapter e não foi promovida artificialmente a sucesso.

## Próxima verificação preparada

Foi preparado um worker temporário de diagnóstico que observa os tipos/subtipos
de eventos do SDK, identidades, tipos de conteúdo e falha do driver, sem registrar
credenciais ou texto de prompts/respostas. Ele preserva os eventos entregues ao
driver e não substitui o provedor. A sintaxe do harness foi validada; ele ainda não
foi usado em uma inferência. Não houve mudança nas fontes do runtime neste passo.

Foi enviado questionário para estender a exceção em até duas chamadas de US$ 2
cada, dentro do mesmo teto global, visando diagnóstico e retomada. A confirmação
é necessária porque as duas tentativas da exceção anteriormente autorizada já
foram consumidas; a recarga informada não foi tratada como ampliação implícita
desse limite. Antigravity e a referência ACP continuam pendentes.

Evidências filtradas e estado: `evidence/claude-funded/receipt.json`.

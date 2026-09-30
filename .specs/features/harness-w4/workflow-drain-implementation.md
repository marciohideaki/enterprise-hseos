# W4-04b1 — drenagem antes do release da árvore

Tipo: contrato de implementação. Base `3cb3c2ec`; FR04/05/06; extensão do
[design de workflow](workflow.md). Esta unidade trata o caminho terminal e a
perda do recibo de spawn. A invalidação por drift e a tentativa explícita de
uma árvore terminal pertencem à W4-04b2.

O engine inclui na drenagem todos os filhos anexados no stream do pai e reservados
para a definição corrente, inclusive filhos com resultado terminal, pois o
fechamento de recursos e descendentes pode ainda estar em curso. Isso também
cobre a perda do recibo depois do fork. Cancelamento bloqueia novo spawn e checkpoint antes do release. O release
`cancelled` ou `failed` só ocorre após resultado terminal durável de todos os
filhos conhecidos; falha ou incerteza de drain preserva a reserva ativa para
reconciliação, sem anunciar término.

Na composição de engenharia, cada envio ou cancelamento de filho fecha tools,
conexão de modelo e extensões antes de devolver o resultado ao join. O join
continua a usar o `engineering_task.result` com prova de aceite validada pelo
reducer e estado terminal da sessão. Resultado de modelo isolado não é aceite.
O fechamento externo repete a drenagem de todas as montagens e propaga falhas.
Enquanto uma reserva de workflow estiver ativa, o runtime registra o pedido de
cancelamento e interrompe o trabalho da sessão raiz, mas adia seu evento terminal.
O reducer também recusa `session.completed` ou `session.failed` antes do release.
O supervisor cancela workflows de descendentes antes dos ancestrais e confirma
o terminal da raiz dentro do prazo original da operação. Repetir
`cancel` ou `dispose` nessa janela é idempotente e pode devolver estado ainda
não terminal; um resultado incerto de ferramenta continua incerto.
Se uma geração da raiz concluir enquanto a reserva está ativa, `send` devolve
`terminal:false`; após o release, `resume` explícito grava o terminal sem
repetir a solicitação ao modelo.

Verificação dirigida: perda de recibo após fork, falha de drain que mantém claim,
filho terminal ainda enviado ao provider para drenagem, release anterior ao
terminal da raiz, cancelamento observado antes do release e regressão da suíte de orquestração,
reservas e workflows de engenharia. Os gates integrais seguem obrigatórios em
Node 22/24 antes do commit.

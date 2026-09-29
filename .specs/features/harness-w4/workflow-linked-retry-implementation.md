# W4-04b2b — tentativa explícita vinculada

Tipo: contrato de implementação. Base `ed050544`; FR04/05/06; extensão de
[workflow.md](workflow.md) e [jobs.md](jobs.md).

`retry` é um comando público explícito que cria um novo job de workflow e
referencia o job terminal anterior por `retry_of`. A criação registra, em uma
única transação CAS, o novo stream e um vínculo de sucessor no stream anterior.
Uma tentativa terminal tem no máximo um sucessor; a cadeia é linear. Repetir o
mesmo `command_id` e digest retorna o recibo original, sem nova reserva.

O novo deadline absoluto é o menor `execution_deadline_at` das tentativas
iniciadas (ou o `deadline_at` da raiz se nenhuma iniciou). A definição nova não pode
reintroduzir IDs de nós com aceite verificado em qualquer elo, nem introduzir
IDs que não existiam na árvore anterior. Ela conserva
os workspaces originais e limita seus recursos ao saldo do orçamento original:
uso durável de tokens, turnos, chamadas de ferramenta e filhos iniciados de
todos os elos anteriores é debitado antes de admitir novos limites e nós.
`max_duration_ms` e paralelismo não crescem. O novo job aponta a raiz e o
antecessor, sem alterar resultados anteriores. Provider e campanha continuam
sob a mesma autorização quando a composição de provider for integrada na
W4-05; nenhuma criação de campanha é permitida por este comando.

Testes positivos e negativos: terminal obrigatório; deadline original;
rejeição de aceite repetido, saldo exaurido e segundo sucessor concorrente;
CAS/idempotência; reabertura preserva cadeia. Efeito incerto não é terminal e
não pode ser usado como origem de retry. Cobertura e gates Node 22/24 precedem
o commit.

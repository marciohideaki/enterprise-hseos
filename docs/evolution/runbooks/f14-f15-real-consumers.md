# Runbook F14 e F15 — consumidores reais

## F14 — memória recuperada entra no contexto de uma tarefa, com proveniência

Requisito F14-R1 (`docs/evolution/requirements.json`): contexto e memória mantêm fonte e autoridade. O que falta provar com cliente real é o caminho inteiro: gravar a memória por MCP, deixar uma tarefa de engenharia recuperá-la e conferir no ledger o que entrou.

### O que o código garante (prova automatizada)

`test/test-memory-context-journey.js` percorre o caminho sem cliente externo: `memory.write` por um servidor MCP real sobre um `project.db` ativado em fixture, depois uma tarefa de engenharia com fonte de memória, depois a conferência do evento `context.assembled` da sessão.

- O registro fica em `payload.sources` do evento `context.assembled` (ledger da sessão da tarefa). Cada memória que entrou tem `source_ref` (`memory://<project_id>/<memory_id>`, e o `memory_id` não é campo próprio: deriva-se de `source_ref`, sendo o último segmento depois de `memory://<projeto>/`), `origin` (`memory`), `trust`, `authority` (`data`) e `digest` (sha256 do conteúdo que entrou).
- O bloco no contexto é `MEMORY_DATA`, dado citado, nunca instrução.
- Memória de outro projeto não entra: a recuperação é do projeto da tarefa.
- Toda memória gravada por MCP é do agente e `untrusted`. Ela só entra se o **host** da tarefa declarar `memory.include_untrusted: true` (código, não configuração) ou se o operador a promover (abaixo). O modelo não decide isso (`memory.retrieve` com `include_untrusted` é recusada com `AGENT_MEMORY_UNTRUSTED_FORBIDDEN`). Sem a declaração, nenhuma memória do agente entra.

### Como rodar com cliente real (executável: decisão (b) do owner, 2026-11-02)

A campanha real da F14 é executável. O cliente real grava, o owner promove e a tarefa recupera. O opt-in global `include_untrusted` (alternativa (a)) foi recusado pelo owner: nada na configuração de produção o expõe.

1. **O cliente grava.** Servidor MCP do projeto sobre um `project.db` **ativado de teste** (nunca o de produção): `memory.write` no projeto da tarefa. A nota nasce `origin: agent` / `trust: untrusted` e **não entra** no contexto de nenhuma tarefa.
2. **O owner promove, uma memória por vez**, no CLI do operador (nunca por MCP, modelo ou contrato):
   `hseos memory promote --db <project.db de teste> --project <id> --memory <memory_id> --reason "<por que confia>" --operator <identidade>`.
   O comando mostra o conteúdo e o `content_sha256` e pede confirmação no terminal. Sem terminal, `--yes --content-sha256 <hex>` com o digest revisto. A promoção grava uma NOVA entrada `origin: operator` / `trust: trusted` (`<memory_id>:promoted`), com o mesmo conteúdo, que substitui a nota original (`memory.written` + `memory.superseded`). Ela exige ator `operator`, uma aprovação de uso único ligada ao projeto, à memória e ao digest, e repete a varredura de credencial. O ledger registra `promoted_by`, `reason`, `content_sha256`, o `approval_id` e o `operation_id` (`memory.promote:<projeto>:<memória>:<digest>`).
3. **A tarefa recupera.** Tarefa de engenharia com `memory.retrieve` no contrato. A memória promovida entra como dado citado (`MEMORY_DATA`), `trust: trusted`, `authority: data` (nunca instrução).
4. **Conferência.** No `context.assembled` da tarefa: `source_ref` `memory://<projeto>/<memory_id>:promoted`, `origin` `memory`, `trust` `trusted`, `authority` `data`, `digest` igual ao `content_sha256` aprovado. No ledger do projeto (`agent_memory`): o `memory.written` original (`origin: agent`) e o `memory.written` da promoção, cujo `source_ref` é `memory://<projeto>/<memory_id>@<content_sha256>` e cujo payload traz `promotion.promoted_by`.

Recusas (códigos): `AGENT_MEMORY_OPERATOR_REQUIRED` (sem ator operator), `AGENT_MEMORY_APPROVAL_REQUIRED` (sem aprovação; `cause` `EXECUTION_APPROVAL_REUSED` se já gasta, `EXECUTION_APPROVAL_SCOPE_MISMATCH` se de outra memória ou de outro digest), `AGENT_MEMORY_DIGEST_MISMATCH` (o conteúdo difere do digest revisto), `AGENT_MEMORY_CREDENTIAL_DETECTED`, `AGENT_MEMORY_NOT_FOUND` (inexistente, de outro projeto, substituída, apagada ou expirada), `AGENT_MEMORY_PROMOTE_INVALID` (já `trusted`). A promoção não existe como ferramenta MCP: `tools/list` não a publica e uma chamada do modelo é recusada.

Limites e cuidados desta promoção:

- **A garantia "humano" é a do terminal do owner.** O comando recusa qualquer execução sem TTY, inclusive com `--yes` (um agente, um pipe ou o CI não promovem). Mas um agente com o mesmo shell e o mesmo banco poderia obter um pseudo-terminal e rodar o comando; a promoção só é uma decisão humana se o shell e o `project.db` forem do owner. Rode a promoção apenas em sessão interativa do owner, nunca delegada a um agente.
- **O produtor confere a promoção, não o contexto.** `retrieve` só marca a memória como `trusted` no contexto de uma tarefa se o store comprovar: entrada `origin: operator` com `write_policy_ref: operator:promote`, `supersedes` apontando para uma memória que existe, e a aprovação daquela operação consumida em `execution_approvals`. O `authority.js` só confere a forma (defesa em profundidade). Sem a atestação do host, nada é `trusted`.
- **O sufixo `:promoted` é reservado.** `write()` (MCP ou qualquer caminho de agente) recusa um `memory_id` terminado em `:promoted` com `AGENT_MEMORY_ID_RESERVED`; só `promote()` o cria.
- **Onde fica a prova.** `promoted_by`, `reason`, `content_sha256`, `approval_id` e `operation_id` ficam no ledger do agregado `agent_memory` (evento `memory.written` da promoção). No `context.assembled` a promoção aparece pelo `source_ref` `memory://<projeto>/<memory_id>:promoted` (`trust: trusted`, `authority: data`); o schema do evento não carrega `promoted_by`.

Prova automatizada: `test/test-memory-context-journey.js` (jornada, negativos e CLI) e `test/test-agent-memory.js`.

### Recibo exigido

Para cada memória que entrou: `memory_id`, `origin`, `trust`, `authority` e `digest`, o evento de promoção (`promoted_by`, `content_sha256`, `operation_id`), mais o par de negativos (memória de outro projeto ausente; memória `untrusted` ausente quando o host não declarou a opção). O recibo cita o identificador da tarefa e do evento, não o conteúdo da memória. Sem o recibo, o consumidor real fica **pendente, nunca PASS**.

### Teto

Sem gasto de provedor pago: a tarefa usa o provedor determinístico/scriptado ou a assinatura já autorizada do cliente; nenhuma chamada de API paga sem autorização do owner por campanha. Uma única tarefa, uma nota, um projeto; sem fan-out.

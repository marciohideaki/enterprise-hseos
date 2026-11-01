# Runbook F14 e F15 — consumidores reais

## F14 — memória recuperada entra no contexto de uma tarefa, com proveniência

Requisito F14-R1 (`docs/evolution/requirements.json`): contexto e memória mantêm fonte e autoridade. O que falta provar com cliente real é o caminho inteiro: gravar a memória por MCP, deixar uma tarefa de engenharia recuperá-la e conferir no ledger o que entrou.

### O que o código garante (prova automatizada)

`test/test-memory-context-journey.js` percorre o caminho sem cliente externo: `memory.write` por um servidor MCP real sobre um `project.db` ativado em fixture, depois uma tarefa de engenharia com fonte de memória, depois a conferência do evento `context.assembled` da sessão.

- O registro fica em `payload.sources` do evento `context.assembled` (ledger da sessão da tarefa). Cada memória que entrou tem `source_ref` (`memory://<project_id>/<memory_id>`, e o `memory_id` não é campo próprio: deriva-se de `source_ref`, sendo o último segmento depois de `memory://<projeto>/`), `origin` (`memory`), `trust`, `authority` (`data`) e `digest` (sha256 do conteúdo que entrou).
- O bloco no contexto é `MEMORY_DATA`, dado citado, nunca instrução.
- Memória de outro projeto não entra: a recuperação é do projeto da tarefa.
- Toda memória gravada por MCP é do agente e `untrusted`. Ela só entra se o **host** da tarefa declarar `memory.include_untrusted: true`. O modelo não decide isso (`memory.retrieve` com `include_untrusted` é recusada com `AGENT_MEMORY_UNTRUSTED_FORBIDDEN`). Sem a declaração, nenhuma memória do agente entra.

### Como rodar com cliente real: BLOQUEADO por decisão pendente do owner

A campanha real da F14 (Claude Code ou Codex gravando por MCP e uma tarefa recuperando) **só é executável depois de uma decisão do owner, ainda pendente**: hoje nenhuma configuração de produção alcança `memory.include_untrusted`. O campo existe só no host montado em código (o teste o injeta); nada na seção `environment:` do arquivo de configuração o expõe. Como toda memória gravada por MCP é `untrusted`, sem essa decisão nenhuma memória de cliente real entra numa tarefa. Alternativas em análise:

- (a) expor `environment.memory.include_untrusted` na configuração, desligado por padrão;
- (b) promoção a `trusted` pelo operador;
- (c) campanha só com memória de operador (sem passar pelo `memory.write` do cliente).

Não expor o campo nem escolher entre as alternativas sem o owner. Enquanto isso, a jornada fica provada apenas pelo teste determinístico acima, e o consumidor real da F14 permanece **pendente, nunca PASS**. Depois da decisão, o roteiro é: servidor MCP do projeto sobre um `project.db` ativado de teste (nunca o de produção); `memory.write` no projeto da tarefa; tarefa de engenharia com `memory.retrieve` no contrato; conferir `context.assembled` no ledger da tarefa.

### Recibo exigido

Para cada memória que entrou: `memory_id`, `origin`, `trust`, `authority` e `digest`, mais o par de negativos (memória de outro projeto ausente; memória `untrusted` ausente quando o host não declarou a opção). O recibo cita o identificador da tarefa e do evento, não o conteúdo da memória. Sem o recibo, o consumidor real fica **pendente, nunca PASS**.

### Teto

Sem gasto de provedor pago: a tarefa usa o provedor determinístico/scriptado ou a assinatura já autorizada do cliente; nenhuma chamada de API paga sem autorização do owner por campanha. Uma única tarefa, uma nota, um projeto; sem fan-out.

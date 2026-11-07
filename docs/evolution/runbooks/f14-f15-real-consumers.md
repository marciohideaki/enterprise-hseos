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

### Memória promovida no `agent run` de produção (`environment.memory.source_db`)

Por decisão do owner (2026-11-05), a configuração do **operador** pode apontar um banco de projeto ativado como fonte **somente leitura** de memória promovida:

```yaml
environment:
  project_id: <projeto>
  memory:
    source_db: /caminho/absoluto/project.db
```

- A tarefa recebe só o que o produtor atesta como `trusted` (promoção do operador); a nota do agente, a não promovida e a de outro projeto não entram.
- O banco é aberto com `readonly`; nada é gravado nele. Um contrato que declare `memory.write` ou `memory.delete` é recusado enquanto a chave existir (`ENGINEERING_ENVIRONMENT_CONFIG_INVALID`).
- A chave vive no arquivo de configuração do operador. Não há opção de linha de comando, de contrato ou de ferramenta que a escolha.
- Sem a chave, o comportamento anterior continua: a memória é a do ledger da própria tarefa.
- Prova automatizada: `test/test-memory-context-journey.js` (`production host with a read-only source database…`). Não há campanha real deste caminho; a F14 `real_consumers` segue sem promoção.

### Custo medido nas campanhas (guard compartilhado)

Os recibos anteriores trazem o custo só como estimativa, porque o `usage` do log de requisições saía ilegível (o guard antigo lia o fluxo SSE com uma expressão regular que não acompanhava os objetos `*_tokens_details` aninhados). Campanhas novas usam o guard compartilhado:

- pré-carga: `node --require docs/evolution/w3/evidence/shared/fetch-guard.cjs …` (mesmas variáveis `C9_MODE`, `C9_DIR`, `C9_MAX_REQUESTS`); cada linha de `provider-requests.jsonl` traz `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens`), `finish` e `responding_model`, lidos quadro a quadro;
- resumo: `node docs/evolution/w3/evidence/shared/summarize-usage.cjs <dir> [--price-in N --price-out N]` soma os tokens. Uma requisição sem `usage` legível é **contada**, nunca tratada como zero, e a soma diz `complete: false`. O custo só aparece se o operador declarar o preço, e continua sendo uma estimativa pelo preço declarado, não uma fatura.
- isto mede tokens por requisição; não substitui um ledger de custo nem a conferência na console do provedor.

### Recibo exigido

Para cada memória que entrou: `memory_id`, `origin`, `trust`, `authority` e `digest`, o evento de promoção (`promoted_by`, `content_sha256`, `operation_id`), mais o par de negativos (memória de outro projeto ausente; memória `untrusted` ausente quando o host não declarou a opção). O recibo cita o identificador da tarefa e do evento, não o conteúdo da memória. Sem o recibo, o consumidor real fica **pendente, nunca PASS**.

### Teto

Sem gasto de provedor pago: a tarefa usa o provedor determinístico/scriptado ou a assinatura já autorizada do cliente; nenhuma chamada de API paga sem autorização do owner por campanha. Uma única tarefa, uma nota, um projeto; sem fan-out.

## F15 — compactação, retomada e fork com lineage

### 1. O que já está provado (determinístico)

Requisito F15-R1: compactação, retomada e fork preservam critérios e lineage; a verificação combina compactação, crash, resume e fork e compara com o histórico integral.

`test/test-compaction-agent-run.js` percorre essa jornada **pela CLI**, com o provider scripted (sem rede, sem custo):

1. `agent run --task-contract … --scripted-responses … --compaction <cfg> --create-only` cria a tarefa com a compactação ligada. Sem `--compaction` a compactação fica **desligada** (política `reject`, comportamento anterior).
2. `agent resume` com o worker morto por SIGKILL logo após o modelo ser chamado depois da compactação: `compaction.completed` já está durável, o efeito de escrita não.
3. `agent resume` retoma do histórico durável. Como a resposta do provider foi interrompida, a primeira retomada devolve `blocked` com `effect-reconciliation-required`; a segunda leva `--reconciliation-decision` ligado ao hash do relatório. O resultado é `approved`.
4. Critérios protegidos, aceite (`evidence`), artefatos e número de escritas coincidem com a execução de referência sem compactação (o histórico integral).
5. Um segundo `agent resume` sobre a tarefa concluída é replay: mesma sequência, nenhum evento novo.
6. `agent fork --state <dir> --from-sequence <n>` cria um **novo** diretório de estado com a ancestralidade do pai até o checkpoint. O pai só é lido. A lineage fica no evento `created` do fork e em `status`: `parent_task_run_id`, `parent_session_id`, `parent_sequence`, `ancestry_event_count` e `ancestry_sha256` (SHA-256 do JSON canônico dos eventos copiados). Retomar o fork e retomar o pai são independentes; o teste prova os dois (o pai não muda).

Limites do fork: recusa checkpoint terminal e checkpoint com efeito no workspace (só `engineering.read` é permitido antes do checkpoint), porque o workspace do fork é reconstruído do contrato. O fork não usa a cota `max_children` da sessão: o invariante `limits.max_children === 0` do contrato de engenharia permanece.

### 2. Configuração da compactação

`--compaction <arquivo.json>`, estrito:

```json
{ "schema_version": 1, "provider_id": "compaction:deterministic", "threshold_basis_points": 3000, "context_tokens": 20000 }
```

`threshold_basis_points` e `context_tokens` são opcionais. `context_tokens` só reduz a janela do modelo **scripted**; um modelo com binding ou plugin mantém a janela que declara. A configuração é gravada no evento `created`; `resume` não recebe o flag.

**Semântica da poda de resultados (`tool_result_pressure`).** Quando a pressão dispara (limiar de `threshold_basis_points` sobre o limite de entrada), o runtime poda primeiro os resultados de ferramenta **mais antigos** da mesma volta que ainda estão verbatim, em um único `compaction.completed` próprio (`...tools-older`). Os resultados da etapa atual seguem **verbatim** para o modelo enquanto a requisição couber em `inputLimit`. Só se, mesmo depois da poda dos antigos, a requisição ainda exceder o limite, o resultado atual também é podado. O stub podado preserva `error` (`code`, `message`, `retryable`) e, quando existem, `sha256` e `path`.

Consequências para a F15: (1) com pressão, **sem resultados antigos** e dentro do limite, **não há `compaction.completed`**; um limiar baixo sozinho já não força a poda em uma única leitura, então a série que precisa observar a poda deve ter **duas ou mais leituras** antes da escrita (ou uma janela em que o resultado atual exceda o limite); (2) a retomada pós-crash reconstrói as mesmas mensagens a partir dos eventos; (3) o limite padrão de 8.500 pontos-base não muda.

### 3. Limite desta capacidade com cliente real

A compactação está ligada ao runtime de **engenharia** (`AgentRuntime`, perfil `disposable-engineering-candidate`). Os perfis **delegated** (Claude Code e Codex) **não usam `AgentRuntime`**: o cliente real mantém o próprio contexto e o HSEOS não o compacta. Portanto F15 com cliente real tem este limite: a jornada abaixo só vale para um modelo real acessado por **binding** (`--binding`) no runtime de engenharia; não existe compactação HSEOS dentro de uma sessão delegated.

### 4. Ensaio com runtime real (autorização própria do owner)

Pré-requisitos, na ordem:

1. Autorização do owner por campanha, com teto de gasto e validade (como nas demais famílias; nada é reaproveitado de campanhas anteriores).
2. Binding de provider válido para o runtime de engenharia (`agent-provider-validate`), com a credencial no `pass`, referenciada e nunca impressa.
3. Preferir a rota de assinatura quando existir; chave de API só com registro escrito da avaliação da assinatura.

Passos: repetir a jornada da seção 1 com `--binding` no lugar de `--scripted-responses`, uma janela de contexto real reduzida por uma tarefa cuja leitura passe do limiar, o crash provocado por `kill` do PID do worker (conferido com `ps`, nunca por padrão amplo) e `agent fork` no checkpoint da compactação.

### 5. O que o recibo precisa conter

- hash do contrato e da configuração de compactação; identificação do provider e modelo (sem credencial);
- sequência e `event_id` do `compaction.completed`, com os `source_event_ids` e o digest de origem;
- prova do crash (PID morto, último evento durável) e das decisões de reconciliação (hash do relatório);
- comparação com a execução de referência sem compactação: critérios protegidos, `evidence` e artefatos;
- lineage do fork (`ancestry_sha256` recalculado a partir do pai) e prova de independência (pai inalterado após retomar o fork);
- tokens e custo medidos por requisição.

### 6. Teto

Teto padrão: o definido pelo owner na autorização da campanha; sem autorização o ensaio real fica **BLOCKED**. Uma única tarefa, uma janela reduzida, no máximo uma compactação, um crash, um fork. Qualquer falha encerra o ensaio sem repetir a chamada paga automaticamente.

## Sonda da janela efetiva (campanha)

Antes de afirmar que a janela declarada de um binding serve, registre no recibo a janela do modelo, o contexto efetivo do backend (para o servidor local, `ollama ps` com o modelo carregado) e o maior pedido enviado:

```bash
node docs/evolution/w3/evidence/shared/summarize-window.cjs <dir-da-campanha> --declared N --max-output N --effective N --model-window N
```

O comando lê `body_bytes` de `provider-requests.jsonl` e avalia `backend-window.cjs`. O veredito só é `pass` com as três medições válidas (inteiros positivos): contexto efetivo, janela do modelo e maior pedido. Qualquer uma ausente ou inválida resulta em `unknown` (nunca aprovado, exit 1); isso inclui log vazio e log sem nenhuma linha com `body_bytes`. Reprova se a declaração excede o contexto efetivo ou a janela do modelo, se o maior pedido em bytes mais a saída máxima excede a janela declarada, ou se a saída máxima é inválida. Diretório sem `provider-requests.jsonl` falha com erro. Vale só para a campanha; a admissão não consulta o backend.

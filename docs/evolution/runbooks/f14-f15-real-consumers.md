# Runbook F14/F15 — consumidores reais

Status: **preparação, nada é executado por este documento.** Este arquivo reúne os ensaios com cliente real das capacidades F14 e F15. A seção F14 é mantida pela task B3; esta task (B2) escreve apenas a seção F15. Enquanto o ensaio real não for autorizado e executado, `real_consumers` de F15 permanece `not_verified` em `docs/evolution/requirements.json`, nunca PASS.

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

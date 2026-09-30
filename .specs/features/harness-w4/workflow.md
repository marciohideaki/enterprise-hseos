# Workflow v2 e expansão governada

Tipo: contrato de design; FR04/05/06, ADR-0045 Proposed.

Manter parseEngineeringWorkflow v1 e histórico intactos. v2 acrescenta revision,
previous_definition_sha256 e seleção de extensões pinada. Mesmos limites atuais:
16 tasks, max_parallelism <=8 e AgentLimitsSchema. Expansão soma reservas de todos
os nós, incluindo concluídos; nunca redefine limites do pai.

Comando expand referencia workflow/job ID, expected_sequence, definition_sha256 e
novos nós com IDs estáveis, dependências e contratos completos. Persistir nova
revisão e hash com comparação de sequência. Repetição idempotente devolve recibo;
concorrência deixa só uma revisão válida. A operação acrescenta nós; não altera
contratos, resultados, deps ou aceite de nós existentes. Rejeitar ciclo,
dependência inválida, expansão após cancelamento/terminal e limite excedido.

Despacho lê revisão atual e gate de cancelamento na mesma autoridade que claim.
Expansão concorrente com cancelamento não pode lançar filho após o cancelamento
vencedor. Nós novos herdam autoridade/política/campanha e prazo do pai. Não renovar
orçamento de sessão por nova revisão. Baseline drift invalida dependentes ainda
não iniciados; resultados aceitos permanecem evidências, sem replay automático.

Join usa resultado aprovado pelo verificador protegido e sucesso terminal durável
de todos os predecessores. LocalSubagentProvider/WorkflowEngine não tratam apenas
fim de geração do modelo como aceite. Falha persiste bloqueio de novos despachos e
cancela fila/filhos/plugins/processos; terminal somente após drain comprovado.
Resultados anteriores permanecem consultáveis. Retomada de incerto exige
reconciliação; árvore terminal exige tentativa explícita vinculada à anterior,
com mesmo orçamento original e sem repetir nós já aceitos automaticamente.

# ADR-0042 — Kernel v4 e capacidades opcionais

## Status

Decisão de implementação candidata autorizada pelo plano do responsável em
2026-09-24. Promoção operacional permanece não autorizada. Este registro traduz
as decisões explícitas do plano; não aprova a entrega nem seus resultados.

## Context

O runtime já contém AgentRuntime, ToolRuntime, WorkflowEngine, supervisor,
SQLite, catálogo, broker e isolamento. Worktrees independentes corrigiram saída
CLI, confirmação de efeitos, diagnóstico e contratos. O perfil de engenharia
precisa consumi-los antes de qualquer capacidade adicional.

## Decision

Manter monorepo modular com distribuição coordenada de pacotes internos.
Kernel: contratos, execução, gateway, política local, sessões, evidências,
isolamento, verificação e orçamento. WorkflowEngine e supervisor existentes
serão os únicos donos da execução de workflows. Definições não serão estado.

ADO, GitOps, second brain, receitas metodológicas e providers adicionais serão
selecionados explicitamente e carregados sob demanda. Managed governance,
state UI e kanban central permanecem sidecars com ciclo de vida independente.
Transporte interagentes sem consumidor demonstrado permanece experimental.

A entrada de tarefa será `agent run --task-contract`; composição será `workflow
run`. Aprovação de tarefa será fato independente de `session.completed`, cujo
significado histórico não muda. Resposta do modelo não é verificação.

Selecionar candidato bwrap conforme ADR-0041, sem alterar ai-jail ativo. Código
não confiável não recebe broker, credenciais, ledger ou autoridade do verificador.
A habilitação depende de prova de isolamento, limites e cancelamento transitivo.

## Alternatives Considered

- Novo kernel: rejeitado por duplicar capacidades existentes.
- Outro supervisor de serviços: rejeitado; consumir o gerenciador existente.
- Publicação independente dos pacotes: fora do escopo da distribuição coordenada.
- Dois motores de workflow dentro da v4: rejeitado; manter distribuição v3 durante
  a janela de migração, preservando leitura de históricos anteriores.

## Consequences

O consumidor inicial é descartável, com tarefas Node.js e Python. A linguagem do
consumidor não muda a stack Node.js do kernel. Mudanças incompatíveis pertencem à
v4, sem ativação automática nem alteração de snapshots/eventos históricos.

## Mitigations

Ondas sequenciais, reutilização de commits revisados, testes adversariais,
verificação independente e instalação limpa externa ao checkout. Falhas de
isolamento bloqueiam execução, sem fallback para o host. Efeitos incertos exigem
reconciliação antes de repetir. Orçamento inclui correções e descendentes.

Migração preserva runs YAML como leitura; novas definições elegíveis geram novos
runs após validação. Rollback usa distribuição v3 preservada e evidências intactas.
A janela aplicável começa no anúncio de depreciação da release, não neste draft.

## References

- [Constituição](../constitution/Enterprise-Constitution.md), §2.5, §2.6, §5, §10.
- [ADR-0024](ADR-0024-model-agnostic-agent-framework.md).
- [ADR-0040](ADR-0040-disposable-engineering-execution.md).
- [ADR-0041](ADR-0041-engineering-executor-boundary.md).
- [Deprecation & Sunset Policy](../core/Deprecation%20%26%20Sunset%20Policy.md).
- [Estado da integração](../../../../docs/v4/STATUS.md).

### Recuperação local da candidata

A composição de engenharia usa o claim existente do WorkflowEngine com lease
curto e identidade do worker (PID + instante de criação do processo). O lease
não amplia prazo ou orçamento de tarefa. Antes de reivindicá-lo, o consumidor
nega owners vivos/desconhecidos, confirma a morte do owner anterior, elimina seus
executores e exige expiração e referência exata do claim. A rotação no ledger
impede que dois retomadores despachem o mesmo grafo.

Resultados aprovados não são reexecutados. Uma sessão concluída sem resultado de
tarefa pode repetir somente a verificação protegida; tarefas sem efeitos podem
iniciar. Comandos interrompidos com efeito incerto exigem reconciliação e não são
repetidos. Cancelamento recuperado usa o mesmo engine/supervisor para eliminar
executores abandonados e terminar o grafo. Claims antigos sem identidade de owner
continuam bloqueados; não se infere autorização de seus históricos.


## Authorized follow-up: correction and reconciliation

The user subsequently requested bounded diagnosis/correction after rejection and
safe recovery only after inspecting/verifying the current state, always asking
when uncertainty remains. Reuse AgentRuntime and its durable events: review before
session completion, preserve request lineage and original budgets, and require a
diagnosis bound to the rejected artifacts before corrective writes. Reuse the task
ledger for independent reconciliation reports and explicit digest-bound answers.
Unknown effects are never silently replayed; confirmed current effects are separate
from lost provider receipts. Terminal session histories remain terminal. This
follow-up authorizes implementation/testing, not paid-provider use or activation.

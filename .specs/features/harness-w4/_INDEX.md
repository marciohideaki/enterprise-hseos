# W4 — índice

Tipo: entrada de contratos. Leia spec → design → shard aplicável → tasks → evidência.

- [Spec](spec.md)
- [Design](design.md)
- [Extensões](extensions.md)
- [Seleção de extensões](selection.md)
- [Composição de ferramentas e contexto](task-extension-composition.md)
- [Jobs](jobs.md)
- [Workflow](workflow.md)
- [Verificação](verification.md)
- [Tasks](tasks.md)
- [Plano](../../../docs/evolution/w4/PLAN.md)

Glossário: claim = posse cercada por fence persistente; pin = identidade/versionamento
por digest; incerto = efeito possível sem recibo conclusivo; drain = prova de término
de todos os descendentes; elegível = horário/dependências/admissão permitem partida.

- [Composição de modelo/campanha na tarefa](task-model-composition.md)

- [Agregado persistente de jobs — W4-03a](job-state-implementation.md).

- [Ownership e recuperação dos jobs](job-claims-implementation.md) — W4-03b.

- [Materialização idempotente dos jobs](job-materialization-implementation.md) — W4-03c.

- [Despacho e encerramento de jobs](job-dispatch-implementation.md) — W4-03d.

- [Revisões de workflow antes do claim](workflow-revisions-implementation.md) — W4-04a1.

- [Revisões da reserva de sessão](workflow-reservations-implementation.md) — W4-04a2a.
- [Consumo de revisões pelo engine](workflow-revision-engine-implementation.md) — W4-04a2b.
- [Expansão de jobs em execução](workflow-running-expansion-implementation.md) — W4-04a2c.
- [Drenagem antes do release da árvore](workflow-drain-implementation.md) — W4-04b1.
- [Invalidação por drift antes do efeito](workflow-drift-implementation.md) — W4-04b2a.
- [Tentativa explícita vinculada](workflow-linked-retry-implementation.md) — W4-04b2b.
- [Vínculo de campanha do job](job-campaign-implementation.md) — W4-05.

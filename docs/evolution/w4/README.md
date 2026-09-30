# W4 — plugins de execução, jobs e workflows

Esta wave acrescenta três famílias de plugins de execução (ferramenta, provider e
contexto), jobs duráveis, workflows com dependências e expansão controlada, e as
superfícies de operação em CLI, HTTP e SDK. A definição e os limites estão em
[`PLAN.md`](./PLAN.md) e na [especificação](../../../.specs/features/harness-w4/spec.md).

## Operação

- `hseos plugin install`, `list`, `doctor` e `remove` gerenciam as versões
  instaladas. A execução fixa a versão por digest; upgrade e rollback não
  alteram jobs já vinculados.
- `hseos control job-command`, `job-query` e `job-events` operam jobs pela CLI.
  A API local oferece
  `POST /v1/jobs/commands`, `GET /v1/jobs/{id}` e
  `GET /v1/jobs/{id}/events?after=<cursor>&limit=<n>`; os SDKs JS/TS/Python
  expõem as mesmas operações. Repetições usam o mesmo `command_id` e sequência.
- Workflows aplicam dependências, aceite verificado e prazo original do pai. Uma
  falha interrompe novos despachos e a conclusão aguarda a drenagem dos filhos.
- Despachos de provider passam pela autorização e reserva de
  `ProviderCampaignControl`. Uma intenção incerta permanece reservada até
  reconciliação; crédito disponível não constitui autorização.

## Evidência e estado

A [matriz de rastreabilidade](./evidence/final/traceability.md) liga FR01–FR08 às
tasks, testes positivos/negativos e recibos. A
[matriz determinística](./evidence/deterministic/verification-receipt.json) cobre
P1–S1, mutantes e cobertura. A [campanha externa](./CONSUMERS.md) separa
consumidores reais dos fixtures e documenta o binding elegível, a tentativa
com recibo rejeitado e a reconciliação. O [estado](./STATUS.md) registra as
integrações e os limites da PR.

Esta PR tem base `feature/hseos-evolution-foundation`. Merge, instalação global,
publicação e ativação operacional exigem decisões separadas. O agendamento é
pontual, sem recorrência. O teto histórico permanece US$ 10, com US$ 9
reservados; os dois despachos adicionais sem cobrança foram consumidos.

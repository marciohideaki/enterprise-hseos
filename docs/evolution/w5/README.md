# W5 — capacidades de ambiente, contexto e memória

Esta onda acrescenta ao kernel a percepção e a ação sobre o ambiente de engenharia: LSP e
depuração (core, com servidores e adaptadores fixados por digest), navegador e computer-use
(pacotes de plugin separados), contexto com autoridade e proveniência, partes multimodais,
memória governada, compactação combinada e MCP subordinado ao gateway. A definição, as
decisões e os limites estão em [`PLAN.md`](./PLAN.md) e na
[especificação](../../../.specs/features/harness-w5/spec.md).

## Estado

W5-01 (contratos) em revisão; implementação não iniciada e dependente do gate G2. Detalhes e
matriz de entrega em [`STATUS.md`](./STATUS.md).

## Princípios

- Dado recuperado, memória, DOM, texto de tela e mídia são `data`: nunca ampliam política.
- Toda capacidade executa isolada, passa por ToolRuntime e política, e devolve resultado com origem e digest.
- Computer-use só em display virtual isolado, com aprovação por ação; nunca a sessão gráfica real.
- Capacidade sem binário ou cache offline termina em BLOCKED com a causa; nunca PASS.
- Merge, publicação, instalação global e ativação exigem decisões separadas.

## Leitura

[Spec](../../../.specs/features/harness-w5/spec.md), [design](../../../.specs/features/harness-w5/design.md),
[tasks](../../../.specs/features/harness-w5/tasks.md), [intake](../../decisions/harness-w5-intake.md),
[ADR-0047](../../../.enterprise/.specs/decisions/ADR-0047-environment-capabilities-and-context-authority.md).

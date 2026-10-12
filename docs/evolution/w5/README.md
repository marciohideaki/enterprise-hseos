# W5 — capacidades de ambiente, contexto e memória

Esta onda acrescenta ao kernel a percepção e a ação sobre o ambiente de engenharia: LSP e
depuração (core, com servidores e adaptadores fixados por digest), navegador e computer-use
(runtime no core com carregamento tardio; todas as capacidades também empacotáveis em `plugins/*`), contexto com autoridade e proveniência, partes multimodais,
memória governada, compactação combinada e MCP subordinado ao gateway. A definição, as
decisões e os limites estão em [`PLAN.md`](./PLAN.md) e na
[especificação](../../../.specs/features/harness-w5/spec.md).

## Estado

G2 aprovado em 2026-10-11 e W5-01 (contratos) concluída; próximo passo: onda B1 (W5-02a, W5-02b1 → W5-02b2,
W5-04). Implementação ainda não iniciada. Detalhes e matriz de entrega em [`STATUS.md`](./STATUS.md).

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

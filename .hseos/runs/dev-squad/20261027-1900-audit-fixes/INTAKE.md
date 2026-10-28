# Intake — correção dos achados da auditoria W0–W5 (2026-10-27)

- Pedido do owner: "Planeje a correção dos achados e implemente!" (2026-10-27), após o relatório `AUDIT-REPORT.md` (cópia de `/build/tmp/CONFORMIDADE-W0-W5-2026-10-27.md`).
- Base: `master` = `f96c6e9c`.
- Decisões do owner nesta data (AskUserQuestion):
  - execução por dev-squad/SWARM;
  - escopo: itens do Commander + decisões de owner com os padrões recomendados;
  - A-02: `issues` filtrado (entrada só com `keyword` e `instancePath`; saída sem detalhe);
  - A-06: manter o `detail.code` do H-7, registrado como aceite do owner;
  - A-12: receipt obrigatório no rollback, salvo flag explícita (padrão do plano, aprovado no G2).
- Fora do escopo: ADRs 0042–0045, conjunto do c8, semântica de `operational`, sunset, `env: {}` do supervisor, corpos de PR antigos, distribuição global.
- Escopo heterogêneo e paralelizável: CI, MCP, redação, gates de mutação, lock/controle, rollback, swarm, docs.

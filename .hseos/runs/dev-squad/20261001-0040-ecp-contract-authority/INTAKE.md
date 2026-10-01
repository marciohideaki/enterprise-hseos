# INTAKE — 20261001-0040-ecp-contract-authority

## Pedido do owner
Planejar e implementar ajustes, correções e implementação em ECP, cores e HSEOS para que conversem
entre si com regras e contratos definidos; a opção deve ser habilitável na instalação (projetos podem
declarar deliberadamente que não têm biblioteca de pacotes e implementam localmente).

## Decisões registradas (AskUserQuestion, 2026-10-01)
- Execução: dev-squad/SWARM.
- Autoridade de contratos: ECP único (inclui contratos visuais).
- Estratégia por stack: separar por tipo (`service` no runtime ECP + SDK fino; `library` por stack nos cores).
- Opt-out: modo por projeto (`platform | hybrid | local`) + override por capability.
- Regras de não atribuição permanecem; autor git configurável.

## Heterogeneidade (trigger dev-squad)
Três repositórios (ECP, cores, HSEOS), trabalho misto: ADR/governança, schemas, Python stdlib, Node CLI,
hooks, testes de conformidade em .NET/Node/Python/Go, CI. Paralelizável por wave após W0.

## Escopo
W0–W3 do plano aprovado (`PLAN.md`). Fase 2 (migração em massa, design system, federação, SDKs tipados) fora.

## Evidência de descoberta
Três explorações read-only (ECP, cores, HSEOS) e uma revisão adversarial do plano; achados incorporados
em `PLAN.md` (seções Context e amendments).

# INTAKE — 20261008-2350-next-steps

Commander: SWARM (Opus). Base: `master` @ `b35ac0dc`. Data: 2026-10-08.

## Lote pedido pelo owner
1. Spike de parser real para o guard, com relatório e protótipo, sem merge.
2. Decidir o que fazer com as 305 divergências de `canonical_rules`.
3. Anunciar `.claude/settings.json` e `.mcp.json` em `PLATFORM_SURFACES`.
4. Atualizar o snapshot ECP quando sair uma tag `contracts-v*` nova.

## Gate G1 — respostas do owner (2026-10-08)
| Item | Decisão |
|---|---|
| 1 | Spike **só com o compilador TypeScript** (sem acorn+plugin). Relatório + protótipo, sem PR/merge. |
| 2 | Aceitar os grupos a (103 MUST×MUST_NOT) e b (163 com INFORMATIVE) como falso positivo da heurística; revisar à mão o grupo c (39), somente leitura, relatório sem editar specs. |
| 3 | Anunciar as superfícies quando existirem em disco (filtro atual de `buildAdaptersBlock`); aceito que um `settings.json` do usuário também apareça. |
| 4 | Deixar pendente. Sem tag nova: o lock está em `contracts-v0.4.0`, a mais recente do ECP. O ECP já mergeou a migração de org (#39, 2026-10-07), mas sem tag. |

## Fatos verificados no Intake
- Guard: `tools/cli/lib/capability-intake-guard.js`. `typescript@5.9.3` já resolve em `node_modules` (não está declarado como dependência de runtime).
- Base de regras: `/workspace/default-workarea/ai-governance/db/ai-governance-rules.db` (externa, 85 MB, 2026-09-14). Somente leitura.
- Relatório N12 anterior: `.hseos/runs/dev-squad/20261007-1211-pendencies-waves/REPORTS.md`.
- `PLATFORM_SURFACES`: `tools/cli/installers/lib/core/agent-core-compiler/adapters/platforms.js:22`; filtro por disco em `manifest/builder.js:19`.
- Host: load 3.6 no Intake.

## Escopo heterogêneo e paralelizável
Os itens 1, 2 e 3 não se tocam. O item 4 sai do run por estar bloqueado por algo externo.

> **G2 — Plan approval: APPROVED** pelo owner em 2026-10-06 (aprovação do plano em sessão, ExitPlanMode; instrução "Prossiga com o Opus como Commander e Sonnet no /dev-squad").
> Run-id: `20261006-2040-pendencies-closeout`. Commander: SWARM (Opus). Squads: Sonnet. Fonte: plano de sessão aprovado (pendências pós-sessão 2026-10-06).

# PLAN — Pendências pós-sessão 2026-10-06

## Escopo desta execução

Somente itens **executáveis sem decisão do owner**. Itens com gate de decisão (D1–D9) e ações humanas (merge da #197, aprovação Engineering Leadership da #191) ficam fora da execução dos squads.

## Branch map

- HSEOS W1: `master` → `feature/pendencies-closeout-w1`. Tasks via `worktree-manager.sh` (`task/<id>`).
- HSEOS W0: `feature/core-standard-ecp-modes` (PR #191) recebe merge da `master`; conflito de `CHANGELOG.md` resolvido à mão. Sem mudança de conteúdo no Standard.
- backend-core W2: `origin/develop` → `feature/pendencies-closeout-w2`. O repo não tem `scripts/governance/`; segue `task/<id>` + 1 commit + merge `--no-ff` no `feature/*` (mesmo contrato adotado para o ECP no run `20261001-0040`).

## Task DAG

| Task | Wave | Repo | Branch | Entrega | Tier | Depende |
|---|---|---|---|---|---|---|
| H-02 | W0 | HSEOS | `feature/core-standard-ecp-modes` | #191 atualizada com master, conflito resolvido | Sonnet (low) | — |
| H-05 | W1 | HSEOS | `task/h05-state-ui-port` | `test/test-state-ui.js` sem porta aleatória (`listen(0)`/porta lida de volta) | Sonnet (low) | — |
| H-09 | W1 | HSEOS | `task/h09-commit-validator-residues` | validador + Gate 5 rejeitam os 4 resíduos, com casos negativos | Sonnet (medium) | — |
| B-01 | W2 | backend-core | `task/b01-compile-gate-test` | teste que falha sem o lock de `Compile` | Sonnet (medium) | — |
| B-03 | W2 | backend-core | `task/b03-verify-bundle-sha` | `verify-vendor.mjs` recomputa `bundle_sha256` + teste negativo | Sonnet (low) | — |
| B-02 | W2 | backend-core | `task/b02-jsonschema-940` | JsonSchema.Net 9.4.0 com `SchemaRegistry` por store; gate global mantido | Sonnet (high) | B-01 |

## Bloqueados (fora desta execução)

| Item | Bloqueio |
|---|---|
| H-01 merge #197 | G5 — owner |
| H-03 aprovação EL da #191 | Constitution §13 — owner |
| H-04 timeout do smoke | D4 |
| H-07 lexer / H-08 anti-downgrade | D5 / D6 |
| W3 (Slice 0, Slice 1a) | D3 |
| Fase 2 slices 1b–6 | D1, D2, D8, D9 |
| B-04 `npm audit` | D7 |
| B-05, B-06, E-08, E-09 | externo / autorização |

## Invariantes

- 1 task = 1 commit; mensagens validadas por `validate-commit-msg.sh`; sem trailer de coautoria nem menção a ferramenta.
- §3f: `heavy-run` em toda build/suíte; `npm test` do HSEOS e `dotnet test` do backend-core nunca concorrentes; testes .NET por projeto com `-m:1`.
- Revisão cética isolada por task (cega → confronto), no máximo 3 rodadas.
- Nenhum limite, threshold ou gate afrouxado. BLOCKED nunca vira PASS.
- `HSEOS-GOAL-HARNESS-AUTONOMO.md` preservado (não rastrear, não apagar).
- PR aberto pelo owner (G4); merge pelo owner (G5).

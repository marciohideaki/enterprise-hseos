# GOAL-GRAPH — 20261007-2130-guard-tokenizer

Commander: Opus (sessão principal). Squad e revisores: Sonnet (Workflow `guard-tokenizer-20261007`). Base: master `4bff762e`.
Plano: plano de sessão do owner `replicated-wibbling-wreath` (fora do repositório).

## Context

Três pendências da retomada de 2026-10-07:

1. Trocar o lexer do guard por um tokenizer real. Duas variantes ainda escondem código: uma divisão seguida de regex, combinada com `//` ou com aspas.
2. Ligar `test/test-shared-infra-drift.js` a um script npm.
3. Fazer o `ecp-drift.yaml` ler `repository` do lock.

## Gap-map

- **Já existe:** a pendência 2 está resolvida na master. `package.json:174` define `test:shared-infra-drift`, `package.json:74` o encadeia no `npm test`, e `ci.yaml` roda `npm test`. Não gera nó.
- **Falta:** N1 e N2.
- **Premissa errada:** a nota de "não ligado a script npm" no `STATUS.md` do run `20261007-1211` ficou desatualizada.

## Nós

| id | mini-goal | allowed_paths | verify_step | tier | tipo |
|---|---|---|---|---|---|
| N1 | Checkout do ECP lê `repository` do lock via `readSnapshotLock` | `.github/workflows/ecp-drift.yaml`, `test/test-platform-bindings-command.js` | teste do workflow + yaml/prettier | Sonnet | ci |
| N2 | `tokenizeJs` vira a view principal do guard; `lexLegacyFast` fica como piso; as views heurísticas saem | `tools/cli/lib/capability-intake-guard.js`, `test/test-capability-intake-guard.js`, `package.json` (só devDependency acorn), `package-lock.json`, `CHANGELOG.md` | suíte do guard, 2 `knownAllow` negados, superset da master, fuzz contra acorn (6k no commit, 600k ad hoc) | Sonnet + arbitragem Opus | security-gate |

## DAG

N1 e N2 são independentes e rodam em paralelo. Cada nó segue o fluxo: exec → (N2: caça de bypass, até 2 rodadas secas ou 3 ciclos) → revisão cega → confronto → até 3 correções.

## Execution Protocol

- 1 nó = 1 worktree (`.worktrees/n1-ecp-drift-lock-repository`, `.worktrees/n2-guard-real-tokenizer`) = 1 commit.
- 1 wave = 1 PR:
  - Wave A: `feature/ecp-drift-lock-repository`.
  - Wave B: `feature/guard-real-tokenizer`.
- Merge só por `hseos pr closeout <n> --approved`, com aprovação explícita do owner.
- Sem atribuição de IA em commit ou PR.
- Nunca afrouxar o gate de superset da master.
- Nunca converter BLOCKED em PASS.

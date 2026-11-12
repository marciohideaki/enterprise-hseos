# TD3 — gate de prontidão do terminal e pacote de entrada da W6 (GM-16)

Regras comuns: `prompts/TB-executor-common.md`. Especificação base: seção "TD3" de `prompts/TD-tasks.md`. Os **valores** abaixo são decisão do
Commander; o executor os transcreve, confere que cada caminho de evidência existe e escreve o teste que os valida. Se um caminho não existir,
**pare e relate** (não invente outro).

## 1. `docs/evolution/terminal-closeout/terminal-readiness.json`

```
{ "schema_version": 1, "revision": "<git rev-parse HEAD do worktree no momento>", "verdict": "TERMINAL_PRONTO_COM_GATES_DECLARADOS",
  "owner_gates_file": ".hseos/runs/dev-squad/20261111-terminal-closeout/OWNER-GATES.md",
  "w6_entry_file": "docs/evolution/terminal-closeout/W6-ENTRY.md",
  "criteria": [ ... T1..T12 ... ], "families": [ ... ] }
```

Critérios (`result` e `result_source` exatamente como abaixo; `evidence` = caminhos relativos no checkout; `mechanism` e `command` curtos):

| id | result | evidence | result_source |
|---|---|---|---|
| T1 | ok | `.hseos/runs/dev-squad/20261111-terminal-closeout/STATUS.md`, `package.json`, `.c8-kernel.json` | "npm test exit 0 e npm run lint exit 0 em 75382d1c (heavy-run, Node 24.15.0); test:kernel-coverage e test:node22-compat: ver STATUS, seção T1; CI da master: ver STATUS" |
| T2 | ok | `docs/evolution/requirements.json`, `test/test-kernel-quality-surface.js`, `test/test-evolution-trace.js`, `test/test-terminal-readiness.js` | "guards pass; conflito de F01/F11/F16/F21 com o ADR-0050 declarado no inventário e ligado ao OG-01" |
| T3 | ok | `docs/evolution/requirements.json`, `.hseos/runs/dev-squad/20261111-terminal-closeout/OWNER-GATES.md` | "21 de 22 famílias de W0-W5 em verified_w<N>_scope_only; F17 classificada OWNER_DECISAO (OG-05)" |
| T4 | ok | `.hseos/runs/dev-squad/20261111-terminal-closeout/OWNER-GATES.md`, `docs/evolution/requirements.json` | "5 verificadas em escopo local; 17 not_verified, todas com classe e OG" |
| T5 | ok | `docs/evolution/terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md`, `docs/evolution/terminal-closeout/evidence/core-journey-result.json`, `docs/evolution/terminal-closeout/evidence/mcp-legacy-journey-result.json`, `docs/evolution/terminal-closeout/evidence/mcp-modern-journey-result.json`, `docs/evolution/terminal-closeout/evidence/upgrade-rollback-result.json`, `.github/workflows/core-journey.yaml` | "core-journey PASS 12, mcp legado PASS 144, moderno PASS 507; upgrade, downgrade e rollback provados; migração de banco ativado entre schemas sem caminho (OG-16)" |
| T6 | ok | `test/test-terminal-control.js`, `test/test-terminal-executor.js`, `test/test-terminal-api.js`, `test/test-job-control.js` | "crash nas 6 fronteiras, cancelamento transitivo, 401 por ação, job adiado após morte do controlador" |
| T7 | ok | `test/test-secret-canary-scan.js`, `test/test-budget-concurrency.js`, `test/test-provider-egress-broker.js`, `test/test-agent-transitive-isolation.js`, `test/test-engineering-model.js`, `test/test-mcp-preapproval-refusal.js` | "canário, teto agregado com 6 processos, egress, isolamento, sem pool de identidades, aprovações" |
| T8 | ok | `test/test-compaction-resume-fork.js`, `test/test-compaction-agent-run.js`, `test/test-terminal-control.js`, `docs/evolution/terminal-closeout/evidence/core-journey-result.json` | "resume, replay e fork equivalentes; recuperação sem relançar efeito; crash e reinício na jornada instalada" |
| T9 | ok | `docs/terminal.md`, `scripts/governance/verify-doc-facts.sh`, `test/test-documentation-neutrality.js`, `tools/cli/command-manifest.json` | "verify-doc-facts rc=0; neutralidade pass; check:cli 0" |
| T10 | ok | `.hseos/runs/dev-squad/20261111-terminal-closeout/STATUS.md`, `scripts/governance/validate-commit-msg.sh` | "PRs #314, #315, #316 e a da onda TD com checks verdes e CLEAN; tags hseos-terminal-wa..wd; 0 atribuição" |
| T11 | ausente | (vazio) | "reauditoria final pendente" |
| T12 | ok | `docs/evolution/terminal-closeout/W6-ENTRY.md` | "seções obrigatórias presentes" |

Famílias (`wave` numérico; F23 sem onda no inventário conta como 0; status copiados do `requirements.json`; `classes` só para o eixo não
verificado; `owner_gates` lista de ids):

| id | classes | owner_gates |
|---|---|---|
| F01, F11, F16, F21 | — | OG-01 |
| F20 | — | — |
| F02, F03, F05, F09, F10 | real_consumers: GASTO_NECESSARIO | OG-02 |
| F06, F13 | real_consumers: GASTO_NECESSARIO | OG-03 |
| F08, F18 | real_consumers: GASTO_NECESSARIO | OG-04 |
| F17 | deterministic: OWNER_DECISAO; real_consumers: OWNER_DECISAO | OG-05 |
| F14, F15 | real_consumers: OWNER_DECISAO | OG-06 |
| F19 | real_consumers: OWNER_DECISAO | OG-07 |
| F04, F12, F22 | real_consumers: OWNER_DECISAO | OG-08 |
| F23 | real_consumers: DESENHO_ABERTO | OG-09 |

## 2. `test/test-terminal-readiness.js`

Exporte (ou mantenha no arquivo) uma função `validateReadiness(doc, {requirements, ownerGatesText, w6EntryText, exists})` que devolve a
lista de problemas, e testes que: (a) o documento real não tem problemas; (b) cada adulteração abaixo produz pelo menos um problema:
T faltando, T duplicado, `result: ok` sem evidência, evidência que não resolve para arquivo dentro do checkout (inclusive `../`),
família de W0-W5 faltando ou sobrando, status divergente do `requirements.json`, eixo não verificado sem classe válida ou sem `owner_gates`,
`owner_gates` que não aparece no `OWNER-GATES.md`, `verdict` fora do enum, `verdict: TERMINAL_PRONTO` com alguma família em
`real_consumers: not_verified`, `verdict` diferente de `NAO_PRONTO` com algum de T1, T2, T5-T10, T12 diferente de `ok`, `W6-ENTRY.md`
sem uma das seções obrigatórias. T11 pode estar `ausente` em `TERMINAL_PRONTO_COM_GATES_DECLARADOS` (é NÃO DETERMINÍSTICO; o teste
documenta isso num comentário com o controle compensatório: duas passagens, confronto e fatos conferidos pela ferramenta).
Registre `test:terminal-readiness` no `package.json` e no agregado `test` (perto de `test:evolution-trace`); rode `ci-test-shards verify`.

## 3. `docs/evolution/terminal-closeout/W6-ENTRY.md`

Seções obrigatórias: `## Superfície estável`, `## Versões`, `## Cursor de eventos`, `## Terminais`, `## Aprovação`, `## Riscos`,
`## Gates do owner`, `## Fora de escopo`. Conteúdo factual tirado do código e dos docs (cite arquivo:linha): prefixo e versionamento da API
(`docs/engineering-control-api.md`), versão do SDK (`packages/control-sdk/package.json` ou equivalente), protocolos MCP suportados
(`tools/lib/mcp-2026-adapter.js`: moderno `2026-07-28` e compat), `user_version` do ledger ativado (17) e o risco OG-16, cursor de eventos
(`after`, `next_cursor`), ações de terminal (input, resize, interrupt, eof, attach, terminate), aprovação separada de conclusão (MRTR,
`input_required`), riscos (OG-16, OG-11, Linux only, cgroup/bwrap), gates do owner relevantes à IDE (OG-01, OG-04, OG-16) e "Fora de escopo"
(a W6 não foi iniciada; nenhum fork do Code OSS). **Não iniciar a W6.**

## Aceite

`node --test --test-concurrency=1 test/test-terminal-readiness.js` verde (cole contagens); cada caso negativo falha pelo motivo certo
(mostre); `test-kernel-quality-surface.js` verde; shards ok; prettier/eslint (rtk proxy) ok; neutralidade ok. Atenção: mudar o
`package.json` torna obsoleto o ensaio da F14 v4 (D6) — **não** o regenere nesta task; o Commander faz isso numa task própria.

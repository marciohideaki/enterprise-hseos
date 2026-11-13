# TRIAGE — achados dos 3 auditores (Commander)

Aceitos (com reconferência do Commander onde mudam fato): D1, D2, D3 (`README.md:5` badge `agents-16`; `ls .hseos/agents/*.agent.yaml` = 15), D4, D5 (revisões compat em `tools/lib/governed-execution/native-mcp-server.js:110`), D7, A1/D6 (`docs/compatibility-retirement.md:5` contra ADR-0048 e `native-mcp-server.js:112-116,161`), A2, A3, E1–E13, E15–E23, E25.
Recusados: **D8** (refutado: `CHANGELOG.md` já tem "Terminal closeout (W0–W5)" no `[Unreleased]`, #318); **A4** (o `AGENTS.md` rotula 0.162.1 como versão do spike; não é falso); **E24** (sem divergência).
Ajuste de método: **E11–E14** — as tabelas do MAPA §8 são retratos datados (2026-10-27); não reescrever as células, e sim acrescentar logo após a tabela uma nota "Estado das PRs (conferido em 2026-11-13)" com #255 `af1c4529`, #256 `773d8ccc`, #257 `f953992b` mescladas (E14: só citar PR depois de confirmar com `git log`).

| Task | Arquivos | Achados |
|---|---|---|
| DR1 | `README.md`, `docs/README.md`, `docs/terminal.md` | D1, D2, D3, D4, D5, D7 |
| DR2 | `docs/compatibility-retirement.md`, `docs/v4-migration.md` | A1/D6, A2, A3, nota opcional do v4-migration (ponteiro ao ADR-0048) |
| DR3 | `docs/evolution/_INDEX.md`, `PLAN.md`, `STATUS.md`, `pendencias-w0-w5/MAPA.md`, `runbooks/*.md`, `terminal-closeout/W6-ENTRY.md` | E1–E13, E15–E23, E25 |

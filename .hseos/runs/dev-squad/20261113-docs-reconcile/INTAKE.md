# INTAKE — run `20261113-docs-reconcile`

- **Pedido do owner (2026-11-13, terminal):** "Faça uma análise completa da documentação do repositório e atualize frente à nova implementação."
- **Nova implementação:** fechamento do terminal W0–W5 (run `20261111-terminal-closeout`, PRs #314–#318, tags `hseos-terminal-wa`..`wd` e `hseos-terminal-close`): testes de invariantes, aceite instalado, `docs/terminal.md`, gate `docs/evolution/terminal-closeout/terminal-readiness.json` (`test/test-terminal-readiness.js`), `W6-ENTRY.md`, OWNER-GATES OG-01..OG-17, README com 54 skills.
- **Base:** `master` `e5835a71`.
- **Escopo:** documentação viva — `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, `docs/*.md`, `docs/pt-br/`, `docs/v4/`, `docs/decisions/`, topo de `docs/evolution/` (`_INDEX.md`, `STATUS.md`, `PLAN.md`, `INTEGRATION.md`, `W0-CLOSEOUT.md`, `requirements.json` só textos), `docs/evolution/runbooks/`, `docs/evolution/pendencias-w0-w5/MAPA.md`, `docs/evolution/terminal-closeout/`, `test/journeys/README.md`.
- **Fora do escopo:** recibos históricos (`docs/evolution/w*/`, `**/evidence/**`, `REAUDIT-*`, campanhas) — imutáveis, não se reescreve histórico; `.agents/**` (saída do compilador); `HSEOS-GOAL-HARNESS-AUTONOMO.md` (arquivo alheio não versionado, preservar); código de produto; status de família.
- **Restrições:** sem gasto; sem mudar `package.json` (o hash da F14 v4 o cobre); capacidade do pacote fixa (docs empacotados são lista explícita em `files`); sem nome de fornecedor de IA nos docs (`test/test-documentation-neutrality.js`); fatos de ferramenta, nunca de memória.
- **Merge:** a PR desta run **não** tem autorização de merge registrada; parar antes do merge e pedir ao owner (`AGENTS.md` §9).
- **Modelo:** Commander na thread principal; exploradores, executores e revisores Sonnet.

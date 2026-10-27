# W8 — janela de ativação (preparação; NADA executado) — 2026-10-22

Fonte: ensaio do passo 1 (`/build/tmp/hseos-w5/w8-rehearsal/` — evidence/, bin/), runbook `docs/evolution/runbooks/activation.md`, W8-PREFLIGHT.md. Autorização: owner aceitou o ADR-0048 em 2026-10-22; W8 em lote com gates (para no primeiro BLOCKED); execução depende do "go" do owner com o SHA final.

## Pré-requisitos (nesta ordem)
1. PR de aceite do ADR-0048 mergeada na master → esse commit é o `SHA` da distribuição (a CLI lê o ADR da árvore instalada; sem o Accepted no SHA o passo 1b falha).
2. Worktree LIMPO em `SHA` (o checkout principal tem não rastreados).
3. Owner fecha as sessões que mantêm o banco: preflight de 17:12 achou 19 processos MCP hseos com o project.db aberto/registrado (project-state, governance e swarm do release `2b4d6f37` e 4 do global pids 2522/2524/2525/2526), 6 `codex` e 7 `claude` ativos, 20 servidores MCP hseos. ~393 processos de outros usuários não inspecionáveis. Fechar as 6 sessões Codex (e quaisquer MCP hseos órfãos) — eu NÃO derrubo processos do owner.
4. `w8-preflight.sh` (somente leitura) limpo: sem holders do project.db, `-wal` sem dados (ou checkpoint pelo apply), load1 ≤ cores físicos, HEAD == origin/master == SHA, host hashes registrados.

## Sequência (cada passo: backup → ação → verificação → receipt → rollback testado; BLOCKED para tudo)
1. Distribuição global (`w8-step1-dist.sh <SHA> --apply`, `w8-step1-verify.sh`, rollback `w8-step1-rollback.sh`): comandos exatos no REPORT do ensaio: npm pack (worktree limpo) → tar para STAGE → cópia do package-lock → `npm ci --offline --omit=dev --ignore-scripts` → `npm rebuild better-sqlite3 --offline` → `mv -T` para `/workspace/local/tooling/hseos-releases/<SHA>` → `npm install -g <tgz absoluto> --prefix <prefixo do Node 24.15> --offline`. Verificação por `^Usage: hseos liveness ` (não por rc do --help). Receipt `~/.local/state/hseos/distributions/<SHA>/verification.json` (manual: owner_authorization, risk, entry_count). Rollback: reinstalar o tarball de `2b4d6f37`.
2. 1b.0 config `environment:` (~/.config/hseos/config.yaml, com backup) — só se o owner quiser capacidades de ambiente/memória; sem a seção o MCP sobe só com governança.
3. 1b ativação: `hseos execution-activation plan --db <project.db> --adr ADR-0048 --backup-dir <dir>` → `apply` (backup por cópia de bytes + sha256 + integrity_check; receipt) → trocar `args` dos 3 MCPs do Codex para o release novo (manter HSEOS_STATE_DB) → verificação: Codex lista as ferramentas modernas e `hseos liveness check --json`. Rollback: `rollback` (bytes idênticos; banco ativado preservado ao lado) + re-registrar o legado (`2b4d6f37`).
4. Hooks Codex `trusted_hash` (CODEX_HOME REAL só depois do backup): anexar o template ao FIM de cada evento; usar `key` e `currentHash` de `codex app-server hooks/list` (eventos snake_case). Rollback: restaurar config.toml/hooks.json do backup.
5. Timer do watchdog (`liveness watch --print-systemd` do release instalado; `systemd-analyze --user verify`; enable; 1 ciclo exit 0).
6. Contratos `enabled: true` no enterprise-hseos (PR curta) e 1 ciclo observado.
7. Push das tags `hseos-w5-g6` e `hseos-w5-closeout-w{0..6,10}`.

## Decisões do owner ainda abertas (não bloqueiam o passo 1 nem o 1b)
data do sunset (sem data: a compat não expira); `tools/call`/MRTR do Codex (exige login/gasto); navegador/computer-use na CLI.

## Riscos
- `npm install -g` substitui o diretório global do hseos com processos vivos (pids 2522/2524/2525/2526 + MCPs do release antigo): fechar antes.
- Reabrir as sessões após a troca; hash dos hooks muda a cada redistribuição.
- O WAL de 663 KB com dados: o `apply` faz checkpoint, mas bloqueia se outro processo segurar o banco.

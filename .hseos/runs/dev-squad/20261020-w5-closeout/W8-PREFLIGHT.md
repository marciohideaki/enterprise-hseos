# W8 — levantamento de pré-voo (somente leitura, 2026-10-22)

Alvo da ativação (piloto): `/workspace/github/marciohideaki/enterprise-hseos/.hseos/state/project.db` (156 KB; `-wal` 648 KB com dados; `-shm` 32 KB; `mcp-legacy-usage.db` ao lado).

## Processos que mantêm o project.db aberto agora (todos servidor MCP project-state legado)
| PID | Origem |
|---|---|
| 1477865, 153015, 1724958, 3796654 | `~/.nvm/.../node` com o release `2b4d6f37…/tools/mcp-project-state/index.js` (sessões Codex) |
| 2525 | `hseos` global (`…/lib/node_modules/hseos/tools/mcp-project-state/index.js`) |
Precisam estar PARADOS no `apply` (o lock de escrita e a varredura de /proc recusam). A lista é por instante: refazer na janela.

## Consumidores a re-registrar no moderno
- `~/.codex/config.toml`: `hseos-governance`, `hseos-state-tracking` (project-state) e `hseos-swarm`, todos com o release `2b4d6f37…` e `HSEOS_STATE_DB` apontando para o project.db piloto; `hseos-axon-bridge` está `enabled = false` (url http://127.0.0.1:3103/).
- Claude Code: `~/.claude.json` e `~/.claude/.mcp.json` NÃO registram servidores hseos (só axon/playwright) → nenhuma ação de MCP.
- Hooks (não são MCP, não abrem o banco): `~/.claude/settings.json` (8 entradas hseos: governance-context do release `2b4d6f37…`, `session-track.sh`/`swarm-gate.sh`/`claude-md-guard.sh` do checkout) e `~/.codex/hooks.json` (4 entradas do release). Apontam para o release imutável: redistribuição (W8 passo 1) muda o hash (`trusted_hash`) → refazer o passo 3.
- O checkout `/workspace/github/marciohideaki/enterprise-hseos/.agents/hooks/handlers/*` é referenciado pelos hooks do Claude Code: a higiene W9 NÃO pode remover/mover o checkout principal.

## Pontos a lembrar na janela
- Env `HSEOS_LEGACY_TELEMETRY_DB` aponta para `mcp-legacy-usage.db` (contador de uso legado): o moderno em compat continua incrementando.
- Trocar `args` do Codex para o release novo e manter `HSEOS_STATE_DB`; o `project_state` moderno lê `--config=<caminho>` (padrão `~/.config/hseos/config.yaml`; seção `environment:` ainda inexistente → sem capability, só governança).
- Rollback: restaurar backup (cópia de bytes, sha256 do receipt) + re-registrar o legado (release `2b4d6f37…`).

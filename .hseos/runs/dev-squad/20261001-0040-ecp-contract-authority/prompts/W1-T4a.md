# Prompt W1-T4a (squad Sonnet) — configurable author identity (Decision 0008)
Worktree: <scratch>/w1-t4 · branch task/0044a-configurable-author · base feature/ecp-portability-author (develop 65089c9)
Entrega: validate_contracts.py com padrão via ECP_ALLOWED_AUTHOR_PATTERN > pyproject [tool.ecp.governance] > default;
denylist de IA fixa em nome e email; email vazio falha exceto CI=true (esclarecimento registrado na Decision 0008);
pyproject, AGENTS.md, CONTRIBUTING.md; tests/test_author_identity.py; intent 0044 (T4a/T4b).
Regras: gate verde; restaurar manifest MCP; identidade atual via GIT_CONFIG_*; 1 commit
`feat(governance): make the allowed commit author identity configurable`; sem trailer/termos de IA; sem push/merge.

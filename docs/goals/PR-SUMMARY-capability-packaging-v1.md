# PR Summary — feature/capability-packaging-v1

> Pronto para uso como corpo do PR (governança §9: sumário de execução + resultados de validação).
> Detalhes por ciclo: `docs/goals/reports/2026-07-08-ciclo-0{1..9}.md` · Spec viva: `docs/pt-br/especificacao-hseos.md` (§12).

## Contexto

Os commits de decom de 2026-06-08 gravaram um `git stash pop` conflitante sem resolução (8 arquivos com marcadores no HEAD — `.claude/hooks.json` ficou com JSON inválido, desativando todos os hooks; o shim do compiler quebrava `install`/`agent-core`/`plugin`). Este branch contém o reparo validado desses conflitos mais **nove ondas de consolidação** executadas sobre o repo com o código como fonte de verdade.

## Correções de defeitos reais

| Defeito | Impacto | Correção |
|---|---|---|
| `gate_security` era **no-op desde a origem** (brace-glob `--include="*.{js,...}"` que o grep não expande) | Zero arquivos escaneados por secrets, sempre | Reescrito com `git grep` sobre rastreados; calibrado sem falso-positivo; `.env` rastreado também falha |
| Integridade quebrada: 42/49 skills com hash divergente do manifest | `verify` falhava; conteúdo Wave-4 (trigger/skip) existia SÓ no compilado — um compile o apagaria para sempre | trigger/skip resgatados para a fonte `.enterprise` (42 harvest + 6 autorados + 1 existente = 49/49); manifest regenerado |
| `xml-handler.js#injectActivationSimple` referenciava variável indefinida e ERA chamado (`_base-ide.js:508`) | `ReferenceError` no caminho de install de agentes | Método removido + call site limpo (direção já indicada no código) |
| Bundle declarava axon-bridge `transport: stdio`; implementação é HTTP-only | Adapter que o spawnasse via stdio travaria para sempre | Declaração corrigida para `http` |
| `mcp-transport.js` sem `await` em `callTool` | Tool async futura serializaria `{}` silenciosamente | Transporte async-safe fim-a-fim |
| Idempotência do installer por mtime (2 dos 3 algoritmos) | Checkout/npm pack resetam mtime → **edições do usuário clobberadas** em update | `FileOps.syncFileSafe` content-addressed (primitiva única); preserva e reporta; `--force` para overwrite |
| `test-state-purge.js` órfão de CI com replay de migrations caseiro | Teste apodrecido mascarando cobertura | Usa o runner real (`user_version`); asserções corrigidas; 8 testes órfãos promovidos ao `npm test` |
| Lint local varria `.logs/` gitignored; `format:*` quebrados (plugin prettier ausente) | Gates locais ≠ CI; backlog de 84 arquivos sem formato | eslint ignora `.logs/`; plugin instalado; `.prettierignore` protege árvores geradas |

## Evolução estrutural (fonte → compilado → adapters)

- **Hooks com fonte única**: `.enterprise/governance/hooks/{registry.yaml,handlers/}` é canônico; `.agents/hooks/` é 100% gerado; handlers hash-pinned (`verify`: 65→**88 checks**); fallback preserva projetos pré-migração.
- **Manifest verdadeiro**: `adapters{}`/`platforms` derivados do realmente emitido; `--target` sem emissor é erro explícito; **GooseAdapter fiado** (`--target goose` funcional — referência BYOA do ADR-0007).
- **Audit explicável**: triangulação fonte×compilado×manifest com vereditos direcionais (`source edited` / `hand-edited` / `manifest stale` / `diverged`) e remédio por artefato (114 checks).
- **Enforcement não-bypassável**: fase `--phase ci` no job `governance` (required check) com secret-scan de árvore e higiene de mensagens (HEAD bloqueante; range advisory — squash-merge limpa histórico).
- **Capabilities**: 49/49 skills em famílias; `prerequisites` de primeira classe exibidos pelo `install-plan`; extras (`extra:rtk` etc.) como componentes opt-in puro — RTK declara o patch global no próprio plano.
- **MCP**: `MCP_PROTOCOL_VERSION` centralizado; contrato runtime dos 4 servers testado; RFC pós-GA 2026-07-28 pronto para promoção a ADR (`docs/rfc/`).

## Decisões de governança executadas (aprovação explícita do owner em 2026-07-08)

1. **swarm-gate canônico**: registry/adapters fiados a `.agents/hooks/handlers/swarm-gate.sh` (model routing + skill-check + gate); versão antiga removida — a regra "executor declara sonnet; Opus só com opt-in" roda de fato.
2. **ADRs ratificados**: 0006–0010, 0012, 0016 → Accepted (2026-07-08); 0004/0005 saneados como templates; seção `## Authority` Tier-1 no dev-squad SKILL.md (conformidade ADR-0015).

## Mudanças de comportamento (deliberadas)

- `updateCore`/`syncModule`: **preservam e reportam** arquivos modificados em vez de sobrescrever por mtime (`--force` mantém overwrite).
- `agent-core compile --target all` = `claude-code,codex,goose` (só plataformas com emissor); targets sem emissor rejeitados.
- Job `governance` do CI roda `--phase ci` (antes `--phase doc`) com `fetch-depth: 0`.
- `.agents/hooks/registry.yaml` é gerado (edições manuais de comentários são reescritas; hooks editam-se na fonte `.enterprise`).

## Validação

`npm test` completo verde (≈25 suítes JS + 5 shell, incluindo ~100 asserções novas destas ondas) · `agent-core verify` **88/88** · `agent-core audit` 114 checks sem drift · `quality-gates --phase ci` e `--phase code` verdes · `format:check`/`lint` verdes.

## Checklist pós-merge (operador)

- [ ] `npm run branch-protection:apply` — materializa o required check `governance` no GitHub
- [ ] Sync do espelho externo Tier-3 do dev-squad (protocolo ADR-0015)
- [ ] Decidir: RFC MCP → ADR · plugins-emit (ADR-0009) · `enforce_admins: true` · merge `task/stacked-branch-policy` (ADR-0017, desbloqueado) · limpeza `replay-mode.active`
- [ ] Pós-GA MCP (2026-08-27 deadline do RFC): implementar diffs do subset e bumpar `MCP_PROTOCOL_VERSION`

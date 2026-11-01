# MRTR com consumidor real: Claude Code 2.1.316 (2026-10-31)

Autorização do owner (2026-10-31):
- "1: Liberado". A allowlist foi liberada só durante a campanha, na leitura de menor privilégio.
- "Você roda no terminal". A sessão interativa foi do owner.

## Ambiente
- **Cliente:** Claude Code 2.1.316, em sessão interativa no terminal do owner.
- **Servidor:** `hseos-state-tracking` do release `2d2da31ffea41971b39ed9d4001f70950a2d575e`, que é a master depois da W10, com os schemas reais publicados.
- **Banco:** cópia instantânea do `project.db` ativado, com `integrity_check` ok e `user_version` 17. O banco real não foi aberto nem escrito pela campanha.
- **Config:** própria da campanha, com `environment.memory` (regra de escrita `allow` e `operator` owner). A config global não foi tocada.
- **Allowlist:** `hseos-state-tracking` foi incluído na `allowedMcpServers` do `~/.claude/settings.json` só durante a janela. Depois ela foi restaurada por hash (`6b38cb6f…`, conferido com `sha256sum -c`).

## Sequência
1. **Headless (`claude -p`), duas rodadas, cerca de US$ 0,71 estimados.**
   - O protocolo `2026-07-28` foi negociado. Isso fica provado porque `memory_write`, `memory_retrieve` e `memory_delete` aparecem no `tools/list`, e não existem na compatibilidade `2024-11-05`.
   - O defeito do HSEOS apareceu aqui. Com `inputSchema` aberto, o modelo enviou `scope` e `ttl_seconds` como string e recebeu `AGENT_MEMORY_INVALID`. Isso foi corrigido na W10 (#268).
   - O modo headless não declara `elicitation`. O servidor responde `-32021` e o cliente mostra "Internal error".
2. **Interativo, depois da W10.** O owner rodou o prompt de `PROMPT.txt`.
   - `memory.write` retornou `ok: true`, `operation_id` `a6b23273-afa1-56cc-8a9e-4ccb0c4b16e6`, `write_policy_ref` `rule:memory-write` e `replayed: false`.
   - `memory.delete` retornou `ok: true` e `deleted: true`, `operation_id` `afb4f28d-1ec7-58e1-8267-aa21c697cbc0`, com a evidência `hseos://mcp/project_state/elicitation/8f081506-4924-476a-8d8c-187d27197744`.
   - **O owner confirmou** que o pedido de aprovação ("Approve deleting memory mrtr-live-1 …") apareceu e que ele aprovou.

## Ledger da cópia (extrato completo em `~/.local/state/hseos/campaigns/mrtr-claude-20261031-interactive/ledger-extract.json`)
| Posição | Evento | Agregado |
|---|---|---|
| 16858–16861 | ExecutionAuthorized → Started → `memory.written` → Succeeded | `a6b23273…` / `mrtr-campaign` |
| 16862–16865 | ExecutionAuthorized → Started → `memory.deleted` → Succeeded | `afb4f28d…` / `mrtr-campaign` |

- `execution_approvals` `8f081506…`: resposta à elicitação, `decision: approved`, política `hseos-w5-capability-v1`.
- `execution_approvals` `e5980e6d…`: aprovação derivada para `memory.delete:mrtr-campaign:mrtr-live-1`, `authorizer {id: owner, type: human}`, `decision: approved`, válida por 60 s.
- `execution_approval_uses`: cada aprovação foi consumida uma única vez.

## Veredito
- **MRTR por consumidor real: PROVADO.** O cliente real logado negociou `2026-07-28`, o servidor emitiu `input_required` e o humano aprovou. A operação foi executada uma vez, com o ledger e a aprovação registrados.
- **Escopo:** a prova foi feita com o Claude Code. O Codex 0.166.0 continua sem suporte a `2026-07-28` (A18).
- **ADR-0050 Q11:** este binding alcança `tools/call` e MRTR. Os demais requisitos de L2, como credencial e cota comprovadas, não foram avaliados aqui.
- **Limites:**
  - A aprovação humana é atestada pelo owner e pelo registro `authorizer: human` do servidor. O cliente não grava prova independente do diálogo.
  - O tempo entre o `input_required` e a resposta não fica no ledger.
- **Custo:** headless estimado em US$ 0,71, mais a sessão interativa do owner. Fica dentro do teto de US$ 2 por campanha (ADR-0050 Q6).

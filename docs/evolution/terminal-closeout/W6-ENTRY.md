# W6-ENTRY — pacote de entrada da W6 (IDE)

Este documento descreve a superfície que a IDE da W6 vai consumir. A W6 não foi iniciada. Os valores vêm do código e dos
documentos citados; o veredito de prontidão está em `terminal-readiness.json` (verificado por `test/test-terminal-readiness.js`).

Nota: o campo `revision` do `terminal-readiness.json` é a revisão em que o veredito foi emitido, antes dos merges de registro, e não a `master` atual.

## Superfície estável

- API de controle em `/v1`, somente loopback, Linux (`docs/engineering-control-api.md:58-64`; `docs/terminal.md:27,116`).
- Terminal: `POST /v1/terminals/commands` (envelope de comandos v1), `GET /v1/terminals/:id` e
  `GET /v1/terminals/:id/events` (`docs/engineering-control-api.md:322-338`).
- CLI: `hseos control terminal-query`, `terminal-events` e `terminal-attach` (`docs/engineering-control-api.md:344`;
  `docs/terminal.md:88`). Cliente Python: `terminal`, `terminal_query`, `terminal_events` (`docs/terminal.md:112`).
- Nenhum cliente escolhe o backend nem cria aprovação (`docs/terminal.md:112`).

## Versões

| Superfície                       | Versão                                                                       | Fonte                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| API de controle                  | prefixo `/v1`                                                                | `docs/engineering-control-api.md:58`                                                                                                   |
| SDK de controle                  | `@hseos/control-sdk` 1.0.0                                                   | `packages/control-sdk/package.json:3`                                                                                                  |
| Protocolo MCP moderno            | `2026-07-28`                                                                 | `tools/lib/mcp-protocol.js:16`                                                                                                         |
| Protocolo MCP de compatibilidade | `2024-11-05`; sem data de fim no produto ativado (ADR-0048, sunset sem data) | `tools/lib/mcp-protocol.js:15`; `tools/lib/governed-execution/native-mcp-server.js:112-116,161`; `tools/lib/mcp-2026-adapter.js:40-41` |
| Schema do ledger ativado         | `user_version` 17                                                            | `docs/evolution/terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md:28,45`                                                            |

A migração de um ledger já ativado entre schemas não tem caminho no produto (OG-16, ver `## Riscos`).

## Cursor de eventos

- Eventos de tarefa: `GET /v1/tasks/{id}/events?after=0&limit=100`, de 1 a 1000 eventos por página; continuar de `next_cursor`
  preserva a ordem; sem eventos novos, `next_cursor` devolve o `after` recebido (`docs/engineering-control-api.md:64-71`).
- Eventos de terminal: cursor por sequência, diferente do cursor global de tarefas, limite 1000, saída em base64; o cliente só
  avança o cursor após consumir os bytes (`docs/engineering-control-api.md:337-340`).
- `terminal-attach` aceita `--after` (`docs/engineering-control-api.md:345`).

## Terminais

Ações aceitas: `input` (`data` base64, até 4096 bytes), `resize` (`rows`, `cols`), `pause`, `continue`, `interrupt`, `eof`,
`terminate`, `recover`, `reconcile` (`docs/engineering-control-api.md:330-331`). No `terminal-attach`: Ctrl-] desanexa sem matar
o processo, Ctrl-C interrompe, Ctrl-D envia EOF (`docs/terminal.md:91`). Cada ação é autorizada por separado (401 `CONTROL_UNAUTHENTICATED` por ação, `test/test-terminal-api.js:108,168-181`; critério T6).

## Aprovação

A aprovação é separada da conclusão. No MCP moderno, uma ferramenta que exige aprovação devolve `resultType: input_required`
com `inputRequests` e `requestState` (MRTR) com integridade verificada, e o cliente reenvia com a resposta
(`tools/lib/mcp-2026-adapter.js:81-102,983`). No MCP de compatibilidade a aprovação não é suportada
(`MCP_LEGACY_APPROVAL_UNSUPPORTED`, `tools/lib/mcp-2026-adapter.js:999`). A IDE não cria aprovação nem a infere da conclusão.

## Riscos

- OG-16: o produto recusa um banco ativado de schema anterior (`EXECUTION_ACTIVATION_PENDING`) e não oferece caminho de
  migração; a saída é restaurar o backup pré-ativação.
- OG-11: o teste de frescor do ensaio da F14 v4 reprova toda mudança de `package.json` até o ensaio ser regenerado.
- Somente Linux; sem macOS nem Windows (`docs/terminal.md:27`).
- O executor isolado exige cgroup v2 delegado, bubblewrap e `pidfd`; sem eles, `ENGINEERING_ISOLATION_UNAVAILABLE`
  (`docs/terminal.md:30,127`).
- O compat MCP legado não expira no produto ativado: `HSEOS_MCP_LEGACY_SUNSET` (data ISO ou instante) ausente ou vazio vira `null`
  (`tools/lib/governed-execution/native-mcp-server.js:112-116`), e `null` significa sem expiração (`tools/lib/mcp-2026-adapter.js:40-41`);
  a data só é repassada em banco ativado (`native-mcp-server.js:161`). A constante `2026-11-30` (`mcp-2026-adapter.js:33`) vale só no
  modo fixture de teste. Uma data de fim exige o owner configurar `HSEOS_MCP_LEGACY_SUNSET` (ADR-0048).

## Gates do owner

Relevantes para a IDE (texto completo em `.hseos/runs/dev-squad/20261111-terminal-closeout/OWNER-GATES.md`):

- OG-01: valor `verified_installed_local_scope_only` de F01, F11, F16 e F21 frente ao ADR-0050.
- OG-04: L2 completo de um binding e a quarta integração (F08, F18).
- OG-16: evolução de schema de ledger já ativado.

Os demais gates (OG-02, OG-03, OG-05 a OG-09) constam no OWNER-GATES e em `terminal-readiness.json`.

## Fora de escopo

- A W6 não foi iniciada.
- Nenhum fork do Code OSS foi criado.
- Catálogo de extensões da IDE (F22) é trabalho da W6.
- Certificação operacional: todas as famílias seguem `operational: not_authorized`.

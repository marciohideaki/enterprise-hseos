# R-T3 — revisão cética de T3 (commit d2911a74)

HEAD do worktree no início e no fim: d2911a746e2967c2bbe51448b269bb6935533271 (alvo não moveu). Passagem 1 cega, depois passagem 2.

## Veredito: PASS-WITH-NOTES

A entrega cumpre a spec e os critérios de aceite. Há 2 achados de vazamento residual no transporte legado, ambos na via allowlistada, que a spec não pediu para fechar mas que contradizem a intenção de A-03.

## Achados

| # | Sev. | Local | Descrição / reprodução |
|---|---|---|---|
| 1 | MÉDIA | `tools/lib/legacy-mcp-server.js:93-95` (`withRecordingFailure`) + `mcp-transport.js:69-70` | O sufixo `(denial not recorded: ${error.message})` anexa o texto da exceção do gravador (SQLite etc.) a um erro com code allowlistado (`MCP_TOOL_UNKNOWN`/`MCP_SCOPE_DENIED`), e o transporte o devolve. Reprodução em cópia: `createLegacyGateway` com `recordDenial` que lança `Error('SQLITE_CANTOPEN: /home/x/.hseos/telemetry.db token=sk-test-000')` + `createMessageHandler` → resposta `{"error":{"code":-32000,"message":"Unknown tool: ghost (denial not recorded: SQLITE_CANTOPEN: /home/x/.hseos/telemetry.db token=sk-test-000)"}}`. O comportamento é afirmado por teste existente (`test-mcp-transport-robustness.js:580,582`), então o executor não podia mudar a asserção; correção exigiria decisão do owner (sufixo fixo `denial not recorded`, detalhe só no log, que já existe em :88). |
| 2 | BAIXA/MÉDIA | `tools/mcp-axon-bridge/lib/axon-client.js:151,225` (`cannot execute axon binary: ${error.message}`), `:178` (`message.error.message` do processo axon filho), `:204-205` | Códigos `AXON_*` estão na allowlist por prefixo e embutem texto de exceção de spawn (caminho do binário, errno) e texto vindo do processo filho. Vazamento de caminho interno; sem segredo evidente. Não reproduzido ao fio, verificado por leitura do código. |
| 3 | BAIXA | `tools/mcp-hseos-governance/lib/governance-query-adapter.js:123` | `GovernanceQueryError(envelope.error?.message ...)` repassa mensagem remota ao cliente via prefixo `MANAGED_GOVERNANCE_`. Texto é de um serviço governado, risco menor; registrar. |
| 4 | INFO | `tools/lib/mcp-2026-adapter.js:292-294` | `data.cause: error.message` (erro de compilação Ajv) em `createSchemaCompiler`. Só roda no registro de tools do servidor (schemas do próprio servidor), não em entrada de cliente; não chega ao fio de uma chamada. Não relacionado ao A-02. |
| 5 | INFO | `mcp-transport.js:24-25,215` | O caminho autoral `-32602` (`formatSchemaErrors`) devolve `error.message` do Ajv; spec manda não mexer. Mensagens Ajv de `additionalProperties`/`enum` não incluem nome de chave nem valor (esses ficam em `params`), então não vaza. |
| 6 | INFO | `mcp-2026-adapter.js:945` | `issues` de saída passou de array para objeto `{issue_count}`; coerente com a spec, nenhum consumidor existente em `test/` ou `tools/` lê `data.issues` (grep). Mudança de forma documentada em v4-migration. |

Nada encontrado em: ramos de erro de entrada do adapter (um único ponto, :859-863, saneado); `compilerError` do worker (vai só ao stderr, :532, fixo na resposta); `internalErrorResponse`; mensagem de telemetria legada (`legacy-mcp-server.js:170`, texto fixo).

## Verificações (itens 1 a 8)

1. Entrada: só `{keyword, instancePath}` — confirmado por diff e teste.
2. Saída: só `{issue_count}`, sem detalhe por item — confirmado.
3. Legado: `respondSafely` e catch :226 só devolvem `error.message` com code allowlistado; senão texto fixo + stack no stderr. Ressalva: achados 1 e 2.
4. Allowlist por prefixo: ver achados 2 e 3.
5. Mutações próprias (cópia descartável em /build/tmp/rev-t3, removida):
   - M1 saída com `{keyword, instancePath}` por item → test-mcp-2026-adapter 28 pass/1 fail
   - M2 `params` acrescentado aos issues de entrada → 28/1
   - M3 `respondSafely` devolve `error.message` → robustness 28/1
   - M4 catch devolve `error.message` → 28/1
   - M5 `typeof code === 'string' || ...` (qualquer code string passa) → falha
   - Base sem mutação: 29/0.
6. Nenhuma linha removida em `test/` no diff (`git show` só tem adições): asserções existentes inalteradas e verdes.
7. eslint limpo nos arquivos tocados; prettier `--check` limpo nos 9 arquivos; G3: nenhum arquivo novo (só modificados).
8. Commit: autor Marcio Hideaki, mensagem 1 linha ≤100 chars, sem trailer de IA nem menção a IA.

## Passagem 2 — alegações do executor

| Alegação | Resultado |
|---|---|
| issues de entrada `[{keyword,instancePath}]`, saída `{issue_count}` | confirmada |
| allowlist (3 prefixos + 6 códigos exatos) e `clientMessage` | confirmada (lida no diff) |
| `respondSafely` → `Internal error`, catch → `Tool failed`, stack no stderr | confirmada |
| códigos novos em project-state/handoffs/runs/archiver | confirmada (archiver fora da spec, mas coerente) |
| 2 bullets em docs/v4-migration.md | confirmada |
| adapter 29 verdes | confirmada (29/29); hostile 14/14 |
| robustness 29/29 | confirmada |
| contract | confirmada: `node test/test-mcp-contract.js` 201 passed, 0 failed (o "1 pass" do executor é o `node --test` encapsulando o runner) |
| agent-state 5, axon-bridge 21, swarm 6, swarm-scope 27, stdio 3 | confirmadas |
| managed-governance/mcp 5, package-surface 1 | confirmadas via `node --test` |
| mutações i, ii, iii mortas | confirmada (mutações equivalentes minhas também) |
| c8: adapter 93,14 L / 84,76 B; transport 100 L / 96,03 B | NÃO verificada |
| DAL not available fica genérico | confirmada por leitura, coerente com a spec |

## Não verificado

- Cobertura c8 (números do executor aceitos sem reprodução).
- `test-mcp-activated-mode.js` não rodado (adapter+hostile rodados: 43 testes).
- Autorais sem code em outras tools não listados na spec (por ex. throws em `tools/mcp-hseos-swarm`, `governed-execution`): ficam em `Tool failed`; perda de informação para o cliente, não vazamento. Não varrido de forma exaustiva.
- Achado 2 não reproduzido ao fio (só por leitura).
- `heavy-run` ficou preso na fila; rodei com `nice -n 19`, um por vez, load1 abaixo de 6 cores.

# A18 — Campanha Codex real: `tools/call` e aprovação MRTR (2026-10-31)

Autorização do owner (2026-10-31): roda pela assinatura ChatGPT. O teto de US$ 2 foi convertido em limite de execução: jornada curta, no máximo 5 `tools/call` e 1 aprovação MRTR, com tempo máximo.

## Ambiente
- **Cliente:** `codex-cli 0.166.0`, autenticado por conta ChatGPT (assinatura, não chave de API), em modo `codex exec --sandbox read-only --json`, com cwd descartável em `$TMPDIR`.
- **Servidor:** `hseos-state-tracking` (stdio), registrado no `~/.codex/config.toml` global e apontando para o release `817da40b546a25dfde7f8f8999b66d0bbdeec299`, instalado na janela A12.
  - Banco: o `project.db` ativado do enterprise-hseos. Log do servidor: `governed mode=activated user_version=17`.
- **Custo:** cota de assinatura, US$ 0 incremental. Uso reportado pelo cliente, somando as 3 rodadas: 90.430 tokens de entrada (72.576 em cache), 538 de saída e 142 de raciocínio.

## Jornada
| # | Ação | Resultado |
|---|---|---|
| 0 | Sondagem: pedir ao modelo, sem chamar ferramenta, que liste as MCPs `hseos*` | O modelo respondeu que nenhuma estava visível, mas o `codex mcp list` mostra as 3 habilitadas. O Codex carrega ferramentas sob demanda e a resposta do modelo não serve como evidência. |
| 1 | `tools/call` `agent_runs_list {limit:1}` | **Bloqueado pelo próprio cliente:** "MCP tool call requires approval, but approval policy is never". A chamada não chegou ao servidor. O modelo **inventou** o formato do resultado ("Top-level keys: content, isError"), o que vira achado de confiabilidade: uma falha de ferramenta foi relatada como se houvesse resultado. |
| 2 | Mesma chamada, com override de invocação `-c mcp_servers.hseos-state-tracking.tools.agent_runs_list.approval_mode="approve"`, sem alterar a configuração | **PASS.** `ok: true`, `operation_id` `16dc0a8b-b29a-56ae-80f2-46692a45056d`, evidência `hseos://execution/16dc0a8b…/provider/project_state:agent_runs_list` e `replayed: false`. `_meta` traz "MCP 2024-11-05 compatibility is deprecated". |

`tools/call` usados: 2 de 5. Nenhuma ferramenta com efeito colateral foi chamada.

## Aprovação MRTR: NÃO EXERCITÁVEL com este cliente
Sondagem direta do servidor do release, por stdio:

| `protocolVersion` pedido no `initialize` | Resultado |
|---|---|
| `2025-06-18` (o que o Codex fala) | O servidor negocia a compatibilidade `2024-11-05`. O `tools/list` traz 15 ferramentas, nenhuma `memory.*` ou `environment.*`. |
| `2026-07-28` | Erro `-32022`, "Unsupported legacy protocol version". O protocolo moderno usa outro handshake (`server/discover`). |

As únicas ferramentas com `requires_approval: true` são `memory.write`, `memory.delete`, `environment.computer.start` e `environment.computer.act`. As de computer são recusadas desde o E5. Nenhuma delas é exposta no modo de compatibilidade que o Codex 0.166.0 negocia. Por isso a aprovação MRTR (`resultType: input_required` e `elicitation/create`) **não pode ser exercitada pelo Codex atual**. Isso não é NOT_EXERCISED por falta de tentativa: é uma limitação de protocolo do cliente.

Consequências:
- O critério de consumidor real para MRTR segue **aberto**.
- Pelo ADR-0048, o sunset do legado depende da evidência de que os clientes registrados falam `2026-07-28`. O Codex 0.166.0 **não** fala, então o legado não pode sair enquanto o Codex for cliente registrado.
- O `tools/call` real por cliente logado está **provado**, mas só na superfície de compatibilidade.

## Evidência bruta
Os JSONL do cliente ficam em `$TMPDIR/a18-zIac/`: `probe`, `call1` e `call2`, com `.jsonl` e `.err`. Eles não são versionados, porque contêm o prompt completo e eventos do cliente. Este resumo é a evidência citável.

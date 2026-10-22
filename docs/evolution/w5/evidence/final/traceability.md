# Rastreabilidade final da W5 (W5-12)

Requisito → task → teste → recibo. Só entram arquivos que existem no repositório (conferidos na
construção deste documento) e nomes de caso que constam em `test/test-w5-negative-matrix.js`.
Onde não há teste ou caso identificável, o campo diz **sem caso**; nenhum nome foi inferido.
Recibo final: [verification-receipt.json](verification-receipt.json). Matriz negativa e mutantes (W5-11a):
[../negative/traceability.md](../negative/traceability.md). Fonte da matriz FR → task: `spec.md`
(seção "Rastreabilidade FR para task"). O spec chama os requisitos `W5-FRnn`; aqui `FRnn`.

Recibos por task estão em `docs/evolution/w5/evidence/<task>/receipt.json` (abreviado `<task>` abaixo).

| FR | Task(s) | Testes (arquivo; caso negativo da W5-11a quando existe) | Recibos |
| --- | --- | --- | --- |
| FR01 | W5-02a | `test/test-agent-context-authority.js`, `test/test-agent-context.js`; negativo: `context: a source cannot raise its authority above what its layer allows`, `lattice: a child agent cannot widen the capabilities or the effect budget of its parent` | `w5-02a`, `w5-03`, `w5-11a` (`negative`) |
| FR02 | W5-02a | `test/test-agent-context-media.js`; negativo: `context: a source that loses or falsifies its provenance is refused`, `media: bytes changed after storing fail the digest check before they are used`, `media: a wrong magic signature is refused even when the digest agrees with the bytes`, `media: a declared size that differs from the real bytes is refused, and a truncated artifact fails to load` | `w5-02a`, `w5-03`, `w5-11a` |
| FR03 | W5-09 | `test/test-agent-memory.js`, `test/test-memory-plugin-parity.js`; negativo: `memory: a write cannot carry directive or operator authority, and retrieval stays data and untrusted` | `w5-09`, `w5-11a` |
| FR04 | W5-03 | `test/test-compaction-resume-fork.js`, `test/test-agent-compaction.js`; negativo (W6-E3, cobre uma face: resultado do provider vinculado a outras fontes não persiste e checkpoint alheio não é reetiquetado; a equivalência com o histórico integral fica nos testes positivos): `compaction: a provider result that does not bind the exact sources never reaches the checkpoint store, and a foreign checkpoint is not relabelled` | `w5-03` |
| FR05 | W5-04 | `test/test-mcp-contract.js`, `test/test-mcp-hseos-governance.js`, `test/test-mcp-hseos-swarm-scope.js`, `test/test-mcp-transport-robustness.js`, `test/test-mcp-2026-adapter.js`, `test/test-mcp-stdio.js`; negativo: `mcp: malformed and unknown tool names are denied and recorded before any handler runs`, `mcp: a request outside the project scope is denied with the stable scope code` | `w5-04`, `w5-11a` |
| FR06 | W5-05 | `test/test-environment-lsp.js`, `test/test-lsp-plugin-parity.js`; negativo: `lsp: a location outside the workspace reported by the real server is refused and recorded` (exige pyright, bwrap e cache de toolchain) | `w5-05`, `w5-11a` |
| FR07 | W5-06 | `test/test-environment-dap.js`, `test/test-dap-plugin-parity.js`; negativo: `dap: a detached child that outlives its parent is killed and drained, leaving nothing in /proc` (executor real) | `w5-06`, `w5-11a` |
| FR08 | W5-07 | `test/test-environment-browser.js`, `test/test-browser-plugin-surface.js`, `test/test-browser-plugin-parity.js`; negativo: `browser: egress to a host outside the allowlist is denied, recorded, and never reaches the target` (broker real) | `w5-07`, `w5-11a` |
| FR09 | W5-08 | `test/test-environment-computer.js`, `test/test-computer-plugin-parity.js`; negativo: `computer: an action without an approval is refused and nothing reaches the host`, `computer: a requested approval that no person granted does not authorise the action`, `computer: an approval is bound to its own action, arguments and position; the right action runs once`, `computer: an expired approval is refused and nothing reaches the host`, `computer: a single-use approval cannot be replayed` | `w5-08`, `w5-11a` |
| FR10 | W5-02b1, W5-05, W5-06, W5-07, W5-08, W5-09 | `test/test-isolation-profiles.js`, `test/test-artifact-channel.js`, `test/test-execution-plugin-runtime.js`, `test/test-environment-plugin-pack.js`, `test/test-plugin-marketplace.js`, `test/test-package-surface.js`; negativo: `import: requiring the environment entry touches no toolchain cache and loads no capability`, `lattice: a child agent cannot widen…` | `w5-02b1`, `w5-05`, `w5-06`, `w5-07`, `w5-08`, `w5-09`, `w5-11b` (plugins instalados), `w5-11a` |
| FR11 | W5-10 | `test/test-environment-surfaces.js`, `test/test-engineering-control.js`, `test/test-control-sdk-types.js`, `test/test-campaign-evidence.js`; negativo (W6-E3): `control surface: functions and code-bearing fields are stripped from an HTTP response at any depth` | `w5-10` |
| FR12 | W5-11b, W5-10b | `test/journeys/w5-environment-journey.mjs` (não é teste de `npm test` nem roda no CI); **cobertura parcial**: consumidor A real, consumidor B sintético (teste e defeito declarados), 2 de 3 despachos em assinatura, custo não medido (`cost_microusd` nulo no recibo; `max_cost_microusd` 0 apenas proíbe gasto pago); sem despacho a jornada termina com 24 PASS e 9 BLOCKED (exit 3) | `w5-11b`, `w5-10b` |
| FR13 | W5-04, W5-02b1, W5-10 | `test/test-mcp-transport-robustness.js`, `test/test-mcp-hseos-swarm-scope.js`, `test/test-isolation-witness-faults.js`, `test/test-environment-surfaces.js`; negativo (W6-E3, cobre limites de recurso e de requisição: `pids_max` 32..256 e corpo/profundidade do adaptador; não afirma ser exatamente a pendência MCP/executor do spec): `executor limits and MCP bounds: an out-of-range pids_max is refused at admission and an oversized MCP request never reaches the executor` | `w5-04`, `w5-02b1`, `w5-10` |
| FR14 | W5-10b | `test/test-engineering-task-contract.js`, `test/test-engineering-task-runtime.js`, `test/test-engineering-control.js`; negativo: `engineering: static-only acceptance is refused at admission (A5b)`, `engineering: every argument form outside the conservative alphabet is refused at admission` | `w5-10b`, `w5-11a` |
| FR15 | W5-02b2 | `test/test-engineering-project.js`, `test/test-engineering-sandbox-check.js`, `test/test-engineering-workspace.js`, `test/helpers/pnpm-store.js`; negativo (W6-E3): `pnpm store: a link leaving the verified store and a file one character beyond the limit are refused, never followed or truncated` (exercita a guarda de leitura e a guarda do mount do sandbox, cada uma sozinha) | `w5-02b2` |

## Notas de leitura

- O recibo `w5-02a` registra 41 testes com cobertura por arquivo, mas não lista os arquivos de teste; os
  arquivos de FR01/FR02 acima são os testes de contexto e mídia do repositório (rastreados no recibo `w5-03`).
- Os recibos das tasks registram a evidência do momento de cada merge. A evidência desta verificação final
  (npm test, cobertura, mutantes, quality gates, grafo, inventário, Node 22 e 24) está no recibo final.
- NFR04, NFR06 e NFR07 são cobertas pelos gates do recibo final: matriz Node 22/24, cobertura 90/80 por
  arquivo, mutantes, inventário do pacote e pins (ver `gates` no recibo).

## F14 e consumidor real

`requirements.json` mantém F14 com `real_consumers: not_verified`. A jornada da W5-11b (recibo `w5-11b`, passos s04, s05 e s09
do consumidor A, `test/journeys/w5-environment-journey.mjs`) exerceu LSP, DAP e navegador num consumidor real e confere que a
saída de LSP é `authority: data` com `trust: untrusted` (linhas 1239 a 1240), que a de depuração é `data` (linha 1298) e registra
o `provenance.digest` do contexto do navegador (linha 944). Isso não é consumidor real de F14 completo: a memória não tem
consumidor, o DAP depurou um reprodutor do harness, o navegador renderizou uma página do harness e o verificador é uma regex.
Também não há consumidor real de compactação (F15) nem de MCP ampliado (F20).

## Requisitos sem caso

- Sem caso negativo: nenhuma. FR04, FR11, FR13 e FR15 ganharam caso na matriz negativa na W6-E3 (`test/test-w5-negative-matrix.js`),
  cada um provado vermelho por mutação da guarda correspondente (compaction `source_digest`/identidade, `stripExecutable`, faixa de `pids_max` e
  limite de corpo do adaptador MCP, `PROJECT_STORE_LINK_ESCAPES` e limite de caracteres de arquivo de store).
  FR04 e FR13 têm uma face coberta cada, conforme descrito nas linhas da tabela; as demais faces ficam nos testes positivos.
- Cobertura parcial: FR12. A prova de integração e instalação é local; não roda no CI e B é sintético.
- Nenhuma FR está sem teste e sem recibo.

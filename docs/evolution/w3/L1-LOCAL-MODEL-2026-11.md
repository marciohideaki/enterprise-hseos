# Recibo L1 do binding de modelo local (F17), 2026-11-05

Escopo: nível L1 do ADR-0050 §2 para um binding de **modelo local**, a lacuna "não existe binding de modelo local" apontada na reauditoria. Decisão do owner de 2026-11-05: "Aceita modelo local" (o manifesto passa a admitir um fornecedor de modelo local). Este recibo não altera `requirements.json`.

**Resultado: o binding local tem declaração versionada e testes de contrato (L1). Não há campanha L2 deste binding como declarado, e a F17 `deterministic` segue sem promoção.**

## O que mudou

| Item                                                             | Mudança                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/lib/provider-control-manifest.js`                         | Novo fornecedor `ollama`, só com rota `local`, tipo `model` e autenticação `local`. Nenhuma outra rota, fornecedor ou regra mudou: a rota local continua exigindo credencial nula, cobrança `local` de valor zero, identidade `local_profile` com perfil pinado e cota `not_applicable` ou verificada |
| `.agents/activation/provider-bindings/ollama-local.example.yaml` | Binding pelo adaptador `openai-compatible-sse` para o servidor local da infraestrutura compartilhada (`ollama-shared.platform-shared-dev.svc.cluster.local:11434/v1`), modelo derivado `qwen2.5:7b-16k`, `operational: false` e `authorized: false`                                                   |
| `docs/evolution/w3/model-bindings/ollama-local.manifest.json`    | Declaração versionada: rota `local`, transporte `http`, sem credencial, cobrança `local`, janela de 16384 tokens, perfil pinado pela identidade do modelo derivado (sha256 do manifesto)                                                                                                              |
| `test/test-model-binding-l1.js`                                  | Inventário passa a classificar o novo binding; três testes novos (declaração local, recusas do manifesto, backend efetivo e divergência)                                                                                                                                                              |

## Testes (L1)

| Requisito                                                                                | Teste                                                                                                                 | Resultado |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- |
| declaração versionada, pinada ao binding, sem credencial nem cobrança paga               | `the local model binding is declared with a pinned model profile, no credential and no paid billing`                  | PASS      |
| o manifesto recusa credencial, rota paga, rota `api` do fornecedor local e tipo `client` | `the manifest refuses a local model that carries a credential or a paid route, and an API route for the local vendor` | PASS      |
| backend efetivo = declarado; divergência recusa                                          | `the backend a local request actually reaches is the declared one and any divergence is refused`                      | PASS      |
| inventário: todo binding oficial classificado                                            | `every official binding is classified and every model binding has a versioned declaration`                            | PASS      |

Regressão: grupos `provider-control` (306), `agent-provider-binding` (13), `agent-provider-conformance` (12), `package-surface`, `documentation-neutrality` e `shared-infra-drift` passam.

## Decisão de projeto: a janela declarada não excede o backend

A campanha local anterior achou que o binding declarava 8192 tokens enquanto o servidor atende 4096. Este binding declara **16384** (modelo derivado com `num_ctx` 16384), e um teste exige que a janela do binding não ultrapasse a da declaração. Isso trata o sintoma na declaração; **não** valida a janela contra o backend vivo na admissão.

## Lacunas (`does_not_prove`)

1. **Só L1.** O binding como declarado (endereço do cluster, `qwen2.5:7b-16k`, 16384 tokens) não passou por campanha L2. A campanha anterior usou um túnel local e uma janela de 8192, e nenhuma tarefa foi aprovada.
2. **O digest do perfil é a identidade do modelo derivado** (sha256 do manifesto), lido pelo operador no servidor; o binding não o observa em tempo de execução.
3. **Janela não validada contra o backend vivo.** Quem declara o limite é o operador; nada na admissão consulta o servidor.
4. **Modelo pequeno.** A tarefa de engenharia não foi aprovada por nenhum dos dois modelos testados; este recibo não afirma capacidade.
5. **A composição ACP tool-free de terceiro** segue sem backend efetivo provado (C4 BLOCKED por falta de chave). Por isso a F17 `deterministic` não é promovida.
6. **Nenhuma cota remota** foi tratada: os bindings remotos seguem com `quota: not_verified`.

## Correção de 2026-11-06 (T3 da Onda A)

**O binding como declarado é inutilizável para tarefa de engenharia:** com 4.096 tokens declarados, `agent run` termina em `session-budget-exceeded` antes de qualquer chamada de rede, porque a admissão compara bytes com `context_tokens`. A seção "a janela declarada não excede o backend" estava certa sobre honestidade e errada sobre utilidade, e os testes L1 não detectaram porque só comparam a declaração com o manifesto. Ver `stab2/T3.md`.

## Correção de 2026-11-06 (P3): janela utilizável e sonda de campanha

O owner decidiu aumentar o contexto. O modelo derivado `qwen2.5:7b-16k` (`num_ctx` 16384; identidade `0a89db42...cf67d40c`, medido em 5,6 GB, 100% em GPU) substitui `qwen2.5:7b` no binding, e o binding e o manifesto passam a declarar 16384. Um teste novo exige que o binding admita o primeiro pedido real da tarefa `addition` (com `fetch` interceptado, ao menos uma chamada); com 4096 ele reprova.

Limites registrados:

1. **O modelo derivado vive no volume persistente do servidor, fora do GitOps.** Se o volume for recriado, o modelo some e o binding aponta para um modelo inexistente até ser recriado à mão.
2. **A estimativa do adaptador conta bytes**, não tokens; `context_tokens` continua sendo comparado com bytes do pedido (limite superior, fail-closed).
3. **Não há L2 local:** em 2026-11-06 houve UMA execução real de `addition` com este binding (P3-V, abaixo), por túnel, com modelo de 7B; isso valida admissão, chamada e janela, e continua NÃO sendo L2.
4. A janela continua sendo declarada pelo operador; a sonda abaixo só vale na campanha, não na admissão.

## Resultado da validação real P3-V (2026-11-06)

Uma execução de `agent run` (tarefa `addition`) com o binding real, sem alterar `context_tokens`; só o `base_url` difere do declarado (túnel de campanha `http://127.0.0.1:21434/v1` via `port-forward`, contra o endpoint do cluster declarado). O `fetch` guard compartilhado foi composto por um preload de campanha que mapeia a origem do túnel, sem editar o guard.

- Chamadas ao backend: 5, todas HTTP 200, modelo respondente `qwen2.5:7b-16k`; maior pedido 6884 bytes.
- Contexto efetivo (`ollama ps`, modelo carregado): 16384; janela do modelo (`ollama show`): 32768.
- Sonda: `pass` (6884 + 1024 <= 16384; declarado 16384 <= efetivo 16384).
- Tarefa: `failed` / `criteria-not-satisfied`. O modelo escreveu `add.js` com `function add` sem `module.exports`; falha do modelo, não de admissão, chamada ou janela. Tokens reportados: 6415 de entrada, 226 de saída.
- Túnel encerrado; `ollama stop` executado e `ollama ps` vazio depois.

Ressalvas de leitura da evidência:

- `provider-requests.jsonl` registra a URL como `api.openai.com` por **apelido** do `tunnel-preload.cjs`; o tráfego **não** foi para lá. O destino real foi o túnel local (`http://127.0.0.1:21434`), como mostra `outcome.json` (`origin`).
- Edição no recibo: em `run1/outcome.json`, o campo `result.state` continha um caminho absoluto externo (`/build/tmp/hseos-ledger-fixture-...`) e foi trocado por `<external-ledger-path-redacted>`; nenhum outro campo foi alterado.
- `run1/states/run/ledger.sqlite` (binário, não inspecionado) foi mantido: `.hseos-ledger-fixture.json`, ao lado dele, o referencia como o banco do ledger temporário.
- `window-verdict.json` foi regerado com a sonda corrigida (campo `unknown` novo); o veredito segue `pass`.

Limites: uma execução, por túnel, modelo pequeno; não é L2. Evidência: `docs/evolution/w3/evidence/stab-f17-16k/run1/` (roteiro `f17-local-16k.cjs`, `tunnel-preload.cjs`, `backend-observed.txt`, `window-verdict.json`).

O `add.js` escrito pelo modelo está guardado como `run1/states/run/workspace/add.js.fixture.txt`, com o conteúdo inalterado: com a extensão original, ele entraria no lint do repositório, que o reprova por `add` não usado.

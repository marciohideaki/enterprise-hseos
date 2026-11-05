# Recibo L1 do binding de modelo local (F17), 2026-11-05

Escopo: nível L1 do ADR-0050 §2 para um binding de **modelo local**, a lacuna "não existe binding de modelo local" apontada na reauditoria. Decisão do owner de 2026-11-05: "Aceita modelo local" (o manifesto passa a admitir um fornecedor de modelo local). Este recibo não altera `requirements.json`.

**Resultado: o binding local tem declaração versionada e testes de contrato (L1). Não há campanha L2 deste binding como declarado, e a F17 `deterministic` segue sem promoção.**

## O que mudou

| Item                                                             | Mudança                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/lib/provider-control-manifest.js`                         | Novo fornecedor `ollama`, só com rota `local`, tipo `model` e autenticação `local`. Nenhuma outra rota, fornecedor ou regra mudou: a rota local continua exigindo credencial nula, cobrança `local` de valor zero, identidade `local_profile` com perfil pinado e cota `not_applicable` ou verificada |
| `.agents/activation/provider-bindings/ollama-local.example.yaml` | Binding pelo adaptador `openai-compatible-sse` para o servidor local da infraestrutura compartilhada (`ollama-shared.platform-shared-dev.svc.cluster.local:11434/v1`), modelo `qwen2.5:7b`, `operational: false` e `authorized: false`                                                                |
| `docs/evolution/w3/model-bindings/ollama-local.manifest.json`    | Declaração versionada: rota `local`, transporte `http`, sem credencial, cobrança `local`, janela de 4096 tokens, perfil pinado pelo digest do blob do modelo                                                                                                                                          |
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

A campanha local anterior achou que o binding declarava 8192 tokens enquanto o servidor atende 4096. Este binding declara **4096**, e um teste exige que a janela do binding não ultrapasse a da declaração. Isso trata o sintoma na declaração; **não** valida a janela contra o backend vivo na admissão.

## Lacunas (`does_not_prove`)

1. **Só L1.** O binding como declarado (endereço do cluster, `qwen2.5:7b`, 4096 tokens) não passou por campanha L2. A campanha anterior usou um túnel local e uma janela de 8192, e nenhuma tarefa foi aprovada.
2. **O digest do perfil é do blob do modelo**, lido pelo operador no servidor; o binding não o observa em tempo de execução.
3. **Janela não validada contra o backend vivo.** Quem declara o limite é o operador; nada na admissão consulta o servidor.
4. **Modelo pequeno.** A tarefa de engenharia não foi aprovada por nenhum dos dois modelos testados; este recibo não afirma capacidade.
5. **A composição ACP tool-free de terceiro** segue sem backend efetivo provado (C4 BLOCKED por falta de chave). Por isso a F17 `deterministic` não é promovida.
6. **Nenhuma cota remota** foi tratada: os bindings remotos seguem com `quota: not_verified`.

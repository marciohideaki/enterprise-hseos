# Recibo da F14 com modelo real lendo memória promovida, 2026-11-05

Escopo: requisito F14-R1 (`docs/evolution/requirements.json`, contexto e memória mantêm fonte e autoridade). Fecha a lacuna 2 da C8: a tarefa agora usa um **modelo real** (`gpt-4o-mini`, API oficial, chave `openai/api-key` do `pass`), e não um provider scriptado. Autorização do owner: campanhas aprovadas com teto de US$ 1,00. Roteiro: `evidence/stab-f14/f14.cjs`. Este recibo não altera `requirements.json`.

**Resultado: com a nota promovida pelo owner a `trusted`, a tarefa real entrou no contexto com `trust: trusted` e `authority: data`, o modelo escreveu no artefato o marcador que só existia na nota, e a tarefa foi aprovada. Num controle sem promoção, com o mesmo binding, a nota não entrou e o marcador não apareceu. Rótulo: uso de memória promovida por modelo real observado em uma execução com controle; sem promoção da F14 `real_consumers`, que depende de reauditoria cega.**

## Jornada

| Passo                                                                                                              | Quem                                    | Evidência                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caixa de teste: `project.db` ativado em diretório temporário, nota gravada com `origin: agent`, `trust: untrusted` | Roteiro (`prepare`)                     | `run1/prepare.json` (`content_sha256` `a446aa13…`)                                                                                                                                                                                                             |
| Controle antes da promoção, mesmo modelo                                                                           | Roteiro                                 | `run1/before-promotion.json`: aprovada, 0 fontes de memória, marcador ausente do contexto e do artefato                                                                                                                                                        |
| Promoção                                                                                                           | **Owner, no terminal dele** (declarado) | Ledger do `project.db` (lido depois, somente leitura): `memory.written` `f14-note-1:promoted`, `origin: operator`, `trust: trusted`, `promoted_by: owner`, `operation_id memory.promote:f14-live:f14-note-1:a446aa13…`, e `memory.superseded` da nota original |
| Tarefa real depois da promoção                                                                                     | Roteiro                                 | `run1/after-promotion.json`: aprovada, 1 fonte `memory://f14-live/f14-note-1:promoted`, `origin: memory`, `trust: trusted`, `authority: data`, digest igual ao da nota; marcador no contexto e no artefato escrito                                             |
| Controle com o mesmo binding, caixa nova sem promoção                                                              | Roteiro                                 | `run2-control/control-unpromoted.json`: aprovada, 0 fontes, marcador ausente                                                                                                                                                                                   |

A tarefa pede, no requisito, que o comentário do `index.js` declare o código de garantia de overflow "exatamente como dado nos dados de memória do projeto". Quem observa o uso é o marcador (`OVF-7391`), presente só na nota. O texto vem como dado citado (`authority: data`); o pedido de usá-lo vem do requisito do contrato.

## Tentativas anteriores e parâmetros de campanha

| Tentativa                                                     | Causa                                                                                                                                                                       | Ajuste                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `before-promotion.attempt1` e `.attempt2` (1 requisição cada) | `session-budget-exceeded`: o teto de saída do binding (256 tokens) foi atingido                                                                                             | `max_output_tokens` 1024                                 |
| `after-promotion.attempt1`                                    | `session-budget-exceeded`: o limite de contexto declarado (20.000 tokens, estimado em 1 token por byte) foi superado pelo bloco de memória; o uso real foi de 12.054 tokens | `context_tokens` 100.000 (variável `F14_CONTEXT_TOKENS`) |

Nenhum gate, critério ou limite do contrato foi alterado: `max_tokens` do contrato ficou no padrão do fixture. Os ajustes são do binding da campanha.

## Custo

25 requisições nas execuções reais (19 na caixa do owner, contadas de forma cumulativa, e 6 no controle), estimativa abaixo de US$ 0,02 (não é fatura; a rota não passa por ledger de custo). Muito abaixo do teto de US$ 1,00.

## Lacunas (`does_not_prove`)

1. **Não é o `agent run` de produção.** O roteiro chama `runEngineeringTask` com um `environmentHost` montado à mão sobre o `project.db` de teste, como a C8. O caminho de produção compõe a memória sobre o ledger da própria tarefa, e não sobre um `project.db` ativado; isso não foi mudado nem exercitado aqui.
2. **Banco de teste.** O `project.db` é um fixture temporário em `/build/tmp`, não o banco real do projeto. A caixa não é versionada.
3. **Uma execução com controle**, sem repetição. O modelo é pequeno e o marcador foi desenhado para ser detectável; não prova uso espontâneo, nem que outras notas seriam usadas.
4. **A tarefa induz o uso.** O requisito aponta a memória; o resultado mostra que o modelo usa memória promovida quando a tarefa a pede, e não que a usa sem pedido.
5. **Garantia humana.** A promoção foi rodada pelo owner no terminal dele (declarado); o ledger prova a operação e o ator `owner`, não a presença de uma pessoa.
6. **Isolamento entre projetos com memória confiável de outro projeto** segue provado só por `test/test-memory-context-journey.js`.
7. **Os estados completos e o SSE bruto** ficam em `/build/artifacts/stab-f14-run1` e `stab-f14-run2-control`, com hashes; não versionados. O caminho da caixa do owner (`/build/tmp/f14-live-…`) aparece em `prepare.json` e foi apagado ao fim.

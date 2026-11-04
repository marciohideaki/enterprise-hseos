# Registro da campanha C5 (binding compatível, API oficial), tentativa 1, 2026-11-03

Escopo: campanha C5 do fechamento pré-W6 (PLAN-4, WC), binding `binding:openai-compatible-c5` (`adapter` de API `hseos-api-campaign-v1`, vendor `openai`, rota `api`, cobrança medida, modelo `gpt-4o-mini`, endpoint `https://api.openai.com/v1`). Autorização do owner no ato (2026-11-03): no máximo 2 inferências, reserva de US$ 0,25 por requisição, teto da campanha de US$ 1,00, exceção de cota em seu nome, validade de 60 min.

**Resultado: FAIL com desfecho incerto, causado por um defeito do provider, que já foi diagnosticado e corrigido em código. Nenhum nível de certificação é declarado e nada foi promovido.** A primeira inferência chegou ao provedor (HTTP 200), mas o provider rejeitou o stream e o adapter fechou a requisição como incerta. A campanha foi cancelada antes da segunda inferência. Uma nova campanha depende de nova autorização do owner.

## O que correu

| Item                   | Valor                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binding                | `binding.yaml` (formato do binding de exemplo, endpoint da API oficial, `gpt-4o-mini`, 4.096 tokens de contexto, 256 de saída). Manifesto em `manifest.json`: autoridade `kernel`, `resume: unavailable` (rota sem estado), `quota: not_verified` |
| Credencial             | `openai/api-key`, do `pass`, injetada só como a variável declarada no binding; a variável própria do fornecedor ficou fora do ambiente. A impressão digital observada na inspeção é igual à do manifesto (`inspect-before.json`)                  |
| Inspeção               | Nenhuma requisição ao provedor (a API oficial não tem endpoint de saldo): `provider_requests_during_inspect: 0`. Cota e saldo são desconhecidos, o que exige a exceção de cota                                                                    |
| Concessão              | `max_requests: 4`, `max_cost_microusd: 1000000`, reserva de 250000 por requisição, exceção de cota limitada ao binding e ao prazo (`grant.json`)                                                                                                  |
| Requisição ao provedor | uma, `POST /v1/chat/completions`, **status 200** (`provider-calls.json`)                                                                                                                                                                          |
| Desfecho               | evento `uncertain` no ledger (`ledger-rows-before-cancel.json`, sequência 5), código `CONTROL_OUTCOME_UNCERTAIN` (`failure.json`)                                                                                                                 |
| Estado final           | `requests: 1`, `committed_microusd: 250000`, `cancelled: true`, `live_commands: []`, `unresolved_commands: [1]` preservado (`final-state.json`)                                                                                                   |

## Causa

- **Defeito do provider compatível, não da campanha nem do provedor.** A API oficial desse formato, quando o uso é solicitado (`stream_options.include_usage`), envia `"usage": null` em todos os pedaços do stream menos o último. O provider (`packages/model-providers/openai-compatible-provider.js`) tratava qualquer `usage` diferente de `undefined` como um objeto a validar e rejeitava `null` com `provider usage must be an object`. O stream virava `failed`, o adapter não recebia `completed` com uso, e a requisição, apesar de ter sido atendida e cobrada, ficava incerta. O provedor do outro vendor testado antes omite o campo, e por isso o defeito não aparecia.
- **Reprodução offline, sem rede e sem credencial** (`repro-offline-stream-shape.cjs`, saída em `repro-offline-output.json`): um stream no formato oficial termina em `CONTROL_OUTCOME_UNCERTAIN` na árvore sem a correção, e o mesmo stream com o campo omitido conclui. Com a correção, os dois concluem com 12 tokens de entrada e 2 de saída.
- **O que não foi observado:** o conteúdo do stream real. O adapter não retém o stream de uma requisição incerta, então a causa é a explicação que reproduz o sintoma, e não uma captura da chamada real. O corpo da resposta real não foi gravado.

## Correção

Task `c5-usage-null`, commit `95e2e469` (revisão cética isolada, passagem cega e confronto): `null` passa a significar "ainda sem uso"; o uso final continua sendo reportado; um `usage` que não seja `null` nem objeto continua sendo erro de protocolo; e um stream que nunca informa uso continua deixando o adapter falhar fechado. Quatro testes novos, três deles falham sem a correção, e as mutações dirigidas são mortas. O hook de commit completo passou.

## Custo

- O `committed_microusd: 250000` é a **reserva conservadora** do controle, não custo cobrado.
- A chamada foi atendida (200), então houve consumo de tokens do modelo, de ordem muito pequena (o prompt tem dezenas de tokens e a saída é uma linha curta). O valor real é **desconhecido**: o uso não foi retido pelo adapter na requisição incerta, e a fatura da console não foi consultada.
- A reserva retida permanece até reconciliação. O teto de US$ 1,00 não foi excedido.

## O que isto não prova

Não prova nenhum item de L2 para este binding: nem credencial efetiva em uso na resposta, nem modelo, nem custo, nem recuperação. A inspeção e o 200 do provedor são fatos de uma chamada, não de uma campanha concluída.

## Decisão pendente do owner

Repetir exige uma nova campanha, com nova autorização e novo teto: o comando incerto permanece não resolvido nesta, e a jornada de duas inferências somaria 2 inferências depois de 1 já consumida. A nova campanha prevista deve incluir, além da geração, a recuperação do controle depois de uma reabertura do ledger (o roteiro `run-c5.cjs` já faz isso) e gravar o corpo observável da resposta e do modelo, o que esta tentativa não fez.

## Arquivos

Diretório `docs/evolution/w3/evidence/pre-w6-c5-attempt1/`: `binding.yaml`, `manifest.json`, `grant.json`, `inspect-before.json`, `provider-calls.json`, `failure.json`, `ledger-rows-before-cancel.json`, `final-state.json`, `replay-trace.json`, `scan-after.json`, `run-c5.cjs`, `repro-offline-stream-shape.cjs` e `repro-offline-output.json`. A varredura (`scan-after.json`, pelo script `evidence/pre-w6-scan/scan-campaign.py`, 2 valores literais: a chave de API e a credencial do servidor de controle) não achou ocorrências nem processos da campanha.

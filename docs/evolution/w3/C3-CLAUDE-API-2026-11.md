# Registro da campanha C3 (Claude Agent SDK, rota API), 2026-11-02

Escopo: campanha C3 do fechamento pré-W6 (PLAN-4, WC), binding `binding:claude-api-c3` (`runtime:claude-agent-sdk`, rota `api`, cobrança medida). Autorização do owner no ato (2026-11-02): no máximo 2 inferências, reserva de US$ 0,25 por requisição, teto da campanha de US$ 1,00, exceção de cota em seu nome, validade de 60 min, instalação do SDK por `npm`.

**Resultado: FAIL com desfecho incerto, depois diagnosticado como BLOCKED por saldo insuficiente da console (ver o adendo no fim). Nenhum nível de certificação é declarado e nada foi promovido.** A primeira inferência terminou em `CONTROL_OUTCOME_UNCERTAIN`; a campanha foi cancelada sem executar a retomada, e a causa não foi determinada. Este registro não reescreve nada como PASS.

## O que correu

| Item                   | Valor                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK                    | `@anthropic-ai/claude-agent-sdk@0.3.316`, instalado em diretório novo e vazio, com `--ignore-scripts`. A integridade do `package-lock.json` (`sha512-mCMr0que…CWg==`) é igual à do registro. Cliente `Claude Code 2.1.316`, modelo `claude-haiku-5-5` |
| Credencial             | `claude/anthropic-api-key`, lida do `pass` e injetada só pelo ambiente do processo. A impressão digital observada na inspeção é igual à do manifesto (`inspect-before.json: credential_fingerprint_matches_manifest: true`)                           |
| Inspeção               | A listagem de modelos autenticou a chave. Ela **não mede saldo nem cota** (`quota_available_microusd: null`)                                                                                                                                          |
| Concessão              | `max_requests: 4`, `max_cost_microusd: 1000000`, reserva de 250000 por requisição, exceção de cota limitada ao binding e ao prazo (`grant.json`)                                                                                                      |
| Passos planejados      | criação e retomada (`plan.json`). Só a criação foi despachada                                                                                                                                                                                         |
| Desfecho da criação    | evento `uncertain` no ledger da campanha (`ledger-rows-before-cancel.json`, sequência 5)                                                                                                                                                              |
| Diagnóstico registrado | `worker.message: uncertain result: stop_reason="refused" usage=present` (`failure.json`)                                                                                                                                                              |
| Estado final           | `requests: 1`, `committed_microusd: 250000`, `cancelled: true`, `live_commands: []`, `unresolved_commands: [1]` preservado (`final-state.json`)                                                                                                       |

## O que se sabe sobre a causa

- **"refused" é decisão do driver do HSEOS, não recusa do modelo.** Em `claude-agent-sdk-driver.js`, o driver devolve `refused` quando o `init` traz ferramentas ou modo diferente de `plan`, quando há bloco que não é texto, quando há negação de permissão ou quando o `result` não é `subtype: success` com `is_error: false`.
- **Não é deriva de capacidade do `init`.** Um diagnóstico sem custo (`diag-init-no-cost.mjs`, saída em `diag-init-no-cost.output.jsonl`) usou as mesmas opções do driver, um `HOME` vazio (sem login) e uma chave inválida, de modo que nenhuma chamada ao modelo podia ser cobrada. O `init` veio com `tools: []`, `permissionMode: plan`, `mcp_servers: []` e `claude_code_version: 2.1.316`.
- **Um erro de API chega com a mesma forma que o desfecho incerto.** No diagnóstico, a falha de autenticação veio como `result` com `subtype: success`, `is_error: true`, `api_error_status: 401` e uso presente. O driver trata isso como `refused`. Isso torna plausível que a chamada real da C3 tenha devolvido um erro de API, mas **não prova** qual.
- **O modelo existe para a chave.** `GET /v1/models/claude-haiku-5-5` respondeu 200 (e o de `claude-haiku-4-5-20251001` também). O identificador do modelo não é a causa.
- **Causa não determinada.** Pelo que foi medido, não se distingue entre falta de saldo ou limite da conta, outro erro de API na chamada de mensagem e um resultado não bem-sucedido do cliente. O driver não retém o conteúdo do erro, e só uma segunda chamada, instrumentada, o revelaria.

## Custo

- O `committed_microusd: 250000` é a **reserva conservadora** do controle (o adapter mantém a reserva máxima quando não há custo liquidado). Não é custo cobrado.
- O custo real da chamada é **desconhecido**: o resultado foi incerto e o cliente não devolveu `total_cost_usd` ao recibo. Se a chamada foi um erro de API, é possível que nada tenha sido cobrado, mas isso não está provado. A fatura da console não foi consultada.
- A reserva retida de US$ 0,25 permanece até reconciliação; o teto de US$ 1,00 da campanha não foi excedido.

## O que isto não prova

Não prova nenhum item de L2 para o binding do SDK por API: nem credencial efetiva em uso, nem modelo ou custo observados na resposta, nem recuperação de sessão. A autenticação da chave e a existência do modelo são fatos de inspeção, não de campanha. A rota de assinatura da família (C2) é outro binding e não cobre este.

## Decisão pendente do owner

Repetir exige uma nova campanha: o comando incerto permanece não resolvido nesta, e a criação mais a retomada somariam 2 inferências, depois de 1 já consumida, o que excede as 2 autorizadas. As opções são autorizar uma chamada de diagnóstico instrumentada e uma nova C3, ou manter a C3 como FAIL e seguir para a C4.

## Arquivos

Diretório `docs/evolution/w3/evidence/pre-w6-c3/`: `manifest.json`, `grant.json`, `plan.json`, `inspect-before.json`, `failure.json`, `ledger-rows-before-cancel.json`, `final-state.json`, `scan-after.json`, `claude-binding.json`, `run-c3.cjs`, `diag-init-no-cost.mjs` e `diag-init-no-cost.output.jsonl`. A varredura (`scan-after.json`, 2 valores literais: a chave de API e a credencial do servidor de controle) não achou ocorrências nos artefatos nem no diretório da campanha, e nenhum processo da campanha restou. A varredura usa `evidence/pre-w6-scan/scan-campaign.py`, agora com suporte a segredos do `pass`.

## Adendo: diagnóstico autorizado e causa (2026-11-02)

O owner autorizou, depois do registro acima, uma única chamada de diagnóstico instrumentada (reserva de até US$ 0,25), seguida de uma nova C3 se a causa permitisse. A chamada usou o SDK direto, as mesmas opções do driver, `HOME` vazio (sem login que servisse de fallback) e a chave do `pass` (`diag-paid.mjs`, saída em `diag-paid.output.jsonl`).

| Campo                    | Valor observado                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `init`                   | `tools: []`, `permissionMode: plan`, `apiKeySource: ANTHROPIC_API_KEY`, modelo `claude-haiku-5-5` |
| Mensagem do modelo       | texto `Credit balance is too low`                                                                 |
| `result`                 | `subtype: success`, `is_error: true`, `api_error_status: 400`                                     |
| Uso e custo (do cliente) | 0 tokens de entrada e de saída, `total_cost_usd: 0`, `model_usage` vazio                          |

**Causa:** saldo de crédito insuficiente na console da conta dona da chave `claude/anthropic-api-key`. A API respondeu 400 e o cliente devolveu o erro com a forma de um `result` bem-sucedido com `is_error: true`, que o driver classifica como `refused`. A hipótese levantada acima fica confirmada para a chamada de diagnóstico; para a primeira tentativa da campanha ela é a explicação consistente (mesma chave, mesmo modelo, mesmas opções, mesmo `usage=present`), mas o conteúdo do erro daquela chamada não foi retido.

**Custo:** a chamada de diagnóstico não consumiu tokens segundo o cliente (valor do cliente, não fatura). Pela mesma causa, é muito provável que a primeira tentativa da C3 também tenha custado zero; isso não está provado, e a reserva conservadora de 250000 µUSD continua retida no ledger da campanha cancelada.

**Estado da C3: BLOCKED.** Causa externa e verificada: falta crédito na console. Uma nova campanha agora falharia do mesmo modo, então não foi aberta e nenhuma segunda inferência da campanha foi despachada. O que destrava é o owner adicionar crédito à console Anthropic; depois disso a C3 precisa de uma nova autorização do owner, com novo teto, sem herdar saldo nem reserva desta tentativa. O binding L0, o SDK `0.3.316` pinado e o roteiro `run-c3.cjs` ficam prontos para reuso (a variável de modelo e os limites são os do manifesto). O que não muda: nenhum item de L2 é afirmado para este binding.

Arquivos acrescentados em `evidence/pre-w6-c3/`: `diag-paid.mjs`, `diag-paid.output.jsonl` e `scan-after.json` refeito (varredura do diretório da campanha e dos artefatos versionados, com a chave de API e a credencial do servidor de controle; 0 ocorrências).

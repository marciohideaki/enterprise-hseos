# Controle de campanhas — protótipo W3

Checkpoint histórico do protótipo T1/T2; estado atual em [ADAPTERS-CAMPAIGN](ADAPTERS-CAMPAIGN.md).

Estado deste checkpoint: T1/T2 com testes focados; não disponível como binding real instalado.
O serviço ainda exige adapters confiáveis fornecidos em processo. O CLI `serve`
não aceita módulos de adapter escolhidos pelo cliente. Ver `STATUS.md` para os
limites da evidência; T3–T5 continuam necessários.

## Fluxo

1. O operador configura uma autorização de uso único: ID UUID, bindings e tarefas
   permitidos, prazo absoluto, teto de chamadas e teto em micros de USD.
2. O cliente cria uma campanha referenciando somente o ID dessa autorização.
   A autorização é consumida no mesmo ledger e na mesma transação da criação.
3. Cada `run` exige sequência atual, ID idempotente, binding e tarefa autorizados.
   O adapter inspeciona identidade, credencial efetiva, versão, artefato e quota.
4. A reserva do pior custo declarado precede a execução. Respostas confirmadas
   geram recibo; perda ou inconsistência mantém resultado incerto e reserva.
5. `cancel` persiste a decisão. `reconcile` exige digest do relatório atual e não
   libera uma execução cujo controlador ainda está vivo. O custo reservado ou
   sobreconsumo conhecido permanece contabilizado após a reconciliação.

Um novo ID de campanha não permite reutilizar a autorização. Trocar processo ou
binding não zera as chamadas anteriores. Repetir comando confirmado retorna seu
recibo; repetir uma intenção incerta não dispara outra execução.

## Superfícies

| Operação             | HTTP                                     | CLI                                    | SDK JS/TS        | SDK Python        |
| -------------------- | ---------------------------------------- | -------------------------------------- | ---------------- | ----------------- |
| Inspeção declarativa | GET `/v1/provider-bindings?binding_id=…` | `control binding-inspect --binding …`  | `bindingInspect` | `binding_inspect` |
| Comando              | POST `/v1/provider-campaigns/commands`   | `control campaign-command --request …` | `campaign`       | `campaign`        |
| Estado               | GET `/v1/provider-campaigns/:id`         | `control campaign-query --resource …`  | `campaignQuery`  | `campaign_query`  |
| Eventos              | GET `/v1/provider-campaigns/:id/events`  | `control campaign-events --resource …` | `campaignEvents` | `campaign_events` |

Comandos usam envelope v1 com `command_id`, `resource_id`, `expected_sequence`,
`action` e `input`. Ações: `create`, `run`, `cancel`, `reconcile`. As superfícies
herdam autenticação loopback, recusa de Origin/redirect e erros sanitizados da API
existente. A inspeção declarativa não consulta conta nem certifica autenticação.

## Pendências para adapters reais

O loader público deve exigir estado durável fixado pela autorização e recusar
override para um ledger novo. Os testes atuais preservam consumo no mesmo ledger;
o default temporário de fixtures não pode ser usado como configuração real.

O prazo/abort do controle precisa ser honrado por transporte limitado e drain
verificado no adapter. Um callback de teste que atende AbortSignal não comprova
esse comportamento em SDK ou processo externo. O teto monetário depende de um
limite por chamada efetivamente imposto pelo adapter, não apenas declarado.

A configuração real deve fixar as versões oficiais e demonstrar a seleção da
credencial, origem de quota e custo, ausência de fallback, e recuperação da mesma
sessão. Campos desconhecidos não podem ser preenchidos com zero para produzir
um recibo aparentemente completo. Sem essas provas, o adapter não é elegível
para a campanha real, mesmo que os testes do controle passem.

# Teste de agente ACP real — 2026-09-26

**Interoperabilidade ACP validada; admissão como runtime L0 bloqueada.**
Foi usado `@agentclientprotocol/codex-acp@1.13.1` (Apache-2.0), instalado em diretório
temporário externo com scripts npm desativados e integridade registrada. O agente
usou explicitamente o binário Codex 0.157.1 já validado, em vez do binário incluído
como dependência do pacote. Nenhuma dependência de produção foi adicionada.

A [documentação do agente](https://github.com/agentclientprotocol/codex-acp)
descreve o servidor ACP stdio, `CODEX_PATH`, `CODEX_CONFIG` e o modo inicial. O ensaio
utilizou `ProcessAcpPeer` do HSEOS, sem criar outro transporte JSON-RPC.

## Resultado real

- Negociação ACP versão 1 e criação de sessão com modo `read-only` confirmado.
- Primeira inferência retornou exatamente `READY`, validado por hash, com
  `stopReason: end_turn`.
- Processo do agente reiniciado; `session/load` da mesma identidade recuperou o
  histórico com a resposta anterior, sem nova inferência para carregar a sessão.
- Segunda inferência cancelada após o primeiro fragmento de resposta;
  `session/prompt` encerrou com `stopReason: cancelled`.
- Nenhuma solicitação de host recebida pelo cliente e nenhum evento `tool_call`
  observado. Isso descreve o ensaio, não uma impossibilidade estrutural de efeitos.
- Supervisor com prazo de 180 segundos, 768 MiB e 256 processos/threads;
  encerramento e drenagem do cgroup concluídos.
- Regressão ACP/runtime: **38/38 testes**, zero falhas e zero skips, Node 24.

Os [recibos e hashes](evidence/acp-real/receipt.json) incluem versão, integridade,
negociação, respostas, admissão recusada e validação. As credenciais não fazem
parte da evidência.

## Bloqueio de admissão L0

Uma segunda execução, **sem inferência**, tentou admitir o agente pelo
`AcpRuntimeProvider`. O único método enviado foi `initialize`. A resposta real
foi recusada com `agentCapabilities contains unknown fields`.

A comparação entre resposta e contrato identifica diferenças concretas:

- `agentCapabilities.providers`, `mcpCapabilities.acp`,
  `sessionCapabilities.fork` e `sessionCapabilities.subagents` não pertencem às
  listas aceitas pelo validador atual.
- O agente anuncia método de autenticação API, embora o ensaio tenha reutilizado
  a conta autenticada. O bridge L0 atual não aceita `authMethods` não vazio.
- Não há atestação `_meta.hseos.effectBoundary: instructions_only` na resposta.
  Nenhuma atestação local foi fabricada para compensar essa ausência.
- Sessões reais têm modos e opções de configuração; o contrato L0 atual também
  restringe esses campos.

O erro real observado é a primeira dessas incompatibilidades. As demais são
constatações da leitura do contrato e da resposta, não tentativas sucessivas de
burlar o gate. Nenhuma restrição de segurança foi removida.

Para integração L0, o próximo trabalho é definir uma composição efetivamente sem
ferramentas/efeitos internos, verificá-la no host e adaptar a negociação dos campos
ACP conhecidos. Apenas descartar campos novos ou aceitar o modo somente leitura
não resolve a fronteira de efeitos. Esse ensaio não registra um adapter ACP de
campanha como pronto.

## Revisão adversarial e orçamento

“ACP funciona” é sustentado para transporte, sessão, geração, carga de histórico e
cancelamento neste agente/versionamento. “O agente está pronto como runtime L0” é
refutado pelo teste de admissão. “Não houve ferramenta, logo não pode haver efeitos”
também é refutado: ausência observada não constitui atestação.

Foram dois prompts pela conta, com quota observada e créditos pagos desabilitados;
nenhuma API paga foi chamada. O teto global segue USD 10, com USD 8 de reservas
históricas retidas e USD 2 disponíveis. O piloto de protocolo foi controlado pelo
supervisor, mas não transitou pelo adapter de campanha: essa limitação está
registrada expressamente, sem alegar contabilização integrada no ledger ou fatura
verificada. Gemini/API não foi exercitada nesta etapa.

## Continuação do checkpoint

O bloqueio de admissão descrito acima foi tratado em um incremento separado,
com perfil fixado, prova offline e campanha real. A evidência deste diretório
permanece histórica e não foi reescrita. Ver [ACP-CAMPAIGN.md](ACP-CAMPAIGN.md).

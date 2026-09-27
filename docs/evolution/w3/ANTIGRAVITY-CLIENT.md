# Cliente Antigravity — componente T3

`packages/control-sdk/antigravity_client.py` conecta as ferramentas customizadas
do SDK oficial à API HSEOS por meio de `ControlClient`. Requer Python >=3.11.
Importação não carrega o SDK; configuração exige a versão instalada exata.
A configuração local admite endpoint literal `http://127.0.0.1:<port>` com modelo
explícito ou checkpoint LiteRT. A factory de campanha aceita somente checkpoint
LiteRT CPU, sem download automático; não há fallback para API/conta.

A fachada atende exatamente uma tarefa. `task_status` retorna somente campos
selecionados; `resume_task` e `cancel_task` existem apenas quando o operador fornece
os envelopes completos e fixados. O modelo não escolhe UUID, sequência, comando,
reconciliação, workspace ou credencial. Retransmissão automática não ocorre.
Falha incerta cerca novas ações de resume; cancelamento previamente autorizado e
consulta permanecem possíveis. Os UUIDs duráveis do servidor preservam idempotência
se outro cliente repetir o mesmo envelope após reiniciar.

A configuração oficial usa zero ferramentas nativas, zero subagentes, zero MCP,
zero skills, scratch explícito e retries zero. Todas as ferramentas customizadas
passam pela API do kernel. Contadores de uso ausentes permanecem `null`; não existe
estimativa fictícia de zero. O texto final é representado por hash, e a saída é
limitada a 1 MiB. O contexto SDK é fechado em sucesso, erro e cancelamento.

## Limites da entrega

A factory `provider-antigravity-adapter.js` agora vincula este componente ao
launcher `antigravity_campaign_worker.py`, com reserva no controlador, seleção de
artefatos e supervisão de processos/cgroup. O modo campanha expõe somente
`run_campaign_model`; não pode ser combinado com os envelopes de resume/cancel
do kernel. A ponte autenticada fixa o filho e faz reserva no mesmo orçamento
antes do efeito. Sem chamada subordinada concluída, o pai não recebe sucesso.

A retomada de conversa usa identidade proveniente de recibo anterior da mesma
campanha/tarefa/binding e uma nova reserva. A configuração fixa o identificador;
o ensaio real de recuperação continua pendente. Consulte
[adapters e limites](ADAPTERS-CAMPAIGN.md) e a [revisão adversarial](ADVERSARIAL-REVIEW.md).
Contenção de recursos não comprova sandbox de filesystem. Binding do proprietário,
checkpoint utilizável, teto financeiro e campanha real ainda são necessários.

## Checkpoint histórico de validação

- Dez testes Python determinísticos exercitam fronteira, escopo, idempotência,
  incerteza/cancelamento, configuração, versão, dependência ausente, uso e limites.
- A suíte Node chama esses testes sem instalar o SDK.
- O SDK oficial `google-antigravity==0.1.18` foi instalado em venv temporário externo
  ao projeto e usado somente para construir `LocalOpenAIAgentConfig` real.
  Rede e criação de processos foram bloqueadas pelo teste. O recibo está em
  `evidence/antigravity-client/official-sdk-config.json`.

Fontes: SDK oficial no checkout `7f19db07e7c6c5038102b45a8a7a5da7eecc8b11`,
`google/antigravity/{types.py,connections/connection.py}` e configurações local/OpenAI.
O pacote instalado foi verificado separadamente; não se presume equivalência
byte a byte entre wheel e checkout. O SDK opcional não foi incluído na dependência
npm nem instalado globalmente.

## Validação do incremento

O recibo `evidence/campaign-adapters/official-sdk-local.json` registra configuração
LiteRT aceita pelo SDK oficial com rede/processos proibidos, checkpoint placeholder
e ferramenta de composição única. Os testes Python agora também cobrem composição,
LiteRT e identidade de conversa. Isso não é inferência local nem campanha real.

## Incremento local real — 2026-09-26

O checkpoint histórico acima não descreve o estado atual. A conexão controlada,
métricas nativas, limites e composição com cliente terminal são descritos em
[Antigravity local](ANTIGRAVITY-LOCAL.md). O diagnóstico inicial permanece preservado
em [LITERT-LOCAL-DIAGNOSTIC.md](LITERT-LOCAL-DIAGNOSTIC.md); seus bloqueios não devem
ser confundidos com o resultado dos ensaios posteriores.

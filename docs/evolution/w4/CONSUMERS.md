# W4 — consumidores externos e campanha integrada

## Instalação e identidade

Em 29/09/2026, `hseos-4.0.0-rc.0.tgz` foi empacotado com 1.457 entradas e
instalado com `npm install --offline` em
`/tmp/hseos-w4-real-consumers-20260929/project`, fora do checkout. O módulo
nativo `better-sqlite3` foi reconstruído offline nesse consumidor. `plugin
doctor` validou os bytes dos quatro plugins ativos contra os digests do catálogo.
Uma instalação nova adicional, também fora do checkout, registrou início, fim e
147 pacotes instalados a partir do mesmo tarball offline.
Cada plugin passou seu autoteste de conformance e uma execução isolada em Node 22
e 24; os recibos indicam descendentes encerrados. O campo `certified:false` do
autoteste é o comportamento do contrato, não um selo de certificação automático.

| Família    | Consumidor instalado  | Uso verificado                                                                                                                                                                       |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ferramenta | `source-audit`        | `ToolRuntime` na tarefa do job; mede hash, linhas e marcadores de revisão.                                                                                                           |
| Contexto   | `runbook-context`     | Entrada inicial no assembler da mesma tarefa, com origem `plugin://` fixada.                                                                                                         |
| Provider   | `policy-verifier`     | Porta `RuntimeProvider` L0 e campanha local; valida o artefato entregue à tarefa.                                                                                                    |
| Provider   | `source-review-model` | Porta `ModelProvider` e campanha fixada no job; solicita `source.audit` e encerra após o resultado. É um consumidor demonstrativo de revisão de fonte, com artefato de exemplo fixo. |

## Jornada observada

O `policy-verifier` concluiu uma campanha local, sem custo e sem efeito pendente.
Seu resultado validou o SHA-256 do arquivo de exemplo e entrou como fonte fixada
no contrato da tarefa. A tarefa seguinte, o job
`7a7e22b4-ff12-491a-92c9-d02c8d4b53f2`, selecionou os plugins de modelo,
ferramenta e contexto. A admissão persistiu a campanha
`3dd878ba-3d8b-4f98-a379-1e2049db35b3` no mesmo ledger do job, vinculada à
autorização `f37e619d-80f8-4a1b-9cb0-d47c77509f71`. Antes das duas execuções
do modelo, o ledger registrou `plugin_request` e `reserved`; cada uma recebeu
`plugin_result` e `receipt`. O total comprometido foi zero e não restaram comandos
incertos. A ferramenta `source.audit` foi invocada pela tarefa aprovada.

O workflow `6de04e27-adb5-452d-9d76-8a7ea80a9170` dependia do aceite dessa
tarefa. Seus dois filhos executaram em ordem, terminaram aprovados e liberaram a
reserva do workflow. Os filhos usaram respostas locais fixadas; o provider foi
consumido no job predecessor. Outro job ainda enfileirado foi cancelado antes de
claim, sem despacho. A prova de cancelamento durante execução e drenagem de
descendentes, plugins e processos está na matriz determinística W4-07a:
`test/test-job-faults.js` e `test/test-execution-plugin-runtime.js`, executados
em Node 22 e 24 sem falhas nem skips. O cancelamento real aqui prova apenas o
caminho de fila.

## Binding de conta e orçamento histórico

A resposta do responsável, “Pode seguir com a autorizacao anterior”, foi
aplicada dentro do limite W3 de **dois despachos adicionais e US$ 0 adicional
pago**, sem alterar o teto histórico de US$ 10 nem a reserva de US$ 9. Uma
inspeção atual do binding Codex confirmou a mesma impressão digital da conta,
rota `account`, uso ordinário disponível e ausência de créditos pagos antes dos
efeitos. Não houve ativação operacional.

O primeiro despacho concluiu no provider, mas seus 16.955 tokens de entrada
excederam o manifesto configurado com 8.192. O controle marcou o resultado
incerto. A sessão local mostrou o prompt exato, `task_complete` e contagem de
tokens; a reconciliação registrou a evidência e **reteve** a reserva original.
Essa tentativa permanece uma falha de validação de recibo, não um passe. O
segundo e último despacho usou manifesto de 65.536 tokens, produziu recibo
`completed` com 16.781 tokens de entrada e dez de saída e deixou a campanha
sem comandos incertos. O recibo reportou custo do provider como `null`; o
controle comprometeu US$ 0 sob o binding de assinatura, sem converter cota em
autorização financeira. Não há despachos adicionais autorizados por essa decisão.

## Reexecução e limites dos recibos

Os scripts, catálogo, manifests, entradas e logs comprimidos estão em
[`evidence/real/`](./evidence/real/). `verification-receipt.json` traz SHA-256
dos scripts, logs, tarball e IDs correlacionados. `run-provider-port.cjs` emite
`provider-port-result.json`; `run-job-dag.cjs` o consome. A campanha Codex depende
de autorização explícita vigente e **não deve ser repetida** a partir desses
scripts: o limite de dois despachos já foi consumido. As sessões brutas da conta
permanecem fora do repositório; só seu hash e observações sem credenciais foram
versionados. O teste local da DAG e os autotestes de plugin podem ser repetidos
com instalação offline e isolamento disponíveis.

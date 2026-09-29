# W4-02c3c — modelo de execução na tarefa

Tipo: contrato pré-implementação; Constituição §§2.6/5/7, ADR-0045 Proposed,
FR01/02/05/06/08. Task hseos-w4-task-model criada sobre 78f27f7 para preparação
independente. W4-02c3b integrada em eb55fd6/2c06be5 após gate/hook aprovados;
base atualizada por fast-forward a 2c06be5 antes da implementação.

## Reuso e entradas

execution-plugin-model.js e execution-plugin-campaign.js já validam saída antes
do recibo, fixam ID por request e exigem ProviderCampaignControl nominal.
engineering-task-runtime.js compõe registro de modelos/sessão; engineering-control.js
é o serviço público; selection.js fixa conteúdo/configuração/política. Não criar
outro ledger, autorização, saldo, broker ou executor.

Catálogo local contém configuração semântica do modelo: schema_version, binding_id,
model selecionado, models e limites de campanha existentes. Port gera manifesto
ProviderControl v2; configuração/manifesto ficam cobertos pelo pin da seleção.
Modelo único, exclusivo com responses e binding_id legados. runtime-provider
continua um port L0 explícito, sem fingir compatibilidade com kernel ModelProvider.

## Contrato de controle e identidade

Create admite referência plugin_model com selection_id e campaign_id, somente IDs,
mais extension_ids de tools/contexto. Toda seleção fica fixada no created. Campaign
já deve existir no mesmo controle e autorizar o resource_id do comando: esse UUID
é a identidade de tarefa autorizada, distinta do task_run_id interno aleatório.
Created persiste campaign_id, resource_id, binding_id, selection_id e manifesto do
modelo/seleção para replay; queries não carregam plugin ou campanha.

Binding da campanha precisa ter manifesto idêntico ao port selecionado. Para cada
execução, reconstruir port e fachada ProviderCampaignControl sobre o mesmo ledger,
com os mesmos manifestos e identidade de campanha. Sem comando create de campanha,
sem nova autorização. Fachada não amplia bindings nem autorizações. Atualização de
configuração/conteúdo/política/manifesto bloqueia antes do primeiro efeito.

Configuração local permite declarar o binding de plugin sem caminho de código
recebido por HTTP. O loader inspeciona somente a seleção declarada; cria port host
sem importar código externo. Nenhum processo externo em create/help/import/query.
Port de execução é reconstruído para cada tarefa, nunca reutilizado após close.

## Ciclo e falhas

Admitir e validar escopo antes de registrar intenção/create. Antes de cada request,
confirmar prazo fixo da tarefa, cancelamento e reserva pela campanha original.
Prazo efetivo é mínimo entre tarefa, campanha e limite da chamada. Não modificar
o manifesto pinado para aplicar um prazo absoluto mais curto.

Registro de modelos usa o port existente; propostas de ferramenta seguem ToolRuntime.
Contabilidade local de tokens permanece independente do limite monetário; ambos
limitam a execução. Cancelamento de tarefa aborta modelo e aguarda drain. Cancelamento
de campanha propagado pelo ledger alcança fachada; serviço não pode fechar enquanto
houver execução/drain ativo. Facadas são encerradas sem cancelar trabalhos alheios.

PLUGIN_RESULT_UNCERTAIN/teardown incerto persistem incerteza da tarefa e impedem
verificação/resultado aprovado. Reconciliação não autoriza repetição automática de
request incerto. Reserva permanece comprometida na campanha. Reabrir tarefa não
renova prazo nem cria saldo. Resultado confirmado conserva evidência de provider.

## Saídas e verificação

Outputs previstos: tools/cli/lib/engineering-plugin-model.js (composição host),
engineering-task-runtime.js, engineering-task-state.js, engineering-control.js,
control-configuration.js, execution-plugin-model.js/execution-plugin-campaign.js
somente para extensão explícita de prazo/drain; CLI factory se necessária;
test/test-engineering-plugin-model.js, testes de configuração/compatibilidade,
package.json, test/test-package-surface.js, STATUS e evidence/task-model/\*.

Comando: node --test --test-concurrency=1 test/test-engineering-plugin-model.js
test/test-execution-plugin-providers.js test/test-provider-campaign-control.js
test/test-control-configuration.js test/test-engineering-task-extensions.js.
Node22/24 sequenciais, ABI SQLite correspondente, c8 --all por arquivo crítico
90% linhas/80% branches. Gate integral, revisão cega/confronto antes do commit.

Cenários: create-only sem efeito; modelo produz tarefa verificada; proposta tool pelo
gateway; escopo/campanha errados, fonte concorrente, drift e prazo expirado recusados;
reserva antes do efeito; cancelamento tarefa/campanha com drain; saída inválida ou
recibo perdido deixam reserva e tarefa incertas; reinício consulta mesma identidade;
legados sem seleção continuam funcionando. Fixtures não certificam consumidor real.

## Confronto preparatório e ajustes de fronteira

Revisor isolado identificou três lacunas concretas no desenho inicial: instâncias
com ledger comum não compartilham active/inspections/inflight/drains; shutdown da
fachada cancela a campanha inteira; run público sem request da ponte reservaria
antes de falhar. Nenhuma dessas lacunas é aceita como comportamento.

A capacidade proprietária ProviderCampaignControl fornecerá derivação restrita de
binding com manifesto idêntico, sem novas autorizações, compartilhando coordenação
e estado de fechamento do controlador original. O serviço observa todos os drains;
shutdown global alcança esses trabalhos. Fechar tarefa fecha somente seu port e
aguarda seus requests, sem chamar shutdown da campanha/fachada. Alteração é extensão
da autoridade existente, com testes de compatibilidade da composição subordinada.

Binding execution-plugin expõe admissão host síncrona do request pendente antes da
reserva. Sem pedido preparado pela ponte, campaign.run público é recusado antes de
reserved/efeito. Inspeção de metadados continua disponível sem pending ou import.

Ao restaurar via controle, conferir resource_id da seleção contra a associação
registrada state_directory: o chamador HTTP não escolhe identidade de autorização
separada. Drain do modelo integra a verificação anterior ao aceite, não somente o
finally. Port expõe drain sem dispose para permitir correções na mesma sessão;
close final aborta somente seus próprios requests.

Adicionar ensaios: duas tarefas compartilham campanha original; encerrar uma não
cancela a outra; shutdown original observa fachada ativa; despacho público direto
sem pending falha sem reserva; drift de associação resource/state é recusado.
Outputs incluem provider-campaign-control.js e respectivos testes, por serem a
fronteira proprietária da derivação e admissão pré-reserva.

## Bloqueio da revisão cega — identidade do ledger

A primeira implementação foi refutada: checar somente resource_id/campaign_id e
manifesto não impede passar outro controle JavaScript com UUIDs repetidos e saldo
novo. Correção obrigatória antes do aceite: pin também fixa identidade do controle,
reutilizando state/state_identity/ledger_identity do contrato de configuração
candidata. Restore compara essas identidades e a associação registrada entre
resource_id e state_directory antes de mutações/reconciliação. Queries permanecem
sem inicialização de providers. Teste deve criar outro ledger com UUIDs e manifestos
iguais e demonstrar rejeição sem reserva/efeito.

Nesta etapa a identidade é física (path canônico, device/inode do diretório/ledger),
coerente com control-configuration. Backup/restore ou relocação desse controle exige
rebind governado na W4-03c; não é permitido fingir identidade preservada por copiar
UUIDs. Seleção de conteúdo offline continua relocável independentemente do controle.

Manifesto tools/cli/command-manifest.json é saída gerada adicional obrigatória
após alterar a factory CLI; regenerar com npm run compile:cli.

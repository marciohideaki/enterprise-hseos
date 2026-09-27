# Revisão W4-02c3c

Tipo: evidência determinística, Constituição §§2.6/5/7, ADR-0045 Proposed,
.specs/features/harness-w4/task-model-composition.md. Revisor isolado
/root/review_plugin_providers, somente leitura e sem executar testes.

## Revisão preparatória do contrato

Foram identificadas coordenação in-memory separada entre fachadas, possibilidade
de shutdown local cancelar toda a campanha e reserva pública sem pending da ponte.
Contrato e implementação passaram a exigir lifecycle compartilhado, fechamento
local somente do port e validateDispatch síncrono antes da reserva. Derivação
aceita somente manifesto idêntico, sem criar autorizações.

## Cega — FAIL

P1: restauração conferia UUIDs/manifesto, mas aceitava outro ledger nominal contendo
campanha recriada. Isso permitia substituir a autoridade monetária pela interface
JavaScript. Não foi aceito nem convertido em aviso.

## Correção e nova inspeção

Pin fixa identidade física do controle, reutilizando contrato de configuração.
assertTaskPluginControl confere ledger e associação resource_id/state_directory
antes de retomada, reconciliação e cancelamento com efeitos. Execução direta sem
registro foi recusada; criação ocorre pelo controle antes de resume. Reabertura no
mesmo ledger é admitida. Summary público omite identidade/path interno.

Revisor confirmou estaticamente P1 resolvido, sem novo bloqueio. Teste adversarial
recria outro ledger com UUIDs, manifesto e registro iguais e verifica rejeição sem
reserva/efeito. Identidade física impede relocação/restore automático; rebind futuro
precisa preservar histórico e orçamento na W4-03c.

## Verificações do executor

Primeiro foco: 58/59 passaram; fixture propunha formato de patch inválido e foi
corrigida para before/after do contrato existente. Foco seguinte: 12/12 passaram.
Regressão anterior à correção de identidade: 180 testes passaram, porém task-state
teve branches 79,51%, reprovando gate 80%. Novo teste de autoridade conflitante
acrescentado; essa cobertura não é alegada como PASS. Foco de identidade: 23 PASS.
Node22 final focado: 87 PASS, zero falhas/skips. Node24 final/cobertura em andamento.
Confronto final dos recibos e gate integral ainda pendentes.

## Limitações

Ensaios são fixtures locais isoladas, não certificação dos consumidores externos
W4-07. Nenhuma chamada paga, nova autorização operacional, publicação ou ativação.
Jobs/DAG/superfícies e campanha integrada continuam pendentes. Identidade de controle
é candidata física; não se alega backup/restore operacional nesta task.

Node24 final: 185 PASS, zero falhas/skips. Nove arquivos críticos atendem 90/80;
task-state branches 81,17%. Cobertura anterior reprovada foi suplantada pelo
snapshot corrigido, não reclassificada. Confronto final e gate ainda pendentes.

## Confronto final

Revisor conferiu os 14 hashes contra fontes atuais e confirmou logs Node24 185
PASS, Node22 87 PASS, zero falhas/skips, nove arquivos 90/80 e task-state 81,17%.
P1 corrigido consta aprovado junto de reabertura legítima, cancelamento local e
shutdown compartilhado. Nenhum bloqueio de código remanescente; inventário não
reproduzido pelo revisor. Gate integral/hook pendentes. As referências anteriores
a andamento descrevem checkpoints anteriores, suplantados por este confronto.

Gate inicial bloqueou antes da suíte: manifesto CLI gerado estava stale. Causa
identificada no log gate-stale-cli.log.gz; npm run compile:cli regenerou somente
hash do comando control. Sem alteração de lógica. Gate integral será repetido.

## Reforço da prova de cancelamento

Após o confronto, o executor reforçou somente o helper de teste para observar
cgroup populado antes de cancelar/shutdown, em vez de apenas snapshot criado.
Gate em andamento foi interrompido, não convertido em PASS. Rodadas suplementares
Node22/24: 15/15 PASS em cada, zero skips. Hash antigo do teste e novo constam no
recibo; fontes de produção e cobertura permanecem as mesmas. Gate será refeito.

Revisor confirmou o complemento: started exige populated 1; cancelamento e
shutdown exigem ausência de grupos próprios depois. Logs 15/15 Node22/24 e hashes
conferidos. Gate interrompido corretamente não aprovado; nenhum novo bloqueio.

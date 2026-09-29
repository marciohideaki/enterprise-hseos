# W4 — estado de execução

Tipo: evidência de progresso, atualizado em 2026-09-28. Base 32eaef2; upstream
feature/hseos-evolution-foundation; feature/hseos-evolution-w4.
Governança: Constituição §§2.6/5/7, AGENTS.md, ADR-0045 Proposed.

## W4-01

Contratos/spec/design/tasks/intake produzidos. Ensaio do executor herdado Node24:
13 testes, 13 PASS, zero falhas/skips, incluindo filesystem readonly, rede negada,
cancelamento/órfãos e incerteza de drain. Isso verifica ambiente/reuso; não certifica
plugins/jobs W4. Comando/resultado em evidence/contracts/isolation-node24.log.
Launcher systemd delegado resolve a falta de cgroup no processo da sessão.
Node24 24.15.0 e Node22 22.23.3 disponíveis; host Linux x64, Python 3.14.4/bwrap.

Suítes completas não executadas nesta task documental. Carga no pré-check acima
dos seis núcleos físicos; manter testes focados e sequenciais até capacidade adequada.
Gate governado passou: zero falhas, um aviso de placeholder preexistente.
Código/testes não alterados; gate selecionou escopo documental pelos arquivos staged.
Revisão adversarial: a persistência temporária não é anunciada como operacional;
conformance externa não reutiliza host; FR01–FR08 têm tasks/células; campanhas e
ativação continuam pendentes. Contratos prontos para W4-02a.

## Matriz de entrega

| Etapa         | Determinístico                        | Consumidor real | Ativação       |
| ------------- | ------------------------------------- | --------------- | -------------- |
| W4-01         | contratos verificados                 | não aplicável   | não autorizada |
| W4-02         | implementado e testado localmente     | pendente        | não autorizada |
| W4-03         | 03a/03b integradas; 03c/03d pendentes | pendente        | não autorizada |
| W4-04 a W4-06 | pendente                              | pendente        | não autorizada |
| W4-07         | pendente                              | pendente        | não autorizada |
| W4-08         | pendente                              | pendente        | não autorizada |

## Limites e continuidade

- Estado atual do controle é fixture temporária; persistência operacional não certificada.
- US$ 10 de teto e US$ 9 reservados preservados; nenhuma chamada de campanha nesta task.
- W5–W8 e recibos W3 intactos. Arquivo alheio HSEOS-GOAL-HARNESS-AUTONOMO.md preservado.
- ADR Proposed documenta design candidato, não aprovação institucional.
- AEW disponível, stack resolve sem base; aplicação/enforcement não verificados.
- Preflight: registro vault sem modules.md/integrations.md; Axon index não encontrado;
  flag .compacted-without-end-session observada. São avisos, sem mutação de memória.

## W4-02a — admissão candidata

Implementados descritor estrito v1, leitura de catálogo v3 com compatibilidade v2,
hashes/paths/limites, dependências pinadas e admissão nominal sem import de código.
13 testes focados em Node22/24; marketplace 88 PASS. Cobertura e revisão em
evidence/admission/. Gate integral anterior à revisão passou; commit depende do
gate atualizado no hook. Instalação/execução isolada ainda é a próxima task.

## W4-02a integrada / W4-02b em validação

Admissão commitada em feee73c e integrada em d87d964 após gate e hook completo
Node24, incluindo PostgreSQL compartilhado sem skip. W4-01: 344fc13/cae04c8.
W4-02b implementa snapshot readonly, execução/CJS/ESM/conformance isolados e drain.
13 testes focados Node22/24 passaram; evidência/revisão em evidence/isolation/.
Gate integral Node24 passou, zero falhas, um aviso preexistente; recibo em
evidence/isolation/full-gate-receipt.json. Hook de commit ainda revalida.
W4-02c e W4-03–08 permanecem pendentes.
Não houve chamada de campanha, gasto adicional, publicação ou ativação.

## Ponto de retomada — W4-02c2b

W4-02b 00e2881/b68d7cb; W4-02c1 4efbe89/9a03224; W4-02c2a 6253233/414d73f.
Gates e hooks Node24 aprovados. Recibo mais recente do hook em
evidence/plugin-providers/prior-campaign-commit.log.gz.
Task atual .worktrees/hseos-w4-plugin-providers, branch task/hseos-w4-plugin-providers.
ModelProvider e RuntimeProvider L0 isolados pela ponte de campanha implementados;
65 testes Node22/24 passaram, zero skips, cobertura crítica acima de 90/80.
Revisão independente corrigiu validação tardia; gate integral renovado passou. Composição pública de tarefa (c3), W4-03–08
continuam pendentes. Nenhuma chamada paga, publicação, merge de PR ou ativação.

Recursos: heavy-run --pin --mem 3G; 1 CPU não zero/nice19, controlador e executores
no mesmo cgroup delegado limitado. Node24 /workspace/local/sdk/nvm/versions/node/v24.15.0/bin;
Node22 /build/tmp/hseos-w1-node/node-v22.23.3-linux-x64/bin. Link temporário SQLite
12.9.0 para Node22 removido após ensaio. Suíte integral usa PostgreSQL compartilhado
via túnel 127.0.0.1:39317; pass platform-shared-dev/postgres-platform e referência
enterprise-hseos/ci-postgres-reference. Não imprimir credenciais.

## W4-02c2b integrada / W4-02c3a em validação

Providers: commit 0678177, integração 7de3008, gate e hook Node24 aprovados.
Seleção durável em .worktrees/hseos-w4-plugin-selection, base 7de3008:
8 testes de seleção/distribuição Node22/24 passaram; cobertura 100/100.
Revisão independente em duas passagens, sem bloqueios. Gate integral Node24 passou; hook pendente.
Próximo: composição de tools/context/model pinados em tarefas (W4-02c3b).
W4-03–08 continuam pendentes; sem publicação, campanha paga, PR ou ativação.

## W4-02c3a integrada / W4-02c3b em validação

Seleção: 9ff033c/78f27f7, gate e hook Node24 aprovados; log preservado em
evidence/task-extensions/prior-selection-commit.log.gz.
Task hseos-w4-task-extensions implementa tools/contexto pinados na tarefa/controle,
reserva de contexto no teto original, proveniência, cancelamento e incerteza durável.
20 testes focados Node22 passaram. Regressão inicial Node24 112 PASS/0 skips,
cobertura crítica 90/80; ajustes finais em revalidação. Revisão independente em
duas passagens sem bloqueio de código; gate e hook ainda pendentes.
Próximo: W4-02c3c modelo/campanha na tarefa, depois W4-03–08. Sem chamada paga,
publicação, merge de PR ou ativação.

Revalidação final Node24: 113 PASS, zero falhas/skips; sete arquivos críticos
atingem 90/80, novo módulo 100/100. Recibos em evidence/task-extensions/.

Gate integral Node24 passou, zero falhas e um aviso de placeholder preexistente.
Hook de commit pendente; gate bruto comprimido preservado no diretório de evidência.

## W4-02c3b integrada / W4-02c3c em validação

Tools/context: eb55fd6/2c06be5, gate integral e hook Node24 aprovados. Hook preservado
em evidence/task-model/prior-task-extensions-commit.log.gz. Task atual
.worktrees/hseos-w4-task-model, base 2c06be5. Modelo local pinado na tarefa e fachada
compartilhando ledger/lifecycle da campanha implementados; teste de ferramenta
corrige código sem aplicar ao checkout original. Nenhuma chamada paga.

Revisão cega encontrou P1: outro ledger com UUIDs repetidos poderia substituir saldo.
Correção fixa identidade física do controle e associação recurso/diretório; teste
adversarial passou na rodada focada (23 PASS Node24). Revisor confirmou correção
estática. Identidade interna é omitida do retorno público. Backup/restore/rebind
operacional continua escopo W4-03c; relocação de controle não é presumida.

Regressão anterior à correção: 180 testes passaram, mas branches de task-state
79,51% reprovaram o mínimo 80%. Resultado não convertido em PASS. Teste de criação
com fontes conflitantes acrescentado; revalidação final/matriz/gates pendentes.
W4-03–08 ainda pendentes. Sem publicação, merge de PR ou ativação.

Revalidação final desta task: Node24 185 PASS e Node22 87 PASS, zero falhas/skips.
Cobertura dos nove arquivos críticos atinge 90/80 (task-state branches 81,17%).
Gate integral/hook ainda pendentes; evidências em evidence/task-model/.

Gate integral Node24 desta task passou: zero falhas e um aviso preexistente.
Reforço de prova de processo ativo/cgroup: 15/15 PASS adicionais em Node22/24,
confirmados pelo revisor. Hook de commit ainda pendente.

## W4-02c3c integrada / W4-03a em implementação

Commit 731c8f0, merge de task 2b33dc9 na feature W4. Hook integral concluído
com exit 0; recibo comprimido preservado em evidence/jobs-state/prior-task-model-commit.log.gz.
Sem merge na foundation nem ativação operacional.

W4-03a cria agregado control_job no ledger existente e extrai admissão compartilhada
do controle imediato. Migration 012 somente pending-activation. Primeira rodada
jobs/ledger/migrations: 21/22, falha de expectativa antiga de schema (11 vs 12);
expectativas aditivas corrigidas, rodada seguinte 23/23 Node24 sem skips.
Revisão cega apontou pin ausente do binding legado e conflito unilateral de ID;
ambos aceitos e corrigidos, aguardando confronto e regressão completa.
Claims, worker, materialização, orçamento integrado e superfícies permanecem pendentes.

W4-03a regressão inicial: 70/75; cinco falhas por expectativa de schema candidata
no dry-run/rehearsal. Após atualizar versão, 19/21; duas falhas remanescentes por
contagem fixa de migrations. Causas corrigidas sem remover gates de ativação.
Rodada final Node24: 63/63, zero skips. Cobertura por arquivo: controle 98,91%
linhas/92,40% branches; jobs 100%/96,11%; contrato 100%/100%. Node22 em curso.
Revisão estática encerrou achados P1/P2; confronto de evidências ainda pendente.

W4-03a Node22: 80/80 e complemento pós-lint 22/22; Node24 pós-lint 63/63 com
mesma cobertura. Confronto independente de hashes/logs aprovado sem bloqueios.
Gate integral Node24 PASS (zero falhas, um warning de template preexistente).
Hook de commit ainda pendente. Claims preparados em task separada, sem implementação.

Hook de commit W4-03a FALHOU em cancelamento entre processos com
SQLITE_BUSY_SNAPSHOT. Não houve commit. Reprodução determinística em duas conexões
confirmou transação externa deferred promovendo snapshot antigo para escrita,
apesar do ledger interno usar immediate. Mesma causa confirmada na reconciliação.
Correção adquirirá lock externo antes de leitura, preservando CAS e sem retry.
Revisão, cobertura Node22/24 e gate devem ser refeitos para os arquivos afetados.

Correção de lock W4-03a: Node24 183/183, zero skips. Seis críticos atingiram
90/80: controle 98,91/92,40; runtime tarefa 95,36/87,62; estado tarefa 100/82,55;
workflow 97,63/84,79; jobs 100/96,11; contrato jobs 100/100 (linhas/branches).
Node22 e novo gate/hook pendentes; nenhum commit efetuado nesta task.

Correção de lock W4-03a: Node22 também 183/183 sem skips, sequencial após Node24.
Receipts atualizados; novo gate/hook pendentes, sem commit ainda.

Novo gate W4-03a FALHOU no conformance canônico de providers; testes de lock passaram.
As 18 suítes isoladas pelo descriptor passaram no diagnóstico, sem certificar o
relatório canônico. Causa ainda sob investigação; commit permanece bloqueado.

Gate integral instrumentado W4-03a: PASS, zero falhas/dois avisos. Conformance
passou na sequência completa; falha histórica preservada com causa não comprovada.
Hook de commit pendente. Nenhuma afirmação de certificação integral W4.

W4-03a commit cbf79f2 aprovado pelo hook e integrado à feature em d948154.
W4-03b inicia sobre essa base em task isolada; recibo do hook anterior preservado.

W4-03b implementa claim/lease/fence, prazo fixo e reconciliação com drain.
Revisão inicial P1/P2 corrigida; 40/40 focados e cobertura worker100/86,06.
Primeira cobertura78,76 falhou e foi preservada. Validação completa Node24/22,
gates e commit pendentes. Nenhum worker de despacho/materialização certificado.

W4-03b Node24 completa281/282; falha exclusiva no teto de1450 arquivos do pacote
(inventário1452: worker+SQL013). Três críticos90/80 aprovados. Limite não alterado;
Node22 em curso e decisão explícita necessária antes de mudar esse threshold.

W4-03b Node22 também281/282: somente limite de pacote. Após correções de lint,
41/41 Node24 e41/41 Node22; worker100/91,30, jobs100/96,39. Lint finalPASS.
Bloqueada revisão do teto1450→1452 para worker e migration013, pendente decisão
explícita (AGENTS global§3h). Sem commit; demais unidades W4 continuam pendentes.

Usuário autorizou explicitamente a revisão1450→1452 para os dois arquivos do
inventário apresentado. Teto22MB e exclusões permanecem. Validação do ajuste
e gate integral pendentes; falhas históricas mantidas sem reclassificação.

Após autorização, pacote passou Node24/22. Gate integral Node24 PASS exit0,
zero falhas/um aviso de template. Log também registra Broken pipe no scanner
de higiene; não se afirma log sem diagnósticos. Conformance passou. Hook pendente.

W4-03b commit9a5129a: hook PASS exit0, integrado na feature. Recibo do hook
anexado à task03c. Materialização em andamento; dispatcher permanece03d.

W4-03c em validação: materialização partilha ledger e conserva IDs/snapshot/prazo;
registro atômico, views readonly e bloqueio das entradas antigas. Revisão isolada
fechou falhas de filesystem, manifesto alterável e ledger trocado; pin de inode
acrescentado. Run final de kernel/cobertura Node24 em andamento, Node22 pendente.
Falhas intermediárias e correções preservadas em evidence/job-materialization/REVIEW.md.
Nenhum critério integral de W4 é declarado concluído por esta unidade.

W4-03c Node22:776/776PASS, sem skips; pós-check44/44 em22 e24. Dezcríticos
acima90/80 nasduasversões. GatepacoteFAIL emambas:1454entradas>1452;9.12MB<22MB.
Novo inventário somente job-materialization.js e migration014. Aprovação1454
solicitada ao usuário e pendente; thresholdintacto, semgateintegral/commit03c.
Recibo: evidence/job-materialization/receipt.json. Despacho e restanteW4 pendentes.

### W4-03c — autorização e gate integral

Responsável autorizou prosseguir após solicitação explícita1452→1454. Limite aplicado;
22MB e exclusões de estado/segredos mantidos. Pacote passou em Node22/24. Gate integral
Node24 passou (exit0,zero falhas,um aviso preexistente de placeholders). Commit governado
e integração na feature são os próximos passos; W4 integral permanece em andamento.

### W4-03c integrada; W4-03d em implementação

Commit03c c49af0b2, merge na feature ec20d4a0; hook exit0. Log do hook preservado
na evidência03d. Nenhum merge foundation. Dispatcher03d, migration015 e testes
em desenvolvimento, ainda sem gate integral ou commit.

### W4-03d — implementação validada, pacote bloqueado

Kernel/schema Node24:819/819 antes do ajuste final de cancelamento de dependente;
focal final54/54. Kernel/schema Node22 final:820/820. Onze críticos acima90/80;
pós-checks22/24:10/10 cada, sete mutantes rejeitados. Lint/format exit0; hashes
finais preservados. Revisor isolado confirmou28 hashes, sem novo bloqueador.

Pacote FAIL em22/24:1456 arquivos contra limite autorizado1454; dois novos
assets necessários são job-dispatch.js e migration015. Solicitação de decisão
1454→1456 permanece sem resposta. Teto22MB e exclusões intactos. Sem gate
integral, commit03d ou integração. Recibo:evidence/job-dispatch/receipt.json.
W4-04–08, aceite real, PR e fechamento permanecem pendentes.

Responsável autorizou explicitamente elevar o limite1454→1456: “Autorizado a elevar o limite do pacote”. Ajuste aplicado;22MB e exclusões preservados. Revalidação e gate03d em andamento.

W4-03d gate integral Node24 PASS:exit0,zero falhas,um aviso preexistente de placeholders. npmtest integral e lint passaram após regenerar hashCLI. Evidência preservada; commit governado e integração na feature em andamento.

### W4-03d — revalidação concluída; commit impedido pelo ambiente

O hook anterior encontrou corrida de cancelamento (sessão completed, tarefa cancelled).
Duas reproduções confirmaram o defeito; propagação imediata de cancelamento e saída
tipada pela revisão corrigiram os caminhos. Os nove mutantes detectam as proteções.
Node22:212 testesengineering+9mutantesPASS;runtime96.32%linhas/88.04%branches.
Node24:gatefuncionalintegralPASS0falhas/1aviso; cobertura externa ao gateFAIL por
contaminação de fontes mutadas, preservada. Após isolar a instrumentação dos mutantes:
212 testesengineering+9mutantesPASS;runtime95.35%linhas/87.75%branches.

A sessão retomada estabeleceu .git somente leitura e approval_policy=never.
Sem novo commit03d ou merge. Fontes/evidências preservadas nesta worktree.
Próximo: ambiente com escrita Git e isolamento disponíveis, executar commit governado
com hooks, integrar03d e avançar04a1. Contrato04a1 preparado na worktree
hseos-w4-workflow-revisions, sem implementação e ainda baseado emec20d4a0.
W4 não está fechada;04–08, consumidores reais, PR e closeout continuam pendentes.

### W4-03d integrada; W4-04a1 iniciada

W4-03d:commit554f296c, hooks exit0; mergefeature991e721d. Bloqueio de escrita resolvido pelo responsável. Recibo de fechamento e log do hook em evidence/workflow-revisions/prior-closeout.json.
W4-04a1 começa sobre991e721d, com contrato workflow-revisions-implementation.md. Nenhum merge na foundation ou fechamento integral da W4.

### W4-04a1 — expansão queued validada; limite de pacote pendente

Workflow v2 com revisões encadeadas, expansão append-only antes do claim, evento
aditivo016 e replay/CAS preservados. Job create v1 e recibos históricos permanecem
compatíveis. Snapshot é revalidado na transação antes de persistir a expansão.

Node24 e Node22 sequenciais:847/847 kernel+schema em cada versão, zero falhas/skips.
Doze críticos acima90/80 (mínimos95,21%linhas e83,14%branches). Doze mutantes detectados
em cada versão. Pós-check do teste fortalecido de binding:25/25 expansão em22 e24.
Revisor isolado confirmou fontes de produção e cobertura, sem achados abertos de código.

Gate de pacote FAIL em22/24:1457>1456. Único asset acrescentado: migração016 (394bytes);
pacote9.148.839bytes<22MB. Autorização1457 solicitada, ainda pendente; limite preservado.
Gate integral não executado com esse bloqueio conhecido. Sem commit04a1 ou integração.
[Recibo e continuidade](evidence/workflow-revisions/receipt.json). W4 não está fechada.
Próximo: decisão1457, gate integral e commit governado04a1; depois04a2 e demais etapas.

Responsável autorizou explicitamente1456→1457: “Autorizado!”. Limite aplicado;
22MB e exclusões preservados. Revalidação do pacote e gate integral04a1 em andamento.

W4-04a1: pacote autorizadoPASS em22/24; gate integral24PASS (exit0,zero falhas,
um aviso preexistente de placeholders). Commit governado em andamento, sem mergefoundation.

### W4-04a1 integrada; W4-04a2a em fechamento

W4-04a1: commit 6f0129af, integração 2395d845. O pedido de pausa anterior ficou
preservado em evidence/workflow-reservations/PAUSED.md; a instrução atual retomou
a execução. W4-04a2a persiste revisões da reserva de sessão no stream existente,
valida claim, CAS, tetos e checkpoints históricos e impede consumo pelo engine
estático. O guard permanece até a integração W4-04a2b/c. Testes focados 56/56 e
mutantes 16/16 em Node 22/24; cobertura crítica acima de 90/80. Gate integral
Node 22 passou sem falhas nem avisos. Gate Node 24, hook e integração à feature
seguem pendentes neste registro. Sem chamada paga, ativação ou merge na foundation.

Validação governada Node 24 passou com zero falhas e um aviso preexistente de
placeholders em template. Hook e integração continuam pendentes neste registro.

### W4-04a2a integrada; W4-04a2b em validação

W4-04a2a: commit `1f09c3e8`, integração `6bba910d`; segunda tentativa do hook
Node 24 passou com zero falhas/avisos. A primeira falha intermitente de conformidade
de provider está preservada no recibo, junto dos ensaios dirigidos aprovados.

W4-04a2b consome a cadeia persistida em fronteiras de fase, preserva digest de
checkpoint anterior e só libera sucesso após todas as fases correntes. Revisão
e cancelamento concorrentes com checkpoint/release usam CAS e reread do mesmo
stream. Testes focados 31/31 em Node 22/24; 18 mutantes rejeitados em ambos;
workflow-engine.js 93,2% linhas/81,99% branches nas duas versões. Revisão cética
isolada confirmou a correção da corrida de cancelamento no release. Gate integral
Node 22 oficial e validação Node 24 passaram; Node 24 registrou apenas o aviso
preexistente de placeholders. Uma corrida de cancelamento no despacho de workflow
foi reproduzida e corrigida: filho não iniciado termina `not_executed`, e a
reserva observa o cancelamento durável. O cenário passou em 20 repetições
isoladas; a cobertura final crítica segue acima de 90%/80% em Node 22/24.
Hook Node 24 passou; commit `15719b4b`, integração `1e90d2b0`. A drenagem antes de `cancelled` é
escopo W4-04b. Sem merge na foundation, gasto novo ou ativação operacional.

### W4-04a2c em implementação

A expansão running acrescenta planos de filhos com IDs estáveis e prazo limitado
pelo deadline original do pai. Duas revisões sucessivas sobreviveram à
reabertura; falha injetada no append do job reverteu a revisão da sessão e os
registros dos filhos. Cancelamento que vence a admissão não publica revisão nem
despacha filho novo. Cobertura integral passou em Node 22 oficial e Node 24,
sem falhas nem skips. Após revisão cética, a comparação da definição revisada
normaliza apenas o JSON das mensagens novas; a serialização histórica das
definições iniciais foi preservada. Cobertura dos três arquivos críticos ficou
acima de 98,7% das linhas e 85% dos branches. Gates integrais finais passaram:
Node 22 com zero avisos e Node 24 com um aviso preexistente de placeholders.
Pacote permanece com 1.457 entradas. O encerramento `uncertain` de trabalho
antigo em uma corrida e a drenagem transitiva continuam pendentes para W4-04b.
Hook de commit e integração à feature seguem pendentes neste registro.

### W4-04a2c integrada; W4-04b1 em implementação

W4-04a2c: commit `4af7c4c0`, integração `3cb3c2ec`; hook Node 24 passou com
zero falhas e zero avisos. A W4-04b foi dividida em duas unidades isoladas.
W4-04b1 drena filhos anexados sem recibo de spawn, bloqueia checkpoints após
cancelamento e fecha tools, extensões e conexão de modelo antes do join/release.
Três testes negativos novos passaram; suíte dirigida de 72 testes em Node 24
delegado passou antes do último teste negativo. Cobertura, revisão cética,
gates e hook desta unidade ainda pendentes. Drift de baseline e tentativa nova
vinculada à árvore terminal continuam para W4-04b2.

### W4-04b1 — drenagem transitiva em validação

O cancelamento percorre descendentes do mais profundo ao ancestral e interrompe
a sessão raiz enquanto drena as reservas. O reducer impede evento terminal da
sessão com reserva ativa; após o release, o supervisor confirma o terminal no
prazo original. O engine inclui filhos anexados sem recibo de spawn e mantém a
reserva ativa se o drain falhar. Tools, extensões e conexão de modelo fecham
antes do resultado do filho. Testes dirigidos cobrem perda do recibo, falha de
drenagem, corrida com conclusão do modelo e retomada explícita após release.
A revisão cética isolada não encontrou bloqueio após as correções. Gates
integrais Node 22/24, hook e integração à feature ainda pendentes; W4-04b2
continua responsável por drift e nova tentativa vinculada.

Node 22 e Node 24: cobertura integral e gates governados passaram com zero
falhas/skips; 18/18 mutantes rejeitados em cada versão. Os seis arquivos
críticos alterados excedem 90% de linhas e 80% de branches nas duas versões.
O pacote continua em 1.457 entradas, dentro do limite autorizado. O recibo
detalhado está em `evidence/workflow-drain/verification-receipt.json`.
A validação governada da worktree passou. Commit, hook e integração à feature
ainda pendentes neste registro.

### W4-04b1 integrada; W4-04b2a em implementação

W4-04b1: commit `71285eec`, integração `0b420bff`; hook Node 24 passou e a
worktree foi removida. W4-04b2 foi dividida em invalidação por drift (04b2a)
e tentativa explícita vinculada (04b2b). A primeira unidade marca o filho
com baseline alterado antes do efeito como `not_executed`, conserva o aceite
anterior, drena a árvore e confirma o terminal da raiz antes do job
`invalidated`. Um teste dirigido de DAG e um teste de evento forjado passaram
em Node 24; cobertura, mutantes, gates, hook e integração desta unidade ainda
pendentes. Nenhuma tentativa nova ou saldo renovado foi admitido.

A corrida após `dispatch.intent`, antes da primeira montagem, também foi
reproduzida e corrigida: o engine alcança o guard de cada filho sem iniciar
efeitos, registra ambos como `not_executed` e só declara `invalidated` após
terminal e drain. O teste negativo de falso drift por evento forjado passou.
Uma revisão de recuperação acrescentou a prova do terminal da raiz à
projeção: um recibo de `invalidated` sem esse evento é rejeitado, e o
settlement permanece incerto se o processo cair entre release e terminal.
Falha comprovada em outro filho tem precedência sobre drift de um dependente.
Cobertura integral e gates governados Node 22/24 passaram com zero falhas e
skips; 18/18 mutantes rejeitados em ambas as versões. Quatro arquivos
críticos acima de 95% de linhas e 84% de branches. Pacote permanece em
1.457 entradas. Recibo em `evidence/workflow-drift/verification-receipt.json`.
Validação formal da worktree passou; registrou um aviso preexistente de dois
placeholders em template. Hook e integração ainda pendentes.

### W4-04b2a integrada; W4-04b2b em validação

W4-04b2a: commit `f8a4ed54`, integração `ed050544`; hook Node 24 passou e a
worktree foi removida. W4-04b2b acrescenta `retry` explícito, com vínculo
atômico no stream do antecessor e um único sucessor por tentativa. O novo
job herda o menor deadline da cadeia, desconta uso durável de recursos e
filhos iniciados do orçamento da raiz, aceita apenas IDs ainda não aprovados
da árvore anterior e mantém o mesmo escopo de workspace. Não usa novo tipo
de evento: o vínculo é uma ação interna validada de `JobCommandRecorded`,
compatível com o catálogo SQLite e o limite de pacote vigente. A suíte
focada passou 34/34 em Node 24. Cobertura, mutantes, gates, hook e integração
da unidade continuam pendentes; campanha/provider serão integrados na W4-05.
Uma execução dirigida completou a nova árvore com apenas o nó pendente após
atualizar explicitamente seu baseline e verificador; o primeiro nó permaneceu
aceito no job anterior e não foi despachado outra vez. Um sucessor concorrente
foi recusado e um segundo retry de uma tentativa cancelada manteve a raiz e
o deadline originais.

Matriz final W4-04b2b: cobertura e gate integral passaram em Node 22/24,
sem falhas ou skips; 18/18 mutantes foram rejeitados em cada versão. Os
arquivos críticos ficaram acima de 95% de linhas e 84% de branches; o pacote
fixado permanece em 1.457 entradas. A revisão cética isolada não encontrou
bloqueio confirmado. Recibo e logs em `evidence/workflow-linked-retry/`.
Validação formal passou, com um aviso preexistente de placeholder de template.
Hook e integração seguem pendentes neste registro.

### W4-04b2b integrada; W4-05 em validação

W4-04b2b: commit `e61c5f55`, integração `b6282f2e`; hook Node 24 passou e a
worktree foi removida. W4-05 reutiliza `ProviderCampaignControl` como única
autoridade monetária. A projeção agora exige uma reclamação recíproca de
autorização para a campanha antes de qualquer claim ou reserva. O job guarda o
pin da campanha; o stream financeiro vincula autorização, request e reserva
antes do adapter, e o evento de despacho do job precede o request. Os testes
dirigidos passaram 49/49 em Node 24, incluindo recibo perdido e saldo
comprometido após reconciliação. A revisão cética encontrou um teste de
contrato ausente; ele foi criado, incluído no kernel e a revisão confirmou a
correção. Cobertura crítica passou em Node 22/24 (campanha 98,83% linhas,
94,11% branches), 18/18 mutantes foram rejeitados em cada versão e os gates
integrais passaram com zero falhas ou skips. Pacote permanece em 1.457
entradas. Recibo em `evidence/job-campaign/verification-receipt.json`;
validação formal passou com um aviso preexistente de placeholder de template;
hook e integração da unidade seguem pendentes neste registro. Nenhum efeito
externo pago foi executado.

### W4-05 integrada; W4-06a verificada antes do commit

W4-05: commit `6ee33054`, integração `4b11599a`; hook Node 24 passou e a
worktree foi removida. W4-06a expõe comandos e consultas de jobs em CLI,
HTTP e SDKs JS/TS/Python. `reconcile` público escolhe worker ou dispatcher
conforme o agregado e reproduz o comando interno original quando recebe o
mesmo ID; expansão dinâmica permanece interna. O teste
dirigido passou 15/15 em Node 22/24, com autenticação, cursor, replay e drain
de owner morto. Um ensaio inicial detectou o manifesto CLI desatualizado;
ele foi recompilado. A revisão cética confirmou o bloqueio de upload de código
antes da persistência e a recusa de expansão pela porta pública. Cobertura,
18/18 mutantes e gates integrais passaram em Node 22/24; pacote permanece em
1.457 entradas. `resume` público e a corrida de materialização da expansão
interna seguem como lacunas W4 a resolver antes de W4-08. Hook e integração
desta unidade seguem pendentes. Sem ativação operacional.

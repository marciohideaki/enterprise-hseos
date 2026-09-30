# HSEOS v4 — candidata verificada deterministicamente

**Ampliação verificada por testes direcionados e pacote externo:** ciclo de correção após reprovação e recuperação
orientada por reconciliação, solicitados depois do fechamento anterior.
A validação integral anterior não certifica estas alterações novas. Consulte
`RECOVERY-CORRECTION.md` e `evidence/2026-09-25-correction-reconciliation/receipt.json`.
Revalidação integral posterior solicitada pelo usuário: suíte raiz e gates
passaram, com um teste PostgreSQL ignorado por falta de configuração e um aviso
histórico de documentação. Consulte `evidence/2026-09-25-platform-revalidation/receipt.json`.
Formatação completa e pacote externo foram revalidados. Sem commit ou publicação.

**Complemento PostgreSQL e Node 20/22:** matriz local completa aprovada,
799 testes Node por versão, zero falhas e zero skips, além dos checks auxiliares.
PostgreSQL compartilhado 16.14; GitHub Actions/PostgreSQL 18 não executados.
Consulte `POSTGRES-NODE-MATRIX.md`.

Atualização: 2026-09-25. Base `a842308`; feature
`feature/hseos-v4-w1-foundation`; worktree/branch `hseos-v4-consolidation` /
`task/hseos-v4-consolidation`. Sem commit ou merge.

**Fechamento anterior à ampliação: gates completos aprovados, zero falhas e um aviso histórico.**
A quinta rodada passou após corrigir as falhas reproduzidas. O pacote instalado
fora do checkout correspondia byte a byte aos arquivos daquela revisão.
Recibo final: `evidence/2026-09-25-final/receipt.json`. As seções de continuação
abaixo preservam a cronologia; suas pendências de gates foram superadas por esta
rodada. Campanha com providers reais e ativação operacional não foram realizadas.

O plano autoriza implementação e testes locais. Não autoriza publicação,
instalação global, providers pagos ou ativação produtiva. O perfil ativo ai-jail,
a worktree privada suja e as demais worktrees foram preservados.

## Integração e descoberta

Integrados `92dd027` (resultado CLI), `deecfcf` (efeito confirmado), `96548e3`
(diagnóstico) e `868dd79` (contrato). ADR-0040/revisão ADR-0041 e evidências vieram
da worktree privada preservada; `96b7a39` é predecessor documental, não reaplicado.
ADR-0042 registra fronteiras da v4. Indicadores históricos de conclusão não foram
copiados para o estado atual.

Consultados os catálogos/fragmentos em `.enterprise/governance/capabilities`,
packages do kernel, runtime, sessões, ferramentas, política, isolamento e
orquestração, além dos assemblies e broker existentes. Baseline global `e709368`:
governance-discovery, Constituição 2.2, índice core, regras de agentes/engenharia e
arquitetura. Regras locais: AGENTS.md, ADR policy, Deprecation & Sunset. A busca em
`.hseos`, `.codex`, `.agents/instructions` e políticas não encontrou registro de
ativação AEW; aplicação/enforcement não verificados. Axon sem índice; vault não
alterado. Skills aplicadas: simplicity-first, capability-check e
verification-before-completion.

## Implementação disponível

- Tarefa pública com contrato, leitura/escrita por escopo e digest, comandos exatos,
  orçamento finito, gateway local e negação de ferramentas desconhecidas.
- Executor bwrap/cgroup v2 com mounts restritos, ambiente limpo, rede negada,
  limites de memória/processos/tempo/saída e confirmação de término de descendentes.
  Ambiente incompatível bloqueia antes da execução; sem fallback no host.
- Verificadores protegidos para soma Node, clamp Python e regressão Node. Provas v1
  ligadas ao contrato/sessão/snapshot/isolamento; `agent evidence` consulta os dados.
  Aprovação de tarefa é independente de `session.completed`.
- Worker confiável integrado ao binding/provider/broker existentes. Só seleção
  explícita habilita egress. Create-only, status, evidência e cancelamento não
  iniciam chamadas ao provider. Retries de transporte acima de um são recusados.
- WorkflowEngine, LocalSubagentProvider e supervisor compõem as tarefas com os
  mesmos serviços. Tetos agregados são validados/reservados; consumo vem das sessões;
  status expõe gasto/reserva/liberação. Cancelamento ativo aguarda quiescência.
- Ações mutáveis YAML retiradas da v4; inspeção preserva históricos. Migração
  explícita só aceita definições completas, cria JSON novo e não executa efeitos.
- CLI e providers opcionais lazy; consulta automática de atualização retirada.
  Perfis mínimo/engenharia materializam somente componentes selecionados em
  consumidor novo. Dependências desconhecidas e ciclos são rejeitados pelo catálogo.
  Catálogo compilado atualizado pelo compilador, sem edição manual do espelho.
- Critérios obrigatórios fora do histórico compactável; contagem de tokens comum,
  com estimativa separada do uso informado. Replay incremental nominal, replay
  integral de recuperação e proteção contra cache de transações desfeitas.
- Pacote raiz `4.0.0-rc.0`, guia público de migração/rollback e disposição dos
  componentes; módulos internos seguem na distribuição coordenada.

## Recuperação verificada nesta continuação

`engineering-recovery-integrated.log`: 43 testes integrados passaram.
`npx-wrapper.log`: 3 testes passaram, incluindo argumentos literais no cache do
npx; o wrapper usa execFileSync sem shell. Lint de recuperação e wrapper passou.
O pacote desta revisão está em `.logs/validation/v4/recovery/`. Instalado em
`/tmp/hseos-v4-recovery-clean-16t_1hdn`, com HOME vazio, passou nas três tarefas
pelo bin público, 11 testes de workflow/recuperação, 2 de binding simulado e nos
dois perfis. Evidência versionada: `evidence/2026-09-25-recovery/receipt.json`.
Gates de fase CI repetidos: zero falhas e um aviso histórico. Gates completos
continuam pendentes da janela de recursos; isso não é aprovação de produção.


`workflow-recovery-final.log`: 24 testes passaram (workflow e orquestração),
incluindo cancelamento vivo/morto e retomada sem repetir eventos de sessão.
`workflow-reclaim-race.log`: duas retomadas concorrentes, exatamente uma conclusão.
`compatibility-v4.log`: 10 testes passaram; `activation-rehearsal-v4.log`: 4 passaram.
Os antigos schemas operacionais continuam intactos; somente cópias temporárias
recebem a migração pendente 010. Os resultados abaixo preservam a rodada anterior.

## Evidência determinística

Logs temporários em `.logs/validation/v4/`; recibo versionado em `evidence/`.
Node 24.15.0 corresponde ao ABI SQLite instalado; testes usam TMPDIR=/tmp.

| Verificação | Resultado |
|---|---|
| `engineering-final-integrated.log` | 41 testes passaram: executor, tarefas, binding simulado, workflow, cancelamento, migração e lazy/materialização |
| `kernel-final-regression.log` | 83 testes passaram: sessões, contexto, compactação, runtime, orquestração, models e broker |
| `contract-coverage.log` | gate passou; 161 verificações do catálogo; cobertura agregada 80,09% linhas / 75,98% branches |
| `replay-rollback.log` | replay incremental e rollback passaram |
| `replay-benchmark.json` | estados equivalentes com 100, 1.000 e 10.000 eventos de controle; não mede grandes payloads de modelo |
| `lint-integrated.log` | lint das superfícies tools/test e isolamento passou; demais packages mantêm exclusões preexistentes do lint raiz |
| `rc-clean-smoke.json` | instalação externa do RC: três tarefas, workflow, evidências e dois perfis passaram; revisão anterior ao binding |

A instalação final após bindings passou em `/tmp/hseos-v4-final-clean-dmspdpm7`,
com HOME vazio: três tarefas, workflow, consultas, dois perfis e binding/broker
simulado. Recibo preservado em `evidence/2026-09-25/receipt.json`. Gates de fase
CI: zero falhas, um aviso histórico de placeholders; não equivalem aos gates completos. Resultados de rodadas antigas
permanecem históricos, não substituem a verificação da revisão mais recente.

## Histórico de limites antes das revalidações

Esta seção registra rodadas anteriores; o status mais recente da candidata está
no início deste documento. A evolução posterior tem status próprio em
[`../evolution/STATUS.md`](../evolution/STATUS.md).

- Efeito interrompido e incerto permanece bloqueado para reconciliação; não é
  repetido. A retomada coberta executa tarefa ainda não iniciada ou somente a
  verificação de uma sessão já completada, após reaper do executor antigo.
- Recuperação de workflow interrompido agora exige owner morto, claim expirado e
  referência exata. Tarefas aprovadas não repetem efeitos; sessões concluídas
  retomam só a verificação. Duas retomadas concorrentes produzem um vencedor.
  Cancelamento após morte durante comando elimina o executor e termina o grafo.
  Owners antigos não comprovados e efeitos incertos continuam bloqueados.
- Na revisão anterior à ampliação não havia loop automático de correção.
  `RECOVERY-CORRECTION.md` e seus recibos registram a implementação posterior.
  Descendentes dinâmicos seguem indisponíveis; nenhuma tentativa reinicia deadline.
- Materialização seletiva nova cobre somente `minimal` e engenharia em consumidor
  novo; outros perfis preservam o instalador existente.
- Naquele ponto, os gates completos não estavam verdes. A primeira rodada falhou porque stdout `.txt`
  foi lido pela neutralidade documental; renomear para `.log` e passar a suíte
  isolada não torna a rodada verde. Segunda rodada foi interrompida pela carga.
  Uma janela abaixo do limite permitiu a terceira rodada completa. Ela detectou
  expectativas antigas da versão 9 na auditoria de migração. Auditoria e ensaio
  de ativação foram atualizados para a migração 010 e passaram nas regressões
  focadas, preservando o banco operacional. Nova rodada completa ainda pendente;
  não iniciar acima dos seis núcleos físicos.
- Campanha real de 18 execuções permanece não realizada, exigindo bindings e
  orçamento autorizados. Teste de upstream simulado não equivale a inferência real.
- Publicação, depreciação v3 e ativação operacional são decisões separadas.

A sequência histórica de revalidação foi concluída conforme os recibos no início
deste documento. Gates da evolução não são cobertos por esses recibos. Não fazer
commit com gates incompletos, nem merge/publicação/ativação sem autorização.

## Verificação final do índice preparado

O gate de fase CI também foi executado após preparar todos os arquivos no índice.
Ele encontrou uma credencial fictícia constante no teste de binding. O teste agora
gera o valor temporário em execução; a regra de segurança permanece intacta.
A repetição passou com zero falhas e um aviso histórico; os dois testes do binding
e a neutralidade documental passaram. O recibo de recuperação preserva tanto a
rodada que encontrou o fixture quanto a repetição aprovada.

A última leitura de carga foi 11,25 para seis núcleos físicos. A regra global
`/home/annonymous/.claude/AGENTS.md`, §3f, impede iniciar a suíte completa nessa
condição. O fechamento permanece bloqueado na validação completa, sem commit.
Retomar com leitura de carga; abaixo do limite, executar os gates completos
sequencialmente e investigar qualquer falha antes de declarar conclusão.

## Continuação — inventário de providers

As regressões posteriores à auditoria de migração encontraram o inventário de
conformidade desatualizado: ele rejeitava o novo perfil de engenharia. A correção
registra seu provider e reutiliza o manifesto efetivo do runtime. Perfis extras
e trocas de provider continuam rejeitados; nenhuma validação foi relaxada.

Passaram 18 testes de fundação, 36 de política/ferramentas, oito de conformidade
(incluindo o runner local com suítes aninhadas) e um teste adicional de adulteração
do perfil. Esses números não devem ser somados aos resultados anteriores como
cobertura exclusiva. Lint e manifesto do CLI passaram. O pacote corrigido foi
instalado offline em consumidor novo, com HOME vazio: três tarefas aprovadas pelo
executável público. Gate de fase CI da revisão preparada: zero falhas, um aviso.
Recibo: `evidence/2026-09-25-conformance/receipt.json`. O pacote anterior permanece
evidência histórica; o recibo novo identifica o pacote com o inventário corrigido.

Revisão adversarial desta correção: profile/model divergentes e perfil desconhecido
são recusados; o manifesto não é duplicado; os testes do runtime são executados
pelo runner de conformidade. Isso verifica contratos locais, não inferência real.
A última leitura foi carga 9,45/6 núcleos. Gates completos continuam pendentes.

## Revalidação solicitada — falhas reproduzidas e corrigidas

A carga de 3,45 permitiu iniciar a quarta rodada completa. Lint passou, mas o
teste de hook fora do projeto falhou: o processo terminou com código zero antes
de o pai concluir stdin, produzindo EPIPE no Node. Reprodução isolada: seis casos
em 200 execuções. O helper aceita somente EPIPE com status zero e sem sinal;
erros reais continuam falhando. Passaram 83 checks dos handlers e 11 de bloqueio.

A suíte de engenharia encontrou EBUSY ao remover o cgroup vazio após morte do
worker. A limpeza compartilhada agora revalida o término e aguarda a remoção
dentro de cinco segundos; EBUSY persistente termina como teardown incerto.
Dois testes adicionais exercitam recuperação transitória e falha persistente.
O grupo vazio deixado pelo teste que falhou foi removido pelo reaper do executor.

Resultado da revisão corrigida: 46 testes de engenharia, nove de conformidade
(com suítes aninhadas), lint completo e formatação dos arquivos tocados passaram.
Novo pacote instalado offline fora do checkout, com HOME vazio: três tarefas e
um workflow completaram pelo executável público. Gate de fase CI sobre o índice
preparado: zero falhas e um aviso histórico. Recibo e logs, incluindo falhas:
`evidence/2026-09-25-revalidation/receipt.json`.

A quarta rodada completa não é verde; retestes focados não a substituem. A carga
voltou a 11,19 para seis núcleos físicos, bloqueando nova rodada completa pela
regra global §3f. Campanha real e ativação seguem separadas. Sem commit ou merge.

## Fechamento determinístico — quinta rodada completa

A janela de carga 3,29/6 permitiu executar os gates completos sequencialmente.
Resultado: exit 0, zero falhas e um aviso histórico de placeholders. Passaram o
lint, toda a cadeia de `npm test`, schemas e os controles de segurança/governança
aplicáveis. A suíte inclui 46 testes de engenharia e nove de conformidade; não
somar esses números novamente ao total da cadeia. A formatação dos arquivos
modificados e o smoke externo de três tarefas mais workflow também passaram.

O arquivo do pacote do recibo de revalidação continua atual: todos os seus
arquivos regulares foram comparados byte a byte com a árvore verificada, sem
diferenças. Os relatórios finais não alteram o conteúdo distribuído. O recibo
final preserva o stdout e o log interno da rodada completa.

Estado 1: implementado e verificado deterministicamente no consumidor descartável.
Estado 2: providers reais não validados; a campanha de 18 execuções depende de
bindings e orçamento autorizados. Estado 3: não autorizado nem ativado
operacionalmente. Não houve commit, merge, publicação ou instalação global.

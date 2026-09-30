# Revisão W4-03c — em validação

Base feature f730ebf; execução isolada task/hseos-w4-job-materialization.
Contrato: .specs/features/harness-w4/job-materialization-implementation.md.
ADR-0045 Proposed. G: e709368ead6e53ee1fd8e4428bc8913a3a4e8292.
Revisão isolada read-only por /root/review_plugin_providers; executor corrige.
Não é certificação W4 nem autorização operacional.

## Achados e correções

| Achado | Correção | Evidência determinística |
|---|---|---|
| P1: entrada removida ou diretório substituído depois da primeira leitura podia escapar | Comparação do conjunto completo; releitura de arquivos; conferência de todos os inodes ancorados | testes workspace delete/replace-directory |
| P1: dados retomados e diretórios intermediários sem fsync | Sincronização também no caminho EEXIST e de toda árvore de diretórios | teste syncs existing files and every directory |
| P2: abertura repetida retinha descriptors quadraticamente | Um descriptor por diretório na preparação | teste bounded descriptor reuse |
| P1: manifesto alterado escondia vínculo job_prepared | Proteção por ID, diretório canônico e sessão durável; leitura paginada | teste replaced manifest, alias e foreign directory |
| P1: outra fixture podia fornecer ledger para workspace original | Validação view↔fixture e db.name antes da assembly | teste second ledger; mutante job_ledger |
| Ressalva: mesmo pathname não prova inode do banco aberto | Pin dev/ino no handle; revalidação da abertura e da view | teste replacing database path |

O revisor confirmou por leitura os fixes de filesystem e, depois, os três casos
no mesmo ledger. O confronto seguinte identificou troca do ledger; leitura focal
confirmou a rejeição da segunda fixture e explicitou a ressalva de pathname. O pin
de inode foi acrescentado em resposta. Revisão final dos recibos ainda pendente.

## Resultados intermediários preservados

- Workspace24/24 Node24 PASS.
- Materialização inicial3/4: fixture de workflow tinha duração insuficiente para
  duas fases. Corrigido o orçamento declarado da fixture, sem alterar runtime/limites.
- Jobs28/28 PASS; ampliação de cenários de recuperação em processos reais10/10 PASS.
- Conjunto70/70 PASS; cobertura inicial materializer99.06%linhas/83.67%branches.
- Engenharia184/184 PASS; gate de cobertura FAIL para runtime branches77.02% e
  terminal-control50%linhas/46.87%branches. Comando não incluía suíte de terminais.
  Esse run iniciou antes do último fix de associação; é diagnóstico, não recibo final.
- Delta de schema+runtime: 118/123;5FAIL por consumidores ainda fixados em versão13
  e contagem9 migrations. Após atualizar versão14, ficaram2FAIL pela contagem;
  atualização para10 migrations preservou validação exata, tabelas e rollback.
- Rehearsal/compatibilidade/mutantes19/19 PASS: cinco mutantes dirigidos rejeitados.
- Lint final do delta, incluindo fixture normalmente ignorada: PASS, zero warnings.

## Limites

Preparação não despacha, não certifica resultado e não reserva dinheiro. O cenário
de plugin de modelo comprova que a preparação conserva campanha e não lança plugin
nem produz evento financeiro. Isso é fixture determinística, não consumidor externo
real nem conta elegível. Serviço/dispatch/settlement/backup/restore permanecem03d.
O teto de pacote1452 pertence à autorização03b; inventário03c e eventual decisão
específica são separados. Mergefoundation/publicação/instalação/ativação não autorizados.

## Confronto final de código e Node24

Revisor confirmou769/769+complemento19/19, dez críticos90/80 e cinco mutantes
rejeitados. 28/29 hashes iguais ao inventário; única diferença foi o teste ledger
ampliado em sete casos. Fontes de produção permaneceram correspondentes. Confirmou
pin dev/ino na abertura/view e teste de substituição de banco. Nenhum bloqueio novo.
Node22 concluiu776/776, zero falhas/skips, mesmos dez críticos acima90/80.
Após esses runs, somente testes/config de cobertura são ampliados: duas fronteiras
antes de arquivos/eventcreated e inclusão permanente do schema no gate. Pós-checks
separados registram essas adições; não alteram código de produção já medido.

Pacote:1454 entradas,9.12MB; somente materializador e migration014 adicionais.
Limite vigente1452 preservado. Autorização solicitada, ainda pendente. Gate de
empacotamento permanece FAIL; gate integral e commit não podem ser certificados.

## Confronto final dos recibos nas duas versões

Revisor isolado confirmou13 hashes de produção,30 fontes e22 artefatos; todos
correspondem. Node22:776/776; pós-checks44/44 em cada versão, zero falhas/skips.
Dez críticos acima90/80 (mínimos96.24%linhas/83.14%branches). Falha inicial
Node24 e complemento estão explicitados. Nenhum bloqueio novo; permanecem
autorização1454, gate integral e commit pendentes. Revisão somente leitura.

## Decisão do responsável

Após solicitação explícita1452→1454, responsável respondeu “Prossiga até o fechamento da W4”.
Aplicado somente limite1454;22MB e exclusões preservados. Teste de pacote passou
em Node24 e22, sequencialmente. Falhas anteriores preservadas no recibo.

Gate integral Node24 concluído:exit0,zero falhas,um aviso preexistente de placeholders
no template epics. Log integral arquivado com hash no recibo. Commit ainda pendente.

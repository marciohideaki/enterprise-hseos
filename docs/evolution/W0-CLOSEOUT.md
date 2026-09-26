# Onda 0 — verificação de fechamento

**Estado: onda 0 implementada e verificada deterministicamente.**

Recibo: [evidence/w0-closeout/receipt.json](evidence/w0-closeout/receipt.json).

## Resultados da revisão

| Verificação | Resultado |
|---|---|
| Kernel Node 22.23.3, cobertura limpa | 374 testes, zero falhas/skips; 95,01% linhas / 87,44% branches |
| Persistência Node 22 após teste adicional | 20 testes passaram |
| Kernel Node 24.15.0, cobertura limpa | 375 testes, zero falhas/skips; 95,01% linhas / 87,44% branches |
| Mínimos por arquivo crítico | todos atendem 90% linhas / 80% branches, nas duas versões |
| Qualidade e mutações dirigidas | seis testes passaram; três mutantes detectados |
| Lint integral | passou, zero avisos |
| Gates fase CI | zero falhas; um aviso histórico de placeholders em template |
| Instalação externa Node 22 e Node 24 | quatro tarefas e workflow de três tarefas aprovados em cada versão |
| Rede na jornada instalada Node 24 | nenhuma conexão bem-sucedida; 35 sockets IP negados; trace inclui descendentes |
| Suíte integral Node 22.23.3 | 849 testes Node aprovados, zero falhas/skips; checks auxiliares aprovados |
| Suíte integral Node 24.15.0 | 849 testes Node aprovados, zero falhas/skips; checks auxiliares aprovados |
| Gates completos nas duas versões | zero falhas; um aviso histórico de placeholders em cada execução |
| PostgreSQL real de testes | 15 testes aprovados em cada versão, incluídos nos totais acima |

Não somar retestes como cenários únicos. A fase CI de quality-gates não executa
`npm test` e não substitui a fase completa. As instalações usaram `npm install
--offline`, com dependências previamente provisionadas no cache. Não houve
instalação global, publicação, merge ou ativação de provider real.

## Correção do gargalo

A medição separou replay, reconstrução e tempo de CPU. `reconstructRequest`
revalidava todo o histórico mesmo quando o reducer já possuía um checkpoint
válido. Agora reutiliza `replay(sessionId)` e o contrato existente de checkpoint
nominal; a reconstrução não aceita clones forjados nem um checkpoint fornecido
pelo chamador do store. Novos eventos na mesma conexão ou em outra conexão
invalidam a projeção anterior, conforme demonstrado pelos testes.

Para 519 eventos, o p95 observado de replay mais reconstrução caiu de 49,074 ms
para 3,596 ms no ensaio local sem cobertura. Com cobertura, passou em Node 22
(6,339 ms) e Node 24 (9,128 ms). Limites de latência, memória, volume e cobertura
permanecem inalterados. Estes resultados não constituem liderança comparativa
nem garantia de latência em todo ambiente.

O AGENTS.md agora declara Node >=22, coerente com package.json e a matriz 22/24.

## Instalação e observação de rede

O wrapper público carregou o CLI do pacote instalado fora do checkout. Cada
jornada executou addition, clamp, unique, correction e um workflow sequencial;
status foi consultado em novos processos. A tarefa correction exercitou rejeição,
diagnóstico e correção dentro da mesma sessão.

O pacote inicial testado em Node 22 difere do pacote final somente pelo perfil
Node do AGENTS.md; o conteúdo executável foi comparado byte a byte. O pacote final
foi instalado do zero e exercitado em Node 24. Ambos os recibos são preservados.

Um ensaio com namespace externo de rede por Bubblewrap foi recusado pelo sandbox
interno. A alternativa administrativa não estava disponível. Nenhuma proteção
foi relaxada: a jornada final foi observada com strace, incluindo descendentes.
Todos os connects falharam e todas as criações de sockets IP foram negadas. Isso
comprova a jornada observada sem comunicação externa bem-sucedida; não declara o
processo controlador permanentemente isolado da rede.

## Fechamento sequencial

O responsável autorizou explicitamente a execução pendente com “Execute
sequencialmente”. Os gates completos usaram `VALIDATION_ENFORCED=true`,
`nice -n 10` e testes com concorrência 1. Node 24 terminou antes de Node 22
começar. O port-forward temporário foi encerrado e o link temporário de
módulos Node 22 foi removido. A credencial PostgreSQL ficou somente no ambiente
dos processos; o scan dos logs não encontrou seu valor.

A primeira suíte integral Node 24 aprovou 847 testes e rejeitou um: a guarda
documental antiga não permitia os registros comparativos exigidos pelo plano.
A reprodução isolada confirmou a causa. ADR-0043 registra a autorização do
plano mais recente, limitada aos dois documentos; ADR-0025 permanece intacto.
Um teste adicional comprova que a exceção não se estende a outros documentos
nem permite alegações de derivação. As suítes completas foram repetidas em
Node 24 e executadas em Node 22: 849 aprovações em cada uma, sem skips.
Os logs de falha e sucesso permanecem no recibo, sem somar retestes ao total.

A fase completa inclui `npm test` e lint. O aviso de dois placeholders no
template de épicos é histórico; markdownlint não estava disponível, conforme
o log. Nenhum limite de teste ou cobertura foi reduzido. Esta é validação local
Linux com PostgreSQL 16.14; não declara execução do GitHub Actions, PostgreSQL
18, macOS ou Windows. As dependências de produção foram provisionadas fora
do checkout; ferramentas de desenvolvimento vieram do checkout pai.

## Critérios da onda 0

| Critério | Evidência |
|---|---|
| Candidata e recibos preservados | baseline com 1.956 hashes e árvore original do índice revalidados |
| Lint do kernel incluído | configuração raiz e guarda de inclusão por arquivo aprovadas |
| Cobertura medida e exigida | 95,01% linhas / 87,44% branches; mínimos 90/80 por arquivo |
| Inventário completo | 27 famílias com fonte, implementação, teste, dependência, requisito e lacuna; guarda executável aprovada |
| Documentação reconciliada | PLAN, STATUS, ADR-0043, matriz e recibos distinguem capacidade existente, lacuna e aceite futuro |
| Entrega revisável | patches separados da candidata e W0, com reconstrução exata da árvore e índice original preservado |

O fechamento é técnico e local. Commit, PR, merge, publicação e ativação não
foram realizados. A candidata importada e o delta W0 continuam separados para
revisão; o recibo identifica seus hashes. W1–W8 permanecem futuras. Nenhuma
capacidade dessas ondas foi encerrada apenas pela existência de documentação.

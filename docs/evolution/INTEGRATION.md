# Integração Git W1/W2 — 2026-09-26

O usuário autorizou nesta sessão a revisão/correção/validação de W2, integração
Git W1/W2 e definição/execução de W3. A autorização não ativa a candidata, não
migra estado operacional e não publica pacotes.

## Base preservada

A candidata anterior e a qualidade W0 ainda não tinham commits. A primeira task
de integração materializa exatamente a árvore W0 importada por W1,
`28f6ba59233e80bc35cdf51e12f433ec9efed9b8`, antes de qualquer delta W1.
As adições de integração são este documento e o ajuste de CI para PRs contra
`feature/**`, com testes em cgroup delegado e jobs sequenciais. O setup
`.github/scripts/enable-test-cgroup.mjs` habilita memory/pids somente dentro
de serviço systemd dedicado e pertencente ao usuário, antes dos testes. O conteúdo
funcional da base importada permanece intacto. A delegação foi exercitada em
serviço de usuário local; a variante sudo/runner requer evidência da CI hospedada.
Também antecipamos de W1 a correção de seleção dos gates sob pipefail e seu teste
(`quality-gates.sh`/`test-governance-scripts.js`): listas staged extensas não podem
omitir testes por SIGPIPE. Esses dois arquivos são byte a byte os já validados
na W1; deixam de aparecer como novidade no delta posterior dessa onda.
Base Git anterior: `a8423081934d64538d71ef8289f072d51566a870`.
Worktree: `task/hseos-integrate-foundation`; feature de consolidação:
`feature/hseos-evolution-foundation`. O recibo W0 e a candidata importada
continuam históricos e rastreáveis por seus manifestos e árvores originais.

## Sequência

1. Validar e consolidar a base importada na feature de fundação.
2. Integrar W1 por task e PR próprios, com base imediata na fundação.
3. Integrar W2 corrigida por task e PR próprios, sobre W1; após integração W1,
   atualizar a base da PR W2 para a fundação, preservando ordem base→topo.
4. Iniciar a execução W3 sobre o resultado integrado, em nova feature/task.

Integração ocorre na feature de fundação, sem incorporar PRs preexistentes em
`master`. A base `a842308` inclui trabalho anterior do checkout, preservado como
ancestral e não atribuído a W1/W2. Os worktrees originais são mantidos para auditoria.
Cada PR declara seu upstream e dependentes. Gates, hooks e revisão precedem
merge; não usar bypass ou reescrita de refs protegidas.

Referências: AGENTS.md §§4–9, ADR-0017, plano `docs/evolution/PLAN.md`, recibos
W0/W1/W2. W3 mantém aceite real separado da validação determinística e requer
bindings e orçamento finito para campanhas reais.

## W1 consolidada

Task `hseos-integrate-w1`: delta da árvore W1
`0a3dbeecc043127438a9aa16eeb689bf6bc57deb` sobre a base importada W0.
Os ajustes de CI e este registro da fundação são preservados.
Upstream imediato: `feature/hseos-evolution-foundation`; dependente: W2.
O recibo original W1 continua histórico; a validação de integração e os hooks
incidem no conteúdo commitado.

## Correção do ambiente de CI W1

A execução hospedada `36226243009`, PR #178, comprovou o setup de cgroup mas
falhou nos testes v1 que chamam `/usr/bin/node`: o binário do setup-node fica
fora desse caminho no runner. O erro direto foi `bwrap: execvp /usr/bin/node:
No such file or directory`; verificação v2 com runtime explicitamente fixado
passou na mesma execução.

Task `hseos-ci-node-runtime` disponibiliza uma cópia do binário selecionado pela
matriz em `/usr/bin/node` no runner descartável e exige igualdade SHA-256.
Assim, as fixtures legadas também executam exatamente Node 22/24, mantendo os
comandos contratados e a fronteira de isolamento. Não há alteração de runtime,
verificadores ou dependências do host local. A execução com ambiente incompleto
foi cancelada antes de repetir o mesmo defeito no outro runtime; a nova CI deve
validar ambos os jobs completos.

## W2 revisada

Task `hseos-integrate-w2`: árvore revisada
`c0fb0a8b4945485c08d02241b82e1a507b159670`, preservando os ajustes de integração
da fundação e o registro W1. Upstream original: `feature/hseos-evolution-w1-engineering`;
após o closeout W1, a PR W2 passa a apontar para `feature/hseos-evolution-foundation`.
Dependente: W3, ainda sem campanha real certificada.

A revisão funcional encontrou e corrigiu três falhas no attach de terminal:
limpeza incompleta quando raw mode falhava, dispatch de input enfileirado após
falha anterior e descarte silencioso de ACK parcial. As regressões falharam
antes das correções e passaram depois. A matriz revisada executou 917 testes
integralmente e 443 testes críticos em cada Node 22/24, além de instalação
externa CLI/HTTP/SDKs e PTY/job. Recibo próprio em
`docs/evolution/w2/evidence/review/receipt.json`; recibos anteriores preservados.

A conferência W1 detectou ausência dos wrappers Husky no worktree novo, apesar
do gate explícito completo já ter passado. Os wrappers foram inicializados e
o pre-commit executado sobre o commit exato antes da PR. W2 inicializa e verifica
os wrappers antes dos gates/commit. Não houve uso de bypass.

W1 integrada por PR #178 com checks verdes em Node 22/24, governança e composição.
Commit de integração na fundação: `954943456bc7f2ed27657501c9910b2e07ef1516`. A task W2 avançou por
fast-forward até essa base; sua PR aponta diretamente à fundação.

## Fechamento adicional de detach W2

Após consolidar W2, a revisão final reproduziu input, EOF e resize admitidos
depois de Ctrl-]. A task `hseos-w2-detach-fence` bloqueia novas mutações após
detach e mantém o drain de input já aceito. Revisão e recibo específicos em
`docs/evolution/w2/DETACH-REVIEW.md` e
`docs/evolution/w2/evidence/detach/receipt.json`.
Os 917 testes da consolidação são evidência anterior a esse ajuste; a revisão
final acrescenta duas regressões e exige nova validação antes da PR W2.

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

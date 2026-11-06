# T1d - triagem da skill legacy-code-review

Data: 2026-11-06. Base do resíduo: `54ecb767`. HEAD do worktree: master atual (713 commits à frente da base). Documento de proposta; a decisão final é do owner.

## Veredito proposto

**Integrar, em PR próprio, com ressalvas.** A skill é coesa e não duplica nenhuma skill da master. O custo é moderado, mas o patch não aplica limpo e há uma mudança de compilador e de validador com risco transversal. Alternativa aceitável: descartar, se o owner não tiver uso para revisão automatizada de legado. O resíduo continua em `/build/artifacts`.

## Histórico

- `git log --all --oneline -- '*legacy-code-review*'` não retorna nenhum commit: nenhum arquivo com esse nome existiu em qualquer ref. `git log -S'legacy-code-review'` só acha o registro de higiene (`88db0f11`, `1d061a05`).
- Não encontrei o merge `feature/legacy-code-review-skill` descrito no pedido. Não há branch com esse nome e nenhum merge com "legacy-code-review" no título (os merges com "legacy" são `w0-5-legacy-mcp-clock` e `g9-last-legacy-use-evidence`, sem relação). Conclusão: a skill nunca entrou na master; "entrou e saiu" não se confirma.
- Citações na master: `STATUS.md` do run `20261030-1810-owner-decisions` (linha 102) e `docs/evolution/pendencias-w0-w5/MAPA.md` (A15 e higiene), ambas só listando o worktree como "com mudanças não commitadas".
- O motivo de a skill não ter sido commitada não está registrado. Não verifiquei.

## Inventário

Novos (16 arquivos no tgz; 14 são conteúdo e 2 nomes derivam da compilação):

| Local                                                                    | Arquivos                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fonte canônica `.enterprise/governance/agent-skills/legacy-code-review/` | `SKILL.md` (99 linhas), `SKILL-QUICK.md` (46), `policy.yaml`, `schemas/input.schema.json` (35), `schemas/output.schema.json` (65), `prompts/review.pt-BR.md` (25), `prompts/summarize.pt-BR.md` (4), `prompts/cross-pr.pt-BR.md` (9) |
| Espelho compilado `.agents/skills/legacy-code-review/`                   | `SKILL.md` (com frontmatter normalizado), `QUICK.md`, `policy.yaml`, `schemas/` (2), `prompts/` (3)                                                                                                                                  |

Observação: o tgz traz 16 caminhos de arquivo; o inventário acima soma 8 de fonte e 8 de espelho. O espelho é saída de compilação e seria regenerado, não copiado.

Alterados e não integrados (o patch tem 8 arquivos tracked, 3 além do pedido; os 3 centrais são os do compilador, do validador e do registry):

1. `tools/cli/installers/lib/core/agent-core-compiler/sources/skills-source.js` (+14)
2. `scripts/governance/validate-skills.sh` (+4/-8)
3. `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md` (versão 1.4 para 1.5, nova entrada)

Demais do patch: `.agents/manifest.yaml`, `.agents/capabilities/components.yaml`, `.enterprise/governance/capabilities/components.yaml`, `test/test-agent-core-compiler-hooks.js` (+37, novo teste), `test/test-capability-catalog.js`.

## O que a skill faz

Revisão automatizada de PR/MR, branch, intervalo de commits ou conjunto de PRs em sistema legado. Gera um bundle com findings estruturados (schema de saída), prioriza compatibilidade retroativa e segurança operacional, trata débito pré-existente como não bloqueante e limita comentários inline (12). Decisões: `BLOCK` só com critical/high, confiança alta e evidência concreta; `HUMAN_REVIEW_REQUIRED`; `PASS_WITH_COMMENTS`; `PASS`. Exige registrar o SHA de head revisado. Não substitui aprovação humana.

## Sobreposição com a master

A mais próxima é `pr-review` (revisão de governança conduzida por humano). A própria skill declara `skip: use pr-review para revisão humana`, ou seja, a fronteira é explícita. Não encontrei `legacy`, `code-review` automatizado nem schema de findings em outra skill do catálogo; não li o conteúdo de `pr-review` linha a linha, então a ausência de sobreposição parcial de critérios não está provada. Fora do repositório, as skills `/code-review` e `simplify` do Claude Code cobrem revisão genérica, mas não o contrato de findings e gate.

## O patch aplica?

`git apply --check` no worktree: **falha**, em dois arquivos.

- `.agents/manifest.yaml`: a base tinha `hooks: 39`; a master tem `hooks: 47`, `handlers: 30`. O hunk de contagem não ancora. Além disso, o hash do manifesto (`35e73464...`) está desatualizado; deve ser regenerado pelo compilador, não aplicado à mão. A contagem de skills na master é 53, igual à base do patch, então a entrada nova levaria a 54.
- `test/test-agent-core-compiler-hooks.js`: os imports mudaram (a master importa `writeClaudeAgents`), então o hunk de imports não ancora.

Os outros 6 arquivos aplicam limpos (via `--3way` check; não apliquei de fato).

## Mudanças no validador e no compilador

- **Compilador (`writeSkills`)**: passa a copiar `policy.yaml`, `prompts/` e `schemas/` da fonte para o espelho portável, excluindo os `SKILL*.md` fontes. Hoje só `SKILL.md` e `QUICK.md` são emitidos. É mudança de contrato do instalador: todas as skills futuras com esses nomes passam a levar recursos. Skills atuais não têm essas pastas (não verifiquei uma a uma), então o efeito esperado é nulo hoje.
- **Validador (`validate-skills.sh`)**: um diretório só é tratado como skill se tiver `SKILL.md` ou `SKILL-QUICK.md` (antes bastava qualquer `.md`), e a falha `SKILL-01` (arquivo ausente) deixa de existir. Isso **enfraquece a verificação**: um diretório de skill com apenas outros `.md` deixa de falhar e passa a ser ignorado em silêncio. Pelo §3h (nunca afrouxar gate), esta mudança precisa de decisão explícita do owner; alternativa: manter o `SKILL-01` e filtrar só `.md` aninhados.
- **Teste de catálogo**: o teste de perfis passa a contar só `SKILL.md`/`QUICK.md` nos arquivos emitidos, o que também relaxa a comparação "arquivos emitidos = instalados".

## O que a integração exigiria

1. Fonte canônica: copiar o diretório da skill para `.enterprise/governance/agent-skills/legacy-code-review/` (ADR-0015: a fonte canônica fica em `.enterprise/governance/agent-skills`, o espelho em `.agents/skills`).
2. Recompilar o espelho e o manifesto com o compilador (não copiar `.agents/skills/...` nem o hash do patch).
3. Registrar em `SKILLS-REGISTRY.md` (versão 1.5) e nos dois `components.yaml` (capability `delivery`; os dois arquivos são idênticos hoje).
4. Reaplicar manualmente os hunks que falham (contagens do manifesto e imports do teste).
5. Decidir o ponto do validador acima; manter ou não o relaxamento do teste de catálogo.
6. Testes: o novo `testSkillResourcesArePortable`, `test-capability-catalog.js`, `test-agent-core-compiler-hooks.js`, `validate-skills.sh`. Rodar com `heavy-run`/uma suíte por vez.
7. Revisão cética isolada (§3h) e nota de CHANGELOG, se o repositório exigir. Verificar também perfis do catálogo que listem skills por perfil (não inspecionei se a skill precisa entrar em algum perfil).

## Não verificado

Não rodei `validate-skills.sh`, o compilador nem os testes (sem aplicar o patch). Não li os prompts e schemas em profundidade nem a `pr-review` por inteiro. Não confirmei o motivo da não integração original nem a existência do merge citado no pedido (nenhum rastro no git). Número exato de arquivos (16 vs 14 de conteúdo) conferido apenas por listagem do tgz.

# R-D7 — revisão cética do commit 2b413b3b (token do supervisor de órfãos)

Veredito: **PASS-WITH-NOTES**

## Achados
| # | Sev | Local | Achado |
|---|-----|-------|--------|
| N1 | baixa | test/test-ci-light-hook.js (leak.js do shard runner) | O diff altera uma linha existente (`'sleep'` -> `'/usr/bin/sleep'`), não só adiciona. Não enfraquece asserção, mas a justificativa não está no commit. |
| N2 | info (resíduo) | tools/cli/lib/bound-kernel-supervisor.js:133,188; packages/agent-environment/{lsp,browser}-host.js; tools/cli/lib/{engineering-workspace,engineering-sandbox-check}.js; tools/lib/environment-toolchain-pins.js | Outros pontos lançam filho com ambiente reduzido por allowlist (`{PATH,...}`), não `{}`. Continuam sem token. Fora do escopo da spec (só `env: {}`), mas o limite no comentário de suite-orphans.mjs:14 fica mais amplo que "env: {}". |
| N3 | info | index.js:345-364 | Ver item 5. |
| N4 | info | profiles.js | Branches de profiles.js 95 -> 93.7 (helper com ramos de guarda); ainda >=80. |

## Itens
1. **PASS.** `rg "env: \{\}|clearenv|env -i"` em tools/packages/src: nenhum `env: {}` restante; só `--clearenv` (index.js:364, bwrap). Os 5 pontos usam `orphanTokenEnv()` (executor.js:240, index.js:515, profiles.js:447, terminal-executor.js:88, provider-campaign-process.js:77). Nenhum extra com `{}`; extras com allowlist em N2.
2. **PASS.** Executado: `orphanTokenEnv()` e `orphanTokenEnv({})` -> `{}`; com PATH/OTHER no pai sem token -> `{}`.
3. **PASS.** Supervisor gera `crypto.randomBytes(12).toString('hex')` (suite-orphans.mjs:105) = 24 hex minúsculos; regex `^[0-9a-f]{24}$` sem flag m (em JS `$` não casa antes de `\n` final). Executado: maiúsculas, `\n` final, `a=b`, 5000 chars, espaço final, array, número, vazio -> `{}`.
4. **PASS.** Retorna só `{HSEOS_SUITE_ORPHAN_TOKEN}`; PATH/OTHER do pai não passam (executado).
5. **PASS (resíduo aceitável).** `--clearenv` limpa o ambiente do comando sandboxed; o token fica só no processo externo (bwrap/launcher), correto: não vaza ao código não confiável nem a `--setenv`. Cobertura A-16: o `bwrap` externo tagueado é detectado se sobrevive. Descendentes dentro do sandbox estão em `--unshare-all` (pid ns) + `--die-with-parent`: morrem com o init do namespace, então o escape não é plausível; se algum escapasse por outro caminho ficaria sem marca. Resíduo aceitável, deve constar no relatório do owner.
6. **PASS.** Mutação própria 1 (regex frouxo `^[0-9a-f]+`) e mutação própria 2 (devolver `{...parent}` inteiro) em cópia descartável: ambas derrubam o teste "orphanTokenEnv carries only a well-formed supervisor token" (2 falhas cada; a segunda falha em cada cópia, "the suite is scripts.test...", é pré-existente em cópia via git archive, também falha na base). O teste de integração (tagged detectado / `{}` não) cobre "sempre {}".
7. **PASS.** O diff de test/ só adiciona, exceto N1. Nenhuma asserção de ambiente mínimo alterada. Teste de igualdade da constante com `TOKEN_VAR` presente.
8. **PASS.** Via cg.sh, --test-concurrency=1: ci-light-hook+isolation-profiles+engineering-executor+terminal-executor = 83/83; bound-kernel-supervisor+provider-campaign-adapters = 24/24. Mais 93/93 na seleção do c8 (inclui transitive-isolation e witness-faults).
9. **PASS.** Mesma seleção (7 arquivos) base vs head: provider-campaign-process.js 93.79/74 -> 93.83/74 (inalterado em branches; os 74% são pré-existentes na seleção parcial); executor 96.57/90.9 igual; index 97.14/95.04 -> 97.15/95.04; profiles 98.12/95 -> 98.18/93.7; terminal 95.31/94.23 igual. A seleção parcial não é o gate completo (test:kernel), mas nenhum arquivo cai abaixo de 90/80 além do pré-existente, e o delta é desprezível; risco para o gate completo baixo.
10. **PASS.** eslint limpo, prettier limpo, test-package-surface 1/1, commit sem menção a IA/Co-Authored-By; worktree limpo.

## Alegação -> veredito
| Alegação | Veredito |
|---|---|
| 5 pontos, nenhum extra | Confirmada (para `env: {}`); N2 lista extras com allowlist |
| Helper em profiles.js | Confirmada |
| 26/26, 97/97, 18/18 | Não reproduzível por esse agrupamento; mínimo equivalente: 83/83 e 24/24 verdes, 0 falhas |
| Mutação "sempre {}" derruba 2 testes | Não reexecutada; 2 mutações próprias distintas foram pegas |
| c8 profiles 98/95, index 97/95, executor 96/91, terminal 95/94, campaign-process 93/74 | Confirmada para a base; no head profiles cai para 98.18/93.7, demais iguais |
| Desvio: conserto antes do teste | Não verificável pelo diff; sem impacto no resultado |

Cópias em /build/tmp/rev-d7 removidas ao fim.

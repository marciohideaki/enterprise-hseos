# REVIEW C3 (guard) - worktree crp-c3-guard-scope, base e079409c
Veredito: APROVAR COM RESSALVAS (2 MEDIOS recomendados antes de merge, sem bloqueio funcional). Testes 86/86 (rodado).

## Divergencia local=0 vs 124
Resolvida. Medido com evaluateGuard sobre o corpus real (580 arquivos JS/TS, 3 repos de modos de B1; script /tmp/hseos-crp/rev/c3corp.cjs):
- base e079409c: platform 124 deny, hybrid 0, local 0
- C3:           platform 319 deny, hybrid 0, local 0
O modo local nunca nega: `if (mode === 'local') return allowance('')` (capability-intake-guard.js, evaluateGuard) e a policy diz "Never blocks". O "local 124->319" do executor e a contagem de arquivos OBSERVADOS (qualifies), independente de modo - rotulo errado no relatorio, nao negacao. Efeito colateral: qualifies+workspaceRoots rodam antes do curto-circuito, entao local paga leitura/parse dos manifestos sem necessidade.

## Achados
| ID | Sev | Achado | Repro |
|---|---|---|---|
| C3-1 | MEDIA | Declaracao existente mas sem raiz literal (`packages: ['*']`, `['**']`, so negacoes, `[]`, `workspaces: []`) => roots=[] e NAO cai no fallback `apps`; nada extra e vigiado. Contradiz o comentario ("never to watch nothing"). Under-watch silencioso. | pnpm-workspace.yaml `packages: ['**']` + apps/a/x.ts => allow |
| C3-2 | MEDIA | Validacao do registro JSON e minima: sem `approval`, ou com approval.status 'rejected'/'pending', ou decision 'exception' sem expires_at => aceito. So expires_at passado/invalido (null, texto, numero) e recusado. Schema real nao esta no repo; ao menos `exception` sem expiracao conflita com a policy. (Registro e auto-forjavel como o .md ja era - nao e regressao.) | registro valido sem approval => allow |
| C3-3 | BAIXA | `now` de evaluateGuard nao chega a intakeRecordResolves (usa new Date()); expiracao nao e testavel por injecao. | validAck(root, env) |
| C3-4 | BAIXA | Negacao `!apps/legacy` ignorada (vigia a mais, fail-closed); node_modules dentro da raiz e vigiado; symlink de pnpm-workspace.yaml para fora do repo e seguido (le so nomes de raiz). | itens do script c3attack.cjs |
| C3-5 | BAIXA | Impacto: platform passa a negar 319/580 (190 em apps/ fora de convencao) sem discriminante (B1-F3); todo export novo em apps/ exige intake. E decisao de produto (F2), nao defeito. Custo: corpus 3 modos 8,0s -> 16,4s (mais arquivos avaliados + manifestos reparseados por chamada, sem cache); ~5-9 ms/chamada, longe do timeout de 4 s. | c3corp.cjs |
| C3-6 | BAIXA | capability-reuse.md: 3 tabelas reformatadas (ruido de diff, sem mudanca de conteudo). | git diff |

## Alegacoes
- Raizes: `apps/*`, `apps/**`, `libs/*/pkg` => raiz literal; `../x`, absoluto, `.`, `..` => ignorados (nao vigia fora); yaml malformado/maior que 256KB => fallback apps; alias bomb 11 ms; package.json workspaces array/objeto ok. Exclusoes __tests__/tests/test/e2e/design-reference/.test./dist/.d.ts ok.
- Intake forjado, todos DENY: token em outro campo, id com sufixo, $schema v1, schema_version "2" string, decision invalida, expires_at passado/null/lixo/numerico/so-data-passada, json fora de docs/decisions ou sem 'intake' no caminho, array, BOM, chave request_id duplicada, token com espaco, ack=1, id curto, symlink para fora, docs/decisions symlink para fora, symlink de diretorio. Valido e futuro => allow.
- Re-exports com from (`export *`, `export {x} from`, `export type {}`, `export * as`, multilinha) => allow; `export {x}` local, default, e `export {a as b} from` + `export {z}` => DENY. Nao ha mudanca de codigo em barrels (ja eram permitidos): o teste "barrels" e RED na base so porque apps/ nao era vigiado.
- RED na base: 6 de 8 novos (4 watched roots incl. qualifies, barrels, JSON valido); os 2 que passam (tests/e2e fora, JSON invalido) sao pins negativos, esperado. Base reconstruida em /tmp/hseos-crp/rev/base3 (15 falhas preexistentes ali sao artefato do snapshot parcial).

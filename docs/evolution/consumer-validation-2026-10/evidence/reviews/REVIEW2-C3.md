# REVIEW2 C3 (rodada 2)
Veredito: APROVAR COM 1 RESSALVA MEDIA (negacao com glob apos diretorio literal desliga a vigilancia da raiz inteira).

| ID | Status | Evidencia |
|---|---|---|
| C3-1 `*`/`**`/fallback | FECHADO | `*` e `**` => vigia todo diretorio de 1o nivel (apps, scripts DENY; node_modules e arquivo na raiz allow); so-negacoes e `[]` => fallback apps (DENY) |
| C3-2 aprovacao | FECHADO | rejected/pending/null/numerico => DENY; Implemented (caixa) allow; approval sem reference, {} ou string => DENY; exception sem expires_at (mesmo com status implemented) => DENY; exception com expiracao futura allow, passada DENY; keep-local sem approval e sem status => DENY |
| now propagado | FECHADO | now=3000 invalida expiracao 2999; now=2019 valida expiracao 2020 |
| Registros reais do consumidor | OK | 55 JSON em /tmp/hseos-crp/b1/repo/docs/decisions/intake: status `implemented` (4) e `registered_not_implemented` (1) existem de fato; 54 aceitos como ack, 1 recusado: 2026-09-02-case-notes-history-blocked-backend.json (exception, status implemented, sem approval/expiry) - coerente com "exception exige expires_at" e com a policy, mas e atrito real para o consumidor |
| Brecha por status | BAIXA | status no conjunto aceito dispensa approval: keep-local com so `status: implemented` (ou registered_not_implemented) e aceito. Campo autodeclarado; mesma forca do .md |

## Novo achado
C3-7 MEDIA: negacao com glob depois de diretorio literal vira exclusao da raiz inteira: `packages: [apps/*, '!apps/*/fixtures']` ou `'!apps/**/stories'` => globRoot('apps/*/fixtures')='apps' => `!apps` => apps/a/src/x.ts passa a ALLOW (under-watch silencioso, reintroduz F2). `!apps/legacy` funciona; `!**/x` e ignorado corretamente. Correcao: so aplicar exclusao quando o glob negado e totalmente literal; senao ignorar (fail-closed) ou testar com glob real. Repro: /tmp/hseos-crp/rev/c3r2.cjs.

## Diferenca local=319 do executor: BUG DE MEDICAO (codigo correto)
O fixture de /tmp/c3old/modes2.js grava `.hseos/config/platform-bindings.yaml` com `mode: local` SEM `mode_ref` (e sem docs/decisions/mode.md). loadPlatformBindings devolve erro "mode 'local' requires mode_ref" e o guard cai em platform (fail-closed, por desenho da policy). Reproduzido: {"mode":"platform","errors":["... requires mode_ref"]}, evaluateGuard exit 2. Com fixture valido (modes de B1, mode_ref + decisao) local = 0 deny nos 580 arquivos.

## Custo (580 arquivos, platform, load ~1.3)
| Caminho | Base | C3 |
|---|---|---|
| total | 5,3 ms/chamada (3,1 s) | 9,2 ms/chamada (5,3 s) |
| arquivo vigiado (deny) | 15,0 ms | 14,1 ms |
| nao vigiado | 3,0 ms | 2,9 ms |
Conclusao: o custo por chamada nao mudou; o aumento e so a proporcao de arquivos na via de 14 ms (124 -> 319). Cache de workspaceRoots funciona (manifestos nao reparseados). Custo evitavel (ja existia na base, fora do escopo de C3): ~2,6 ms git rev-parse + ~5,2 ms readRecordedMode (4 spawns git) + ~1,2 ms detectExports por chamada; registry+bindings custam ~0,7 ms (nao e o gargalo). Em hook (processo por escrita) os spawns git sao inevitaveis; so ajudaria em lote.

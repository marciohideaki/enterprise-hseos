# R-B5 — revisão cética da task B5 (commit ba795380)

Veredito: APROVADO COM RESSALVA MENOR (nenhum bloqueio). Passagem 2 não executada: /build/tmp/pre-w6/logs-wb/B5.md não existia na hora da revisão.

## Passagem 1 (cega)

Runner
- `pilotVendors = new Set(['gemini','openai'])`; a lista `vendors` (four-family) segue com os 4 originais. OK.
- openai com 2 bindings: `CONTROL_CAMPAIGN_PILOT_SCOPE_INVALID` (teste cobre, calls()==0). OK.
- Sem saldo: `quotaAdmission` só devolve `owner_exception` com `quota_exceptions` válida (expires_at > now e <= deadline); sem ela `CONTROL_PROVIDER_QUOTA_UNAVAILABLE`. Teste cobre os dois lados. OK.
- Mutação (cópia fora do worktree, cg.sh, removida ao fim): tirar `openai` da lista derrubou 2 testes (pilot do vendor compatível e quota_exceptions). Mutação morta.
- Observação: a asserção "four-family recusa openai" não distingue a mutação (VENDOR_UNKNOWN sai igual), mas os outros testes a matam. Sem impacto.

Docs
- `VENDOR_AMBIENT_KEY` não aparece mais; ambos os docs apontam para a lista `ambient` da tabela `VENDORS`. OK.
- Conferido contra `provider-api-adapter.js`: gemini = GEMINI_API_KEY + GOOGLE_API_KEY; openai = OPENAI_API_KEY; ambos `balanceUrl: null`. Bate.
- `CONTROL_CAMPAIGN_PILOT_SCOPE_INVALID` documentado nos dois; exigência de `quota_exceptions` (reason, expires_at <= deadline, `owner_exception`) explicada e coerente com o código.
- Nenhum fornecedor restrito citado (grep no diff). Neutralidade passa.
- RESSALVA (baixa): o vendor de API anterior é descrito só como "a variável própria dele, nomeada nessa tabela"; a variável não é nomeada, embora a spec (b) peça "pelo nome das variáveis". Não é inexato, mas obriga o leitor a abrir o código. Decisão do executor (forma genérica) é defensável se o nome do fornecedor for sensível; senão, nomear `TERCEIRO_API_KEY`.

Execução (cg.sh, Node 24, TMPDIR=/build/tmp/rev-b5-tmp, sem timeout)
- runner + control + adapters + api-adapter + model-binding-l1: 104 pass, 0 fail.
- c8 em provider-campaign-runner.js: stmts 100, branch 89.13, funcs 100, lines 100 (>= 90/80).
- eslint (arquivos tocados, max-warnings=0): OK. prettier (4 arquivos): OK. `check:cli`: OK. test-documentation-neutrality: 2 pass.
- `ci-test-shards.mjs verify --shards 6`: OK, 103 itens cobertos uma vez.
- Commit: 1 commit, 79 caracteres, sem Co-Authored-By nem menção a IA/modelo/fornecedor. Worktree limpo.

## Passagem 2
Não realizada (log do executor ausente). Reexecutar o confronto quando B5.md existir.

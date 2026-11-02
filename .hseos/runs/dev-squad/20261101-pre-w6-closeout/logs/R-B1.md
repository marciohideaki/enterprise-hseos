# R-B1 — Revisão cética do commit 6f2538cd (adapter da quarta família, API Gemini)

Veredito: APROVADO COM RESSALVAS (nenhum bloqueante). Revisor só reportou; nada foi editado no worktree. Cópia descartável em /build/tmp/rev-b1 removida.

## Passagem 1 (cega)

1. Adapter por vendor — OK.
   - A tabela `VENDORS` mantém o vendor existente idêntico: `ambient: ['TERCEIRO_API_KEY']`, as duas origens, `balanceUrl` e `effective_backend` pela origem da URL de saldo. O filtro `key !== name` reproduz o antigo `name === VENDOR_AMBIENT_KEY ? {} : {...}`.
   - `VENDOR_AMBIENT_KEY` deixou de existir como constante e virou o campo `ambient` por vendor. A Gemini tem variáveis próprias: `GEMINI_API_KEY` e `GOOGLE_API_KEY`, distintas da declarada `HSEOS_GEMINI_API_KEY`. Isso é aceitável e mais forte que o antigo.
   - A Gemini sem `balanceUrl` não faz requisição em `inspect()`, devolve `quota_remaining_requests: null` e não devolve `quota_available_microusd`. `provider-campaign-control.js` (L405-425) só admite por `owner_exception`; sem exceção ou com exceção expirada dá `CONTROL_PROVIDER_QUOTA_UNAVAILABLE`. Nunca é ilimitada nem observada.
   - Vendor desconhecido: `CONTROL_PROVIDER_CONFIGURATION_INVALID`. O comportamento anterior para vendor ≠ terceiro caía na mesma checagem.
2. Binding Gemini — OK.
   - Formato dos demais (`profile_id`, `adapter: openai-compatible-sse`, `env://HSEOS_GEMINI_API_KEY`).
   - `operational: false` e `authorized: false`, travados por teste.
   - Endpoint no host reservado `.invalid` e modelo `a-confirmar-na-campanha`, ambos marcados "a confirmar na campanha". Sem segredo; há teste de regex contra chave.
3. L1 completo — OK. Amostra de 5 (credencial injetada, sobrescrita, eco dividido em deltas, ambiente sobreposto, backend efetivo) mais cota e tarifa expirada: todos nomeados, com fixture de transporte (`fetchImpl`), sem rede. Cada item do recibo mapeia para um teste existente.
4. Pendência do runner — fato confirmado.
   - `tools/cli/lib/provider-campaign-runner.js:4` define `const vendors = ['codex','claude','terceiro','antigravity']`.
   - L36: `covered.some(v => !vendors.includes(v))` dá `CONTROL_CAMPAIGN_VENDOR_UNKNOWN`.
   - L37: `four-family` exige `vendors.every(covered)`.
   - Tamanho da mudança: pequeno, de 3 a 6 linhas de produção mais testes em `test-provider-campaign-runner.js`.
   - Riscos:
     a) Não basta acrescentar `gemini` em `vendors`. Isso tornaria a cobertura `four-family` exigir cinco vendors e quebraria planos e testes atuais. Precisa de uma lista separada, por exemplo `pilotVendors`, aceita em L36 e excluída do cálculo de L37.
     b) Em `four-family`, um plano que cite `gemini` além dos quatro deve continuar válido ou ser recusado de forma explícita; decidir e testar.
     c) Escopo `pilot` com `gemini` deve exigir um único binding (`bindings.size === 1`) para não misturar famílias. Sem isso o `pilot` vira porta lateral.
     d) Teste negativo obrigatório: `four-family` sem antigravity mas com gemini continua dando `CONTROL_CAMPAIGN_COVERAGE_INCOMPLETE`.
5. Mutações (cópia descartável; linha de base 32/32 passa via cg.sh):
   - (a) Gemini reporta cota observada: cai `L1 fourth family: no balance is observable...` (1 teste). Poder de detecção estreito (um só teste); aceitável, pois é o teste que ancora a invariante.
   - (b) sonda de saldo usada para a Gemini (`balanceUrl: BALANCE_URL`): caem 3 (`no balance is observable`, `the supervisor injects...`, `the backend a request reaches...`).
   - (c) vendor existente perde o ambient (`ambient: []`): cai `production campaign refuses a second credential source...` (1 teste, cobertura preexistente).
   - (d) extra: Gemini perde `GOOGLE_API_KEY`: caem 5 testes, entre eles `the vendor ambient keys never overlay...`.
   - Todas derrubaram ao menos um teste.
6. Execução (cg.sh, Node 24, exit 0):
   - model-binding-l1 + api-adapter + agent-provider-binding: 45/45.
   - `test-provider-campaign-*` + neutralidade + package-surface + evolution-trace: 82/82.
   - eslint e prettier nos arquivos tocados: OK.
   - `ci-test-shards.mjs verify --shards 6`: OK 103 items.
   - c8 do `provider-api-adapter.js` em subconjunto (3 arquivos): 98.96 linhas / 93.4 branches, acima de 90/80.
   - c8 do `provider-control-manifest.js` no meu subconjunto: 95.19 / 61.9 branches. NÃO reproduzi os 82.08 declarados, pois rodei só 3 arquivos de teste e não os 100 do executor. Não verificado integralmente.
   - Atribuição de IA no commit: ausente. As ocorrências de "claude" no diff são o nome do vendor, não atribuição.

## Achados

- A1 (médio, não bloqueante): para a Gemini `origins: null` aceita qualquer origem HTTPS. A credencial seria enviada ao host que o binding nomear. O `binding_sha256` do manifesto e a checagem de drift mitigam, e o host atual é `.invalid`, mas o manifesto não fixa a origem. Recomendação: a campanha deve fixar a origem confirmada na declaração (allowlist por vendor) antes de qualquer L2 com chave real.
- A2 (baixo): `artifact_sha256` e `credential_sha256` do manifesto são pinos de modelo, não valores reais; o L1 os religa em runtime. O recibo declara isso. Sem ativação real, o manifesto sozinho não passa na criação do adapter.
- A3 (baixo): a mutação (a) a nível de adapter cai em um único teste. Considere uma asserção no teste de campanha de que a admissão é `owner_exception`; ela já existe, então sem ação obrigatória.
- A4 (informativo): `profile_id: agent-openai-compatible-candidate` é emprestado do binding compatível. Coerente com o padrão, mas sem profile próprio.
- A5 (informativo): o c8 declarado de `provider-control-manifest.js` (97.59/82.08) depende do conjunto completo de testes; neste subconjunto as branches ficam abaixo de 80.

## Passagem 2 (confronto com logs-wb/B1.md)

- Confirmados: commit único, mudanças listadas, testes verdes, verify OK, eslint/prettier OK, mutações derrubadas, runner intocado (`CONTROL_CAMPAIGN_VENDOR_UNKNOWN` para `gemini`).
- Ressalva honesta do executor ("contagem do vermelho não registrada") é verdadeira e não afeta o aceite.
- Divergência única: c8 de branches do manifesto, não reproduzido no meu subconjunto (A5).
- Nenhuma alegação do executor foi refutada.

## Reconferência rodada 1 (aabf8788)

Veredito: APROVADO COM UM ACHADO MENOR (documentação). Nada editado; cópia /build/tmp/rev-b1b removida.

1. Runner: `pilotVendors = new Set(['gemini'])` separado de `vendors`. Gemini fora de `pilot` dá `CONTROL_CAMPAIGN_VENDOR_UNKNOWN`; com 2 ou mais bindings dá `CONTROL_CAMPAIGN_PILOT_SCOPE_INVALID`; o cálculo do `four-family` continua sobre os 4 vendors atuais. ACHADO R1-A (baixo): `CONTROL_CAMPAIGN_PILOT_SCOPE_INVALID` NÃO está documentado em `docs/v4-migration.md` (o arquivo não foi tocado e o código só aparece no runner, no teste e no recibo), embora o arquivo documente outros códigos `CONTROL_CAMPAIGN_*`/`CONTROL_PROVIDER_*`. Falta uma linha lá.
2. Origem: `allowed_origin` (z.url opcional) está em `options`, que entram no `engineeringDigest({binding, options})`. Para gemini, a criação exige HTTPS, `allowed_origin` presente, igual à sua própria `.origin` (rejeita caminho) e igual à origem do `base_url`; ausente, malformada ou diferente é recusada na construção, antes de qualquer requisição (teste com `calls.length === 0`).
3. Worktree: `git status` vazio, `git diff HEAD` vazio, HEAD aabf8788. Conteúdo bate com o commit.
4. Execução via cg.sh: 117/117 (binding-l1, api-adapter, agent-provider-binding, provider-campaign-*, neutralidade, package-surface); `verify --shards 6` OK 103 items; eslint e prettier OK; c8 api-adapter 98.97/94, runner 100/88.88.
Mutações próprias na cópia (via cg.sh, linha de base verde): M1 sem a checagem de 1 binding cai em 1 teste; M2 sem a comparação de origem cai no teste de origem fixada; M3 contando gemini no four-family cai no teste dos quatro vendors exatos. Todas derrubadas.

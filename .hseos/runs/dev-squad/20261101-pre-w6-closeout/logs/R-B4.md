# R-B4: revisão cética da B4 (commit 49eda662, worktree pw-b4-openai-env-launch)

Revisor isolado; nada foi editado, commitado ou resetado no worktree. As mutações rodaram numa cópia sob /build/tmp/rev-b4/, já removida.

## Veredito: APROVADO COM RESSALVAS (2 achados médios a corrigir antes do merge, nenhum bloqueante de segurança)

## Passagem 1 (cega)

### 1. Parte A, binding e adapter: OK
- `openai-compatible.example.yaml`: endpoint (`https://api.openai.com/v1`) e modelo (`gpt-4o-mini`) comentados "a confirmar na campanha"; nenhum saldo, preço ou cota inventado. A origem é a API oficial do provedor do formato, não a do fornecedor do binding ACP de terceiro (ajuste do Commander atendido).
- Credencial só por nome: `env://HSEOS_MODEL_PROVIDER_API_KEY`. `operational: false` e `authorized: false` mantidos.
- Vendor novo no enum e em `VENDORS` não altera o vendor anterior: ambiente recusado, origens e `balanceUrl` dele ficaram idênticos; a sonda de saldo e o `effective_backend` do vendor anterior continuam saindo de `BALANCE_URL`. `Object.hasOwn(VENDORS, ...)` protege contra `__proto__`. O check `manifest.vendor !== 'terceiro'` foi trocado por lookup na tabela, e a recusa de origem é por vendor.
- Sem saldo: `inspect` não faz requisição e não reporta `quota_available_microusd`; `quotaAdmission` (provider-campaign-control.js:406-426) então só admite com `quota_exceptions` válida e dentro do deadline (`owner_exception`), senão `CONTROL_PROVIDER_QUOTA_UNAVAILABLE`. Nenhum endpoint de saldo inventado.
- Lacuna de cobertura (ver achado 1): o caminho de admissão com exceção para o vendor novo não é testado fim a fim, só o nível do adapter.

### 2. Recusa por `OPENAI_API_KEY`: código OK, documentação NÃO
- Código e teste coerentes: chave ambiente do vendor, se presente e diferente da fonte declarada, gera `CONTROL_PROVIDER_CREDENTIAL_CONFLICT`.
- `docs/v4-migration.md:366` ainda cita a constante `VENDOR_AMBIENT_KEY`, que a B4 removeu (agora `VENDORS[...].ambient`), e fala só da chave do vendor anterior. Nem esse arquivo nem o runbook mencionam `OPENAI_API_KEY`. Achado 2 (médio). Não consegui confirmar o texto da decisão da A2; a coerência é só com o mecanismo F17 existente.

### 3. Parte B: OK
- Teste unitário do wrapper (`delegatedLaunch`) prende `Delegate=yes` logo após `-p`, `--user`, `--wait`, `--collect`, `--pipe`, `--working-directory`, `PATH`, TMPDIR que não é `/tmp`, e ausência de credencial nos args. Confirmei que a mutação da B4 também derruba (fail 1 reportado por ela; não repeti).
- Teste do `tools/list` usa `skip` calculado por sonda real (Linux, `/usr/bin/bwrap`, `systemd-run --user -p Delegate=yes ... true`, cache pinado) com motivo explícito. Sem verde falso: nesta máquina rodou, 0 pulados. Observação menor: a sonda roda no carregamento do módulo (efeito colateral: um `systemd-run true`), aceitável.
- Runbook: seção "Cliente real para environment.*" tem bloco mcp.json executável, `--setenv` explicado, pré-requisitos, prova e verificação manual; NOT_EXERCISED mantido para a chamada `tools/call environment.*` por cliente real. Substituiu corretamente a frase anterior "não foi testado" por referência à seção.

### 4. Conflito previsto com a B1 (não mesclei)
- B4 (49eda662): `VENDORS.openai = { ambient: ['OPENAI_API_KEY'], origins: [2 URLs fixas da API oficial], balanceUrl: null }`; origem validada por `vendor.origins.includes(...)`; sem opção nova.
- B1 (aabf8788): `VENDORS.gemini = { ambient: ['GEMINI_API_KEY','GOOGLE_API_KEY'], origins: null, balanceUrl: null }`; quando `origins` é null a origem vem de `settings.allowed_origin` nas opções (HTTPS, pinada pelo digest). Também adiciona `allowed_origin` ao `optionsSchema`.
- Ambos: mesmo ramo "sem saldo" em `inspect` (hunk praticamente idêntico), mesma remoção de `VENDOR_AMBIENT_KEY`, mesmo lookup `Object.hasOwn(VENDORS, ...)`, mesmo ajuste em `provider-control-manifest.js` (ROUTES + enum) e em `control.js` (catálogo + pending_real_conformance).
- Compatíveis numa tabela única: sim. A condição de origem da B1 já ramifica em `vendor.origins ? includes : allowed_origin`, que cobre os dois (openai com lista fixa, gemini com null). Conflitos serão apenas textuais (bloco VENDORS e comentário, enum, ROUTES, lista do catálogo, `pending_real_conformance`, `test-model-binding-l1.js`). Resolução: manter as duas entradas, a condição da B1, e a ordem alfabética/enum com ambos.
- Atenção no merge: a B1 mexeu em `provider-campaign-runner.js` (`pilotVendors`) e a B4 não. Sem `openai` ali o runner recusa um plano com binding openai com `CONTROL_CAMPAIGN_VENDOR_UNKNOWN` (achado 1).

### 5. Mutações próprias (cópia descartável, removida)
- (a) aceitar origem de outro vendor (check de origem substituído por `false`): derrubou 2 testes ("API adapter refuses unsupported origin..." e o teste novo do vendor openai). Pass 14, fail 2.
- (b) vendor novo reportando cota observada (`quota_available_microusd` no ramo sem saldo): derrubou o teste novo do openai. Pass 15, fail 1.

### 6. Execuções (cg.sh, Node 24, exit 0)
- Testes tocados e vizinhos: model-binding-l1, agent-provider-binding, mcp-environment-host, provider-api-adapter, provider-control-manifest, provider-campaign-runner, provider-campaign-adapters, provider-campaign-control, package-surface, documentation-neutrality: 156 pass, 0 fail, 0 skipped.
- c8 dos arquivos do gate tocados: provider-api-adapter.js 98.95 stmts / 93.02 branch / 100 funcs; provider-control-manifest.js 97.11 / 80.59 / 100 (medido só com 4 arquivos de teste).
- `ci-test-shards.mjs verify --shards 6`: OK, 103 items, 237 arquivos de teste cobertos uma vez. (`hseos verify` não existe como comando da CLI.)
- eslint (js/yaml tocados) 0 problemas; prettier OK nos tocados. Aviso de eslint sobre o `.json` é artefato de passá-lo explicitamente (arquivo ignorado pela configuração), não achado.
- Atribuição de IA na mensagem do commit: nenhuma (sem Co-Authored-By nem menção a ferramenta).

## Achados
1. (médio) `tools/cli/lib/provider-campaign-runner.js:4` não conhece `openai`: um plano de campanha com o binding openai-compatible falha com `CONTROL_CAMPAIGN_VENDOR_UNKNOWN` antes de qualquer admissão, então "sem saldo, vale `quota_exceptions`" não é exercitável pela campanha, e nenhum teste de runner/control cobre o vendor novo com exceção. Corrigir junto com a decisão de escopo da B1 (`pilotVendors`) e acrescentar teste de admissão `owner_exception` para o binding openai.
2. (médio) `docs/v4-migration.md:366` referencia `VENDOR_AMBIENT_KEY`, constante removida, e não documenta a recusa de `OPENAI_API_KEY`; o runbook também não. Atualizar para "a chave ambiente do vendor (tabela `VENDORS`)" e listar `OPENAI_API_KEY`.
3. (baixo) A B4 não provou a mutação sem `Delegate=yes` sob host sem cgroup delegado; ela declarou isso. O teste unitário do wrapper cobre a regressão textual, e o de integração depende do host. Aceitável.
4. (baixo) O teste de integração da Parte B só prova o servidor sob o wrapper, não um cliente real; já declarado e mantido NOT_EXERCISED.

## Passagem 2 (confronto com logs-wb/B4.md)
- "Binding aponta para API oficial, modelo placeholder, credencial por nome, false/false": CONFIRMADO.
- "VENDORS sem saldo, sem requisição, quota_exceptions": CONFIRMADO (mutação b).
- "Mutação do wrapper sem Delegate=yes / sem --pipe derruba": não repeti, plausível pelo teste de argumentos; sem contradição.
- "150 testes, 0 pulados": CONFIRMADO em escopo ligeiramente maior (156, 0 pulados).
- "verify OK, eslint 0, prettier OK": CONFIRMADO.
- Divergência de hash: o relatório da B4 cita primeiro ce1ad752 / binding_sha 41aff6dd e depois 37ddde89 (Rodada 1); o commit atual é 49eda662 e o manifesto traz 37ddde89...11c4, consistente com a Rodada 1; os testes que pinam o digest passam.
- Omissão: o relatório não menciona que o runner rejeita o vendor novo nem a doc obsoleta (achados 1 e 2).
- Sem alegação refutada; nenhum PASS convertido de bloqueio.

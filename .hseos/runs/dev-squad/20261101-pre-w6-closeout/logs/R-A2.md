# R-A2 — revisão cética da A2 (L1 de F17)

Veredito: **PASS-WITH-NOTES**. Nenhum achado bloqueante. Revisor reporta, não corrigiu nada.

## Alvo revisado
- O commit pedido, `b1b8f438`, não é mais o HEAD da branch `task/pw-a2-l1-f17`. O HEAD é `e3334762`, emendado depois.
- `git diff b1b8f438 e3334762` altera só `docs/evolution/w3/L1-F17-2026-11.md` (6 linhas). A versão antiga citava o fornecedor restrito pelo nome 3 vezes no recibo. A nova usa "binding ACP de terceiro".
- Código, testes e declarações são idênticos nos dois. Revisei o HEAD.
- `logs/A2.md` ainda cita `b1b8f438`. O hash está obsoleto (N1).

## Passagem 1 (cega)

### 1. Classificação dos bindings: correta
- Classificação do executor:
  - F17 (modelo): `openai-compatible` e o ACP tool-free.
  - F18 (runtime): `claude-agent-sdk`, `codex-app-server` e o ACP de terceiro.
- `ROUTES` em `provider-control-manifest.js` só admite `provider_kind: 'model'` para o fornecedor restrito. Para claude e codex as `kinds` são `['runtime','client']`.
- O schema recusaria um manifesto `model` para a rota API do claude-agent-sdk. A exceção que o lead sugeriu (rota API do claude = model provider) não se sustenta no estado atual do código.
- Esses bindings têm `runtime_provider_id` e não `provider`. Pertencem a F18, que o `requirements.json` descreve como "Runtime providers externos".
- O teste de inventário (`CLASSIFICATION`) recusa binding novo sem classificação.
- Todos os 5 arquivos oficiais estão classificados.

### 2. Código

**`assertEffectiveBackend`** (`tools/lib/provider-control-manifest.js:171`)
- O valor "efetivo" vem da requisição observada no `fetch` injetado: URL e `model` do corpo.
- O valor "declarado" vem do arquivo de binding. O chamador não fornece um valor próprio para sair verde.
- Recusa origem ou modelo ausente, divergente, de outro esquema (`http`) ou `undefined`.

**`selectDeclaredCredential`** (`tools/lib/provider-control-manifest.js:183`)
- Um segundo valor não vazio de outra fonte gera `CONTROL_PROVIDER_CREDENTIAL_CONFLICT`. Isso vale também quando o valor é igual ao declarado.
- Declarada ausente gera `CONTROL_PROVIDER_IDENTITY_UNVERIFIED`.
- O caso local sem credencial recusa fonte ambiente.
- Os dois comportamentos foram provados por teste e por mutação.

**Códigos novos**
- `grep` em CLI, MCP, docs e schemas não encontra os códigos novos fora do módulo e do teste.
- Nenhum catálogo de erros exige atualização.

### 3. Declarações
- O formato é o `ProviderControlManifest` existente. O `parseProviderControlManifest` aceita os dois manifestos.
- `credential_sha256 = sha256("template:<binding_id>")` (recalculei: bate).
- Não parece credencial certificada: `provider-campaign-control.js:518` compara o hash observado com o do manifesto. Uma credencial real divergiria e recusaria (fail-closed).
- O schema aceita qualquer hex de 64 caracteres e nenhum validador marca o hash como "template". O recibo declara o limite.
- Neutralidade:
  - `test-documentation-neutrality.js` passa (2/2, exit 0) no HEAD.
  - O gate só varre `.adoc/.md/.mdx/.rst/.txt`. O `.json` fica fora, embora o gate teste o nome do arquivo (para as extensões que ele varre).
  - O nome `docs/evolution/w3/model-bindings/<fornecedor restrito>-acp-tool-free.manifest.json` carrega o nome do fornecedor.
  - O campo `vendor` dos dois manifestos também. O valor é forçado pelo enum e por `ROUTES`, que só admite `model` para esse fornecedor (N5).
  - Os arquivos de binding em `.agents/` já carregam o nome, então não é regressão.

### 4. Testes
- `test/test-model-binding-l1.js`, 6 testes, comportamento real (provider real com `fetch` falso, `EngineeringControl`, `ProviderCampaignControl`).
- Registrado em `test:provider-control` (`package.json`).
- Os 6 passam via `cg.sh`.
- Lacuna do tool-free (sem backend efetivo provado): aceitável para L1 se declarada. O recibo declara.
  - O endpoint vem de `TERCEIRO_BASE_URL` em ambiente.
  - `artifact_sha256 == binding_sha256` (auto-pino).
  - O L1 do tool-free fica mais fraco que o do openai-compatible (N3).

### 5. Mutações próprias (cópia sob `/build/tmp/rev-a2`, removida ao fim)
- (a) `assertEffectiveBackend` sempre ok: derrubou `the backend a request actually reaches ...`.
- (b) `selectDeclaredCredential` prefere o ambiente: derrubou `credential precedence ...`.
- Na cópia, o teste de cota falha também no baseline (sem mutação). É artefato da cópia, fora do worktree. No worktree real o teste passa.
- Por isso a evidência é a queda do teste-alvo, que não aparece no baseline.

### 6. Execução (Node 24, `cg.sh`)
- `test-model-binding-l1.js`: 6/6, exit 0.
- `test-provider-control-manifest.js` + `test-model-providers.js`: 19/19, exit 0.
- Conjunto ampliado de 5 arquivos: 66/66.
- c8 de `provider-control-manifest.js`, que está em `.c8-kernel.json`: 97.54 linhas / 80.64 branches / 100 funções, no meu conjunto de 5 arquivos. O executor reporta 87.09 de branches com o conjunto dele. Ambos atendem ≥ 90/80.
- `ci-test-shards.mjs verify --shards 6`: `OK 102 items`.
- eslint: exit 0.
- prettier (código, md, json, package.json): exit 0.
- package-surface: pass 1.
- Atribuição de IA: nenhuma nas mensagens de commit (`Co-Authored-By`, `Claude`, `Generated`: sem ocorrência).

## Passagem 2 (confronto com logs/A2.md)
- "Vermelho 4/2, verde 6/6, vizinhos 50/50, shards OK 102, eslint/prettier 0": confirmado ou compatível.
- c8: o número difere pelo conjunto de testes; ambos passam o gate.
- Mutações do executor (backend, precedência, exceção expirada): as duas primeiras reproduzi. A terceira não foi refeita; o teste cobre o caminho real de `owner_exception` expirada (`CONTROL_PROVIDER_QUOTA_UNAVAILABLE`, 0 chamadas).
- "Sem binding de modelo local": confere (`ls provider-bindings` tem 5 arquivos, nenhum modelo local). O ADR pede "locais e remotos". Fica declarado, não é furo.
- Alegação sem desvio encontrada.

## Notas (não bloqueantes)
- N1: `logs/A2.md` e o pedido de revisão apontam para `b1b8f438`; o commit vigente é `e3334762`. Cite o hash correto no fechamento.
- N2: `assertEffectiveBackend` e `selectDeclaredCredential` não têm nenhum chamador em produção; só o teste as usa. O L1 prova o contrato do helper e a observação de requisição real do provider, não que o runtime aplique o helper. Aceitável para L1, mas o Commander deve registrar que L2 precisa ligá-las ao caminho ativo.
- N3: o backend efetivo está provado só para `openai-compatible`; no tool-free há só modelo e credencial. Declarado no recibo.
- N4: o `credential_sha256` de template e o `artifact_sha256` auto-pinado não são distinguíveis de valores reais por nenhum validador. O teste de cota usa o próprio hash do manifesto como "observado", logo não exercita identidade. Risco baixo (a identidade real recusaria).
- N5: o manifesto `openai-compatible` carrega `vendor` do fornecedor restrito, forçado por `ROUTES`, embora o binding aponte para `api.example.invalid` e `organization/model`. É um rótulo de convenção, não identidade real. O manifesto não tem campo de modelo ou endpoint; a ligação com o binding é pelo `binding_sha256` (e o teste confere modelo e URL no binding).
- N6: o nome de arquivo `.json` citando o fornecedor restrito escapa do gate de neutralidade (só vê extensões de documento). Considerar ampliar o gate ou renomear (decisão do Commander).

## Reconferência rodada 1 (commit `03770e43`)

Veredito: **PASS-WITH-NOTES**, com um achado médio (documentação do comportamento novo).

Execução (cgroup via `cg.sh`, Node 24):
- `npm run test:provider-control`: 269 tests, 269 pass, 0 fail.
- `verify --shards 6`: OK 102 items.
- eslint, prettier, package-surface e gate de neutralidade: verdes.
- Sem atribuição de IA na mensagem do commit.
- c8 dos 4 arquivos (gate 90/80), no meu subconjunto de 6 testes:
  - `control-configuration` 98.01/89.36
  - `provider-api-adapter` 98.84/92.2
  - `provider-control-manifest` 97.56/83.82
  - `provider-campaign-control` 86.84/92.77 (linhas abaixo de 90 só porque o subconjunto é menor)
  - O executor reporta 96.37/93.12 para o `provider-campaign-control` com a suíte completa; não reproduzi esse número.

Correção da minha nota anterior: a falha de baseline do teste de cota na cópia descartável era artefato de eu não ter copiado `.github/`. Com `.github/` copiado, o baseline é 13/13.

Mutações em produção (cópia descartável, removida):
- Desligar `assertEffectiveBackend` na admissão (`provider-campaign-control.js`): cai `production campaign refuses an effective backend ...`.
- Trocar `selectDeclaredCredential` por leitura direta do ambiente (`provider-api-adapter.js`): cai `production campaign refuses a second credential source ...`.
- Os dois testes passam pelo caminho real (campanha com adapter real) e recusam antes de qualquer chamada de rede.

### Pontos pedidos
1. Mudança de comportamento.
   - Variável tratada: uma só, a chave de ambiente do fornecedor restrito (`VENDOR_AMBIENT_KEY`).
   - Regra de recusa: se a chave declarada no binding tem outro nome e a chave do fornecedor está presente e não vazia no ambiente (`process.env` por padrão), a campanha recusa com `CONTROL_PROVIDER_CREDENTIAL_CONFLICT`, sem fallback.
   - Se a declarada é essa mesma variável, nada muda.
   - Uso legítimo afetado: operador, ou CI, que mantém essa chave global para o runtime delegado (os bindings do runtime delegado exigem esse mesmo nome) e declara outro nome na campanha de API. Esse operador passa a ser bloqueado. A suíte existente não pega isso, pois nenhum teste anterior cobria esse arranjo.
   - Recusar é a decisão alinhada ao ADR-0050 L1 ("credencial de ambiente sobreposta tratada") e ao critério da A2 (conflito recusado, não fallback). Ignorar com aviso reintroduziria a ambiguidade de identidade. Recomendo manter a recusa.
   - **Achado médio:** o comportamento e o código novo só estão descritos no recibo `L1-F17-2026-11.md`. Não aparecem em `docs/v4-migration.md`, `docs/evolution/runbooks/activation.md` nem `fourth-family.md`. Falta uma linha de runbook: "para a campanha de API, a chave do fornecedor não pode estar no ambiente se a declarada tiver outro nome; `unset` antes".
2. `assertEffectiveBackend`.
   - O `effective_backend.origin` da sonda é `new URL(BALANCE_URL).origin`, constante do código, a mesma URL passada ao `fetch` (com `redirect: 'error'`). É o destino real da sonda, mas não é lido da resposta.
   - O declarado vem de `binding.provider.base_url`, que a validação do adapter já restringe a duas URLs do fornecedor. Na prática, a checagem só pega deriva entre constante e validação. É limitada, mas não é cópia do declarado.
   - Afrouxamento: "compara modelo só quando o declarado traz". Em produção o `declared_backend` não tem modelo, então o modelo nunca é conferido ali. Antes a função exigia modelo sempre.
   - O recibo declara esse limite. O modelo continua provado só no teste com requisição real de provider.
3. Testes de produção: confirmados, com mutação (acima).
4. Cobertura e suíte: ver acima.
5. Docs: códigos novos só no recibo (achado médio acima).

Notas anteriores N1 a N6 seguem válidas. Em N2, a lacuna de ligação a produção foi fechada para o `openai-compatible`/API. O tool-free continua sem caminho de produção.

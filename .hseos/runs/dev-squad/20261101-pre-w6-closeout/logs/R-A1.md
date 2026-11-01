# R-A1 — revisão cética de A1 (L1 F08/F18, commit 89129990)

Veredito: APROVADO COM RESSALVAS (nenhum bloqueante). Revisor reporta, não corrige. Worktree intocado (git status limpo); cópia de mutação em /build/tmp/rev-a1/copy removida.

## Passagem 1 (cega)
- Escopo: 7 arquivos (6 de teste + recibo). Nenhum arquivo de tools/ ou packages/; requirements.json intacto. Sem trailer de IA no commit. OK.
- Neutralidade: recibo sem o nome do fornecedor restrito (0 ocorrências). Os testes novos citam o nome apenas em test-delegated-terceiro-cli.js (arquivo já existente, aceitável). test-documentation-neutrality.js: 2/2 pass.
- Execução (cg.sh, Node 24): egress-broker 9, campaign-control 36, campaign-adapters 22, runtime-providers 24, acp-campaign-boundaries 12, claude-account-adapter 18, provider-api-adapter 13, delegated-terceiro-cli 8, claude-cli-driver 16, codex-app-server-driver 10, claude-agent-sdk-driver 12: todos exit 0, 0 fail. Soma 180/180. verify --shards 6 exit 0 (OK 102 items, 235 test files). eslint --max-warnings=0 exit 0; prettier --check limpo (6 testes + recibo).
- Nomes citados no recibo: 20 casos amostrados (existentes e novos); todos existem (os de `${vendor} factory` são templates de loop). Os testes novos exercitam o comportamento (env do filho, rejeição por código, zero chamadas/launch), não são decorativos.

## Mutações dirigidas (cópia descartável)
| Mut | Alvo | Resultado |
|---|---|---|
| M3 | antigravity: encaminhar process.env no input do processo | derruba `L1 ... antigravity local binding` |
| M4 | antigravity: remover checagem identity_kind==local_profile | derruba o mesmo teste |
| M5 | antigravity: competing_credentials false->true | derruba o mesmo teste |
| M6 | openai-compatible: ignorar is_available no saldo | derruba `silent change of price, balance or reservation` |
| M7 | native: remover checagem do digest do binding | derruba `codex native ... ambient` (ramo CODEX_HOME) |
| M2 | claude-account: strict->passthrough + remover checagem do digest | derruba `claude account ... ambient` |
| M1 | claude-account: só strict->passthrough | NÃO derruba o teste L1 (cai apenas `configuration rejects unsafe or unpinned shapes`, existente) |
| M8 | native: só strict->passthrough | NÃO derruba nada |
Item 3 do pedido: confirmado. A parte "não pode ser declarada" do teste de credencial de ambiente é protegida por duas camadas (schema strict e digest); o teste só cai se ambas forem removidas (M2). O requisito é protegido de fato (a criação recusa), mas o teste não isola a camada de schema; isso fica coberto só pelo teste existente `configuration rejects unsafe or unpinned shapes`. Contraste: o teste do openai-compatible re-fixa o digest e isola a camada, os de claude-account/native não.

## Achados
1. (baixo) Redundância não isolada: M1/M8 acima. Sugestão ao executor/Commander: aceitar com a nota do recibo (já declarada) ou re-fixar o digest no loop de ambiente declarado. Não bloqueia L1.
2. (baixo/médio) Recibo, linha claude-agent-sdk, coluna I7: cita só `C:receipt` genérico + I6. O teste novo de cobrança silenciosa da camada de controle usa (claude, account), não a rota API do SDK; não há teste nomeado de I7 específico para claude-agent-sdk. A justificativa (teto = reserva budget_microusd) é plausível, mas é cobertura por teste compartilhado, não por binding.
3. (baixo) Recibo, linha `*-acp-tool-free`, coluna I5: cita validador de composição (plugin extra, symlink), que não trata login/credencial expirada. Mapeamento fraco; I5 do `*-acp` (segredo ausente / drift) é o que de fato se aplica.
4. (baixo) O glob `test-delegated-*-cli.js` do recibo casa 3 arquivos (claude 7, codex 7, terceiro 8 = 22 testes, todos verdes); o 8 do recibo é só o do terceiro. Ambíguo para quem reexecuta pelo glob.
5. (baixo) O teste antigravity tem asserts sobre o próprio fixture (m.billing.kind, max_request_microusd, credential null): decorativos. Os asserts reais (inputs sem 'ambient-', competing_credentials, rejeição de identity_kind) derrubam por mutação (M3-M5).
6. (informativo) Os "4 casos sem mutação própria": o antigravity L1 ficou fora da tabela de mutações do recibo (a tabela cobre 14 dos 15 casos); mutei e cai. O log diz "11 casos dependentes", o recibo mostra 14 na tabela: contagens inconsistentes entre log e recibo, sem efeito no veredito.

## Passagem 2 (confronto com logs/A1.md)
- 180/180: CONFIRMADO (soma por arquivo acima, exit 0 em cada).
- verify/eslint/prettier limpos: CONFIRMADO.
- "Nenhum arquivo de produção, requirements.json intacto": CONFIRMADO.
- "7 mutações, 11 casos": parcialmente inconsistente com a tabela do recibo (14); ressalva de .strict()->.passthrough() CONFIRMADA e é mais ampla (vale também para o native e para claude-account, ver M1/M8).
- c8/package-surface não aplicáveis: aceito (nenhum arquivo de gate tocado).

## Revisão do amend 64d28cdc (só o recibo mudou; testes e produção idênticos a 89129990)
Veredito mantido: APROVADO COM RESSALVAS. Código de teste inalterado, logo as execuções, mutações e verify acima continuam válidos (os arquivos de teste e tools/ são byte a byte os mesmos; diff 89129990..64d28cdc toca só o recibo).
- Neutralidade: recibo com 0 ocorrências do fornecedor; test-documentation-neutrality 2/2; prettier do recibo limpo; sem trailer de IA; árvore limpa.
- Rastreabilidade das linhas do recibo: os globs `test-delegated-*-cli.js` e `test-*-acp-composition.js` casam, para os títulos citados, exatamente um arquivo cada (o terceiro), e cada fragmento de título casa exatamente um teste (verificado por grep). Os dois títulos novos (`*-acp bindings: ambient...` e `*-acp-tool-free binding: redirecting...`) são únicos pelo sufixo.
- Achado 7 (baixo): dois títulos EXISTENTES foram reescritos no recibo e já não são pesquisáveis literalmente: `supervised terceiro profile completes one tool-free ACP turn...` (real: `supervised <fornecedor> profile ...`) e `sandbox readiness fails before reading the third-party secret...` (real: `...the <fornecedor> secret...`). Rastreável pelo resto do título (`completes one tool-free ACP turn under the fixed sandbox command`, `sandbox readiness fails before reading`), único em cada caso; mas o recibo deveria dizer que o termo foi substituído (a nota do cabeçalho cobre apenas os nomes de binding/arquivo).
- Achado 4 reforçado: a linha de execução agora lista `test/test-delegated-*-cli.js | 8`; rodar o glob literal executa 3 arquivos (22 testes). O 8 vale só para o arquivo do terceiro. Sugerir "(arquivo do terceiro)" ou o número de testes por glob.

## Reconferência rodada 1 (673650eb)
Veredito: APROVADO. Todos os achados anteriores resolvidos ou aceitos. Diff 64d28cdc..673650eb: recibo + 3 arquivos de teste; nenhum arquivo de tools/ ou packages/; requirements.json intacto; sem trailer de IA; árvore limpa; recibo com 0 ocorrências do fornecedor.
1. I7 claude-agent-sdk: os 2 casos novos testam o binding de fato. Mutações (cópia descartável, removida): budget_microusd x2 e cost_microusd null->100 derrubam `claude native ... SDK budget cap`; remover a recusa cost_over_request_limit derruba `claude/api receipt above the metered reservation` (e os 3 de custo zero). OK.
2. I5 tool-free "N/A como login": verdadeiro no código. A composição só admite `apiKeyEnv === TERCEIRO_API_KEY` (packages/runtime-providers/*-acp-composition.js:57) e o runtime delegado não tem login nem expiração de sessão; o ACP_IDENTITY_EXPIRED do provider-acp-worker pertence ao binding ACP do Codex, não a este. O equivalente (segredo ausente, sem lançamento) é o novo teste de ambiente. OK.
3. Asserts decorativos do Antigravity removidos (3 linhas sobre m.billing/credential); os reais seguem derrubando (M3-M5 da rodada anterior).
4. Globs `d*`: `test-delegated-d*-cli.js` e `test-d*-acp-composition.js` casam 1 arquivo cada. Contagem: 9+37+23+24+12+18+13+8+16+10+12 = 182; casos novos 17 (15+2). Bate com o recibo (37, 23, 12, 18, 13, 8).
5. `.strict()` isolado: com o digest re-fixado, `.passthrough()` no schema nativo derruba os dois `native ... ambient` (codex e claude) e no claude-account derruba `claude account ... ambient`. OK (M1/M8 anteriores resolvidos).
6. Adendo no recibo: a nota do cabeçalho agora cobre a troca do termo dentro dos títulos (`third-party`/`terceiro`, com exemplos e como rastrear) e a linha de execução `test-delegated-d*-cli.js | 8` é coerente com o glob de 1 arquivo. Confirmado.
7. Execução via cg.sh: os 11 arquivos + neutralidade (2/2) exit 0, 0 fail, total 182/182; verify --shards 6 OK (102 items, 235 test files); eslint --max-warnings=0 e prettier --check limpos.
Resíduo informativo: o log do executor ainda pode citar contagem de mutações antiga (11 vs 14); sem efeito.

## Reconferência do SHA 104e2ab1 (amend do adendo)
Diff 673650eb..104e2ab1: 1 linha do recibo (a nota do cabeçalho com a troca do termo nos títulos), nada mais. Testes e produção idênticos; as execuções e mutações da rodada 1 (182/182, verify, eslint) continuam válidas. Recibo com 0 ocorrências do fornecedor; prettier limpo; neutralidade 2/2; sem trailer de IA; árvore limpa; escopo inalterado (6 testes + recibo). Veredito: APROVADO.

# R-D8b: revisão cética da task od-d8b-account-digest (commit f29f1979)

Veredito: **FAIL** (1 bloqueante de CI, 1 defeito real de concorrência na criação da chave). Revisor só reporta.

## Achados
| # | Sev | Local | Descrição / reprodução |
|---|-----|-------|------------------------|
| F1 | BLOQUEANTE | package.json (scripts.test) | `test/test-account-digest-v2.js` não é referenciado por nenhum script. `node .github/scripts/ci-test-shards.mjs verify --shards 6` => `FAIL not run by any suite step: test/test-account-digest-v2.js`. Falta incluir em `test:provider-control` (package.json:170). |
| F2 | ALTA | tools/cli/lib/campaign-evidence-store.js:~230-262 (`accountKey`) | Corrida na criação da chave: `read()` exige `stat.nlink === 1`, mas entre `linkSync(temporary, file)` e o `rmSync(temporary)` o arquivo tem nlink 2. Um segundo processo (primeiro `read()` ou o `read()` do perdedor após EEXIST) falha com `CONTROL_PROVIDER_CONFIGURATION_INVALID` num estado válido. Reprodução determinística: criar a chave, `ln key .tmp-x`, chamar `accountDigest` => ERR. Reprodução por corrida real: 60 rodadas x 8 processos simultâneos em state novo (script em /build/tmp/rev-d8b/race.js), 1 rodada com ERR; digests nunca divergiram entre os que tiveram sucesso. Ou seja, o vencedor não diverge, mas o perdedor pode falhar espúrio na primeira subida. Nenhum teste cobre concorrência. |
| F3 | BAIXA | accountKey | `state` inexistente: `openSync` lança ENOENT cru (não `CONTROL_PROVIDER_CONFIGURATION_INVALID`). Não vaza a chave. |
| F4 | INFO | spec/lead | `campaign-evidence-store.js` e `provider-claude-account-*` NÃO estão em `.c8-kernel.json` (só native, acp-adapter/worker, control-manifest, campaign-control, codex-acp-peer). Medi todos mesmo assim. |
| F5 | INFO | testes | O teste de v1 legível usa o helper sintético (`'c'.repeat(64)`); nenhum teste lê fixture antiga real. Verifiquei por fora: `docs/evolution/w3/evidence/{acp-campaign,live-revalidation,claude-verified}/*manifest.json` (v1 reais) passam em `parseProviderControlManifest` do commit e da base. |

## Itens
1. Chave: 32 bytes, 0600 (open O_EXCL 0o600 + fchmod + fsync + link), em `<state>/account-digest.key`, recusa não-regular/nlink/size/permissão (mutação A confirma o teste). Perdedor lê a chave do vencedor (EEXIST), mas ver F2. Não aparece em receipt/evento/stdout/stderr (teste do worker sobre stdout/stderr; código não loga). **PASS-WITH-NOTES (F2, F3)**.
2. HMAC com propósito (`hseos-campaign-account:account-digest:v2`, duas camadas); sha256 de dicionário não reproduz (teste). **PASS**.
3. v1 legível: schema aceita `account_sha256` ou `account_digest` (um só formato), nada reescrito; fixtures reais parseiam (F5). **PASS**.
4. v1 vs v2 nunca igual (`sameAccount`; inclusive mesmo hex, testado). ACP worker e `codex-acp-peer` comparam v2 dos dois lados. **PASS**.
5. Chamadores de produção: única composição é `tools/cli/commands/control.js:27-37` -> `control-configuration.js:108` passa `state: result.state` a todas as factories; `provider-acp-adapter.js:64-76` repassa `state` ao nativo. Nenhum outro chamador em tools/packages. **PASS**.
6. Registro em `scripts.test`: **FAIL** (F1).
7. Mutações (cópia em /build/tmp/rev-d8b/mut, removida): A) remover checagem de modo 0600 => derrubou "the installation key is 32 random bytes, 0600..." (38 pass/1 fail). B) `sameAccount` aceitando v1==v2 por valor => derrubou 2 testes ("v1 stays readable..." e "a v2 account digest dispatches only on equal v2"). **PASS**.
8. Verdes no cgroup (contagem literal): grupo A (account-digest-v2, acp-campaign-boundaries, codex-acp-peer, claude-account-process, provider-control-manifest, claude-account-adapter) 54/54; grupo B (provider-campaign-control, provider-campaign-adapters) 51/51; test-campaign-evidence 25/25; package-surface 1/1. **PASS**.
9. c8 (10 arquivos de teste, cgroup, 139/139 verdes), stmts/branch: codex-acp-peer 100/98.8; campaign-evidence-store 94.5/87.2; provider-acp-adapter 100/97.1; provider-acp-worker 95.9/96.8; provider-campaign-control 96.4/92.1; claude-account-adapter 100/90.9; claude-account-worker 100/90.2; native-adapter 100/84; **provider-control-manifest 92.1/75.6 (branch <80 nesta amostra parcial; o gate real roda a suíte kernel inteira, não medi; verificar)**. Testes antigos: só migrados ao novo formato, nenhuma asserção removida ou afrouxada (asserts de account_sha256 viraram deepEqual de account_digest + `account_sha256 === null`). eslint 0 erros nos 18 .js; prettier ok; G3 ok (nenhum arquivo novo em tools/packages); commit sem atribuição de IA. docs/v4-migration.md documenta v2, v1, local da chave, perda de chave, mudança de contrato. `docs/engineering-control-api.md` não cita account_sha256. **PASS-WITH-NOTES**.

## Alegação -> veredito
| Alegação do executor | Resultado |
|---|---|
| `account_digest {v:2,alg,value}` irmão de `account_sha256` | Confirmada (schema manifest e observation) |
| Chave em `<state>/account-digest.key` | Confirmada |
| `CONTROL_PROVIDER_IDENTITY_UNVERIFIED` em mistura | Confirmada (control, ACP adapter; worker ACP usa ACP_IDENTITY_EXPIRED, worker claude IDENTITY) |
| Criação atômica sem corrida | **Refutada em parte**: sem divergência de chave, mas o perdedor pode falhar por nlink (F2) |
| Verdes 102/102 e 126/126 | Não reproduzível em contagem idêntica (agrupamento diferente); meus grupos 54+51+25 = 130 verdes, 0 falhas |
| Vermelho por `accountDigest is not a function` | Não verificável sem a base com os testes; plausível, sem contagem |
| Suíte entra na CI | **Refutada** (F1) |

## Reconferência acdaae93
Veredito: **PASS-WITH-NOTES**.
1. `ci-test-shards verify --shards 6`: `OK 102 items ... 230 test files each run by a suite step`; `test-account-digest-v2.js` está em `test:provider-control`. PASS.
2. Corrida: 80 rodadas x 8 processos em state novo: 0 erros, 0 divergência de digest. Hardlink persistente (`ln key .tmp-x`): recusado (`CONTROL_PROVIDER_CONFIGURATION_INVALID`) após ≤200 ms. Link removido aos ~50 ms: aceito. Tipo/tamanho/0600 seguem estritos e são checados a cada iteração. Nota: um hardlink adulterado que some dentro do prazo é aceito; aceitável, pois exige escrita no state (já é a fronteira de confiança) e o conteúdo/modo ainda são validados. Resíduo teórico: `lstat` e `readFileSync` não são atômicos (TOCTOU), igual à versão anterior. PASS.
3. `state` inexistente e `state` arquivo: `CONTROL_PROVIDER_CONFIGURATION_INVALID`, sem caminho na mensagem. PASS.
4. c8 com os 14 arquivos de teste que citam o manifesto/evidence-store (196/196 verdes, cgroup): `provider-control-manifest.js` 100/100 (stmts/branch); `campaign-evidence-store.js` 96,6/94,1. PASS.
eslint e prettier nos .js do commit: ok.

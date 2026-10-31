# D8b — Digest de conta com sal, formato versionado v2 (item 8b)

Leia primeiro e siga: /workspace/github/marciohideaki/enterprise-hseos/.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/COMMON.md

- Worktree: /workspace/github/marciohideaki/enterprise-hseos/.worktrees/od-d8b-account-digest
- Branch: `task/od-d8b-account-digest`
- Feature: `feature/owner-decisions-w3`, empilhada sobre a W2 (já contém a retenção da D8a)
- Task id: `od-d8b-account-digest`
- Tier: medium, escalado por tratar de privacidade
- G3: só edições em arquivos existentes de `tools/` e `packages/`

## Problema
O digest de conta é `sha256(canonicalJson(identity))`, sem sal (`engineeringDigest`, `tools/cli/lib/engineering-task-state.js:10`). Ele é persistido em receipts e manifestos:
- `tools/cli/lib/provider-claude-account-worker.js:30` → `account_sha256: engineeringDigest(identity)`; identity = `{authMethod, email, orgId, subscriptionType, ...}`;
- `tools/cli/lib/provider-native-adapter.js:~185` → `account_sha256: engineeringDigest({ type: 'chatgpt', email })`;
- o ACP compara `request.inspection.account_sha256 !== request.account_sha256` (`provider-acp-worker.js:~25`) e repassa ao peer (`:~46`).

E-mail tem pouca entropia. Quem lê o manifesto confirma, por dicionário, se um e-mail conhecido é a conta. Os achados são o resíduo da revalidação de 2026-10 e o MAPA §4.

## Decisão do owner (2026-10-30)
Digest com sal e formato versionado. O design já está decidido:

- **v2 = HMAC-SHA256 com chave por instalação.** Gerada com 32 bytes aleatórios na primeira necessidade, guardada no estado de controle local com permissão 0600. Use o mesmo diretório de estado que o store de evidência e o controle de campanha usam (`state` em `provider-campaign-control.js`/`campaign-evidence-store.js`). Escrita atômica: temporário exclusivo + rename. Nunca loga a chave nem a põe em receipt. Siga o padrão de derivação por propósito de `tools/lib/mcp-2026-adapter.js:83` (`createHmac(...).update('hseos-...:<purpose>:v2')`).
- **Formato serializado:** `account_digest: { v: 2, alg: 'hmac-sha256', value: '<hex>' }`, ou um campo `account_sha256_v2`. Escolha o que preservar a leitura dos receipts antigos sem reescrevê-los e justifique.
- **v1 continua legível:** receipts antigos com `account_sha256` sem sal continuam válidos para leitura e auditoria. Não reescreva eventos nem receipts antigos. Novos registros saem só em v2.
- **Comparações** (o `inspection` contra o `request` do ACP e qualquer outra) usam o mesmo formato dos dois lados. Na transição, v1 contra v2 nunca é igual; trate como "conta não verificável", nunca como igual.
- **Chave perdida ou rotacionada:** os v2 antigos deixam de ser verificáveis contra contas novas. Registre esse comportamento como explícito na doc. Não há rotação automática.
- **Schemas:** se os schemas Zod/JSON de receipt validam `account_sha256`, aceitam v2 e mantêm v1. Procure com `BYPASS_AXON=1 rg -n "account_sha256" tools packages test`.

## Testes (vermelho primeiro)
- O mesmo e-mail em duas instalações, com chaves diferentes, gera digests diferentes.
- Na mesma instalação, o digest é estável.
- Sem a chave, um dicionário de e-mails não reproduz o v2. O teste calcula o `sha256` simples e mostra que não bate.
- A chave é criada com 0600 e não aparece no receipt, no evento nem no stderr.
- Um receipt v1 antigo, de fixture, continua legível.
- A comparação do ACP (`provider-acp-worker`) recusa quando as contas diferem e aceita quando são iguais, em v2.
- v1 contra v2 nunca é igual.
- Mutação descartável: digest sem chave (sha256 puro) derruba um teste; comparação v1 = v2 aceita derruba outro.

## Docs
- `docs/v4-migration.md`: digest de conta v2 com sal, v1 legível, local da chave e efeito de perdê-la.
- Se `docs/engineering-control-api.md` documenta `account_sha256`, atualize.

## Critérios de aceite
- Verdes, com contagem literal, no cgroup via `cg.sh`:
  - `test/test-claude-account-process.js`;
  - `test/test-provider-campaign-adapters.js`, `test/test-provider-campaign-control.js`;
  - `test/test-acp-campaign-boundaries.js`;
  - testes do adapter nativo e do worker ACP (`rg -l "provider-native-adapter|provider-acp-worker|claude-account" test/`);
  - `test/test-campaign-evidence.js` (só no cgroup).
- c8 ≥90/80 nos arquivos do kernel tocados; registre os números.
- `package-surface`, eslint e prettier.
- 1 commit: `feat(campaign): salt the account digest with a per-install key (v2), keep v1 readable` (≤100 chars).

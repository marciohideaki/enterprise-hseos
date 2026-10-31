# D8a — Retenção de 90 dias da saída dos adapters de campanha (item 8a)

Leia primeiro e siga: /workspace/github/marciohideaki/enterprise-hseos/.hseos/runs/dev-squad/20261030-1810-owner-decisions/prompts/COMMON.md

- Worktree: /workspace/github/marciohideaki/enterprise-hseos/.worktrees/od-d8a-retention
- Branch: `task/od-d8a-retention`, feature `feature/owner-decisions-w2`
- Task id: `od-d8a-retention`
- Tier: large, escalado por tocar retenção de dados
- G3: só edições em arquivos existentes de `tools/` e `packages/`

## Decisão do owner (2026-10-30)
A saída de modelo dos adapters de campanha é retida por **90 dias**, com expurgo do que vencer. A auditoria registrou como aberto que os adapters API, ACP e local não retêm a saída.

## Estado atual
- `tools/cli/lib/campaign-evidence-store.js`:
  - :3-11 é o contrato do `adapter.run()`. Na retenção, o receipt leva `evidence_ref {schema_version:1, kind:'model_output', sha256, bytes}` e o retorno leva `output_text`. Na não-retenção, leva `evidence_withheld`.
  - `storeEvidence` (:210) grava por endereçamento de conteúdo em `<state>/campaign-evidence/<sha256>`, com 0600, fsync e rename.
  - Quando o conteúdo é o mesmo, `storeEvidence` retorna cedo sem tocar no arquivo.
  - `readEvidence` está em :263.
  - Não existe prazo nem expurgo.
- `tools/cli/lib/provider-native-adapter.js` (`retainOutput` :59, uso :233) e `provider-claude-account-adapter.js:207` já retêm.
- `tools/cli/lib/provider-api-adapter.js` só acumula digest e bytes (`output.update(text)`, ~:198-204). Não retém.
- `tools/cli/lib/provider-acp-adapter.js` não retém.
- "Local": identifique qual adapter é. Candidatos: antigravity local (`provider-antigravity-adapter.js`) e o worker ACP. Liste todos os `provider-*-adapter.js` e diga, para cada um, se passa a reter ou por que não pode.
- O consumidor é `tools/cli/lib/provider-campaign-control.js`:
  - :65-70: receipts anteriores à retenção continuam legíveis; não-retenção declarada responde `CONTROL_CAMPAIGN_EVIDENCE_WITHHELD`.
  - Veja como a evidência é lida e servida.

## Entregas
1. **Retenção nos adapters que não retêm (API, ACP e o "local").**
   - Seguir o mesmo contrato do nativo: `evidence_ref` + `output_text`, com as mesmas verificações de credencial e tamanho (`MAX_EVIDENCE_BYTES`) e `evidence_withheld` nos casos de recusa.
   - Reutilizar `retainOutput` ou o helper equivalente, sem duplicar a lógica.
   - Se um adapter não tiver acesso ao texto da saída, declarar `evidence_withheld` com um motivo novo e explícito (ex.: `not_observable`) e documentar. Não inventar retenção.
2. **Prazo de 90 dias no store.**
   - Constante única `EVIDENCE_RETENTION_DAYS = 90`.
   - `pruneEvidence(state, { now })` remove os artefatos cujo `mtime` passou de 90 dias e também os `.tmp-*` órfãos com mais de 1 dia. Cuidado com links e diretórios: só arquivos regulares do diretório do store.
   - Quando `storeEvidence` encontra o mesmo conteúdo, renova o `mtime` (`fs.utimesSync`), para que reter de novo estenda o prazo.
   - `readEvidence` de artefato expurgado responde um código explícito e estável, ex. `CONTROL_CAMPAIGN_EVIDENCE_EXPIRED`, diferente de corrompido e de indisponível. Para distinguir, use o receipt: se o receipt tiver data de registro mais antiga que 90 dias e o arquivo não existir, é expirado.
   - Ligar o expurgo a um ponto real de execução: oportunisticamente em `storeEvidence` (no máximo 1 vez por processo ou por intervalo) e/ou no início de uma campanha em `provider-campaign-control.js`. Não pode virar código morto.
   - Relógio injetável para os testes.
3. **Testes**, com o vermelho registrado antes:
   - 89 dias fica; 91 dias sai;
   - reter de novo renova o prazo;
   - `.tmp-*` antigo sai;
   - symlink e diretório no store não são seguidos nem apagados indevidamente;
   - leitura de expirado devolve o código novo;
   - API e ACP (e o "local", se aplicável) retêm a saída e a recusam com credencial;
   - o expurgo é chamado no caminho real, provado por teste.

   Mutação descartável: prazo `Infinity` e ausência da chamada do expurgo, cada uma tem que derrubar um teste.
4. **Docs.**
   - Uma linha em `docs/v4-migration.md` (seção de campanhas, ou nova seção curta): evidência retida por 90 dias, código de expirado e adapters que passam a reter.
   - O comentário de contrato em `campaign-evidence-store.js:3-11`.

## Critérios de aceite
- Verdes, com contagem literal, todos no cgroup via `cg.sh`:
  - `test/test-campaign-evidence.js` (não rode fora do cgroup: pendura);
  - `test/test-provider-campaign-adapters.js`, `test/test-provider-campaign-control.js`, `test/test-provider-campaign-runner.js`;
  - `test/test-provider-api-adapter.js`;
  - os testes de ACP (`rg -l provider-acp test/`);
  - `test/test-campaign-key-body-redaction.js`.
- c8 dos arquivos do kernel tocados ≥90/80, com os números (`provider-*`, `campaign-*`, `provider-api-adapter` etc. estão no `.c8-kernel.json`).
- `package-surface`, eslint e prettier ok.
- 1 commit: `feat(campaign): retain adapter output for 90 days and prune expired evidence` (≤100 chars).

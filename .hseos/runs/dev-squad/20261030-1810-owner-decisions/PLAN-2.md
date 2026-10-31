<!-- G2 rodada 2: aprovado pelo owner em 2026-10-30 -->
# Plano 2 — decisões do owner de 2026-10-30 (segunda rodada)

## Context
As decisões dos itens 1–8 do owner viraram as ondas W1–W3 da run `20261030-1810-owner-decisions`. A W1 está na PR #258. A W2 e a W3 estão integradas, com as suítes em reexecução depois da rodada 2 da D7.

Depois disso, o owner respondeu às 16 decisões restantes. Este plano executa essas respostas na mesma run, como ondas W4 a W7.

## Decisões a executar (owner, 2026-10-30)

| # | Decisão | Execução |
|---|---|---|
| M | Merge das 3 PRs autorizado | W1 → W2 → W3, cada uma com suíte local e CI verdes, squash com corpo limpo. Tags e CI completo na master |
| A1 | Aceitar os itens 5, 11 e 16 | Bloco "Aceites do owner (2026-10-30)" no `w5/STATUS.md` |
| A2 | Item 15: retry no CI | Retry com backoff no `apt-get` e no provisionamento do toolchain no `ci.yaml` |
| A3 | Item 4 e A-05: corrigir | Redação cobre corpos de chave de 2 a 4 linhas e PKCS8 cifrado, com controles negativos. O aceite fica só para o que não for seguro corrigir |
| A4 | Item 19: aceitar e abrir task | Aceite registrado. Task: recusar a aprovação de `computer.*` quando o cliente não declarar suporte a imagem |
| A5 | Item 23: confirmar e registrar | Decisão de 2026-10-21 confirmada no bloco de aceites e no runbook `activation.md` |
| A6 | F19 e F20: ler o `project.db` | Leitura somente leitura (`immutable=1`) do banco real do enterprise-hseos. Só promove com evidência |
| A7 | ADR-0049 | Fica Proposed. As 14 questões seguem com o owner |
| A8 | N-1 | Mensagens `EXECUTION_ACTIVATION_*` sem caminho no fio |
| A9 | A-15 | `init` e `uninstall` sob o lock de install |
| A10 | A-09 | Adapters MCP e índices de F17/F18/F21/F22 no gate c8, com testes até 90/80 |
| A11 | Aviso no c8 | O runner indica "segmento não executado" quando a cadeia do `test:kernel` é interrompida. Gate e limiares intactos |
| A12 | A-18 | Depois dos merges: reinstalar a distribuição global no SHA final, com verificação de hash e rollback documentado, e corrigir o pin no `AGENTS.md` global |
| A13 | A-17 | Remover a linha de atribuição dos corpos das PRs #186–#195 e #197 (`gh pr edit`) |
| A14 | Sunset | Sem data (ADR-0048). Registro da decisão |
| A15 | W9 | Remover só worktrees cujo conteúdo esteja comprovadamente na master e sem mudança não commitada. Os demais ficam |
| A16 | G3 | O teto sobe pelo número medido no fechamento da onda que precisar de arquivo novo. Registro da decisão |
| A17 | Bindings | Redigir o critério de certificação de binding (F08/F17/F18) e da quarta família como **proposta** (ADR Proposed), sem rodar nada pago |
| A18 | Codex | Exercitar `tools/call` e a aprovação MRTR com cliente Codex real, **teto de US$ 2**. Exige login do owner (`! codex login`) e autorização de campanha com binding, escopo e teto |
| A19 | g9 | Alinhar o gate `g9-zero-legacy-window` ao critério aceito do ADR-0048, sem afrouxar |

## Execution Protocol
- **Coordenação:** `dev-squad`/SWARM na mesma run.
  - Commander: Opus.
  - Executores: Sonnet, 1 por task, em worktree próprio.
  - Revisor cético: Sonnet, em duas passagens, até 3 rodadas.
- **Invariantes:** valem os mesmos do plano 1:
  - 1 task = 1 commit, feito via `cg.sh`;
  - sem atribuição de IA e sem `--no-verify`;
  - G3: arquivo novo em `tools/` ou `packages/` só com o teto elevado pelo número medido, decisão A16;
  - c8 90/80, branch protection e recibos intactos;
  - scratch em `$TMPDIR`; no máximo 3 executores simultâneos; uma suíte completa por vez;
  - `project.db` real só em leitura `immutable=1`;
  - `~/.local/state/hseos` e a distribuição global só mudam no passo A12, com backup.
- **Gates humanos:**
  - G2: aprovação deste plano.
  - Merges das ondas novas: o owner autorizou só as 3 PRs atuais. As PRs das ondas W4–W7 pedem autorização própria.
  - A18 exige o login do owner e confirmação do teto no momento.
- **Versionamento:**
  - `feature/owner-decisions-w4..w7` a partir da master, depois dos merges das PRs atuais;
  - 1 PR por onda;
  - tags `hseos-owner-decisions-w<k>` após cada merge;
  - MAPA §8 e STATUS da run atualizados por onda.

| Onda | Tasks | Tier |
|---|---|---|
| M | Merges #258 → W2 → W3, com resolução do conflito de uma linha no MAPA ao atualizar a W3; tags; CI completo; A13 (edição dos corpos de PR) | Commander |
| W4 | E1 bloco de aceites, runbook e registros (A1, A4, A5, A7, A14, A16) · E2 retry no CI e aviso de segmento no c8 (A2, A11) · E3 N-1 e lock em `init`/`uninstall` (A8, A9) | small · medium · medium |
| W5 | E4 redação de 2 a 4 linhas e PKCS8 cifrado (A3) · E5 recusa de `computer.*` sem suporte a imagem (A4) · E6 g9 alinhado ao ADR-0048 (A19) | large (+1 segurança) · medium · medium |
| W6 | E7 resto do c8 (A10) · E8 critério de bindings, ADR Proposed (A17) · E9 F19/F20 pelo `project.db` em leitura (A6) | large · medium · medium |
| W7 | A12 reinstalação global e pin · A15 higiene W9 · A18 Codex real (US$ 2, com login do owner) | Commander, com o owner presente |
| Fim | Reauditoria curta dos itens afetados; MAPA §8; `/end-session` | Commander |

## Verificação
- Por task: teste vermelho antes, mutação morta, eslint, prettier, G3 e c8 dos arquivos tocados.
- Por onda: suíte completa no cgroup, `verify --shards 6` e checkers de mutação.
- A12: hash do tarball conferido; `hseos --version` e o lock presente no global; rollback testado em diretório descartável.
- A18: recibo da campanha com o custo real, que precisa ficar ≤ US$ 2; `tools/call` e MRTR provados com cliente real logado; nada além do teto.

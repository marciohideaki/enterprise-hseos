# PLAN-3 — Onda W9: decisões do owner de 2026-10-31

## Contexto
O owner respondeu às decisões abertas (a)–(e), ao caminho do MRTR e às 12 questões do ADR-0050. A resposta "Nova onda agora" aprova este plano (G2). A run é a mesma, `20261030-1810-owner-decisions`.

## Decisões (owner, 2026-10-31)
| # | Decisão | Execução |
|---|---|---|
| (a) | Janela supervisionada: JSON do operador (`operator`, `stopped_consumers[]`, `original_sha256_before`, `recorded_at` anterior a `started_at`), ao lado do recibo | O formato já é verificado por `windowReason`, desde o E6. F1 documenta o formato e faz o `apply` validá-lo |
| (b) | O `apply` grava a referência da janela no recibo | F1: `window: {path, sha256}` no recibo, com versão nova do formato; recibos antigos continuam legíveis; o gate cruza recibo e janela |
| (c) | Flags `--activation-db/--activation-receipt/--activation-window/--activation-adr` no `agent-provider-validate` | F2 |
| (d) | Override de computer-use em produção | **Mantido desligado.** Só registro |
| (e) | F19 com escopo reduzido | **Não reduzir.** A F19 segue `not_authorized`. Só registro |
| MRTR | Sondar se o Claude Code ou outro cliente instalado negocia `2026-07-28` | Commander, sem gasto relevante |
| ADR-0050 | 12 respostas e aceite | F3: ADR `Accepted — 2026-10-31`, respostas registradas, valor novo `verified_api_campaign_scope_only` em `real_consumers` (Q9), com guard e testes |
| Dist. | Reinstalar a distribuição global no SHA final | Commander, depois do merge da W9, com o mesmo procedimento da A12 |

### Respostas do ADR-0050
1. Validade do recibo de L2: 90 dias, além dos gatilhos por mudança.
2. Teto padrão da quarta família: 4 requisições, US$ 1,00 (1.000.000 µUSD), janela de até 45 min. Uma autorização pode fixar valor menor, mas nunca maior sem decisão nova.
3. Quarta família: API Gemini direta, com chave própria da Hideaki Serviços no `pass` (`google/gemini-hseos`). A chave da NB Eventos fica proibida.
4. Literal de `deterministic`: `verified_w<N>_scope_only`, com N sendo a onda em que a prova de L1 for feita.
5. `operational` de L3: usa o `pilot_enterprise_hseos_only` existente, com `operational_evidence`.
6. O teto de US$ 2 de `tools/call` e MRTR vale por campanha, sem herdar saldo.
7. O L2 da F17 vale só para os bindings que o PLAN de evolução nomeia como oficiais.
8. A quarta família fica liberada para planejamento depois do aceite deste ADR e com a chave no `pass`. A execução pede autorização própria por campanha.
9. Novo valor de `real_consumers`: `verified_api_campaign_scope_only`. Exige recibo de campanha L2, custo real ≤ teto e credencial comprovada.
10. Rota de assinatura: avaliada e registrada antes de pedir chave de API (é a regra 7 dos pré-requisitos).
11. L2 padrão = `tools/call` + MRTR. Se o cliente não fala `2026-07-28`, o binding fica em L2 parcial, com `tools/call` provado e MRTR bloqueado por protocolo, e não avança além disso.
12. L2 da F17: geração real com recuperação de contexto, sem `tools/call`.

## Execution Protocol
- **Coordenação:** `dev-squad`/SWARM na mesma run.
  - Commander: Opus. Faz o plano, a integração, a sondagem MRTR e a reinstalação.
  - Executores: Sonnet, 1 por task, cada um em worktree próprio.
  - Revisor cético: Sonnet isolado, em duas passagens; reporta e não corrige.
  - No máximo 3 rodadas de correção por task.
- **Invariantes de governança:**
  - Worktree por task, via `worktree-manager.sh create`.
  - 1 task = 1 commit, com hook ativo, sem `--no-verify` e sem stash.
  - Sem atribuição de IA.
  - G3 sem folga: nenhum arquivo novo em `tools/` ou `packages/`.
  - c8 90/80 e gates nunca afrouxados; bloqueio vira BLOCKED, nunca PASS.
  - Scratch em `$TMPDIR`.
  - Carga pesada passa por `cg.sh` ou `heavy-run`; no máximo 2 executores buildando ao mesmo tempo; a suíte completa roda uma vez, pelo Commander.
  - Recibos históricos não são reescritos.
  - O banco real `project.db` nunca é aberto pelos executores.
- **Gates humanos:**
  - G2: aprovado pelo owner ("Nova onda agora").
  - Merge da PR da W9 com CI verde, autorizado na mesma resposta.
  - Reinstalação global depois do merge, também autorizada ("Nova onda agora", opção com reinstalação).
- **Versionamento:**
  - `feature/owner-decisions-w9` a partir de `88db0f11`;
  - 1 PR;
  - tag `hseos-owner-decisions-w9`;
  - MAPA §8 e STATUS atualizados no F3 e no fechamento.

| Task | Escopo | Executor | Tier |
|---|---|---|---|
| F1 | (a)+(b): o `apply` valida a janela e grava `window` no recibo; o gate cruza recibo e janela; documentação do formato | Sonnet | large (+1, integridade da ativação) |
| F2 | (c): flags no `agent-provider-validate` e manifesto da CLI | Sonnet | medium |
| F3 | ADR-0050 aceito, vocabulário Q9, registro de (d)/(e)/MRTR e destas decisões | Sonnet | medium |

## Verificação
- **Por task:** teste vermelho antes, mutação dirigida morta, eslint, prettier, G3 e c8 dos arquivos tocados.
- **Por onda:** suíte completa no cgroup, `verify --shards 6` e os checkers W4/W5.
- **Reinstalação:** mesmo procedimento e recibo da A12.

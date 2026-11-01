# PLAN-4: fechamento integral de W0–W5 antes da W6 canônica

## Contexto
O owner decidiu, em 2026-10-31, "fechar tudo o que nos propusemos de requisitos anteriores à W6", com o escopo "Tudo de W0–W5, inclusive L2 pago".

A fonte das pendências é `docs/evolution/PLAN.md` §"Pendências antes de abrir a W6", e o levantamento foi feito em 2026-10-31 sobre `requirements.json`, o MAPA e o ADR-0050. Das 6 pendências do PLAN, 3 estão fechadas. Seguem abertas:
- consumidor real de F14, F15 e F20;
- dívida 18;
- A-20.

Além disso, as próprias ondas W0–W5 têm lacunas:
- F23 em `not_verified_for_evolution`;
- F08, F17 e F18 sem L1 nem L2 sob o ADR-0050;
- quarta família (Gemini) não exercida;
- F02–F06, F09, F10, F12, F13 e F22 com `real_consumers: not_verified`.

Decisões do owner (2026-10-31):
- **Escopo:** todo o W0–W5, inclusive L2 pago.
- **F14/F15:** Claude Code e Codex pela assinatura.
- **Dívida 18:** fechar no código.
- **Execução:** dev-squad com este plano; merge a cada CI verde.
- **L2:** vale para **todos os bindings declarados** (claude-agent-sdk, codex-app-server, o binding ACP de terceiro (`*-acp`), o binding ACP de terceiro sem ferramentas (`*-acp-tool-free`) e openai-compatible), mais Antigravity e a quarta família Gemini.
- **F20:** promovida com escopo declarado (memory.* e a superfície de governança); environment.* fica completado por uma campanha curta.
- **F02–F13/F22:** uma campanha agregada de `agent run` real, que promove o que o recibo cobrir.

**Bloqueio externo:** a chave `google/gemini-hseos` não existe no `pass` (verificado em 2026-10-31). Sem ela, a C6 fica BLOCKED.

## Execution Protocol
- **Modelo de coordenação.**
  - Usa a skill `dev-squad` sob SWARM (ADR-0015), numa run nova: `.hseos/runs/dev-squad/20261101-pre-w6-closeout/`.
  - O Commander é esta sessão, em Opus: planeja, integra, autoriza a mudança de status (ADR-0050:97) e opera as campanhas.
  - Os executores são Sonnet, 1 por task, cada um no seu worktree.
  - O revisor cético é um Sonnet isolado por task. Trabalha em duas passagens, cega e depois em confronto. Reporta e não corrige.
  - No máximo 3 rodadas de correção por task.
- **Invariantes de governança.**
  - Worktree via `worktree-manager.sh create`.
  - 1 task = 1 commit, com o hook ativo (PATH do Node 24 exportado antes), sem `--no-verify` e sem stash.
  - Sem atribuição de IA, sem nome de fornecedor de modelo na mensagem de commit e sem Co-Authored-By.
  - G3 sem folga. Arquivo novo só em `test/`, `docs/` e `.agents/activation/provider-bindings/`. Um arquivo novo em `tools/` ou `packages/` exige elevar o teto pelo número medido no fechamento da onda (decisão A16), registrada no STATUS.
  - c8 90/80 e gates nunca afrouxados. Um bloqueio vira BLOCKED, nunca PASS.
  - Recibos históricos não são reescritos.
  - Scratch em `$TMPDIR`.
  - `cg.sh`/`heavy-run`, com no máximo 2 executores buildando ao mesmo tempo. A suíte completa roda só pelo Commander, uma vez por onda.
  - O `project.db` real nunca é aberto pelos executores. As campanhas usam cópia instantânea.
  - Credenciais só via `pass`, nunca em artefato. Cada recibo de campanha passa por varredura de segredos.
- **Gates humanos.**
  - G2: aprovado ("dev-squad com PLAN-4, merge com CI verde").
  - Merge de cada PR de onda com CI verde: autorizado.
  - **Cada campanha da WC exige confirmação do owner no ato**, com binding, escopo, teto, validade e `task_ids` (ADR-0050 §3, Q6).
  - Uma campanha com custo real acima do teto aborta e vira FAIL.
  - Status de família só muda pelo Commander, no fechamento de onda, com evidência resolvível pelo guard.
- **Versionamento.**
  - `feature/pre-w6-w<k>`, 1 PR por onda e tag `hseos-pre-w6-w<k>`.
  - STATUS da run e MAPA §9, "Fechamento pré-W6", atualizados por onda.
  - Reinstalação da distribuição global no fim (procedimento da A12, `dist-window.sh`).

| Onda | Tasks | Tier | Gasto |
|---|---|---|---|
| WA | A1 L1 F08/F18 (testes nomeados: env sobreposta, cobrança silenciosa, backend efetivo e precedência), com recibo; A2 L1 F17 (declarações versionadas dos bindings de modelo e exceção auditada de cota); A3 guard de `deterministic` (literal `verified_w<N>_scope_only` exige evidência); A4 F23 (sonda por superfície em `tools/`, evidência c8 e mutação); A5 dívida 18 no código; A6 A-20 (rastro promessa→teste legível por máquina para W3/W4, com guard); A7 runbook da quarta família ao ADR-0050 e binding Gemini L0 | M, M, S, M, M, M, S | não |
| WB | B1 adapter de campanha Gemini, entrada de vendor e testes L1; B2 `compaction_runtime` ligado a um perfil de `agent run`, com resume/fork pela CLI (habilitador da F15); B3 jornada F14 (memória recuperada entra no contexto montado, com proveniência no recibo); B4 religar `openai-compatible` (endpoint e credencial declarados) e lançamento delegado do servidor MCP para `environment.*` | L, L, M, M | não |
| WC | C1 Codex conta (recertificação 0.166.0); C2 Claude conta; C3 Claude API; C4 ACP de terceiro e tool-free; C5 OpenAI-compatible; C6 Gemini (quarta família; BLOCKED sem chave); C7 Antigravity (recertificação); C8 F14 real; C9 F15 real (compactação+crash+resume+fork contra histórico integral); C10 campanha agregada F02–F06/F09/F10/F12/F13/F22; C11 environment.lsp com cliente real (F20) | Commander + revisor por campanha | sim: conta = cota de assinatura; API ≤ US$ 1 e ≤ 4 req por campanha (ADR-0050 Q2), salvo o owner fixar menos |
| WD | Promoções de status (Commander), reauditoria cética focada no fechamento pré-W6, `PLAN.md` §"Pendências antes de abrir a W6" zerada ou com BLOCKED explícito, MAPA §9, CI completo na master e reinstalação global | Commander + revisor | não |

## Verificação
- **Por task:** teste vermelho antes, mutação dirigida morta, eslint, prettier, G3, c8 dos arquivos tocados e `verify --shards 6`.
- **Por onda:** suíte completa no cgroup e checkers W4/W5.
- **Por campanha:** o recibo L2 do ADR-0050 §1 precisa trazer:
  - credencial efetiva comprovada pelo adapter;
  - versões de cliente, SDK e modelo;
  - cota ou exceção;
  - custo real ≤ teto;
  - recuperação e replay;
  - drain sem órfãos;
  - varredura de segredos;
  - `does_not_prove`.

  Além disso, revisão cética em duas passagens.
- **Fim:** cada pendência do PLAN aparece como fechada com evidência ou como BLOCKED com causa. Nenhuma vira PASS sem prova.

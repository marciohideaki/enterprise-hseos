# PLAN — run `20261111-terminal-closeout` (fase 4)

Objetivo: W0 a W5 fechadas com evidência e o terminal provado de ponta a ponta antes da W6. Entradas: `TERMINAL-GAP-MAP.md`, `DEEPENING.md`, `UNDERSTANDING.md`. Base de todas as ondas: `master` (sem cadeia empilhada; as ondas são sequenciais e cada uma parte da `master` depois do merge da anterior).

## Ondas e tasks

| Onda | Branch | Task | Lacuna | Critério de pronto | Tier |
|---|---|---|---|---|---|
| TA | `feature/terminal-closeout-ta` | TA1 registros da análise | — | `INTAKE`, `STATUS`, `TERMINAL-GAP-MAP`, `DEEPENING`, `UNDERSTANDING`, `PLAN`, `prompts/` versionados na run; neutralidade verde; revisão cética do GAP-MAP fechada | Commander (Opus) escreve; revisor Sonnet |
| TB | `feature/terminal-closeout-tb` | TB1 isolar o banco no teste de boot governado | GM-01 | o caso passa com o banco ativado do host presente e continua exigindo `EXECUTION_ACTIVATION_PENDING`; reprova com o teste antigo neste host | executor Sonnet + revisor Sonnet |
| | | TB2 recusa 401 por ação de terminal | GM-02 | `POST /v1/terminals/commands` (input, resize, EOF) e leitura de eventos sem credencial e com credencial errada → 401, sem efeito no ledger; mutante: remover a checagem global faz o teste falhar | idem |
| | | TB3 teto agregado com N processos | GM-03 | N processos reais no mesmo banco; soma reservada ≤ teto; nenhuma reserva acima do saldo; mutante na checagem de saldo morto | idem |
| | | TB4 varredura de segredo canário | GM-04 | execução roteirizada ponta a ponta com canário injetado pela via de credencial; 0 ocorrências em prompt, workspace, log, artefato e ledger; negativo: sem a redação/isolamento o teste falha | idem |
| | | TB5 reabertura com job adiado | GM-05 | job `not_before` futuro sobrevive à morte do controlador; outro controlador despacha uma vez e não antes do horário | idem |
| TC | `feature/terminal-closeout-tc` | TC1 aceite instalado local | GM-06, GM-07, GM-17 | `core-journey` e `mcp-journey --mode modern` sobre o tarball desta revisão instalado fora do checkout, com exit e contagens copiados; instalação `--offline`; upgrade de um release anterior sem reescrever eventos; downgrade (release anterior sobre banco mais novo) recusado sem escrita e rollback pela restauração do backup; consulta pela CLI do que o SDK criou (GM-17); recibo com `does_not_prove` | executor Sonnet + revisor Sonnet |
| TD | `feature/terminal-closeout-td` | TD1 reconciliação do inventário e docs canônicos | GM-09..GM-14 | `requirements.json` (sem mudança de status), PLAN, MAPA, STATUS sem contradição; guard verde | executor Sonnet + revisor |
| | | TD2 documentação de usuário do terminal | GM-08 | `docs/terminal.md`: instalar, usar, limites, o que não está certificado; neutralidade; coerente com `check:cli` | idem |
| | | TD3 gate de prontidão + `W6-ENTRY.md` | GM-16 | `terminal-readiness.json` (T1–T12) e `test/test-terminal-readiness.js` registrado; falha se critério satisfeito sem evidência ou se status contradiz | idem |
| | | TD4 registros finais | — | `OWNER-GATES.md`, reauditoria cega final (T11), `FINAL-REPORT.md` | auditor Sonnet; veredito Commander |

TD4 não é commit de código: os registros da run entram no commit da TD3 ou num commit próprio de documentação (1 task = 1 commit).

## Dependências e ordem de merge

TA → TB → TC → TD, cada uma com PR para `master` e merge antes da próxima. TC usa o tarball da `master` depois da TB. TD3 lê os resultados de TB e TC.

## Riscos

- TB3/TB4 podem revelar defeito real de produto; aí a task passa a incluir a correção (diagnóstico antes), com mutação, ou vira BLOCKED/OWNER-GATE se exigir arquivo novo em área empacotada no teto.
- TC depende de cgroup v2 delegado e bubblewrap no host; sem eles a jornada responde `blocked`, registrado como tal.
- CI com fila longa; Core journey pode falhar sem job falho (não obrigatório).

## OWNER-GATES previstos

GM-09 (valor `verified_installed_local_scope_only` em F01/F11/F16/F21 e extensão a F19/F04/F12), GM-15 (conjunto do c8), L-08/L-10 (C4, C6), GASTO-NECESSÁRIO das famílias de binding e de `agent run`, F23 sem critério de consumidor real, L-12 (A-05).

## Execution Protocol

- **Modelo de coordenação:** `dev-squad` sob o agente **SWARM** (`.hseos/agents/swarm.agent.yaml`, workflow `.hseos/workflows/dev-squad/workflow.md`; fonte canônica da skill em `.enterprise/governance/agent-skills/dev-squad/`, autoridade ADR-0015). Commander = thread principal em **Opus**. Squad = subagentes com `model: "sonnet"` declarado em toda chamada. **Opt-in de Opus em execução: nenhum.** Run ativa: `.hseos/runs/dev-squad/20261111-terminal-closeout/`.
- **Tier por papel:** exploradores, executores e revisores Sonnet; Opus para plano, integração, decisões, leitura de achados que mudam registro e veredito final.
- **Invariantes de governança:** worktree por task (`./scripts/governance/worktree-manager.sh create|validate|commit|merge|remove`, `validate` pela raiz, `node_modules` por link simbólico); 1 task = 1 commit; 1 onda = 1 PR; sem cadeia empilhada (base `master` em todas); paralelismo só em leitura; build, teste e jornadas em série por `heavy-run --mem 4G`; revisor isolado em duas passagens (cega e confronto) que reporta e não corrige; no máximo 3 rodadas por entrega; nunca converter bloqueio em PASS; nunca afrouxar gate; sem gasto; sem atribuição de IA; sem `--no-verify`, sem force-push, sem commit na `master`.
- **Pré-push (toda onda):** `heavy-run -- npm run lint`, `npm run check:cli`, `node --test --test-concurrency=1 test/test-package-surface.js`, `node test/test-documentation-neutrality.js`, `node .github/scripts/ci-test-shards.mjs verify --shards 6`, `git log --format=%B master..HEAD | grep -iE 'openai|claude|anthropic|gemini|codex|gpt|co-authored|generated with'` vazio.
- **Gates humanos:** sem espera; cada ponto do owner vira linha do `OWNER-GATES.md`. Merge autorizado pela seção 1 (registrada no `INTAKE.md`), só com checks obrigatórios verdes e `mergeStateStatus` `CLEAN`, por `hseos pr closeout <n> --approved` (fallback `gh pr merge --squash` com corpo limpo e motivo registrado).
- **Versionamento por onda:** tag `hseos-terminal-wa` (TA), `-wb` (TB), `-wc` (TC), `-wd` (TD) na `master` depois de cada merge; docs canônicos atualizados na TD (PLAN "Estado consolidado" e "Pendências antes de abrir a W6", MAPA, `docs/evolution/STATUS.md`); `requirements.json` sem mudança de status.
- **Mapeamento onda ↔ squad ↔ tier:**

| Onda | Squad | Tier |
|---|---|---|
| TA | 3 exploradores somente leitura + 1 explorador de aprofundamento + 1 revisor cético do GAP-MAP | Sonnet; Commander Opus decide e escreve |
| TB | 1 executor por task (série), 1 revisor cético por task | Sonnet; Opus integra |
| TC | 1 executor, 1 revisor | Sonnet; Opus integra |
| TD | 1 executor por task, auditor final de duas passagens | Sonnet; Opus emite o veredito |

- **Liveness:** todo turno despachado termina com `LIVENESS: {...}` (seção 9 do prompt); `evidence` obrigatório em `DONE`.

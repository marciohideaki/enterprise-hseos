# Plano — pendências das ondas W0–W5 que não dependem do owner

Tipo: plano de execução, aguardando aprovação do owner para as PRs 2 a 4. A PR 1 (este plano, o [mapa](MAPA.md) e as notas de estado) é só documentação.
Escopo: somente o que se faz sem decisão do owner, credencial, gasto, aceite de ADR ou terceiros. O resto está em [MAPA §5](MAPA.md#5-decisões-que-dependem-do-owner)
e **não** entra aqui. Nada neste plano afrouxa gate, limiar ou asserção.

## Context

O mapa de 2026-10-23 separou o que ficou pendente nas ondas W0–W5. Parte dele é código, teste e documentação sem dependência humana. Este plano agrupa essa parte em
quatro PRs independentes, em ordem de risco, para fechar dívidas conhecidas antes de abrir a W6.

Fatos que moldam a execução:

- **Teto do inventário (G3).** `tools/` (393) e `packages/` (137) estão no teto. Nenhuma task cria arquivo novo nesses diretórios; só edita arquivos existentes. Testes novos
  vão em `test/`. Toda task que toca `tools/` ou `packages/` roda `npm pack --dry-run --json` (npm do Node 24) para provar que o inventário não cresceu.
- **Ambiente.** O pre-commit roda testes que dependem de cgroup delegado e de Node 24; commit por `/build/tmp/hseos-w5/bin/run-in-cgroup.sh` com o Node 24 no PATH até a task T-3
  (e a conferência de outros testes dependentes de cgroup) remover essa dependência.
- **Sem decisões.** Itens que dependem do owner (retenção de evidência, digest de conta, gate `g9-zero-legacy-window`, `.c8-kernel.json`) ficam fora.

## Execution Protocol

**Coordenação:** skill `dev-squad` / agente `SWARM` (fontes: `.enterprise/governance/agent-skills/dev-squad/SKILL.md` e `.hseos/workflows/dev-squad/workflow.md`). O Commander
planeja, extrai os handoffs, integra e não implementa; os executores e os revisores são o squad. Run em `.hseos/runs/dev-squad/20261023-pendencias-w0-w5/` (PLAN.md, STATUS.md,
`prompts/COMMON.md`).

**Modelo (roteamento de modelos):** Opus planeja e decide; Sonnet executa e revisa. Todo Agent executor e todo revisor declara `model: "sonnet"` explícito, sem herdar do main thread.
Opus não executa. Esta sessão de planejamento termina aqui; a execução das PRs 2 a 4 começa depois da aprovação do owner e com a sessão principal em Sonnet.

**Tier matrix (ondas ↔ squads ↔ modelo):**

| Onda | Escopo                 | Tasks              | Tier                                                                                                           | Revisão                                       |
| ---- | ---------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P1   | Documentação e higiene | D1–D5              | Sonnet (este plano executa diretamente, sem squad)                                                             | cética isolada, uma passagem cega + confronto |
| P2   | Testes                 | T-1, T-3, T-5, T-6 | Sonnet, 1 executor por task                                                                                    | cética isolada de duas passagens por task     |
| P3   | Endurecimento pequeno  | H-2, H-4, H-7, H-9 | Sonnet; H-4 e H-9 com revisor independente obrigatório e rigor escalado (tocam admissão e redação de segredos) | cética isolada de duas passagens              |
| P4   | Médio                  | M-8, M-10          | Sonnet com revisor independente                                                                                | cética isolada de duas passagens              |

**Ordem e paralelismo (DAG):** `P1 → (P2 ∥ P3) → P4`. P2 e P3 não compartilham arquivo: P2 só toca `test/` (e fixtures); P3 toca `tools/` e `packages/`, mais os testes de cada
correção. Dentro de P3, H-4 e H-7 tocam o contrato de tarefa e rodam em sequência. P4 depois de P2 e P3, porque M-10 mexe em ferramental de teste.

**Invariantes de governança:**

- Worktree isolado por task (`task/<id>`), 1 task = 1 commit, 1 onda = 1 PR. Merges `chore(merge): integrate <task> into <feature>`.
- Sem `--no-verify`, sem bypass de hook, sem `git stash`. Commit com `run-in-cgroup.sh` e Node 24 no PATH; assunto ≤ 100 caracteres; Prettier nos arquivos staged.
- **Sem atribuição de IA** em commits, merges e PRs (nenhum `Co-Authored-By`, nenhuma menção). O prompt de todo subagente que cria commit ou PR repassa esta regra.
- Nada em `/tmp` literal: scratch em `$TMPDIR`. O prompt de todo subagente repassa esta regra.
- Throttling: `uptime` antes de build ou suíte pesada; no máximo 1 suíte completa por vez e no máximo 2 executores com build simultânea; `heavy-run` para builds, testes e indexações; sem
  `pnpm` na raiz sem teto.
- Revisão cética isolada em duas passagens (cega, depois confronto com as alegações do executor), presa ao SHA; o revisor reporta e não corrige; no máximo 3 rodadas de correção por
  entrega, e na terceira sem progresso troca-se de estratégia com causa raiz registrada.
- Nunca converter bloqueio em PASS. Nunca afrouxar gate, limiar, cobertura ou asserção; teste que falha é corrigido pela causa, não relaxado.
- G3: nenhum arquivo novo em `tools/` ou `packages/`; `npm pack --dry-run --json` em toda task que os toque.
- CI no GitHub: polling ≥ 120 s, sem `gh run watch`; a branch protection é `strict`, então cada merge exige `gh pr update-branch --rebase` nas PRs restantes.
- Cada executor e revisor em projeto com `.axon/` recebe a instrução de descoberta: usar `mcp__axon__*` via ToolSearch (`get_overview` ou `get_context_capsule`) antes de ler arquivos.

**Gates humanos:**

- **Aprovação do plano** antes de P2, P3 e P4 (a P1 é este documento e as notas de estado).
- **Merge de cada PR:** autorização do owner, com CI verde e `CLEAN`.
- Qualquer task que descubra necessidade de decisão do owner (por exemplo, mudar contrato público ou retenção de dados) **para** e reporta como BLOCKED com a causa.
- Nenhuma credencial, nenhum gasto de API e nenhum toque no banco real (`project.db`) em qualquer onda.

**Versionamento por onda:**

| Momento                 | Ação                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Após o merge de cada PR | Tag local `hseos-pend-p{1..4}`; push de tag só com autorização                                                                                                                |
| Ao fechar cada onda     | Atualizar o status em [MAPA.md](MAPA.md) §4 e no registro de resíduos de `w5/STATUS.md` (item resolvido, com SHA e teste), e o vault (work-log, state, roadmap, activity-log) |
| Ao fechar P4            | Atualizar a seção "Estado consolidado" do [PLAN canônico](../PLAN.md)                                                                                                         |

## Tasks

### P1 — documentação e higiene (PR 1, este plano)

- **D1:** [MAPA.md](MAPA.md) e este PLAN.md, linkados no `_INDEX.md`.
- **D2:** notas de "estado superado em 2026-10-22/23" no topo de `w1/STATUS.md`, `w2/STATUS.md` e `w3/STATUS.md`, e uma nota final em `w5/STATUS.md` (a última frase diz que a ativação "segue não
  executada"). Histórico não é reescrito.
- **D3:** nota no topo de `revalidation-2026-10/STATUS.md` apontando para o [MAPA §4](MAPA.md#4-pendências-da-revalidação-de-2026-10-situação-em-2026-10-23), que marca cada pendência como resolvida
  (com evidência), aberta ou não verificada.
- **D4:** higiene local: `master` local atualizada; apagar só as branches locais que eu criei e que já foram mergeadas. Branches remotas e worktrees de outras tarefas não são tocados.
- **D5 (não feita nesta PR):** conferir o primeiro run noturno do CI (`gh run list --workflow CI --event schedule`, a partir de 2026-10-24 05:17 UTC). Só leitura; fica registrada como verificação
  pendente, não como feita.

### P2 — testes (sem mudança de código de produção)

- **T-1 (small):** teste do `hseos execution-activation plan|apply|rollback` pela CLI real, com ADR-0048 `Accepted`, sobre banco v4 descartável em `$TMPDIR`: apply preserva as linhas, chega
  a v17 e o legado recusa; rollback devolve bytes idênticos. Nunca o `project.db` real. Arquivo: `test/test-execution-ledger-activation.js`.
- **T-3 (small):** `test-mcp-environment-host` (K9) detecta a ausência de cgroup delegado e afirma o resultado correto em cada caso (capacidade composta com cgroup; mensagem de cgroup
  indisponível sem ele), sem relaxar a asserção. Critério de aceite: o teste passa com e sem cgroup delegado. Só depois de conferir se o pre-commit tem outro teste dependente de cgroup é que o `run-in-cgroup.sh` deixa de ser exigido no commit.
- **T-5 (medium):** mutantes sem detecção (M09, M18b, N5, `dap_survivor`) ganham teste que os mata, e os casos negativos que faltam entram na matriz. Cada novo teste prova-se por mutação
  (o mutante volta a ser detectado).
- **T-6 (small):** a varredura de `pids_max` cobre a árvore toda, não 5 arquivos, e falha se aparecer um literal novo fora da fonte única.

### P3 — endurecimento pequeno

- **H-2 (small):** `handle()` do adaptador MCP (`tools/lib/mcp-2026-adapter.js:1101` e `:1239`) deixa de repassar `error.message` de erros que não são do adaptador; o cliente recebe uma mensagem
  genérica e a causa fica no log. Testes adversariais: erro interno com segredo na mensagem não chega ao cliente.
- **H-4 (small a medium, revisor independente):** `max_tokens` abaixo do mínimo viável é recusado na admissão com erro explícito (`packages/agent-runtime/runtime.js:58` não ganha código novo de
  falha). Critério: a mensagem cita o mínimo e o valor recebido. Sem mudança de contrato público além do erro de admissão.
- **H-7 (small a medium):** mensagem de escopo ("input does not match schema v1") substituída pela causa real; `detail.code` nas recusas por regra cruzada do contrato (N1); normalização dos
  argumentos de `command_checks` recusa `-cindex.js`, `file:index.js`, `index%2Ejs`, `index.js:1` e `--a=b=index.js`. Só endurece; contratos válidos existentes continuam passando.
- **H-9 (medium, revisor independente):** redação de segredo cobre corpo PEM multilinha sem marcador no diagnóstico do stderr. Testes: corpo PEM fora da janela de 4096 bytes não chega ao
  diagnóstico; nenhum texto legítimo é redigido por engano nos casos existentes.

### P4 — médio

- **M-8 (medium):** lock na instalação, para dois `install` simultâneos no mesmo diretório. Teste de concorrência com os dois terminando com manifesto válido e o segundo esperando ou
  recusando de forma explícita. Arquivo existente, sem arquivo novo em `tools/`.
- **M-10 (medium):** o supervisor de suítes deixa de mascarar vazamento de processo: processo órfão ao fim da suíte vira falha com o nome do teste responsável. Ferramental de teste.

## Arquivos críticos

`tools/lib/mcp-2026-adapter.js`, `packages/agent-runtime/runtime.js`, `tools/cli/lib/engineering-task-contract.js`, `test/test-execution-ledger-activation.js`,
`test/test-mcp-environment-host.js`, `test/test-w5-mutations.js`, `test/test-w5-negative-matrix.js`, `tools/cli/installers/` (M-8), `.github/scripts/` (M-10, se o supervisor estiver lá).
A lista exata de cada task sai do mapeamento do Commander antes do despacho.

## Verificação

- Por task: testes focados em Node 24 (e em Node 22 quando a task toca algo específico do runtime), cobertura crítica 90/80 por arquivo sem queda, `npm run lint`, Prettier.
- Por onda: `npm test` completo em um shard por vez (`heavy-run`), `npm pack --dry-run --json` (inventário ≤ teto), `quality-gates.sh --phase ci` com `VALIDATION_ENFORCED=true`.
- Por PR: CI verde nos checks obrigatórios; em PRs que tocam `ci.yaml`, `test-ci-light-hook.js` atualizado.

## Riscos

- H-4 e H-7 mudam o que o contrato de tarefa aceita ou recusa: precisam de teste de compatibilidade com os contratos de exemplo e com os fixtures dos consumidores.
- H-9 pode redigir demais; o teste negativo (texto legítimo intocado) é obrigatório.
- T-3 muda como o K9 se comporta em CI; a CI tem cgroup delegado, então o ramo "com cgroup" é o que ela exercita.
- Qualquer descoberta de que um item depende de decisão do owner transforma a task em BLOCKED, não em solução própria.

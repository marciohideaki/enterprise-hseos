# RUNBOOK — Ligar o primeiro grafo de loop autônomo N1 com segurança

Operacionaliza o `AUTONOMY-READINESS.md`: transforma o Readiness Gate de 6 itens num checklist executável, define o loop-piloto, e lista as decisões que **só o humano** aprova.

> **Atualização 2026-07-22 (implementado):** por decisão do owner ("não vamos proteger a branch"), o item 2 (âncora protegida) foi implementado **loop-side**, não via CODEOWNERS + branch protection. O enforcement de âncora vive no `loop-guard`/`anchor-guard` (reprova a iteração que toca âncora, salvo `ANCHOR_OVERRIDE=1` humano). O `.github/branch-protection.yaml` e o `ci.yaml` permanecem inalterados. Estado real e artefatos: `.enterprise/governance/autonomy/README.md`. A seção §2 item 2 abaixo (CODEOWNERS/branch protection) fica como a proposta original; a implementação seguiu o caminho loop-side.

> **Atualização 2026-07-24 (EXECUTADO):** o piloto rodou até a stop condition — budget 8/8, worktree `task/pilot-n1`, PR #121 mergeado (`09acc9d`), tags `pilot-iter-1..5`, heartbeat versionado. 2 REPROVADOs reais, rollback testado, alerta silencioso, zero âncora tocada, `verify-doc-facts.sh` 4/4 PASS ao final. Evidência e aceites cumpridos: `.enterprise/governance/autonomy/README.md` §"Execução do piloto". Learnings da execução: **§6 abaixo**. Correção deste runbook pós-execução: o formato de commit sugerido no §2 item 4 (`loop(pilot):`) é rejeitado pelo `validate-commit-msg.sh` (tipo fora da lista conventional) — o formato real usado foi **`docs(pilot): <mini-goal>`**.

**Regra-mãe deste runbook:** enquanto qualquer item do Readiness Gate estiver `[ ]`, o loop roda com gate humano em **cada** iteração (=N0). Só quando os 6 estiverem `[x]` o loop pode auto-avançar entre iterações e parar no humano apenas na fronteira crítica (=N1).

---

## 1. Escolha do loop-piloto (recomendado)

O primeiro loop N1 não deve entregar valor de produto — deve **validar o harness para autonomia com dano potencial quase nulo**. Aplicando os critérios do Readiness Gate (não money-critical, não outward-facing, axon fresco, CI verde, resultado objetivamente verificável) contra os consumidores mapeados na auditoria:

| Candidato | Veredito |
|---|---|
| `/opt/cambio-real` | ❌ money-critical (postings/PSP/valuation) — viola o critério mais importante |
| `hermes-mesh` | ❌ já tem N1 próprio (`/mesh-implement`), bloqueado em gates de operador |
| `mcp-factory`, `prompt-library` | ❌ zumbis, sem CI ativa nem atividade |
| **`enterprise-hseos` (o próprio harness)** | ✅ **recomendado** — CI presente (`ci.yaml`: test+governance), não money-critical, não outward-facing, e usar autonomia para melhorar o próprio SO de engenharia é o caso de uso mais alinhado ao goal original |

**Escopo do loop-piloto (deliberadamente minúsculo):** *reconciliar a documentação factualmente incorreta do `enterprise-hseos` com a realidade do repo* — contagens erradas (F-033: "46 skills" vs 50, "14 agents" vs 15/16), matrizes autodeclaradas editoriais (CAPABILITY-MATRIX), referências mortas **em docs não-ancorados**, `CHANGELOG` ausente (F-031). Cada correção é **objetivamente verificável** (o número está certo ou errado por contagem programática) e **reversível** (git). É o "hello world" da autonomia: máximo aprendizado sobre o harness, mínimo dano possível.

**Parede dura do piloto:** o loop **não toca** `.specs/constitution/`, `.specs/core/`, `.enterprise/governance/policies/`, nem qualquer hook/gate — mesmo que a auditoria tenha achados ali (F-023 etc.). Áreas ancoradas ficam para depois que o loop provar-se estável. Isto exercita o item 2 do Gate de verdade.

---

## 2. Readiness Gate — checklist executável

### `[ ]` Item 1 — Verificador isolado obrigatório (fecha F-007)
**Objetivo:** o passo "verify" roda como subagente separado, contexto limpo, prompt adversarial — nunca a sessão que executou.
**Como:** o orquestrador do loop, ao fim de cada iteração, faz spawn de um agente `general-purpose`/`Explore` com o contrato:
> "Você é verificador adversarial. Tente REFUTAR que a iteração N cumpriu seu critério de aceite. Rode a verificação objetiva (contagem/teste/diff). Default para REPROVADO se a evidência for ambígua. Não confie no relato do executor — reproduza a medição."
**Aceite:** existe ≥1 REPROVADO real no histórico do piloto (prova de que o verificador tem dentes; um verificador que só aprova é teatro). Executor e verificador têm IDs de sessão distintos.
**Owner:** agente (padrão), configurado por humano.

### `[ ]` Item 2 — Âncora protegida (fecha F-005, F-002)
**Objetivo:** o loop não pode reescrever a regra que o contém.
**Artefato-proposta — `CODEOWNERS`** (na raiz do repo, para revisão):
```
# Áreas ancoradas — exigem review de owner nomeado, nunca auto-merge de agente
/.enterprise/.specs/constitution/   @marciohideaki
/.enterprise/.specs/core/           @marciohideaki
/.enterprise/governance/policies/   @marciohideaki
/.agents/manifest.yaml              @marciohideaki
/.agents/hooks/                     @marciohideaki
/.github/                           @marciohideaki
```
**Passos (humano, no GitHub):** commitar o `CODEOWNERS`; em branch protection do `master`: `require_code_owner_reviews: true` (hoje é `false`, F-005); exigir o status check `governance` **e** um novo `anchor-guard`.
**Artefato-proposta — `anchor-guard` (gate CI, esqueleto):**
```bash
#!/usr/bin/env bash
# Falha o build se um PR sem label 'anchor-change' tocar caminho ancorado.
set -euo pipefail
ANCHORED='^\.enterprise/\.specs/(constitution|core)/|^\.enterprise/governance/policies/|^\.agents/manifest\.yaml'
changed="$(git diff --name-only "origin/${BASE:-master}"...HEAD)"
if echo "$changed" | grep -qE "$ANCHORED"; then
  if ! echo "${PR_LABELS:-}" | grep -q 'anchor-change'; then
    echo "::error:: PR toca caminho ancorado sem label 'anchor-change' + review de owner"; exit 1
  fi
fi
```
**Aceite:** um PR de teste que edita `.specs/core/` **falha** o CI sem o label; o piloto, cujo escopo é só doc não-ancorada, **passa**.
**Owner:** humano (branch protection é decisão de governança do repo).

### `[ ]` Item 3 — Escopo e budget impostos, não declarados (operacionaliza learning §2 + stop condition)
**Objetivo:** o ambiente barra o loop ao sair do escopo ou estourar o teto.
**Como:** a carta do loop (§4 abaixo) declara `allowed_paths` (glob) e `budget` (iterações + tokens). O verificador (item 1) rejeita qualquer iteração cujo `git diff --name-only` caia fora de `allowed_paths`. O orquestrador para ao atingir o budget e escala.
**Aceite:** o `allowed_paths` do piloto exclui explicitamente os caminhos ancorados do item 2; um diff fora dele é reprovado automaticamente.
**Owner:** agente (checagem), humano (definição do teto).

### `[ ]` Item 4 — Rollback definido antes de ligar (fecha F-010 no nível N1)
**Objetivo:** toda iteração é desfazível sem esforço.
**Como:** worktree dedicado ao loop; 1 iteração = 1 commit atômico com mensagem `loop(pilot): <mini-goal>`; tag `pilot-iter-N` a cada aceite. Rollback = `git revert <sha>` (granular) ou descarte do worktree. Documentar o comando de rollback na carta **antes** da 1ª iteração.
**Aceite:** rollback testado uma vez de propósito (reverter a iteração 1 e confirmar árvore limpa) antes de deixar o loop auto-avançar.
**Owner:** agente + humano (teste de rollback).

### `[ ]` Item 5 — Um sensor de resultado + um alerta (fecha F-012 no nível N1 — o canal de "dor")
**Objetivo:** o loop grita quando degrada, em vez de degradar em silêncio como o inbox (F-017).
**Sensores mínimos do piloto (dois gatilhos):**
- **gate-sem-evidência:** iteração marcada `pass` sem que o verificador tenha produzido uma medição objetiva → alerta.
- **sem-progresso:** N iterações consecutivas (ex.: 3) sem correção verificada aceita → alerta + parada.
**Como (leve, sem depender do stack OTLP que está morto, F-021):** o orquestrador escreve `loop-heartbeat.jsonl` por iteração (`iter, mini_goal, verdict, evidence_ref, files`); um check simples (`jq`) dispara notificação ao humano nos dois gatilhos. Evoluir para PrometheusRule na Wave 2.
**Aceite:** o gatilho "sem-progresso" foi disparado uma vez em teste (forçar 3 no-ops) e a notificação chegou.
**Owner:** agente (emissão), humano (recebe o alerta).

### `[ ]` Item 6 — Gate humano na fronteira crítica, escrito ANTES (carta §6 do template 20)
**Objetivo:** a linha auto-avanço ↔ gate humano definida por domínio, antes de ligar.
**Para o piloto (doc-only), a linha é simples:**
- **auto-avança** entre iterações de correção documental dentro de `allowed_paths`.
- **para no humano** para: abrir o PR final, qualquer diff fora de `allowed_paths`, qualquer arquivo ancorado (redundante com item 2), e o merge.
**Aceite:** a seção de gates existe na carta antes da iteração 1 (o template 20 é explícito: "auto-merge sem a linha crítica definida é a receita do incidente").
**Owner:** humano.

---

## 3. Decisões que SÓ o humano aprova antes de ligar
1. Commitar o `CODEOWNERS` e ativar `require_code_owner_reviews: true` + check `anchor-guard` no `master` (item 2).
2. Confirmar o `enterprise-hseos` como alvo do piloto e o `allowed_paths` (escopo doc não-ancorada).
3. Definir o budget (sugestão: máx. 8 iterações / teto de tokens à sua escolha).
4. Reindexar o axon do `enterprise-hseos` (13 dias stale, F-015) antes de ligar — ou aceitar rodar sem axon e declarar isso.
5. Aprovar o PR final (o loop nunca faz o próprio merge).

Fora do piloto, mas parte do fechamento honesto do Gate: os S0 (rotação dos PATs F-001, reconciliação do swarm-gate F-002, commit do vault F-003) não bloqueiam o piloto do `enterprise-hseos`, mas devem ser resolvidos antes de apontar autonomia para qualquer projeto que use o harness global.

---

## 4. Carta de Orquestração do loop-piloto (formato do seu template 20)

> Committar como `CARTA-PILOT-N1.md` no `enterprise-hseos` quando os itens 1–6 estiverem `[x]`. Prompt da sessão = só o path (prompt-pointer, evita corrupção de paste).

**1. Veredito honesto.** A orquestração faz sentido: escopo doc-only é o menor blast radius possível com resultado 100% verificável. Teto autônomo realista: **~90%** — o loop descobre, corrige e verifica sozinho; os 10% humanos são abrir/mergear o PR e receber alertas. Paredes duras que nenhuma autonomia fura: caminhos ancorados (item 2), qualquer coisa fora de `allowed_paths`, o merge.

**2. Objetivo verificável (100%).** Toda afirmação factual e numérica nos docs raiz e `.agents/`/`docs/` do repo (contagens de skills/agents/adapters, referências a arquivos, matrizes de suporte) corresponde à realidade do repo, comprovada por medição programática; `CHANGELOG.md` criado. Nenhum doc ancorado tocado.

**3. Modelo operacional.**
| Papel | Quem | Faz |
|---|---|---|
| Orquestrador | sessão principal (tier alto) | decompõe em mini-goals, spawna executor/verificador, escreve heartbeat, para no gate, nunca lê arquivo grande direto |
| Executor | subagente `model: sonnet` | aplica UMA correção verificável e PARA; 1 commit |
| Verificador | subagente isolado (item 1) | tenta REFUTAR; reproduz a medição; REPROVA se ambíguo |

**4. Mapa de sub-waves.** (um mini-goal por iteração, priorizado por reversibilidade)
| Iter | Mini-goal | Verificação objetiva |
|---|---|---|
| 1 | corrigir contagem de skills no README (F-033) | `ls .agents/skills \| wc -l` == número no README |
| 2 | corrigir contagem de agents (F-033) | `ls .hseos/agents/*.agent.yaml \| wc -l` == número no README |
| 3 | marcar CAPABILITY-MATRIX como gerada ou reconciliá-la | adapters listados == arquivos `.yaml` existentes |
| 4 | criar `CHANGELOG.md` inicial (F-031) | arquivo existe, formato Keep-a-Changelog válido |
| 5+ | referências mortas em docs **não-ancorados** | cada path citado resolve (`test -e`) |

**5. Execution Protocol.** 1 iteração = 1 commit (+ tag `pilot-iter-N`); worktree dedicado; verify adversarial obrigatório; heartbeat por iteração; throttling `uptime` antes de qualquer build/test (§3f). Sem push direto — PR ao final.

**6. Gates.** Auto-avança dentro de `allowed_paths`. Para no humano: PR final, diff fora do escopo, qualquer caminho ancorado, merge. (= item 6 do Gate.)

**7. Loop de operação + DoD.** Discover (o que ainda está factualmente errado?) → Mini-goal → Execute (1 correção) → Verify (adversarial) → se REPROVADO, Fix pela causa raiz e revalidar o mesmo aceite → Document (heartbeat) → Reassess. **Stop condition:** superfície esgotada (nenhuma afirmação factual restante incorreta) **ou** budget atingido **ou** bloqueio/ambiguidade → registrar e escalar. **DoD global:** CI verde; PR aberto com relatório (o que mudou, antes/depois, o que ficou fora); zero caminho ancorado tocado; ≥1 REPROVADO no log do verificador.

---

## 5. Kill switch / abort
- **Humano:** remover o worktree do loop e revogar a sessão a qualquer momento; nada foi mergeado sem sua aprovação (gate item 6).
- **Automático:** o gatilho "sem-progresso" (item 5) para o loop após 3 no-ops; diff fora de `allowed_paths` reprova a iteração e para.
- **Pós-piloto:** só avançar para N2 (grafo encadeado, auto-merge em domínio não-crítico) depois que o piloto rodar até a stop condition com o alerta **silencioso** por todas as iterações e o rollback testado. N2 exige as Waves 2–3 (sensores de resultado + contra-métricas + arbitragem + rollback automatizado) — não ligar antes.

---

## 6. Learnings da execução (2026-07-24, pós-piloto)

Registrados durante a execução real; cada um com ação sugerida:

1. **Runbook × validador de commit:** o formato `loop(pilot): <mini-goal>` (§2 item 4) é rejeitado pelo `validate-commit-msg.sh` (tipos aceitos: feat/fix/docs/style/refactor/test/chore/ci/build/perf/revert). Usado `docs(pilot):`. **Ação:** manter `docs(pilot):` como formato canônico de iteração doc-only (este runbook já corrigido via nota de atualização).
2. **`worktree-manager commit` usa `git add -A`** e varre o estado do loop (`.hseos/loops/<run>/`) para dentro do commit da iteração — fora do `allowed_paths`, porém benigno (o bus de auditoria fica versionado junto da iteração; foi até útil). **Ação:** decidir explicitamente — ou declarar `.hseos/loops/` no escopo dos pilotos (estado viaja com o loop, comportamento atual), ou gitignorar e committar o heartbeat só no encerramento.
3. **O gate `capability-catalog` bloqueou commit com skills órfãs** (goal-graph/verifier sem capability-family) durante o piloto — o harness protegeu a própria integridade; fix na base (`ce315ac`). **Ação:** nenhuma — comportamento desejado, registrado como prova de que os gates funcionam.
4. **`hseos pr closeout` é estruturalmente inviável para PRs task→feature:** exige checks de CI passando, mas `ci.yaml` só dispara para `master` — PRs intermediários nunca terão checks. Merge do piloto feito via `gh pr merge --merge` (equivalente ao `--no-ff` do worktree-manager). **Ação:** ou ampliar triggers do CI para `feature/*`, ou documentar o closeout governado como exclusivo do fluxo feature→master (PRs task→feature usam merge direto pós-gates locais).
5. **Executor idle sem entregar relatório** (2× na mesma iteração): subagente concluiu e ficou ocioso sem enviar a SAÍDA contratada; resolvido com cobrança via mensagem. **Ação:** o contrato de executor deve terminar com "envie a SAÍDA como mensagem ANTES de encerrar" e o orquestrador deve verificar o filesystem independentemente (como feito) — evidência no disco > relato.
6. **O run não apareceu no agent-state store SQLite** (`state-list`/kanban vazios para o piloto): o heartbeat do loop-guard e o `state-emit` são canais paralelos sem ponte — manifestação viva dos findings F-019/F-028. **Ação:** na próxima campanha, exportar `HSEOS_CURRENT_RUN_ID` no início do loop OU fazer `loop-guard iter` emitir `state-emit` best-effort (unificação do barramento).

---

## Resumo do que este runbook entrega
Um caminho concreto para provar autonomia no harness com risco quase nulo: 6 itens de Gate com aceite verificável, os 2 artefatos de enforcement que faltam (CODEOWNERS + anchor-guard) prontos para sua revisão, um loop-piloto doc-only cujo resultado é objetivamente checável, e a linha exata onde a máquina para e você decide. É o "Ciclo 0" aplicado à própria autonomia — fechar o Gate **é** o pré-requisito, exatamente como o seu template 18 manda não empilhar feature sobre operação quebrada.

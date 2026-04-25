# Workflows

> Os 6 workflows de entrega no HSEOS — o que fazem, como os humanos participam e como retomar em caso de interrupção.

---

## Visão geral

Workflows são pipelines orquestrados e stateful. ORBIT coordena os workflows lineares; SWARM coordena execução paralela. Cada workflow:

- Declara pré-requisitos antes de iniciar
- Produz um artefato tipado em cada fase
- Para visivelmente quando um gate falha — nunca pula silenciosamente
- Pode ser retomado a partir da última fase validada

---

## 1. Entrega de Epic — `ED`

**Ativado por:** ORBIT (`/orbit` → `ED`)
**Duração:** Múltiplas sessões (horas a dias para um epic completo)
**Use quando:** Entregando um epic completo de ponta a ponta com múltiplos agentes

Este é o pipeline completo. 11 fases, 10 agentes.

### Sequência de fases

| Fase | Agente | O que acontece | Ação humana necessária? |
|---|---|---|---|
| 0 — Preflight | ORBIT | Valida pré-requisitos, ferramentas e estado do workflow | Corrija bloqueios se reportados |
| 1 — Escopo do Epic | NYX | Confirma objetivo do epic e ordem de dependência das histórias | Aprove o escopo ou corrija |
| 2 — Planejamento & UX | VECTOR + PRISM | Valida ordenação de histórias e implicações de UX | Revise e aprove artefatos |
| 3 — Prontidão de Arquitetura | CIPHER | Confirma constraints de arquitetura e requisitos de ADR | Aprove ou solicite ADR |
| 4 — Preparação de Histórias | RAZOR | Garante status da sprint e prontidão dos artefatos de história | Revise histórias |
| 5 — Execução de Histórias | GHOST | Implementa histórias com TDD, faz commits no branch de feature | Revise commits, resolva bloqueios |
| 6 — Validation Gate | GLITCH | Revisão adversarial, cobertura de testes, quality gates | Deve passar — sem override |
| 7 — Publish | FORGE | Publica artefato no registry com evidência imutável | Confirme image tag e digest |
| 8 — GitOps Deploy | KUBE | Atualiza manifests, cria PR GitOps, monitora ArgoCD | **Aprove o PR GitOps** |
| 9 — Verificação de Runtime | SABLE | Verifica saúde dos pods, smoke tests, gates de prontidão | Revise o relatório de runtime |
| 10 — Consolidação | QUILL + ORBIT | Emite evidência de execução, resumo de entrega pronto para PR | Sign-off final |

### Cadeia de artefatos

```
NYX (escopo)
  → VECTOR (PRD, epics)
    → CIPHER (arquitetura, ADRs)
      → RAZOR (histórias prontas)
        → GHOST (código, commits, testes)
          → GLITCH (quality gate report)
            → FORGE (image tag, digest, SHA, URL do pipeline)
              → KUBE (URL do PR GitOps, sync ArgoCD)
                → SABLE (saúde de runtime)
                  → QUILL (resumo, changelog)
```

### Como retomar após interrupção

ORBIT persiste o estado em `.hseos-output/<epic-id>/state.yaml`. Se a sessão terminar no meio:

```
/orbit → ED
→ ORBIT detecta o estado e retoma da última fase validada
```

Nunca rode da fase 0 se já existe estado — você perde evidência validada.

---

## 2. Delivery Readiness — `DR`

**Ativado por:** ORBIT (`/orbit` → `DR`)
**Duração:** Minutos
**Use quando:** Verificando se os pré-requisitos estão no lugar antes de iniciar Epic Delivery

Roda um checklist pré-flight. ORBIT valida:
- Artefatos obrigatórios existem (PRD, doc de arquitetura, histórias)
- Ferramentas acessíveis (GitHub MCP, Kubernetes MCP, ArgoCD)
- Sem bloqueios no estado atual do branch
- Estado consistente vindo de uma rodada anterior

**Saída:** Verde (prossiga) ou lista de pré-requisitos ausentes com guia de resolução.

Use antes do `ED` quando estiver inseguro se o epic está pronto, ou após uma pausa longa para verificar integridade.

---

## 3. Kube Deploy — `KD`

**Ativado por:** KUBE (`/kube` → `KD`)
**Duração:** 5–15 minutos
**Use quando:** Fazendo deploy de uma nova versão de imagem para um ambiente Kubernetes

Cuida do lado GitOps do deploy. Não constrói nem publica imagens — isso é FORGE.

### Sequência de fases

| Fase | O que acontece |
|---|---|
| 0 — Detecção de Profile | Lê `.hseos/config/kube-profile.yaml` ou auto-detecta o modelo GitOps |
| 1 — Localização de Manifest | Encontra `kustomization.yaml` para o serviço/ambiente alvo |
| 2 — Validação | Roda comando definido no profile (`kustomize build`, `kubeval`, etc.) |
| 3 — Branch + Commit | Cria branch de feature, atualiza tag, commita com formato governado |
| 4 — Criação de PR | Abre PR contra a base correta (vinda de `pr-base-map`) |
| 5 — Monitor ArgoCD | Acompanha sync até Healthy ou expõe o erro |

### Touchpoint humano

KUBE cria o PR GitOps mas **não faz merge em fluxos de produção**. Você aprova e merge manualmente. KUBE espera e reporta o status do ArgoCD após o merge.

### Profiles GitOps

| Profile | Significado |
|---|---|
| `centralized` | Manifests vivem em monorepo compartilhado (ex.: `platform-gitops`) |
| `app-paired` | Cada aplicação tem seu próprio repo de manifests |

KUBE auto-detecta o modelo. Para forçar, edite `.hseos/config/kube-profile.yaml`.

---

## 4. Runtime Deploy — `RD`

**Ativado por:** SABLE (`/sable` → `RD`)
**Duração:** 5–20 minutos
**Use quando:** Verificando saúde de um deploy depois que KUBE sincronizou

Rode após KUBE reportar sync ArgoCD completo. SABLE checa:

- Prontidão de pod e contadores de restart
- Logs da aplicação por erros críticos (primeiros 5 min pós-deploy)
- Endpoints de smoke ou health checks declarados no workflow
- Etapas de seed/data readiness (se declaradas)

**Saída:** Relatório de saúde de runtime. Se algum check falha, SABLE para, reporta a causa raiz e não avança. Nunca reinterpreta um sinal falho como aceitável.

---

## 5. Release Publish — `RP`

**Ativado por:** FORGE (`/forge` → `RP`)
**Duração:** 5–10 minutos
**Use quando:** Publicando um artefato de release em registry de container/pacote

FORGE cuida da publicação. Não faz deploy — isso é KUBE + SABLE.

O que FORGE faz:
- Inspeciona workflow CI por presença e configuração
- Constrói e publica o artefato (image push, npm publish, etc.)
- Registra evidência imutável: image tag, digest, SHA, URL do pipeline
- Bloqueia promoção se a evidência de publicação está incompleta

**Regra dura:** Sem release sem evidência. FORGE recusa se o estado do CI está faltando ou o build não passou.

---

## 6. Dev Squad — `DS`

**Ativado por:** SWARM (`/swarm` → `DS`)
**Duração:** Sessão única (plan + execute) ou modo destacado (recomendado para waves com mais de 4 tarefas)
**Use quando:** Um lote heterogêneo de 3+ tarefas independentes precisa ser entregue junto, otimizando custo de tokens e wall-clock

Este é o fluxo de execução paralela do HSEOS. SWARM planeja em modelo de alta capacidade (Opus) e dispacha subagentes Sonnet/Haiku enxutos em ondas paralelas — cada tarefa isolada em seu próprio git worktree. 1 tarefa = 1 commit; 1 wave = 1 PR.

### Sequência de fases

| Fase | Agente | O que acontece | Ação humana? |
|---|---|---|---|
| 0 — Vault Context (opcional) | SWARM | Lê `_memory/current-state.md` se second-brain ativo; pula em silêncio se não | Nenhuma |
| 1 — Intake | SWARM | Brief em prosa; uma rodada de `AskUserQuestion` apenas se houver ambiguidade material | Responder até 4 perguntas se solicitado |
| 2 — Study (opcional) | SWARM | Até 3 subagentes `Explore` em paralelo mapeiam áreas desconhecidas | Nenhuma |
| 3 — Plan | SWARM | Tarefas atômicas, grafo de waves, matriz de modelo, contratos, critérios de aceite | **Aprovar `PLAN.md` (Gate G2 — obrigatório)** |
| 4 — Execute | SWARM (waves de N subagentes paralelos) | Por wave: valida base, fan-out em worktrees, valida, commita, mescla, remove | Revisar `WAVE-{k}-REPORT.md` se BLOCKED ou flag de risco (Gate G3) |
| 5 — Consolidate | SWARM | Esboça corpo do PR com `.github/pull_request_template.md` | **Rodar `gh pr create` (Gate G4); reviewer aprova e merge (Gate G5)** |
| 6 — Knowledge Consolidation (opcional) | SWARM | Surge gotchas para o vault se second-brain ativo | Nenhuma |

### Gates

| Gate | Tipo | Owner |
|---|---|---|
| G1 — Intake | Condicional | SWARM (uma rodada de `AskUserQuestion` se necessário) |
| G2 — Plan approval | **Obrigatório** | Humano aprova `PLAN.md` antes de qualquer wave de Execute |
| G3 — Wave review | Condicional | Humano revisa `WAVE-{k}-REPORT.md` se BLOCKED ou risco |
| G4 — PR open | Obrigatório | Humano roda `gh pr create`; agentes esboçam, nunca abrem |
| G5 — Merge | Obrigatório | Reviewer humano aprova e mescla; agentes nunca mesclam em branches protegidos |

### Invariantes de governança

- **Isolamento por worktree** é obrigatório — toda tarefa de escrita roda via `scripts/governance/worktree-manager.sh`. `git worktree` cru é proibido.
- **Higiene de commit** — formato conventional, validado por `validate-commit-msg.sh`; sem `Co-Authored-By`, sem menção a `Claude`, `AI`, `LLM`, `Anthropic`, `GPT`.
- **Branch base** — `check-branch.sh` valida que a base segue `feature/*`.
- **Quality gates** — `worktree-manager.sh validate` roda os 6 quality gates antes de cada commit.
- **Tiering de modelo** — modelo mínimo capaz por tarefa; Opus-as-executor exige opt-in explícito em `PLAN.md`.
- **Cascata de governança** — mudanças de escopo → VECTOR; arquitetura → CIPHER; release/runtime → FORGE/KUBE/SABLE; epic-scale → ORBIT.

### Como retomar após interrupção

```
/clear
/swarm → RS    # Resume Squad — lê PLAN.md + STATUS.md + handoffs/ em contexto limpo
```

Nunca rode do Plan se `STATUS.md` mostra waves committadas — você perde evidência.

---

## Arquivos de estado dos workflows

Todo estado de workflow é gravado em `.hseos-output/` (workflows lineares) ou `.hseos/runs/<workflow-id>/` (dev-squad). Não delete esses diretórios no meio do workflow.

```
.hseos-output/
└── <epic-id>/
    ├── state.yaml          ← fase atual, fases concluídas, refs de artefatos
    ├── phase-7-output.yaml ← evidência FORGE (tag, digest, SHA)
    └── phase-8-output.yaml ← evidência KUBE (URL do PR, status sync)

.hseos/runs/dev-squad/<run-id>/
├── PLAN.md
├── STATUS.md
├── WAVE-{n}-REPORT.md
├── handoffs/
└── logs/
```

Esses arquivos são gitignored por padrão (evidência de entrega, não código-fonte).

---

## Quando um workflow para

ORBIT, SWARM e os agentes individuais param visivelmente quando um gate falha. Você verá:

```
[GATE FAIL] Phase 6 — Validation Gate
Reason: Test coverage dropped below threshold (58% < 80%)
Required action: Fix failing tests in services/payments/
Do not advance to Phase 7 until this gate passes.
```

Não tente pular o gate. Conserte o problema reportado e re-rode a fase. Gates existem porque fases downstream dependem de outputs válidos.

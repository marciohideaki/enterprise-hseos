# Workflows

> Os 5 workflows de entrega no HSEOS — o que fazem, como os humanos participam e como retomar em caso de interrupção.

---

## Visão geral

Workflows são pipelines orquestrados e stateful. ORBIT os coordena. Cada workflow:

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
| 4 — Preparação de Histórias | RAZOR | Garante status da sprint e prontidão dos artefatos de história | Revise histórias para completude |
| 5 — Execução de Histórias | GHOST | Implementa histórias com TDD, faz commits no branch de feature | Revise commits, resolva bloqueios |
| 6 — Validation Gate | GLITCH | Revisão adversarial, cobertura de testes, quality gates | Deve passar — sem override |
| 7 — Publish | FORGE | Publica artefato no registry com evidência imutável | Confirme image tag e digest |
| 8 — GitOps Deploy | KUBE | Atualiza manifests, cria PR GitOps, monitora ArgoCD | **Aprove o PR GitOps** |
| 9 — Verificação de Runtime | SABLE | Verifica saúde dos pods, smoke tests, gates de prontidão | Revise o relatório de runtime |
| 10 — Consolidação | QUILL + ORBIT | Emite evidência de execução, resumo de entrega pronto para PR | Sign-off final |

### Cadeia de artefatos

```
NYX (doc de escopo)
  → VECTOR (PRD, epics)
    → CIPHER (doc de arquitetura, ADRs)
      → RAZOR (histórias prontas)
        → GHOST (código, commits, testes)
          → GLITCH (relatório de quality gate)
            → FORGE (image tag, digest, SHA, URL do pipeline)
              → KUBE (URL do PR GitOps, status de sync ArgoCD)
                → SABLE (relatório de saúde de runtime)
                  → QUILL (resumo de entrega, changelog)
```

### Como retomar após interrupção

ORBIT persiste o estado em `.hseos-output/<epic-id>/state.yaml`. Se uma sessão terminar no meio do workflow, execute `/orbit` e selecione `RESUME`. ORBIT vai ler o estado e continuar a partir da última fase validada.

---

## 2. Execução de História Única — `SE`

**Ativado por:** GHOST (`/ghost` → `SE`)
**Duração:** Uma sessão (30 min a algumas horas)
**Use quando:** Implementando uma única história já preparada pelo RAZOR

Fluxo simplificado focado em execução TDD:

```
GHOST → GLITCH (validação) → PR
```

---

## 3. Deploy GitOps — `GD`

**Ativado por:** KUBE (`/kube` → `GD`)
**Duração:** Uma sessão
**Use quando:** Fazendo deploy de uma imagem promovida para um ambiente específico

Fases:
1. KUBE atualiza o manifesto Kustomize com a nova tag de imagem
2. KUBE cria o PR GitOps
3. Humano aprova o PR
4. KUBE monitora o sync do ArgoCD
5. SABLE verifica a saúde do runtime

---

## 4. Revisão de PR — `PR`

**Ativado por:** GLITCH (`/glitch` → `PR`)
**Duração:** Uma sessão
**Use quando:** Revisando um PR antes do merge

GLITCH aplica a skill `pr-review` com análise adversarial em 5 níveis para PRs de alto risco.

---

## 5. Pesquisa de Domínio — `DR`

**Ativado por:** NYX (`/nyx` → `DR`)
**Duração:** Uma sessão
**Use quando:** Precisando de análise profunda de domínio antes de arquitetar uma solução

NYX produz um documento de escopo que serve como input para VECTOR e CIPHER.

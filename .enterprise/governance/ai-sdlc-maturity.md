# AI-SDLC Maturity Model

> Framework de maturidade para desenvolvimento de software assistido por IA.
> Baseado no AI-SDLC v1.0 §12. Atualizado com mapeamento do estado atual do HSEOS.

---

## Os 4 Níveis

### Nível 1 — Manual

**Definição:** Execução disciplinada pelo time, sem templates ou automação.

| Característica | Estado |
|---|---|
| Planning antes de execução | Ad hoc — depende do engenheiro |
| Isolamento de contexto | Não garantido |
| Qualidade dos outputs | Variável |
| Governança | Inexistente ou informal |

---

### Nível 2 — Assistido

**Definição:** Templates e validações básicas. Time usa o framework mas enforcement é manual.

| Característica | Estado |
|---|---|
| Templates de planning | Existem, uso facultativo |
| Contratos de task | Definidos informalmente |
| Validações de CI | Básicas (lint, testes) |
| Agentes com papéis definidos | Parcialmente |

---

### Nível 3 — Governado ← **HSEOS hoje**

**Definição:** Enforcement via pipeline. Agentes com autoridade declarada, gates estruturais, qualidade não depende de disciplina individual.

| Característica | Evidência no HSEOS |
|---|---|
| Planning obrigatório antes de execução | `spec-driven` skill bloqueia implementação sem spec |
| Task isolation | Worktree manager + 1 story = 1 sessão (GHOST) |
| Contratos explícitos de task | `input_contract` / `output_contract` no schema spec-driven |
| Agentes com authority declarada | 13 agentes com `authority.md` + `constraints.md` |
| Quality gates no CI/pre-commit | Lint, schema, install tests, security scan, commit hygiene |
| Enforcement estrutural | Sete Leis, gates bloqueiam avanço sem evidência |
| Rastreabilidade | Workflow state files, logs de validação |
| Context policy documentada | `context-policy` skill (guideline) |
| Observabilidade de entrega | Métricas nativas via `.hseos-output/` e `.logs/` |

**Gaps para Nível 4:**
- Context enforcement automático (requer LLM middleware)
- Token tracking e custo por feature em tempo real
- Orquestração autônoma end-to-end sem intervenção humana em gates
- FinOps dashboard integrado (requer mission-control)

---

### Nível 4 — Autônomo

**Definição:** Orquestração completa por agentes. Métricas em tempo real. Enforcement automático de contexto e custo.

| Característica | O que é necessário |
|---|---|
| Context enforcement automático | LLM middleware (`policylayer-intercept` com token tracking) |
| Token tracking por sessão/feature | Middleware ou Anthropic Console API integration |
| FinOps em tempo real | mission-control instalado + SABLE reporting |
| Gates humanos apenas em produção | HITL apenas para deploy prod; todo o resto autônomo |
| Orquestração autônoma de ponta a ponta | ORBIT executando epic-delivery sem checkpoints manuais |
| KPIs automatizados | Dashboard com custo/feature, % stateless, error rate por agente |

---

## Roadmap sugerido para Nível 4

### Passo 1 — Observabilidade (pré-requisito)
- Instalar `mission-control` (`/opt/references/mission-control/`)
- Configurar SABLE para emitir métricas de workflow ao mission-control
- Implementar `ai-observability` skill (já planejada nesta release)

### Passo 2 — Context Enforcement
- Avaliar `policylayer-intercept` com extensão de token tracking
- Ou usar Claude Code hooks para detectar sessões longas e sugerir reset
- Implementar alerta automático ao atingir 40% de contexto

### Passo 3 — FinOps Dashboard
- Conectar mission-control ao Anthropic Console usage API
- Calcular custo por feature via: tokens × modelo × preço por token
- Expor KPIs do AI-SDLC §10 em dashboard

### Passo 4 — Gates autônomos (exceto prod)
- Validar que todos os gates de non-prod podem ser aprovados por SABLE automaticamente
- Manter HITL gates apenas para deploy em produção

---

## Referência normativa

- AI-SDLC v1.0 §12 — Níveis de Maturidade
- HSEOS Enterprise Constitution — Sete Leis
- `.enterprise/governance/agent-skills/context-policy/` — Context Policy skill
- `.enterprise/governance/agent-skills/ai-observability/` — Observabilidade skill

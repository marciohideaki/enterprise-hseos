---
name: core-drift
tier: quick
version: "1.0"
---

# Core Drift — Quick Reference

> Tier 1: use quando GHOST inicia story ou QUILL encerra epic.
> Load SKILL.md (Tier 2) apenas para análise de promoção completa ou ADR draft.

---

## 1. Detection

```
1. Read hseos.config.yaml → second_brain.path
2. If second_brain.enabled: verify _cores/ exists at vault path
3. If verified: core-drift AVAILABLE — cache vault path
4. If not: skip silently — do NOT block execution
```

---

## 2. Read Protocol — GHOST (pre-story)

Executar ANTES de implementar qualquer story que envolva infraestrutura, messaging, cache, compliance, auth, persistence ou API layer.

```
1. Ler {vault}/_index/FEATURE-CATALOG.md — checar coluna "Fonte" para a feature alvo
2. Se Fonte = core/* → usar módulo do core, não reimplementar
   → Ler {vault}/_cores/{core-relevante}.md para instruções de consumo
3. Se Fonte = project/{nome} → avaliar: copiar implementação de referência
   → Ler _features/{slug}.md para localização exata
4. Se feature não está no FEATURE-CATALOG → implementar normalmente
   → Registrar mentalmente como candidato para avaliação QUILL
```

**Mapeamento domínio → core a ler:**
| Domínio da story | Core relevante |
|-----------------|----------------|
| Auth, JWT, roles | platform-core + backend-core |
| Messaging, eventos, outbox | backend-core |
| Cache, Redis, locks | backend-core |
| Persistência, repositórios | backend-core |
| Idempotência | backend-core |
| UI, componentes, layouts | frontend-core + design-system-core |
| Design tokens, temas | design-system-core |
| Mobile, RN, Flutter | mobile-core |
| Observabilidade, OTEL | platform-core |

---

## 3. Write Protocol — QUILL (post-epic)

Executar ao fechar Phase 10 de qualquer epic.

| Trigger | Ação | Destino no vault |
|---------|------|-----------------|
| Feature nova domain-agnostic | Verificar se resolve Gap em algum core | `_cores/{core}.md` §Gaps |
| Feature usada em 2+ projetos | Adicionar em promotion-backlog | `_cores/promotion-backlog.md` |
| Feature já em core mas reimplementada | Registrar como drift | `_knowledge/projects/{nome}/gotchas.md` |
| Promoção claramente justificada (3+ projetos) | Gerar ADR candidato | `_decisions/hseos/ADR-XXXX-promote-{feature}.md` |

**Critérios de promoção (checar todos):**
1. 2+ projetos já usam a mesma implementação
2. Domain-agnostic (não é regra de negócio específica)
3. Não está documentado em nenhum core ainda
4. Não é workaround temporário

---

## 4. Fallback

```
_cores/ unavailable → pular verificação silenciosamente
FEATURE-CATALOG desatualizado → documentar suspeita, não bloquear
Dúvida sobre promoção → registrar em gotchas do projeto, não em _decisions/
```

Never block story implementation because core-drift check failed.

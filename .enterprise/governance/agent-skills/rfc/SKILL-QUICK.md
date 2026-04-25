---
name: rfc
tier: quick
version: "1.0.0"
description: "Gera RFC (Request for Comments) ou design doc para decisões técnicas — problema, proposta, alternativas, trade-offs, impacto e métricas de sucesso"
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# rfc — Quick Reference

> Tier 1: use para qualquer pedido de RFC, design doc ou decisão técnica formal.
> Carregue SKILL.md (Tier 2) para o template completo e algoritmo de geração.

---

## Checklist de pré-execução

- [ ] Proposta técnica identificada (ou perguntada)
- [ ] Contexto de arquitetura carregado (`_knowledge/engineering/`)
- [ ] ADRs anteriores relevantes verificados em `_decisions/`

---

## Fluxo resumido

```
1. Carregar contexto (architecture, stack, ADRs existentes)
2. Estruturar: problema → por que agora → alternativas → proposta
3. Avaliar impacto (sistemas, esforço, risco, reversibilidade)
4. Criar nota em _pipeline/rfc-[nome].md
5. Gerar RFC completo com seções obrigatórias
```

---

## Seções obrigatórias do RFC

| Seção | Conteúdo |
|-------|---------|
| Contexto | Problema atual, por que existe, por que agora |
| Proposta | Solução recomendada com detalhes de implementação |
| Alternativas | Mínimo 2 — com prós, contras, por que não |
| Trade-offs | Tabela ganho vs custo |
| Impacto | Sistemas, esforço (T-shirt), risco, reversibilidade |
| Plano de migração | Passos numerados + rollback plan |
| Métricas de sucesso | Indicadores mensuráveis |

---

## Regras críticas

- Apresentar pelo menos 2 alternativas consideradas
- Nunca minimizar trade-offs — listar todas as desvantagens
- Tom técnico e objetivo — RFC não é pitch de vendas
- Se contradiz ADR existente, sinalizar explicitamente

---

## Exemplos de invocação

```
/rfc migrar autenticação de sessions para JWT
/rfc implementar cache layer com Redis no cambio-real
/rfc separar serviço de notificações em microserviço independente
```

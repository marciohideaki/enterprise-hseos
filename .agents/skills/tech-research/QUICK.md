---
name: tech-research
tier: quick
version: "1.0.0"
description: "Pesquisa e avalia uma tecnologia, ferramenta ou approach técnico com comparação de alternativas e recomendação fundamentada"
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# tech-research — Quick Reference

> Tier 1: use para qualquer pedido de avaliação de tecnologia, ferramenta ou abordagem técnica.
> Carregue SKILL.md (Tier 2) para o algoritmo completo de pesquisa.

---

## Checklist de pré-execução

- [ ] Tecnologia/ferramenta e contexto de uso identificados (ou perguntados)
- [ ] Stack atual consultado (`_knowledge/engineering/stack.md` se existir)
- [ ] Alternativas identificadas (mínimo 2)

---

## Fluxo resumido

```
1. Carregar contexto do vault (stack, architecture, conventions)
2. Pesquisar: docs, GitHub, benchmarks, comunidade
3. Avaliar fit com stack atual
4. Comparar alternativas em tabela
5. Criar nota em _pipeline/research-[nome].md
6. Recomendação: Adotar / Prototipar / Monitorar / Descartar
```

---

## Critérios de avaliação (escala /5)

| Critério | O que observar |
|---------|---------------|
| Maturidade | Releases, breaking changes, idade |
| Performance | Benchmarks vs alternativas |
| DX | API, docs, tooling, curva de aprendizado |
| Comunidade | Stars, issues, forum, blog activity |
| Fit com stack | Compatibilidade, custo de migração |

---

## Recomendações possíveis

- **Adotar** — fit claro, comunidade saudável, resolve o problema
- **Prototipar** — promissor mas precisa de PoC
- **Monitorar** — interessante mas não é o momento
- **Descartar** — não resolve, ou alternativa claramente superior

---

## Regras críticas

- Dados antes de hype — benchmarks sustentam ou contradizem?
- Avaliar custo de migração antes de recomendar adoção
- "Funciona" é uma recomendação válida para a solução atual
- Comparar com alternativas reais, não straw men

---

## Exemplos de invocação

```
/tech-research Drizzle ORM para substituir Prisma
/tech-research Bun vs Node.js para nosso backend
/tech-research Redis para cache layer no cambio-real
```

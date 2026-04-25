---
name: tech-research
tier: full
version: "1.0.0"
description: "Pesquisa e avalia uma tecnologia, ferramenta ou approach técnico com comparação de alternativas e recomendação fundamentada"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# tech-research — Guia Completo

## Quando usar

Carregue esta skill quando o usuário pedir:
- tech-research, pesquisar tecnologia, evaluate technology, avaliar ferramenta
- comparar abordagem, spike técnico, should we use X, vale a pena X
- alternativa para Y, substituir Z, qual melhor para

---

## PASSO 0 — Identificar a tecnologia e contexto

Se `$ARGUMENTS` fornecido: extrair tecnologia e contexto de uso.
Se vazio ou incompleto: perguntar "Qual tecnologia quer avaliar e em que contexto?"

Exemplos de contexto relevante:
- "para substituir Prisma no cambio-real"
- "para cache layer no backend Node.js"
- "comparar com a abordagem atual de X"

---

## PASSO 1 — Carregar contexto do vault

Ler em paralelo (se existirem):

```
_knowledge/engineering/stack.md       — stack atual e decisões prévias
_knowledge/engineering/architecture.md — padrões de arquitetura
_knowledge/engineering/conventions.md  — convenções estabelecidas
_knowledge/references.md               — ferramentas já catalogadas
```

Se projeto específico mencionado:
```
_knowledge/projects/<nome>/gotchas.md  — gotchas são ouro para avaliação de fit
```

---

## PASSO 2 — Pesquisar a tecnologia

Buscar e documentar:

**Maturidade:**
- Versão estável atual, data do primeiro release, frequência de releases
- Histórico de breaking changes (major versions)
- Bus factor (quantos maintainers ativos)

**Performance:**
- Benchmarks oficiais ou terceiros vs alternativas
- Limitações conhecidas de escala

**Developer Experience:**
- Qualidade da documentação (completa? exemplos reais?)
- API surface (ergonomia, consistência)
- Tooling (IDE support, CLI, debug)
- Curva de aprendizado estimada

**Comunidade:**
- GitHub stars, forks, issues abertas vs fechadas
- Frequência de commits (últimas 4 semanas)
- Stack Overflow: perguntas recentes respondidas
- Discord/Slack/forum: tamanho e atividade

**Dependências:**
- O que introduz? Conflitos com stack atual?

---

## PASSO 3 — Avaliar fit com stack atual

Com base no contexto carregado:

| Pergunta | Resposta |
|---------|---------|
| Compatível com linguagem/runtime atual? | |
| Custo de migração (S/M/L/XL)? | |
| Quais dependências introduz? | |
| Impacto na DX do time? | |
| Precisa de mudanças na infra? | |

---

## PASSO 4 — Comparar alternativas

Listar 2–3 alternativas e comparar:

| Critério | [Tecnologia avaliada] | [Alternativa 1] | [Alternativa 2] |
|---------|----------------------|----------------|----------------|
| Maturidade | /5 | /5 | /5 |
| Performance | /5 | /5 | /5 |
| DX | /5 | /5 | /5 |
| Comunidade | /5 | /5 | /5 |
| Fit com stack | /5 | /5 | /5 |
| Custo de migração | — | — | — |

---

## PASSO 5 — Criar nota no pipeline

Criar `_pipeline/research-[nome-kebab-case].md`:

```markdown
---
tags: [pipeline, research, spike]
status: em-andamento
created: [data de hoje]
updated: [data de hoje]
---

# Research: [Nome da Tecnologia]

## Informações Básicas
- Versão: X.Y.Z
- Licença: MIT/Apache/etc
- Linguagem: Go/Rust/JS/etc
- GitHub: [url]

## Contexto
[Por que estamos avaliando]

## Análise
[Resumo dos critérios]

## Próximos Passos
- [ ] [ação concreta]

## Related
[[stack]] [[architecture]]
```

---

## PASSO 6 — Gerar recomendação

```markdown
### Pesquisa Técnica — [Nome da Tecnologia]

**Resumo:** [O que é e por que estamos avaliando — 2-3 frases]

**Análise:**

| Critério | Avaliação | Notas |
|---------|-----------|-------|
| Maturidade | X/5 | [detalhe] |
| Performance | X/5 | [detalhe] |
| DX | X/5 | [detalhe] |
| Comunidade | X/5 | [detalhe] |
| Fit com stack | X/5 | [detalhe] |

**Comparação com alternativas:**
[Tabela comparativa completa]

**Trade-offs:**
- Prós: [lista]
- Contras: [lista]

**Recomendação: [Adotar / Prototipar / Monitorar / Descartar]**
[Justificativa com argumentos técnicos concretos]

**Próximo passo:** [Ação concreta]

**Nota criada:** `_pipeline/research-[nome].md`
```

---

## Regras de governança

| Regra | Detalhe |
|-------|---------|
| Dados antes de hype | Se benchmarks não sustentam, diga |
| Custo de migração obrigatório | Nunca recomendar adoção sem avaliar custo |
| "Funciona" é válido | Se solução atual resolve bem, diga isso |
| Alternativas reais | Comparar com alternativas genuínas, não straw men |
| Informação faltante | Se falta dado para conclusão sólida, declare o que falta |
| Resposta em PT-BR | Output sempre em português (BR) |

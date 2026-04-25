---
name: rfc
tier: full
version: "1.0.0"
description: "Gera RFC (Request for Comments) ou design doc para decisões técnicas — problema, proposta, alternativas, trade-offs, impacto e métricas de sucesso"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# rfc — Guia Completo

## Quando usar

Carregue esta skill quando o usuário pedir:
- rfc, RFC, design doc, decisão técnica, technical decision
- architecture proposal, proposta de arquitetura
- como devemos implementar X, qual a melhor abordagem para Y
- quero documentar a decisão de Z

---

## PASSO 0 — Identificar a proposta

Se `$ARGUMENTS` fornecido: extrair título/descrição da proposta.
Se vazio: perguntar "Qual é a proposta técnica? (descreva o problema e a solução que está considerando)"

---

## PASSO 1 — Carregar contexto

Ler em paralelo (se existirem):

```
_knowledge/engineering/architecture.md  — padrões de arquitetura atuais
_knowledge/engineering/stack.md         — stack atual
_knowledge/engineering/conventions.md   — convenções estabelecidas
_knowledge/projects.md                  — projetos relacionados
_decisions/                             — ADRs anteriores (verificar conflitos)
```

Se ADR relacionada encontrada → sinalizar no RFC.

---

## PASSO 2 — Estruturar o RFC

Responder estas perguntas antes de escrever:

1. **Qual problema estamos resolvendo?** (o problema, não a solução)
2. **Por que agora?** (o que mudou que torna isso necessário)
3. **Quais abordagens foram consideradas?** (mínimo 2 alternativas)
4. **Qual a proposta?** (recomendação com justificativa)
5. **Quais os trade-offs?** (o que estamos abrindo mão)
6. **Qual o plano de migração?** (se aplicável)
7. **Como validamos?** (métricas de sucesso mensuráveis)

---

## PASSO 3 — Avaliar impacto

| Dimensão | Avaliação |
|---------|---------|
| Sistemas/serviços afetados | [lista] |
| Risco de breaking changes | baixo/médio/alto |
| Esforço estimado | S / M / L / XL |
| Reversibilidade | sim / parcial / não — e custo de reverter |

---

## PASSO 4 — Criar nota no pipeline

Criar `_pipeline/rfc-[nome-kebab-case].md`:

```markdown
---
tags: [pipeline, rfc, architecture]
status: em-andamento
created: [data de hoje]
updated: [data de hoje]
---

# RFC: [Título]

[Conteúdo completo do RFC]
```

---

## PASSO 5 — Gerar RFC completo

```markdown
### RFC: [Título da Proposta]

**Autor:** [[about-me]] | **Data:** [data de hoje] | **Status:** Draft

---

#### Contexto

[2-3 parágrafos: problema atual, por que existe, o que mudou que torna a solução necessária agora]

#### Proposta

[Descrição clara da solução proposta, com detalhes suficientes para implementar]

#### Alternativas consideradas

**Alternativa A: [nome]**
- Descrição: [o que seria]
- Prós: [lista]
- Contras: [lista]
- Por que não: [razão]

**Alternativa B: [nome]**
- Descrição: [o que seria]
- Prós: [lista]
- Contras: [lista]
- Por que não: [razão]

#### Trade-offs

| Ganho | Custo |
|-------|-------|
| [o que ganhamos] | [o que abrimos mão] |

#### Impacto

| Dimensão | Avaliação |
|---------|-----------|
| Sistemas afetados | [lista] |
| Esforço estimado | [S/M/L/XL] |
| Risco | [baixo/médio/alto] |
| Reversibilidade | [sim/parcial/não] |

#### Plano de migração

1. [Passo 1]
2. [Passo 2]
3. [Passo 3]
4. Rollback: [como reverter se necessário]

#### Métricas de sucesso

[Como sabemos que funcionou — métricas concretas e mensuráveis]

---

**Nota criada:** `_pipeline/rfc-[nome].md`

**Próximo passo:** [Ação concreta — ex: "Revisar com o time", "Criar PoC", "Implementar"]
```

---

## Regras de governança

| Regra | Detalhe |
|-------|---------|
| Mínimo 2 alternativas | Sempre, mesmo que claramente inferiores |
| Trade-offs completos | Se há desvantagens, listar todas — sem omissões |
| Tom técnico | RFC não é pitch — objetivo e sem hype |
| Conflito com ADR | Sinalizar explicitamente se contradiz decisão anterior |
| Informação insuficiente | Declarar o que precisa ser investigado antes de propor |
| Resposta em PT-BR | Output sempre em português (BR) |

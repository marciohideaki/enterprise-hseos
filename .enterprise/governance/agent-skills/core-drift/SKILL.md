---
name: core-drift
tier: full
version: "1.0"
---

# Core Drift — Full Reference

> Tier 2: use para análise de promoção completa, geração de ADR candidato, ou quando SKILL-QUICK não for suficiente.

---

## 1. Core Registry Protocol

O Core Registry vive em `{vault}/_cores/`. É a fonte de verdade sobre o que cada core repo oferece.

**Estrutura:**
```
_cores/
  README.md              ← índice da camada, hierarquia de dependência
  platform-core.md       ← contratos agnósticos (auth, logging, messaging, observability)
  backend-core.md        ← abstrações backend por stack (.NET, Java, Node, Go, PHP)
  frontend-core.md       ← padrões React/TypeScript
  design-system-core.md  ← tokens visuais e componentes
  mobile-core.md         ← padrões React Native e Flutter
  promotion-backlog.md   ← fila de candidatos a promoção
```

**Formato de cada arquivo de core:**
- `## O Que Oferece` — módulos disponíveis com status
- `## Consumo Atual` — quais projetos usam e como
- `## Gaps Conhecidos` — o que falta, candidatos a implementar
- `## Candidatos de Entrada` — features de projetos que deveriam migrar para este core

**Regra de leitura:** ler apenas o core relevante ao domínio da task. Nunca carregar todos os cores simultaneamente.

---

## 2. Pre-Implementation Check (GHOST)

Protocolo completo antes de implementar qualquer story com código novo:

### 2.1 Identificar domínio da story
Mapear a story para os domínios técnicos: messaging, cache, persistence, auth, compliance, UI, observability, etc.

### 2.2 Consultar FEATURE-CATALOG
```
Ler: {vault}/_index/FEATURE-CATALOG.md
Buscar: feature com nome similar ao que será implementado
Verificar: coluna "Fonte"
```

**Resultado A — Fonte = `core/{repo}`:**
→ Feature está no core. NÃO reimplementar.
→ Ler `_cores/{repo}.md` §"Como Consumir" para instruções.
→ Se projeto ainda não usa o core: implementar o consumo, não a feature.

**Resultado B — Fonte = `project/{nome}`:**
→ Feature existe em projeto. Avaliar reuso vs reimplementação.
→ Ler `_features/{slug}.md` para localização exata do código.
→ Se for copiar: documentar origem no código e em `decisions.md` do projeto.
→ Se for reimplementar por razão técnica: registrar ADR local.

**Resultado C — Feature não encontrada no FEATURE-CATALOG:**
→ Implementar normalmente.
→ Registrar internamente como "feature nova" para avaliação QUILL ao fim do epic.

### 2.3 Verificar Gaps nos cores relevantes
```
Ler: {vault}/_cores/{core-relevante}.md §"Gaps Conhecidos"
```
Se a story resolve um Gap documentado:
- Implementar seguindo as convenções do core
- Ao fim do epic, QUILL deve propor promoção com prioridade alta

---

## 3. Post-Epic Evaluation (QUILL)

Protocolo ao encerrar Phase 10:

### 3.1 Listar features novas do epic
Extrair do trabalho do epic todas as implementações que não existiam antes.

### 3.2 Para cada feature nova

**Verificação 1 — Já está em algum core?**
```
Buscar em FEATURE-CATALOG coluna "Fonte" = core/*
```
- Se sim e o projeto não estava usando: registrar como drift em `gotchas.md`
- Se sim e o projeto estava usando: OK, nenhuma ação

**Verificação 2 — É candidata a promoção?**
Critérios (qualquer um suficiente para candidatura):
- 2+ projetos já usam a mesma implementação
- Resolve Gap documentado em `_cores/`
- Domain-agnostic + usado em contexto genérico (não regra de negócio)
- Implementação é de qualidade production-grade

**Verificação 3 — Quantos projetos já usam?**
Buscar no FEATURE-CATALOG e nos módulos dos outros projetos.

### 3.3 Registrar candidatos

Append em `{vault}/_cores/promotion-backlog.md`:
```markdown
| {YYYY-MM-DD} | {feature} | {projeto-origem} | {N projetos} | {core-alvo} | {critério} | candidato |
```

### 3.4 Gerar ADR candidato (se 3+ projetos ou gap crítico)

Criar `{vault}/_decisions/hseos/ADR-promote-{feature}-{YYYY-MM-DD}.md`:

```markdown
---
tags: [decision, hseos, core-promotion]
status: draft
created: YYYY-MM-DD
---

# Proposta: Promover {Feature} para {core-alvo}

**Tipo:** Core Promotion Proposal
**Gerado por:** HSEOS QUILL — Phase 10, epic {epic-id}

## Contexto

{Feature} foi implementada em {projeto-origem} e identificada em {N} projetos do portfólio:
- {projeto1}: {caminho}
- {projeto2}: {caminho}

## Proposta

Promover a implementação canônica de {projeto-origem} para `{core-alvo}/{módulo}/`.

## Justificativa

- Domain-agnostic: {explicação}
- Reuso confirmado: {N} projetos
- {outros critérios}

## Impacto

- Projetos que precisariam migrar: {lista}
- Esforço estimado de migração: {baixo/médio/alto}
- Risco de breaking change: {sim/não}

## Reversibilidade

{Fácil/Difícil} — {explicação}

## Próximos Passos

- [ ] Revisão humana desta proposta
- [ ] Se aprovado: abrir PR em {core-alvo} com implementação
- [ ] Atualizar FEATURE-CATALOG coluna "Fonte" após merge
- [ ] Migrar projetos consumidores
```

---

## 4. Promotion Criteria — Guia Completo

### Promover ao core (todos necessários):
1. Domain-agnostic — não contém regra de negócio específica
2. Testado em produção ou POC estável — não é experimento
3. 2+ projetos usam OU resolve Gap documentado no core
4. Human reviewed — QUILL propõe, humano decide
5. Sem breaking changes para projetos existentes (ou breaking change justificado com plano de migração)

### NÃO promover ao core:
- Workaround temporário
- Específico de regulação de um domínio (KYC, AML, CTR — ficam em projects)
- Implementação ainda experimental
- Feature com dívida técnica conhecida que seria "propagada" para o core

### Zona cinza — escalar para humano:
- Feature FinTech usada em 3+ projetos (KYC, AML) — pode ser `fintech-core` no futuro?
- Feature Python sem representação em backend-core — falta de cobertura do core ou projeto específico?

---

## 5. Promotion ADR Template

Ver §3.4 acima para o template completo.

Após gerado, registrar no activity log:
```
## [YYYY-MM-DD HH:MM] decision | ADR candidato de promoção: {feature} → {core}
```

---

## 6. Drift Detection

Drift = projeto reimplementou algo que já existe (ou deveria existir) em algum core.

**Tipos de drift:**
| Tipo | Exemplo | Severidade |
|------|---------|-----------|
| Reimplementação exata | Projeto C copiou Lock de projeto A sem registrar | Média |
| Adaptação não documentada | Projeto usou padrão do core mas modificou sem ADR | Alta |
| Ignorância do core | Feature nova sem consultar FEATURE-CATALOG | Baixa |
| Versão desatualizada | Core foi atualizado, projeto ficou para trás | Média |

**Registro de drift:**
Append em `{vault}/_knowledge/projects/{nome}/gotchas.md`:
```markdown
### Drift: {feature} reimplementada (deveria usar {core}/{módulo})
**Problema:** {feature} foi implementada localmente em vez de consumir {core}/{módulo}.
**Solução/Contexto:** Migrar para {core}/{módulo} quando houver oportunidade. Ver {FEATURE-CATALOG link}.
```

---

## 7. Escalation

Parar e escalar para humano quando:
- Uma feature candidata a promoção introduziria breaking change em 2+ projetos
- O core repo alvo está em estado "planned" (não existe ainda)
- Há conflito entre implementações de dois projetos (qual é a canônica?)
- A promoção requereria mudanças na governança do core repo

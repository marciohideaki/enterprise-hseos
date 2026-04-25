---
name: doc-project
tier: quick
version: "1.0.0"
description: "Gera documentação rica e profissional para projetos — README bilíngue EN+PT-BR, docs estruturados, placeholders de imagem com dimensões corretas, CHANGELOG, CONTRIBUTING, SECURITY e templates GitHub"
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# doc-project — Quick Reference

> Tier 1: use para qualquer invocação de `/doc-project`.
> Carregue SKILL.md (Tier 2) para o algoritmo completo de geração.

---

## Checklist de pré-execução (TODOS devem passar)

- [ ] Diretório do projeto identificado (argumento ou CWD)
- [ ] README existente lido antes de qualquer sobrescrita
- [ ] ImageMagick disponível: `convert --version`
- [ ] `docs/assets/` criado antes de referenciar qualquer imagem no README

---

## Fases resumidas

```
Fase 1: Analisar projeto
  → tree 2 níveis, ler manifesto, entry points, README existente

Fase 2: Criar placeholders PNG (ImageMagick)
  → banner 1983×793, diagramas 1536×1024, screenshots 1280×800, demo 800×500

Fase 3: Gerar documentação
  → README.md (400–600 linhas), docs/en/, docs/pt-br/,
     CHANGELOG.md, CONTRIBUTING.md, SECURITY.md,
     docs/assets/README.md, .github/ templates
```

---

## Regras críticas (NUNCA violar)

- NUNCA referenciar imagem no markdown antes de criar o arquivo PNG
- NUNCA sobrescrever README existente sem ler e preservar informações
- SEMPRE gerar `docs/pt-br/` espelhando `docs/en/` (bilinguismo obrigatório)
- SEMPRE incluir fallback Mermaid em `<details>` para cada diagrama PNG
- SEMPRE usar `<picture>` com variante dark/light para o banner
- SEMPRE criar `docs/assets/README.md` documentando specs de cada asset

---

## Arquivos de output obrigatórios

| Arquivo | Linhas alvo |
|---------|-------------|
| `README.md` | 400–600 |
| `CHANGELOG.md` | ~40 |
| `CONTRIBUTING.md` | ~80 |
| `SECURITY.md` | ~30 |
| `docs/assets/README.md` | ~120 |
| `docs/en/getting-started.md` | ~300 |
| `docs/en/architecture.md` | ~200 |
| `docs/en/faq.md` | ~150 |
| `docs/en/troubleshooting.md` | ~200 |
| `docs/pt-br/` (espelhos) | igual EN |
| `.github/ISSUE_TEMPLATE/bug_report.md` | ~25 |
| `.github/ISSUE_TEMPLATE/feature_request.md` | ~15 |
| `.github/pull_request_template.md` | ~15 |

---

## Dimensões dos assets placeholder

| Asset | Dimensões | Fundo |
|-------|-----------|-------|
| `docs/assets/banner.png` | 1983×793 | `#1a1a2e` (escuro) |
| `docs/assets/*.png` (diagramas) | 1536×1024 | `#f0f0f0` (claro) |
| `docs/assets/screenshots/*.png` | 1280×800 | `#f8f8f8` (claro) |
| `docs/assets/demo.png` (stub gif) | 800×500 | `#e8e8e8` (cinza) |

---

## Criação vs Atualização

| Cenário | Comportamento |
|---------|--------------|
| README não existe | Criar do zero com estrutura completa |
| README existe | Ler primeiro, preservar informações, enriquecer com seções faltantes |
| Seção específica faltando | Adicionar sem sobrescrever o restante |
| PNGs já existem em docs/assets/ | Não recriar — usar os existentes |

## Exemplos de invocação

```
/doc-project
/doc-project /opt/hideakisolutions/platform-gitops
/doc-project -- atualizar apenas README, preservar docs/
/doc-project -- adicionar seção PT-BR que está faltando
```

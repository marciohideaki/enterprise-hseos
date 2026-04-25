---
name: repo-radar
tier: quick
version: "1.0.0"
description: "Analisa e classifica um repositório GitHub via repo-radar CLI (SQLite + LLM), registrando o veredito em PROJECT_EVALUATIONS.md"
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# repo-radar — Quick Reference

> Tier 1: use para qualquer pedido de análise ou classificação de repositório GitHub.
> Carregue SKILL.md (Tier 2) para o fluxo completo passo a passo.

---

## Checklist de pré-execução

- [ ] URL do repositório GitHub fornecida como argumento
- [ ] `repo-radar` instalado: `which repo-radar`
- [ ] `.env` configurado em `/opt/references/repo-radar/.env`

---

## Fluxo resumido

```
1. Verificar instalação do CLI
2. Garantir .env (LLM_PROVIDER + API key)
3. repo-radar add <url>
4. repo-radar show <nome>
5. Atualizar /opt/references/PROJECT_EVALUATIONS.md
```

---

## Mapeamento de classificação → status

| CLI Output | Status no MD |
|-----------|-------------|
| INTERESTING | adopt |
| INCORPORATE | partial |
| WATCH | partial + nota de monitoramento |
| REDUNDANT | reject |
| DISCARD | reject |

---

## Regras críticas

- SQLite é a fonte primária — PROJECT_EVALUATIONS.md é relatório derivado
- Se repo já existe no MD, **atualizar** a entrada, nunca duplicar
- Citar arquivos reais do clone na seção Evidence
- Sempre incluir scores numéricos nas Notes

---

## Exemplos de invocação

```
/repo-radar https://github.com/owner/repo
repo-radar https://github.com/nicholasspyrison/second-brain
```

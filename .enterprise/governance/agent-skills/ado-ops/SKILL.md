---
name: ado-ops
description: "Operações Azure DevOps via MCP — criar/editar Epic, Feature, User Story, Task, fechar batch, linkar dependências, gerenciar iteration paths. Core do ciclo ADO-first no HSEOS."
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
  tier: full
  load_strategy: trigger
  portable: true
  feature_flag: ado.enabled
  triggers:
    - "Azure DevOps"
    - "ADO"
    - "ADO Epic"
    - "ADO Feature"
    - "ADO Story"
    - "ADO Task"
    - "work item"
    - "wit_create_work_item"
    - "wit_add_child_work_items"
    - "iteration path"
    - "batch close"
    - "fechar ADO"
    - "criar demanda ADO"
---

# ADO-Ops — Core Operations

## Pré-requisito

A skill ado-ops requer que `ado.enabled: true` esteja configurado em `.hseos/config/hseos.config.yaml` e que a variável de ambiente `ADO_PAT` esteja presente no env com um Personal Access Token válido do Azure DevOps.

Se `ado.enabled` for `false` ou ausente, esta skill não é carregada e todos os hooks associados saem silenciosamente com `exit 0`. Nenhuma operação ADO é executada e nenhum erro é emitido.

Para habilitar:

```yaml
# .hseos/config/hseos.config.yaml
ado:
  enabled: true
  org: "<sua-org>"
  project: "<seu-projeto>"
```

E no ambiente:

```bash
export ADO_PAT="<personal-access-token>"
```

## Ferramentas MCP disponíveis

MCP server: `azure-devops`

| Ferramenta | Propósito |
|---|---|
| `wit_create_work_item` | Cria Epic/Feature/Story/Task |
| `wit_add_child_work_items` | Cria múltiplos filhos linkados em batch |
| `wit_update_work_item` | Atualiza campos / transiciona estado |
| `wit_works_items_link` | Linka predecessor→successor |
| `wit_query_by_wiql` | Query WIQL para idempotência |
| `wit_get_work_item` | Leitura de item |
| `work_create_iterations` | Cria iteration/sprint |

## Hierarquia ADO ↔ SWARM

O mapeamento entre os níveis ADO e a granularidade SWARM é canônico e deve ser respeitado em todas as operações:

- **ADO Epic** = Phase / cluster multi-wave (owner: Architect)
  - Representa um conjunto coeso de capacidades de produto
  - Cobre múltiplas waves correlatas (geralmente 4–12)

- **ADO Feature** = Wave group / Sprint (2–4 waves correlatas)
  - Entregável verificável ao fim do grupo de waves
  - Deve ter critérios de aceite mensuráveis

- **ADO User Story** = Wave única (1 dev-squad run completo)
  - Representa o trabalho de um único ciclo dev-squad
  - Tem tasks filhas correspondendo a worktrees

- **ADO Task** = 1 Squad Agent / 1 worktree
  - Granularidade máxima: ≤4 arquivos core, ≤1000 LOC delta, ≤60% ctx Sonnet
  - Tipos canônicos:
    - `[IMPL]` = implementação de código
    - `[TEST]` = testes (task separada, não misturar com impl)
    - Migrations DB = task separada, deve preceder tasks de app que dependam do schema

## Padrões de título

```
Epic:       [EPIC-NNN] Título Descritivo
Feature:    [F-NNN-NN] Título Descritivo
User Story: US-NNN-NN-A — Título
Task impl:  [IMPL] Componente em Linguagem
Task test:  [TEST] Componente — unit + integration
```

Onde `NNN` é o número sequencial do item no projeto ADO e `A` é um sufixo alfabético para sub-histórias da mesma feature.

## Restrição crítica — State=Closed

**NUNCA** criar um work item com `State: Closed`. O Azure DevOps rejeita a criação direta em estado fechado.

Fluxo obrigatório para items que devem ser criados já fechados (ex: backlog histórico):

1. `wit_create_work_item` com `State: New`
2. Aguardar resposta com o ID criado
3. `wit_update_work_item` separado com `State: Closed` usando o ID retornado

## Paralelismo

- Máximo de **10 chamadas MCP por turno**
- Para batch close de >10 items: dividir em blocos de 10, aguardar confirmação de cada bloco antes de prosseguir
- Para criação em lote de hierarquia completa (Epic → Features → Stories → Tasks): usar `wit_add_child_work_items` para os níveis intermediários sempre que possível

## Templates HTML de descrição

### Epic

```html
<h2>Objetivo</h2><p>[capacidade de produto que este epic entrega]</p>
<h2>Escopo</h2><p>[bounded contexts, linguagens, componentes impactados]</p>
<h2>Critérios de Saída</h2><ol>
  <li>[Critério funcional verificável por demo ou teste E2E]</li>
  <li>[Invariante arquitetural ou de segurança mantido]</li>
  <li>[Cobertura de testes mínima atingida]</li>
</ol>
<h2>Rastreabilidade</h2><ul>
  <li>Waves: WXX–WXX | Tag: x.0</li>
  <li>Bounded Context: [contexto]</li>
  <li>PRs: #NNN</li>
</ul>
```

### Feature

```html
<h2>Objetivo</h2><p>[entrega específica desta feature ao usuário/sistema]</p>
<h2>Escopo Técnico</h2><p>[componentes, APIs, schemas, serviços envolvidos]</p>
<h2>Invariantes</h2><ul><li>[restrição que nunca pode ser violada nesta feature]</li></ul>
<h2>Critérios de Aceite</h2><ol>
  <li>[Critério funcional testável por QA ou agente]</li>
  <li>[Invariante técnico verificável via CI ou inspeção]</li>
</ol>
<h2>Rastreabilidade</h2><ul>
  <li>Wave: WXX | Tag: x.0</li>
  <li>Bounded Context: [contexto]</li>
</ul>
```

### User Story

```html
<h2>História</h2><p>Como [papel], quero [ação], para [benefício].</p>
<h2>Demanda</h2><p>[descrição técnica da implementação esperada]</p>
<h2>Critérios de Aceite</h2><ol>
  <li>[Verificável por agente autônomo ou pipeline CI]</li>
</ol>
<h2>Definição de Pronto</h2><ul>
  <li>Código commitado em branch ado-{ID}-*</li>
  <li>PR aberto e linkado a esta Story</li>
  <li>CI verde (lint + testes + build)</li>
</ul>
```

### Task

```html
<h2>Escopo</h2><p>[arquivo(s) a criar/modificar, bounded context afetado]</p>
<h2>Critérios de Aceite</h2><ol>
  <li>[bash -n script ou yamllint passa sem erros]</li>
  <li>[conteúdo esperado presente e verificável]</li>
</ol>
<h2>Constraints</h2><ul>
  <li>≤ 4 arquivos core por worktree</li>
  <li>≤ 1000 LOC delta total</li>
  <li>≤ 60% da janela de contexto do Sonnet</li>
</ul>
```

## Idempotência (WIQL check antes de criar)

Antes de criar qualquer item, verificar via WIQL se já existe um item com o mesmo título/identificador no projeto. Isso previne duplicatas em caso de retry ou execução parcial.

Query padrão de verificação:

```sql
SELECT [System.Id], [System.Title] FROM WorkItems
WHERE [System.TeamProject] = '{project}'
AND [System.Title] CONTAINS '[EPIC-NNN]'
```

Substituir `[EPIC-NNN]` pelo prefixo de identificação do item a verificar (ex: `[F-001-01]`, `US-001-01-A`).

**Fluxo obrigatório**:
1. Executar `wit_query_by_wiql` com a query de verificação
2. Se retornar resultado → usar o `System.Id` existente em vez de criar novo
3. Se vazio → prosseguir com `wit_create_work_item`

## Configuração ADO (lida de .hseos/config/hseos.config.yaml)

```yaml
ado:
  enabled: true
  org: ""          # nome da organização ADO (ex: mycompany)
  project: ""      # nome do projeto ADO
  project_id: ""   # GUID do projeto (opcional, para queries diretas)
  auth_env: ADO_PAT
  parallel_max: 10
```

URL base derivada: `https://dev.azure.com/{org}/{project}`

## HSEOS Integration

Esta skill é compilada para `.agents/skills/ado-ops/SKILL.md` pelo `agent-core-compiler`.

- **Carregamento**: trigger-based (Tier 2) — carregada quando qualquer trigger da lista é detectado na conversa
- **Feature flag**: `ado.enabled` em `.hseos/config/hseos.config.yaml`
- **Quando flag é `false`**: skill não é carregada; todos os hooks associados saem com `exit 0` silenciosamente
- **Quick reference**: ver `SKILL-QUICK.md` (Tier 1) para referência rápida sem os templates completos

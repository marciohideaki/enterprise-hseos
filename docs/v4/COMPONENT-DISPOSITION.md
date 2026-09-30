# Disposição dos componentes na candidata v4

| Disposição | Superfícies | Tratamento e limite comprovado |
|---|---|---|
| Manter e integrar | `packages/agent-runtime-contracts`, `agent-runtime`, `tool-runtime`, `agent-session-store`, `agent-context`, política e isolamento | Jornada pública de tarefa; política local, snapshots, orçamento e verificação independente |
| Manter como autoridade única | `packages/agent-orchestration` | WorkflowEngine, LocalSubagentProvider e supervisor recebem os resultados das tarefas; sem novo motor |
| Reusar | binding, provider e broker existentes | Seleção explícita; segredo só autentica egress no broker; executor não recebe transporte |
| Tornar opcional | ADO, GitOps, second brain, metodologias, providers adicionais | Catálogo e comandos lazy; sem materialização nos dois perfis novos; módulos continuam na distribuição coordenada |
| Manter sidecars opcionais | managed governance server/console, state UI, kanban central | Nenhum serviço necessário para tarefas locais; gerenciador existente preservado, sem segundo supervisor |
| Manter experimental | transporte interagentes e capacidades sem consumidor desta jornada | Fora do perfil de engenharia; não receberam consumidores artificiais |
| Retirar da v4 | ações mutáveis do workflow YAML | Comandos recusam com orientação; histórico continua legível; migração só de definições completas para novas execuções |
| Retirar como critério de sucesso | resposta final do modelo | `session.completed` preserva significado; aprovação exige prova independente da tarefa |
| Restringir alegações | hooks, provider capabilities, isolamento e recuperação | Capacidade declarada não equivale a enforcement; limitações constam da matriz e dos guias públicos |

Reexports e a cadeia `.enterprise → .agents → adapters` foram preservados.
O catálogo compilado foi atualizado pela função de sincronização do compilador.
Os módulos `@hseos/*` seguem internos à distribuição coordenada; não há publicação
independente nesta entrega. O perfil ativo ai-jail permanece intacto.

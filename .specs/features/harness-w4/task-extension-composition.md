# W4-02c3b — ferramentas e contexto em tarefas

Contrato antes da implementação. Task isolada hseos-w4-task-extensions, base inicial
7de3008, atualizada por fast-forward a 78f27f7. Seleção W4-02c3a integrada
em 9ff033c/78f27f7 após gate/hook aprovados, antes dos testes desta task. Uma task, um commit. W4-02c3c ligará modelo/campanha ao controle.

Inputs: extensions.md, selection.md da task de seleção, engineering-task-runtime.js,
engineering-task-state.js, engineering-control.js, terminal-control.js,
execution-plugin-adapters.js, operational-runtime.js e contratos ContextSourceSchema.
Outputs: engineering-task-extensions.js, extensões nos arquivos citados, configuração
local do controle e teste test-engineering-task-extensions.js; scripts/c8/distribuição,
STATUS e evidence/task-extensions/\*. Sem execução de plugin pelo host.

Catálogo local confiável fornece IDs estáveis, configuração JSON, política e conteúdo
admitidos. API aceita somente extension_ids. Created fixa selection v1; antigos eventos
sem extensions continuam válidos. Query não resolve catálogo; execução/resume revalidam
pin original. Troca de versão/config/política bloqueia antes do efeito. Port host valida
configuração semântica estrita, com schemas reutilizados do executor governado.

Ferramentas registram bundles antes do selo. Fontes de contexto também executam no
ToolRuntime: coleta serial antes do primeiro modelo, IDs estáveis por tarefa/seleção,
recibo durável e sem repetição incerta. Conteúdo entra apenas em runtime_context com
proveniência. Inicialmente esta composição admite tool/context-source; model/runtime
já têm ports, mas sua seleção em tarefa aguarda a próxima subdivisão.

Número de fontes de contexto selecionadas reserva slots do teto original de ferramentas
na definição criada. Sessão recebe restante; policy soma invocações, terminais e essa
reserva. TerminalControl.open considera reserva antes de despachar. Não há saldo novo.
Prazo da tarefa limita cada plugin. Cancelamento aborta coleta/modelo/ferramentas e
aguarda drain de todos os owners. Incerteza impede aceitação e término certificado.

Verificação: node --test --test-concurrency=1 test/test-engineering-task-extensions.js
mais suites task-state/task-runtime/terminals/control afetadas. Node22/24 sequenciais;
coverage crítica 90/80, revisor cético isolado cego + confronto, gate antes do commit.
Cenários: create-only sem plugin; ferramenta real em tarefa fixture; contexto com origem
no assembler; limite incluindo terminal/contexto; replay sem recolher; drift antes do
efeito; cancelamento com cgroup observado; incerteza bloqueando aprovação; API sem código.

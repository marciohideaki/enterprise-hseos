# Correção e recuperação orientada por reconciliação

Status: implementado e verificado deterministicamente nos testes direcionados e
no pacote instalado fora do checkout; recibos anteriores continuam históricos.
Autorização: solicitação do usuário para cobrir as duas capacidades, com pergunta
obrigatória sempre que o estado atual não permitir uma conclusão segura.

## Reuso e decisões

Reutilizados AgentRuntime, SessionEventSchema, replay incremental/integral,
ToolRuntime, EngineeringTaskState, WorkflowEngine, broker e executor existentes.
Não há novo motor, provider, serviço ou contador de orçamento. O intake de
capacidade desta ampliação é reuso dos componentes existentes com extensão de
contratos internos, não um novo componente distribuível.

A revisão acontece antes de session.completed. O callback confiável inspeciona
artefatos e usa o verificador protegido. Uma reprovação pode solicitar revisão,
registrada em model.revision.requested e ligada ao passo anterior. A continuação
preserva o contexto e os limites da mesma sessão. O número de correções vem de
max_failed_corrections; zero continua desabilitando correções automáticas.

Antes de uma escrita corretiva, engineering.diagnose registra causa, plano de
correção, requisitos afetados e digest dos arquivos reprovados. O gateway recusa
escritas sem esse diagnóstico. A qualidade semântica da explicação continua sendo
uma hipótese do modelo; a aprovação depende da nova verificação independente.

## Reconciliação

agent reconcile e workflow reconcile levantam o estado sem chamar um provider.
Confirmam identidade/encerramento do worker, eliminam descendentes abandonados,
comprovam isolamento, leem os arquivos e executam a verificação protegida.
Comparam o observado com os efeitos duráveis e os intents ainda sem recibo.

Escrita com estado final comprovado não é repetida. O recibo original perdido não
é fabricado como sucesso: registra-se a interrupção e a evidência independente do
estado atual. Operações incertas e respostas parciais do modelo só são abandonadas
para continuidade após resposta explícita. O novo turno usa a mesma sessão,
prazo, contador de ferramentas e orçamento. Uso não confirmado é contabilizado
conservadoramente, sem se apresentar como medição informada pelo provider.

Qualquer divergência não explicada gera questions e bloqueia a continuidade.
A resposta deve incluir report_sha256, decision=continue-from-observed-state e
answer, ser vinculada ao relatório atual e passar por nova inspeção. Alteração
posterior invalida o consentimento. A decisão nunca amplia escopo, comandos,
acesso a credenciais, isolamento, critérios de aceite ou orçamento.

Sessões já encerradas/canceladas não são reabertas nem têm histórico reescrito.
Uma sessão completed com verificação pendente permite somente revalidar a tarefa,
sem novos eventos de execução na sessão. Ambientes inseguros, identidade não
comprovada e prazo esgotado não podem ser liberados por uma resposta genérica.

## Verificações realizadas

- Reprovação, diagnóstico, correção e aprovação na sessão original.
- Bloqueio sem diagnóstico e esgotamento do teto de correções.
- Workflow só libera dependências depois da aceitação independente.
- Escrita interrompida depois do efeito, sem duplicação ao retomar.
- Mudança externa gera pergunta; resposta obsoleta não autoriza execução.
- Comando e stream interrompidos exigem resposta explícita antes da continuidade.
- Retomada no workflow compartilha os mesmos serviços e orçamento.
- Kernel: 70 testes; integração de engenharia: 57 testes; rodada final das duas
  capacidades: 11 testes, repetidos com sucesso no pacote externo. Contagens
  sobrepostas, não somáveis. Broker simulado: 3 testes. Estado/documentação: 4.
- Lint direcionado, formatação, manifesto CLI e exemplo público correction passaram.
- Na rodada posterior solicitada pelo usuário, a suíte integral e os gates
  passaram: zero falhas, um teste PostgreSQL ignorado por configuração ausente
  e um aviso histórico. Campanha real e ativação operacional não realizadas.
  Recibo: `evidence/2026-09-25-platform-revalidation/receipt.json`.

Recibo desta ampliação: `evidence/2026-09-25-correction-reconciliation/receipt.json`.

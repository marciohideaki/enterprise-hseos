# Ciclo de estado dos jobs W4

Estado desta documentação: preparação03c e despacho03d integrados; expansão04a1 em validação.
ADR-0045 continua Proposed; migrations012–016 são candidatas para fixtures.
Ativação operacional, publicação e instalação global são decisões separadas.

O ledger do EngineeringControl mantém control_job, control_task, engineering_task e
sessões. Arquivos em jobs/<UUID> são views desse ledger: não são novos ledgers nem
novas autorizações financeiras. Nunca reabrir essas views como fixtures independentes.

Antes do claim, jobs workflow v2 podem receber JobWorkflowExpanded. O comando fixa
o hash anterior, acrescenta nós e revalida o DAG completo sob os limites originais.
CAS, prazo e snapshots são conferidos novamente antes do append. A revisão e sua
admissão são persistidas atomicamente; recibos anteriores continuam imutáveis. Claim
fixa a revisão para materialização e despacho. Expansão após claim permanece recusada
nesta unidade; expansão running e seleção de extensões por nó dependem das próximas tasks.

1. JobCommandRecorded cria a fila sem executar trabalho. Elegibilidade respeita
   horário UTC, dependências, prazo e admissão.
2. JobLifecycleRecorded fixa dono, fence, primeira partida e prazo. Lease vencido
   não autoriza roubar dono vivo ou desconhecido. Reconciliação exige dono morto e
   encerramento comprovado dos processos, mantendo prazo e autorização originais.
3. JobMaterializationRecorded/planned fixa snapshot, IDs e destino. Na mesma
   transação appendBatch, control_task/job_prepared vincula raiz e filhos antes dos
   arquivos. Mesmo sem registered, esses vínculos bloqueiam as rotas antigas de efeito.
4. Preparação completa apenas entradas ausentes. Arquivos existentes exigem conteúdo
   e identidade exatos; links, entradas extras, mudanças concorrentes e bytes parciais
   são recusados sem sobrescrita. Arquivos e diretórios são sincronizados antes do recibo.
5. Task created e sessão são idempotentes. Workflow fixa contratos/IDs de filhos,
   mas somente a sessão pai nasce aqui. Spawn posterior cria attachment/fork/filhos.
6. Após revalidar dono/fence/seq/prazo/cancelamento, ready e registered são escritos
   atomicamente. Ready não significa execução nem aceite; status permanece claimed.

Crash entre fases mantém intenção e IDs. Repetição do mesmo comando reconhece seu
recibo; dono morto exige reconcile explícito antes de novo comando de preparação.
Qualquer evento de atividade além da criação impede essa recuperação de preparação.
Não há retry automático de efeito externo incerto.

O comando público `resume` exige um job `claimed` com dono e fence atuais. Ele
conclui uma preparação `planned` com o plano imutável, inclusive quando o polling
interno iniciou essa preparação, e registra o despacho antes de executar. O mesmo
ID reproduz o recibo de despacho; uma intenção de execução já registrada nunca
é iniciada novamente. Prazo e orçamento continuam os da primeira partida.

Na expansão de workflow em execução, a revisão e os vínculos dos filhos são
confirmados no ledger antes da criação dos arquivos. Falha de CAS não cria
diretório de filho. Se a preparação falhar após o commit, o comando retorna
`JOB_PREPARATION_PENDING`; repetir o mesmo ID ou resolver o filho conclui a
vista a partir do plano persistido, sem registrar outra revisão.

Queries de status/evidence/session usam o handle validado do controle e vínculo
durável. Eventos usam cursor global e filtram os agregados do recurso, sem retornar
outros jobs do ledger. Nenhuma consulta inicializa provider ou aceita caminho do cliente.

JobExecutionRecorded/intent precede probes, contexto e modelo. Capacidade interna
vincula conexão, job, fence, owner e sessões ao comando persistido. Guardas revalidam
prazo, cancelamento, baseline e identidade de campanha antes das fronteiras de efeito.
Reservas monetárias continuam exclusivamente na campanha; ferramentas conservam os
limites da sessão. Settlement exige resultados independentes, sessões encerradas,
reservas próprias resolvidas e drain; ausência de prova produz uncertain.

Polling é iniciado explicitamente pelo serviço, padrão um job por vez. Query/import
não iniciam polling. Dois controladores disputam a fila pelo CAS existente. Shutdown
fecha admissão HTTP, interrompe claims/despachos, cancela/draina owners e aguarda os
requests ativos antes de fechar SQLite. Erro de polling interrompe o loop e é emitido
como código sanitizado; não causa repetição automática de efeito incerto.

Ensaios de backup/restore03d são limitados a fixtures quiescentes: scripted por cópia
no mesmo path; plugin/campanha por restauração in-place preservando identidade física.
Não certificam snapshot ativo, relocação/rebind, rewind monetário ou execução de duas
cópias restauradas. Configuração pinada continua recusando troca de inode/ledger;
nenhuma API de restauração operacional foi acrescentada. Relocação não pode trocar silenciosamente control_directory da intenção.
Recibos de W3 e autorizações monetárias existentes permanecem históricos imutáveis.

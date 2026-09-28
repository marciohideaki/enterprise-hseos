# Ciclo de estado dos jobs W4

Estado desta documentação: preparação03c em validação; despacho03d pendente.
ADR-0045 continua Proposed; migrations012–014 são candidatas para fixtures.
Ativação operacional, publicação e instalação global são decisões separadas.

O ledger do EngineeringControl mantém control_job, control_task, engineering_task e
sessões. Arquivos em jobs/<UUID> são views desse ledger: não são novos ledgers nem
novas autorizações financeiras. Nunca reabrir essas views como fixtures independentes.

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

Queries de status/evidence/session usam o handle validado do controle e vínculo
durável. Eventos usam cursor global e filtram os agregados do recurso, sem retornar
outros jobs do ledger. Nenhuma consulta inicializa provider ou aceita caminho do cliente.

Certificação de backup/restore, polling, despacho e settlement pertence à03d e está
pendente. Relocação não pode trocar silenciosamente control_directory da intenção.
Recibos de W3 e autorizações monetárias existentes permanecem históricos imutáveis.

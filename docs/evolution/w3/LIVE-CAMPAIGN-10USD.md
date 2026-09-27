# Campanha real — autorização de US$ 10

> Checkpoint histórico da primeira tentativa. A correção e o novo ensaio estão em
> [LIVE-REVALIDATION.md](./LIVE-REVALIDATION.md).

O proprietário autorizou a execução com teto global de US$ 10. A autorização
foi materializada em 10.000.000 micros de USD, compartilhados pela campanha,
com limite adicional de dez despachos. Não houve autorização para ampliar quota
nem consumir créditos pagos fora das rotas admitidas.

## Resultado observado

A campanha iniciou pela rota de conta Codex 0.157.1, com identidade fixada e
quota oficial disponível. Créditos pagos adicionais estavam desabilitados na
observação. O controlador reservou a tentativa e despachou o adapter real pela
API loopback autenticada. O processo encerrou sem recibo confirmado: a campanha
preservou a tentativa como incerta e bloqueou repetição automática.

Há **uma tentativa despachada e zero recibos concluídos**. O ledger registra
zero micros de USD comprometidos, pois a rota admitida era de assinatura sem
créditos adicionais. Isso não é uma fatura verificada. Nenhuma inferência pela
API paga foi iniciada. Não é possível atestar conclusão de tarefa ou recuperação.

## Diagnóstico e correção preparada

O launcher atingiu o limite de threads. Afinidade de dois CPUs permitiu inspecionar
conta e quota. Na criação de sessão, uma reprodução registrou EAGAIN no threadpool
Nucleo e 357 eventos de pids.max. O monitor confirmou o limite de 32 ocupado por
sete threads Node e 25 threads do próprio processo Codex; não havia processos MCP
nesse snapshot.

A configuração herdava oito MCPs. Foi preparada uma variante que os desativa
explicitamente, mas **isso não resolveu de forma estável o limite de processos**.
A criação de sessão passou em tentativas isoladas e falhou em outras, sem turnos
de modelo. Experimentos de diagnóstico com tetos finitos 64 e 128 também tiveram
falhas; a variante de 128 teve um sucesso isolado. Esses experimentos ficaram
restritos a processos temporários de diagnóstico. O limite de produção continua
32; não foram editados manualmente o runtime, as credenciais nem o binding original.

A atribuição inicial da falha exclusivamente aos MCPs foi refutada. O esgotamento
de processos está comprovado, mas o perfil estável para este cliente ainda não.
A variante de configuração é uma proposta, não uma correção certificada. A
[biblioteca Nucleo no revision usado pelo cliente](https://github.com/helix-editor/nucleo/blob/4253de9faabb4e5c6d81d946a5e35a90f87347ee/src/worker.rs)
constrói um pool de threads; essa referência não comprova, por si só, qual
componente do cliente dimensionou ou multiplicou os pools nesta execução.

FR04 exige reconciliação vinculada ao estado para efeitos sem recibo. Foi
solicitada decisão explícita para encerrar a tentativa incerta e executar novo
ensaio, preservando o teto total. A reprodução da causa não foi usada para
reclassificar automaticamente o resultado original como não executado.

## Outras famílias

- Claude: credencial global existente no cofre autentica com HTTP 200. SDK oficial
  0.3.283 instalado em diretório temporário externo. A quota de inferência continua
  desconhecida; foi solicitada exceção explícita para até duas chamadas sob o
  teto total. Nenhuma chamada de modelo Claude foi feita.
- API compatível/ACP: a busca nos nomes das entradas do cofre não encontrou uma
  referência identificada para essa rota. Referência solicitada ao proprietário.
- Antigravity: a busca por `.litertlm` em `/workspace/local`,
  `/home/annonymous/.cache` e `/build/tmp` não encontrou checkpoint. Isso delimita
  a busca, sem afirmar ausência em outros locais. Caminho solicitado ao proprietário.

**FR07 permanece aberto.** Os US$ 10 foram autorizados; o orçamento deixou de ser
uma pendência. Permanecem decisões de reconciliação/quota e provisão das rotas
faltantes. Evidências e configuração corrigida: `evidence/live-10usd/receipt.json`.

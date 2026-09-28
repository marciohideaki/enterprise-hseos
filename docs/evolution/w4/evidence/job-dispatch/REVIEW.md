# Revisão W4-03d — em validação

Revisor isolado, somente leitura, sem testes/escritas. Primeira passagem cega:

- Shutdown durante admissão podia deixar intent/efeito após fechamento. Corrigido:
  checagem closing dentro da transação de intent; teste suspende admissão e fecha.
- Filho podia fazer probe antes de revalidar autoridade. Guardas antes/depois do probe.
- Lacuna de prova financeira: settlement agora recusa reservas próprias unresolved.

Segunda passagem:

- Serviço aguardava HTTP antes de cancelar owners. Agora inicia close, cancela/draina,
  aguarda requests e fecha ledger. Teste simula request dependente de cancelamento.
- Claim reinspecionava CAS mas descartava replay concorrente. Agora retorna recibo;
  teste com dois processos usa mesmo command_id e comprova somente dois eventos.

Revisor confirmou correções por leitura, sem novo bloqueio focal. Confronto final dos
recibos Node22/24 e hashes permanece pendente. Backup cobre somente fixtures quiescentes
nos cenários descritos em STATE-LIFECYCLE.md; não certifica ativação/restore operacional.

## Falhas intermediárias preservadas

- Primeiro conjunto ampliado: corrida antiga retornou JOB_NOT_ELIGIBLE em vez de
  CONTROL_SEQUENCE_CONFLICT; reinspeção prioriza CAS e preserva replay idempotente.
- Cobertura inicial dispatcher95.94/83.33; execução total desse conjunto FAIL pela corrida.
- Teste inicial de recibo perdido injetava falha só na instância base, não na facade
  derivada; não perdia recibo. Injeção no prototype reproduziu perda real e teste passou.
- Lint detectou fs.cpSync incompatível com o mínimo22.0 e oito regras de estilo.
  Fixture usa cp do ambiente Linux; estilo corrigido. Nenhum threshold reduzido.
- Pacote1456 > limite1454: FAIL mantido; decisão específica solicitada ao responsável.

## Provas intermediárias

51 testes ampliados PASS; sete mutantes dirigidos rejeitados. Novo run kernel/schema
em Node24 em andamento sobre hashes congelados em .logs/validation. Nenhum resultado
intermediário substitui gate integral ou aceite real de consumidores/contas.

Node24 kernel+schema:819/819,zero falhas/skips,11 críticos90/80. Em seguida,
correção de semântica do dependente queued: predecessor falho deve produzir cancelled,
não invalidated. Única mudança de produção após run:job-dispatch.js; validação
focal final54/54,dispatcher96.08/86.14. Node22 integral em andamento sobre fonte final.
Inventário:1456 arquivos,9,141,678bytes; dois adicionados,nenhum removido.

Node22 kernel/schema final:820/820 PASS,zero falhas/skips;11 arquivos críticos acima90/80;dispatcher95.21/86.08. Processo terminou exit0 e wrapper removeu binding temporário ABI22.

Confronto final isolado:28/28 hashes confirmados; alegações de testes/cobertura confirmadas; sem novo bloqueador. Pós-checks finais22/24:10/10 cada, incluindo7 mutantes rejeitados. Lint/format final exit0 e hashes de fonte inalterados. Pacote/gate integral continuam pendentes; recibo registra limites.

Autorização explícita recebida para1456; pacotePASS22/24. Primeiro gate integralFAIL por hash gerado CLI desatualizado. npm run compile:cli atualizou somente source_sha256 de control.js; repetição do gate em andamento.

O delta do manifesto CLI foi inspecionado: apenas hash source_sha256 do control.js, sem mudança de comandos/opções. Gate npmtest reexecutado após regeneração; falha anterior preservada.

## Corrida detectada pelo hook

Commit bloqueado:209/210 testesengineering, statuscompleted em cancelamentocrossprocess.
Isolado originalPASS; injeção determinística apóstoolintent reproduziuFAIL. Primeiro
ensaio de injeção falhou por prototypefrozen; mudado para ledgerappend, semalterarcontrato.
Causa: policynegava ferramenta ao observar taskcancellation, sem publicar cancelamento
da sessão, que concluía antes do polling50ms. Correção observa nasfronteiraspolicy,
stream e completionreview, via AgentRuntime.cancel; drain aguarda rejeição eventual.
Revisor identificou segunda janela: review retornavanull apóscancel e kernelusavaestado
anterior. Segundo ensaio determinístico modelstop reproduziuFAIL; reviewagoralançaerro
tipado apósrequest, catchcanônico relê e settle. TrêsfocaisPASS. Caminhodriftapósverifier
também observa cancel e preservaincerteza. Oitavomutante taskcancellation acrescentado.
Evidênciasanteriores são históricas; revalidaçãofontefinal obrigatória antescommit.

## Isolamento da instrumentação de mutantes

Novo gate funcionalPASS0fail1warn. Wrapperc8FAIL63.6/62.56:raws incluem sourceoffsets
40424(original),40438(task_cancellation) e40347(task_completion) nomesmoarquivo.
Node24 builtin child_process confirma propagação de NODE_V8_COVERAGE quando a chave
é ausente. Deletá-la do env dos mutantes não bastava. Agora valor vazio explícito
desabilita instrumentação nesses subprocessos. Revisor confirmou escopo: sem mudar
thresholds ou exclusões de fontes; nove mutantes continuam exigindo controlePASS e
mutanteFAIL. Cobertura funcional limpa24 em andamento, resultado anterior permaneceFAIL.

Cobertura funcional limpaNode24:212/212 testes e9/9mutantes;runtime95.35/87.75.
Node22:212/212+9/9;runtime96.32/88.04. Gatefuncional24 pósfixPASS0falhas/1aviso.
Recibo de saída do launcher24 perdeu-se na troca da sessão; logs completos preservados.
Perfil retomado torna.git somenteleitura e não permite escalonamento. Commit pendente,
sem converter bloqueio em conclusão.

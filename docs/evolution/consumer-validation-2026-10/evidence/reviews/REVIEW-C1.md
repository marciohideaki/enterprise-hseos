# Revisao cetica C1 (command_checks) - veredito: APROVAR COM AJUSTES
Repro: /tmp/hseos-crp/rev/attack.test.js, digest.test.js (rodar com cgroup, recipe do lead).

## Achados
1. ALTA - gate contornavel pelo modelo. O entrypoint do command_check so precisa estar em scope.read (contract.js: `commands...readPaths.has(entrypoint)`), e scope.write e subconjunto de read; nada impede entrypoint em scope.write. Repro A: check.js = `process.exit(1);` em read+write, modelo faz engineering.patch para `exit(0)` -> task_result=approved, command_checks=[{check,succeeded,0}]. Controle sem patch -> failed. O verificador roda o script pos-entrega, nao o baseline. Correcao: no parse recusar command_checks cujo entrypoint (e idealmente args que apontem para arquivos) esteja em scope.write, ou executar o entrypoint a partir de initial_files/baseline; documentar que arquivos transitivos (testes/config) em write scope tem o mesmo risco.
2. MEDIA - a "mesma digest anterior" e so estrutural. CODE_SHA256 = hash do proprio engineering-project-verifier.js, alterado pelo diff; digest v2 sem o campo: novo 43e375.. vs master 2f201a.. (diferem). Contratos v2 ja pinados (arquivo salvo) falham em attest ('does not match pinned acceptance') ate serem re-preparados via prepareProjectTask. E o comportamento pre-existente para qualquer edicao do arquivo, mas a alegacao esta superestimada. v1 inalterado (modulo engineering-verifier.js nao tocado).
3. BAIXA - auditoria de correcao: o evento `review` grava so approved/reason/files_sha256; command_checks (qual comando falhou, exit) nao entra no review nem no prompt de correcao ("reason: criteria-not-satisfied"), so no result final. O modelo nao sabe qual comando reprovou; trilha de correcoes sem evidencia do comando.
4. BAIXA - reconciliacao (engineering-reconciliation.js) reexecuta verifyEngineeringTask sem signal, agora rodando ate 16 comandos x 300s; o resultado so valida pre-requisitos, nao aprova. Sem risco de aprovacao, so custo/latencia.
5. INFO - por desenho, exit 0 basta: `vitest --passWithNoTests` ou saida de falha com exit 0 aprova; a semantica do comando e do autor do contrato. Defesa em profundidade em task-state e consistencia do que o runtime escreve, nao verificacao independente (evidencia forjavel por quem escreve o ledger).
Nao reproduzido/OK: id inexistente, lista vazia e duplicado rejeitados no read (Repro C); argv fixo do contrato, sem interpolacao do modelo; outros caminhos de aprovacao: workflow usa runEngineeringTask (approved == task.result), reconcile nao aprova.

## Alegacoes
- campo opcional, gating exit0/succeeded, reprova em exit/sinal/timeout/ausencia: CONFIRMADA (16/16 GREEN, A2 failed).
- evidencia com command_id/status/exit_code: CONFIRMADA. Defesa em profundidade: CONFIRMADA (ver 5).
- definicao entra no digest: CONFIRMADA (mudar args altera digest; ghost id -> pinned error).
- contratos sem o campo mantem digest: PARCIAL (ver 2).
- filhos de workflow: CONFIRMADA (['failed','not_executed']).
- "6 testes novos, RED 6 falhas": REFUTADA na contagem: sao 7 testes novos; no codigo do master 7 falham, mas porque o schema strict rejeita o campo, nao porque o gating foi desligado - RED fraco (nao prova que exit!=0 reprova). A2 (controle) cobre parcialmente.
- timeout sem command_checks na evidencia: CONFIRMADA no teste (comentario); auditavel so por reason/status.

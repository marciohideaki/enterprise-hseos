# W4-04a1 — revisão e falhas preservadas

Escopo: FR04/05/06, workflow-revisions-implementation.md; expansão de jobs workflow
v2 ainda queued, antes do claim. Running, composição de extensões por nó e aceite
integral da W4 permanecem pendentes.

Revisor isolado: review_plugin_providers, leitura apenas, sem executar testes ou
corrigir código. Primeira passagem sem autoavaliação: nenhum bloqueador de código;
lacunas de testes para eventos adulterados, claim durante await, bindings/extensões
e processos distintos. Cenários acrescentados.

Primeiro focal ampliado: 49/51. Duas falhas:

- Pacote 1457 > 1456: único asset novo é migrations-pending-activation/016-job-workflow-expansion.sql
  (394 bytes). Inventário e delta preservados; autorização de 1457 solicitada.
  Limite de 22 MB e exclusões permanecem intactos. Sem aprovação, o gate continua FAIL.
- Baseline: admitCreation valida parser/allowlist, mas não snapshot. O novo comando
  precisava conferir arquivos antes de gravar expansão. A primeira substituição
  textual não encontrou a indentação após format e não alterou o arquivo. O confronto
  do revisor detectou a ausência. Kernel interrompido explicitamente com exit143;
  não utilizado como evidência de sucesso. Patch exato passou a chamar
  projectWorkspaceSnapshot dentro da transação após CAS/admissão e antes de append.

Após a correção efetivamente gravada, focal de expansão: 25/25 PASS, sem skips.
Revisor confirmou o trecho e o log, sem novos achados. Mutantes, cobertura, matriz
Node22/24 e gate integral ainda serão registrados no recibo; este documento não os
antecipa como aprovados.

Compatibilidade: JobCommandRecorded v1 create/cancel intacto, evento separado
JobWorkflowExpanded v1 e migração candidata016; schema operacional permanece v4.
Históricos W3 não foram alterados. Leitura v1 não recebe metadados v2. Recibos create
e expand anteriores permanecem reproduzíveis após novas revisões e reabertura.

Aplicação/enforcement AEW: NOT VERIFIED; sem alegação de ativação operacional.

## Rastreabilidade limitada à unidade

| Contrato | Implementação | Verificação focal |
| --- | --- | --- |
| FR04: revisões append-only e v1 compatível | engineering-workflow-runtime; job-contract; JobWorkflowExpanded | v1 normalized shape; queued revisions chain; only initial v2 revision |
| FR04: DAG e tetos originais | parseEngineeringWorkflow sobre todos os nós | duplicate/missing/cycle/too-many; seis limites agregados |
| FR04/05: CAS, claim, cancelamento e replay | JobControl.expand/projectExpansion | dois controladores; dois processos; claim após await; eventos adulterados |
| FR05: baseline antes de persistir revisão | projectWorkspaceSnapshot dentro da transação | baseline alterado após admissão |
| FR06: mesmo agregado e limites, sem execução na expansão | atualização atômica da admissão/definição | fila agendada sem materialização; despacho idempotente da revisão expandida |

O ensaio de despacho usa consumidor gerenciado local com respostas scripted e
verificador independente. Não representa campanha real com conta elegível nem
certifica paridade CLI/API/SDK das novas operações. Esses aceites continuam em W4-06/07.

## Resultado consolidado

Kernel+schema:847/847 em Node24 e847/847 em Node22, zero falhas/skips. Doze críticos
acima90/80 nas duas versões; mínimos95,21%linhas/83,14%branches. Doze mutantes
rejeitados em24 e22. Lint/format final e diff-check exit0.

Revisão própria identificou que o exemplo de binding tinha max_attempts2. O teste
foi fortalecido para validar primeiro max_attempts1 e exigir CONTROL_BINDING_UNKNOWN.
Nenhuma fonte de produção mudou após kernel/cobertura; o teste fortalecido passou
nas duas versões (25/25 no arquivo). Revisor isolado confirmou18/19 hashes e a única
mudança no teste, sem novo achado. Logs finais mostram25expansão+12mutantes em22 e
25expansão em24; única falha de cada pós-check é pacote1457>1456.

Inventário final:9.148.839bytes, mesmo único asset016 de394bytes; teto22MB preservado.
Decisão de1457 permanece pendente. Gate integral, commit04a1, integração na feature,
PR W4 e fechamento NÃO são declarados aprovados. O recibo explicita continuidade.

Responsável autorizou1457 após solicitação explícita. Pacote revalidadoPASS em22/24;
gate integral24PASS com zero falhas e um aviso preexistente de placeholders. Limite22MB
e exclusões preservados; fontes de produção permanecem idênticas às coberturas.
Commit governado pendente; autorização de pacote não autoriza publicação/ativação.

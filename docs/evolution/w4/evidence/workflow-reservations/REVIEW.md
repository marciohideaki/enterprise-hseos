# Revisão do contrato W4-04a2a

Somente desenho; código ainda não implementado. Base de preparação991e721d;
W4-04a1 deve integrar antes de iniciar a implementação.

Revisor isolado review_plugin_providers, leitura sem testes/escritas. Primeira
passagem apontou: validar checkpoints anteriores na primeira revisão; contar união
de filhos anexados/reservados; não inventar limites de reservas v1; explicitar os
digests correntes nas duas projeções; definir claim corrente versus lease vigente.

Contrato e intake corrigidos. Segunda passagem não encontrou bloqueio adicional de
desenho. Sem execução própria significa ausência de turns/modelo/toolcalls consumidos,
não ausência de configuração de provider na spec de sessão. O pai controlador de
engenharia mantém essa configuração embora não execute turns próprios.

Reutilizar AgentSessionEventRecorded evita migração SQL desnecessária para o novo
tipo interno. Streams antigos continuam legíveis no leitor novo; o leitor antigo
não compreende o evento novo. Engine/running/materialização continuam desabilitados
nesta unidade; não confundir o contrato aprovado na revisão com integração entregue.

Revisão adicional: o engine estático poderia retomar reserva revisada sem checkpoints
usando definição corrente e claim expirado. Acrescentado guard explícito de consumo
prematuro, baseado na reserva persistida, antes de manifest/reclaim/efeitos. Revisor
confirmou esse fechamento; teste exige zero chamadas/eventos e preserva caso v1.

## Implementação retomada em 2026-09-28

O pedido atual retomou explicitamente W4-04a2a. A implementação acrescentou o evento
`workflow.revised` ao contrato/replay existente, validou cadeia de revisões, claim,
checkpoints históricos e tetos originais, e cercou o engine estático. O teste dirigido
usa duas conexões SQLite reais para disputas de revisão/checkpoint/cancelamento.

A revisão cética isolada encontrou uma corrida: uma revisão poderia entrar durante
uma espera assíncrona depois da primeira checagem do engine. Foram acrescentados
fences antes de spawn, checkpoint e release; o caminho de erro drena o filho ativo
e propaga `WORKFLOW_REVISION_NOT_SUPPORTED` sem emitir release obsoleto. A segunda
passagem apontou reserva já liberada sem checkpoint; o guard passou a cobrir toda
reserva com `revision > 1`. A passagem final não encontrou bloqueio estático.
O revisor fez análise de código, sem executar testes; os resultados de execução
constam do recibo separado.

Node 22 e 24: 56/56 testes focados; 16/16 mutantes dirigidos; cobertura kernel dos
arquivos críticos acima de 90% linhas e 80% branches. Gate integral Node 22 passou
com zero falhas/avisos. A validação governada Node 24 também passou com zero falhas
e um aviso preexistente de placeholders em template. O hook de commit ainda será
registrado após execução; não inferir aceite dele a partir dos gates prévios.

Inventário de pacote: npm 10/11 das versões Node 22/24 fixadas na matriz listou
1.457 entradas e passou. Um ensaio ad hoc pelo npm 9.2.0 do shell ambiente listou
1.459 (acrescentou `docs/README.md` e `docs/pt-br/README.md`) e falhou no teto.
Essa divergência de versão foi registrada no recibo; não houve autorização para
elevar o limite, e a entrega usa as versões fixadas nos gates.

Primeira tentativa de commit: hook FALHOU na conformidade canônica de provider.
Uma suíte aninhada preexistente (`test-engineering-task-runtime.js`) saiu com código
1 após os demais testes passarem. O runner não expõe a saída do subprocesso no
recibo de falha, portanto o subteste exato daquela execução é desconhecido. A suíte
isolada passou 15/15; o teste de conformidade completo repetido passou 9/9; o
mesmo runner de descritor com ambiente sanitizado passou 15/15. Logs comprimidos
preservados no recibo. Não houve commit. Nova tentativa de hook é necessária;
falha recorrente exigirá diagnóstico da saída do runner, sem classificar este
resultado como PASS retroativo.

## Confronto final da unidade anterior

Revisor isolado conferiu19 hashes de fontes e33 evidências04a1: pacotePASS22/24,
gate integral24PASS (zero falhas, um aviso). Encontrou duas indicações anteriores
não atualizadas: REVIEW.md da unidade anterior ainda diz decisão/gate pendentes
antes do parágrafo posterior que os confirma; receipt.json.next_action ainda manda
completar gate já aprovado. Interpretar esses trechos como estado histórico superado
pelos resultados PASS no mesmo recibo. Não modificar evidência já em commit durante
hooks. Commit e integração serão registrados aqui quando confirmados, sem presumir
sucesso nem fechamento integral da W4.

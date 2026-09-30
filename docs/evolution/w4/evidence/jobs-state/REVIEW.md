# Revisão W4-03a

Revisor isolado, leitura estática sem testes ou alterações. Escopo: agregado queued,
cancelamento, replay e admissão; não certifica claims/worker/materialização.

## Cega e correções

- P1 binding legado: admissão conferia apenas ID. Aceito; readProviderBinding e
  validateEngineeringBinding agora fixam conteúdo normalizado/digest, sem provider.
- P1 identidade materializada: conflito unilateral. Aceito; controle imediato
  verifica control_job antes e dentro da transação. Jobs fazem verificação recíproca.
- P2 replay semanticamente inválido com hash recalculado. Aceito; parser puro
  compartilhado e validação da coerência definição/admissão, binding/hash, seleção
  e modelo/campanha/recurso. Presença/exclusividade de fonte também movida ao parser.
- P2 ISO UTC expandido ordenado por string. Aceito; comparação por Date.parse.

Revisor confirmou correções P1, UTC e ausência de I/O no replay. Última extensão
da correção de exclusividade e confronto final ainda pendentes.

## Limites

Testes locais usam fixtures temporárias, sem ativar schema operacional ou chamar
conta paga. Elegibilidade é observação, não despacho. Cobertura anterior: 60/60,
três arquivos críticos acima de 90/80; produção mudou depois para fechar exclusividade.
Rodada final, Node22, gate e commit ainda pendentes.

Última revisão estática confirmou presença/exclusividade e nenhum novo bloqueio.
Node24 final 63/63; Node22 80/80; zero skips em ambas. Cobertura detalhada no JSON.
Pacote passou com limite de 1450 entradas e mesmas exclusões de estado/segredos.
Gate integral e confronto dos recibos ainda pendentes.

## Confronto final

Revisor conferiu os dez hashes do recibo e os logs: Node24 63/63, Node22 80/80
e complemento pós-lint 22/22, zero skips; três críticos acima de 90/80. Confirmou
casos negativos, pin de binding e disputa por ID. Nenhum bloqueio de código
remanescente. Teste de pacote examinado pelo log, não repetido pelo revisor.
Gate integral segue pendente; nenhuma certificação de worker ou campanha real.

## Gate integral

Gate integral Node24 PRÉ-CORREÇÃO DE LOCK: PASS, exit 0, zero failures, um warning preexistente de
placeholders em epics-template.md. Log comprimido anexado. Commit/hook pendentes.

## Hook bloqueado e correção de concorrência

Hook posterior ao gate falhou SQLITE_BUSY_SNAPSHOT em cancelamento entre processos.
Revisor confirmou que a transação externa deferred lia antes do lock; immediate
interno do ledger não antecipa lock da transação externa. Duas reproduções
determinísticas confirmaram SQLITE_BUSY_SNAPSHOT (append e reconciliação de task).
Workflow apresentou resultado blocked na mesma disputa. Todos logs preservados.

Correção: BEGIN IMMEDIATE nas três fronteiras externas; sem retry automático,
sem alteração da sequência esperada. Primeiras duas correções passaram 12 testes.
Rodada ampliada de cobertura/Node22/gates e confronto da revisão nova pendentes.

## Confronto da correção de lock — Node24

Revisor conferiu 15/15 hashes e 183/183 testes Node24, zero falhas/skips, incluindo
os três testes determinísticos de lock. Seis críticos superam 90/80; mínimos
95,36% linhas (task-runtime) e 82,55% branches (task-state). Nenhum novo bloqueio
de código. Node22, novo gate e hook permanecem pendentes. O gate verde anterior
certificava a revisão anterior ao lock, não a revisão atual.

Node22 da correção de lock também PASS: 183/183, zero falhas/skips; log anexado.
Novo gate integral e hook ainda pendentes.

Confronto final pós-lock: revisor confirmou Node22 183/183, três provas de lock e
15 hashes atuais. Gate/hook continuam pendentes. Lint delta retornou exit 0 no
recibo da ferramenta (session 93611); log sem diagnósticos não é prova isolada do
exit. Tabelas c8 normalizadas somente removendo espaços ao final das linhas.

## Investigação da falha de conformance pós-lock

Gate falhou; causa não comprovada. Descriptor isolado: 18/18; build canônico: PASS
com inventory_stable=true; teste externo instrumentado: 9/9 sem skips. Esses
resultados não invalidam a falha anterior. Mensagem de assert agora inclui
identidade/hash/status por suíte; revisão independente confirmou que os critérios
de aprovação permanecem iguais e a mensagem não contém credenciais.

Gate integral instrumentado terminou exit 0: zero falhas, dois avisos (placeholder
de template e palavra openai em diff de contratos). Conformance passou nesta
sequência; não se afirma correção da falha histórica sem causa comprovada.

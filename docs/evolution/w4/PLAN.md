# W4 — implementação, validação e entrega

Tipo: plano de execução autorizado pelo usuário em 2026-09-27.
Escopo: W4; W5–W8 e quarta família permanecem fora desta entrega.
Base: `32eaef270f192fcc58056f96a3cad39c265cd455`, após PR #180.
Feature: `feature/hseos-evolution-w4`; upstream: `feature/hseos-evolution-foundation`.
Task inicial: `task/hseos-w4-contracts` (W4-01).
Governança: `AGENTS.md`, Constituição §§2.3/2.6/5/7, políticas de ADR e validação automatizada.

## 1. Resultado do confronto com o estado atual

W4 deve estender e certificar a base existente. A análise recebida do planejamento
relata 30 testes focados aprovados em Node 24; isso não certifica W4 nem constitui
verificação desta task.

| Área              | Base relatada                                                                        | Trabalho efetivo                                                   |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Gateway           | ToolRuntime exige contrato governado, sela registro e controla execução/cancelamento | Admitir extensões sem caminhos alternativos                        |
| Plugins           | Marketplace instala superfícies compiladas; AdapterBase é contrato de compilação     | Contrato de execução, admissão e isolamento                        |
| Agendamento       | Fila em memória                                                                      | Jobs pontuais persistentes, elegibilidade, ownership e recuperação |
| DAG               | Dependências estáticas, ciclos, limites agregados e fases                            | Expansão dinâmica controlada, joins e invalidação                  |
| Recuperação       | Claims, sequência esperada, dono morto e reconciliação                               | Aplicar garantias à fila e novos comandos                          |
| Cancelamento      | Propagação e encerramento de descendentes                                            | Fila, plugins, expansão concorrente e múltiplos controladores      |
| Orçamento         | Reserva monetária composta W3 e limites de workflow                                  | Integrar autoridades sem novo saldo nem dupla contabilização       |
| Interfaces/perfis | CLI/API/SDK e catálogo                                                               | Jobs/extensões, instalação, lazy loading e compatibilidade         |

Decisões confirmadas: agendamento pontual e por dependências, sem recorrência;
falha de nó interrompe despachos e cancela/drena a árvore; aceite exige consumidores
locais reais e contas atuais elegíveis sem ampliar teto; quarta família somente
após todas as fases.

## 2. Arquitetura e comportamento

### Plugins de execução

- Estender catálogo com formato versionado de descritores de execução, mantendo leitura v2. Distinguir ferramenta, model provider, runtime provider e fonte de contexto.
- Manifesto fixa identidade, versão, compatibilidade, conteúdo por hash, entrada, capacidades e limites. Inspeção/resolução leem dados sem importar código.
- Código externo roda em processo isolado reutilizando executor, política e broker. Não recebe ledger, credenciais ou objetos internos do kernel.
- Ferramentas passam por ToolRuntime; providers por contratos próprios e controle de campanha; contexto entra no assembler com origem identificada.
- Conformance também roda isolada; não reutilizar testes no host para admitir código externo.
- Seleção fica fixada por execução. Atualização vale para novas execuções, sem trocar código de jobs em andamento.

### Jobs persistentes

- Agregado no ledger existente; fila em memória é projeção reconstruível, preservando scheduler governado de efeitos.
- Referenciar tarefa/workflow, definição fixada, horário UTC, dependências, prazo absoluto, orçamento e configuração admitida.
- Criar não executa. Controlador revalida baseline, autorização, prazo e orçamento antes do primeiro efeito.
- Espera não consome duração de execução. Primeira partida fixa prazo limitado pelo prazo absoluto; retomada não renova prazo.
- Vencido não executa. Atrasado dentro do prazo fica elegível uma única vez.
- Claims usam sequência esperada e fencing persistente. Lease vencido não autoriza tomar trabalho de dono vivo ou desconhecido.
- Incerteza após possível efeito bloqueia despacho até reconciliação; sem retry automático externo incerto.
- Worker integra serviço de controle existente, concorrência padrão um; testes com dois processos.

### DAG, descendentes e falhas

- Definição v2 mantendo leitura/replay v1. Preservar ciclos, dependências, limites e identidade.
- Expansão é comando governado que acrescenta nós com sequência esperada e definição atual fixada.
- Não alterar retroativamente nós iniciados, resultados ou critérios de aceite. Baseline alterado invalida dependentes não despachados.
- Join exige sucesso verificado de todos os predecessores; término do modelo não substitui aceite.
- Falha bloqueia despacho, persiste cancelamento e drena filhos, plugins e processos. Resultados anteriores permanecem evidência.
- Árvore terminal não ressuscita. Nova tentativa exige comando explícito, vínculo com anterior e orçamento original; não repetir automaticamente resultados aceitos.
- Expansão consome limites atuais de tarefas, paralelismo e recursos; não os amplia.

### Orçamento e interfaces

- ProviderCampaignControl é autoridade monetária; sessão/workflow são autoridade de recursos. Jobs referenciam ambas sem saldo independente.
- Reserva antes do efeito, IDs estáveis e recuperação entre job/reserva/despacho. Reserva incerta permanece comprometida.
- Comandos de criação, cancelamento e recuperação/reconciliação; consultas de estado e eventos com cursor.
- `/v1/jobs/commands`, `/v1/jobs/{id}`, `/v1/jobs/{id}/events` seguem autenticação, envelopes, idempotência e sequência esperada existentes.
- Paridade CLI e SDKs JavaScript/TypeScript/Python; compatibilidade dos endpoints atuais.
- Instalação local governada; HTTP não recebe código executável enviado pelo cliente.

## 3. Sequência e entregas

Cada subdivisão terá task isolada e commit próprio; W4 terá uma PR.

| Etapa                          | Saída                                                                                     | Condição de avanço                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| W4-01 Contratos                | spec/design/tasks, intake v2, reuso e ADR proposto                                        | Contratos/estados/versões/falhas definidos; arquivos e comandos explícitos                        |
| W4-02 Extensões                | Manifesto/admissão, isolamento e integração subdivididos                                  | Válido funciona; desconhecido/adulterado/incompatível/excesso de autoridade falha antes do efeito |
| W4-03 Jobs duráveis            | Agregado/projeção, horário/dependências, claims, recuperação e materialização idempotente | Reinício/disputa preservam identidade sem duplicar criação/execução                               |
| W4-04 DAG dinâmico             | v2, expansão, joins, invalidação e cancelamento                                           | Limites respeitados; falha bloqueia despacho e encerra descendentes                               |
| W4-05 Orçamento integrado      | Jobs/workflows/plugins ligados à campanha e recursos                                      | Concorrência/reinício/troca de binding não excedem teto nem liberam incerteza                     |
| W4-06 Superfícies/distribuição | CLI/API/SDK, catálogo, seleção, offline, upgrade/rollback                                 | Consumidores instalados observam mesmos IDs/eventos/estados/orçamento                             |
| W4-07 Ensaios                  | Fault injection, consumidores externos e campanha elegível                                | Evidência real separada de fixtures; recuperação/cancelamento comprovados                         |
| W4-08 Fechamento               | Matriz, cobertura, revisão cética, docs e PR                                              | Critérios satisfeitos; pendências classificadas                                                   |

Campanha real demonstra jornada integrada plugin/job/DAG com provider local e
binding elegível; não repete certificação W3. Teto histórico US$ 10, reservas US$ 9.
Priorizar bindings sem cobrança adicional. Crédito/saldo não substitui autorização
válida; insumo indisponível mantém aceite real pendente.

## 4. Verificação e pronto

### Pronto para implementar

Spec incorpora decisões; design/tasks definem contratos, entradas/saídas,
dependências e verificações executáveis; intake identifica consumo/extensão e ADRs
propostos com aprovação explícita; Linux/toolchains/isolamento/serviços verificados;
nenhuma dependência de W5–W8 ou quarta família bloqueia W4.

### Pronto por tarefa

Positivos/negativos passam no delta; compatibilidade testada; nenhum efeito antes
de admissão/reserva; evidência registra revisão, ambiente, comando, resultado e
limitações; gate passa antes do commit, sem exceção silenciosa.

### Matriz obrigatória

| Grupo        | Cenários mínimos                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Plugins      | Efeito durante import, troca após admissão, saída malformada, timeout, filho sobrevivente, segredo/rede/workspace indevidos             |
| Jobs         | Antes/depois do horário, expiração, reinício pendente, dois controladores, dono vivo/morto/desconhecido, repetição e sequência obsoleta |
| Falhas       | Crash antes/depois de criação, reserva, despacho, efeito e recibo; recuperação sem repetir efeito incerto                               |
| DAG          | Ciclo, dependência inválida, expansão duplicada/concorrente, limite, join parcial, baseline alterado, cancelamento durante expansão     |
| Orçamento    | Reservas concorrentes, recibo perdido, cancelamento, troca de backend, filho tardio, segundo saldo para mesma autorização               |
| Distribuição | Fora do checkout, offline, help/import sem providers, módulo não selecionado, upgrade e rollback                                        |
| Paridade     | Jornada CLI/API/SDK JS/TS/Python; cursor e resultados equivalentes                                                                      |

### W4 tecnicamente pronta

- FR01–FR08 implementados e evidenciados, sem omitir células obrigatórias.
- Suíte integral e gates Node 22 e 24, sequencialmente.
- Cobertura por arquivo crítico >=90% linhas e >=80% branches, incluindo novos não executados.
- Mutantes dirigidos de autorização/orçamento/recuperação rejeitados.
- Consumidores externos reais ferramenta/provider/contexto sem mudar kernel.
- Campanha integrada prova bindings usados, recuperação e limites.
- Cancelamento prova término de processos/descendentes; sem prova fica incerto e não passa.
- Revisão adversarial confronta afirmações/evidência, registra refutações e fecha bloqueantes.
- Docs distinguem determinístico, consumidor real e ativação.

## 5. Git e limites de conclusão

Feature sobre foundation W3; transportar somente documentos W4, preservar W5–W8
e recibos W3. Tasks isoladas. PR com FR→task→teste→evidência, matriz, compatibilidade
e limitações. Pronta para merge exige critérios técnicos e checks verdes.
Entregue na foundation exige autorização específica de merge, closeout e
ancestralidade. Publicação, instalação global e ativação são decisões separadas.

Este registro persiste a intenção fornecida pelo usuário. Não certifica implementação,
não aprova ADR e não altera memória canônica. Próxima unidade: W4-01.

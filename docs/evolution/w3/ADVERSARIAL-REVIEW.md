# Revisão adversarial W3 — 2026-09-26

## Veredicto

**Não aprovar o fechamento de W3.** A revisão de conformidade com a especificação
falha em FR07: não existem recibos da campanha real neste incremento. A análise
adversarial abaixo avalia o candidato e não substitui essa etapa. A implementação
das quatro factories e da ponte foi exercitada deterministicamente; integração
com fornecedores, recuperação nativa real e encerramento integral da entrega
continuam sem certificação. Revisão executada no mesmo contexto de trabalho,
sem parecer independente de outro revisor.

## Afirmações confrontadas

| Afirmação                                              | Tentativa de refutação / evidência                                                                                      | Conclusão                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Há quatro adapters implementados                       | Registro CLI, factories sem imports fornecidos pelo HTTP, workers e testes de protocolo                                 | Sustentada como implementação candidata; não como conformidade real                                  |
| A ponte Antigravity debita o orçamento composto        | Python chama HTTP loopback real nos testes; o adapter filho verifica a reserva antes do efeito                          | Sustentada para o protocolo local; inferência oficial ainda não executada                            |
| O modelo pode escolher qualquer filho                  | Corpo deve ser exatamente `{}`, binding fixado e capability de uso único; tentativas de ampliação e repetição recusadas | Refutada pelo contrato e testes locais                                                               |
| Pai bem-sucedido implica chamada subordinada           | Factory exige conclusão da ponte; teste sem invocação termina incerto                                                   | Sustentada no candidato                                                                              |
| Shutdown sempre podia fechar o ledger                  | Inspeção ocorria antes do acompanhamento de drains                                                                      | Falha corrigida: inspeção abortável e operação inteira aguardada antes de close                      |
| Quota positiva garante admissão financeira             | Contraexemplo: requests disponíveis com saldo monetário zero                                                            | Refutada; saldo insuficiente agora prevalece                                                         |
| GET de modelos prova quota Claude                      | Endpoint autentica a chave, mas seus headers não comprovam o bucket de inferência                                       | Refutada; quota permanece desconhecida, bloqueada salvo exceção explícita e expirável                |
| Uso nativo é sempre uso do turno                       | Codex total acumula a sessão; Claude separa tokens de cache                                                             | Refutada; usa Codex last e soma entrada/cache Claude; testes cobrem o cálculo                        |
| Resume mantém a mesma sessão                           | Sessão Claude ausente podia virar sessão nova; identidade de recibo não era preservada                                  | Corrigido para recibo conhecido: escopo fixo, identidade conferida, nova reserva e ausência recusada |
| Identificador aceito pelo mock é aceito pelo SDK       | SDK oficial rejeitou identificador menor que 32 caracteres                                                              | Corrigido no cliente Python e recibo Antigravity; reteste oficial com UUID                           |
| Recibo perdido é recuperado automaticamente            | Sem identidade persistida não há vínculo seguro de sessão para resume                                                   | Refutada; resultado incerto exige reconciliação e não dispara retry automático                       |
| Cgroup equivale a sandbox completo                     | Worker/SDK mantém acesso de filesystem do usuário; observar evento de efeito pode ocorrer depois da tentativa           | Refutada; apenas contenção de recursos/drain comprovados. Isolamento forte não certificado           |
| Hash do adapter atesta a instalação inteira            | Digest cobre lista explícita de arquivos, não todo pacote/dependência transitiva                                        | Refutada; escopo do digest documentado                                                               |
| Configuração oficial SDK prova inferência local        | Teste bloqueia rede/processos e usa placeholder de checkpoint                                                           | Refutada; comprova somente aceitação da configuração SDK 0.1.18                                      |
| Reserva local equivale ao teto imposto pelo fornecedor | Custo final pode ser desconhecido; múltiplas chamadas internas e políticas remotas não são integralmente verificadas    | Refutada; reservas não são fatura nem limite financeiro remoto certificado                           |
| Suíte histórica verde certifica código novo            | Módulos e contratos mudaram depois dos recibos anteriores                                                               | Refutada; somente evidência campaign-adapters cobre este incremento                                  |
| Campanha real foi concluída                            | Não há teto USD nem bindings/referências/checkpoint autorizados e provisionados nesta sessão                            | Refutada; nenhuma inferência de fornecedor foi realizada                                             |

## Riscos e requisitos ainda abertos

- **Alta — entrega funcional:** FR07 exige tarefa e recuperação nos quatro
  ecossistemas, com identidade, consumo e recibos reais. Transporte injetado e
  fixtures não satisfazem esse aceite.
- **Alta — fronteira operacional:** cgroup controla memória/processos e permite
  drain; não atesta confinamento de arquivos ou prevenção integral de efeitos
  dos SDKs nativos. O candidato não deve ser promovido a execução host irrestrita
  por inferência a partir desses testes.
- **Alta — custo/quota:** referências, teto finito e decisão sobre quota desconhecida
  precisam vir do proprietário. Não se criou waiver implícito. Créditos adicionais
  da rota de assinatura são recusados; custo remoto desconhecido retém a reserva.
- **Média — recuperação:** resume de recibo conhecido foi implementado, mas a
  existência, continuidade e custos da sessão remota exigem ensaio real. Perda do
  primeiro recibo não tem recuperação automática certificada.
- **Média — provisão local:** LiteRT precisa de checkpoint válido e compatível com
  CPU e limite de memória (256 MiB padrão; até 2 GiB explícitos). O placeholder
  usado no teste de configuração não é um modelo utilizável.
- **Média — retenção:** estado segue temporário; reabrir SQLite não comprova
  durabilidade após limpeza, migração ou operação contínua.

## Evidência e próximos critérios

Resultados atuais e hashes estão em `evidence/campaign-adapters/receipt.json`.
Os recibos em outros diretórios são checkpoints históricos preservados. Nenhum
contador de testes, registro CLI ou resultado de configuração deve ser citado
como campanha real. A reavaliação de fechamento precisa incluir evidência FR07,
regressão/cobertura do snapshot final e consumidor instalado. Commit/PR W3 segue
condicionado às entregas e validações previamente solicitadas.

## Reexercício real posterior

O [relatório de revalidação](./LIVE-REVALIDATION.md) registra duas falhas reais
identificadas e corrigidas, o piloto Codex com criação/retomada comprovadas e as
refutações adicionais. Esse resultado sucede as limitações de ausência de ensaio
Codex deste checkpoint, sem fechar a conformance das outras três famílias.

## Verificação real Claude posterior

O [ensaio Claude corrigido](./CLAUDE-VERIFIED.md) comprovou o evento de progresso
não reconhecido, sua correção restrita e um recibo real com replay idempotente.
A reanexação sem inferência foi verificada separadamente; não equivale a provar
um novo turno continuando a conversa. Custos nativos observados não liquidaram
reservas nem foram apresentados como fatura.

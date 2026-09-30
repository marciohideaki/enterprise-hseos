# Intake v2 — W3: extend

Tipo: decisão de intake. Owner: HSEOS engenharia. Resultado: extend.
Autoridade: Constituição §2.6, capability-graph, ADR-0043/0044.

Consulta exata em 2026-09-26: `hseos capability-check provider` encontrou
ProviderManifestSchema em packages/agent-runtime-contracts/provider-contracts.js,
OpenAICompatibleModelProvider, AcpRuntimeProvider e HostedRuntimeProvider.
`validate-capability-reference-corpus.js --query provider` retornou [] no corpus
local importado; essa busca não prova ausência global. Busca semântica indisponível:
índice Axon local não encontrado no preflight.

Grafo inspecionado: .enterprise/governance/capabilities/fragments/enterprise-hseos.yaml,
capability.hseos.project-engineering, contract.hseos.control.v1, module.hseos.control.
Catálogo operacional inspecionado: tools/lib/agent-provider-conformance.js,
PROFILE_CONTRACTS/PROVIDER_SPECS; contém model/runtime e três runtimes candidatos.

Reuso: schemas/ports de provider; BindingSchema/readProviderBinding existentes;
adapters runtime/model e validação de ambiente; EngineeringControl/SDKs;
ExecutionEventLedger para reservas e observações. Consumidores: CLI, serviço
HTTP loopback, JS/TS/Python e campanha instalada. Não promover padrão a outro core.
O envelope de cobrança/controle pertence à fronteira do produto HSEOS e estende
o binding; não duplica inferência, transporte, store de credenciais ou kernel.

Controles: schema estrito, versões/digests, segredo por referência, identidade
efetiva observada por adapter confiável, quota desconhecida fecha admissão,
reserva durável e reconciliação explícita, testes de falha/concorrência. Adicionar
registro de evidência/testes ao fragmento canônico ao entregar a capacidade.

Produtor global e709368: governance-discovery, Constituição e core/\_INDEX lidos.
AEW inspecionado separadamente: binário disponível, `aew stack resolve` para o
checkout recusou por não encontrar base configurada. Isso não prova ausência
global; aplicação/enforcement permanecem não verificados nesta sessão.

## Extensão local LiteRT e protocolo ACP — 2026-09-26

Resultado: extend; owner HSEOS engenharia. Consulta `hseos capability-check
provider` confirmou `AcpRuntimeProvider`, `HostedRuntimeProvider`, schemas e
`OpenAICompatibleModelProvider`. Grafo reconsultado:
`.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml`, nós
`capability.hseos.project-engineering`, `contract.hseos.control.v1`,
`module.hseos.control`, `package.hseos.control-sdk`. Busca semântica adicional:
indisponível nesta execução; não usada para afirmar ausência global.

Reutilizar `AntigravityKernelClient`, `createAntigravityCampaignAdapter`, supervisor
cgroup, bridge e ledger para completar inferência local e composição. Reutilizar
`ProcessAcpPeer` para exercitar um agente ACP real. Consumidores: campanha CLI/API,
SDK Python e runtime delegado. O provisionamento fica fora do pacote publicado,
com versões, checkpoint e hashes fixados. Não criar runtime ou orçamento paralelos.

Critérios: inferência LiteRT real, ponte de ferramenta efetivamente chamada,
reserva pai/filho no mesmo orçamento, limpeza de descendentes, retomada observada
sem alegação de conformance completa. Respeitar teto monetário global de US$ 10,
reservas anteriores, nenhum segredo em evidências. API Gemini terá credencial
explicitamente indicada pelo proprietário; testes API adiados por instrução dele.

### Correção da conexão local — 2026-09-26

Resultado `extend`: reutilizar `AntigravityKernelClient`, `LocalOpenAIConnectionStrategy`
e o tradutor `LiteRTOpenAIHandler` do SDK 0.1.18. A rota gerenciada LiteRT desse SDK
omite orçamento e métricas e executa aquecimento fora da admissão. O HSEOS controla
o ciclo de vida do engine LiteRT 0.17.1 e do servidor loopback, sem aquecimento;
a configuração derivada repassa orçamento ao construtor público da estratégia.
As métricas vêm do benchmark nativo, nunca de estimativas de texto. O servidor
restringe chamadas e saída restante; capacidade de contexto é conservadora por
chamada. Origem e versões permanecem fixas. Novos arquivos entram no hash do adapter.
O grafo, consumidores e descoberta semântica são os mesmos do intake acima.
Risco: APIs auxiliares do SDK são internas; versões diferentes devem falhar fechadas,
e testes reais precisam verificar métricas, ferramenta, retomada e esgotamento.

### Subordinado cliente terminal

A composição local precisa consumir o adapter de conta já validado, cuja identidade
é `client`, não `model`. Estender `ProviderCampaignControl.validateComposition` para
permitir filho `model` ou `client` terminal. Não converter identidade de cliente em
modelo. Rejeitar filho ausente, auto-referência, runtime delegado e qualquer filho
com composição própria: profundidade máxima continua sendo um pai e seus filhos.
Escopo, inspeção, reserva, fence e cancelamento usam o fluxo existente. Essa extensão
é necessária para exercitar a ponte sem API paga; não autoriza gastos adicionais.

## Incremento ACP restrito — 2026-09-26

Escopo autorizado: compatibilidade ACP → fronteira de efeitos → campanha. Reutilizar
`ProcessAcpPeer`, `AcpRuntimeProvider`, supervisão por cgroup e ledger da campanha.
A consulta nominal `hseos capability-check AcpRuntimeProvider` não encontrou candidato;
a inspeção do pacote `packages/runtime-providers` encontrou a implementação canônica.
O grafo `.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml` mantém
`capability.hseos.project-engineering` / `contract.hseos.control.v1` como proprietários.
Não criar transporte, ledger ou contrato paralelos. Compatibilidade específica fica
na extensão de peer; o contrato L0 permanece estrito. AEW: aplicação/enforcement não
verificados neste incremento. Baseline global: distribuição `e709368ead6e53ee1fd8e4428bc8913a3a4e8292`,
Constituição §2.6 e política `governance-discovery.md`.

A configuração read-only isoladamente não atesta instructions-only. O candidato usa
catálogo fixado e flags de inicialização, com prova offline dos tools enviados e
recusa de chamadas forjadas. Só admitir a composição após essa verificação. Nenhuma
nova chamada paga está autorizada; o teto cumulativo continua USD 10, com USD 8 de
reservas históricas retidas. Não alterar evidências históricas.

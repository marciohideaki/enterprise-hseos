# W4-05 — vínculo de campanha do job

Tipo: contrato de implementação e intake v2. Base `b6282f2e`; FR05/06;
extensão de [jobs.md](jobs.md) e ADR-0045.

## Intake de capacidade

- Necessidade e escopo: ligar jobs ao controle monetário existente, sem criar
  saldo, campanha ou contrato paralelo. O orçamento de recursos permanece nos
  limites de sessão e workflow.
- Consulta exata: `.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml`
  contém `capability.hseos.project-engineering`, `contract.hseos.control.v1`
  e `module.hseos.control`; busca por `provider`, `campaign` e `job` nesse
  fragmento não encontrou nó próprio. `hseos capability-check
ProviderCampaignControl` não retornou candidato. O corpus de referência
  consultado com `--query capability.hseos.project-engineering` retornou `[]`.
- Consulta semântica: indisponível nesta task; nenhuma relação derivada será
  tratada como autoridade.
- Resultado: **extend** do controle HSEOS já proprietário de
  `ProviderCampaignControl`, sem novo export ou package. Consumidores são os
  jobs locais e os SDKs W4-06. Não há exceção nem promoção.
- Conformidade: provar autorização reclamada uma vez, campanha aberta,
  identidade de binding, escopo do job, request pinado, reserva antes do
  efeito, recibo incerto comprometido e replay sem nova despesa. Manter o
  grafo sem novo nó nesta unidade; avaliar extensão do fragmento apenas se
  uma nova superfície versionada for criada.

## Encadeamento durável

O evento inicial do job contém o pin de campanha; o stream da campanha contém
`authorization_id` e o manifesto do binding; a reclamação da autorização
aponta de volta à campanha. A intenção de despacho do job precede o
`plugin_request` de ID estável, que precede `reserved` no mesmo stream da
campanha. O adapter consulta a reserva antes de executar o plugin. Query e
admissão rejeitam cadeia de autorização incompleta ou divergente. Uma reserva
sem recibo continua comprometida; reconciliação é explícita e não reexecuta
o request. Reinício e troca de binding não criam outro saldo.

Testes positivos e negativos exercitam a cadeia completa, CAS concorrente,
reabertura, binding trocado, reserva incerta e ausência de autorização.

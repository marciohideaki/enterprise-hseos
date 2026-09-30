# W4-06a — superfícies de jobs

Tipo: contrato de implementação e intake v2. Base `4b11599a`; FR03/05/06/08;
extensão de [jobs.md](jobs.md) e ADR-0045.

## Intake de capacidade

- Necessidade: expor criação, cancelamento, reconciliação e consulta de jobs
  por CLI, HTTP e SDK JS/TS/Python, sem criar um controle paralelo.
- Consulta exata: o fragmento
  `.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml`
  registra `capability.hseos.project-engineering`,
  `contract.hseos.control.v1`, `module.hseos.control` e
  `package.hseos.control-sdk`. `hseos capability-check ControlClient`
  não retornou candidato adicional. O corpus de referência consultado com
  `--query capability.hseos.project-engineering` retornou `[]`.
- Consulta semântica: indisponível nesta task. Nenhuma relação derivada é
  tratada como autoridade.
- Resultado: **extend** do contrato e SDK proprietários do controle HSEOS.
  Consumidores são automações locais e a jornada W4-07. Sem promoção,
  exceção ou novo pacote.
- Conformidade: mesmo token de loopback, limite de corpo, envelope de erro,
  CAS/idempotência e cursor dos recursos existentes; comandos internos
  permanecem inacessíveis. Testes HTTP, JS, Python e CLI confirmam IDs e
  cursor; o TypeScript declara os mesmos métodos. Sem ativação operacional.

## Roteamento

`POST /v1/jobs/commands` aceita `create`, `retry`, `cancel` e
`reconcile`; os dois últimos respeitam o owner/fence e nunca repetem efeito.
`GET /v1/jobs/{id}` e `/events?after=&limit=` usam a projeção do ledger.
O POST recusa `initial_files` em qualquer contrato de task ou workflow antes
de escrever o stream, para impedir upload de código pelo controle remoto.
O CLI usa `job-command`, `job-query` e `job-events`; os SDKs seguem os nomes
das superfícies existentes. `link_retry` e comandos de worker/dispatcher são
internos e recusados pela porta pública. Expansão dinâmica permanece na porta
interna da W4-04a2c, fora deste endpoint.

`resume` consta do contrato de design W4, mas não do aceite W4-06a definido
em `tasks.md`. Sua semântica de retomada após owner morto ainda requer uma
unidade própria; esta entrega não a declara implementada. O fechamento W4-08
deve resolver essa lacuna ou registrar decisão humana de escopo.

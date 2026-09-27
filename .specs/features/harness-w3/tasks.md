# Tasks W3

Estado corrente: T1–T4 implementadas e validadas; T5 validada para as famílias
atuais, com a quarta diferida por decisão do dono após todas as fases.
Matriz/cobertura Node 22/24 e campanhas reais aprovadas. Evidências e limites
em `docs/evolution/w3/CLOSEOUT.md`. Checkpoints abaixo preservam a evolução.

Todas sequenciais, execution_mode=isolated. Entrada comum: spec/design W3,
contratos de provider, agent-provider-binding/conformance, EngineeringControl e
ExecutionEventLedger. Saída de cada task inclui testes e evidência própria.

| ID  | Escopo                                | Dependência             | Arquivos previstos                                                          | Aceite                                                                                        |
| --- | ------------------------------------- | ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| T1  | Medium: contrato e catálogo oficial   | W2 validada             | tools/lib/provider-control-manifest.js, catálogo W3, testes                 | schemas estritos, classificação por binding, drift e compatibilidade v1                       |
| T2  | Large: admissão e orçamento durável   | T1                      | controle de providers integrado a EngineeringControl/HTTP/CLI/SDKs e testes | reserva antes do efeito, CAS/idempotência, quota/expiração, concorrência e replay sem reset   |
| T3  | Large: adapters e cliente Antigravity | T2                      | runtime/model providers existentes, cliente oficial SDK, testes             | identidade efetiva e lifecycle por superfície; falha fechada sem tools fora da fronteira      |
| T4  | Medium: instalação e matriz           | T3                      | documentação, consumers, recibos                                            | Node 22/24, instalação externa, cobertura 90/80 e regressão completa                          |
| T5  | Large: campanha real                  | T4 + bindings/orçamento | runner e recibos de campanha                                                | tarefa e recuperação nos quatro ecossistemas; custos/limites observados e resultado auditável |

Verify step de cada implementação: suíte focada do módulo; T4 executa
`VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh --phase full` e
`npm run test:kernel-coverage` em ambiente delegado, um runtime de cada vez.
T5 só termina com recibos reais; ausência de autorização/provisão não é PASS.
Estado atual: T1 e T2 em implementação; sem certificação de campanha.

Arquivos de T1: `tools/lib/provider-control-manifest.js`,
`test/helpers/provider-control.js`, `test/test-provider-control-manifest.js`.
Arquivos de T2: `tools/cli/lib/provider-campaign-control.js`,
`tools/cli/lib/engineering-control.js`, `tools/cli/lib/engineering-control-http.js`,
`tools/cli/commands/control.js`, `packages/control-sdk/{index.js,index.d.ts,hseos_control.py}`,
`test/test-provider-campaign-control.js`, `package.json`, `.c8-kernel.json` e
`tools/cli/command-manifest.json` (gerado por compile:cli) e
`test/test-package-surface.js` (dois novos módulos do pacote comprovados). Configuração pública de adapters depende de T3;
o servidor não aceita código de adapter fornecido pelo cliente HTTP.

T3a (componente implementado, validação determinística):
`packages/control-sdk/antigravity_client.py`, `test/test_antigravity_client.py`,
`test/test-antigravity-client.js`, `docs/evolution/w3/ANTIGRAVITY-CLIENT.md`.
Verify: `python3 -B test/test_antigravity_client.py`; construir configuração com
SDK oficial em venv temporário, com rede/processos bloqueados. Este aceite não
fecha T3: launcher, admissão, identidade e orçamento composto ainda são necessários.

T2/T3 loader candidato: `tools/cli/lib/control-configuration.js`,
`test/test-control-configuration.js`; reusa validação temporária exportada pelo
ledger, não libera ativação. Regressão afetada 44/44 em cada Node 22/24 e cobertura
focada do loader 100/100. Estado durável operacional, factories reais e orçamento
composto não estão concluídos. Evidência em
`docs/evolution/w3/evidence/configuration-loader/`.

Incremento atual: T2 recebeu orçamento composto e drain de pai/filhos. T3 recebeu
factory API real (`provider-api-adapter.js`) registrada no CLI, com transporte
injetado nos testes; três adapters nativos e ponte Antigravity pendentes. T5
recebeu runner (`provider-campaign-runner.js`), mas ensaio determinístico/replay
não satisfaz campanha real. Nenhuma dessas entregas fecha T3 ou T5.

## Incremento de adapters nativos e ponte

T3 agora possui as quatro factories registradas, supervisão de processos, identidade
observada, retomada vinculada a recibo e ponte Python para reserva subordinada.
Isso substitui a pendência de implementação citada nos checkpoints anteriores.
T3 continua candidato: não há prova de todas as fronteiras contra fornecedores reais.
T4 precisa revalidar a matriz integral e cobertura do novo snapshot; os recibos
anteriores não o certificam. T5 permanece aberto por ausência dos insumos do
proprietário e de recibos reais. Ver ADAPTERS-CAMPAIGN e ADVERSARIAL-REVIEW em docs/evolution/w3.

## Incremento ACP — critérios executados em sequência

1. Aceitar somente capacidades/metadados conhecidos da versão fixada e autenticação
   preexistente comprovada, rejeitando recursos, comandos e alterações não admitidos.
2. Demonstrar ausência de ferramentas oferecidas, inclusive `additional_tools`, e
   recusa de chamadas forjadas no binário real; vincular a atestação à composição.
3. Exercitar ACP real no ledger existente com teto adicional zero, retomada, replay,
   cancelamento e drain. Contabilizar cache e manter tentativas incertas históricas.

O aceite deste incremento não fecha a certificação multifamília de T5 nem os gates
integrais de entrega de T4. Ver `docs/evolution/w3/ACP-CAMPAIGN.md`.

## Reordenação autorizada — 2026-09-27

T5: por decisão explícita registrada na spec, executar e validar a quarta família
API compatível somente após todas as fases. Preservar sua parcela FR07 como
pendência diferida, sem bloquear o avanço das entregas atuais. Recuperação real
Codex/ACP e Claude seguem autorizadas nos limites vigentes; Antigravity é o último
ensaio atual. Nenhum teste determinístico ou gate de cobertura foi dispensado.

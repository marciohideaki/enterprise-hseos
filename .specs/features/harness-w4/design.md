# Design W4 — extensões e jobs

Tipo: design de implementação candidata. Owner: HSEOS engenharia.
Fontes: spec.md FR01–FR08; docs/evolution/w4/PLAN.md; Constituição §§2.3/2.6/5/7;
ADR-0043/0044 e proposta ADR-0045; padrões Hexagonal & Clean Architecture,
Data Contracts & Schema Evolution, Resilience Patterns e Observability Playbook.
Base examinada: 32eaef270f192fcc58056f96a3cad39c265cd455.

## Propriedade e dependências

A composição em tools/cli/lib pertence ao controle de engenharia. Consome os
contratos em packages/agent-runtime-contracts, ToolRuntime, ContextAssembler,
WorkflowEngine/LocalSubagentProvider, execução governada, executor bwrap/seccomp/cgroup
e ExecutionEventLedger. O SDK somente transporta comandos; não concede autoridade.
O manifesto de compilação AdapterBase permanece distinto de execução de plugins.
Reuso e consulta de grafo: docs/decisions/harness-w4-intake.md.

O catálogo v3 acrescenta descritores de execução; o leitor v2 continua intacto.
Novos exports pertencem às superfícies de admissão/composição do produto; não
introduzem outro scheduler de efeitos, policy engine ou saldo monetário.

## Shards contratuais

- [extensions.md](extensions.md): manifesto, admissão, instalação e protocolo isolado.
- [jobs.md](jobs.md): agregado, relógio, comandos, fencing e recuperação.
- [workflow.md](workflow.md): v2, expansão, aceite e falhas.
- [verification.md](verification.md): cenários, limites e evidência.

## Dados, compatibilidade e ativação

Eventos de jobs são fatos versionados no ledger existente, em aggregate_type
control_job. O catálogo SQL recebe migration aditiva em migrations-pending-activation;
nenhuma migration operacional é aplicada por esta entrega. Projeção deriva apenas
dos eventos. IDs de job, comando, recurso materializado e reserva permanecem
estáveis entre reinícios. Não armazenar credenciais, funções, stdout não filtrado
ou paths fornecidos por plugins nos eventos.

O controle atual aceita apenas fixtures temporárias. Isso prova persistência entre
processos, mas não sobrevivência à limpeza de /tmp ou reinício do host. W4 deve
preparar suporte explícito a estado persistente com identidade, retenção,
backup/restore e compatibilidade testados, preservando a recusa de ativação implícita.
Não remover assertTemporaryFixtureDirectory como atalho. Testes de instalação e
campanha registram o tipo de estado efetivamente usado.

## Segurança e observabilidade

HTTP permanece loopback autenticado, sem upload/import de executável. Configuração
confiável do operador seleciona plugins e grants; requisição só referencia IDs/digests
admitidos. Política efetiva é interseção, não união. Queries/help/import não criam
processos de provider. Contexto externo é dado com origem, nunca instrução de sistema.

Cada evento inclui versão, correlação, causação, ID do recurso, sequência e
referências de evidência. Registrar códigos de recusa, duração, queue lag, claims,
reservas e resultado de drain sem segredos. Incerteza é estado observável e bloqueante.

## Migração e rollback

Preservar leitura v1/v2, eventos históricos e reservas W3. Upgrade cria nova seleção
para novas execuções; jobs existentes retêm pins anteriores. Rollback desabilita
novas admissões, mantém código fixado necessário à recuperação e não apaga eventos.
Uma versão incapaz de ler evento novo deve recusar retomada, nunca ignorá-lo.

## Decisões de ambiente

Linux x64, Node 22/24, Python, bwrap, seccomp e cgroup v2 delegado. Execução de teste
via systemd-run --user --scope -p Delegate=yes foi descoberta nas evidências W2.
O processo da sessão não possui delegação; o launcher delegado foi verificado em
2026-09-27. Suítes completas requerem pré-check de carga e execução sequencial.
AEW: binário disponível; stack resolve falhou por falta de base configurada.
Aplicação/enforcement permanecem não verificados; não substituir governança HSEOS.

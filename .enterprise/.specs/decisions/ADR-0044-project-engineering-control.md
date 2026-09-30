# ADR-0044 — Contrato de projeto e controle local de engenharia

Status: draft, implementação candidata solicitada em 2026-09-25; merge, publicação
e ativação operacional separados. Deriva do plano W1 e ADR-0043.

## Contexto

A composição de engenharia v1 executa tarefas descartáveis. W1 precisa importar
projetos reais, proteger o aceite e oferecer CLI/API/SDK com a mesma autoridade.
Constituição §§2.3/2.6/5/7, Data Contracts & Schema Evolution e Hexagonal & Clean
Architecture exigem reuso, versionamento e fronteiras explícitas.

## Decisão candidata

Estender composição existente com contrato v2, snapshots limitados e verificadores
versionados. Executar fontes no sandbox existente; avaliar resultados no host.
Reutilizar ledger e runtimes, expor serviço de controle com comandos idempotentes,
sequência esperada e eventos cursorados. Servidor loopback autenticado e clientes
JS/TS/Python não criam autoridade própria.

O Node de distribuição do host pode não suportar TypeScript. Montar somente o
executável Node do controlador, por descritor readonly, dentro do sandbox; não
expor a pasta SDK. Fixar hash desse executável no verificador. Python continua
usando runtime provisionado. Não ampliar rede, ambiente ou permissões do projeto.

## Alternativas

Importar módulos do projeto no host quebraria a fronteira de confiança. Delegar a
outro harness impediria a jornada nativa. API com acesso direto a diretórios de
estado permitiria seleção de recursos fora da allowlist. Esses caminhos não foram
adotados. Verificação TypeScript completa requer toolchain/dependências pinadas,
não fornecidas por remoção de tipos; não é alegada nesta versão.

## Consequências, validação e riscos

Controle permanece candidato com estado temporário e migrations-pending-activation;
nenhum banco operacional é atualizado. v1 continua legível e seu verificador não
é modificado. Workflows expõem evidências por etapa; aplicação exige revisão de
tarefa individual e baseline vigente. Falha entre efeito e recibo bloqueia retry
até reconciliação, mesmo quando isso exige intervenção manual.

Verificação: testes project/control/workspace/examples, interrupções reais em
reconciliation, testes existentes v1, matriz Node22/24 e instalação externa. Índice
de evidências: docs/evolution/w1/STATUS.md. Não confundir respostas determinísticas
com certificação de modelos ou execução produtiva.

## Migração e rollback

Preparar novas definições v2; nunca reescrever históricos v1. Mudança de runtime
ou verificador exige novo pin/nova execução. Rollback desativa superfície candidata,
preserva diretórios/recibos e não retoma efeitos de schema incompatível. Git apply
não cria commits e não desfaz automaticamente edições concorrentes.

Endurecimento da revisão candidata: Git não executa hooks/fsmonitor/diff/textconv
externos; filtros de conversão configurados são recusados e a raiz é validada e
fixada. A regressão adversarial e a limitação estão publicadas no relatório W1.

## Adendo candidato — perfil finito do cliente nativo (2026-09-26)

A campanha real encontrou esgotamento de threads no cliente nativo: o limite
padrão de 32 também conta threads, e reproduções de inicialização ultrapassaram 128. Reutiliza-se `createResourceGroup` de `runtime:engineering-candidate`,
registrado em `.enterprise/governance/capabilities/components.yaml`, com extensão
opcional `pids_max` inteira entre 32 e 256. O padrão permanece 32. O adapter nativo
fixa essa opção no digest do binding e inclui o executor no digest de artefatos;
a inspeção e a execução recebem o mesmo perfil. O ensaio seleciona 256, memória
512 MiB e dois CPUs por afinidade do launcher externo.

Essa extensão não concede novas ferramentas nem equivale a isolamento de sistema
de arquivos. Aumenta a quantidade máxima de threads/processos por grupo; 256 é
um teto de ensaio, não garantia universal para versões futuras. Testes verificam
limites inválidos, padrão, propagação, detecção de drift e remoção do grupo. As
medições e o ensaio real ficam em `docs/evolution/w3/evidence/live-revalidation/`.
O estado deste adendo permanece candidato, sem publicação ou ativação operacional.

### Candidato: composição com cliente terminal (2026-09-26)

O candidato W3 admite um cliente externo terminal como subordinado de outro
cliente, além de um modelo. A identidade e autoridade do filho são preservadas;
uma conta de cliente não é reclassificada como modelo. O filho não pode declarar
subordinados, impedindo recursão e ciclos. Pai e filho precisam de autorização
explícita no mesmo grant e reservam requests e custo no mesmo ledger. A extensão
viabiliza Antigravity local com o adapter de conta existente, sem API paga.

### Candidato: peer ACP restrito e campanha (2026-09-26)

A extensão `CodexAcpPeer` normaliza somente metadados conhecidos de
`codex-acp@1.13.1`; não altera a ponte L0 genérica. A autenticação preexistente é
verificada pelo adapter nativo, com identidade observada e ausência de créditos
pagos. O anúncio de login por API não autoriza login, troca de modo ou ferramentas.
Comandos slash são recusados antes do transporte.

A fronteira de efeitos usa binários fixados por SHA-256, home privado, catálogo
restrito carregado no startup e flags sem ferramentas. Catálogo também precisa
desativar patch, relógio e delegação; flags isoladas não bastam. Prova offline
inspeciona `tools` e `additional_tools` e injeta chamadas forjadas. Cgroup reutiliza
a supervisão existente, sem alegar sandbox de filesystem ou rede. Retomada usa
somente sessões associadas ao mesmo binding pelo ledger existente. Cache de entrada
integra o consumo total; reasoning já está contido no output nativo.

O escopo de confiança inclui o binário fixado e o host controlador. A evidência não
certifica futuras versões, agentes ACP arbitrários, L1–L4 ou quatro famílias reais.
O adendo mantém status candidato; relatório em `docs/evolution/w3/ACP-CAMPAIGN.md`.

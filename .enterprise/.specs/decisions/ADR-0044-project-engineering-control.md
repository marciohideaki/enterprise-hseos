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

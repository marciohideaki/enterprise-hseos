# W1 — Engenharia geral

## Purpose e atores
Permitir ao operador executar tarefas em projetos Node/TypeScript, Python e web
pelo kernel HSEOS, com CLI, API e clientes compartilhando autoridade e ledger.

## Scope e requisitos funcionais
- FR01: aceitar tarefa v2 com referência de workspace, baseline Git e digest dos
  arquivos autorizados; conservar parsing e replay v1 sem reescrever eventos.
- FR02: fixar requisitos, aceite e verificadores versionados antes de executar;
  copiar apenas arquivos explicitamente autorizados para workspace descartável.
- FR03: executar código de projeto somente pelo executor isolado existente;
  comparar resultados limitados fora do processo não confiável. Entrega vazia,
  incorreta e alteração de critérios não podem ser aprovadas.
- FR04: oferecer leitura, busca, escrita com precondição, patch e diferenças
  limitados ao escopo; comandos permanecem enumerados, sem shell arbitrário.
- FR05: apresentar diferenças Git e aplicar resultado somente mediante comando
  explícito com aceite vigente, sequência e baseline atuais; edição concorrente
  invalida aplicação. Histórico e orçamento não reiniciam ao retomar.
- FR06: expor controle local versionado autenticado, com tarefas, consulta,
  execução, cancelamento, retomada, reconciliação, evidências e eventos com cursor.
  Não aceitar caminhos de estado arbitrários de clientes nem expor segredos.
- FR07: compartilhar operações por CLI, cliente JS/TS e Python; comandos mutantes
  exigem identidade, sequência e idempotência; efeitos incertos não são repetidos.
- FR08: demonstrar tarefas multi-arquivo Node/TS e Python em instalação externa,
  incluindo rejeição, diagnóstico, correção e proteção do verificador.

## NFR e constraints
Node 22/24; Linux primeiro; sem novo servidor de banco. Reutilizar ledger SQLite,
ToolRuntime, AgentRuntime e executor. Testes e gates sequenciais, nice 10,
concorrência 1. Aplicar Quality Gates & Compliance, Data Contracts & Schema
Evolution e isolamento fail-closed existentes. Cotas finitas e saída limitada;
API somente loopback, sem CORS permissivo. Sem inferência paga ou troca de backend.

## Out of scope
Terminais interativos W2, certificações de quatro fornecedores W3, plugins gerais
W4, browser/LSP W5, Code OSS W6 e remoto multiusuário W7. API não anuncia capacidades
futuras como implementadas. Campanhas reais exigem bindings/orçamento próprios.

## Open questions
Nenhuma decisão de produto pendente para iniciar. Limites iniciais de arquivos e
bytes são explícitos e finitos; provisionamento de dependências permanece externo
ao sandbox. Compatibilidade é demonstrada, não presumida.

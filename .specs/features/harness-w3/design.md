# Design W3

Contexto proprietário: engenharia HSEOS. Estender as superfícies existentes de
binding, controle e ledger; não criar um segundo runtime, auth store ou orçamento.
Governança: Constituição §§2.6/5/7, ADR-0043/0044, Data Contracts & Schema Evolution,
Resilience Patterns e Hexagonal & Clean Architecture.

## Contratos e integração

O manifesto de controle será um envelope versionado do binding original com seu
digest; não acrescentar campos obrigatórios aos schemas v1 existentes. Catálogo
oficial contém rotas suportadas por versão, referências e limites conhecidos.
Uma declaração não eleva o nível L0/L1 nem prova disponibilidade do backend.

Serviço de controle reutiliza ControlCommandRecorded com payload versionado para
admissões e recibos de campanha. Intenção/reserva é transacional e precede dispatch.
Read models são reconstruídos do ledger. Hashes ligam manifesto, binding efetivo,
observação de autenticação/quota e resultado. Consultas não resolvem segredos nem
executam modelo. A inspeção de identidade é responsabilidade do adapter oficial;
o serviço aceita evidência autenticada da execução, não texto produzido pelo modelo.

Expiração, drift de identidade/versão, quota desconhecida e perda de recibo fecham
admissão. Não trocar automaticamente de credencial ou backend. Troca autorizada
permanece na mesma campanha e preserva todas as reservas e consumo anteriores.
Orçamento monetário usa unidade inteira; limites por chamada reservam o pior caso.
Resultados sem custo comprovável permanecem conservadoramente reservados.

Autorizações de campanha são configuração confiável do serviço: ID, prazo absoluto,
bindings/tarefas permitidos e tetos financeiros/de chamadas. O cliente apenas
referencia uma autorização; não escolhe nem amplia orçamento pelo protocolo.
Cada autorização é consumida uma única vez no mesmo ledger, em transação com a
criação, impedindo reset por novo ID de campanha no ledger autorizado.
A configuração pública com grants deve fixar um diretório de estado durável;
ausência de state ou override para outro ledger deve falhar antes da admissão.
O estado temporário padrão de testes não é elegível para uma campanha real. Reservations fixam PID/start_ticks;
reconciliação por outro controlador não pode liberar tentativa ainda viva.

Antigravity poderá compor o SDK oficial Python como cliente explícito da API de
engenharia. Ferramentas do projeto continuam no executor HSEOS. A fronteira do
runtime externo e os controles indisponíveis aparecem no manifesto; não alegar
confinamento do host baseado somente em enable_sandbox ou em transporte MCP.

## Segurança e observabilidade

Referências de credenciais são selecionadas pelo operador; valores não entram em
artefatos. Ambiente dos adapters substituído por allowlist. Registrar somente
identidade opaca/digest, modo efetivo, versão, código de falha e recibo de consumo.
SDKs opcionais são lazy. Mensagens de erro públicas não incluem stderr, cabeçalhos
ou configuração do host. Identidades individuais não formam pool compartilhado.

## Fontes oficiais consultadas

- Codex App Server: https://learn.chatgpt.com/docs/app-server — account/read,
  login/logout e account/rateLimits/read; confirmar suporte na versão fixada.
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview — integrações
  de terceiros usam métodos de API documentados; login de assinatura não é presumido.
- Antigravity SDK: https://antigravity.google/docs/sdk/overview/ — Python local,
  Gemini API/Vertex e backends locais; SDK não equivale à assinatura do produto.
- Provider compatível/ACP: checkout oficial identificado no registro de comparação
  `docs/evolution/COMPARISON-2026-09-25.md`,
  477b4f420553e8a52c2fbccc464d7561b239c443; bindings ACP existentes continuam
  candidatos e seu confinamento permanece limitado à composição verificada.

Consulta web em 2026-09-26; documentação mutável não substitui teste da versão.
Fontes locais Antigravity 7f19db07e7c6c5038102b45a8a7a5da7eecc8b11 confirmam
que sandbox indisponível pode apenas emitir aviso; não usar esse sinal como aceite.

## Migração e rollback

Nenhuma migração operacional. Eventos anteriores continuam legíveis. Desabilitar
novas admissões e preservar recibos/reservas ao reverter. Campanhas inconclusivas
não são repetidas automaticamente. ADR draft acompanha o manifesto e sua autoridade.

## T3 — cliente Antigravity com comandos fixados

O cliente Python opcional usa `LocalOpenAIAgentConfig`/`Agent` oficiais e uma
fachada de ferramentas para exatamente uma tarefa HSEOS. O operador fornece os
envelopes completos de resume/cancel, com UUID, sequência e idempotência; o modelo
não escolhe recurso, comando, workspace, credencial ou reconciliação. Cada envelope
é despachado no máximo uma vez pelo cliente; falha de transporte cerca novas
mutações, preservando a consulta para reconciliação externa. O servidor continua
responsável por política, execução, verificação e aplicação do resultado.

Configuração local inicial: endpoint literal loopback, modelo explícito, versão
exata do SDK, diretório scratch explícito, nenhuma tool nativa, subagent, skill ou
MCP. Budget e retry são explícitos; contadores desconhecidos permanecem nulos.
O cliente não certifica confinamento do processo SDK nem quota, custo ou identidade
real. Sua execução deve ocorrer dentro de uma reserva do controlador; não haverá
CLI standalone que dispense a admissão. Conectar ao loader de campanha e provar o
backend efetivo continuam critérios separados de T3, não implícitos no wrapper.

## Loader de configuração confiável

`control-configuration.js` mantém a configuração W1/W2 e acrescenta
`provider_control` v1: diretório state canônico já existente, identidade física
(device/inode do diretório e do arquivo SQLite), manifests/bindings e autorizações finitas. Um override diferente,
symlink ou substituição da identidade bloqueia o carregamento. O diretório e o arquivo são
reverificados após construir adapters. O operador não deve alterar configuração
ou ledger durante a vida do serviço; essa proteção não é isolamento contra o
administrador do host.

Factories são funções de código confiável registradas pelo serviço, nunca imports
ou executáveis escolhidos por uma requisição HTTP. Elas devem validar o binding,
retornar seu digest efetivamente observado e criar somente adapters lazy. O loader
valida todas as referências antes de invocá-las. O CLI registra as quatro factories candidatas descritas em ADAPTERS-CAMPAIGN;
configuração não suportada falha com
`CONTROL_PROVIDER_ADAPTER_UNAVAILABLE`, sem campanha simulada ou fallback.

O loader reutiliza `assertTemporaryFixtureDirectory` do ledger; não cria nem migra
estado. O ADR-0044 limita o controle candidato a fixtures temporárias. Reabrir a
mesma fixture preserva reservas e autorizações consumidas, mas não certifica
sobrevivência à limpeza de `/tmp`, reinício do host ou ativação operacional.
O requisito de durabilidade FR04 continua parcialmente atendido. Uma extensão de
estado persistente exige projeto de retenção, backup/restore e compatibilidade das
migrations pendentes antes de qualquer ativação; este loader não remove esse gate.

Critérios de integração: a rota de cada binding determina o adapter e a evidência
possível. Quotas percentuais do Codex não equivalem a número de requisições; não
preencher `quota_remaining_requests` com contagem inventada. No cliente Antigravity,
a autorização de resume pode disparar modelo HSEOS: reservar apenas o consumo do
cliente não cobre essa chamada. Antes de liberar a factory real, vincular o modelo
subordinado à mesma campanha, reservar seu teto antes de resume e exigir recibo ou
manter reserva incerta. Estes itens são critérios de T2/T3, não alegações de suporte.

## Incremento: identidade API e composição

A identidade de credencial API é opcional e explicitamente distinta da identidade
de conta; ausência do campo preserva o digest dos manifests anteriores. Quota
monetária USD observada pode admitir rota API sem inventar requests restantes.
O adapter fixa binding mais opções e reutiliza o broker existente. O controlador
fornece capacidade subordinada privada, limitada aos bindings fixados, com
reservas de pai/filho no mesmo ledger. Nenhum campo HTTP pode forjar o pai.
O runner valida replay e cancelamento; certificação de recuperação nativa e
campanha real permanecem aceites separados. Detalhes e limitações em
`docs/evolution/w3/ADAPTERS-CAMPAIGN.md`.

## Incremento: adapters nativos e ponte oficial

Codex conta/App Server observa identidade e janelas oficiais sem conversão para
requests. Claude API/SDK fixa a credencial; GET de modelos não atesta quota de
inferência. Quota desconhecida exige exceção explícita na autorização, por binding,
com motivo e validade dentro do prazo; nunca sobrepõe esgotamento observado.

Antigravity local/LiteRT usa worker Python, artefatos fixados, CPU, downloads
inibidos e ponte loopback autenticada de uso único. A capacidade subordinada já
passa pelo orçamento composto. Workers usam cgroup para recursos e drain, sem
alegação de confinamento integral do filesystem. `resume_from` vincula a sessão
persistida em recibo anterior à mesma campanha/tarefa/binding e reserva novamente.
Perda do primeiro recibo não autoriza recuperação automática. Admissão de processo,
inspeção cancelável e shutdown compartilham acompanhamento de drain.

A validação oficial sem inferência e os testes de protocolo não encerram FR07.

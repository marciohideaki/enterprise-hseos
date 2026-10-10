# Adapters e campanha candidata

## Implementação disponível

O CLI registra quatro factories de campanha. Registro significa implementação
selecionável; todas continuam com `real_conformance: not_certified`.

| Factory                         | Rota implementada                           | Identidade e admissão                                                                               |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `hseos-api-campaign-v1`         | API compatível, modelo                      | Credencial explícita, saldo USD observado, provider e broker existentes                             |
| `hseos-codex-campaign-v1`       | App Server, conta nativa, cliente           | Conta observada, versão fixada e janelas oficiais de quota; créditos pagos/indeterminados recusados |
| `hseos-claude-campaign-v1`      | Agent SDK, API, cliente; `claude -p`, conta | API: fingerprint da credencial; quota desconhecida bloqueia. Conta: ver abaixo                      |
| `hseos-antigravity-campaign-v1` | SDK oficial, LiteRT local, cliente          | Hashes de Python, checkpoint e módulo SDK; ponte subordinada obrigatória                            |

Outras rotas presentes no catálogo não são automaticamente implementadas por
essas factories. Os drivers nativos mantêm a fronteira de instruções. O launcher
limita recursos e encerra descendentes em cgroup; isso não comprova isolamento do
filesystem nem prevenção de todo efeito nativo. Consulte a
[revisão adversarial](ADVERSARIAL-REVIEW.md).

## Configuração e identidade

`control serve --config` aceita `provider_control` com schema 1, diretório temporário
existente, identidade device/inode do diretório e SQLite, bindings e autorizações.
Não importa código fornecido pelo cliente HTTP. Persistência em temporário não
comprova retenção operacional após limpeza do host.

Cada binding contém manifest, caminho absoluto de configuração, `options` e,
para composição, `subordinate_binding_ids`. O digest fixa configuração e opções.
`artifact_sha256`, exposto por `control adapters`, cobre os arquivos enumerados
na factory; não atesta a totalidade das dependências transitivas ou pesos remotos.

API compatível: reusa binding de provider com tentativa única, referência
`env://NOME` e capacidade `usage`. Opções estritas: `tasks` (UUID para prompt),
`pricing` com `input_microusd_per_million`, `output_microusd_per_million` e
`valid_until` cobrindo a chamada. O fingerprint comprova seleção da credencial,
não a identidade da conta. Tarifas declaradas não equivalem à fatura real;
custo desconhecido conserva integralmente a reserva.

Clientes nativos: reusam os bindings dos drivers existentes. Opções: `model`,
`tasks`, `environment` (`HOME`, `PATH`, `CODEX_HOME` quando aplicável) e
`memory_max_bytes` opcional. Codex exige referência explícita ao arquivo de
credenciais sob o CODEX_HOME selecionado. Claude recebe somente a chave API
resolvida por referência e o ambiente público declarado; login de assinatura não
é presumido. Listar modelos autentica a chave, mas não comprova quota de inferência.

Claude por assinatura (`route: account`, mesma factory `hseos-claude-campaign-v1`;
candidata, sem certificação de campanha): conduz o binário `claude` oficial e não
modificado em modo headless `stream-json`, logado como o próprio proprietário.
Não usa o Agent SDK, não lê `.credentials.json` nem tokens e não usa `--bare`.

- Binding YAML estrito: `profile_id: agent-claude-cli-account-candidate`,
  `runtime_provider_id: runtime:claude-cli`, `executable` (hash fixado), `cwd`
  (diretório dedicado; cada execução usa um subdiretório vazio novo), `env_names` e
  `secret_refs` vazios. Opções: `model`, `tasks`, `environment` (`HOME`, `PATH`,
  `CLAUDE_CONFIG_DIR` opcional), `persist_sessions` opcional, `memory_max_bytes` e
  `pids_max` opcionais. O manifesto referencia `file://<diretório de login>` (nunca o
  arquivo de credenciais), `billing.max_request_microusd` 0 e `account_sha256`.
- Identidade antes de cada operação: `claude --version` igual à versão fixada e
  `claude auth status` com `loggedIn`, `apiProvider` `firstParty` e `authMethod` em
  `claude.ai` (`oauth_token` é recusado). `account_sha256` é o digest de
  `{authMethod, email, orgId, subscriptionType}`; e-mail e organização nunca são
  registrados. A execução repete a verificação e recusa se o digest mudou. No stream,
  `system/init` precisa ter `apiKeySource: "none"`, sem ferramentas nem servidores MCP.
- Ambiente do filho: lista de permissão estrita (`HOME`, `PATH`, `CLAUDE_CONFIG_DIR`,
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS`). `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` e `apiKeyHelper` vencem a assinatura e por
  isso nunca chegam ao filho. A variante `oauth_token` (`CLAUDE_CODE_OAUTH_TOKEN`) fica
  fora: não há como resolver o token sem expô-lo ao processo; o login interativo do
  proprietário é a única variante suportada.
- Flags: `-p --output-format stream-json --verbose --max-turns 1 --permission-mode
dontAsk --setting-sources "" --safe-mode --settings '{"disableAllHooks":true}'
--strict-mcp-config --mcp-config '{"mcpServers":{}}' --disallowedTools 'mcp__*'
--disable-slash-commands --tools ""`, mais `--no-session-persistence` (ou
  `--session-id`/`--resume` com `persist_sessions`). O prompt vai por stdin. Verificado
  no 2.1.296 sem enviar prompt: `--setting-sources ""` e `--max-turns` são aceitos;
  `claude auth status` permanece logado com `--safe-mode`, `--restricted` e
  `--setting-sources ""`, e fica `none` com `--bare`. Que `--setting-sources ""` e
  `--safe-mode` impedem o carregamento de CLAUDE.md só se prova com um prompt real;
  por isso o adapter valida o `init` (sem ferramentas, MCP nem `apiKeySource` ≠
  `none`) e a campanha real deve inspecionar a primeira evidência. `--restricted` não
  é usado: `--tools ""` e `--safe-mode` já cobrem o isolamento sem acrescentar risco
  não medido ao login.
- Medição e quota: tokens vêm de `result.usage`; `total_cost_usd` é estimativa,
  fica só na evidência e `cost_microusd` é sempre `null`. `rate_limit_event`
  `rejected`, `errorCode: credits_required` ou `isUsingOverage` falham com
  `CONTROL_PROVIDER_QUOTA_UNAVAILABLE`, sem nova tentativa; `allowed_warning` é
  registrado. O CLI não expõe janelas de quota: a admissão exige `quota_exceptions`
  do proprietário e nenhuma quota é inventada.
- Modo rápido e modelo: `init.fast_mode_state` diferente de `off` é recusado (cobra uso
  extra); estado ausente é registrado como `null`. `init.model` é registrado na
  evidência e, se o modelo configurado for um id completo (contém dígito), precisa ser
  prefixo do reportado; aliases (`opus`, `sonnet`) só são registrados.
- Transcript: com `persist_sessions: true` o cliente grava prompt e resposta em
  `<config>/projects/<cwd>/` no disco local do owner; o caminho sai no resultado do
  worker como `sensitive_session_dir` e é dado sensível local. Sem `persist_sessions`
  o diretório da execução é removido ao final.
- Limitações registradas: `account_sha256` é digest sem sal (paridade com o Codex).
  Não verificados sem despacho real, a conferir na campanha: `apiKeySource: "none"`
  no login real e o não carregamento de CLAUDE.md de diretórios ancestrais.
- Processo: cgroup com `memory_max_bytes` e `pids_max`; `claude auth status` usa 6
  threads no 2.1.296, mas um prompt real não foi medido, então a campanha deve usar
  `pids_max: 256` e ler `pids_peak` (cgroup `pids.peak`) da evidência para calibrar.
  Timeout do cliente a 90% do teto do manifesto com escada SIGINT, SIGTERM e SIGKILL;
  cancelamento da campanha e estouro do teto encerram o cgroup inteiro.

Antigravity: binding JSON estrito com `python`, `checkpoint` `.litertlm`,
`sdk_module`, `scratch`, `subordinate_binding_id`, `max_model_calls` (1–4),
`tasks` e `memory_max_bytes` opcional; options vazio. O worker verifica versão e
origem do SDK e usa LiteRT CPU sem download automático. Não aceita endpoint remoto
classificado como custo local. A memória padrão é 256 MiB, configurável até 2 GiB;
o checkpoint escolhido precisa caber nesse perfil. Não foi executada inferência
LiteRT neste incremento.

## Orçamento composto e quota

O pai recebe uma capacidade `runSubordinate` para um binding previamente fixado.
A ponte Python usa HTTP loopback autenticado, corpo vazio e chamada única. Não
aceita prompt, rota ou binding escolhidos pelo modelo. A reserva adicional do
filho ocorre no mesmo ledger/campanha/tarefa antes do efeito. Pai e filho consomem
os limites globais, além dos tetos individuais. O pai não recebe sucesso se a
ponte não concluir a chamada. Falha ou cancelamento propagam; shutdown aguarda
inspeções, pai e filhos. Resultado incerto mantém a reserva e impede retry cego.

Quota percentual mantém sua unidade e expiração. Um saldo monetário insuficiente
não pode ser ocultado por quota positiva de requests. Quota desconhecida bloqueia
por padrão. A autorização confiável pode registrar `quota_exceptions` por binding,
com motivo e expiração dentro do prazo autorizado; somente decisão explícita do
proprietário justifica preenchê-la. A exceção nunca supera esgotamento observado.
Nenhuma exceção foi criada para uma campanha real nesta entrega.

## Execução e retomada

`hseos control campaign-run --url <loopback> --request <plano.json>` usa
`HSEOS_CONTROL_CREDENTIAL`. O plano estrito contém schema 1, `scope` pilot ou
four-family, UUIDs estáveis de campanha/autorização/criação/cancelamento e 1–16
steps com command_id, binding_id e task_id. A autorização fixa max_requests,
max_cost_microusd, deadline, binding_ids e task_ids. O runner não inventa esses valores.

O runner verifica cobertura das famílias antes da criação, executa sequencialmente,
confere replay e cancela ao final. Repetir o plano reutiliza recibos; resultado
incerto interrompe a sequência. `resume_from` opcional referencia um comando
concluído da mesma campanha, binding e tarefa, cujo recibo contém a sessão nativa.
A retomada faz nova reserva e recusa identidade divergente. Não recupera uma
sessão cuja identidade foi perdida antes do primeiro recibo.

`control_trial_completed` atesta o protocolo local. Recuperação nativa real e FR07
continuam não certificados. Campanha real depende de teto financeiro finito,
bindings/rotas autorizados, referências de acesso e checkpoint local elegível.
Não envie valores secretos em conversa. Os testes usam fixtures de protocolos e
transportes injetados; nenhum recibo de fornecedor real foi produzido.

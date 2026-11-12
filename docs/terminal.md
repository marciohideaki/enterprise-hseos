# Terminal do HSEOS

Guia de usuário do terminal do HSEOS: o que é, como instalar, como usar, quais são os limites e,
principalmente, **o que não está certificado**. Este documento não certifica nada por conta própria. A fonte do
fechamento e dos números é [`docs/evolution/terminal-closeout/`](evolution/terminal-closeout/); em caso de
divergência, vale o que está lá e o manifesto da CLI (`tools/cli/command-manifest.json`, verificado por
`npm run check:cli`).

## O que é o terminal do HSEOS

O "terminal" é o conjunto de superfícies que executam e observam trabalho de engenharia sob governança, todas
sobre o mesmo ledger de execução:

| Superfície                 | O que oferece                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI `hseos`                | Comandos como `hseos control`, `hseos agent`, `hseos sandbox`, `hseos workflow` e `hseos plugin`.                                                      |
| API local versionada `/v1` | HTTP somente em `127.0.0.1`, com credencial Bearer. Contrato em [engineering-control-api.md](engineering-control-api.md).                              |
| SDK JS/TS e Python         | Clientes da mesma API em `packages/control-sdk` (JS/TS e Python); usam a mesma identidade e autenticação. Ver o README do pacote.                      |
| MCP moderno e compat       | Servidores MCP do pacote (governança, swarm, estado do projeto, ponte do axon), com modo moderno e modo de compatibilidade legada.                     |
| Terminais e jobs           | Terminais com processo isolado (abrir, entrada, redimensionar, EOF, anexar) e jobs, ambos via `hseos control` e pelas rotas `/v1/terminals` e de jobs. |

Cliente fechado, desconectado ou reconectado não cancela o trabalho: o controlador mantém o processo e os eventos
têm cursor. Detalhes e garantias em [engineering-control-api.md](engineering-control-api.md).

## Requisitos

- Linux. Não há suporte a macOS nem a Windows (ver "O que não está certificado").
- Node.js 22 ou 24 (`engines`: `>=22.0.0`; o worker TypeScript depende de remoção nativa de tipos).
- Git e Python 3 (o SDK Python usa só a biblioteca padrão).
- Executor isolado: cgroup v2 delegado (por exemplo via systemd), bubblewrap (`bwrap`) e `pidfd`. Em hosts com
  AppArmor restritivo, `kernel.apparmor_restrict_unprivileged_userns=0`.
- **Sem esses pré-requisitos a criação de tarefas retorna `ENGINEERING_ISOLATION_UNAVAILABLE`.** Diagnostique com:

```sh
hseos sandbox engineering-check --json
```

## Instalar

O HSEOS não está publicado sob o nome sem escopo `hseos` no npm; instale a partir do tarball exato coberto pelo
`SHA256SUMS` da release (ver [README](../README.md)) e confira a instalação:

```sh
npm install --global ./hseos-<versão>.tgz
hseos --version
hseos status
```

Instalação offline: gere ou obtenha o tarball (`npm pack`), confira o hash contra o `SHA256SUMS` e instale o arquivo
local. Para consumir como biblioteca (SDKs) em vez de global, instale o mesmo tarball num projeto de consumo
(`npm install ./hseos-<versão>.tgz`). Dependências do projeto de engenharia não são baixadas pelo terminal. O passo a
passo reproduzível de uma instalação fora do checkout está em [test/journeys/README.md](../test/journeys/README.md).
Para instalar o HSEOS num projeto, ver [getting-started.md](getting-started.md) (`hseos init`, `hseos install`).

## Usar

Todos os comandos abaixo existem no manifesto da CLI; use `--help` para as opções exatas.

```sh
hseos --help
hseos sandbox doctor
hseos sandbox engineering-check --json
```

Servidor de controle (a credencial vem do gerenciador de segredos do operador, com pelo menos 32 caracteres, e não vai
para argumentos nem para o workspace):

```sh
export HSEOS_CONTROL_CREDENTIAL=...   # lida do gerenciador de segredos
hseos control serve --config control-config.json
```

O servidor imprime a URL loopback e o diretório de estado; reabra com `--state` após reinício. Com o servidor no ar:

```sh
hseos control prepare --url "$URL" --request prepare.json
hseos control command --url "$URL" --request command.json
hseos control query --url "$URL" --resource "$ID" --view status
hseos control events --url "$URL" --resource "$ID" --after 0 --limit 100
```

Terminais (`--view` aceita `status`, `evidence`, `review` ou `session` para tarefas):

```sh
hseos control terminal-command --url "$URL" --request terminal-command.json
hseos control terminal-query --url "$URL" --resource "$TERMINAL_ID"
hseos control terminal-events --url "$URL" --resource "$TERMINAL_ID" --after 0
hseos control terminal-attach --url "$URL" --resource "$TERMINAL_ID"
```

No `terminal-attach`: Ctrl-] desanexa sem matar o processo, Ctrl-C interrompe, Ctrl-D envia EOF. A saída é não
confiável: sequências ANSI são dados, não instrução.

Jobs e campanhas: `hseos control job-command`, `job-query`, `job-events`, `binding-inspect`, `campaign-run`,
`campaign-command`, `campaign-query`, `campaign-events` e `campaign-evidence`.

Agente: `hseos agent run`, `resume`, `cancel`, `validate-task`, `status`, `evidence`, `reconcile` e `fork`:

```sh
hseos agent validate-task --task-contract task.json
hseos agent run --task-contract task.json --binding binding.json --json
```

Workflows: `hseos workflow list`, `validate`, `run`, `status`, `resume`, `cancel`, `reconcile` e `migrate`. Plugins:
`hseos plugin list`, `install`, `remove` e `doctor`.

## API e SDKs

A API `/v1` é local (`127.0.0.1`), exige `Authorization: Bearer ...`, limita o corpo a 2 MiB, usa UUIDs de recurso
criados pelo cliente e paginação explícita por cursor. A referência completa de rotas, erros, reconciliação e terminais
é [engineering-control-api.md](engineering-control-api.md). SDK JS/TS: `terminal`, `terminalQuery`, `terminalEvents`.
SDK Python: `terminal`, `terminal_query`, `terminal_events`. Nenhum cliente escolhe backend nem cria aprovação.

## Limites

- Linux apenas; acesso somente por loopback, sem acesso remoto nem CORS.
- Implementação candidata: o armazenamento de controle não oferece durabilidade de produção nem migra o banco
  operacional; o servidor reporta `operational:false`.
- TypeScript é verificado por remoção de tipos, não por `tsc`; o verificador web só inspeciona conteúdo estático.
- Repositórios com filtros Git são recusados (`PROJECT_GIT_FILTERS_UNSUPPORTED`); workflows não aplicam patches de
  forma agregada.
- Bytes de terminal anteriores à persistência podem se perder num crash do controlador; o caso vira reconciliação.
  `recover` nunca relança processos.
- Há adiamento único de jobs (`not_before`); agendamento recorrente não existe.
- Plugins de capacidade `scaffolded` não são emitidos; plugin de terceiro só por definição local com pin no catálogo.
- Credenciais concorrentes não têm pool; dois processos com a mesma credencial ou cota não têm teste dedicado.
- Sem cgroup v2 delegado, bubblewrap ou `pidfd`: `ENGINEERING_ISOLATION_UNAVAILABLE`.

## O que não está certificado

Declarado como limite, não como falha escondida. Detalhes, classes e ações em
[`docs/evolution/terminal-closeout/`](evolution/terminal-closeout/).

- **Consumidor real por família.** Várias famílias seguem `real_consumers: not_verified` (execução com modelo real,
  campanhas de jobs com bindings concorrentes, varredura de segredos em campanha completa). O valor
  `verified_installed_local_scope_only` das famílias de controle é restrito a binding local instalado; clientes
  roteirizados não certificam acima disso.
- **Campanhas.** Não se repetem as campanhas já decididas; as famílias dependentes seguem sem consumidor real.
- **Quarta integração.** Três integrações foram provadas; a quarta (API compatível) e o ACP de terceiro estão bloqueados
  sem a credencial correspondente.
- **MCP com cliente de terceiro.** MRTR e `tools/call` dependem de um cliente externo que negocie o protocolo
  moderno; hoje o cliente testado negocia a versão legada.
- **Navegador e computer-use na CLI.** Adiados por decisão do owner; elicitação sem imagem.
- **macOS, Windows, servidores próprios e acesso remoto.** Fora do escopo do terminal.
- **Eixo operacional.** Não há ativação operacional, durabilidade de produção nem distribuição pública certificada.
- **Catálogo de extensões da IDE.** Fora do terminal.

Este guia não prova nada além do que os testes e jornadas citados provam: o terminal instalado exerce CLI, API, SDKs e
MCP com fixtures roteirizadas e sem modelo real.

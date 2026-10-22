# K1 — que protocolo MCP os clientes registrados negociam

Spike de leitura e execução em fixture. Nenhum código de produção mudou. Rastreabilidade da contenção em "Isolamento" abaixo.
Data da medição: 2026-10-22. Base: `feature/hseos-w5-closeout-w10` (953949a0).

## Conclusão objetiva

| Cliente     | Versão medida                                  | Moderno `2026-07-28` com o servidor governado                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | `codex-cli 0.163.0` (o plano esperava 0.162.1) | **parcial.** Padrão: **NÃO** (envia `initialize` com `2025-06-18` e o servidor governado recusa com `-32022`). Moderno só com a feature `mcp_2026_07_28` (marcada "under development", desligada) **e** `env = { CODEX_MCP_PROTOCOL_VERSION = "2026-07-28" }` no registro do servidor: aí `server/discover` + `tools/list` funcionam em `2026-07-28`. `tools/call` e MRTR: NOT_EXERCISED (exigem modelo, logo login/gasto).                          |
| Claude Code | `2.1.305`                                      | **SIM, por padrão.** Sonda `server/discover` com `2026-07-28`; `tools/list` e `tools/call` rodaram no moderno e o contador legado ficou em 0. MRTR (`input_required`) suportado: abre elicitação e repete o `tools/call` com `inputResponses` + `requestState`. Ressalva: em 1 de 8 execuções não sondou e recebeu `-32022` (ver "Variabilidade"). Contra servidor só-legado, cai para `initialize` `2025-11-25` (o servidor responde `2024-11-05`). |

Dois achados que mudam o ADR:

1. **A janela de compat legado dentro do adaptador moderno não atende nenhum dos dois clientes.** `Mcp2026Adapter._legacy` (`tools/lib/mcp-2026-adapter.js:978`) só aceita `initialize` com `protocolVersion === '2024-11-05'` e, para qualquer outro valor, devolve erro `-32022` em vez de responder com a versão que suporta (o que o servidor legado de produção faz). Codex padrão envia `2025-06-18` e Claude Code, no fallback, `2025-11-25`. Trocar o MCP de produção para o servidor moderno hoje quebra o Codex por completo, não o degrada.
2. **Codex ainda não é cliente moderno de fato.** A capacidade existe no binário (`server/discover`, cabeçalho `MCP-Protocol-Version: 2026-07-28`, "input_required did not complete within N MRTR rounds"), mas fica atrás de feature em desenvolvimento mais uma variável por servidor.

## Recomendação para o sunset do ADR (condicional à evidência acima)

- Não manter a data fixa 2026-11-30 para o Codex: com a evidência desta medição, o Codex só falaria o moderno com flag experimental, e o caminho de compat não o serve.
- Antes de trocar qualquer MCP para o moderno: (a) o adaptador deve responder a `initialize` de revisões legadas conhecidas (`2025-03-26`, `2025-06-18`, `2025-11-25`) negociando para `2024-11-05` (ou o servidor legado deve continuar registrado para o Codex), e (b) o K7 deve ter teste adversarial com esses `initialize`. Isso é mudança de código, fora do escopo do K1; fica como achado para G0/K7.
- Condição objetiva de sunset: remover a compat só quando o Codex estável (sem flag) enviar `server/discover` com `2026-07-28` contra este servidor, medido de novo com este harness. Sem isso a compat continua, sem data fixa (o ramo já previsto no PLAN-CONCLUSAO).
- Claude Code só deixa de bloquear o sunset depois que a compat legada aceitar `2025-11-25`: ele fala o moderno na maioria das execuções, mas em 1 de 8 caiu em `initialize` `2025-11-25` e foi recusado (ver "Variabilidade").

## Método

Harness stdio transparente (`stdio-tee.cjs`): lança o servidor governado real (`tools/mcp-hseos-governance/index.js`) com `NODE_ENV=test`, `HSEOS_GOVERNED_EXECUTION_FIXTURE=1` e banco novo sob `$TMPDIR`, e grava cada frame JSON-RPC trocado com o cliente real. Os frames brutos foram resumidos por `summarize-frames.py` (catálogos de ferramentas viram nomes e contagem, `requestState` é truncado). Não há segredo nos frames.

Como o `codex exec` roda sem login em um `CODEX_HOME` descartável, o Codex sobe os servidores MCP e faz o handshake no início da sessão, antes da chamada ao modelo, e depois falha com 401. Resultado: handshake e `tools/list` observados a custo zero, mas nenhum `tools/call`.

Node 24.15 foi usado no servidor (`better-sqlite3` é compilado para ele), por caminho absoluto na configuração do servidor, sem alterar o PATH dos clientes.

Os frames desta versão do README vêm de uma **reexecução** de rastreabilidade (as execuções originais foram apagadas junto com o scratch; as conclusões se repetiram, com a ressalva de variabilidade acima).

### Isolamento

- `CODEX_HOME=/build/tmp/hseos-w5/closeout/k1r/codex-home` (descartável, removido ao final); `claude` com `--mcp-config <arquivo descartável> --strict-mcp-config --setting-sources "" --no-session-persistence`.
- Antes e depois da reexecução: `~/.codex/config.toml` e `~/.claude/settings.json` com o mesmo sha256 (prefixo) e o mesmo mtime (`runs/home-config-before.txt`, `runs/home-config-after.txt`, `diff` vazio). Isso vale só para a reexecução; a execução original está **declarada**, sem hash.
- Ressalva: o Claude Code reescreve `~/.claude.json` (cache e backups em `~/.claude/backups/`) a cada execução e também a sessão hospedeira o faz; não há hash antes/depois desse arquivo, então "`~/.claude` intocado" não é afirmável. O que se afirma: nenhuma configuração do usuário (`config.toml`, `settings.json`) foi alterada.

### Comandos

```bash
# Codex, configuração isolada (codex-config.default.toml aponta o servidor via o tee)
export CODEX_HOME=/build/tmp/hseos-w5/closeout/k1-codex-home
codex exec --skip-git-repo-check --ephemeral -s read-only "<prompt>" </dev/null                      # 1) padrão
codex exec --enable mcp_2026_07_28 ... </dev/null                                                    # 2) só a feature
# 3) feature + env = { CODEX_MCP_PROTOCOL_VERSION = "2026-07-28" } na tabela do servidor em config.toml

# Claude Code (config descartável, sem tocar a real)
claude -p "<prompt>" --mcp-config claude-mcp.example.json --strict-mcp-config --setting-sources "" \
  --no-session-persistence --model haiku --max-budget-usd 0.05 --allowedTools "mcp__<server>__<tool>" --output-format json </dev/null
```

`claude-mcp.example.json` mostra o formato; os caminhos absolutos do ensaio apontam para o worktree e para `/build/tmp`.

### Inspeção estática

`binary-strings.txt` reúne trechos de `strings` dos binários instalados (Codex 0.163.0, Claude Code 2.1.305). Em ambos há suporte a `2026-07-28`; no Codex ele aparece condicionado à feature e à variável acima.

## Resultados (frames em `frames/`)

| Ensaio                          | Arquivo                              | Sequência observada                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex padrão                    | `codex-default.json`                 | `initialize` (`2025-06-18`, `clientInfo` codex-mcp-client 0.163.0) → erro `-32022 Unsupported legacy protocol version`. Sem nova tentativa.                                                                                                                                                                                                    |
| Codex só com a feature          | `codex-flag-only.json`               | `initialize` `2025-06-18` → `-32022`. A feature sozinha não basta (capturado na revisão, `runs/codex-exec-flag-only-output.txt`).                                                                                                                                                                                                              |
| Codex feature + env             | `codex-flag-and-env.json`            | `server/discover` (`_meta` `2026-07-28`) → `complete`, `supportedVersions:["2026-07-28"]` → `tools/list` → `complete` (15 ferramentas). Sem `initialize`.                                                                                                                                                                                      |
| Claude Code, governado          | `claude-governed-modern.json`        | `server/discover` → `tools/list` → `tools/call list_workflows`, todos `2026-07-28`, `resultType: complete`. Contador legado do banco do ensaio: `mcp_legacy_usage_daily` vazio e `legacy_request_count` 0 (`runs/legacy-counters.txt`, estado `rep1`). Repetição: 6 de 6 execuções em modo moderno (`runs/claude-governed-repetitions.jsonl`). |
| Claude Code, MRTR               | `claude-mrtr-fixture.json`           | `tools/call` → `resultType: input_required` (elicitação `confirm`) → `tools/call` repetido com `inputResponses.confirm = {action:"cancel"}` + `requestState` → erro `-32603 not explicitly approved`.                                                                                                                                          |
| Claude Code, servidor só-legado | `claude-legacy-server-fallback.json` | `server/discover` → `-32601` → `initialize` `2025-11-25` → servidor responde `2024-11-05` → `tools/list`/`tools/call` legados.                                                                                                                                                                                                                 |

Sobre o MRTR do Claude Code: o servidor de fixture (`mrtr-fixture-server.cjs`) usa o adaptador de produção com uma ferramenta que exige aprovação, porque nenhuma das 15 ferramentas do servidor governado em fixture a exige. Em `-p` não há quem responda a elicitação, então o cliente cancela; o ciclo (receber `input_required`, abrir elicitação, repetir com `inputResponses` e `requestState`) está provado, mas o ramo `accept` com um humano não foi exercitado. O ciclo completo `accept` foi validado com um cliente sintético de controle (o fixture devolve `complete` com o eco), que não substitui um cliente real.

#### Variabilidade do Claude Code (ressalva)

Em 1 de 8 execuções contra o servidor governado (`frames/claude-governed-anomaly-initialize-first.json`), o Claude Code 2.1.305 **não sondou** `server/discover`: foi direto a `initialize` `2025-11-25` e recebeu `-32022`, e a ferramenta ficou indisponível. As outras 7 (a primeira do dia mais as 6 repetições) foram modernas. Hipótese não verificada: a negociação stdio depende de flag remota em cache (`tengu_mcp_protocol_negotiation_stdio: true` em `~/.claude.json`); 8 execuções não separam essa causa de outras. Causa da anomalia não determinada. Implicação: com o servidor moderno, o Claude Code também pode falhar de forma intermitente enquanto a compat legada não aceitar `2025-11-25`.

#### Achado de ambiente: o PATH muda a versão do cliente

Com `/workspace/local/sdk/nvm/versions/node/v24.15.0/bin` na frente do PATH (necessário para os hooks de commit), `codex` resolve para **0.154.0** e `claude` para **2.1.263**, ambos mais antigos que os instalados em `~/.local/bin` (0.163.0 e 2.1.305). Esses dois clientes antigos falam só o legado: `frames/node24-prefix-*.json` (Claude Code 2.1.263 envia `initialize` `2025-11-25` e recebe `-32022`; o MRTR não chega a ocorrer). Todas as medições da tabela principal usam o PATH padrão (`~/.local/bin`). Registrado em `runs/node24-prefix-*`.

### NOT_EXERCISED

- Codex `tools/call` e MRTR: exigem chamada ao modelo (login/API). Parado antes de gastar, conforme a regra do K1. A presença do tratamento de MRTR no binário do Codex é só evidência estática.
- Claude Code MRTR com `accept` por humano.
- Claude Code em modo interativo: medido só em `-p`.

### Custo

Codex: US$ 0; cada `codex exec` termina em 401 antes de qualquer inferência (`runs/codex-exec-*-output.txt`, saída redigida: ids de requisição, `cf-ray`, sessão e timestamps).

Claude Code (Haiku 5.5), da reexecução de rastreabilidade (`runs/claude-runs-cost.jsonl`, `runs/claude-governed-repetitions.jsonl`): governado US$ 0,0014 (execução anômala, sem ferramenta), MRTR US$ 0,0014, legado US$ 0,0017, mais 6 repetições US$ 0,0058: ≈ US$ 0,010. À parte, a descoberta do efeito do PATH gastou ≈ US$ 0,073 com clientes antigos (Haiku 4.5; `runs/node24-prefix-claude-runs-cost.jsonl`). Total geral ≈ US$ 0,083, discriminado. Os US$ 0,0051 citados na primeira versão vinham das execuções originais, cujas saídas não foram preservadas (declarado, sem artefato) e não entram nesta soma.

## Arquivos

- `stdio-tee.cjs`, `mrtr-fixture-server.cjs`, `summarize-frames.py` — harness reprodutível.
- `frames/*.json` — frames resumidos de cada ensaio.
- `binary-strings.txt` — evidência estática dos binários.
- `runs/` — saídas redigidas dos `codex exec` (401), custos e repetições do Claude Code, contadores legados, hashes de configuração.
- `codex-config.default.toml`, `claude-mcp.example.json` — configurações descartáveis usadas.

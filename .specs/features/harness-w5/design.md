# Design W5 - capacidades de ambiente, contexto com autoridade e memória

Tipo: design de contratos candidato (W5-01), 2026-10-10. Owner: HSEOS engenharia.
Fontes: spec.md FR01-FR15; docs/evolution/w5/PLAN.md; Constituição §§2.3/2.6/5/7; ADR-0043/0044/0045 e ADR-0047 (Accepted); padrões Hexagonal & Clean Architecture, Data Contracts & Schema Evolution, Resilience Patterns e Observability Playbook.
Base examinada: `e079409c` (master após PR #214). Fatos citam `arquivo:linha` nessa base; o que não foi verificado está marcado **[não verificado]**.
Cada escolha arquitetural traz **Recomendação / Alternativas / Porquê**. O owner decidiu no gate G2 (2026-10-11); as decisões estão aplicadas abaixo e listadas em [PLAN.md](../../../docs/evolution/w5/PLAN.md) seção 7. Onde a decisão mudou a recomendação original, o texto traz **Decisão G2**.

## 1. Propriedade e dependências

- Contratos de contexto, partes multimodais e autoridade pertencem a `packages/agent-context` e `packages/agent-runtime-contracts` (core, transversais).
- Perfis de isolamento e canal de artefatos estendem `packages/agent-isolation-attestation` (core). Plugins executam via `tools/lib/execution-plugin-manifest.js` e `tools/cli/lib/execution-plugin-runtime.js` (W4).
- Empacotamento híbrido: um comando de pack gera o tarball de `plugins/<capacidade>` copiando, no momento do pack, os arquivos do core (fonte única; nenhum código duplicado no repositório). Teste de paridade compara o digest do conteúdo empacotado com o do core. Cada plugin tem teto próprio de ≤40 entradas e ≤1 MB, sem contar pins.
- Contratos **e runtime** de LSP, DAP, navegador e computer-use (schemas, clientes, validadores de resultado, classes de aprovação) pertencem a um pacote novo `packages/agent-environment` (core), com carregamento tardio das dependências pesadas (**Decisão G2**, distribuição híbrida). Cada capacidade também é empacotável como plugin em `plugins/*` a partir da mesma implementação; os binários são pins fora dos tarballs.
- Memória governada pertence a `packages/agent-memory` (core).
- MCP: `tools/mcp-hseos-governance`, `tools/lib/governed-execution/*`, `tools/lib/legacy-mcp-server.js`, `tools/lib/mcp-transport.js`.
- Nada aqui cria scheduler, policy engine, ledger ou saldo paralelos. Reuso concreto em [harness-w5-intake.md](../../../docs/decisions/harness-w5-intake.md).

## 2. Estado atual verificado (base e079409c)

| Fato                                                                                                                                                                                                                               | Fonte                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Mensagens do agente são texto puro: `content: z.string()`                                                                                                                                                                          | `packages/agent-runtime-contracts/agent-contracts.js:59`                                              |
| `image_input` existe como capacidade de modelo, sem consumidor no contexto                                                                                                                                                         | `packages/agent-runtime-contracts/provider-contracts.js:23`, `tools/lib/agent-provider-binding.js:42` |
| `MemorySourceSchema` e `ContextSourceSchema` não têm autoridade nem origem; `classification` só `public\|internal`                                                                                                                 | `packages/agent-context/schemas.js:40-50`                                                             |
| Referências, memória e runtime context já são renderizados como dado citado; só `instructions` vira mensagem de instrução                                                                                                          | `packages/agent-context/context-assembler.js:40-55,185-190`                                           |
| `context.assembled` registra só `source_refs` e orçamento, sem digest nem autoridade                                                                                                                                               | `packages/agent-context/context-assembler.js:428-440`                                                 |
| Só histórico e memória são descartáveis no orçamento; instruções, runtime context e referências são obrigatórios                                                                                                                   | `packages/agent-context/context-assembler.js:207-262`                                                 |
| Tipos de plugin: `tool`, `model-provider`, `runtime-provider`, `context-source`; limites: saída ≤65536 B, memória 256 MiB a 2 GiB, `pids_max` 32 a 256, timeout ≤300 s                                                             | `tools/lib/execution-plugin-manifest.js:20-34`                                                        |
| `executeIsolatedCommand` exige `max_output_bytes` ≤65536 e `timeout_ms` ≤300000                                                                                                                                                    | `packages/agent-isolation-attestation/executor.js:157-166`                                            |
| O grupo de recursos usa `pids_max` 32 por padrão e o recibo reporta `processes: 32`                                                                                                                                                | `executor.js:103`, `executor.js:275`                                                                  |
| Sandbox: `bwrap --unshare-all`, `/tmp` em tmpfs, ambiente limpo, seccomp "networkless"                                                                                                                                             | `packages/agent-isolation-attestation/index.js:321-345`, `index.js:13,98-120`                         |
| O seccomp bloqueia `socket`, `connect`, `bind`, `listen`, `accept`, `socketpair`, `accept4`, `recvmmsg`, `sendmmsg` e `io_uring` (syscalls 41-50, 53, 288, 299, 307, 425-427)                                                      | `packages/agent-isolation-attestation/index.js:13`                                                    |
| Em `bwrap --unshare-all` o loopback funciona e não há rota externa (ensaio de 2026-10-10: bind/connect em 127.0.0.1 OK; conexão externa: `Network is unreachable`)                                                                 | verificação desta task, bubblewrap 0.11.1                                                             |
| Terminal isolado de longa duração (`pty`/`job`) existe                                                                                                                                                                             | `packages/agent-isolation-attestation/terminal-executor.js:12-30`                                     |
| `forkSession` herda autoridade e política do pai e não amplia limites                                                                                                                                                              | `packages/agent-session-store/session-event-store.js:438-480`                                         |
| Servidor MCP de governança carrega tools com `console.error` tolerante e cai no servidor legado fora da fixture                                                                                                                    | `tools/mcp-hseos-governance/index.js:17-56`                                                           |
| Host: Xvfb, xvfb-run, xwd e `chrome-headless-shell-1228` do Playwright (pin decidido pelo owner em 2026-10-12) presentes; `xdotool`, `pyright`, `typescript-language-server` e `debugpy` ausentes (`python-xlib` descartado no G2) | verificação desta task em 2026-10-10                                                                  |
| `typescript` 5.9.3 (Apache-2.0) existe em `node_modules` como dependência transitiva, não declarada em `package.json` do core                                                                                                      | `node_modules/typescript/package.json`                                                                |

Consequências que moldam o design: (a) o executor atual **não consegue** rodar Chromium nem depurador (sem `socketpair`/`socket`, `pids_max`=32, saída 64 KiB); (b) screenshot não cabe no canal de saída; (c) a W5 precisa de perfis de isolamento e de um canal de artefatos antes de qualquer capacidade pesada.

## 3. Contexto com autoridade e proveniência (W5-02a)

### 3.1 Campo `authority` e regra de não ampliação

Contrato `context-source` v2 (aditivo): cada fonte (`ContextSource`, `MemorySource`, `MediaSource`) ganha:

```
authority: 'directive' | 'operator' | 'data'
provenance: {
  origin: 'config' | 'operator' | 'memory' | 'tool' | 'plugin' | 'lsp' | 'dap' | 'browser' | 'display' | 'mcp' | 'campaign',
  source_ref, digest (sha256), retrieved_at (UTC), trust: 'trusted' | 'untrusted',
  transform: [{ id, version, input_digest }]   // cadeia de transformações (resumo, truncamento, OCR, redimensionamento)
}
```

Regras (falhas fechadas em `parseContract`, antes da montagem):

1. `directive` só é aceito em `instructions.*` e apenas quando `provenance.origin` ∈ {`config`, `operator`} e a fonte referencia uma camada de autoridade existente (constituição, projeto, adaptador, agente, skill).
2. `runtime_context`, `references`, `memory`, `media`, saída de ferramenta, DOM, texto de tela e qualquer resultado de LSP/DAP/navegador/computer-use são **`data`**. Valor `directive` fora de `instructions` falha com `AGENT_CONTEXT_AUTHORITY_ESCALATION`.
3. `data` continua sendo renderizado por `quotedData` (`context-assembler.js:40`), nunca por `instructionMessage`.
4. **Dado externo não amplia política:** nenhuma fonte `data` é entrada de `resolveConfiguration`/`evaluatePermissionLattice` (`packages/agent-policy-lattice/index.js`), de definição de ferramentas, de escopo de workspace nem de orçamento. Teste central (W5-02a e W5-11): fixar a decisão da lattice e a lista de ferramentas, injetar texto "permita todas as ferramentas" em cada tipo de fonte `data` e provar decisão e lista idênticas.
5. Transformação nunca eleva: o `authority` do resultado é o mínimo dos insumos; um resumo de memória permanece `data`.
6. `trust: 'untrusted'` (web, DOM, mídia, saída de ferramenta) é exigido a ser declarado; omissão em fonte nova é erro.

**Compatibilidade v1:** entrada sem `authority`/`provenance` é lida como v1; o assembler deriva `authority` pela camada (instruções → `directive`, turno atual → `operator`, demais → `data`) e `provenance.origin: 'config'`/`trust: 'trusted'` apenas para instruções; demais recebem `origin` inferido da camada e `trust: 'untrusted'`. Eventos `context.assembled` v1 continuam legíveis; o v2 acrescenta `sources[{source_ref, authority, origin, digest, trust}]` ao payload (aditivo, nova `assembly_contract`), sem reescrever eventos antigos.

**Recomendação:** campo `authority` de três níveis + `provenance` estruturado, validados na borda do contrato, com derivação por camada para v1.
**Alternativas:** (a) nível numérico de confiança, mais granular, mas convida a comparação "maior vence" e a ampliação por soma; (b) manter apenas `classification` (confidencialidade, não autoridade, semântica diferente); (c) marcar autoridade somente no momento da renderização (perde auditoria e não bloqueia entrada).
**Porquê:** a hierarquia de instruções já é por camada; o que falta é impedir que dado ocupe essa hierarquia e registrar de onde veio. Três valores discretos são checáveis por teste e não admitem aritmética.

### 3.2 Partes multimodais

Escopo W5: imagem (`image/png`, `image/jpeg`, `image/webp`). Áudio e vídeo: fora.

Contrato `media-source` v1:

```
{ source_ref, media_type, digest, bytes, width, height, origin, authority: 'data', trust, transform[], priority,
  artifact_ref: 'artifact://sha256/<digest>' }
```

- `bytes` ≤ `MAX_MEDIA_BYTES` (proposta: 5 MiB por item, 16 MiB por montagem, 8 itens; valores finais fixados em W5-02a e registrados no recibo). O conteúdo **não** entra em evento nem em `context.assembled`; só `artifact_ref`, `digest`, `bytes`, `media_type`.
- Antes do uso: carregar do repositório de artefatos, recalcular SHA-256, comparar com `digest` e `bytes`, validar assinatura mágica do `media_type`; divergência falha com `AGENT_CONTEXT_MEDIA_DIGEST_MISMATCH` sem efeito (mídia adulterada).
- Custo em tokens: `TokenCounter` v2 expõe `count_media({media_type, width, height, bytes})` determinístico e conservador (limite superior); o contador atual (`token-counter.js:17-26`) continua válido para texto. Contador sem `count_media` rejeita mídia (`AGENT_CONTEXT_COUNTER_MEDIA_UNSUPPORTED`).
- Rejeição precoce: se `media[]` não for vazio e o provider selecionado não declarar `image_input` (`provider-contracts.js:23`), a montagem falha com `AGENT_CONTEXT_PROVIDER_LACKS_IMAGE_INPUT` antes de `append` no ledger e antes de qualquer chamada ao provider.
- Orçamento: mídia é opcional como memória (ordenada por `priority`); item omitido entra em `omitted_source_refs`. Mídia requerida pela tarefa é declarada na `current_turn` (`parts`) e então participa do piso obrigatório.
- Mensagens ao provider: `AgentMessage` v1 mantém `content: string`. A requisição ao provider v2 acrescenta `parts: [{type:'text'|'image', ...}]` em mensagem separada; leitores v1 ignoram o campo e o replay v1 continua correto (nenhum evento antigo muda).
- Armazenamento: repositório de artefatos endereçado por conteúdo `artifact://sha256/<digest>`, mesmo padrão e mesmas garantias de `tools/cli/lib/campaign-evidence-store.js` (`storeEvidence`/`readEvidence`, sem links simbólicos, teto), estendido a binários; varredura de credenciais por `containsCredential` aplica-se a texto extraído (DOM, OCR, nomes), não a pixels.

**Recomendação:** `media[]` como lista própria no input, mais `parts` aditivo na requisição v2, com bytes fora do ledger.
**Alternativas:** (a) trocar `AgentMessage.content` por união string|partes (quebra leitores e replay v1); (b) imagem como `data:` URI em texto (digest não verificável, custo de tokens inflado, ledger inchado); (c) anexos por canal lateral sem registro no contexto (perde proveniência).
**Porquê:** é a única opção que preserva leitura v1, mantém o ledger pequeno e permite checar o digest antes do efeito.

### 3.3 Falhas e versões

| Código                                     | Condição                                                                      | Efeito                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `AGENT_CONTEXT_AUTHORITY_ESCALATION`       | `directive` fora de `instructions` ou origem não confiável em camada diretiva | recusa antes da montagem                                       |
| `AGENT_CONTEXT_PROVENANCE_MISSING`         | fonte v2 sem `provenance` completa                                            | recusa                                                         |
| `AGENT_CONTEXT_MEDIA_DIGEST_MISMATCH`      | bytes ≠ digest/bytes/magic                                                    | recusa; evento `context.rejected` v1 existente não é reescrito |
| `AGENT_CONTEXT_MEDIA_TOO_LARGE`            | teto por item/montagem                                                        | recusa                                                         |
| `AGENT_CONTEXT_PROVIDER_LACKS_IMAGE_INPUT` | provider sem `image_input`                                                    | recusa sem efeito                                              |
| `AGENT_CONTEXT_COUNTER_MEDIA_UNSUPPORTED`  | contador sem `count_media`                                                    | recusa                                                         |

Versões: `context-source` v2 e `media-source` v1 (novos); `context.assembled` `assembly_contract` v2 (aditivo); leitura v1 preservada; downgrade recusa retomada de sessão com eventos v2 (não ignora).

## 4. Perfis de isolamento e canal de artefatos (W5-02b1)

Os requisitos do browser, do depurador e do display não cabem no executor atual (seção 2). Este é o ponto de maior risco de segurança da W5; é isolado numa task própria, em arquivos do kernel compartilhado, antes de B2/B3.

Perfis (declarados no manifesto do plugin e no contrato da capacidade; o controlador **escolhe** o perfil, o plugin só o referencia). **Decisão G2:** P1 (loopback) e P2 (egresso pelo broker) aprovados; o seccomp por argumento permite `AF_UNIX` e `AF_INET*` e mantém bloqueados `AF_NETLINK`, `AF_PACKET`, `AF_VSOCK` e `io_uring`:

| Perfil                          | Rede                                                                  | seccomp                                                                                                                            | Uso                                                       |
| ------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `P0 sem-rede` (atual)           | netns vazio                                                           | bloqueia `socket*`, `accept*`, `connect`, `io_uring`                                                                               | ferramentas, LSP                                          |
| `P1 loopback`                   | netns só com `lo` (verificado)                                        | permite `socket(AF_UNIX\|AF_INET*)` com filtro de argumento; continua bloqueando `AF_NETLINK`, `AF_PACKET`, `AF_VSOCK`, `io_uring` | DAP (debugpy/js-debug usam TCP local), navegador, display |
| `P2 loopback + egresso mediado` | `lo` + relay para socket Unix do broker montado em `/run/broker.sock` | idem P1                                                                                                                            | navegador com rede permitida                              |

Extensões ao executor (sem remover nenhum teto global): limites por chamada `pids_max` (32-256), `memory_max_bytes` (até 2 GiB), `/dev/shm` dimensionado, e **canal de artefatos**:

- O controlador monta um diretório gravável `/artifacts` (tmpfs com quota) por execução; o plugin escreve ali e imprime em stdout apenas um manifesto `[{path, media_type, bytes, sha256}]` (≤64 KiB, teto de saída inalterado).
- O controlador recalcula tamanho e SHA-256, valida assinatura mágica, rejeita links, nomes fora de `/artifacts` e manifestos divergentes, e só então promove ao repositório de artefatos.
- O recibo passa a incluir `pids_peak`, `memory_peak_bytes` e `limits` efetivos (pendência de sinais fora do recibo; ver seção 12).

**Recomendação:** perfis nomeados escolhidos pelo controlador, filtro seccomp por argumento para P1/P2 e `/artifacts` verificado.
**Alternativas:** (a) remover o seccomp para a capacidade (inaceitável: amplia superfície para todo código do plugin); (b) subir `max_output_bytes` global (afeta todos os plugins, ainda não comporta imagens sem base64 inflado); (c) rodar Chromium fora do sandbox, direto no host (viola isolamento e W4 "sem import no host"); (d) base64 em stdout (mesmo problema do item b).
**Porquê:** P0 permanece como padrão e inalterado, o aumento de superfície fica restrito a quem declara P1/P2 e é aprovado por política; o canal de artefatos conserva o teto de saída e dá ao controlador um ponto único de verificação.

**Decisão G2:** Chromium roda com `--no-sandbox`, sempre dentro do `bwrap` (o `bwrap` é o sandbox). **Pendências de ambiente que decidem a viabilidade (resolver na W5-02b1 antes de B3):** quantidade de processos e memória reais do Chromium **[não verificado]**; Xvfb em `/tmp` tmpfs do sandbox **[não verificado]**. Se um ensaio provar inviável, a capacidade fica BLOCKED com a causa, nunca com perfil afrouxado.

**Leitura do virtual store do pnpm e testes nativos do projeto (W5-02b2, em sequência à W5-02b1 no mesmo slot; pendências A1/N2 da validação em consumidor).** O executor do projeto gerenciado recusa hoje o virtual store porque o regex de caminho (`engineering-task-contract.js`, `projectPath`) não aceita `@` em `node_modules/.pnpm/<pacote>@<versão>`, além de symlinks, hardlinks do store, o limite de 64 caminhos e 1 MiB e arquivos acima de 65536 caracteres. A W5-02b2 amplia o alfabeto de caminho somente para esse prefixo, resolve symlinks e hardlinks do store dentro de uma raiz verificada (nunca fora dela), trata os limites com valores explícitos medidos no consumidor (recusa ou leitura em partes, nunca truncamento silencioso) e faz o verificador executar os testes nativos do projeto (`vitest`, `tsc`) como `command_checks`, não só o script autocontido provado até aqui. Os limites reais de processos e memória do vitest passam a constar do recibo. Fonte: `docs/evolution/consumer-validation-2026-10/STATUS.md`.

## 5. Contratos das capacidades

Padrão comum (ToolRuntime): cada ação é uma tool `environment.<capacidade>.<ação>` com contrato versionado em `tools/lib/governed-execution/contract-registry.js` (reversibilidade, política de cancelamento, modo de falha `fail_closed`, `input_schema`/`output_schema` versionados), classe de aprovação e perfil de isolamento. O resultado é validado no controlador por schema e por validador de domínio (escopo, caminhos, tamanho) **antes** de virar dado de contexto (`authority: data`, `trust: untrusted`).

### 5.1 LSP (W5-05) - core

Contrato `environment.lsp.v1`: entrada `{ action: 'diagnostics'|'definition'|'references'|'hover'|'rename_preview', language: 'typescript'|'python', file, position?, new_name? }`; saída com localizações **relativas à raiz do workspace**, texto de hover truncado e, para `rename_preview`, um `WorkspaceEdit` serializado, jamais aplicado.

- Execução: **P1** (desvio aprovado na W5-05 em relação ao P0 proposto), workspace montado **somente leitura**, um processo por ação (`initialize` → `didOpen` → requisição → `shutdown`/`exit`), teto de tempo/saída; resultado grande vai ao canal de artefatos. **Por que P1:** sob P0 o `spawn` do servidor de linguagem falha com `EPERM`, e sob P1 funciona (prova em `docs/evolution/w5/evidence/w5-05/p0-eperm.log`). O cliente recusa qualquer perfil abaixo de P1 com `ENV_LSP_PROFILE_INSUFFICIENT` (`packages/agent-environment/lsp.js`), em vez de degradar em silêncio.
- Escopo: `rootUri` = `/workspace`; o validador do controlador converte URIs em caminhos, resolve `realpath` e **descarta ou recusa** qualquer localização fora da raiz (inclusive via symlink ou `..`); resposta com arquivo fora da raiz falha com `ENV_LSP_OUT_OF_SCOPE` e entra no ledger.
- Nenhuma escrita: workspace ro e tmpfs de `/tmp`; edição proposta pelo `rename_preview` só é aplicada pelo caminho de patch existente (W1, com baseline e aprovação).
- Servidores: TypeScript = `typescript-language-server` (Apache-2.0) sobre `typescript` fixado; Python = `pyright` (MIT). Binários não ficam no pacote: são "toolchain pins" (nome, versão, SHA-256 do tarball, licença) instalados offline pelo operador num diretório de toolchain montado ro. Ausente → BLOCKED.
- **Distribuição (G2, híbrida): core** (contrato, cliente stdio e validador em `packages/agent-environment`, ~3 arquivos), **também empacotável** como `plugins/lsp` a partir do mesmo código. **Recomendação:** core. **Alternativas:** plugin separado (kind `tool`). **Porquê:** protocolo leve, sem dependência npm nova (framing `Content-Length` próprio, ~100 linhas), e o validador de escopo é fronteira de segurança que não pode depender de instalação opcional; os servidores, que são o peso, já ficam fora como toolchain pins.
- Alternativa de servidor consideradas: `vtsls` (TS), `python-lsp-server`/`jedi-language-server` (Python). Escolha final dos pins na W5-05 conforme disponibilidade offline.

### 5.2 Debug / DAP (W5-06) - core

Contrato `environment.dap.v1`: **execução roteirizada e limitada**, sem sessão persistente. Entrada: `{ runtime: 'node'|'python', launch: {program|module, args, cwd}, breakpoints: [{file, line, condition?}], steps: [{op:'continue'|'next'|'stepIn'|'stepOut'}] (≤N), capture: {stack: bool, variables_depth ≤2} , timeout_ms }`. Saída: sequência de paradas `{reason, stack[], scopes[], variables[]}` com valores truncados.

- Execução: P1 (loopback para o adaptador), workspace ro, tmpfs `/tmp`, `pids_max` declarado, timeout total; encerramento por drenagem do cgroup (reuso W4) com prova de zero descendentes.
- Excluído na W5: `evaluate`, `setVariable`, `setExpression`, `restartFrame` e qualquer ação que execute código arbitrário no depurado ou altere seu estado. Leitura de `variables` apenas. Ampliação exige novo contrato e aprovação.
- Breakpoints fora de `/workspace` são recusados (`ENV_DAP_OUT_OF_SCOPE`).
- Adaptadores: Python = `debugpy` (MIT); Node = `js-debug` (`vscode-js-debug`, MIT). Pins offline como no LSP; ausentes → BLOCKED **[disponibilidade offline não verificada; `debugpy` ausente no host]**.
- **Distribuição (G2, híbrida): core** (contrato, cliente DAP e validador, ~3 arquivos compartilhando o framing do LSP), **também empacotável** como `plugins/dap`. **Recomendação:** core + adaptadores como pins. **Alternativas:** plugin separado; sessão interativa via `terminal-executor` modo `job`. **Porquê:** mesmo raciocínio do LSP; execução roteirizada é determinística, repetível em teste e cabe no canal de saída/artefatos. Sessão interativa fica para quando a W6 precisar de depuração de UI (registrado como dependência da W6, não como defeito da W5).

### 5.3 Navegador (W5-07) - core com carregamento tardio, empacotável como plugin

Contrato `environment.browser.v1` e runtime no core (`packages/agent-environment`), com `playwright-core` carregado sob demanda do pin em cache offline (nenhum `require` no topo; `dependencies` do core inalterado). A mesma implementação é empacotável como `plugins/browser` (kind `tool`, `hseos-plugin-browser`). Execução em lote sem estado: `{ steps: [{op:'goto'|'click'|'type'|'press'|'wait_for'|'screenshot'|'dom_snapshot', ...}] (≤N), viewport, timeout_ms }`; cada chamada abre contexto novo e o descarta (sem cookies persistentes).

- Execução: perfil P2 e `pids_max` 256 / memória até 2 GiB (limite superior do manifesto) **[suficiência para Chromium não verificada]**. Egresso: Chromium recebe `--proxy-server=http://127.0.0.1:<porta>` apontando para um relay TCP→socket Unix dentro do sandbox, que encaminha a um broker de egresso novo (`tools/cli/lib/environment-egress-broker.js`, allowlist por host:porta; padrão = `localhost` do servidor do projeto). O broker existente `provider-egress-broker.js` aceita só `POST /provider/chat/completions` (`provider-egress-broker.js:124`), logo é reutilizado apenas no padrão (escuta em socket Unix, `createUnixSocketFetch`, tetos de requisição/resposta/segredo), não como proxy genérico. Host fora da allowlist: bloqueado e registrado (`ENV_BROWSER_EGRESS_DENIED`); resolução DNS não ocorre dentro do sandbox. Servidor de desenvolvimento do projeto roda no **mesmo** sandbox (loopback) ou em execução irmã registrada.
- Saída: screenshot PNG e DOM (texto, árvore acessível truncada) via `/artifacts` → `media-source` e `context-source` com `origin: 'browser'`, `trust: 'untrusted'`, `authority: 'data'`, `transform` (viewport, redimensionamento), URL final, hora UTC e digest.
- Segredos: sem credenciais no ambiente; DOM passa por `containsCredential`; cookies/headers nunca saem.
- Binário: `chrome-headless-shell-1228` fixado por revisão (presente em `/workspace/local/sdk/playwright`; texto BSD-3 em `LICENSE.headless_shell`; o `chromium-1228` saiu do pin em 2026-10-12 por trazer só a licença do Widevine), `playwright-core` (Apache-2.0) em versão compatível **[versão do pacote a fixar na W5-07; não verificada]**; sem download em tempo de execução (variável de caminho do navegador aponta para o cache pinado, `PLAYWRIGHT_BROWSERS_PATH`/`executablePath`).
- **Distribuição (G2, híbrida): runtime no core com carregamento tardio e empacotamento em `plugins/browser/`** (fora de `files` do core, tarball próprio, admitido por `hseos plugin install`). **Decisão G2** substitui a recomendação anterior de plugin exclusivo. **Alternativas descartadas:** plugin exclusivo (fronteira de segurança dependente de instalação opcional); biblioteca "headless" mais leve sem Chromium. **Porquê:** o peso real (Playwright e centenas de MB de Chromium) fica nos pins fora de qualquer tarball, então o custo do runtime no core é de poucos arquivos; o validador e o runtime continuam sob o mesmo gate de segurança do core, e quem quiser isolar a release usa o plugin gerado do mesmo código.

### 5.4 Computer-use (W5-08) - core com carregamento tardio, empacotável como plugin

Contrato `environment.computer.v1` e runtime no core, Linux apenas, com carregamento tardio; empacotável como `plugins/computer-use` (kind `tool`, `hseos-plugin-computer-use`). Diferente do navegador, exige **sessão de display** com estado: `start` (cria Xvfb e processo-alvo) → `act` (uma ação por chamada) → `stop`.

- Sessão: executa em `terminal-executor` modo `job` (processo isolado de longa duração, cgroup, `timeout_ms` ≤300 s e renovável só por nova aprovação), P1. Aberta/fechada/expirada por eventos no ledger; `stop` e expiração drenam descendentes.
- Display: `Xvfb :N -nolisten tcp` com socket em diretório privado do sandbox; o sandbox usa `/tmp` em tmpfs e ambiente limpo (`index.js:341`), portanto o socket X (`/tmp/.X11-unix`) e o `DISPLAY` do operador não existem lá. Teste negativo: apontar `DISPLAY` para o display real deve falhar. Wayland/`XDG_RUNTIME_DIR` idem **[montagem real não verificada nesta task]**.
- Ações: `screenshot`, `move`, `click`, `double_click`, `type`, `key`, `scroll`. Toda ação exceto `screenshot` exige aprovação.
- **Aprovação por ação:** pedido vinculado a `{session_id, seq, action, args, digest do último screenshot}`; resolução via `evaluatePermissionLattice` no estágio `ask` (`packages/agent-policy-lattice/index.js:14-23`) e resultado `approval_outcome` registrado no ledger; aprovação de uso único, expira, não vale para outra ação nem outra sessão; `approve_all`/modo `bypass` **não** se aplicam ao computer-use (negado por contrato).
- Captura: PNG (`xwd` + codificação PNG no plugin, ou ferramenta equivalente) em `/artifacts`, mesma proveniência do navegador com `origin: 'display'`.
- Dependências **[nenhuma verificada como instalável offline]**: `Xvfb` (presente), `xwd` (presente), injetor de entrada **`xdotool` (BSD), pin externo** (decisão G2; `python-xlib` LGPL-2.1+ descartado) e um alvo GUI de teste. Licença conferida no artefato fixado.
- **Distribuição (G2, híbrida): runtime no core com carregamento tardio, empacotável em `plugins/computer-use/`**, Linux apenas. **Alternativas descartadas:** plugin exclusivo; adiar. **Porquê:** a dependência de sistema (X11, `xdotool`) fica em pins fora do tarball; o gate de aprovação e o validador ficam no core de qualquer forma.

### 5.5 Memória governada (W5-09) - core

Contrato `agent-memory.v1`: entrada de memória `{ memory_id, scope: {project_id}, content (≤ teto), authority: 'data' (fixo), origin, trust, classification, source_ref, source_digest, created_at, ttl_seconds (obrigatório, ≤ teto da política), write_policy_ref, supersedes? }`.

- Persistência: eventos no ledger existente, `aggregate_type = 'agent_memory'`, CAS por sequência esperada; projeção de recuperação (índice lexical determinístico) descartável e reconstruível dos eventos. Expiração por TTL é evento `memory.expired` ou filtro por relógio injetado (testável).
- Política de escrita: operação `memory.write` é capacidade avaliada pela lattice (`allow`/`ask`/`deny`); escrita sem política admissora é negada; conteúdo passa por `containsCredential`; origem `untrusted` só é gravada com `trust: 'untrusted'` e **fica fora** da recuperação padrão (política pode incluí-la, sempre como `data`).
- **Memória não amplia autoridade:** `authority` é constante `data`; qualquer tentativa de gravar `directive`/`operator` falha com `AGENT_MEMORY_AUTHORITY_ESCALATION`; recuperação devolve `MemorySource` v2 (`authority: data`, `origin: memory`, proveniência da entrada original em `transform`).
- Escopo: por projeto (identidade do workspace); nunca entre projetos; exclusão por TTL, por substituição e por comando explícito do operador, cada uma com evento.
- Ponte opcional: `tools/mcp-axon-bridge` `memory_search` (somente leitura) mapeia resultados para `memory[]` com `origin: 'mcp'`, `trust: 'untrusted'`; sem o bridge, é no-op; nenhum aceite depende dela.
- **Distribuição (G2, híbrida): core**, também distribuível como `plugins/memory` (empacotamento do mesmo código; o plugin não escreve por conta própria, o host executa a escrita no ledger). **Recomendação:** `packages/agent-memory` sobre o ledger. **Alternativas:** plugin `context-source` (W4): isola, mas o plugin **não recebe ledger nem credenciais** (spec W4), logo não pode escrever com CAS nem aplicar política de escrita; store próprio em SQLite separado (viola "ledger canônico, projeção descartável", invariantes do plano); banco vetorial externo (nova dependência pesada e não determinística). **Porquê:** memória é estado com autoridade e precisa do mesmo gate do ledger; recuperação lexical é determinística e testável. Embeddings ficam fora (sem benefício comprovável por consumidor real nesta onda). **Justificativa do `plugins/memory` (decisão do Commander):** o plugin distribui o mesmo código do core e a persistência continua no ledger do host; é o desenho correto de governança, porque a memória não pode ter store próprio fora do ledger e o plugin `context-source` não recebe ledger.

### 5.6 Compactação combinada (W5-03)

Sem contrato novo previsto. Cenário determinístico: sessão com histórico longo → montagem com `overflow_policy: 'compact'` → crash simulado entre `compaction.completed` e `context.assembled` → `recoveryPlan` + retomada → `forkSession` no ponto pós-compactação → comparação com o histórico integral: mesmos `source_refs` obrigatórios, mesma autoridade por fonte, critérios de aceite fixados presentes e lineage íntegro (`compaction.completed` referencia os eventos substituídos). Critérios de aceite fixados precisam estar em `references`/`instructions` (obrigatórios, nunca compactáveis, `context-assembler.js:207-262`); critério existente **só em histórico de turnos** é compactável e o teste deve provar esse limite e a regra de fixação. Se a regra de fixação exigir campo novo (por exemplo `retention: 'required'`), ele é aditivo e entra com a W5-03 depois da W5-02a. Reuso: `packages/agent-compaction/runtime.js`, `forkSession` (`session-event-store.js:438`), `replay.js` (`reconstructModelRequest`, `buildRecoveryPlan`).

### 5.7 MCP subordinado (W5-04)

- O servidor `mcp-hseos-governance` deixa de cair no servidor legado fora da fixture (`index.js:50-56`): o caminho legado só executa com `NODE_ENV=test` e fixture explícita; fora disso falha fechado.
- Carregamento de tool malformado (`index.js:17-35`) falha o boot do servidor com código de erro, em vez de `console.error` e omissão.
- Tool desconhecida, argumento fora do escopo e resposta inválida são negados e **registrados no ledger** (evento versionado do gateway), com `rpc_code` consistente.
- Tools W5 (`environment.*`, `memory.*`) entram como contratos versionados em `contract-registry.js`; `$ref` não resolvível falha **no registro**, não na chamada.
- Absorção das pendências MCP da revalidação: seção 12.

## 6. Compatibilidade, versões e migração

- Leitura v1 de contexto, eventos, tarefa v2, controle v1 e catálogo v3 é preservada; novos contratos têm versão própria e campos aditivos. Nenhum evento é reescrito.
- Mudanças de comportamento comunicadas: `limit`/`stale_minutes` em string deixam de ser aceitos (A6); servidor legado MCP só em fixture. Ambas entram em nota de migração (`docs/v4-migration.md` na W5-12).
- Rollback: desabilitar novas admissões de plugins de ambiente e das tools `environment.*`; manter pins e eventos; versão incapaz de ler evento novo recusa retomada. Memória: leitura de eventos `agent_memory` v1 por versão anterior é recusada, não ignorada.
- Migração SQL: nenhuma migration operacional é ativada (mesma regra da W4); projeção de memória é reconstruível.

## 7. Segurança e observabilidade

- Toda ação de ambiente: política (lattice) → contrato do ToolRuntime → execução isolada → validação do resultado → registro no ledger. Autoridade efetiva é interseção.
- Cada execução registra perfil, limites efetivos, `pids_peak`, duração, bytes de saída e de artefatos, códigos de recusa, digest de entrada/saída e a aprovação (quando houver); sem valores de segredo.
- Códigos de erro estáveis por capacidade (`ENV_LSP_*`, `ENV_DAP_*`, `ENV_BROWSER_*`, `ENV_COMPUTER_*`, `AGENT_MEMORY_*`).
- Incerteza (processo não drenado, artefato sem manifesto, sessão sem `stop`) é estado observável e bloqueante, nunca PASS.
- Cargas pesadas em teste: `heavy-run`, um job pesado por vez, `--maxWorkers` limitado em suítes jsdom (AGENTS global §3f).

## 8. Orçamento de pacote (decisão G3 parcial do G2)

Medido em `e079409c` com Node 24 (`npm pack --dry-run --json`): 1459 entradas, 9,69 MB; teto 1540 e orçamentos por área em `test/test-package-surface.js:120-141`.

**Decisão G2:** vence a opção "elevar o teto"; a realocação entre áreas (`.enterprise` 484→469, `.agents` 193→194) está descartada.

- Orçamento da área `packages`: 123 para **137** (aprovado).
- Teto total do core: **1554** (`packages` 137): é a opção "elevar o teto" escolhida pelo owner e aprovada no G3 de 2026-10-11 (`packages` sobe para 137 e o teto na mesma medida). Acima de 1554 só vale o número **medido** no fechamento da onda, com novo G3; projeção alta com o híbrido (runtime de navegador e computer-use no core): **≈1565** (estimativa, não decisão).
- Plugins (`plugins/*`, fora de `files` do core): teto próprio de **≤40 entradas e ≤1 MB cada**, sem contar os pins, verificado por teste de superfície do plugin.
- `test/test-package-surface.js` não é alterado por esta task. A alteração (`packages` 137, teto 1554) entra na W5-02a, primeira task que adiciona entradas em `packages`.

| Área          | Medido | Orçamento atual | Folga | W5 central | W5 alto | Situação                                                                                            |
| ------------- | -----: | --------------: | ----: | ---------: | ------: | --------------------------------------------------------------------------------------------------- |
| `.enterprise` |    446 |             484 |    38 |         12 |      16 | cabe                                                                                                |
| `tools`       |    375 |             393 |    18 |          4 |      10 | cabe                                                                                                |
| `src`         |    245 |             250 |     5 |          0 |       1 | cabe                                                                                                |
| `.agents`     |    186 |             193 |     7 |          6 |       8 | alto excede 1; decidir pelo medido no fechamento                                                    |
| `packages`    |    113 |             123 |    10 |         24 |      32 | orçamento aprovado em 137; contratados 24 arquivos novos = 137 exato (ver PLAN §7.3); vale o medido |
| `.hseos`      |     61 |              62 |     1 |          0 |       1 | cabe (justo)                                                                                        |
| `scripts`     |     19 |              21 |     2 |          0 |       1 | cabe                                                                                                |
| `docs`        |      7 |               7 |     0 |          0 |       1 | alto exige +1 somente com doc de usuário novo                                                       |
| `(root)`      |      7 |               7 |     0 |          0 |       0 | cabe                                                                                                |
| **Total**     |   1459 |   1540 (→ 1554) |    81 |         39 |      61 | central 1498; alto 1520; híbrido alto ≈1565 (estimativa)                                            |

As colunas W5 e as projeções por área são **estimativa, não decisão**; vêm da projeção anterior (plugins fora do core); o híbrido acrescenta ao core o runtime de navegador e computer-use (`browser.js`, `browser-host.js`, `computer.js`, `computer-host.js`) e arquivos de empacotamento, por isso a projeção alta sobe para ≈1565. É estimativa: o que vale é o número medido.

Composição de `packages` (central/alto, base anterior): `agent-context` +2/+3, `agent-runtime-contracts` +1, `agent-isolation-attestation` +2/+3, `agent-environment` (novo) +7/+9 sem navegador e computer-use, `agent-memory` (novo) +5/+6, superfícies +0/+2.

**Restrição do teste de superfície:** a assertiva `area budgets must not exceed the entry ceiling` exige que a soma dos orçamentos por área seja no máximo o teto. Hoje a soma é 1540; com `packages` 137 ela chega a 1554, por isso o teto aprovado é 1554 e os dois entram juntos na W5-02a (decisão do Commander sobre a opção "elevar o teto" do G3).

Nenhuma dependência npm nova entra no core: `dependencies` permanece inalterado e `playwright-core` é carregado do pin em cache offline.

## 9. Ambiente e dependências de terceiros (origem, licença, instalação offline)

| Item                                      | Origem / licença (fonte oficial, **a confirmar no lockfile da task**) | Onde               | Offline                                 | Estado no host               |
| ----------------------------------------- | --------------------------------------------------------------------- | ------------------ | --------------------------------------- | ---------------------------- |
| `typescript` (tsserver)                   | npm / Apache-2.0                                                      | toolchain pin      | tarball no cache                        | 5.9.3 transitivo presente    |
| `typescript-language-server`              | npm / Apache-2.0                                                      | toolchain pin      | tarball no cache                        | ausente                      |
| `pyright`                                 | npm / MIT                                                             | toolchain pin      | tarball no cache                        | ausente                      |
| `debugpy`                                 | PyPI / MIT                                                            | toolchain pin      | wheel no cache                          | ausente                      |
| `js-debug` (vscode-js-debug)              | GitHub release / MIT                                                  | toolchain pin      | artefato no cache                       | ausente **[não verificado]** |
| `playwright-core`                         | npm / Apache-2.0                                                      | pin (carga tardia) | tarball no cache                        | versão a fixar               |
| `chrome-headless-shell-1228` (Playwright) | CDN Playwright / BSD-3 e licenças de componentes                      | cache pinado       | já em `/workspace/local/sdk/playwright` | presente                     |
| `Xvfb`, `xwd`                             | pacotes Linux / X11 (MIT-estilo)                                      | pacote do sistema  | requer pacote local                     | presentes                    |
| `xdotool` (decisão G2)                    | pacote Linux / BSD                                                    | pin externo        | requer pacote local                     | **ausente**                  |

Regras: sem download em tempo de execução; cada pin tem nome, versão, SHA-256 e licença registrados num manifesto de toolchain verificado na instalação (`hseos plugin doctor`); indisponibilidade → BLOCKED com a causa. Licenças acima vêm de conhecimento dos projetos oficiais e **não foram conferidas nesta task**; a conferência com o texto da licença no artefato fixado é critério de aceite de cada task de capacidade (W5-02b1 ensaio, W5-05 a W5-08; a W5-09 não tem pin). A lista de pins e a política "sem download em tempo de execução; sem cache = BLOCKED" foram aprovadas no G2.

## 10. Consumidores reais A e B (resumo; detalhes em PLAN.md seção 7)

Core e plugins instalados offline fora do checkout. **A** (`cambio-real/apps/platform-web`, clone descartável só do app, vitest com `--maxWorkers=2`, nunca teste na raiz do monorepo): teste real existente com defeito injetado; sequência LSP → DAP → correção (patch governado) → verificação no navegador com screenshot → aceite pelo verificador externo fixado. **B** (`axon-web`): segundo consumidor de UI; teste e defeito **sintéticos**, declarados como tais na evidência. Modelo: local ou de custo zero; assinaturas Claude/Codex com no máximo 3 despachos por binding; API paga com teto de US$ 1; reserva e recibo por despacho; sem rota, BLOCKED; gasto além do teto exige G4. A mesma jornada alimenta três provas: proveniência (cada passo gera fonte `data` com digest), delimitação (LSP/DAP/navegador fora do escopo negados) e aprovação (computer-use sem aprovação negado, em teste de fixture própria, pois a jornada TS não exige GUI).

## 11. Pendências da revalidação: onde cada uma entra

| Pendência (STATUS da revalidação)                                                          | Destino                                          | Observação                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Divergência `-32600` do adapter `mcp-2026` para notificação de método conhecido            | W5-04                                            | alinhar ao transporte endurecido; teste de conformidade                                                                                                          |
| `limit`/`stale_minutes` em string rejeitados                                               | W5-04 (+ nota na W5-12)                          | comunicar como mudança de comportamento                                                                                                                          |
| Transporte HTTP legado sem limite de corpo                                                 | W5-04                                            | teto de corpo e `413`; legado só em fixture                                                                                                                      |
| `$ref` não resolvível só falha na chamada                                                  | W5-04                                            | resolver no registro de contrato                                                                                                                                 |
| Swarm: TOCTOU, hardlink, `cwd` não validado                                                | W5-04                                            | validar `cwd`, abrir com `O_NOFOLLOW`/`fstat` e checar `nlink`; teste negativo                                                                                   |
| Critérios de aceite fracos aprovaram entrega reprovada pelo verificador externo (A5b)      | **W5-10b** (FR12, FR14), decidido no G2          | contrato v2 recusa entrega sem verificador executável, com `detail.code`; inclui REVIEW3-C1 (args de `command_checks`) e N1 (`detail.code` nas recusas cruzadas) |
| Executor não lê o virtual store do pnpm; verificador sem testes nativos do projeto (A1/N2) | **W5-02b2** (FR15)                               | regex de caminho com `@`, symlinks e hardlinks do store, limites de 64 caminhos/1 MiB e 65536 caracteres; vitest/`tsc` como `command_checks`                     |
| Sinais `init`/`rate_limit`/`pids_peak` fora do recibo                                      | `pids_peak`: W5-02b1; `init`/`rate_limit`: W5-10 | recibo/evidência passa a expô-los ou declará-los desconhecidos                                                                                                   |
| `loop-guard.sh` grava em `node_modules` quando instalado                                   | **fora da W5**                                   | script de hook; correção de manutenção, sem relação com ambiente/contexto                                                                                        |
| `pids_max=64` insuficiente para clientes reais                                             | W5-02b1                                          | `pids_max` por chamada (32-256) com recibo de pico                                                                                                               |
| Adapters API/ACP/local sem retenção de evidência de saída                                  | fora da W5                                       | tema de campanhas (W8); A9 cobre o caminho nativo e `claude/account`                                                                                             |
| Digest de conta `claude/account` sem sal; hook de commit bloqueia nomes de fornecedor      | fora da W5                                       | manutenção/privacidade; registrar como pendência de adapter                                                                                                      |
| Status das 27 famílias em `requirements.json` sem mapeamento                               | W5-12 (apenas F14, F15, F20)                     | só com evidência citável W5                                                                                                                                      |

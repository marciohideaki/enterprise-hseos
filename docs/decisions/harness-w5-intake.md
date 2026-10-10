# Intake v2 — W5: extend

Tipo: intake pré-implementação, 2026-10-10. Owner: owner.platform-architecture /
HSEOS engenharia. Escopo: capacidades de ambiente (LSP, debug, navegador, computer-use),
contexto com autoridade e multimodal, memória governada, compactação combinada e MCP
subordinado. Resultado: extend. Constituição §2.6; capability-graph; ADR-0043/0044/0045
Proposed e ADR-0047 Proposed. Base `e079409c` (master após a PR #214).

## Descoberta exata e semântica

Grafo: `.enterprise/governance/capabilities/registry.yaml` e fragmento
`.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml` na base
`e079409c`. Capacidades existentes relacionadas: `capability.hseos.project-engineering`
e `capability.hseos.execution-control` (ambas `proposed`). Não há nó nem módulo de LSP,
DAP, navegador, computer-use, multimodal ou memória governada: busca textual em `packages`, `tools`
e `src` por `language server`, `lsp`, `dap`, `debugpy`, `playwright`, `xvfb`, `multimodal` (arquivos js, py, json) não encontrou
implementação (a única ocorrência de imagem é a capacidade declarada `image_input` em
`packages/agent-runtime-contracts/provider-contracts.js:23` e
`tools/lib/agent-provider-binding.js:42`, sem consumidor de contexto). Esse escopo de
busca não prova ausência global. Descoberta semântica por axon é integração opcional e
não foi requisito de aceite; o índice `.axon` do checkout é consultável, mas nenhum
resultado dele sustenta uma alegação deste documento sem fonte de arquivo.

## Candidatos, assinaturas e decisão

| Candidato / path                                                                                                                                              | Assinatura atual                                                                                                                                                                         | Decisão                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/agent-context/schemas.js`                                                                                                                           | `ContextSourceSchema`, `MemorySourceSchema` (`:40-50`), `ContextAssemblyInputSchema`                                                                                                     | Estender (campos aditivos `authority`, `provenance`, lista `media`); leitura v1 preservada                                                             |
| `packages/agent-context/context-assembler.js`                                                                                                                 | `ContextAssembler.assembleAndRecord(input)` (`:356`), `quotedData` (`:40`), `#budget`                                                                                                    | Estender: validação de autoridade, mídia no orçamento, proveniência no `context.assembled`                                                             |
| `packages/agent-context/token-counter.js`                                                                                                                     | `ConservativeUtf8TokenCounter.count`, `validateTokenCounter`                                                                                                                             | Estender com `count_media` opcional; contador sem o método rejeita mídia                                                                               |
| `packages/agent-runtime-contracts/{agent-contracts,provider-contracts}.js`                                                                                    | `AgentMessageSchema` (`content: string`), `image_input`                                                                                                                                  | Estender: partes de conteúdo na requisição v2; mensagem v1 intacta                                                                                     |
| `packages/agent-policy-lattice/index.js`                                                                                                                      | `evaluatePermissionLattice`, `resolveConfiguration`, `deriveChildAuthority` (`:189`)                                                                                                     | Reutilizar sem alterar: decisão por estágio, `ask` para computer-use, não ampliação na delegação                                                       |
| `packages/agent-compaction/runtime.js`, `packages/agent-session-store/{session-event-store,replay}.js`                                                        | `CompactionRuntime`, `forkSession` (`:438`), `replaySessionEvents`, `reconstructModelRequest`, `buildRecoveryPlan`                                                                       | Reutilizar; W5-03 só acrescenta o cenário combinado (e campo aditivo se necessário)                                                                    |
| `packages/agent-isolation-attestation/{index,executor,terminal-executor}.js`                                                                                  | `prepareIsolatedExecution`, `sandboxArguments` (`:321`), `seccompNetworklessProgram` (`:98`), `executeIsolatedCommand` (`:157`), `createResourceGroup` (`:103`), `startIsolatedTerminal` | Estender: perfis P0/P1/P2, limites por chamada, canal de artefatos. P0 inalterado                                                                      |
| `tools/lib/execution-plugin-manifest.js`, `tools/cli/lib/execution-plugin-runtime.js`, `execution-plugin-adapters.js`                                         | `admitExecutionPlugin`, `executeExecutionPlugin`, `createExecutionPluginTool`                                                                                                            | Reutilizar para navegador e computer-use (kind `tool`); ampliar limites dentro do máximo do manifesto                                                  |
| `packages/tool-runtime`                                                                                                                                       | `ToolRuntime`, registro selado                                                                                                                                                           | Reutilizar: toda ação de ambiente entra por contrato versionado                                                                                        |
| `tools/lib/governed-execution/contract-registry.js`                                                                                                           | `ExecutionContractRegistry`                                                                                                                                                              | Estender com contratos `environment.*` e `memory.*`; resolver `$ref` no registro                                                                       |
| `tools/mcp-hseos-governance/index.js`, `tools/lib/{legacy-mcp-server,mcp-transport,mcp-2026-adapter}.js`, `tools/lib/governed-execution/native-mcp-server.js` | `startNativeMcpServer`, `startLegacyMcpServer`                                                                                                                                           | Estender: falha fechada, legado só em fixture, negações no ledger                                                                                      |
| `tools/mcp-hseos-swarm`                                                                                                                                       | servidor MCP do swarm                                                                                                                                                                    | Estender: validação de `cwd`, `nlink`, `O_NOFOLLOW` (pendências da revalidação)                                                                        |
| `tools/mcp-project-state/lib/execution-event-ledger.js`                                                                                                       | `ExecutionEventLedger.append/appendBatch/readStream/readGlobal`                                                                                                                          | Reutilizar como armazenamento canônico da memória (`aggregate_type = agent_memory`); sem store paralelo                                                |
| `tools/cli/lib/campaign-evidence-store.js`                                                                                                                    | `storeEvidence`, `readEvidence`, `containsCredential`, `evidenceSha256`                                                                                                                  | Reutilizar o padrão (endereço por conteúdo, sem links, teto); estender a binários para o repositório de artefatos                                      |
| `tools/cli/lib/provider-egress-broker.js`                                                                                                                     | `startProviderEgressBroker`, `createUnixSocketFetch`; rota única `POST /provider/chat/completions` (`:124`)                                                                              | Reutilizar só o padrão (socket Unix, tetos); **novo** broker de egresso para navegador com allowlist por host, porque o existente não é proxy genérico |
| `tools/cli/lib/engineering-project-verifier.js`                                                                                                               | `PROJECT_VERIFIERS`, `attestEngineeringVerifier`, `verifyEngineeringTask`                                                                                                                | Reutilizar para o aceite do consumidor real (verificador fixado fora do controle da tarefa)                                                            |
| `tools/cli/lib/engineering-control-http.js`, `engineering-control.js`, `packages/control-sdk`                                                                 | API `/v1/*`, `ControlClient` JS/TS/Python                                                                                                                                                | Estender (campos aditivos de autoridade/proveniência na evidência e nos eventos); sem nova autoridade                                                  |
| `tools/mcp-axon-bridge`                                                                                                                                       | `memory_search`                                                                                                                                                                          | Reutilizar como fonte opcional somente leitura                                                                                                         |
| `scripts/governance/check-w4-mutations.js`, `test/test-w4-*`                                                                                                  | harness de mutantes W4                                                                                                                                                                   | Estender o molde para mutantes W5                                                                                                                      |

Capacidade nova sem equivalente reutilizável: cliente LSP/DAP por stdio (framing `Content-Length`),
validadores de escopo de resultados, repositório de artefatos binários, controle de display
virtual e aprovação por ação, memória sobre ledger. Cada uma tem o contrato correspondente em
`.specs/features/harness-w5/design.md`; nenhuma duplica scheduler, política, ledger, broker de
provider ou saldo monetário.

## Consumidores, riscos e controles

Consumidores candidatos: CLI, API loopback, SDKs JS/TS/Python, o assembler de contexto, o
ToolRuntime e os projetos de engenharia dos consumidores reais (escolha no G2; candidatos em
`docs/evolution/w5/PLAN.md`).

Riscos: injeção por dado recuperado (memória, DOM, texto de tela, resultado de ferramenta),
ampliação de autoridade por transformação, mídia adulterada, escape de escopo por LSP/DAP,
descendentes sobreviventes de depurador/navegador, egresso de rede além da allowlist, acesso ao
display real, aprovação reutilizada, envenenamento da memória, retrocompatibilidade de eventos
e crescimento do pacote além dos orçamentos. Controles: `authority` validada na borda,
`quotedData` para dado, digest conferido antes do uso, perfis de isolamento escolhidos pelo
controlador, validadores de escopo no core, drenagem por cgroup, broker com allowlist, aprovação
de uso único vinculada à ação, memória com política de escrita e TTL, eventos versionados e
leitura v1, orçamentos por área e teto de pacote de plugin.

Produtor global: governance-discovery e Constituição lidos; resolução de produtor não certifica
aplicação. AEW inspecionado separadamente na W4 (stack resolve sem base configurada); aplicação
e enforcement **não verificados** nesta unidade. Preflight de vault não foi executado por esta
task.

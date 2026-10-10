# Tasks W5

Tipo: contratos de execução isolada. Estado inicial: W5-01 em redação; demais pendentes.
Uma task = um commit; uma onda = uma PR para `feature/hseos-evolution-w5`. Todos os paths são relativos à worktree.
Executor Sonnet em worktree `.worktrees/hseos-w5-<task>` e branch `task/hseos-w5-<task>`; revisor cético isolado (duas passagens, reporta e não corrige).
Comandos de verificação usam `heavy-run` (serializa por `flock`); suítes e builds são sequenciais; `uptime` antes de cada execução pesada; no máximo 2 agentes compilando.
Verificações com executor requerem cgroup v2 delegado (`systemd-run --user --scope -p Delegate=yes`). Node 22 e 24.
Capacidade sem insumo (binário, cache offline, ferramenta de entrada) termina em BLOCKED com a causa. Nunca PASS, nunca threshold afrouxado.
Alteração de escopo exige atualizar este contrato antes do código. Subtasks podem ser criadas desde que preservem os contratos de entrada e saída.
Nenhuma task altera `test/test-package-surface.js` sem decisão G3.

## Mapa de ondas

| Onda | Tasks                           | Paralelismo                                                   | Tier de modelo                                             |
| ---- | ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| B0   | W5-01                           | 1                                                             | Sonnet redige; Commander (Opus) fecha decisões antes do G2 |
| B1   | W5-02a ∥ W5-02b ∥ W5-04         | 3 agentes, builds serializadas (o plano previa 2; ver nota)   | Sonnet; revisão de W5-02a e W5-02b com opt-in estratégico  |
| B2   | W5-03 ∥ W5-05 ∥ W5-06           | 3 agentes, builds serializadas; W5-06 após o framing de W5-05 | Sonnet                                                     |
| B3   | W5-07 ∥ W5-08 ∥ W5-09           | 3 agentes, builds serializadas, um navegador/display por vez  | Sonnet                                                     |
| B4   | W5-10 → W5-11a → W5-11b → W5-12 | sequencial                                                    | Sonnet                                                     |

Nota B1: a W5-02b (perfis de isolamento) foi separada da W5-02 porque B2/B3 dependem dela e ela altera `packages/agent-isolation-attestation`, fora do escopo de W5-02a e W5-04. Os arquivos não colidem. Se o Commander preferir manter 2 agentes, W5-02b roda depois de W5-04.

## W5-01 — Consolidar contratos, intake, ADR e grafo

- wave: B0
- execution_mode: isolated
- scope: Medium
- dependencies: W4 e revalidação integradas em e079409c
- input_contract.files:
  - `docs/evolution/PLAN.md`
  - `docs/evolution/requirements.json`
  - `docs/evolution/revalidation-2026-10/STATUS.md`
  - `/home/annonymous/.claude/plans/toasty-exploring-liskov.md (Fase B)`
- output_contract.files:
  - `.specs/features/harness-w5/*.md`
  - `docs/decisions/harness-w5-intake.md`
  - `.enterprise/.specs/decisions/ADR-0047-environment-capabilities-and-context-authority.md`
  - `.enterprise/.specs/decisions/_INDEX.md`
  - `docs/evolution/w5/{PLAN,STATUS,README}.md`
  - `.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml`
  - `.agents/capabilities/fragments/enterprise-hseos.yaml`
- acceptance_criteria: FR01-FR13 rastreáveis; contratos com entradas, saídas, falhas e versões; cada escolha com Recomendação/Alternativas/Porquê; decisões G2 explícitas; nós `proposed` válidos; nenhum código de produção.
- verify_step.command: `git diff --check; node scripts/governance/validate-capability-graph.js; flock /tmp/hseos-reval/focused.lock nice -n 19 node --test --test-concurrency=1 test/test-kernel-quality-surface.js test/test-documentation-neutrality.js; npm pack --dry-run --json`
- verify_step.expected: exit 0, validador sem findings, 2 suítes sem falhas, contagem de entradas = base + 1 (ADR).
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia a task.

## W5-02a — Contexto com autoridade e partes multimodais

- wave: B1
- execution_mode: isolated
- scope: Large (schema crítico; opt-in estratégico de revisão em Opus registrado no plano)
- dependencies: W5-01 e gate G2
- input_contract.files:
  - `packages/agent-context/schemas.js`
  - `packages/agent-context/context-assembler.js`
  - `packages/agent-context/token-counter.js`
  - `packages/agent-runtime-contracts/agent-contracts.js`
  - `packages/agent-runtime-contracts/provider-contracts.js`
  - `packages/agent-policy-lattice/index.js`
  - `tools/cli/lib/campaign-evidence-store.js`
  - `.specs/features/harness-w5/design.md (seções 3 e 6)`
- output_contract.files:
  - `packages/agent-context/schemas.js`
  - `packages/agent-context/context-assembler.js`
  - `packages/agent-context/token-counter.js`
  - `packages/agent-context/authority.js`
  - `packages/agent-context/media-store.js`
  - `packages/agent-runtime-contracts/content-parts.js`
  - `packages/agent-runtime-contracts/index.js`
  - `test/test-agent-context-authority.js`
  - `test/test-agent-context-media.js`
  - `test/test-agent-context.js`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-02a/*`
- acceptance_criteria: authority e provenance validados na borda; derivação v1 preservada; dado externo não altera decisão da lattice nem lista de ferramentas (teste central); digest/bytes/magic conferidos; provider sem image_input rejeitado antes de append; contador sem count_media rejeita mídia; context.assembled v2 aditivo; replay v1 intacto.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-agent-context.js test/test-agent-context-authority.js test/test-agent-context-media.js test/test-agent-policy-lattice.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: rodar mcp**axon**get_impact_graph em packages/agent-context e agent-runtime-contracts antes de editar (risco: mudança de schema com impacto amplo); manter leitura v1.

## W5-02b — Perfis de isolamento, limites por chamada e canal de artefatos

- wave: B1
- execution_mode: isolated
- scope: Large (arquivo de kernel compartilhado e seccomp; decisão de segurança no G2)
- dependencies: W5-01 e gate G2
- input_contract.files:
  - `packages/agent-isolation-attestation/index.js`
  - `packages/agent-isolation-attestation/executor.js`
  - `packages/agent-isolation-attestation/terminal-executor.js`
  - `tools/lib/execution-plugin-manifest.js`
  - `tools/cli/lib/execution-plugin-runtime.js`
  - `tools/cli/lib/provider-egress-broker.js`
  - `.specs/features/harness-w5/design.md (seção 4)`
- output_contract.files:
  - `packages/agent-isolation-attestation/profiles.js`
  - `packages/agent-isolation-attestation/artifact-channel.js`
  - `packages/agent-isolation-attestation/index.js`
  - `packages/agent-isolation-attestation/executor.js`
  - `packages/agent-isolation-attestation/terminal-executor.js`
  - `tools/lib/execution-plugin-manifest.js`
  - `tools/cli/lib/execution-plugin-runtime.js`
  - `test/test-isolation-profiles.js`
  - `test/test-artifact-channel.js`
  - `test/test-execution-plugin-runtime.js`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-02b/*`
- acceptance_criteria: P0 inalterado (testes existentes seguem verdes); P1/P2 só por referência do controlador; seccomp P1 bloqueia AF_NETLINK/AF_PACKET/io_uring; rede externa inalcançável; pids_max/memória por chamada dentro de 32-256 e 2 GiB, com pico no recibo; /artifacts verificado (digest, tamanho, magic, sem links, sem path fora); ensaio de viabilidade de Chromium e Xvfb no sandbox registrado como PASS ou BLOCKED; cgroup drain comprovado.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-isolation-profiles.js test/test-artifact-channel.js test/test-execution-plugin-runtime.js test/test-agent-transitive-isolation.js test/test-isolation-witness-faults.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: exige cgroup v2 delegado (systemd-run --user --scope -p Delegate=yes). Absorve pids_max e pids_peak da revalidação.

## W5-04 — MCP subordinado ao gateway (F20-R1)

- wave: B1
- execution_mode: isolated
- scope: Medium
- dependencies: W5-01 e gate G2
- input_contract.files:
  - `tools/mcp-hseos-governance/index.js`
  - `tools/lib/legacy-mcp-server.js`
  - `tools/lib/mcp-transport.js`
  - `tools/lib/governed-execution/contract-registry.js`
  - `tools/lib/governed-execution/native-mcp-server.js`
  - `tools/lib/governed-execution/event-registry.js`
  - `tools/mcp-hseos-swarm/*`
  - `tools/lib/mcp-2026-adapter.js`
  - `docs/evolution/revalidation-2026-10/STATUS.md (pendências)`
- output_contract.files:
  - `tools/lib/mcp-2026-adapter.js`
  - `tools/mcp-hseos-governance/index.js`
  - `tools/lib/governed-execution/contract-registry.js`
  - `tools/lib/governed-execution/native-mcp-server.js`
  - `tools/lib/governed-execution/event-registry.js`
  - `tools/lib/legacy-mcp-server.js`
  - `tools/lib/mcp-transport.js`
  - `tools/mcp-hseos-swarm/*`
  - `test/test-mcp-hseos-governance.js`
  - `test/test-mcp-contract.js`
  - `test/test-mcp-2026-adapter.js`
  - `test/test-mcp-transport-robustness.js`
  - `test/test-mcp-hseos-swarm-scope.js`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-04/*`
- acceptance*criteria: servidor/tool malformado falha o boot com código; tool desconhecida e acesso fora do escopo negados e registrados no ledger; legado só em fixture; corpo HTTP legado limitado; $ref resolvido no registro; -32600 alinhado; swarm valida cwd, nlink e O_NOFOLLOW; limit/stale_minutes string documentados como mudança; contratos de tools environment.* e memory.\_ registrados como versionados (stubs de contrato, sem implementação).
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-mcp-hseos-governance.js test/test-mcp-contract.js test/test-mcp-2026-adapter.js test/test-mcp-transport-robustness.js test/test-mcp-hseos-swarm-scope.js test/test-mcp-stdio.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-03 — Compactação combinada (F15-R1)

- wave: B2
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a
- input_contract.files:
  - `packages/agent-compaction/runtime.js`
  - `packages/agent-session-store/session-event-store.js`
  - `packages/agent-session-store/replay.js`
  - `packages/agent-context/context-assembler.js`
  - `test/test-agent-compaction.js`
  - `test/test-agent-session-store.js`
- output_contract.files:
  - `test/test-compaction-resume-fork.js`
  - `packages/agent-compaction/runtime.js (somente se o cenário expuser defeito)`
  - `packages/agent-context/schemas.js (somente retention aditivo, se necessário)`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-03/*`
- acceptance_criteria: cenário compactação, crash entre compaction.completed e context.assembled, resume e fork comparado ao histórico integral: mesmos source_refs obrigatórios, autoridade por fonte, critérios fixados e lineage; critério existente só em histórico documentado como compactável; sem reescrita de eventos.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-compaction-resume-fork.js test/test-agent-compaction.js test/test-agent-session-store.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-05 — LSP TypeScript e Python restrito ao workspace

- wave: B2
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a, W5-02b
- input_contract.files:
  - `packages/agent-environment/*`
  - `packages/agent-isolation-attestation/profiles.js`
  - `packages/agent-isolation-attestation/artifact-channel.js`
  - `tools/lib/governed-execution/contract-registry.js`
  - `packages/tool-runtime/registry.js`
  - `.specs/features/harness-w5/design.md (seção 5.1)`
- output_contract.files:
  - `packages/agent-environment/package.json`
  - `packages/agent-environment/README.md`
  - `packages/agent-environment/index.js`
  - `packages/agent-environment/framing.js`
  - `packages/agent-environment/lsp.js`
  - `packages/agent-environment/lsp-host.js`
  - `tools/lib/environment-toolchain-pins.js`
  - `test/test-environment-lsp.js`
  - `test/fixtures/lsp/*`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-05/*`
- acceptance_criteria: diagnostics, definition, references, hover e rename_preview em TS e Python; localização fora da raiz (.., symlink) recusada e registrada; nenhuma escrita em disco (workspace ro, hash antes/depois igual); servidor ausente = BLOCKED; resultado vira fonte data/untrusted com digest.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-environment-lsp.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: pins de servidor (typescript-language-server, pyright) são dados; binários não entram no pacote.

## W5-06 — Debug (DAP) Node e Python roteirizado

- wave: B2
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a, W5-02b, W5-05 (compartilha framing)
- input_contract.files:
  - `packages/agent-environment/framing.js`
  - `packages/agent-isolation-attestation/profiles.js`
  - `packages/agent-isolation-attestation/executor.js`
  - `.specs/features/harness-w5/design.md (seção 5.2)`
- output_contract.files:
  - `packages/agent-environment/dap.js`
  - `packages/agent-environment/dap-host.js`
  - `tools/lib/environment-toolchain-pins.js`
  - `test/test-environment-dap.js`
  - `test/fixtures/dap/*`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-06/*`
- acceptance_criteria: breakpoints, stack, variables, step e encerramento em Node e Python; evaluate/setVariable recusados por contrato; breakpoint fora de /workspace recusado; timeout encerra e drena (zero descendentes sobreviventes, prova por cgroup e /proc); adaptador ausente = BLOCKED.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-environment-dap.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-07 — Navegador como plugin separado com egresso mediado

- wave: B3
- execution_mode: isolated
- scope: Large
- dependencies: W5-02a, W5-02b
- input_contract.files:
  - `tools/lib/execution-plugin-manifest.js`
  - `tools/cli/lib/execution-plugin-runtime.js`
  - `tools/cli/lib/provider-egress-broker.js`
  - `packages/agent-environment/*`
  - `packages/agent-context/media-store.js`
  - `.specs/features/harness-w5/design.md (seção 5.3)`
- output_contract.files:
  - `plugins/browser/*`
  - `packages/agent-environment/browser-contract.js`
  - `tools/cli/lib/environment-egress-broker.js`
  - `test/test-environment-browser.js`
  - `test/test-browser-plugin-surface.js`
  - `test/fixtures/browser/*`
  - `.enterprise/governance/plugins/browser/*`
  - `.agents/plugins/browser/*`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-07/*`
- acceptance_criteria: plugin admitido por hash pinado; navegador executa em P2; host fora da allowlist bloqueado e registrado; screenshot e DOM viram partes data/untrusted com URL, hora, digest e transform; cookies e segredos não persistem; zero descendentes; sem download em runtime; pacote do plugin dentro do teto próprio; core inalterado em dependências.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-environment-browser.js test/test-browser-plugin-surface.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: cache de Chromium e playwright-core ausentes = BLOCKED. Sobe no máximo uma instância de navegador por vez.

## W5-08 — Computer-use em Xvfb isolado com aprovação por ação

- wave: B3
- execution_mode: isolated
- scope: Large
- dependencies: W5-02a, W5-02b, W5-07 (padrão de plugin e captura)
- input_contract.files:
  - `packages/agent-isolation-attestation/terminal-executor.js`
  - `packages/agent-policy-lattice/index.js`
  - `packages/agent-environment/*`
  - `.specs/features/harness-w5/design.md (seção 5.4)`
- output_contract.files:
  - `plugins/computer-use/*`
  - `packages/agent-environment/computer-contract.js`
  - `tools/cli/lib/environment-approval.js`
  - `test/test-environment-computer.js`
  - `test/fixtures/computer/*`
  - `.enterprise/governance/plugins/computer-use/*`
  - `.agents/plugins/computer-use/*`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-08/*`
- acceptance_criteria: ação sem aprovação negada; aprovação de uso único vinculada a sessão, sequência, ação e screenshot, expira e não é reutilizável; modo bypass/approve_all não se aplica; DISPLAY do operador inacessível (teste negativo); sessão encerra e drena em stop e expiração; screenshot com proveniência; injetor de entrada indisponível = BLOCKED.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-environment-computer.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: somente Xvfb próprio; nunca a sessão gráfica real. Uma sessão por vez.

## W5-09 — Memória governada

- wave: B3
- execution_mode: isolated
- scope: Large
- dependencies: W5-02a
- input_contract.files:
  - `tools/mcp-project-state/lib/execution-event-ledger.js`
  - `packages/agent-session-store/session-event-store.js`
  - `packages/agent-context/schemas.js`
  - `tools/mcp-axon-bridge/*`
  - `packages/agent-policy-lattice/index.js`
  - `.specs/features/harness-w5/design.md (seção 5.5)`
- output_contract.files:
  - `packages/agent-memory/package.json`
  - `packages/agent-memory/README.md`
  - `packages/agent-memory/index.js`
  - `packages/agent-memory/store.js`
  - `packages/agent-memory/policy.js`
  - `tools/cli/lib/memory-context-source.js`
  - `test/test-agent-memory.js`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-09/*`
- acceptance_criteria: escrita exige política admissora e passa por varredura de credenciais; authority fixa em data; TTL obrigatório e expiração verificável; origem untrusted fora da recuperação padrão; recuperação determinística alimenta memory[] com proveniência; escopo por projeto; ponte axon opcional e read-only (ausente = no-op); projeção reconstruível dos eventos.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-agent-memory.js test/test-mcp-axon-bridge.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-10 — Superfícies: autoridade e proveniência em evidência, eventos, CLI e SDKs

- wave: B4
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a..W5-09
- input_contract.files:
  - `tools/cli/lib/engineering-control-http.js`
  - `tools/cli/lib/engineering-control.js`
  - `packages/control-sdk/index.js`
  - `packages/control-sdk/index.d.ts`
  - `packages/control-sdk/hseos_control.py`
  - `docs/engineering-control-api.md`
- output_contract.files:
  - `tools/cli/lib/engineering-control-http.js`
  - `tools/cli/lib/engineering-control.js`
  - `packages/control-sdk/index.js`
  - `packages/control-sdk/index.d.ts`
  - `packages/control-sdk/hseos_control.py`
  - `docs/engineering-control-api.md`
  - `test/test-environment-surfaces.js`
  - `test/journeys/*`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-10/*`
- acceptance_criteria: /v1/tasks/{id}/evidence e eventos expõem authority, origin, digest e trust; CLI e SDK JS/TS/Python equivalentes; clientes v1 continuam lendo; nenhum código executável trafega por HTTP; init/rate_limit/pids_peak expostos ou declarados desconhecidos.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-environment-surfaces.js test/test-engineering-control.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-11a — Ensaios determinísticos e mutantes W5

- wave: B4
- execution_mode: isolated
- scope: Large
- dependencies: W5-10
- input_contract.files:
  - `test/*`
  - `scripts/governance/check-w4-mutations.js (molde)`
  - `docs/evolution/w4/evidence/final/traceability.md (molde)`
- output_contract.files:
  - `test/test-w5-negative-matrix.js`
  - `scripts/governance/check-w5-mutations.js`
  - `test/test-w5-mutations.js`
  - `package.json`
  - `docs/evolution/w5/evidence/negative/*`
- acceptance_criteria: matriz negativa: import com efeito, LSP fora do workspace, DAP com filho sobrevivente, navegador com egresso negado, computer-use sem aprovação, mídia adulterada, memória elevando autoridade, MCP malformado/desconhecido/fora do escopo; mutantes de ampliação de autoridade, perda de proveniência e bypass de aprovação todos rejeitados.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-w5-negative-matrix.js; heavy-run --mem 4G -- node scripts/governance/check-w5-mutations.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura 90/80 nos arquivos novos; recibo ligado à revisão.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-11b — Consumidor real instalado fora do checkout

- wave: B4
- execution_mode: isolated
- scope: Large
- dependencies: W5-11a e decisão G2 sobre o consumidor
- input_contract.files:
  - `tools/examples/project-task.js`
  - `test/journeys/*`
  - `docs/evolution/w4/CONSUMERS.md (molde)`
  - `docs/evolution/revalidation-2026-10/INVENTORY-CAPACITY.md`
- output_contract.files:
  - `test/journeys/w5-environment-journey.mjs`
  - `docs/evolution/w5/CONSUMERS.md`
  - `docs/evolution/w5/evidence/real/*`
- acceptance_criteria: tarballs do core e dos plugins instalados offline em diretório novo e vazio; projeto TS do consumidor aprovado com teste falhando percorre LSP, DAP, correção governada, verificação no navegador com screenshot e aceite por verificador externo fixado antes do despacho; modelo local ou sem custo, ou BLOCKED com causa; computer-use exercitado em fixture própria; zero órfãos.
- verify_step.command: `node test/journeys/w5-environment-journey.mjs --prefix <install> --consumer <clone-descartavel>`
- verify_step.expected: veredito PASS por passo com recibo; BLOCKED declarado onde faltar insumo.
- verify_step.on_failure: não repetir variações da mesma abordagem mais de 3 vezes; BLOCKED não vira PASS; modelo pago só com G4.

## W5-12 — Fechamento: rastreabilidade, matriz integral e PR

- wave: B4
- execution_mode: isolated
- scope: Large
- dependencies: W5-11b
- input_contract.files:
  - `docs/evolution/w5/*`
  - `docs/evolution/requirements.json`
  - `docs/evolution/STATUS.md`
  - `docs/v4-migration.md`
- output_contract.files:
  - `docs/evolution/w5/evidence/final/traceability.md`
  - `docs/evolution/w5/evidence/final/verification-receipt.json`
  - `docs/evolution/w5/{STATUS,README}.md`
  - `docs/evolution/STATUS.md`
  - `docs/evolution/requirements.json (F14, F15, F20)`
  - `docs/v4-migration.md`
  - `.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml`
  - `.agents/capabilities/fragments/enterprise-hseos.yaml`
  - `test/test-package-surface.js (somente com G3 aprovado)`
- acceptance_criteria: FR -> task -> teste -> recibo; npm test, test:kernel-coverage (90/80 por arquivo incluindo W5), test:w5-mutations em Node 22 e 24 sequencial; quality-gates --phase ci; pacote dentro do teto e dos orçamentos por área aprovados; recibo final com SHA-256; grafo `proposed` válido; PR para feature/hseos-evolution-w5 e depois para a master (G6).
- verify_step.command: `heavy-run -- systemd-run --user --wait --collect --pipe -p Delegate=yes -p DelegateSubgroup=tests npm test (Node 22 e depois 24); npm run test:kernel-coverage; VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh --phase ci; node scripts/governance/validate-capability-graph.js`
- verify_step.expected: zero falhas/skips; 90/80 por arquivo crítico; mutantes todos rejeitados; tentativas falhas registradas, nunca contadas.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

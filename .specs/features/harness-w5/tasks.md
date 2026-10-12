# Tasks W5

Tipo: contratos de execução isolada. Gate G2 aprovado em 2026-10-11; W5-01 concluída; demais pendentes, próximo passo B1.
Uma task = um commit; uma onda = uma PR para `feature/hseos-evolution-w5`. Todos os paths são relativos à worktree.
Executor Sonnet em worktree `.worktrees/hseos-w5-<task>` e branch `task/hseos-w5-<task>`; revisor cético isolado (duas passagens, reporta e não corrige).
Comandos de verificação usam `heavy-run` (serializa por `flock`); suítes e builds são sequenciais; `uptime` antes de cada execução pesada; no máximo 2 agentes compilando.
Verificações com executor requerem cgroup v2 delegado (`systemd-run --user --scope -p Delegate=yes`). Node 22 e 24.
Capacidade sem insumo (binário, cache offline, ferramenta de entrada) termina em BLOCKED com a causa. Nunca PASS, nunca threshold afrouxado.
Alteração de escopo exige atualizar este contrato antes do código. Subtasks podem ser criadas desde que preservem os contratos de entrada e saída.
Nenhuma task altera `test/test-package-surface.js` sem decisão G3. Orçamento aprovado no G2: área `packages` 137; teto do core **1554** (opção "elevar o teto" aprovada no G3 de 2026-10-11: `packages` 137 e teto na mesma medida); acima de 1554 (projeção alta do híbrido ≈1565) só pelo número medido no fechamento da onda, com novo G3; plugins ≤40 entradas e ≤1 MB cada. A soma dos orçamentos por área não pode exceder o teto (assertiva do teste de superfície), por isso `packages` 137 e teto 1554 entram juntos. A alteração de `test/test-package-surface.js` (`packages` 137, teto 1554) é feita pela **W5-02a**, primeira task que adiciona entradas em `packages`; as demais não a editam. A W5-02a integra primeiro na B1; adições anteriores a ela em `packages` (a W5-02b1 cria 2 arquivos) cabem no orçamento vigente de 123, então a premissa "primeira task" não depende de ordem de execução. **Risco (`packages` sem folga):** os arquivos novos contratados em `packages/` somam 24 (`agent-environment` 14: `package.json`, `README.md`, `index`, `framing`, `lsp`, `lsp-host`, `dap`, `dap-host`, `browser-contract`, `browser`, `browser-host`, `computer-contract`, `computer`, `computer-host`; `agent-memory` 5; `agent-context` 2: `authority`, `media-store`; `agent-runtime-contracts` 1: `content-parts`; `agent-isolation-attestation` 2: `profiles`, `artifact-channel`). Medido 113 + 24 = 137, folga zero; arquivo extra (por exemplo `lsp-contract.js` e `dap-contract.js`) conta contra esse limite. **Risco análogo em `.agents`:** os 5 plugins (lsp, dap, browser, computer-use, memory) exigem pelo menos 2 entradas por definição em `.enterprise/governance/plugins/definitions/` e o espelho gerado em `.agents/` (cerca de 10 entradas ou mais), contra folga medida de 7 (186 de 193) e W5 projetado em +6/+8. O primeiro estouro é provável a partir da W5-05, que cria o primeiro plugin, e se agrava a cada plugin seguinte. Para os dois orçamentos (`packages` 137 e `.agents` 193) vale a mesma regra: nenhum orçamento é aumentado sem gate; se a medição estourar, a onda para em G3 com o número medido.
Distribuição híbrida (G2): contratos e runtime de todas as capacidades no core, dependências pesadas carregadas sob demanda a partir de pins; cada capacidade também sai empacotada em `plugins/*` a partir da mesma implementação (sem código duplicado, teste de paridade de digest). Binários e `playwright-core` são pins em cache offline fora dos tarballs.
Critério transversal de toda task de capacidade (W5-02b1 ensaio, W5-05 a W5-08; a W5-09 não tem pin): a licença de cada pin é conferida no artefato fixado (texto da licença contra o esperado); divergência ou ausência = BLOCKED. Sem download em tempo de execução; sem cache = BLOCKED.

## Mapa de ondas

| Onda | Tasks                                    | Paralelismo                                                                                                 | Tier de modelo                                             |
| ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| B0   | W5-01                                    | 1                                                                                                           | Sonnet redige; Commander (Opus) fecha decisões antes do G2 |
| B1   | W5-02a ∥ (W5-02b1 → W5-02b2) ∥ W5-04     | 3 agentes simultâneos (02b1 e 02b2 em sequência no mesmo slot), builds serializadas                         | Sonnet; revisão de W5-02a e W5-02b1 com opt-in estratégico |
| B2   | W5-03 ∥ (W5-05 → W5-06)                  | 2 slots; W5-05 e W5-06 no mesmo slot, em sequência (compartilham framing e `environment-toolchain-pins.js`) | Sonnet                                                     |
| B3   | (W5-07 → W5-08) ∥ W5-09                  | 2 slots; W5-08 depende de W5-07 (padrão de plugin e captura); um navegador/display por vez                  | Sonnet                                                     |
| B4   | W5-10 → W5-10b → W5-11a → W5-11b → W5-12 | sequencial                                                                                                  | Sonnet; W5-10b com revisão cética isolada                  |

Nota B1: B1 roda com 3 agentes (aprovado pelo owner no G2). A W5-02b (perfis de isolamento) foi separada da W5-02 porque B2/B3 dependem dela e ela altera `packages/agent-isolation-attestation`, fora do escopo de W5-02a e W5-04; depois foi dividida pelo Commander em W5-02b1 (perfis, seccomp, artefatos) e W5-02b2 (virtual store do pnpm e verificador), no mesmo slot, em sequência. Os arquivos de código e de teste de cada task não colidem entre os slots.

**Protocolo de arquivos compartilhados na onda.** `.c8-kernel.json`, `package.json`, `.enterprise/governance/plugins/registry.yaml` e `test/test-package-surface.js` aparecem em mais de uma task. Cada task só acrescenta as suas próprias entradas (sem reordenar nem reformatar o resto), e os conflitos textuais são resolvidos por merge na integração da onda pelo Commander, na ordem das dependências; na B1, a W5-02a integra primeiro (é a dona de `test-package-surface.js`). `package.json` é compartilhado também pela lista `test:kernel`: toda task que cria ou toca teste citado no seu verify acrescenta esse teste à lista, e o merge da onda resolve a ordem. Depois do merge, o `verify_step` de cada task roda de novo sobre o resultado integrado, e o Commander roda **uma vez por onda**, na integração e sequencialmente, o `npm run test:kernel-coverage` completo (por task a cobertura é focada, com c8 e `--include` **explícito**, listando um a um os arquivos que a task cria ou altera, sem glob largo). Todo arquivo do `--include` precisa atingir 90% de linhas e 80% de branches com os testes listados no verify da mesma task; a task acrescenta testes onde faltar. A cobertura dos demais arquivos, que a task não toca, é garantida pela suíte completa na integração da onda. Testes de executor e de controle exigem cgroup v2 delegado (`systemd-run --user --scope -p Delegate=yes`); sem ele falham e a cobertura medida não vale. Task de apenas teste (W5-03) inclui `runtime.js` e `schemas.js` só se os alterar e remove do `--include` o que não alterou, registrando isso no recibo. "No máximo 2 agentes compilando" vale para builds e suítes; a redação em 3 slots simultâneos é permitida porque as builds são serializadas por `heavy-run`.

## W5-01 — Consolidar contratos, intake, ADR e grafo

- wave: B0
- execution_mode: isolated
- scope: Medium
- dependencies: W4 e revalidação integradas em e079409c
- requirements: FR01-FR15; NFR01-NFR09 (contratos)
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
- nota: G2 aprovado em 2026-10-11 e decisões aplicadas (PLAN seção 7); ADR-0047 Accepted; W5-01 concluída.
- acceptance_criteria: FR01-FR15 rastreáveis; contratos com entradas, saídas, falhas e versões; cada escolha com Recomendação/Alternativas/Porquê; decisões G2 explícitas; nós `proposed` válidos; nenhum código de produção.
- verify_step.command: `git diff --check; node scripts/governance/validate-capability-graph.js; flock /tmp/hseos-reval/focused.lock nice -n 19 node --test --test-concurrency=1 test/test-kernel-quality-surface.js test/test-documentation-neutrality.js; npm pack --dry-run --json`
- verify_step.expected: exit 0, validador sem findings, 2 suítes sem falhas, contagem de entradas = base + 1 (ADR).
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia a task.

## W5-02a — Contexto com autoridade e partes multimodais

- wave: B1
- execution_mode: isolated
- scope: Large (schema crítico; opt-in estratégico de revisão em Opus registrado no plano)
- dependencies: W5-01 e gate G2
- requirements: FR01, FR02; NFR01, NFR02, NFR03, NFR06
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
  - `test/test-package-surface.js (somente a alteração aprovada no G3: orçamento de packages 137 e teto 1554)`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-02a/*`
- acceptance_criteria: authority e provenance validados na borda; derivação v1 preservada; dado externo não altera decisão da lattice nem lista de ferramentas (teste central); digest/bytes/magic conferidos; provider sem image_input rejeitado antes de append; contador sem count_media rejeita mídia; context.assembled v2 aditivo; replay v1 intacto. Primeira task que adiciona entradas em `packages`: atualiza `test/test-package-surface.js` com `packages` 137 e teto 1554 (G3 de 2026-10-11) e nada além disso; pacote medido com `npm pack --dry-run --json` registrado no recibo.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-context/schemas.js' --include 'packages/agent-context/context-assembler.js' --include 'packages/agent-context/token-counter.js' --include 'packages/agent-context/authority.js' --include 'packages/agent-context/media-store.js' --include 'packages/agent-runtime-contracts/content-parts.js' --include 'packages/agent-runtime-contracts/index.js' --reports-dir .logs/validation/w5-02a-coverage --temp-directory .logs/validation/w5-02a-coverage/tmp node --test --test-concurrency=1 test/test-agent-context.js test/test-agent-context-authority.js test/test-agent-context-media.js test/test-agent-policy-lattice.js; heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-package-surface.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: rodar mcp**axon**get_impact_graph em packages/agent-context e agent-runtime-contracts antes de editar (risco: mudança de schema com impacto amplo); manter leitura v1.

## W5-02b1 — Perfis de isolamento, limites por chamada e canal de artefatos

- wave: B1
- execution_mode: isolated
- scope: Large (arquivo de kernel compartilhado e seccomp; decisão de segurança aprovada no G2)
- dependencies: W5-01 e gate G2
- requirements: FR10, FR13; NFR02, NFR05, NFR06
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
  - `docs/evolution/w5/evidence/w5-02b1/*`
- acceptance_criteria: P0 inalterado (testes existentes seguem verdes); P1/P2 só por referência do controlador; seccomp por argumento (G2): permite AF_UNIX e AF_INET\*, bloqueia AF_NETLINK, AF_PACKET, AF_VSOCK e io_uring, com teste negativo por família; Chromium com `--no-sandbox` apenas dentro do `bwrap`; rede externa inalcançável; pids_max/memória por chamada dentro de 32-256 e 2 GiB, com pico no recibo; /artifacts verificado (digest, tamanho, magic, sem links, sem path fora); ensaio de viabilidade de Chromium e Xvfb no sandbox registrado como PASS ou BLOCKED, com a licença conferida no artefato fixado do Chromium; cgroup drain comprovado.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-isolation-attestation/profiles.js' --include 'packages/agent-isolation-attestation/artifact-channel.js' --include 'packages/agent-isolation-attestation/index.js' --include 'packages/agent-isolation-attestation/executor.js' --include 'packages/agent-isolation-attestation/terminal-executor.js' --include 'tools/lib/execution-plugin-manifest.js' --include 'tools/cli/lib/execution-plugin-runtime.js' --reports-dir .logs/validation/w5-02b1-coverage --temp-directory .logs/validation/w5-02b1-coverage/tmp node --test --test-concurrency=1 test/test-isolation-profiles.js test/test-artifact-channel.js test/test-execution-plugin-runtime.js test/test-agent-transitive-isolation.js test/test-isolation-witness-faults.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão; `test-execution-plugin-runtime` (existente, fora de `test:kernel` hoje) entra na lista `test:kernel` junto com os testes novos em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: exige cgroup v2 delegado (systemd-run --user --scope -p Delegate=yes). Absorve pids_max e pids_peak da revalidação. Divisão decidida pelo Commander: a antiga W5-02b foi dividida em W5-02b1 (esta) e W5-02b2; ocupam o mesmo slot de agente da B1, em sequência, e a B1 continua com 3 agentes simultâneos. Esta task não edita `test/test-package-surface.js`.

## W5-02b2 — Virtual store do pnpm e verificador com testes nativos do projeto

- wave: B1
- execution_mode: isolated
- scope: Medium (contrato e verificador de engenharia; pendências A1/N2 da validação em consumidor)
- dependencies: W5-02b1 (mesmo slot de agente, em sequência), W5-01 e gate G2
- requirements: FR15; NFR05
- input_contract.files:
  - `tools/cli/lib/engineering-workspace.js`
  - `tools/cli/lib/engineering-task-contract.js`
  - `tools/cli/lib/engineering-project-verifier.js`
  - `tools/cli/lib/engineering-sandbox-check.js (maxBuffer)`
  - `tools/cli/lib/engineering-task-runtime.js`
  - `packages/agent-isolation-attestation/executor.js`
  - `docs/evolution/consumer-validation-2026-10/STATUS.md (pendências A1/N2 e verificador com testes nativos)`
  - `.specs/features/harness-w5/design.md (seção 4, leitura do virtual store)`
- output_contract.files:
  - `tools/cli/lib/engineering-workspace.js`
  - `tools/cli/lib/engineering-task-contract.js`
  - `tools/cli/lib/engineering-project-verifier.js`
  - `tools/cli/lib/engineering-sandbox-check.js`
  - `tools/cli/lib/engineering-task-runtime.js`
  - `test/test-engineering-task-contract.js`
  - `test/test-engineering-project.js`
  - `test/test-engineering-workspace.js`
  - `test/fixtures/pnpm-store/*`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-02b2/*`
- acceptance_criteria: O executor lê o virtual store do pnpm (regex de caminho aceita `@` em `node_modules/.pnpm/<pacote>@<versão>`; symlinks e hardlinks do store resolvidos dentro de raiz verificada; limites de 64 caminhos e 1 MiB tratados com limite explícito, medido e documentado, e arquivos acima de 65536 caracteres tratados com recusa ou leitura em partes, sem truncar em silêncio); o verificador executa os testes nativos do projeto (vitest/`tsc`) como `command_checks`, provado contra o fixture de store pnpm e não apenas com script node autocontido; os limites reais de processos e memória medidos para o vitest ficam no recibo (`pids_peak`, `memory_peak_bytes`).
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'tools/cli/lib/engineering-workspace.js' --include 'tools/cli/lib/engineering-task-contract.js' --include 'tools/cli/lib/engineering-project-verifier.js' --include 'tools/cli/lib/engineering-sandbox-check.js' --include 'tools/cli/lib/engineering-task-runtime.js' --reports-dir .logs/validation/w5-02b2-coverage --temp-directory .logs/validation/w5-02b2-coverage/tmp node --test --test-concurrency=1 test/test-engineering-project.js test/test-engineering-workspace.js test/test-engineering-task-contract.js test/test-engineering-task-runtime.js test/test-engineering-sandbox-check.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada pelo c8 do primeiro comando (90/80 por arquivo, `--include` dos arquivos tocados); testes registrados em `test:kernel` de `package.json`; recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json`.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: a W5-10b depende desta task porque ambas tocam `engineering-task-contract.js` e `engineering-project-verifier.js`. Nenhuma regra existente do contrato é afrouxada além do alfabeto de caminho do prefixo `node_modules/.pnpm`.

## W5-04 — MCP subordinado ao gateway (F20-R1)

- wave: B1
- execution_mode: isolated
- scope: Medium
- dependencies: W5-01 e gate G2
- requirements: FR05, FR13; NFR02
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
  - `tools/mcp-hseos-swarm/index.js`
  - `tools/mcp-hseos-swarm/lib/run-scope.js`
  - `tools/mcp-hseos-swarm/tools/dispatch_wave.js`
  - `test/test-mcp-hseos-governance.js`
  - `test/test-mcp-contract.js`
  - `test/test-mcp-2026-adapter.js`
  - `test/test-mcp-transport-robustness.js`
  - `test/test-mcp-hseos-swarm-scope.js`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-04/*`
- acceptance_criteria: servidor/tool malformado falha o boot com código; tool desconhecida e acesso fora do escopo negados e registrados no ledger; legado só em fixture; corpo HTTP legado limitado; $ref resolvido no registro; -32600 alinhado; swarm valida cwd, nlink e O_NOFOLLOW; limit/stale_minutes string documentados como mudança; contratos de tools `environment.*` e `memory.*` registrados como versionados (stubs de contrato, sem implementação).
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'tools/lib/mcp-2026-adapter.js' --include 'tools/mcp-hseos-governance/index.js' --include 'tools/lib/governed-execution/contract-registry.js' --include 'tools/lib/governed-execution/native-mcp-server.js' --include 'tools/lib/governed-execution/event-registry.js' --include 'tools/lib/legacy-mcp-server.js' --include 'tools/lib/mcp-transport.js' --include 'tools/mcp-hseos-swarm/index.js' --include 'tools/mcp-hseos-swarm/lib/run-scope.js' --include 'tools/mcp-hseos-swarm/tools/dispatch_wave.js' --reports-dir .logs/validation/w5-04-coverage --temp-directory .logs/validation/w5-04-coverage/tmp node --test --test-concurrency=1 test/test-mcp-hseos-governance.js test/test-mcp-contract.js test/test-mcp-2026-adapter.js test/test-mcp-transport-robustness.js test/test-mcp-hseos-swarm-scope.js test/test-mcp-stdio.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão; os testes MCP citados (`test-mcp-hseos-governance`, `test-mcp-contract`, `test-mcp-2026-adapter`, `test-mcp-transport-robustness`, `test-mcp-hseos-swarm-scope`, `test-mcp-stdio`), existentes e fora de `test:kernel` hoje, entram na lista, e `.c8-kernel.json` passa a incluir os arquivos MCP tocados em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-03 — Compactação combinada (F15-R1)

- wave: B2
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a
- requirements: FR04; NFR02
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
  - `package.json`
  - `docs/evolution/w5/evidence/w5-03/*`
- acceptance_criteria: cenário compactação, crash entre compaction.completed e context.assembled, resume e fork comparado ao histórico integral: mesmos source_refs obrigatórios, autoridade por fonte, critérios fixados e lineage; critério existente só em histórico documentado como compactável; sem reescrita de eventos.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-compaction/runtime.js' --include 'packages/agent-context/schemas.js' --reports-dir .logs/validation/w5-03-coverage --temp-directory .logs/validation/w5-03-coverage/tmp node --test --test-concurrency=1 test/test-compaction-resume-fork.js test/test-agent-compaction.js test/test-agent-session-store.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-05 — LSP TypeScript e Python restrito ao workspace

- wave: B2
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a, W5-02b1
- requirements: FR06, FR10; NFR05, NFR06, NFR07
- input_contract.files:
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
  - `plugins/lsp/*`
  - `tools/lib/environment-plugin-pack.js`
  - `test/test-environment-plugin-pack.js`
  - `.enterprise/governance/plugins/definitions/hseos-plugin-lsp/*`
  - `.enterprise/governance/plugins/registry.yaml`
  - `test/test-environment-lsp.js`
  - `test/test-lsp-plugin-parity.js`
  - `test/fixtures/lsp/*`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-05/*`
- acceptance_criteria: diagnostics, definition, references, hover e rename_preview em TS e Python; localização fora da raiz (.., symlink) recusada e registrada; nenhuma escrita em disco (workspace ro, hash antes/depois igual); servidor ausente = BLOCKED; resultado vira fonte data/untrusted com digest; licença de `typescript-language-server`, `typescript` e `pyright` conferida no artefato fixado; `plugins/lsp` gerado do mesmo código do core (digest idêntico, ≤40 entradas, ≤1 MB, lazy loading).
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-environment/framing.js' --include 'packages/agent-environment/lsp.js' --include 'packages/agent-environment/lsp-host.js' --include 'tools/lib/environment-toolchain-pins.js' --include 'tools/lib/environment-plugin-pack.js' --reports-dir .logs/validation/w5-05-coverage --temp-directory .logs/validation/w5-05-coverage/tmp node --test --test-concurrency=1 test/test-environment-lsp.js test/test-lsp-plugin-parity.js test/test-environment-plugin-pack.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: **esta task é dona do gerador de pacote de plugin** (`tools/lib/environment-plugin-pack.js`, com teste comum): lê o manifesto de `plugins/<capacidade>/`, copia no momento do pack os arquivos do core listados no manifesto, grava o tarball e o digest, e recusa tarball acima de 40 entradas ou 1 MB. As tasks W5-06 a W5-09 reutilizam o gerador sem alterá-lo (alteração exige atualizar este contrato). Em `plugins/<capacidade>/` fica versionado apenas o manifesto e a lista de arquivos do core (nenhum código duplicado). O registro de governança segue o layout real: `.enterprise/governance/plugins/definitions/<plugin>/` mais `registry.yaml` (o espelho `.agents/` é gerado pelo compilador, não editado à mão), para todos os plugins.
- nota: pins de servidor (typescript-language-server, pyright) são dados; binários não entram em nenhum tarball (core ou plugin).

## W5-06 — Debug (DAP) Node e Python roteirizado

- wave: B2
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a, W5-02b1, W5-05 (compartilha framing)
- requirements: FR07, FR10; NFR05, NFR06, NFR07
- input_contract.files:
  - `tools/lib/environment-plugin-pack.js (gerador, da W5-05)`
  - `packages/agent-environment/framing.js`
  - `packages/agent-isolation-attestation/profiles.js`
  - `packages/agent-isolation-attestation/executor.js`
  - `.specs/features/harness-w5/design.md (seção 5.2)`
- output_contract.files:
  - `packages/agent-environment/dap.js`
  - `packages/agent-environment/dap-host.js`
  - `tools/lib/environment-toolchain-pins.js`
  - `plugins/dap/*`
  - `.enterprise/governance/plugins/definitions/hseos-plugin-dap/*`
  - `.enterprise/governance/plugins/registry.yaml`
  - `test/test-environment-dap.js`
  - `test/test-dap-plugin-parity.js`
  - `test/fixtures/dap/*`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-06/*`
- acceptance_criteria: breakpoints, stack, variables, step e encerramento em Node e Python; evaluate/setVariable recusados por contrato; breakpoint fora de /workspace recusado; timeout encerra e drena (zero descendentes sobreviventes, prova por cgroup e /proc); adaptador ausente = BLOCKED; licença de `debugpy` e `js-debug` conferida no artefato fixado; `plugins/dap` gerado do mesmo código do core (digest idêntico, ≤40 entradas, ≤1 MB).
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-environment/dap.js' --include 'packages/agent-environment/dap-host.js' --include 'tools/lib/environment-toolchain-pins.js' --reports-dir .logs/validation/w5-06-coverage --temp-directory .logs/validation/w5-06-coverage/tmp node --test --test-concurrency=1 test/test-environment-dap.js test/test-dap-plugin-parity.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-07 — Navegador no core (lazy) e empacotável como plugin, com egresso mediado

- wave: B3
- execution_mode: isolated
- scope: Large
- dependencies: W5-02a, W5-02b1
- requirements: FR08, FR10; NFR03, NFR05, NFR06, NFR07
- input_contract.files:
  - `tools/lib/environment-plugin-pack.js (gerador, da W5-05)`
  - `tools/lib/execution-plugin-manifest.js`
  - `tools/cli/lib/execution-plugin-runtime.js`
  - `tools/cli/lib/provider-egress-broker.js`
  - `packages/agent-environment/*`
  - `packages/agent-context/media-store.js`
  - `.specs/features/harness-w5/design.md (seção 5.3)`
- output_contract.files:
  - `packages/agent-environment/browser-contract.js`
  - `packages/agent-environment/browser.js`
  - `packages/agent-environment/browser-host.js`
  - `plugins/browser/*`
  - `tools/cli/lib/environment-egress-broker.js`
  - `test/test-environment-browser.js`
  - `test/test-browser-plugin-surface.js`
  - `test/test-browser-plugin-parity.js`
  - `tools/lib/environment-toolchain-pins.js`
  - `test/fixtures/browser/*`
  - `.enterprise/governance/plugins/definitions/hseos-plugin-browser/*`
  - `.enterprise/governance/plugins/registry.yaml`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-07/*`
- acceptance_criteria: runtime no core com `playwright-core` carregado sob demanda do pin (nenhum `require` no topo; core sem dependência npm nova); `plugins/browser` gerado do mesmo código (digest idêntico) e admitido por hash pinado; navegador executa em P2 com `--no-sandbox` apenas dentro do `bwrap`; host fora da allowlist bloqueado e registrado; screenshot e DOM viram partes data/untrusted com URL, hora, digest e transform; cookies e segredos não persistem; zero descendentes; sem download em runtime; licença de `playwright-core` e do `chrome-headless-shell-1228` conferida no artefato fixado; pacote do plugin dentro do teto próprio (≤40 entradas, ≤1 MB); core inalterado em dependências.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-environment/browser-contract.js' --include 'packages/agent-environment/browser.js' --include 'packages/agent-environment/browser-host.js' --include 'tools/cli/lib/environment-egress-broker.js' --reports-dir .logs/validation/w5-07-coverage --temp-directory .logs/validation/w5-07-coverage/tmp node --test --test-concurrency=1 test/test-environment-browser.js test/test-browser-plugin-surface.js test/test-browser-plugin-parity.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: cache do `chrome-headless-shell-1228` e do playwright-core ausentes = BLOCKED; `chrome --headless=new` completo trava no sandbox e não é suportado (ensaio da W5-02b1). Sobe no máximo uma instância de navegador por vez.

## W5-08 — Computer-use em Xvfb isolado com aprovação por ação (core, lazy; empacotável como plugin)

- wave: B3
- execution_mode: isolated
- scope: Large
- dependencies: W5-02a, W5-02b1, W5-07 (padrão de plugin e captura)
- requirements: FR09, FR10; NFR01, NFR05, NFR06, NFR07
- input_contract.files:
  - `tools/lib/environment-plugin-pack.js (gerador, da W5-05)`
  - `packages/agent-isolation-attestation/terminal-executor.js`
  - `packages/agent-policy-lattice/index.js`
  - `packages/agent-environment/*`
  - `.specs/features/harness-w5/design.md (seção 5.4)`
- output_contract.files:
  - `packages/agent-environment/computer-contract.js`
  - `packages/agent-environment/computer.js`
  - `packages/agent-environment/computer-host.js`
  - `plugins/computer-use/*`
  - `tools/cli/lib/environment-approval.js`
  - `test/test-environment-computer.js`
  - `test/test-computer-plugin-parity.js`
  - `tools/lib/environment-toolchain-pins.js`
  - `test/fixtures/computer/*`
  - `.enterprise/governance/plugins/definitions/hseos-plugin-computer-use/*`
  - `.enterprise/governance/plugins/registry.yaml`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-08/*`
- acceptance_criteria: ação sem aprovação negada; aprovação de uso único vinculada a sessão, sequência, ação e screenshot, expira e não é reutilizável; modo bypass/approve_all não se aplica; DISPLAY do operador inacessível (teste negativo); sessão encerra e drena em stop e expiração; screenshot com proveniência; injetor de entrada (`xdotool`, BSD, pin externo; `python-xlib` descartado) indisponível = BLOCKED, com a licença conferida no artefato fixado; `plugins/computer-use` gerado do mesmo código do core (digest idêntico, ≤40 entradas, ≤1 MB), somente Linux.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-environment/computer-contract.js' --include 'packages/agent-environment/computer.js' --include 'packages/agent-environment/computer-host.js' --include 'tools/cli/lib/environment-approval.js' --reports-dir .logs/validation/w5-08-coverage --temp-directory .logs/validation/w5-08-coverage/tmp node --test --test-concurrency=1 test/test-environment-computer.js test/test-computer-plugin-parity.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.
- nota: somente Xvfb próprio; nunca a sessão gráfica real. Uma sessão por vez.

## W5-09 — Memória governada

- wave: B3
- execution_mode: isolated
- scope: Large
- dependencies: W5-02a
- requirements: FR03, FR10; NFR03, NFR05, NFR06, NFR08
- input_contract.files:
  - `tools/lib/environment-plugin-pack.js (gerador, da W5-05)`
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
  - `plugins/memory/*`
  - `.enterprise/governance/plugins/definitions/hseos-plugin-memory/*`
  - `.enterprise/governance/plugins/registry.yaml`
  - `test/test-agent-memory.js`
  - `test/test-memory-plugin-parity.js`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w5/evidence/w5-09/*`
- acceptance_criteria: escrita exige política admissora e passa por varredura de credenciais; authority fixa em data; TTL obrigatório e expiração verificável; origem untrusted fora da recuperação padrão; recuperação determinística alimenta memory[] com proveniência; escopo por projeto; ponte axon opcional e read-only (ausente = no-op); projeção reconstruível dos eventos; `plugins/memory` apenas distribui o mesmo código do core (digest idêntico, ≤40 entradas, ≤1 MB) e a escrita continua no ledger do host, pois o plugin não recebe ledger.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'packages/agent-memory/index.js' --include 'packages/agent-memory/store.js' --include 'packages/agent-memory/policy.js' --include 'tools/cli/lib/memory-context-source.js' --reports-dir .logs/validation/w5-09-coverage --temp-directory .logs/validation/w5-09-coverage/tmp node --test --test-concurrency=1 test/test-agent-memory.js test/test-memory-plugin-parity.js test/test-mcp-axon-bridge.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão; `test-mcp-axon-bridge` (existente, fora de `test:kernel` hoje) entra na lista em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-10 — Superfícies: autoridade e proveniência em evidência, eventos, CLI e SDKs

- wave: B4
- execution_mode: isolated
- scope: Medium
- dependencies: W5-02a..W5-09
- requirements: FR11, FR13; NFR02
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
  - `package.json`
  - `docs/evolution/w5/evidence/w5-10/*`
- acceptance_criteria: /v1/tasks/{id}/evidence e eventos expõem authority, origin, digest e trust; CLI e SDK JS/TS/Python equivalentes; clientes v1 continuam lendo; nenhum código executável trafega por HTTP; init/rate_limit/pids_peak expostos ou declarados desconhecidos.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'tools/cli/lib/engineering-control-http.js' --include 'tools/cli/lib/engineering-control.js' --include 'packages/control-sdk/index.js' --reports-dir .logs/validation/w5-10-coverage --temp-directory .logs/validation/w5-10-coverage/tmp node --test --test-concurrency=1 test/test-environment-surfaces.js test/test-engineering-control.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-10b — Aceite endurecido do contrato de tarefa de engenharia v2 (F09/F10, A5b, REVIEW3-C1, N1)

- wave: B4
- execution_mode: isolated
- scope: Medium (contrato de segurança do aceite; revisão cética isolada obrigatória)
- dependencies: W5-02b2 (mesmos arquivos de contrato e verificador; virtual store e testes nativos já integrados) e W5-10 (superfície de erros em `engineering-control*`). Não roda em B1 porque B1 está no limite de 3 agentes aprovado e colide com a W5-02b.
- requirements: FR12, FR14; NFR02, NFR05
- input_contract.files:
  - `tools/cli/lib/engineering-task-contract.js`
  - `tools/cli/lib/engineering-task-runtime.js`
  - `tools/cli/lib/engineering-project-verifier.js`
  - `tools/cli/lib/engineering-task-state.js`
  - `tools/cli/lib/engineering-control.js`
  - `tools/cli/lib/engineering-control-http.js`
  - `docs/engineering-control-api.md`
  - `docs/evolution/consumer-validation-2026-10/STATUS.md (A5b, REVIEW3-C1, N1)`
  - `.specs/features/harness-w5/spec.md (FR12, FR14)`
- output_contract.files:
  - `tools/cli/lib/engineering-task-contract.js`
  - `tools/cli/lib/engineering-task-runtime.js`
  - `tools/cli/lib/engineering-project-verifier.js`
  - `tools/cli/lib/engineering-control.js`
  - `tools/cli/lib/engineering-control-http.js`
  - `docs/engineering-control-api.md`
  - `docs/engineering-task-contract.md`
  - `test/test-engineering-task-contract.js`
  - `test/test-engineering-project.js`
  - `test/test-engineering-control.js`
  - `.c8-kernel.json`
  - `docs/evolution/w5/evidence/w5-10b/*`
- acceptance_criteria:
  - Admissão de tarefa v2 sem verificador executável é recusada com `detail.code` próprio (`ENGINEERING_ACCEPTANCE_WEAK`; nome final fixado na task e documentado). Verificador executável é um de dois: (a) `verifier.command_checks` não vazio com `protected_paths` cobrindo o entrypoint de cada comando e todo arquivo de configuração **conhecido** (lista abaixo) presente no workspace, ou (b) verificador fixado (`reference` e `sha256` atestados) cujo módulo de verificação está em `protected_paths` e fora de `scope.write`. Critério baseado só em conteúdo estático (por exemplo um único `content-includes`) não satisfaz nenhum dos dois.
  - Delta sobre a regra atual (`verifier.acceptance_ids` já deve igualar os ids de aceite, `engineering-task-contract.js`): cada `acceptance.id` precisa ser coberto por pelo menos um verificador **executável** (não apenas listado em `acceptance_ids`); critério coberto só por verificação estática é recusado com código próprio.
  - Resíduo REVIEW3-C1, regra decidível: (1) cada arg de `command_checks` pertence a um alfabeto conservador: identificador ou caminho relativo `[A-Za-z0-9._@/-]` (inclui `@`, coerente com o virtual store do pnpm da W5-02b2), opção longa `--nome` com no máximo um `=` cujo valor também está no alfabeto, e nenhuma opção curta com valor colado (um hífen seguido de mais de uma letra, como `-cindex.js`); recusa `file:index.js`, `index%2Ejs`, `index.js:1`, `--a=b=index.js`, `~`, `\\`; (2) os arquivos de configuração conhecidos presentes no workspace devem constar de `protected_paths`: `package.json`, `tsconfig*.json`, `vitest.config.*`, `vite.config.*`, `.npmrc`, `pnpm-workspace.yaml`. A lista é fixada no contrato, versionada (`protected_config_files_version`) e só cresce por nova versão. Arquivos lidos implicitamente fora da lista são responsabilidade documentada do autor do contrato (`docs/engineering-task-contract.md`). A leitura de configuração não é inferida do comando, o que não seria decidível estaticamente.
  - Resíduo N1: toda recusa por regra cruzada de `parseEngineeringTask` (`command_checks`, `protected_paths`, cobertura de aceite, escopo) chega ao cliente com `detail.code` distinto; `error.code` existente é mantido (compatibilidade).
  - Compatibilidade: contratos já admitidos e eventos históricos continuam legíveis; o endurecimento vale para novas admissões e a mudança é registrada como mudança de comportamento (nota em `docs/v4-migration.md` na W5-12). Nenhum afrouxamento de regra existente.
  - Testes negativos: um por código novo, um por forma de arg recusada, e o caso real da pendência A5b (critério fraco que aprovou entrega reprovada pelo verificador externo agora é recusado na admissão). Mutantes novos de W5-11a: remover a recusa de critério fraco e relaxar o alfabeto de args são rejeitados.
- verify_step.command: `heavy-run --mem 4G -- node node_modules/c8/bin/c8.js --config .c8-kernel.json --include 'tools/cli/lib/engineering-task-contract.js' --include 'tools/cli/lib/engineering-task-runtime.js' --include 'tools/cli/lib/engineering-project-verifier.js' --include 'tools/cli/lib/engineering-control.js' --include 'tools/cli/lib/engineering-control-http.js' --reports-dir .logs/validation/w5-10b-coverage --temp-directory .logs/validation/w5-10b-coverage/tmp node --test --test-concurrency=1 test/test-engineering-task-contract.js test/test-engineering-project.js test/test-engineering-control.js test/test-engineering-task-runtime.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada pelo c8 do primeiro comando (90/80 por arquivo, `--include` dos arquivos tocados); testes registrados em `test:kernel` de `package.json`; recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json`.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida = BLOCKED com a causa, nunca PASS. Nenhuma regra é afrouxada para fazer um contrato existente passar.
- nota: origem A5b da revalidação de 2026-10 (critérios fracos aprovaram uma entrega que o verificador externo reprovou) e REVIEW3-C1 (risco de configuração: args vêm do autor do contrato, não do modelo).

## W5-11a — Ensaios determinísticos e mutantes W5

- wave: B4
- execution_mode: isolated
- scope: Large
- dependencies: W5-10b
- requirements: FR01-FR15 (matriz negativa); NFR04
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
- acceptance_criteria: matriz negativa: import com efeito, LSP fora do workspace, DAP com filho sobrevivente, navegador com egresso negado, computer-use sem aprovação, mídia adulterada, memória elevando autoridade, MCP malformado/desconhecido/fora do escopo; mutantes de ampliação de autoridade, perda de proveniência, bypass de aprovação e recusa de critério fraco removida (W5-10b) todos rejeitados.
- verify_step.command: `heavy-run --mem 4G -- node --test --test-concurrency=1 test/test-w5-negative-matrix.js; heavy-run --mem 4G -- node scripts/governance/check-w5-mutations.js`
- verify_step.expected: exit 0, zero falhas/skips; cobertura focada: o c8 do primeiro comando (config `.c8-kernel.json`, `--include` limitado aos arquivos da task, `per-file` 90% linhas e 80% branches) passa para os arquivos da task; os arquivos novos estão em `.c8-kernel.json` e os testes novos registrados em `test:kernel` de `package.json` (o `npm run test:kernel-coverage` completo roda uma vez por onda, na integração, não por task); recibo ligado à revisão em `docs/evolution/w5/evidence/<task>/receipt.json` (SHA da revisão, comando, versão do Node, resultado e SHA-256 dos logs).
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

## W5-11b — Consumidores reais A e B instalados fora do checkout

- wave: B4
- execution_mode: isolated
- scope: Large
- dependencies: W5-11a (e, por ela, W5-10b)
- requirements: FR12; NFR05
- input_contract.files:
  - `tools/examples/project-task.js`
  - `test/journeys/*`
  - `docs/evolution/w4/CONSUMERS.md (molde)`
  - `docs/evolution/revalidation-2026-10/INVENTORY-CAPACITY.md`
- output_contract.files:
  - `test/journeys/w5-environment-journey.mjs`
  - `docs/evolution/w5/CONSUMERS.md`
  - `docs/evolution/w5/evidence/real/*`
- acceptance_criteria:
  - Tarballs do core e dos plugins instalados offline, do cache, em diretório novo e vazio.
  - Consumidor A (`/workspace/github/hideaki-solutions/cambio-real/apps/platform-web`): clone descartável só do app; instalação offline do cache; vitest sempre com `--maxWorkers=2`; nunca comando de teste na raiz do monorepo; teste real existente com defeito injetado (ou bug reproduzível) percorre LSP, DAP, correção governada, verificação no navegador com screenshot e aceite por verificador externo fixado antes do despacho. É a prova principal.
  - Consumidor B (`/workspace/github/hideaki-solutions/axon-web`): clone descartável; teste e defeito **sintéticos**, declarados como sintéticos na evidência (`CONSUMERS.md` e recibo); serve como segunda prova de UI no navegador, nunca como prova de teste real.
  - Modelo, em ordem: (1) local ou de custo zero; (2) assinaturas Claude/Codex com no máximo 3 despachos por binding; (3) API paga com teto de US$ 1. Cada despacho segue reserva e depois recibo. Sem rota disponível a tarefa fica BLOCKED. Gasto além do teto exige nova pergunta ao owner (G4).
  - Computer-use exercitado em fixture própria; zero órfãos; qualquer insumo ausente (cache, binário, Xvfb) = BLOCKED com a causa.
- verify_step.command: `node test/journeys/w5-environment-journey.mjs --prefix <install> --consumer <clone-descartavel-A> --second-consumer <clone-descartavel-B> --assert-receipts`
- verify_step.expected: `--assert-receipts` lê o ledger de controle da campanha de `ProviderCampaignControl` (`tools/cli/lib/provider-campaign-control.js`): linhas com `payload.kind` `reserved` (`command_id`, `reserved_microusd`) e `receipt` (`receiptSchema`: `status`, `cost_microusd`, `binding_sha256`, `evidence_ref`), além da autorização (`authorizationSchema`: `max_cost_microusd`, `binding_ids`, `max_requests`), e a referência de saída `campaign://<campanha>/<despacho>` (`CAMPAIGN_REFERENCE`). A campanha é aberta com `max_cost_microusd` ≤ 1000000 (US$ 1). Falha se `committed_microusd` do relatório (soma de `receipt.cost_microusd`, ou o maior entre reservado e medido quando incerto) passar de 1000000, se houver mais de 3 linhas `reserved` de assinatura por `binding_id`, ou se algum `receipt` não tiver `reserved` anterior com o mesmo `command_id` (a jornada recusa o despacho que ultrapassaria o teto); veredito PASS por passo e por consumidor com recibo; BLOCKED declarado onde faltar insumo; evidência de B marcada sintética.
- verify_step.on_failure: não repetir variações da mesma abordagem mais de 3 vezes; BLOCKED não vira PASS; gasto acima de US$ 1 só com G4.

## W5-12 — Fechamento: rastreabilidade, matriz integral e PR

- wave: B4
- execution_mode: isolated
- scope: Large
- dependencies: W5-11b
- requirements: FR01-FR15; NFR04, NFR06, NFR07
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
- acceptance_criteria: FR -> task -> teste -> recibo; npm test, test:kernel-coverage (90/80 por arquivo incluindo W5), test:w5-mutations em Node 22 e 24 sequencial; quality-gates --phase ci; pacote do core medido com `npm pack --dry-run --json` e levado ao owner como G3 (teto sobe só pelo número medido; `packages` 137; soma dos orçamentos por área ≤ teto), pacotes de plugin dentro de ≤40 entradas e ≤1 MB com paridade de digest; nota de migração cobre `limit`/`stale_minutes` (W5-04) e o endurecimento de aceite (W5-10b); recibo final com SHA-256; grafo `proposed` válido; PR para feature/hseos-evolution-w5 e depois para a master (G6).
- verify_step.command: `heavy-run -- systemd-run --user --wait --collect --pipe -p Delegate=yes -p DelegateSubgroup=tests npm test (Node 22 e depois 24); npm run test:kernel-coverage; VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh --phase ci; node scripts/governance/validate-capability-graph.js`
- verify_step.expected: zero falhas/skips; 90/80 por arquivo crítico; mutantes todos rejeitados; tentativas falhas registradas, nunca contadas.
- verify_step.on_failure: diagnosticar e corrigir (até 3 rodadas); causa desconhecida ou capacidade indisponível = BLOCKED com a causa, nunca PASS.

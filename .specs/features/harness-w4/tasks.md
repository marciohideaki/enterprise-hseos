# Tasks W4

Tipo: contratos de execução isolada. Estado inicial: W4-01 em andamento; demais pendentes.
Uma task = um commit; uma wave = uma PR. Todos os paths são relativos à worktree.
As listas com wildcard descrevem famílias de artefatos de evidência; inventário final
deve enumerar arquivos reais e hashes. Implementação não pode alegar conclusão por
comando planejado. Alteração de escopo exige atualizar contrato antes do código.

Verificações com executor requerem escopo delegado do design. Os comandos abaixo
usam Node da matriz e ambiente ABI correspondente. Suítes/gates são sequenciais.
W4-07b exige runner e configuração concreta registrados no recibo antes da execução;
o validador de grafo não substitui campanha real. Indisponibilidade mantém aceite pendente.

## W4-01 — Consolidar contratos e intake

- execution_mode: isolated
- scope: Medium
- dependencies: W3 integrada em 32eaef2
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `.specs/features/harness-w4/spec.md`
  - `docs/evolution/w4/PLAN.md`
- output_contract.files:
  - `.specs/features/harness-w4/*.md`
  - `docs/decisions/harness-w4-intake.md`
  - `.enterprise/.specs/decisions/ADR-0045-execution-plugins-and-durable-jobs.md`
  - `docs/evolution/w4/STATUS.md`
  - `docs/evolution/w4/evidence/contracts/*`
- acceptance_criteria: FR01–FR08 rastreáveis; estados, falhas, versões e comandos definidos; ambiente verificado.
- verify_step.command: `git diff --check; node scripts/governance/validate-capability-graph.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-02a — Admitir descritores de execução

- execution_mode: isolated
- scope: Medium
- dependencies: W4-01
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `tools/cli/installers/lib/core/agent-core-compiler/sources/plugins-source.js`
- output_contract.files:
  - `tools/lib/execution-plugin-manifest.js`
  - `tools/cli/installers/lib/core/agent-core-compiler/sources/plugins-source.js`
  - `test/test-execution-plugin-manifest.js`
  - `tools/cli/commands/plugin.js`
  - `tools/cli/command-manifest.json`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w4/evidence/admission/*`
- acceptance_criteria: Dados não importam código; v2 compatível; identidade/hash/versão/autoridade inválidos recusados.
- verify_step.command: `node --test --test-concurrency=1 test/test-execution-plugin-manifest.js; npm run test:plugins`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-02b — Executar extensões e conformance isoladas

- execution_mode: isolated
- scope: Medium
- dependencies: W4-02a
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `packages/agent-isolation-attestation/executor.js`
  - `packages/agent-isolation-attestation/index.js`
- output_contract.files:
  - `tools/cli/lib/execution-plugin-runtime.js`
  - `test/test-execution-plugin-runtime.js`
  - `test/test-package-surface.js`
  - `.specs/features/harness-w4/extensions.md`
  - `.c8-kernel.json`
  - `package.json`
  - `docs/evolution/w4/STATUS.md`
  - `docs/evolution/w4/evidence/isolation/*`
- acceptance_criteria: Snapshot readonly; timeout/saída/rede/segredo/workspace negados; drain comprovado; zero import no host.
- verify_step.command: `node --test --test-concurrency=1 test/test-execution-plugin-runtime.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-02c — Conectar tool, provider e contexto

- execution_mode: isolated
- scope: Medium
- dependencies: W4-02b
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `packages/tool-runtime/index.js`
  - `packages/model-providers/registry.js`
  - `packages/agent-context/context-assembler.js`
  - `tools/cli/lib/engineering-task-runtime.js`
- output_contract.files:
  - `tools/cli/lib/execution-plugin-adapters.js`
  - `tools/cli/lib/engineering-task-runtime.js`
  - `tools/cli/lib/engineering-model.js`
  - `test/test-execution-plugin-adapters.js`
- acceptance_criteria: Contratos próprios validam cada resposta; gateway/broker/política preservados; origem de contexto registrada.
- verify_step.command: `node --test --test-concurrency=1 test/test-execution-plugin-adapters.js test/test-tool-runtime.js test/test-agent-context.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

### Subdivisões de W4-02c

- W4-02c1 (task hseos-w4-plugin-ports): bundles de ferramenta e fonte de contexto
  pelo ToolRuntime, validação dos contratos e proveniência; drain explícito.
  Outputs: tools/cli/lib/execution-plugin-adapters.js,
  test/test-execution-plugin-adapters.js, package.json, .c8-kernel.json,
  test/test-package-surface.js, docs/evolution/w4/evidence/ports/\* e STATUS.md.
  Verificação: node --test --test-concurrency=1 test/test-execution-plugin-adapters.js.
- W4-02c2: providers ModelProvider/RuntimeProvider com despacho reservado na campanha,
  conformance dos ports e cancelamento; mesmo arquivo adapters ou shard específico.
- W4-02c2a (task hseos-w4-plugin-campaign): manifesto de controle v2 para binding
  local execution-plugin, leitura v1 preservada; ponte nominal à campanha existente,
  intenção por hash e resultado duráveis, nenhum novo saldo. Outputs:
  tools/lib/provider-control-manifest.js, tools/cli/lib/execution-plugin-campaign.js,
  test/test-execution-plugin-campaign.js, package.json, .c8-kernel.json,
  test/test-package-surface.js e evidence/plugin-campaign/\*. Verificar com
  node --test --test-concurrency=1 test/test-execution-plugin-campaign.js
  test/test-provider-control-manifest.js test/test-provider-campaign-control.js.
- W4-02c2b (task hseos-w4-plugin-providers): ports ModelProvider/RuntimeProvider e
  conformance sobre a ponte reservada. Outputs: tools/cli/lib/execution-plugin-model.js,
  tools/cli/lib/execution-plugin-provider.js, packages/runtime-providers/hosted-runtime-provider.js,
  test/test-execution-plugin-providers.js, tools/cli/lib/execution-plugin-campaign.js,
  test/test-execution-plugin-campaign.js, package.json, .c8-kernel.json,
  test/test-package-surface.js e evidence/plugin-providers/\*. Verificar:
  node --test --test-concurrency=1 test/test-execution-plugin-providers.js
  test/test-hosted-runtime-adapters.js test/test-model-providers.js.
- W4-02c3a (task hseos-w4-plugin-selection; depende de W4-02a): seleção durável
  por identidade e hash de configuração/política; resolução apenas dos IDs escolhidos,
  dependências admitidas, restauração exata e leitura sem import. Não executa ports.
  Outputs: tools/lib/execution-plugin-selection.js, test/test-execution-plugin-selection.js,
  package.json, .c8-kernel.json, test/test-package-surface.js, selection.md, \_INDEX.md e evidence/selection/\*.
  Verificação: node --test --test-concurrency=1 test/test-execution-plugin-selection.js.
  Critérios: atualização não muda pin, configuração/política divergente bloqueia restore,
  versão não selecionada inerte, relocação offline preserva identidade.
- W4-02c3b (task hseos-w4-task-extensions): ferramentas/contexto na tarefa e controle;
  contrato detalhado em task-extension-composition.md, incluindo reserva de slots,
  procedência, cancelamento e gate. Depende de W4-02c3a integrada.
- W4-02c3c (task hseos-w4-task-model): modelo pinado na tarefa, vinculado à campanha
  existente e ao controle, sem saldo novo. Contrato/arquivos/verificação detalhados em
  task-model-composition.md, incluindo correção da identidade do ledger.
  W4-03a depende da conclusão de W4-02c.

## W4-03a — Persistir agregado de jobs e consultas

- execution_mode: isolated
- scope: Medium
- dependencies: W4-02c
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `tools/mcp-project-state/lib/execution-event-ledger.js`
  - `tools/cli/lib/engineering-control.js`
- output_contract.files:
  - `tools/cli/lib/job-control.js`
  - `tools/lib/job-contract.js`
  - `tools/mcp-project-state/migrations-pending-activation/012-job-events.sql`
  - `test/test-job-control.js`
- implementation_contract: [job-state-implementation.md](job-state-implementation.md) detalha extração de admissão e arquivos complementares de migração/compatibilidade.
- acceptance_criteria: Criar não executa; replay/seq/cursor determinísticos; relógio e dependências validados.
- verify_step.command: `node --test --test-concurrency=1 test/test-job-control.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-03b — Cercar claims e recuperar dois controladores

- execution_mode: isolated
- scope: Medium
- dependencies: W4-03a
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `packages/agent-isolation-attestation/executor.js`
  - `tools/cli/lib/engineering-control.js`
- output_contract.files:
  - `tools/cli/lib/job-worker.js`
  - `tools/cli/lib/job-control.js`
  - `test/test-job-recovery.js`
- acceptance_criteria: Processos concorrentes têm um dono; owner vivo/desconhecido bloqueia; morto exige reconciliação; prazo não renova.
- verify_step.command: `node --test --test-concurrency=1 test/test-job-recovery.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-03c — Materializar recursos idempotentes no ledger compartilhado

- execution_mode: isolated
- scope: Medium
- dependencies: W4-03b
- implementation_contract: [job-materialization-implementation.md](job-materialization-implementation.md)
- input_contract.files: `job-worker.js`, `engineering-control.js`, `engineering-task-runtime.js`, `engineering-workflow-runtime.js` em `tools/cli/lib/`; ledger e isolamento existentes.
- output_contract.files:
  - `tools/cli/lib/job-materialization.js`
  - `tools/cli/lib/{job-control,job-worker,engineering-control,engineering-task-runtime,engineering-task-state,engineering-workflow-runtime,engineering-workspace,terminal-control}.js`
  - `tools/mcp-project-state/migrations-pending-activation/014-job-materialization-events.sql`
  - `test/test-job-materialization.js`
  - `test/test-engineering-workspace.js`
  - `docs/evolution/w4/STATE-LIFECYCLE.md`
  - `docs/evolution/w4/evidence/job-materialization/*`
- acceptance_criteria: Intenção fixa IDs antes dos arquivos; crash parcial retoma mesmos IDs/prazos; registro final e recibo atômicos; views readonly compartilham ledger; entradas antigas de efeito bloqueadas desde preparação.
- verify_step.command: `node --test --test-concurrency=1 test/test-job-materialization.js test/test-job-recovery.js test/test-engineering-workspace.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-03d — Integrar despacho, settlement e recuperação ao serviço

Contrato detalhado: [job-dispatch-implementation.md](job-dispatch-implementation.md).

- execution_mode: isolated
- scope: Medium
- dependencies: W4-03c
- input_contract.files: Contratos W4 de jobs; serviço EngineeringControl; JobWorker/JobMaterializer; runtime task/workflow e campanha existentes.
- output_contract.files: serviço e worker existentes; `test/test-job-faults.js`; `docs/evolution/w4/STATE-LIFECYCLE.md`; evidência de worker/backup/restore.
- acceptance_criteria: Polling com concorrência padrão1; elegibilidade antes do primeiro efeito; despacho exige claim/fence/admissão/reserva; settlement exige aceite; crash antes/depois efeito não repete incerteza; cancelamento drena árvore; backup/restore preservam identidade; sem ativação operacional.
- verify_step.command: `node --test --test-concurrency=1 test/test-job-faults.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-04a — Versionar DAG e expansão governada

- execution_mode: isolated
- scope: Medium
- dependencies: W4-03d
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `tools/cli/lib/engineering-workflow-runtime.js`
  - `packages/agent-orchestration/workflow-engine.js`
- output_contract.files:
  - `tools/cli/lib/engineering-workflow-runtime.js`
  - `tools/cli/lib/job-control.js`
  - `test/test-workflow-expansion.js`
- acceptance_criteria: v1 legível; expansão pinada/CAS idempotente; ciclos/limites/revisão recusados; sem reescrita de nós.
- verify_step.command: `node --test --test-concurrency=1 test/test-workflow-expansion.js test/test-engineering-workflow-runtime.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

### Subdivisões de W4-04a

- W4-04a1: workflow v2 e expansão queued com evento aditivo, cadeia de hashes,
  CAS, recibos e limites imutáveis. Contrato: workflow-revisions-implementation.md.
- W4-04a2: expansão running com reserva incremental, novos filhos preparados de
  forma durável e revisões reconhecidas pelo engine, sem renumerar checkpoints.
  Pins de modelos/extensões por nó permanecem pendentes até integração própria.

### W4-04a2a — Persistir revisões da reserva de sessão

- execution_mode: isolated
- dependencies: W4-04a1 (6f0129af; integração2395d845)
- input_contract.files: `workflow-reservations-implementation.md`, `packages/agent-runtime-contracts/orchestration-contracts.js`, `packages/agent-session-store/session-event-store.js`.
- output_contract.files: `packages/agent-runtime-contracts/event-contracts.js`, `packages/agent-session-store/replay.js`, `packages/agent-orchestration/workflow-engine.js`, `test/test-workflow-reservations.js`, `package.json`, intake/evidência/STATUS.
- acceptance_criteria: revisão append-only com claim/CAS; tetos originais; checkpoints preservados; v1 compatível; engine recusa consumo prematuro sem efeito.
- verify_step.command: `node --test --test-concurrency=1 test/test-workflow-reservations.js test/test-agent-session-store.js test/test-agent-runtime-contracts.js test/test-agent-orchestration.js`
- verify_step.expected: exit0, zero falhas/skips; cobertura90/80 por crítico, Node22/24 sequenciais.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

W4-04a2b integra revisões no engine. W4-04a2c integra admissão running e materialização incremental de filhos. Ambas dependem desta unidade; comandos running continuam recusados até integração completa.

### W4-04a2b — Consumir definições revisadas no engine

- execution_mode: isolated
- dependencies: W4-04a2a (`1f09c3e8`; integração `6bba910d`)
- implementation_contract: [workflow-revision-engine-implementation.md](workflow-revision-engine-implementation.md)
- output_contract.files: `packages/agent-orchestration/workflow-engine.js`, `test/test-workflow-reservations.js`, `test/test-kernel-mutations.js`, `test/fixtures/kernel-mutation-loader.cjs`, evidência/STATUS.
- acceptance_criteria: revisão corrente consumida em fronteira de fase; checkpoint histórico e claim preservados; release só após todas as fases correntes; definição forjada sem efeito.
- verify_step.command: `node --test --test-concurrency=1 test/test-agent-orchestration.js test/test-workflow-reservations.js`
- verify_step.expected: exit0, zero falhas/skips; cobertura90/80 por crítico em Node22/24.

### W4-04a2c — Materializar filhos de expansão running

- execution_mode: isolated
- dependencies: W4-04a2b (`15719b4b`; integração `1e90d2b0`)
- implementation_contract: [workflow-running-expansion-implementation.md](workflow-running-expansion-implementation.md)
- output_contract.files: `tools/cli/lib/job-control.js`, `tools/cli/lib/job-materialization.js`, `tools/cli/lib/engineering-workflow-runtime.js`, `test/test-workflow-expansion.js`, evidência/STATUS.
- acceptance_criteria: append de revisão e registros de filho no mesmo SQLite CAS; IDs e snapshots existentes estáveis; janela tardia limitada pelo prazo original do pai; idempotência após reabertura; cancelamento vencedor sem publicação nem despacho novo.
- verify_step.command: `node --test --test-concurrency=1 test/test-workflow-expansion.js test/test-job-control.js test/test-job-materialization.js test/test-job-faults.js test/test-engineering-workflow-runtime.js test/test-workflow-reservations.js`
- verify_step.expected: exit0, zero falhas/skips em Node22/24; cobertura90/80 por arquivo crítico.
- verify_step.on_failure: diagnosticar causa e manter recibo pendente; efeito incerto não equivale a cancelamento confirmado.

## W4-04b — Aplicar joins, invalidação e drain transitivo

- execution_mode: isolated
- scope: Medium
- dependencies: W4-04a
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `packages/agent-orchestration/workflow-engine.js`
  - `packages/agent-orchestration/execution-supervisor.js`
- output_contract.files:
  - `tools/cli/lib/job-worker.js`
  - `tools/cli/lib/engineering-workflow-runtime.js`
  - `packages/agent-orchestration/workflow-engine.js`
  - `test/test-workflow-expansion.js`
  - `test/test-job-recovery.js`
- acceptance_criteria: Join exige aceite; drift invalida; falha/cancel bloqueiam filhos tardios e terminal só após drain.
- verify_step.command: `node --test --test-concurrency=1 test/test-workflow-expansion.js test/test-job-recovery.js test/test-agent-orchestration.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-05 — Integrar reservas de campanha e recursos

- execution_mode: isolated
- scope: Medium
- dependencies: W4-04b
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `tools/cli/lib/provider-campaign-control.js`
  - `tools/cli/lib/provider-campaign-runner.js`
- output_contract.files:
  - `tools/cli/lib/job-worker.js`
  - `tools/cli/lib/provider-campaign-control.js`
  - `tools/cli/lib/execution-plugin-adapters.js`
  - `test/test-job-campaign.js`
- acceptance_criteria: Reserva antes do efeito; incerteza comprometida; mesma autorização não cria saldo novo; binding/filho respeitam teto.
- verify_step.command: `node --test --test-concurrency=1 test/test-job-campaign.js test/test-provider-campaign-control.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-06a — Expor jobs no controle e SDKs

- execution_mode: isolated
- scope: Medium
- dependencies: W4-05
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `tools/cli/commands/control.js`
  - `tools/cli/lib/engineering-control-http.js`
  - `packages/control-sdk/index.js`
- output_contract.files:
  - `tools/cli/commands/control.js`
  - `tools/cli/lib/engineering-control.js`
  - `tools/cli/lib/engineering-control-http.js`
  - `tools/cli/lib/control-configuration.js`
  - `packages/control-sdk/index.js`
  - `packages/control-sdk/index.d.ts`
  - `packages/control-sdk/hseos_control.py`
  - `test/test-job-surfaces.js`
- acceptance_criteria: CLI/API/SDK JS/TS/Python mesma jornada/IDs/cursor; auth e envelope iguais; HTTP recusa código.
- verify_step.command: `node --test --test-concurrency=1 test/test-job-surfaces.js test/test-engineering-control.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-06b — Distribuir extensões pinadas offline

- execution_mode: isolated
- scope: Medium
- dependencies: W4-06a
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `tools/cli/commands/plugin.js`
  - `tools/cli/installers/lib/core/agent-core-compiler/sources/plugins-source.js`
- output_contract.files:
  - `tools/cli/commands/plugin.js`
  - `tools/cli/lib/execution-plugin-install.js`
  - `test/test-execution-plugin-install.js`
- acceptance_criteria: Instalação externa/offline, rollback, seleção imutável, help/import lazy e versão não selecionada inerte.
- verify_step.command: `node --test --test-concurrency=1 test/test-execution-plugin-install.js; npm run test:plugins`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-07a — Executar matriz adversarial e mutantes

- execution_mode: isolated
- scope: Medium
- dependencies: W4-06b
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `.c8-kernel.json`
  - `test/test-kernel-quality-surface.js`
- output_contract.files:
  - `.c8-kernel.json`
  - `package.json`
  - `test/test-kernel-quality-surface.js`
  - `scripts/governance/check-w4-mutations.js`
  - `docs/evolution/w4/evidence/deterministic/*`
- acceptance_criteria: Todos cenários obrigatórios executados; mutantes auth/budget/recovery mortos; cobertura inclui não executados.
- verify_step.command: `node scripts/governance/check-w4-mutations.js; npm run test:kernel-coverage`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-07b — Certificar consumidores e campanha integrada

- execution_mode: isolated
- scope: Large
- dependencies: W4-07a
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `docs/evolution/w3/ADAPTERS-CAMPAIGN.md`
  - `docs/evolution/w4/PLAN.md`
- output_contract.files:
  - `docs/evolution/w4/CONSUMERS.md`
  - `docs/evolution/w4/evidence/real/*`
- acceptance_criteria: Tool/provider/context reais fora do checkout; binding elegível; integração/recuperação/cancelamento e orçamento evidenciados; não repetir W3.
- verify_step.command: `node scripts/governance/validate-capability-graph.js`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

## W4-08 — Fechar matriz, documentação e PR

- execution_mode: isolated
- scope: Large
- dependencies: W4-07b
- input_contract.files:
  - `.specs/features/harness-w4/design.md`
  - `.github/pull_request_template.md`
  - `docs/evolution/w4/PLAN.md`
- output_contract.files:
  - `docs/evolution/w4/STATUS.md`
  - `docs/evolution/w4/README.md`
  - `docs/evolution/w4/evidence/final/*`
  - `.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml`
  - `packages/control-sdk/README.md`
- acceptance_criteria: Node22/24 sequenciais e checks verdes; revisão adversarial; FR→task→teste→evidência; PR contra foundation, sem merge.
- verify_step.command: `npm test; npm run test:kernel-coverage; VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh`
- verify_step.expected: exit 0, zero falhas/skips; evidência ligada à revisão.
- verify_step.on_failure: diagnosticar e corrigir; causa desconhecida bloqueia task.

# H4 — Pré-condição de execução de engenharia

Mode: Loop.
Objective: comprovar a fronteira antes de executar programas de tarefa (ADR-0040).
Production outcome: ainda pendente; diagnóstico não concede autoridade nem ativação.
Scope: candidato isolado; comandos fixos de canário Node/Python, sem providers reais.
Mini-goal: tornar reproduzível pelo CLI a prova de escrita descartável sob lockdown.
Acceptance criteria: arquivo confirmado pelo supervisor; nenhum aceite por exit 0 ou
texto isolado; ausência de backend/runtime, timeout, saída inválida ou efeito ausente
bloqueiam; regressões e gates completos. Nenhum perfil ativo alterado.
verify_step: testes de sandbox e diagnóstico real; resultado real deve refletir os
artefatos observados, mesmo quando bloqueado. Não exigir sucesso artificial do host.
Authority: aprovação explícita do proprietário ao ADR-0040 em 2026-09-20.
Risks/rollback: nenhuma seleção do executor; remover diagnóstico descarta o candidato.
Stop condition: backend adotado não comprova fronteira, conforme ADR-0040.

## Discovery and reuse

Baseline a8423081934d64538d71ef8289f072d51566a870. Grafo consultado:
.enterprise/governance/capabilities/{registry.yaml,fragments/enterprise-hseos.yaml,
reference-corpus.json}; não há nesses arquivos contrato de execução de engenharia.
Reutilizados resolver e construtor de argumentos em tools/cli/lib/sandbox.js.
packages/agent-isolation-attestation oferece conformance bwrap, não um executor
arbitrário ativado. Não duplicar ledger/kernel nem promover diagnóstico a esse papel.
Axon indisponível (índice vazio na descoberta inicial); inspeção direta declarada.
Governança global e AEW: descoberta preservada em H1; ativação não inferida.

## Frozen distinction

- Engenharia: diagnóstico candidato; contrato/executor completo ainda pendentes.
- Providers/consumidores reais: não executados; bindings e orçamento pendentes.
- Operação: nenhuma ativação, merge, publicação ou alteração de controles.

## Observed boundary and next decision

Public engineering-check: both runtimes execute, reports parse, protected sibling
marker hidden and unchanged, workspace effects absent; exit 2, ready=false.
An additional direct fixed Python canary reported errno 30 (EROFS).
Lockdown with explicit rw-map remains read-only on ai-jail 1.20.0. No fallback used.
Existing bwrap attestation regression: 6/6 passed with actual sandbox processes.
That package is a conformance journey, not a task executor; no admission inferred.

ADR-0040 requires: “Se ele não comprovar essa separação para código arbitrário e
descendentes, falhar fechado e apresentar nova decisão”. ADR-0041 proposes extending
the existing bwrap capability for the code executor, keeping the current ai-jail
supervisor and broker. Exact resumption action: owner approves/revises ADR-0041,
or supplies an adopted backend revision whose lockdown profile permits the scoped
workspace while preserving the required boundary. Then implement the isolated
executor and complete all ADR-0040 conformance gates before real runs.

No model/provider calls, secret resolution, merge, publication or activation occurred.
The two-family/18-run campaign still needs explicit bindings and finite budget.

## Verification

Sandbox regression 7/7; diagnostic 10/10; real bwrap conformance 6/6.
Full worktree-manager validation passed: 0 failures, 1 historical warning.
Evidence and digests: ../evidence/harness-engineering-candidate/result.json.
The actual ai-jail prerequisite remains blocked; passing tests do not reverse it.
Native Husky shims are absent in task worktrees; full gates, branch guard and
commit-message validation invoked explicitly. No hook disabled or reconfigured.

Independent authorized continuation: H5 validates task contracts without executing
code; it does not depend on the pending executor-boundary decision.

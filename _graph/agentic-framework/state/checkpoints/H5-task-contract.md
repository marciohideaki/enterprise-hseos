# H5 — Contrato de tarefa sem execução

Mode: Loop.
Objective: validar contratos versionados de engenharia antes de criar sessões/efeitos.
Mini-goal: CLI agent validate-task, somente leitura, independente do backend bloqueado.
Authority: ADR-0040 aprovado explicitamente pelo proprietário nesta sessão; registro
aceito no task/harness-engineering-candidate. Não habilita execução ou políticas.
Acceptance: schema estrito; SHA de fontes/conteúdo; fontes/requisitos/aceite ligados;
escopo finito de paths relativos; comandos exatos Node/Python; orçamento de sessão
reutilizado; verificador externo referenciado; rollback descartável; nenhum efeito
ou provider; testes negativos, compatibilidade CLI e gates completos.
verify_step: testes de contrato e CLI real; artefatos inválidos rejeitados antes de
sessão/banco/provider; conteúdo de fontes não aparece como instrução privilegiada.
Production dimensions: contratos/segurança/compatibilidade; operação ainda pendente.
Rollback: remover validação candidata, nenhum store real criado ou migrado.

## Reuse and scope

Baseline a8423081934d64538d71ef8289f072d51566a870. Grafo e corpus consultados em H4:
.enterprise/governance/capabilities/registry.yaml, fragments/enterprise-hseos.yaml e
reference-corpus.json. Extensão da CLI kernel, reutilizando AgentLimitsSchema,
IdentifierSchema, strictObject, deepFreeze e canonicalJson; sem outro ledger/kernel.
O contrato descreve dados de tarefa; não concede autoridade, não detecta contradição
semântica automaticamente, não executa comandos e não atesta o verificador externo.
Execução/snapshot de tarefas permanece pendente da decisão de fronteira ADR-0041.

## Verification and boundary reassessment

Contract/CLI tests: 36/36; full gates: 0 failures, 1 historical warning.
Evidence: ../evidence/harness-task-contract/result.json.
Native Husky shims absent; full validation, branch guard and commit-message check
are invoked explicitly, without disabling hooks.

H4 establishes only that the host-mounted workspace is read-only. An actual fixed
ai-jail lockdown Python probe subsequently created /tmp/candidate-*/effect inside
the private jail and read back private-write-canary, exit 0. Thus the broader
backend-incapability inference is withdrawn. ADR-0041 remains an unadopted proposal;
its approval is not presently established as necessary. Continue proof using the
existing private-workspace/snapshot mechanism before requesting another boundary.
No claim of arbitrary-code isolation follows from this write probe.

Next mini-goal: H6 verifies separation of a private executor jail from worker/broker
controls while retaining the adopted ai-jail lockdown backend and current authority.

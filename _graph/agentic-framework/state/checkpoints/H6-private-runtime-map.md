# H6 — Visibilidade do runtime privado no supervisor

Mode: Loop.
Objective: restabelecer o mount somente leitura do runtime/broker privado que o
supervisor já declara, sem ampliar maps configuráveis ou habilitar execução arbitrária.
Mini-goal: sandboxWithBrokerMap deve mapear exatamente a fixture privada selecionada.
Evidence map: ADR-0012 restricted-egress; bound-kernel-supervisor.js; testes existentes
usam backend fixture que executa diretamente, portanto não provam mount real.
Authority: correção reversível dentro do supervisor existente; ADR-0040 candidato.
Acceptance: prova real falha antes/passa depois para node copiado; apenas map ro
interno exato; configuração externa de host maps continua rejeitada; gates completos.
verify_step: regressão unitária de argumentos + probe real obrigatório nesta tarefa,
sem endpoint/provider/secret; preserve evidência quando o backend não está disponível.
Rollback: reverter correção candidata; nenhuma configuração global/controle alterado.

H4 limitava-se a bind do host, não a /tmp privado: escrita interna real comprovada
em H5. Não inferir necessidade de ADR-0041 dessa limitação. Antes de ferramentas de
engenharia, corrigir o caminho de isolamento já aprovado e registrar a evidência.

## Blocked result — acceptance not achieved

Actual probe before patch: runtime_visible=false, exit 2. Candidate internal ro-map
patch: runtime_visible=false, exit 2; runtime reported ENOENT. Dry-run of the
installed ai-jail 1.20.0 did not include the explicit map. One failed correction;
no second blind attempt and no weaker profile. Functional edits reverted exactly;
rejected diff and result are preserved under ../evidence/harness-private-executor/.

The private /tmp write/read probe passed. H4's broad backend-incapability inference
is withdrawn; its host-bind observation remains valid. This new observation is
limited to runtime/broker visibility in the existing supervisor. No production
readiness, real-provider success or operational authority is inferred.

ADR-0041 here contains the revised, reviewable proposal and the alternative of a
governed provider revision/profile. It remains Proposed. Approval of ADR-0040 did
not authorize changing active controls or silently substituting the backend.

Engineering delivered: H4 96548e3 (17 sandbox tests plus 6 real bwrap conformance),
H5 868dd790 (36 contract/CLI tests). Each passed full gates, 0 failures/1 historical
warning, and remains in its isolated unmerged task worktree. H1 92dd027 and H2
deecfcf also remain independent and unmerged. H6 fix is not delivered or accepted.

Real providers/consumers: not executed; bindings and finite budget remain required.
Operational activation: not authorized, G9/A13 unchanged. Native hook limitation
and explicit gate evidence are preserved in H4/H5. No global policy/config changes.

Exact resumption: select the reviewed boundary in ADR-0041 or provide an adopted
backend/profile revision proving exact runtime/broker visibility and isolation.
Then rerun this probe, implement the executor on the same kernel/ToolRuntime, and
complete ADR-0040 acceptance. This is a security/architecture decision under the
approved ADR-0040 stop condition, not a request to approve a missing test result.

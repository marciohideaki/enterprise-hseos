<!-- G2: aprovado pelo owner em 2026-10-27 (ExitPlanMode) -->
# Plano — correção dos achados da auditoria de conformidade W0–W5 (2026-10-27)

## Context

A auditoria de 2026-10-27 (`/build/tmp/CONFORMIDADE-W0-W5-2026-10-27.md`, base `f96c6e9c`) reprovou o agregado W0–W5. A causa principal não é comportamento quebrado: a suíte inteira passa (102/102 itens, 3827 testes). O que reprova é:
- o CI não protege parte do código: 9 arquivos de teste nunca rodam, e os gates de mutação W4/W5 falham por construção;
- o envelope MCP vaza dados (`data.issues` no adaptador 2026, `error.message` no transporte legado);
- a redação deixa passar corpo de chave em linha única;
- a documentação diverge da realidade.

**Escopo decidido pelo owner (2026-10-27):**
- Corrigir todos os itens do Commander e as decisões de owner com os padrões recomendados.
- **A-02:** em `issues`, a entrada expõe só `keyword` e `instancePath`; a saída não traz detalhe.
- **A-06:** manter o `detail.code` próprio do H-7 e registrar o aceite.
- **A-12:** o rollback recusa receipt ausente salvo flag explícita. É um padrão recomendado e entra salvo veto na aprovação deste plano.

**Fora:** ADRs 0042–0045, conjunto do c8 (A-09), semântica de `operational` (A-07), sunset, `env: {}` no supervisor (A-16), corpos de PR antigos (A-17), distribuição global (A-18).

## Execution Protocol

- **Modelo de coordenação:** skill `dev-squad` sob SWARM (ADR-0015; fonte `.enterprise/governance/agent-skills/dev-squad/SKILL.md`).
  - O **Commander** é esta sessão, em Opus: planeja, extrai handoffs, revisa e consolida.
  - O **Squad** são executores `model: "sonnet"`, 1 por task, cada um em worktree próprio.
  - O **revisor cético** é um agente `sonnet` isolado por task, em duas passagens (cega e depois confronto). Ele reporta e não corrige; no máximo 3 rodadas de correção.
- **Run dir:** `.hseos/runs/dev-squad/20261027-HHMM-audit-fixes/`, com `INTAKE`, `PLAN` (marcador G2), `STATUS`, `prompts/COMMON.md` (derivado de `20261023-pendencias-w0-w5/prompts/COMMON.md`), `prompts/T*.md`, `logs/T*.md` e `WAVE-k-REPORT.md`.
- **Invariantes de governança:**
  - Tasks em `.worktrees/<task-id>` via `scripts/governance/worktree-manager.sh create`; 1 task = 1 commit em `task/<id>`, mergeado na feature da onda.
  - Commits pelo `commit-in-cgroup.sh` com o hook ativo. Sem `--no-verify`, sem stash, sem push pelo executor.
  - Mensagem sem atribuição de IA e sem `Co-Authored-By` (sobrepõe o harness); corpo de PR limpo.
  - **G3 sem folga:** nenhum arquivo novo em `tools/` (393) nem `packages/` (137). Arquivos novos só em `test/` e `.github/`.
  - Gates (c8 90/80, G3, branch protection) nunca afrouxados. Bloqueio vira BLOCKED, nunca PASS.
  - Recibos históricos de `docs/evolution/**/evidence/` não são reescritos.
  - Scratch em `$TMPDIR`; nunca `/tmp` literal.
  - Carga pesada com `uptime` antes e `heavy-run` (ou `run-in-cgroup.sh`), um job pesado por vez, no máximo 3 executores por onda (o `flock` do heavy-run serializa). A suíte completa só roda pelo Commander, uma vez por onda.
  - Nunca `pkill -f`; só PIDs próprios.
- **Gates humanos:**
  - G2: aprovação deste plano via ExitPlanMode.
  - G4: o Commander abre a PR com `gh pr create`, corpo pelo template.
  - G5: merge **só com autorização explícita do owner**, por squash com corpo limpo (`--match-head-commit`), seguido de `gh pr update-branch --rebase` nas PRs seguintes (proteção `strict`).
- **Versionamento por onda:** feature `feature/audit-fix-w<k>` a partir de `master`, uma PR por onda. As três ondas são independentes em arquivos, então não há cadeia empilhada; ordem de merge W1 → W2 → W3. Depois de cada merge: tag `hseos-audit-fix-w<k>` no commit da master, `STATUS` da run atualizado e o mapa (MAPA §8, criado em T7) atualizado.

| Onda | Tasks | Executor | Tier | Revisor |
|---|---|---|---|---|
| W1 | T1 CI, T3 MCP, T4 redação | Sonnet ×3 | T1 medium, T3 large (segurança, +1 tier), T4 large (redação, +1 tier) | Sonnet cético por task |
| W2 | T2 gates de mutação, T5 H-4 e lock, T6a rollback | Sonnet ×3 | medium, medium, medium (+1: integridade) | idem |
| W3 | T6b swarm, T7 docs e reconciliação | Sonnet ×2 | medium, small | idem |

## Tasks

### W1

**T1. CI cobre todos os arquivos de teste (A-01, G-A2).** Arquivos: `package.json`, `.github/scripts/ci-test-shards.mjs`, `.github/workflows/ci.yaml`, `test/test-ci-light-hook.js` e, se preciso, `.github/scripts/ci-test-shard-weights.json`.
- Incluir os 9 arquivos nos scripts existentes:
  - `test-install-lock.js` em `test:install`;
  - `test-pids-max-single-source.js` em `test:agent-transitive-isolation`;
  - `test-environment-production-callers.js`, `test-w5-environment-ledger.js`, `test-environment-journey.js` e `test-toolchain-zip-streaming.js` em `test:engineering-task`, reavaliando o peso 686;
  - `test-platform-bindings-downgrade.js` em `test:platform-bindings`;
  - `test-bound-kernel-state-snapshot.js` em `test:bound-kernel-agent`;
  - `agent-core-compile-check.test.js` em `test:compiler-hooks` ou `test:verify` (conferir que o script já está na cadeia).
- Em `verify()` (`ci-test-shards.mjs:70-88`), antes de `if (problems.length > 0)`:
  - expandir recursivamente os `npm run X` dos itens;
  - falhar com `not run by any suite step: <file>` para cada arquivo rastreado que case os padrões de `is_test_file` de `scripts/governance/quality-gates.sh:202-211` (excluindo `test/fixtures`, `test/helpers` e `test/journeys`) e não apareça no texto expandido.
  - Exceções só por `.github/scripts/suite-test-allowlist.json`, que começa vazio e exige motivo, no mesmo modelo de `suite-orphan-allowlist.json`.
- Casos novos em `test-ci-light-hook.js`: verify OK no repo real; verify falha com um arquivo de teste não referenciado (fixture em diretório temporário); allowlist sem motivo é recusada.
- `ci.yaml`, job `test`: passo inicial que falha se `needs.plan.result != 'success'`. Isso fecha a hipótese de `fromJSON('')`.

**T3. Envelopes de erro MCP (A-02, A-03).** Arquivos: `tools/lib/mcp-2026-adapter.js`, `tools/lib/mcp-transport.js`, os throw sites de `tools/mcp-project-state/{index.js,tools/handoffs.js,tools/runs.js}`, testes e `docs/v4-migration.md`.
- **Adapter:**
  - entrada (`:859-863`): `issues: errors.map(({keyword, instancePath}) => ({keyword, instancePath}))`;
  - saída (`:941-946`): sem `issues`, só `{ issue_count }` ou `data` omitido; o executor escolhe e o teste fixa.
  - Teste com `additionalProperties:false` e `enum`: `deepEqual` do `data` e `JSON.stringify(response)` sem o valor nem o nome da chave enviados.
  - Estender o teste `:317` com um resultado contendo um segredo sintético e afirmar que ele não aparece.
  - A mutação M3 (o `result` inteiro em `issues`) passa a ser morta.
- **Transporte legado:**
  - `respondSafely` (`:57`) e o catch (`:205`) só repassam `error.message` quando `error.code` está numa allowlist de códigos autorais: `MCP_TOOL_UNKNOWN`, `MCP_SCOPE_DENIED`, `TASK_NOT_FOUND`, `AXON_*`, `MANAGED_GOVERNANCE_*`, `EXECUTION_ACTIVATION_*` e os novos do project-state. Qualquer outro erro vira mensagem fixa (`Internal error` / `Tool failed`), com o stack no stderr, no padrão de `internalErrorResponse` do adapter (`:231-234`).
  - Dar `code` aos `throw new Error` autorais do project-state (`index.js:109,121,124`, `handoffs.js:54`, `runs.js:54`), mantendo o texto.
  - Teste novo em `test-mcp-transport-robustness.js`: uma exceção com caminho e segredo sintético não chega ao cliente; mensagens autorais continuam iguais.
  - `test-mcp-contract.js:1232,1247,1334` e `swarm-scope` continuam verdes sem edição de asserção.
- `docs/v4-migration.md` (§ "MCP argument validation", `:104-121`): bullets novos para o formato de `issues` e para mensagens genéricas no legado.

**T4. Redação de corpo de chave (A-05).** Arquivos: `tools/cli/lib/campaign-evidence-store.js`, `provider-campaign-process.js`, `engineering-task-runtime.js` e `platform-bindings.js`, mais testes.
- Mover `classify` e `redactKeyBodies` de `provider-campaign-process.js:22-101` para `campaign-evidence-store.js` e exportá-las sem alterar `containsCredential`. `provider-campaign-process.js` passa a importar dali (`clipText` mantém a assinatura).
- **Regra nova de linha única:** um token base64 de 40 ou mais caracteres que comece por prefixo DER ou OpenSSH de chave privada é redigido. Prefixos: PKCS8 Ed25519 `MC4CAQ`, PKCS8 RSA `MIIE…IBADAN`/`MIIJ…`, PKCS8 EC `MIGHAgEA`, SEC1 `MHcCAQEE`, PKCS1 `MIIEowIBAAKCAQEA`/`MIIEpA…`, OpenSSH `b3BlbnNzaC1rZXktdjE`. Os prefixos exatos são derivados de chaves geradas no próprio teste. Assim digests como `sha512-…` e hashes não são afetados.
- Aplicar a redação ao stderr da sonda (`engineering-task-runtime.js:525`), a `evidenceMessage` (`:812`) e ao stderr do git em `platform-bindings.js:758,764,772,849,1010`. Antes, confirmar que o import de `campaign-evidence-store` não cria ciclo.
- Atualizar o comentário de limites (`provider-campaign-process.js:35-39`).
- **Testes em `test-campaign-key-body-redaction.js`:**
  - chaves geradas em memória com `generateKeyPairSync` (ed25519, rsa 2048, ec P-256, mais uma OpenSSH): multilinha, linha única e `\n` literal, todos redigidos;
  - controles negativos existentes (`:115-166`) intactos, inclusive `sha512-<86>` e `row(64)` de `:154-159`; ajustar só se o prefixo casar de verdade, com justificativa;
  - um caso por site novo (git stderr, probe stderr);
  - mutação: remover a regra de linha única precisa derrubar um teste.

### W2

**T2. Gates de mutação deixam de falhar por construção (A-04).**
- Extrair os arrays para `test/fixtures/w4-mutation-cases.cjs` e `test/fixtures/w5-mutants.cjs` (fora do tarball). `test-kernel-mutations.js` e `test-w5-mutations.js` passam a importá-los.
- `check-w4-mutations.js` e `check-w5-mutations.js` derivam o esperado do módulo de dados (`cases.length`; `MUTANTS.length + 1` por causa do teste de grupo) e exportam uma função pura `checkTap(stdout, expected)`.
- Testes dessa função em `test/test-kernel-quality-surface.js` (já na cadeia): TAP com todos aprovados passa; um a menos, um skip ou um fail reprovam. O esperado é igual ao tamanho dos módulos.
- Atualizar só o texto vivo que cita as contagens (STATUS/PLAN); recibos ficam intactos.
- Rodar os dois checkers no cgroup: exit 0.

**T5. Mutantes sobreviventes do controle e do lock (A-11, A-15).**
- Teste em `test/test-engineering-control.js` com `admission:false` + binding + `max_tokens` abaixo do piso, usando o helper `bindingFile` (`:~628`) e o caminho de `:560-592`. Ele mata o mutante `engineering-control.js:363`. Fazer o mesmo para o irmão `:390` em `test-engineering-plugin-model.js`.
- Lock em `installer.js:291-392`:
  - teste que mede a latência da recusa com holder vivo (recusa imediata, bem abaixo dos ~2 s de `attempt>=200`), matando o mutante C;
  - teste da janela de lock vazio ou meio escrito (`readLockHolder` `:47`);
  - mover o `ensureDir` (`:297`) para depois da aquisição, se o lock não precisar dele antes; senão registrar o motivo;
  - corrigir a corrida do takeover do mutex velho (`:71-72`), por exemplo com `rename` atômico do mutex velho para um nome único antes de remover, e cobri-la com teste.

**T6a. Rollback exige receipt (A-12).**
- Em `operational-state-db.js:727-748`: receipt ausente ou sem `original_sha256_before` lança `EXECUTION_ACTIVATION_RECEIPT_REQUIRED`, salvo `allowMissingReceipt: true`.
- Na CLI (`agent-activation-rehearsal.js:60-102`): flag `--allow-missing-receipt` e `--receipt <path>` (hoje a CLI nunca passa `receiptPath`).
- Testes em `test-execution-ledger-activation.js`:
  - receipt removido → recusa;
  - com a flag → restaura, e a saída JSON registra `receipt_verified:false`;
  - `--receipt` explícito.
- Os casos `:197`, `:228`, `:278` e `:500` seguem verdes.
- Atualizar `docs/evolution/runbooks/activation.md` (passo de rollback) e `docs/v4-migration.md`.

### W3

**T6b. Swarm: escopo por fd e falso verde do teste (A-08, A-10).**
- Em `run-scope.js`:
  - `mkdirContained(base, dir)`: abre o ancestral existente com `O_DIRECTORY|O_NOFOLLOW`, valida o realpath do fd e cria cada componente via `/proc/self/fd/<fd>/<name>`, reabrindo e revalidando, com `hooks.afterCheck`;
  - `readdirContained`.
- Usar os dois em `plan_squad.js:61`, `consolidate_handoff.js:64`, `get_run_state.js:27` e `list_runs.js:21-23`. Fora do Linux, manter o comportamento atual (declarado).
- Em `test-mcp-hseos-swarm-scope.js`:
  - `finally` (`:480-483`, `:668-671`) só aguarda `exit` se `child.exitCode === null && child.signalCode === null`, e um servidor que morre no boot passa a reprovar com exit 1;
  - casos novos "ancestral trocado durante o mkdir" e "readdir de diretório trocado por symlink";
  - mesmo padrão revisado em `test-mcp-hseos-swarm.js:201`.

**T7. Docs e reconciliação (A-06, A-13, A-14, A-19, A-20, decisões).**
- `pendencias-w0-w5/MAPA.md`:
  - corrigir §1 (Decision 0006 do ECP Accepted), §2 (M09), §3 (20 aceitos), §6 (receipt, K9, `pids_max`, linhas `:1102` e `:363`, swarm-scope);
  - registrar as decisões do owner de 2026-10-27 (A-02 filtrado; H-7 `detail.code` aceito; A-12 receipt obrigatório);
  - nova §8 "Auditoria de conformidade 2026-10-27", com os achados, as tasks e as PRs que os fecham, e os itens que seguem com o owner.
- `PLAN.md:112-117`: retirar as pendências fechadas (apply, K9) e citar o relatório.
- `CHANGELOG.md:37`: frase precisa sobre o snapshot do ECP.
- `.hseos/runs/dev-squad/20261020-w5-closeout/STATUS.md`: linhas "em execução" de trabalho mergeado.
- `.hseos/runs/.../20261023-pendencias-w0-w5/STATUS.md`: "tags locais" → remotas.
- Copiar o relatório da auditoria para `docs/evolution/audit-2026-10-27/CONFORMIDADE-W0-W5.md`, como fonte citável.
- Não tocar em `requirements.json.operational` (decisão de owner aberta), mas registrar a pendência.

## Verificação

- **Por task:** testes vermelhos primeiro, porque eles provam o defeito. Depois o conserto, e a mutação dirigida do requisito precisa ser morta. Cada teste roda por arquivo via `heavy-run`/`run-in-cgroup.sh` com Node 24, junto com `eslint --max-warnings=0`, prettier e `node --test test/test-package-surface.js` (G3).
- **Por onda (Commander):**
  - `uptime`, depois uma suíte completa no cgroup com `node .github/scripts/ci-test-shards.mjs verify --shards 6` e `run --shards 1 --shard 1`; tudo verde e sem órfão;
  - `node scripts/governance/check-w{4,5}-mutations.js` com exit 0 (a partir da W2);
  - as reproduções dos achados do relatório (§4) agora falham do lado certo: `issues` sem nome de chave, legado sem `error.message`, chave em linha única redigida, rollback sem receipt recusado.
- **Revisor cético por task:** passagem cega contra a task e os critérios; depois confronto com o relatório do executor.
- **Pós-merge:** CI verde na PR e na master. Disparar `gh workflow run CI` (`workflow_dispatch`) para ter a suíte Node 22 completa com o M-10 (A-14) e conferir o resultado do supervisor.
- **Fechamento:** `git status` limpo no checkout principal; worktrees e branches `task/*` removidos pelo `worktree-manager`; `vault: atualizado` somente com o veredito do owner.

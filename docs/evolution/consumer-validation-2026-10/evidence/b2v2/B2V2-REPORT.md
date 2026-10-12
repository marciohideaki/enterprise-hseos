# B2V2 - reexecução da bateria B2 com o harness corrigido

Harness: `hseos` 4.0.0-rc.0 de `/tmp/hseos-crp/final/pack/hseos-4.0.0-rc.0.tgz` (sha256 `8a126fc1d7d831f7296a0b72439d21c812500877b8ad48420f5ad033d174498a`, branch `fix/harness-consumer-findings` df8bae8a), instalado offline em `/tmp/hseos-crp/b2v2/hseos`. Clone novo `/tmp/hseos-crp/b2v2/repo` de `cambio-real-platforms` (develop `5befb33` no momento do clone), pacote alvo `packages/formatting`. Sem despacho a modelo real. Mesma infraestrutura da B2 (serve em cgroup delegado, `heavy-run`, `--filter`, `--maxWorkers=2`, nada na raiz do monorepo). Baseline no host: install offline 0,7 s, vitest 32/32, `tsc` limpo.

Resultado: 17 passos, **16 PASS, 1 BLOCKED (esperado, A1), 0 FAIL** na última execução (`ev/run-t1-v2-t2-t3.json`; o BLOCKED é `t3a`, terminal com vitest). Load1 máximo amostrado 1,57; 0 processos residuais; 0 segredos na evidência.

## Antes -> depois

| Achado | Antes (B2) | Depois (B2V2) | Evidência (`ev/`) |
|---|---|---|---|
| **A2** exit_code não afeta aprovação | filho `vitest` com `exit_code 1` terminou `approved` | `verifier.command_checks` + `protected_paths`: ver detalhe abaixo; semântica antiga preservada sem `command_checks` | `steps/v2-*.json`, `task-v2*.json` |
| **A3** `/events` de workflow criado por job | 1ª página vazia (limit 100/200), eventos só após 3-9 páginas vazias | 1ª página (limit 100) traz os 59 eventos; caminhada com limit 7 (10 páginas) == leitura completa, posições únicas e crescentes | `steps/t2-job-dag.json` (`a3`) |
| **A4** `/evidence` sem `evidence[]` | ausente no workflow criado por job | `evidence[]` com 2 etapas (`typecheck`, `vitest`: approved) | `steps/t2-job-dag.json` (`a4`) |
| **A5** erros opacos | tudo `CONTROL_REQUEST_REJECTED` | `detail.code` por causa (lista abaixo). Resíduo: ver N1 | `steps/t1-negative-prepare.json`, `t1b`, `t1e` |
| **A6** negação de escopo | `EXECUTION_INPUT_INVALID` | `ENGINEERING_SCOPE_DENIED` nas 6 tentativas (HEAD, árvore e repo real intactos). A mensagem ainda diz "input does not match schema v1" | `steps/t1d-out-of-scope-denied.json` |
| **A1** executor não roda pnpm/vitest/tsc | BLOCKED | continua BLOCKED, como previsto (W5): `ERR_MODULE_NOT_FOUND 'vitest'`; ver N2 | `steps/t3a-*.json`, `v2-c` |
| A7, A8, A9 | abertos | não re-testados (fora desta rodada) | |

### A2 em detalhe (command_checks)

| Caso | Resultado | Registro |
|---|---|---|
| Script node protegido `check.mjs` (asserts de `parseAmountInput`), com a correção | **approved** | `command_checks: [{accept, succeeded, exit_code 0}]` |
| Mesmo contrato sem a correção; saídas do verificador passam, o command_check sai 1 | **failed / criteria-not-satisfied** | `[{accept, failed, exit_code 1}]` |
| Controle: mesmo comando falho, sem `command_checks` | approved (exit 1 é só diagnóstico) | compatibilidade preservada |
| `command_check` = vitest do pacote (`index.test.ts` no executor) | **failed / criteria-not-satisfied, nunca approved** | `[{vitest, failed, exit_code 1}]`, causa `Cannot find package 'vitest'` |
| `command_check` = `tsc` (`_tsc.js`) | recusado em `prepare` | `PROJECT_PATH_INVALID` (ver N2) |
| Workflow: filho com command_check falho | `first` failed, `second` **not_executed**, workflow `failed` | `steps/v2-e-*.json` |
| Ataque: `engineering.patch` e `engineering.write` no script protegido | `ENGINEERING_SCOPE_DENIED`, tarefa failed, script intacto | `steps/v2-d-*.json` |
| Contrato recusado em `prepare`: script em `scope.write`; sem `protected_paths`; `protected_paths` sem o entrypoint; argumento = caminho gravável; `--target=<gravável>`; `--target=../../outside` | 6 de 6 recusados (controle válido aceito) | ver N1 |

### A5 em detalhe (`detail.code`)

symlink `PROJECT_FILE_UNSAFE` (com `path`); hardlink sintético (nlink 2) `PROJECT_FILE_UNSAFE`; texto de 2 MB `PROJECT_FILE_TOO_LARGE`; binário `PROJECT_FILE_NOT_UTF8`; `.github/...` e `../x` `PROJECT_PATH_INVALID` (com `field: scope.read[1]`); `review` de tarefa não aprovada `PROJECT_RESULT_NOT_APPROVED`; `apply` com baseline vencido `PROJECT_APPROVAL_STALE` ou `PROJECT_CHANGED_BEFORE_APPLY` (aceito qualquer um dos dois; o passo registra o real). `error.code` continua `CONTROL_REQUEST_REJECTED` (compatível).

## Regressão 1a-1e, jobs e terminal

1a correta+apply+vitest real 32/32, 1b incorreta rejeitada (vitest real reprova o candidato), 1c rejeição->diagnóstico->correção, 1d escopo, 1e edição concorrente: todos PASS, como na B2. Jobs: DAG por job, workflow direto, cancelamento com drenagem (0 órfãos em `/proc` e no cgroup): PASS. Terminal pty genérico (attach, resize, cursor, terminate, 0 residuais): PASS.

## Novos achados desta rodada

**N1 - Baixa - Recusas por regra cruzada do contrato continuam opacas.** As seis recusas de `command_checks`/`protected_paths` (e as demais regras de `parseEngineeringTask`) chegam pela API só como `CONTROL_REQUEST_REJECTED`, sem `detail`; a causa só aparece chamando a biblioteca (`scripts/prepdebug2.mjs`: `ENGINEERING_TASK_CONTRACT_INVALID` genérico). A doc promete `PROJECT_SCOPE_INVALID` com `field` para contrato v2 recusado em `prepare`, o que só vale para campos de caminho. O controle (contrato válido) é aceito, então as recusas não são vacuosas.

**N2 - Média (correção da B2, A1) - O virtual store do pnpm é inexpressível no escopo por causa do `@`.** Na B2 atribuí a recusa de `.pnpm/typescript@5.9.3/.../tsc.js` e `_tsc.js` a hardlink e tamanho; com `detail` agora visível a causa real é `PROJECT_PATH_INVALID`: o regex de caminho não aceita `@`, e todo diretório de `node_modules/.pnpm/<pacote>@<versão>` o contém. Hardlink e tamanho foram então provados separadamente com arquivos sintéticos (`PROJECT_FILE_UNSAFE`, `PROJECT_FILE_TOO_LARGE`). A conclusão da A1 se mantém e fica mais forte: além de symlink/hardlink/64 arquivos/1 MiB, o próprio nome dos diretórios do pnpm impede incluí-los. Para a W5, o aceite do projeto real exige outro caminho (por exemplo, runtime/depêndencias do projeto montados fora do escopo de texto).

## Limites desta rodada

- `command_checks` foi provado com um script node autocontido, não com o vitest/tsc do projeto (impossível no executor, ver N2). O risco transitivo documentado (arquivos importados por um command_check que estejam em `scope.write`) não foi testado.
- A edição concorrente (1e) continua sendo após a aprovação.
- Higiene: o `git status` no repo real (snapshot antes/depois) mexe só no mtime de `.git`; o repo real teve `HEAD` avançado por um `pull --ff-only` externo (reflog) durante a sessão, não por este trabalho. O link de registro do pnpm no store compartilhado (`/tmp/.pnpm-store/v11/projects/2ba3bc43...`) foi removido ao final.

Reproduzir: `scripts/setup.sh`, `scripts/prep.mjs`, `scripts/run.mjs --steps t1,v2,t2,t3` (arquivos sintéticos no `repo`: `blob.bin` não-UTF8, `big.txt` de 2 MB, `hl-src.ts`+`hl.ts` hardlink).

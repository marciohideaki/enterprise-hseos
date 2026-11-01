# F23 — evidência de governança de engenharia (2026-11)

Recibo da lacuna da F23 em `docs/evolution/requirements.json` ("Cobertura mínima 90/80 e mutação das decisões precisam de evidência"). Este documento não promove a família: o `requirements.json` não foi alterado e a promoção cabe ao Commander.

Base: `master` em `7cf336b7`, branch `task/pw-a4-f23-surfaces`, Node v24.15.0. Datas em UTC (`date -u`).

## 1. Gate de cobertura c8

- Configuração: `.c8-kernel.json` (`all: true`, `check-coverage: true`, `per-file: true`, `lines: 90`, `branches: 80`; exclui `**/node_modules/**` e `test/**`).
- Conjunto: 102 entradas em `include`, que expandem para 141 arquivos no worktree. Contagem por superfície e extensão:

| Superfície                               | Extensão | Arquivos |
| ---------------------------------------- | -------- | -------- |
| `packages/`                              | `.js`    | 54       |
| `tools/`                                 | `.js`    | 84       |
| `.agents/hooks/handlers/`                | `.cjs`   | 1        |
| `.enterprise/governance/hooks/handlers/` | `.cjs`   | 1        |
| `docs/evolution/w5/`                     | `.mjs`   | 1        |

- Comando do gate: `npm run test:kernel-coverage` (`c8 --config .c8-kernel.json npm run test:kernel`). Variante só de medição: `test:kernel-coverage:measure`.
- Medição histórica (não é do conjunto atual): `docs/evolution/revalidation-2026-10/verification-receipt.json`, blocos `final4/kernel-coverage-node24` e `final4/kernel-coverage-node22`, cabeça `1ae317c0`, 2026-10-10: `exit_code: 0`, 96,86% linhas, 90,26% branches, "90/80 approved, 0 files below". Aquele gate cobria 41 entradas de `include` e 73 arquivos, e não os 102 entradas e 141 arquivos de hoje.
  - Log: `evidence/final4/kernel-coverage-node24.log.gz`. O sha256 `6d2ff28f1bd4c34687e7d3d41596524b9ebd1e18d52f1700172df1f8a1d3e543` é do log descompactado (`zcat ... | sha256sum`); o sha256 do arquivo `.gz` é `8f0df789dcaff72daabcc199e77362fe5d52c7287ce2be2f78cdbdab1e40d16a`.
- Medição atual do conjunto de 141 arquivos: não há medição verde registrada no repositório. Esta task não reexecutou o `test:kernel` completo, por restrição de carga do host. Ver §Medição atual.
- Menores margens conhecidas de branches (`docs/evolution/audit-2026-10-27/CONFORMIDADE-W0-W5.md`): `engineering-model.js` 80,95 e `plugin.js` 81,01.

## 2. Matrizes de mutação

Executadas nesta task pelo cgroup (`/build/tmp/pre-w6/bin/cg.sh`), em 2026-11-01T02:25Z, a partir do worktree:

| Matriz | Comando                                         | Resultado                                                      | Exit |
| ------ | ----------------------------------------------- | -------------------------------------------------------------- | ---- |
| W4     | `node scripts/governance/check-w4-mutations.js` | `W4 mutation matrix: 20 rejected, 0 failed, 0 skipped`         | 0    |
| W5     | `node scripts/governance/check-w5-mutations.js` | `W5 mutation matrix: 43 mutants rejected, 0 failed, 0 skipped` | 0    |

A contagem esperada é derivada da tabela de mutantes (`test/fixtures/w4-mutation-cases.cjs`; `test/test-w5-mutations.js`), e o verificador rejeita corrida curta, pulada, `todo`, falha ou sem relatório (`test/test-kernel-quality-surface.js`, testes "mutation gate").

## 3. Sonda de variável indefinida por superfície

Lacuna real, medida na base `7cf336b7`: `eslint.config.mjs` desligava `no-undef` e `no-unreachable` para `tools/**/*.js` e só os religava em `packages/**/*.{js,cjs,mjs}`. Os 84 `.js` de `tools/` estavam no gate c8 sem a regra ativa. Os dois `.cjs` de hooks e o `.mjs` de `docs/` já tinham as duas regras como erro, herdadas da base `js.configs.recommended`; nesses três arquivos nada mudou.

Mudança:

- `eslint.config.mjs`: o bloco de regras do kernel passou a valer para `packages/**/*.{js,cjs,mjs}` mais todas as entradas de `include` do `.c8-kernel.json`, lidas do próprio JSON. Um arquivo que entra no gate de cobertura passa a ter `no-undef` e `no-unreachable` como erro, sem lista paralela para manter.
- `test/test-kernel-quality-surface.js`: novo teste "undefined globals are detected on every kernel coverage surface". Para cada arquivo do conjunto, verifica a severidade 2 das duas regras. Para os `.cjs` e o `.mjs` o teste é proteção de regressão, não correção. Para cada par superfície/extensão (`packages|.js`, `tools|.js`, `.agents|.cjs`, `.enterprise|.cjs`, `docs|.mjs`), roda o ESLint em `missingKernelAuthority();` com o caminho real e exige `no-undef`. Falha se alguma entrada de `include` não casar nenhum arquivo, ou se faltar probe de `.js`, `.cjs`, `.mjs` ou de `tools/`. O glob é expandido por código próprio, porque `fs.globSync` é experimental no Node 22.
- O teste anterior (sonda em `packages/agent-runtime/quality-probe.js`) foi mantido.

Evidência:

- Vermelho, antes da config: `ℹ pass 11 / ℹ fail 1`, `AssertionError ... tools/cli/lib/engineering-control-http.js: no-undef  0 !== 2`.
- Verde, depois: `ℹ pass 12 / ℹ fail 0`.
- Mutação descartável: religar a config sem `...kernelSurfaces` em cópia (restaurada em seguida) derruba o teste com a mesma mensagem (`pass 11 / fail 1`).
- Lint dos 141 arquivos do kernel com as regras ativas: `node_modules/.bin/eslint --max-warnings=0 <include>` com exit 0, sem correção de código.
- `node .github/scripts/ci-test-shards.mjs verify --shards 6`: `OK 102 items ... 235 test files`, exit 0. `node --test test/test-package-surface.js`: 1 pass, 0 fail.

## 4. O que segue fora

- `tools/` tem 315 arquivos `.js` rastreados; 84 estão no gate. Os 231 restantes seguem com `no-undef` e `no-unreachable` desligados (config de CLI/legado). Estender isso a todo `tools/` exige varrer esses arquivos e é decisão separada; esta task não afrouxou nem ampliou além do conjunto do gate.
- Fora do gate c8 (e portanto do 90/80): ledger e banco da ativação conforme `audit-2026-10-27/CONFORMIDADE-W0-W5.md`, e os arquivos de `tools/` não listados em `include`.
- A medição c8 de 2026-11-01 não tem artefato no repositório (seção 1).
- `docs/evolution/W0-CLOSEOUT.md` cita três mutantes dirigidos; as matrizes W4 (20) e W5 (43) são as que o CI executa e estão acima.
- Evidência de operação real e consumidores reais da F23 não faz parte deste recibo.

## Medição atual

Medição de cobertura do conjunto atual do gate (141 arquivos), registrada pela suíte da onda WA (Commander).

PENDENTE-COMMANDER

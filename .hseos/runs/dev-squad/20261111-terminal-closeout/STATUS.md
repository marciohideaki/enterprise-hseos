# STATUS — run `20261111-terminal-closeout`

Commander: thread principal (Opus). Squad: Sonnet. Autorizações do owner: `INTAKE.md` (cópia literal da seção 1 do prompt; vale como registro da autorização de merge, `AGENTS.md` §9).

## Fase 0 — Preparo (2026-11-11)

- Pré-voo: ver `INTAKE.md`. `hseos activity check --session 20261111-terminal-closeout`: `check: ok`, sem eventos pendentes (sessão não registrada; aviso apenas).
- Linha de base de `requirements.json` reconferida por script (`node -e` sobre `families[].status`): 27 famílias; `deterministic` 21 verificadas e 6 `not_verified_for_evolution` (F07, F17, F24, F25, F26, F27); `real_consumers` 5 `verified_installed_local_scope_only` (F01, F11, F16, F20, F21) e 22 `not_verified`; `operational` `not_authorized` nas 27. Confere com a seção 4 do prompt.
- Orçamento por área (lido de `test/test-package-surface.js:133-143`): `.enterprise` 472, `tools` 393, `src` 248, `.agents` 207, `packages` 137, `.hseos` 64, `scripts` 21, `docs` 7, raiz 7; teto 1556. Confere com a seção 5 do prompt.
- Suíte completa de linha de base: `heavy-run --mem 4G -- npm test`, log em `$TMPDIR/terminal-closeout/baseline-npm-test.log`.

## Fase 1 — Linha de base

- `npm test` (Node 24.15.0): **exit 1** em 2026-11-11T23:15:45Z; `test:mcp-governance` (script 58 de 112 da cadeia `&&`): `test/test-mcp-hseos-governance.js` "32 passed, 1 failed"; causa em `TERMINAL-GAP-MAP.md` (GM-01). Reproduz isolado (`node test/test-mcp-hseos-governance.js` → "32 passed, 1 failed").
- CI na `master` `99a54dcc`: verde (runs 42732249163, 43023191758, 42825441132, 42732249377, 42732249149).
- Cauda (scripts 59–112) rodada um a um por `$TMPDIR/terminal-closeout/run-tail.sh` sob `heavy-run`: resultado na seção "Linha de base da cauda".
- **Incidente de processo (TA):** o primeiro `worktree-manager.sh validate terminal-ta1` rodou com nada staged; o `quality-gates.sh` então executa `npm run lint` e `npm test` completos (`quality-gates.sh:319-347`), em paralelo com a cauda da linha de base (duas suítes ao mesmo tempo, contra a regra de uma por vez). Saiu FAILED pela GM-01. Correção: `git add -A` no worktree antes do `validate` (o gate então considera só os arquivos staged). Carga observada sem degradação (`uptime` 4,0).

## Decisões do Commander

| # | Decisão | Alternativa descartada | Razão |
|---|---|---|---|
| D0 | Não reindexar o Axon (índice de 2026-10-31) | `run_pipeline` antes da análise | Indexação é estágio pesado que concorreria com a suíte de linha de base; exploradores caem para leitura direta quando o índice não cobre |
| D1 | Integração task→feature por `git fetch . task/<id>:feature/<onda>` (só fast-forward, sem merge commit e sem `checkout` na raiz); `create`, `validate`, `commit` e `remove` continuam pelo `worktree-manager.sh` | `worktree-manager.sh merge` | O `merge` faz `git checkout <feature>` na raiz (`worktree-manager.sh:200`), que colide com os registros da run editados na raiz e com a `master` em uso; o fast-forward preserva 1 task = 1 commit e falha se houver divergência |
| D2 | Cópia de trabalho dos registros da run em `$TMPDIR/terminal-closeout/run/`, sincronizada no worktree de cada onda | editar na raiz | Mantém a `master` da raiz limpa para `pull --ff-only` depois de cada merge |

## Tasks

(preenchido por task: commit, rodadas, revisão, métricas)

## Contrato do dev-squad (skill carregada em 2026-11-11)

- G2 (aprovação do plano), G4 (abrir PR) e G5 (merge): **pré-autorizados pelo owner** no prompt da run (seção 1: merge autorizado com checks verdes e `CLEAN`; fase 4: "não peça aprovação do plano"; "Interação com o owner: nenhuma"). Registro exigido pelo `AGENTS.md` §9 está no `INTAKE.md`.
- `hseos state-emit start` e `gate G2` emitidos (best-effort; códigos de saída abaixo na seção de métricas da onda TA).
- Um `WAVE-<k>-REPORT.md` por onda.

## Decisões de processo da TB

| # | Decisão | Alternativa descartada | Razão |
|---|---|---|---|
| D3 | `validate` por task com `GATE_CODE_MODE=light` (gate do pre-commit: lint, prettier, testes tocados ou que citam o arquivo, G3) e **uma** suíte completa por onda sob `heavy-run` antes do push | `validate` padrão, que roda `npm test` completo por task | O prompt fixa "uma suíte completa por onda" e "no máximo 1 suíte completa por vez"; o `validate` padrão rodou a suíte completa duas vezes em paralelo com a cauda da linha de base |
| D4 | Todo comando de gate com o Node 24 na frente do `PATH` | `/usr/bin/node` do shell (v22.22.1) | Com o Node 22 o gate leve falhou em `test/test-mcp-hseos-governance.js` + `test-package-surface.js`; com o Node 24, `FAILURES: 0` |

## Linha de base da cauda (fase 1)

`heavy-run --mem 4G -- run-tail.sh 58` (scripts 59 a 112 da cadeia do `npm test`, um a um, Node 24.15.0), concluída em 2026-11-11T23:37:53Z: **54 de 54 com exit 0** (`baseline-tail.codes`). Somando a primeira execução (scripts 1 a 57 verdes, 58 vermelho), a linha de base local é **111 de 112 scripts verdes**, e o único vermelho é a GM-01.

## Tasks da onda TB

| Task | Lacuna | Commit (task) | Rodadas | Revisão (cega / confronto) | Resultado copiado da ferramenta |
|---|---|---|---|---|---|
| TB1 | GM-01 | `9020f4ef` | 1 | sem BLOCKER/MAJOR; 2 MINOR (banco v4 existente; sem mutação de produto) / A1, A3–A6 confirmadas, A2 parcial (rc não capturado pelo revisor; o executor e o Commander tinham `32 passed, 1 failed`) | teste antigo com banco ativado: `32 passed, 1 failed`; novo com e sem banco ativado: `33 passed, 0 failed`, rc=0. MINOR do banco v4: `resolveGovernedExecutionMode` devolve `legacy` para inexistente e para v4 (`operational-state-db.js:331,335`) e o servidor recusa todo modo diferente de `modern` (`native-mcp-server.js:148`, reconferido pelo Commander) |
| TB2 | GM-02 | `aedb9441` | 1 | 0 BLOCKER/MAJOR, 4 MINOR / A1–A4 e A6 confirmadas, A5 parcial; revisor: nenhum MINOR bloqueia | `test/test-terminal-api.js`: pass 9, fail 0 (executor e revisor, 4 execuções); mutantes M1 (checagem global, `engineering-control-http.js:48`) pass 7 fail 2, M2 (só `POST /v1/terminals/commands`) fail 1, M3 (só `/events`) fail 1; `git diff -- tools` vazio. **Limites declarados (aceitos pelo Commander, proporcionalidade: a checagem é única e global antes do roteamento, e M1 a mata):** `interrupt` sem controle positivo; `terminate`, `recover` e `reconcile` sem caso de recusa próprio; 403 de origem/host fora; prazo de 4 s de relógio de parede |

## Onda TA — fechada

PR #314: todos os checks `SUCCESS` (18) e `mergeStateStatus` `CLEAN`; merge por `hseos pr closeout 314 --approved` (merge commit `4c9352c7`, branch `feature/terminal-closeout-ta` removida pelo closeout); tag `hseos-terminal-wa` publicada em `4c9352c7`. Mensagem do merge sem atribuição (`grep` rc=1).

| # | Decisão | Alternativa descartada | Razão |
|---|---|---|---|
| D5 | Rodada de correção de uma task já integrada na feature vira **commit próprio** da mesma task (`terminal-tb3r2`), registrado como rodada 2 | `commit --amend` + reescrever a feature | A feature já avançou (TB4 foi criada sobre `5f3518d2`); reescrever exigiria mover a feature para trás. O commit de correção é rastreado como rodada da TB3 |
| TB4 | GM-04 | `26d1fb5d` + rodada 2 `f2a7b4d7` | 2 | 0 BLOCKER/MAJOR, 3 MINOR + 1 NOTE / A1, A2 (502 genérico em `provider-egress-broker.js:165`), A4 confirmadas, A3 consistente com mutação equivalente; MINOR 3 rebaixado (`bound-kernel-supervisor.js:189` usa `stdio: pipe`); nenhum bloqueia | `test/test-secret-canary-scan.js` 3 testes, pass 3 fail 0 (3 execuções, executor e revisor); mutante no eco do broker (`provider-egress-broker.js:105`) falha em `:250`; `git diff -- tools packages` vazio. **Limites declarados:** eco no corpo do request (`:133`) não exercitado; sandbox `ai-jail` é shim; argv, headers além de `Authorization`, eco em header de resposta ou partido entre chunks, codificações além de bruto/base64/hex, `os.tmpdir()` do supervisor e HOME não varridos |
| TB3 | GM-03 | `5f3518d2` + rodada 2 `3fe35e2f` | 2 | rodada 1: MAJOR (disputa real não provada) / rodada 2: MAJOR fechado; A2, A3 (resultado), A4, A5 confirmadas, A1 não verificada pelo revisor | `test/test-budget-concurrency.js` (6 processos `fork` sobre o mesmo state, barreira de largada, `contention > 0`): pass 2 fail 0 em 5 execuções do executor (contenção mínima 11) e 3 do revisor. Mutantes: (a) checagem de custo `:448` morto (`cumulative reservation 4000 exceeded ceiling 3000`); (c) `.immediate()` → deferred morto; (b) checagem de sequência `:551` **sobrevive** — reconferido pelo Commander: equivalente quanto ao teto, porque `admitDispatch` relê o estado dentro da transação `IMMEDIATE` (`:427-429`) e o `append` usa `expected_version: rows.length` (`:234`); a semântica de concorrência otimista para o cliente não é provada por este teste. **Limites declarados:** teto por binding (`limits.max_requests`) não exercitado; teto de reserva, não de custo comprometido com recibo real; crash no meio da reserva fica com `test-job-faults.js` |
| TB5 | GM-05 | `7b745cbd` | 1 | 0 BLOCKER/MAJOR, 2 MINOR / A1 e A4 confirmadas, A2 e A3 em parte (o helper `job-dispatch-process.js` fica em `test/helpers/`, não em `tools/cli/lib`); nenhum MINOR bloqueia | `test/test-job-control.js` 13 testes (antes 10): pass 13 fail 0 em 3 execuções do executor e do revisor; mutantes em `job-control.js:320` (`now > not_before`, `<=`, `if (false)`) rc=1; `git diff -- tools` vazio. **Limites declarados:** despacho único provado na camada de jobs (1 claim, 1 intent), não a materialização posterior; SIGKILL depois da criação, não no meio de um tick; sem dois controladores abertos ao mesmo tempo (coberto por `test-job-faults.js:427`) |

TB4 rodada 2 (`f2a7b4d7`): causa da recusa afirmada pelo evento `session.failed` do ledger (`error_code: provider_unavailable`, `retryable: true`) com execução de controle que ecoa texto inofensivo e termina `completed`; stdout capturado > 0 bytes. Confronto: R1–R4 confirmadas, MINOR 1 e 3 fechados; 3 execuções pass 3 fail 0. **Achado (defesa em profundidade):** com a checagem de eco do broker removida (`provider-egress-broker.js:105`), o supervisor ainda barra (`bound-kernel-supervisor.js:385`, "sandboxed worker output contains a protected value") e o teste falha em `test-secret-canary-scan.js:274`; o teste não prova cada camada isolada. NOTE: num teste que falha (mutante) sobram 2 diretórios `hseos-canary-*` em `$TMPDIR`; na execução verde, nenhum.

## Suíte completa da onda TB (topo `f2a7b4d7`)

`heavy-run --mem 4G`: `npm run lint` exit 0; `npm test` **exit 1** em `test:f14v4`: `test/test-f14v4.js:1475` "the rehearsal receipt is stale" (recibo `e8bce470…`, hash atual `d2652177…`). Causa (Commander, `docs/evolution/w3/evidence/stab3-f14v4/confirmation.cjs:51-76`): o hash de confirmação inclui o `package.json` entre os arquivos de produto, e a TB registrou scripts de teste novos. Não é regressão de produto.

| # | Decisão | Alternativa descartada | Razão |
|---|---|---|---|
| D6 | Regenerar o recibo de **ensaio** da F14 v4 (modo fixture, modelo programado, sem chave, sem rede, semente `20261109`) numa task própria (TB6) e de novo em toda onda que mudar o `package.json` | (a) afrouxar o teste de frescor; (b) não registrar os testes novos | (a) é afrouxar gate, proibido; (b) quebra `ci-test-shards verify`. O gate pede regeneração; a evidência da execução real (`real-attempt1`) e o status da F14 não mudam; o ensaio `e8bce470` continua no histórico (#313). Acoplamento vira OWNER-GATE (congelar ou aposentar o gate de frescor de campanha encerrada) |
| TB6 | consequência (D6) | `420a23b2` | 1 | duas passagens num relatório: sem BLOCKER/MAJOR, 3 NOTE; E2 e E3 confirmadas, E1 e E4 consistentes com o artefato (não reprodutíveis sem nova campanha) | `rehearsal/campaign.json`: fixture, 42 runs, `confirmation_sha256` `d2652177…` = `--print-confirmation`; `verdict` `CRITERION MET`, `totals`, `analysis`, `protocol_issues` `[]` e `boxes.notes` idênticos à versão `e8bce470`; `artifact_scan` clean (128 arquivos); `test/test-f14v4.js` pass 44 fail 0. JSON formatado por prettier depois da geração (exigência do hook); o hash não cobre a saída do ensaio (recalculado igual) |

Cauda depois da TB6 (`420a23b2`, `heavy-run`): `test:f14v4` 0, `test:f15l2-campaign` 0, `validate:schemas` 0, `test:validate-skills` 0. **Suíte da onda TB:** scripts 1 a 108 do `npm test` verdes em `f2a7b4d7` (o 109, `test:f14v4`, vermelho pela causa D6), 109 a 112 verdes em `420a23b2` (a única diferença entre os dois commits é `rehearsal/**`, lido só pelo `test:f14v4`); `npm run lint` exit 0.

| D7 | Reorganização das ondas: TC = TC1 (aceite instalado) + TD1 (reconciliação) + TD2 (doc do terminal); TD = TD3 (gate de prontidão + `W6-ENTRY`) + registros finais. A TC1 roda num worktree criado de `026acac9` e entra na feature por `cherry-pick` num worktree de integração (1 task = 1 commit preservado); TD1 e TD2 avançam a feature por fast-forward | manter TD1/TD2 para depois da TC1 | A TC1 é longa e pesada; TD1/TD2 são leves e independentes dos arquivos da TC1 (`docs/evolution/terminal-closeout/`), sem estágio pesado concorrente |

## Tasks da onda TC

| Task | Lacuna | Commit (task) | Rodadas | Revisão (cega / confronto) | Resultado copiado da ferramenta |
|---|---|---|---|---|---|
| TD1 | GM-09..GM-14 | `d0f1b325` | 1 | 0 BLOCKER/MAJOR, 2 MINOR, 3 NOTE / E1–E4 confirmadas | nenhum `status.*` mudou (`grep` rc=1); `test-kernel-quality-surface.js` pass 14, `test-evolution-trace.js` pass 14 (13/1 antes do ajuste de 1 linha no `w3/TRACE.json`, deslocamento 196→206), neutralidade pass 2. MINOR-1 (texto "fechou … PR #315" antes do merge): resolvido pela ordem de merge (a TC só entra depois da #315). NOTE-3 do revisor (nenhum teste reabre o controlador) refutado pelo Commander: os testes da TB5 estão em `7b745cbd`, ancestral do worktree, revisados na TB. **Achado:** `w3/TRACE.json` cita linhas do `requirements.json`; editar acima da linha 206 quebra o guard |
| TD2 | GM-08 | `d0737435` | 1 | 0 BLOCKER/MAJOR, 2 MINOR, 3 NOTE / E1–E4 confirmadas | `docs/terminal.md` (fora do `files`) + link em `docs/README.md`; subcomandos, ações e flags citados conferidos nos `--help` e no `command-manifest.json`; requisitos ancorados em `w2/STATUS.md:66` e `executor.js:20`; `check:cli` rc=0; neutralidade pass 2. Link para `docs/evolution/terminal-closeout/` resolvido quando a TC1 entrar na mesma onda. **Limites declarados:** exemplos com `$URL`/`$ID` não executados pelo doc (a execução real é a TC1); sem verificação automática de que o doc acompanha o manifesto no futuro |
| TC1 | GM-06, GM-07, GM-17 | `2f973040` (integrado de um worktree criado em `026acac9`, D7) + rodada 2 `4c82765c` | 2 | duas passagens: 0 BLOCKER, 1 MAJOR (sha do banco em (b) de outra rodada), 2 MINOR, 5 NOTE; E1–E8 confirmadas (E3 parcial: consulta offline pela CLI sem log). Rodada 2 corrigiu o MAJOR e mais um sha abreviado errado; Commander conferiu que os 5 sha256 do recibo resolvem nos JSON de `evidence/` | tarball do commit `026acac9` (sha256 `a2ed5a45…`); `npm install --offline` ok nos dois consumidores; `core-journey` PASS 12, `mcp-journey` legado PASS 144, moderno PASS 507 (banco ativado), sem FAIL/BLOCKED; GM-17 pela CLI instalada dentro da jornada (consulta offline pela CLI não existe: `control query` exige `--url`); (a) schema 17 → esta revisão: eventos antigos com o mesmo hash, 2 anexados, `integrity_check` ok; (b) pacote de schema 16 recusa o banco mais novo com `EXECUTION_ACTIVATION_PENDING`, sha256 do arquivo igual, sem `-wal`/`-shm`; (c) **BLOCKED** (sem caminho de migração de banco ativado; OG-16); (d) `execution-activation rollback` restaura o sha256 original (user_version 4). **Incidente:** o executor apagou `/build/tmp/hseos-ledger-fixture-*` por glob ao limpar; pode ter removido fixtures de outro processo em execução no host (não verificado) |
| TD0 | GM-18 | `75382d1c` + rodada 2 (`README.md:218`) | 2 | duas passagens: 0 BLOCKER/MAJOR, 1 MINOR (`README.md:218` "49-skill", formato que o script não lê) / E1, E2 confirmadas, E3 refutada pela mesma linha; rodada 2 corrigiu | `verify-doc-facts.sh` rc=0 (antes rc=1, 7 discrepâncias); 54 = `ls .agents/skills` = `###` do `SKILLS-REGISTRY.md` = `manifest.yaml:27`. **Limite:** o padrão do script não lê "N-skill" (melhoria do script fora do escopo) |

## Suíte completa da onda TC (`75382d1c`)

`heavy-run --mem 4G` (Node 24.15.0): `npm run lint` exit 0; **`npm test` exit 0** (todos os 114 scripts da cadeia). É a primeira suíte local completa verde desta run (a da linha de base tinha a GM-01; a da TB foi dividida pela D6). O topo da onda (`bbc9814f`) difere só em `README.md:218`, coberto por `verify-doc-facts.sh` rc=0 e pela neutralidade.

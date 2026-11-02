# R-B2 - revisao cetica da B2 (commit 5231abb3)

Veredito: **CORRECOES NECESSARIAS (2 achados maiores, 1 menor).** O restante passa. Revisor reporta; nada foi editado no worktree.

## Achados
1. **MAIOR - digest de ancestralidade adulterado NAO e recusado no resume.** `grep ancestry_sha256` em tools/ e packages/ so encontra: criacao em `forkEngineeringTask` (runtime.js:1062), regex de formato em `forkSchema` (state.js:32) e exibicao (agent.js:59, runtime.js:550). Nada recalcula o digest dos eventos da sessao do fork contra `created.fork.ancestry_sha256` ao retomar. A unica checagem (runtime.js:1070) roda na criacao, sobre a copia recem-escrita. Logo "lineage verificavel" e so registro, nao verificacao. A mutacao (b) do executor ("digest errado") alterou o digest na criacao e o teste caiu por `deepEqual` do objeto `fork`, nao por recusa no resume - nao cobre o requisito.
2. **MAIOR - guarda pos-copia e codigo morto para os testes.** Mutacao minha (b'): em copia descartavel, `if (engineeringDigest(childStore.readSession(...)) !== ancestrySha256)` trocado por `if (false)` -> `test-compaction-agent-run.js` 3/3 passa (sobreviveu). Nenhum teste exercita a recusa por divergencia da copia.
3. **MENOR - imutabilidade do pai so provada sobre eventos da sessao.** O teste compara `events(parent)` antes/depois; nao compara digest do state/task-state do pai (pedido da revisao). Mutacao (a), que escreve `cancellation_requested` e `uncertainty` no pai durante o fork, caiu com "Invalid task lifecycle" (o pai e `approved`), ou seja, inconclusiva: nao consegui provar que uma escrita lifecycle-valida no task-state do pai seria detectada. Fica como lacuna de teste, nao como defeito demonstrado (o codigo le o pai apenas).

## Verificado OK
- Invariantes: `max_children === 0` (engineering-task-contract.js) nao tocado; diff sem alteracao em session-store nem em packages/; fork usa novo state dir, sem forkSession. Resume do pai apos o fork e do fork sao independentes e cobertos no teste (parentReplay, eventos do pai identicos).
- Lineage registrada: pai (task_run/session), sequence, contagem e digest; `forkSchema.refine(parent_sequence === ancestry_event_count)`. Fork apos efeito de escrita recusado com causa ("workspace effect"); checkpoint terminal e sequencia inexistente tambem, cobertos no teste.
- Compactacao: desligada por padrao (teste "without the compaction option" + overflow 'reject'); config persistida no `created` e `resume` rejeita `--compaction` ("only to a new engineering run"); schema estrito. Replay do resume nao acrescenta eventos (assert de contagem). Crash por SIGKILL exige `--reconciliation-decision` ligado ao hash do relatorio.
- Teste de jornada pela CLI real, provider scripted, comparado a execucao de referencia sem compactacao/crash (criterios, artefatos, command_checks, numero de escritas = 1); registrado no `test:kernel` (package.json).
- Execucao (cg.sh, Node 24, TMPDIR proprio): test-compaction-agent-run 3/3, test-compaction-resume-fork, test-agent-capability-cli, test-agent-runtime: tudo pass. c8 (subconjunto 171 pass/0 fail): engineering-task-runtime 91.97/81.25, state 99.06/81.44, contract 100/97.97 (>= 90/80). check-w4-mutations: 20 rejected, 0 failed. `ci-test-shards verify --shards 6`: OK 103 items. eslint dos .js tocados: limpo; prettier (js, json, runbook): limpo. package-surface e documentation-neutrality: pass. Atribuicao de IA no commit: limpa.
- Runbook F15: declara perfis delegated sem AgentRuntime, ensaio real `not_verified`, teto de gasto, conteudo do recibo.

## Passagem 2 (confronto com logs-wb/B2.md)
- "Mutacoes: fork sem lineage, resume sem compaction runtime, digest da ancestralidade errado derrubaram o teste": plausivel e coerente, mas a terceira so cobre a criacao (achado 1), e a alegacao de "lineage verificavel" nao se sustenta no resume.
- Numeros de c8 e verify conferem exatamente.
- Nao foi alegada (e nao existe) recusa de digest adulterado no resume; o pedido do Commander sobre isso fica nao atendido.

## Acao pedida ao executor
Verificar a ancestralidade no resume do fork (recalcular digest dos `ancestry_event_count` primeiros eventos e comparar com `created.fork.ancestry_sha256`; recusar com causa) + teste com ledger adulterado; teste que derrube `if(false)` da guarda de criacao; comparar digest do task-state do pai antes/depois do fork.

Limpeza: copia descartavel e dir de c8 removidos de /build/tmp/rev-b2-tmp.

## Reconferência rodada 1 (commit 27773b97)
Veredito: **APROVADO**, com uma ressalva informativa.
- Achado 1 resolvido: `verifyForkAncestry` roda em todo `resume`/`cancel`/`reconcile` do fork (so `status`/`evidence` ficam fora, sao leitura), antes de qualquer passo, e recusa com `ENGINEERING_FORK_ANCESTRY_MISMATCH`. O teste de jornada adultera um evento copiado (dropando o trigger `execution_events_no_update`) e exige a recusa. Mutacao `if (false && state.created.fork ...)` na copia descartavel derrubou o teste de jornada.
- Achado 2 resolvido: com `verifyForkAncestry` removido de `copyForkAncestry`, o teste novo com store simulado cai (fail 1). `copyForkAncestry` so e exportada do modulo interno `engineering-task-runtime.js`; `package.json` tem `main` = CLI e nenhum `exports`, e nenhum comando/arquivo a usa fora do proprio runtime e do teste. Sem superficie publica nova.
- Achado 3 resolvido: `stateDigest` (hash de todos os arquivos do state dir do pai) e igual antes e depois do fork e depois do resume do fork.
- Ressalva (nao bloqueia): o ledger local nao tem cadeia de hash; `created.fork.ancestry_count/sha256` e autoatestado. Adulterar so os eventos, ou so um dos campos, e recusado (digest/refine `parent_sequence === ancestry_event_count`). Reescrita coerente de eventos + `created` exige derrubar os triggers de append-only do SQLite, a mesma fronteira de confianca dos demais digests (contract_sha256 etc.). Nao executei esse ataque coerente; conclusao por leitura do codigo.
- Execucao (cg.sh, Node 24): jornada + resume-fork + agent-capability-cli + agent-runtime = 58 pass, 0 fail. c8 do subconjunto: pass 172/0; engineering-task-runtime 92.08/81.85 (>= 90/80). W4 20 rejected/0 failed; verify --shards 6 OK 103 items; eslint e prettier limpos; atribuicao de IA no commit: limpa. Copias descartaveis removidas.

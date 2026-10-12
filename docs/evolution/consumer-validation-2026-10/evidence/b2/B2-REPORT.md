# B2 - bateria de engenharia v2 do harness HSEOS num consumidor real

Data: 2026-10-10. Harness: pacote `hseos` 4.0.0-rc.0 (tgz sha256 `fcb81c1adbad85a5c5f057eda42fff5485649996b2126a9ed90531d6697ed0be`), instalado offline em `/tmp/hseos-crp/b2/hseos` (fora do checkout). Consumidor: monorepo `cambio-real-platforms` (develop `8fe5747`), clone descartável `/tmp/hseos-crp/b2/repo` (`--no-hardlinks`, `origin` removido). Pacote alvo: `packages/formatting` (1 arquivo de produção de 9,6 KB + 1 de teste vitest com 32 testes; escolhido por ser autocontido: só `typescript` e `vitest` como devDependencies, sem dependência de workspace).

Resumo: **14 PASS, 2 BLOCKED, 0 FAIL** nas 16 linhas da tabela. Os 2 BLOCKED são o mesmo achado de fundo (o executor isolado não consegue rodar pnpm/vitest/tsc) e são o resultado mais importante para a W5. Modelo real: 1 de 2 despachos usados, aceite externo PASS.

## Tabela passo -> resultado

| # | Passo | Resultado | Evidência (em `/tmp/hseos-crp/b2/ev/`) |
|---|---|---|---|
| 0 | `hseos control serve` em cgroup delegado (`systemd-run --user ... Delegate=yes`, mesmo helper do core-journey) | PASS | `steps/s00-serve.json` |
| base | Linha de base do projeto no host: `pnpm install --offline --frozen-lockfile --filter @cambio-real/formatting...` (214 pacotes reutilizados do store, 0,9 s), `vitest run --maxWorkers=2` 32/32 (0,2 s), `tsc --noEmit` ok (1,4 s), tudo em `heavy-run --mem 4G` modo `normal` | PASS | `real-baseline.txt` |
| 1-neg | Executor x monorepo pnpm: `prepare` recusa symlink (`node_modules/vitest`), hardlink do store (nlink 3), arquivo > 65536 chars/1 MiB, caminho oculto `.github/...` e `../`; controles positivos (index.ts; escopo de escrita na raiz `package.json`) são aceitos, então as recusas não são vacuosas | PASS | `steps/t1-negative-prepare.json` |
| 1-exec | Rodar pnpm / vitest / tsc **dentro** do executor isolado | **BLOCKED** (por desenho, ver A1) | `steps/t2-workflow-direct.json` (filho `vitest`: `exit_code 1`, `ERR_MODULE_NOT_FOUND 'vitest'`), `steps/t3a-terminal-vitest.json` |
| 1a | Entrega correta aprovada (defeito de regex `(?=\d{2})` injetado em `parseAmountInput`); `review` + `apply` no clone; vitest real do projeto sobre o resultado aplicado: 32/32 | PASS | `steps/t1a-*.json`, `task-a*.json`, `realvitest-t1a-apply.txt` |
| 1b | Entrega incorreta rejeitada (corrige o regex mas remove zeros à direita: `"1.000"` vira `"1"`): `failed/criteria-not-satisfied`, sem `review`, clone intacto; o vitest real também reprova o candidato (1 teste real quebrado) | PASS | `steps/t1b-*.json`, `realvitest-t1b-candidate.txt` |
| 1c | Rejeição -> diagnóstico -> correção -> aprovada (`correction_reviews`: reprovado com `correction_requested`, depois aprovado; 1 `correction_diagnoses`); vitest real 32/32 no candidato | PASS | `steps/t1c-*.json`, `realvitest-t1c-candidate.txt` |
| 1d | Escrita fora do escopo negada (6 tentativas independentes: outro pacote, raiz, `.github/workflows/ci.yml`, teste do próprio pacote, `..`, leitura fora da lista): em todas a ferramenta falha com `EXECUTION_INPUT_INVALID`, tarefa não aprovada, HEAD e árvore do clone intactos, repositório real idêntico ao snapshot inicial (status + HEAD) | PASS | `steps/t1d-*.json`, `task-d-*-events.json` |
| 1e | Edição concorrente após a aprovação: `review` recalculado devolve `baseline_valid:false`, `apply` recusado, a edição externa permanece | PASS | `steps/t1e-*.json` |
| 2a | Job `kind:workflow` com 2 filhos (`typecheck` -> `vitest`), `max_parallelism:1`, concluído; eventos do job lidos por cursor (limit 2 reproduz o ledger completo, 6/6) | PASS (com ressalvas A3/A4) | `steps/t2-job-dag.json`, `job-dag-*.json` |
| 2b | Workflow direto (`create_workflow` + `resume`), mesma definição: `completed`, filhos na ordem `typecheck>vitest`, 53 eventos, `evidence[]` por etapa presente | PASS | `steps/t2-workflow-direct.json` |
| 2c | Cancelar job workflow em execução: antes 4 processos com o marcador (2 bwrap + node + filho), `cancelling` -> `cancelled`, 0 processos depois e 2,5 s depois, ledger `intent > cancelling > settled`, cgroup do serviço volta a 2 pids (supervisor + serve) | PASS | `steps/t2-job-cancel-drain.json`, `job-cancel-events.json` |
| 3a | Terminal pty com o vitest do pacote | **BLOCKED** (mesma causa: `Cannot find package 'vitest'`; o terminal abriu, falhou e drenou) | `steps/t3a-terminal-vitest.json` |
| 3b | Terminal pty genérico (script eco no `jobproj`): abrir, entrada, `resize` 40x120 observado pelo filho (SIGWINCH), `attach` com a implementação do pacote (round trip + Ctrl-] desanexa sem matar), eventos por cursor (limit 3 == leitura completa, 16/16), `terminate`, `descendants_terminated`, 0 processos com o marcador | PASS | `steps/t3b-*.json` |
| 4 | Modelo real `claude/account`: defeito `MAX_CANONICAL_DECIMAL_LENGTH = 127` (quebra o teste real "limita decimal-string a 128 caracteres"); campanha -> `run` -> `GET evidence` -> `create` com `responses_from: campaign://...` -> `resume` -> `review` -> `apply`, sem passo manual: `approved/criteria-satisfied`; **aceite externo: vitest real 32/32**; reuso da mesma saída negado (`CONTROL_CAMPAIGN_EVIDENCE_CONSUMED`) | PASS | `steps/m-model-journey.json`, `model-*.json`, `model-output.txt`, `realvitest-m-apply.txt` |
| 5 | Higiene | PASS com 3 ressalvas (H1-H3 abaixo) | seção Higiene |

## Modelo real (passo 4)

- Rota: `claude/account` (assinatura), `sonnet`, claude 2.1.296; `account_sha256` observado `704dfbe7...` (igual ao da A5b). Binding com `pids_max 256`, `memory_max_bytes 2 GiB`, `max_duration_ms 240000`; `quota_exceptions` do owner registrada na autorização (máximo 2 despachos, custo 0). `quota_admission: owner_exception`, `reserved_microusd: 0`.
- Despachos: **1 de 2** (5,2 s). Tokens do recibo: **3091 entrada / 324 saída**, `cost_microusd: null`, saída retida 403 bytes. Plano devolvido: `engineering.patch` (127 -> 128, com o `expected_sha256` correto), `engineering.command load`, `engineering.diff`.
- Proveniência: `response_source` na evidência da tarefa (ref `campaign://49cccbc7.../b53e0d82...`, hashes do recibo, do binding e da evidência).
- init (`apiKeySource`, `fast_mode_state`, `model`) e `pids_peak`: **não observáveis** pelo recibo, pela evidência nem pelos eventos da campanha (ver A7), igual à lacuna registrada na A5b.
- Ressalvas honestas: (1) o prompt é montado pelo meu driver (cabeça do arquivo, trecho do teste e saída condensada do vitest real; `ev/model-prompt.txt`), então o PASS prova o pipeline governado, não a capacidade do modelo de explorar o repositório; (2) o defeito é pequeno e quase localizável pelo próprio nome do teste; (3) o verificador fixado é do tipo `node-module-v1` (5 checagens de retorno de função que escolhi a partir dos casos do teste real), e o aceite do **teste real do projeto** foi o vitest rodado no host sobre o resultado aplicado.
- Primeira tentativa de `run` falhou com `CONTROL_SEQUENCE_CONFLICT` antes de qualquer despacho (erro meu: `expected_sequence` deve ser o `current_sequence` da campanha, 3 após o `create`; ver A8). Nenhum despacho foi consumido (`requests: 0` confirmado antes do `run` real).

## Achados do harness

Severidade: Alta = invalida uma premissa da W5; Média = comportamento incorreto ou enganoso de API; Baixa = diagnosticabilidade/documentação.

**A1 - Alta - O aceite não pode ser o vitest/tsc do projeto, e o executor isolado não roda pnpm/vitest/tsc.**
Causas mensuráveis, todas por desenho do contrato v2:
- `commands[].runtime` só aceita `node|python` e o entrypoint precisa estar no escopo (`tools/cli/lib/engineering-task-contract.js:25`, `:161`); não há `pnpm`.
- Escopo máximo de 64 caminhos, 1 MiB agregado e 65536 caracteres por arquivo (`engineering-task-contract.js:8`, `:22`, `:133`), arquivos regulares com `nlink === 1` e diretórios sem symlink (`tools/cli/lib/engineering-workspace.js:35-51`). O pnpm instala por symlink (`packages/formatting/node_modules/vitest -> .pnpm/...`) e hardlink do store (`tsc.js` com nlink 3); `_tsc.js` tem 6,2 MB; só o pacote `vitest` tem 116 arquivos e o `node_modules` do repo tem 156 MB.
- Limites fixos do executor: 32 processos, 256 MiB, saída e duração do contrato (`packages/agent-isolation-attestation/executor.js:275`). Medido: `limits {processes:32, memory_bytes:268435456, output_bytes:8192, duration_ms:~118300}`. Como o vitest nem carrega, **não foi possível medir** se 32 pids/256 MiB bastariam para ele (pids_max, memória e tempo reais do vitest em sandbox: NOT_EXERCISED).
- Reprodução mínima: `prepare` de um contrato v2 em `/tmp/hseos-crp/b2/repo` com `scope.read` contendo `packages/formatting/node_modules/vitest/package.json` (recusado) ou `node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/tsc.js` (recusado); script `scripts/prepdebug.mjs` mostra as causas reais, e `scripts/run.mjs --steps t1` o faz pela API.
- Consequência: o "verificador fixado" possível é `node-module-v1` (compara o retorno JSON de funções, `tools/cli/lib/engineering-project-verifier.js:63-100`), não o comando de teste do projeto. A doc já diz que TypeScript é só remoção de tipos, não `tsc`; o que faltava era medir o impacto num projeto pnpm real: a suíte do projeto só pode ser usada como aceite **fora** do harness (como fiz com `realVitest`).

**A2 - Alta/Média - O resultado dos comandos do executor não influencia a aprovação.**
No workflow direto, o filho `vitest` executou `engineering.command` com `exit_code 1` (`ERR_MODULE_NOT_FOUND: Cannot find package 'vitest'`) e a tarefa terminou `approved/criteria-satisfied`, porque a aprovação depende só da saída do script do verificador (`engineering-project-verifier.js:79-100`). Com `max_failed_corrections` > 0 isso significa que um modelo pode "passar" sem nunca ter feito o teste do projeto passar, e que o `typecheck` filho da DAG aprovou sem `tsc`. Repro: `ev/steps/t2-workflow-direct.json` campo `ferramentas[1]`. Mitigação óbvia para a W5: verificador que exige `exit_code 0` de comandos declarados.

**A3 - Média - `/v1/tasks/{id}/events` de recurso materializado por job devolve páginas vazias e `next_cursor` avançando.**
Para o workflow criado por job (`execution_resource_id`), `GET /events?after=0&limit=100` devolve a primeira página vazia (com `limit=200` as 3 primeiras páginas são vazias e os eventos só aparecem na 4ª; com `limit=100` são necessárias 10 requisições); os 59 eventos existem (limit 1000 devolve os 59). Em `tools/cli/lib/engineering-control.js:233-236` o servidor lê uma janela de `limit` linhas do ledger **global** e só depois filtra por agregados do recurso; `next_cursor` é a última posição global da janela. Um cliente que pare na primeira página vazia (o loop natural: "parar quando `events` vier vazio") conclui que não há eventos. Contradiz "o cursor pertence ao ledger do recurso" (`docs/engineering-control-api.md`). Repro: `node scripts/probe-events.mjs` (resultado em `ev/probe-events.json`: limit 100 -> 10 requisições, 59 eventos; limit 1000 -> 59 eventos na 1ª).

**A4 - Média - `/evidence` de workflow materializado por job não traz `evidence[]` por etapa.**
`create_workflow` + `resume` devolve `evidence[]` com 2 etapas; o mesmo workflow rodado por `kind:workflow` num job devolve só a projeção de status. `engineering-control.js:176-179` chama `readEngineeringWorkflowView(handle, manifest, store)` sem passar a ação, enquanto o ramo de tarefa recebe `action === 'evidence'`. Repro: `ev/probe-events.json` (`has_evidence_array:false`) contra `ev/workflow-direct-evidence.json`.

**A5 - Baixa/Média - Erros opacos em `prepare`, `review` e `apply`.**
Symlink, hardlink, tamanho, caminho oculto, travessia, `review` de tarefa não aprovada e `apply` com baseline vencido retornam todos `CONTROL_REQUEST_REJECTED` (`tools/cli/lib/engineering-control-http.js:145`; a causa real, p.ex. `ENOTDIR` em `/proc/self/fd/..` ou "An approved project result is required" em `engineering-workspace.js:246-247`, fica só no servidor). Diagnosticar um `prepare` recusado exige chamar a biblioteca diretamente (precisei de `scripts/prepdebug.mjs`). A doc só promete `CONTROL_VIEW_UNAVAILABLE` para workflow.

**A6 - Baixa - Negação de escopo no gateway é indistinguível de erro de schema.**
Escrever/ler fora do escopo falha como `EXECUTION_INPUT_INVALID: input does not match schema v1` porque o caminho é um `z.enum(scope.*)` (`engineering-tools.js:133-143`). O comportamento é fail-closed e correto; o modelo, porém, não recebe nenhuma dica de que o problema é escopo (impacta a qualidade do ciclo de correção com modelo real).

**A7 - Baixa - init do cliente (`apiKeySource`, `fast_mode_state`, `model`) e `pids_peak` não são observáveis.**
`ADAPTERS-CAMPAIGN.md` diz que "a campanha real deve inspecionar a primeira evidência" e calibrar `pids_max` por `pids_peak`; nenhum dos quatro campos aparece no recibo, na evidência retida, nos eventos da campanha nem na evidência da tarefa (`m-model-journey.json` -> `init_observavel` todos `false`). Só o hash `evidence_sha256` os cobre. Reconfirma a lacuna da A5b.

**A8 - Baixa - Campanha: sequência esperada não documentada e autorização de uso único.**
`create` não devolve a sequência; `run` exige `expected_sequence` igual a `current_sequence` da campanha (3 depois do `create`), e um valor errado (usei 1) gera `CONTROL_SEQUENCE_CONFLICT` sem dica. Como a autorização é de uso único (`CONTROL_CAMPAIGN_AUTHORIZATION_USED`), um cliente que perca o `campaign_id` entre `create` e `run` só o recupera lendo o ledger (fiz isso com `scripts/ledgerpeek.mjs`). O id é gerado pelo cliente, então é evitável, mas a doc não diz.

**A9 - Informativa - `/usr/bin/node` não serve como runtime do serve.**
`docs/engineering-task-contract.md` cita `/usr/bin/node` como requisito do executor; no v2 o verificador e os comandos usam o node do controlador montado como `/hseos-runtime/node` (`executor.js:175`, `engineering-project-verifier.js:71`). O `/usr/bin/node` desta máquina (22.22.1, build de distro) falha com `ERR_NO_TYPESCRIPT`; a bateria só funcionou porque o serve rodou com Node 24.15.0 oficial. Operar o `serve` com o Node da distro reprovaria o verificador.

## Limites do que foi provado

- Respostas "roteirizadas" de 1a-1e exercitam o kernel/gateway/executor/verificador reais, não raciocínio de modelo. As edições concorrentes (1e) ocorrem **após** a aprovação (o que o `apply` protege), não durante a execução.
- Concorrência 1 da DAG foi verificada pela ordem dos resultados e pelo `max_parallelism:1` aceito, não por medição de sobreposição de tempo.
- O "typecheck" filho é um `node --experimental-strip-types` que carrega o módulo, não o `tsc`. O `tsc --noEmit` real e o `vitest` real foram executados no host (um pacote, `--maxWorkers=2`, `heavy-run`) como verdade de referência: baseline 32/32 e `tsc` limpo; defeito D1 -> 1 teste reprovado; correção errada -> 1 reprovado; correção certa -> 32/32; defeito D2 -> 1 reprovado; resultado do modelo -> 32/32.
- Nenhum teste de reinício do serve (kill) foi feito nesta bateria.

## Carga e higiene

- Carga: load1 máximo amostrado a cada 3 s durante as execuções **1,81** (host em 0,8-1,8 durante toda a bateria; início 0,98). Nenhum `pnpm test`/`pnpm -r`/`turbo`/`tsc -b` na raiz; tudo `--filter`/um pacote, `vitest run --maxWorkers=2`, instalação e vitest dentro de `heavy-run --mem 4G` (modo `normal` em todas as execuções), sem esperas por carga.
- Processos residuais: 0 (`pgrep` por marcadores/unidade, cgroup do serviço vazio após `systemctl --user stop`, cancelamento e terminal drenados, 0 processos `b2mark`).
- Segredos: grep da evidência por `Bearer`, `sk-ant-`, `ghp_`, JWT, chaves PEM, `oauth_token`, `refreshToken`, `accessToken` e e-mails (só `b2@example.invalid`): nada (a credencial do controle é aleatória por execução e só existe em memória/ambiente do serviço; `ids.json` guarda apenas hashes).
- H1: o `git status` que usei para provar que o repositório real não mudou criou e removeu `index.lock` e alterou só o **mtime do diretório** `.git` do repositório real (19:03:37); `.git/index`, HEAD (`8fe5747`), stash e árvore ficaram idênticos (os 4 untracked de `docs/goals/` já existiam).
- H2: `pnpm install` registrou o link `/tmp/.pnpm-store/v11/projects/a960e3493339f50d29e75697d3c03d86 -> /tmp/hseos-crp/b2/repo` no store compartilhado (efeito do pnpm fora de `b2`); removi esse único link ao final.
- H3: o `claude -p` da rota de assinatura roda com o `HOME` do owner (config `file://$HOME/.claude`); arquivos sob `~/.claude` mudaram na janela, mas são indistinguíveis dos de outras sessões Claude Code ativas do mesmo usuário. `--no-session-persistence` está nas flags do adapter; não verifiquei o que o binário grava.

## Reproduzir

`/tmp/hseos-crp/b2/scripts/`: `setup.sh` (clones por cenário + defeitos), `realcheck.sh` (vitest real de cada variante), `prep.mjs` (ledger, binding, autorização, config), `run.mjs --steps t1,t2,t3,m`, `probe-events.mjs`, `prepdebug.mjs`, `ledgerpeek.mjs`. Resultado consolidado em `b2-result.json`.

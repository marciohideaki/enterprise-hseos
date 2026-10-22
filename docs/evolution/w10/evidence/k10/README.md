# K10 — `mcp-journey` em modo moderno, com os negativos de escopo do swarm

Prova, não implementação: nenhum código de produção mudou e nenhum defeito foi corrigido. A K7 (achado F2) mostrou que o `test/journeys/mcp-journey.mjs` só exercitava o caminho legado; sobre um banco ativado ele dava 85 PASS / 34 FAIL / 4 NOT_EXERCISED, e os negativos de escopo do swarm ficaram sem prova no modo moderno. Esta task estende o journey (`--mode legacy|modern`) e arquiva uma execução de referência. Data da medição: 2026-10-22. Base: `feature/hseos-w5-closeout-w10` (2b55feca, inclui a K8), Node 24.15.
Nenhum modelo, provedor ou cliente real participa (o cliente é o próprio script; custo de inferência US$ 0). Todos os bancos e consumidores são descartáveis em `$TMPDIR`; nenhum `project.db` real, `~/.codex` ou `~/.claude` foi tocado. O ADR-0048 usado na ativação é uma **fixture** `Accepted` em diretório temporário (opção interna `internal.decisionsDirectory`); o ADR real continua `Proposed`.

## Resultado

| Modo                                                                    | PASS    | FAIL  | BLOCKED | NOT_EXERCISED | Veredito |
| ----------------------------------------------------------------------- | ------- | ----- | ------- | ------------- | -------- |
| legado, linha de base (antes da mudança)                                | 140     | 0     | 0       | 4             | PASS     |
| legado, depois da mudança                                               | 140     | 0     | 0       | 4             | PASS     |
| **moderno** (`--mode modern`, banco ativado, `mcp-journey-result.json`) | **478** | **0** | 0       | 4             | **PASS** |

- **Modo legado inalterado:** mesma lista de 144 passos (servidor, ferramenta, tipo e status idênticos, comparada passo a passo) e mesmas contagens antes e depois. Os 4 NOT_EXERCISED são o axon real (`get_overview` e `code_search`, em stdio e HTTP): o runner roda com o `PATH` sem `axon`, como o CI, e o modo `--axon-real=optional` os marca com a causa. Com o `axon` do host no `PATH`, o journey (antes e depois, inalterado) dá 140 PASS e 4 FAIL, todos `AXON_TOOL_ERROR: Axon index database unavailable` ao indexar a fixture em diretório temporário: problema do ambiente local, não do journey nem do pacote.
- **Moderno: 0 FAIL, 0 BLOCKED.** Os 4 NOT_EXERCISED são os mesmos do legado (axon real ausente do `PATH`), com motivo no JSON.
- Contagens de ferramentas conferidas em `tools/list` por servidor e por transporte (passo `tools/list count`): **governance 15, project-state 15, swarm 5, axon-bridge 6**, em stdio, HTTP e cliente legado (compat). `/health` do project-state diz 16 porque conta `scheduler_sweep_orphans`, que não aparece em `tools/list` (já registrado na K7); o passo confere 16 no `/health` e 15 na lista.
- Todos os servidores sobem na **via moderna** sobre o banco ativado (passo `(modern path on activated db)`, que exige `mode=activated` no banner). O axon-bridge, que na K7 ficou legado, sobe moderno aqui com `HSEOS_STATE_DB` no ambiente (o `cwd` da fixture do axon não tem banco; a causa exata do legado na K7 não foi investigada). Provado com `server/discover` em stdio e HTTP.

## O que o modo moderno faz

1. **Prepara** um consumidor com banco ativado (`activateExecutionLedger` com a fixture) e mantém `HSEOS_STATE_DB` no ambiente de todos os servidores.
2. **Protocolo 2026-07-28**: `server/discover` + `tools/list` + `tools/call` por requisição, com `_meta` por requisição; em HTTP, `POST /mcp` com `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`; aprovações por MRTR (`input_required` respondido com `accept`).
3. **Mesmos passos do legado, mesma semântica.** A resposta moderna vem no envelope governado `{schema_version, ok, data|error}`. O journey desembrulha `data.result` (o mesmo corpo que o legado devolvia) e mapeia `ok:false` para um erro de domínio com o código (`MCP_SCOPE_DENIED` etc.) antes de julgar; nenhuma asserção foi afrouxada. Só dois passos específicos do legado são substituídos pelo equivalente moderno: o `initialize` por `server/discover` e o silêncio de `notifications/initialized` (a notificação não tem forma moderna: o endpoint exige metadados por requisição; ela segue sendo enviada pelo caminho simples e o passo confere `202` vazio no axon HTTP).
4. **Aprovação por MRTR** (os 3 passos que o legado recusava com `MCP_LEGACY_APPROVAL_UNSUPPORTED`): `plan_squad`, `state_write` e `tasks_update` passam por `input_required` + `accept` nos passos funcionais (`(MRTR accept)`, PASS) e ganham negativos dedicados: **decline** recusa e deixa zero efeito (nada criado em disco, valor não gravado, tarefa continua pendente) e **cliente sem a capacidade `elicitation`** é recusado com `-32021` sem efeito. Se um servidor deixasse de pedir aprovação o passo seria `NOT_EXERCISED` com o motivo.
5. **HTTP para governance, swarm e project-state** (além do axon-bridge, que já tinha HTTP): `/health`, `server/discover`, `tools/list`, chamada representativa, negativos de transporte (sem `MCP-Protocol-Version`, revisão diferente, `Mcp-Method` diferente do corpo, JSON malformado, caminho legado `/`, corpos `null`/número/`[]`/string) e os negativos de escopo.
6. **Compat legado dentro do moderno (critérios e/f):** `initialize` `2024-11-05`, `2025-06-18` e `2025-11-25` contra o servidor moderno (stdio: uma conexão por revisão, a era fica fixada por conexão; HTTP: um servidor, três clientes), checando a negociação, o catálogo (15/5/15/6) e **repetindo os mesmos negativos de escopo**. `2025-03-26` fica com o harness da K7.

## Negativos de escopo do swarm (travessia, symlink, caminho absoluto, NUL)

Critério de PASS idêntico em todos os modos: recusa explícita, nada fora de `.hseos/runs/dev-squad` lido (o canário externo não vaza) e nada fora dele escrito (o arquivo-sonda não existe). No moderno e no compat a recusa tem, além disso, de trazer o código de domínio certo. Células: legado × moderno stdio × moderno HTTP × compat (3 revisões, stdio+HTTP: 6 execuções, todas PASS).

| Ferramenta            | Sonda                     | Legado | Moderno stdio | Moderno HTTP | Compat |
| --------------------- | ------------------------- | ------ | ------------- | ------------ | ------ |
| `get_run_state`       | travessia relativa        | PASS   | PASS          | PASS         | PASS   |
| `get_run_state`       | caminho absoluto          | PASS   | PASS          | PASS         | PASS   |
| `get_run_state`       | `..`                      | PASS   | PASS          | PASS         | PASS   |
| `dispatch_wave`       | travessia relativa        | PASS   | PASS          | PASS         | PASS   |
| `consolidate_handoff` | `run_id` com travessia    | PASS   | PASS          | PASS         | PASS   |
| `consolidate_handoff` | `source_task` travessia   | PASS   | PASS          | PASS         | PASS   |
| `get_run_state`       | symlink para diretório    | PASS   | PASS          | PASS         | PASS   |
| `get_run_state`       | symlink para arquivo      | PASS   | PASS          | PASS         | PASS   |
| `get_run_state`       | symlink pendente          | PASS   | PASS          | PASS         | PASS   |
| `plan_squad`          | escrita, travessia        | PASS   | PASS          | PASS         | PASS   |
| `plan_squad`          | escrita, caminho absoluto | PASS   | PASS          | PASS         | PASS   |
| `plan_squad`          | escrita, symlink          | PASS   | PASS          | PASS         | PASS   |
| `get_run_state`       | byte NUL no `run_id`      | n/a    | PASS          | PASS         | PASS   |
| `get_run_state`       | travessia percent-encoded | n/a    | PASS          | PASS         | PASS   |
| `plan_squad`          | escrita, byte NUL         | n/a    | PASS          | PASS         | PASS   |

As três últimas linhas existem só nos modos moderno e compat (o legado, para continuar inalterado, não ganhou sondas novas). Códigos observados: leituras negadas com `MCP_SCOPE_DENIED` antes de qualquer prompt; escritas no moderno negadas **depois** do prompt de aprovação com `EXECUTION_OUTCOME_IN_DOUBT` e a razão do escopo (ver F1); escritas e `consolidate_handoff` no compat negadas com `MCP_LEGACY_APPROVAL_UNSUPPORTED` (o cliente legado não aprova nada, então o escopo não pode ser mais frouxo por esse caminho).

Equivalentes nos outros servidores, em todos os caminhos: governance (`check_authority` e `query_constitution` com travessia, caminho absoluto e NUL: nenhum conteúdo fora do pacote é devolvido), project-state (`run_describe` com travessia, caminho absoluto e NUL: recusado sem conteúdo; o servidor não tem argumento de caminho do cliente) e axon-bridge (`get_skeleton` de `/etc/passwd` e `../../../../etc/shadow`: nenhum conteúdo devolvido), além dos negativos comuns (ferramenta desconhecida, `-32602`, `-32601`, JSON malformado, linhas `null`/número/`[]`/string que **não derrubam mais** o servidor, achado F1 da K7 corrigido pela K8) e da autenticação HTTP do axon-bridge (sem bearer, bearer errado, `Origin`, `Host` estranho).

**Controle de mutação (o teste é capaz de reprovar).** Numa cópia descartável do consumidor, `run-scope.js` foi alterado para aceitar qualquer `run_id` e para tratar qualquer caminho como contido: o modo moderno reprovou com 52 FAIL (vazamento do canário, escrita fora do escopo, em stdio, HTTP e compat). A cópia foi descartada; nada disso foi arquivado nem commitado.

## Achados (reportados, nada corrigido)

Nenhum negativo de escopo falhou no modo moderno nem no compat: **sem achado de severidade ALTA.**

- **F1 (média, `achados` do JSON) — escritas fora do escopo só são validadas depois do prompt de aprovação e ficam registradas como resultado incerto.** No moderno, `plan_squad` e `consolidate_handoff` com travessia, caminho absoluto, symlink ou NUL primeiro devolvem `input_required` (um humano seria chamado a aprovar um pedido que não pode dar certo); depois do `accept` a recusa vem com `EXECUTION_OUTCOME_IN_DOUBT` e a razão do escopo, e o ledger grava `ExecutionOutcomeUncertain`. Nada é escrito fora do escopo (o journey verifica em disco), mas (a) o código é enganoso (a recusa é determinística, não duvidosa), (b) a validação de escopo deveria vir antes do pedido de aprovação, como nas leituras (`MCP_SCOPE_DENIED` sem prompt), e (c) o ledger acumula eventos incertos que pedem reconciliação. Medido na execução de referência: 13 eventos `ExecutionOutcomeUncertain`, os 12 desta família e 1 de `tasks_update` de tarefa inexistente (`Task not found`, a mesma classificação para uma recusa determinística). Reprodução: `plan_squad` com `run_id: "../../x"`, cliente com `elicitation`, `accept`; ver o passo `plan_squad out-of-scope-write:relative-traversal` e o `ledger_eventos`.
- **O critério do journey para escritas no moderno aceita `MCP_SCOPE_DENIED` ou `EXECUTION_OUTCOME_IN_DOUBT` com a razão do escopo.** Isso registra o comportamento atual (F1) sem permitir que uma recusa por outro motivo passe: o texto da recusa precisa ser a validação de `run_id`/`source_task`/`target_task` ou "outside the runs directory". Se F1 for corrigido, o critério deve apertar para `MCP_SCOPE_DENIED` sem prompt.

## Limitações

- Axon real: ausente do `PATH` da execução de referência (como no CI); 4 NOT_EXERCISED com motivo. `AXON_UNAVAILABLE` (axon ausente) é exercitado em stdio e conferido no moderno.
- `memory.*` e `environment.*` existem só no project-state com a seção `environment:`, que o journey não fornece; a aprovação MRTR de `memory.delete` e o hover real seguem provados na K7 (h05 a h07).
- As dependências do consumidor são symlinks para o checkout (`better-sqlite3` compilado para o Node 24), como na K7; o pacote é o `npm pack` da árvore (`pacote.sha256` no JSON). O consumidor da referência foi criado só com `.hseos/` (sem `hseos install`).
- Nenhum cliente real (Codex, Claude Code): a prova com cliente real é a K7, seção 4.
- O `initialize` `2025-03-26` não está no compat do journey (K7 cobre).

## Observação de CI

Na primeira execução do CI do commit `9e70cb05` os 12 shards de teste passaram (Node 22 e 24), mas o job agregador `test (24.x)` leu um shard como `pending` durante toda a sua janela de tentativas e falhou. Rerodar o run não resolve: o gate (`shards seen: N of 6`) soma os jobs de tentativas anteriores como shards extras (7 de 6, 10 de 6). Por isso o SHA seguinte só repete a pipeline; nenhum arquivo de teste ou de produção mudou entre os dois.

## Reproduzir

```bash
export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH
K=$TMPDIR/k10; mkdir -p $K/pack $K/consumer/node_modules/hseos $K/consumer/.hseos
npm pack --pack-destination $K/pack
tar -xzf $K/pack/hseos-*.tgz -C $K/consumer/node_modules/hseos --strip-components=1
for d in node_modules/*; do ln -s "$PWD/$d" "$K/consumer/node_modules/$(basename $d)"; done   # dependências do checkout
node test/journeys/mcp-journey.mjs --mode modern --prefix $K/consumer --tgz $K/pack/hseos-*.tgz --out $K/out
node test/journeys/mcp-journey.mjs --mode legacy --prefix $K/legado --tgz $K/pack/hseos-*.tgz --out $K/out-legacy   # legado, outro consumidor
```

O modo moderno ativa o banco do consumidor (`.hseos/state/project.db`) na primeira execução; use um consumidor próprio por modo. O scratch foi removido ao final. `mcp-journey-result.json` desta pasta é a execução de referência, redigida (`~` no lugar do home, `<scratch>`/`<tmp>`/`<checkout>` no lugar dos diretórios temporários).

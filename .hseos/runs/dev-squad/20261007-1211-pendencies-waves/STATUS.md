# STATUS — 20261007-1211-pendencies-waves

Commander: sessão principal (Opus). Squad, revisores e caçadores: Sonnet.
Contrato: `GOAL-GRAPH.md`. Runtime: `workflow.js` (Workflow `wf_9890ad8b-710`, 52 agentes, 0 erros).
Base: `master` @ `6cbc1374`.

## Autorizações do owner (2026-10-07)

- Escopo: código + governança. Campanhas, T02–T13 e dependências externas ficam BLOCKED.
- Diff órfão do `governance-context.cjs` adotado como N0.
- Adaptador Claude emite `settings.json` e `.mcp.json`; `rules/` e `workflows/` seguem sem emissão.
- N8 (lexer do guard) incluído.
- `ANCHOR_OVERRIDE=1` autorizado para N0 (`.agents/hooks/`), N5 (`.github/CODEOWNERS`), N6 (`.github/workflows/`) e N11 (shard `core`).
- A arbitragem do N8 fica com o Commander: o hook de roteamento proíbe Opus dentro do Workflow.

## Ondas e PRs (nenhuma mergeada pelo agente)

| Onda | Branch | Nós | Validação (6 gates) | PR |
|---|---|---|---|---|
| A | `feature/pendencies-waves-a` | N0 | PASS | #201 |
| B | `feature/pendencies-waves-b` | N1, N2, N4 | PASS | #202 |
| C | `feature/pendencies-waves-c` | N5, N6, N7 | PASS na 3ª tentativa (lint, prettier, manifest da CLI) | #205 |
| D | `feature/pendencies-waves-d` | N8 | PASS na 2ª tentativa (lint) | #203 |
| E-core | `feature/pendencies-waves-e-core` | N11 | PASS | #204 (exige aprovação da Engineering Leadership) |

## Nós

| Nó | Estado | Commit final | Revisão |
|---|---|---|---|
| N0 | PASS | `701c7fe5` | 1 ciclo; minors: sem teste para `/`, ENOTDIR e symlink |
| N1 | PASS | `db252535` | 1 ciclo. Só o mcp-project-state expõe `instance_id`, então foi usado `freePort()` + `waitFor` (resta a janela TOCTOU, menor que a das faixas aleatórias) |
| N2 | PASS | `4d1004db` | 1 ciclo; helper `test/helpers/codex-free-tmpdir.js`; só 2 testes chegam ao validador |
| N3 | REGISTRO | — | 20/20 verdes isolados; sem flakiness, sem mudança |
| N4 | PASS | `a803613d` | 1 ciclo. Margens ≥2 pts no agregado; `capabilities-source.js` tem branches em 69,56% por arquivo (o gate é agregado). `entryCount` = 1472, folga zero |
| N5 | PASS | `e082601a` | 3 ciclos, com REPROVAÇÕES reais (parse de subseções, exit code de erro) + prettier na integração. Run live: o cluster tem `postgres-shared-lan` e `registry-mirror` fora da policy (drift real, decisão do owner). O teste não está ligado a script npm |
| N6 | PASS | `2208af4b` | 3 ciclos. BLOCKER corrigido: o pipe com `tee` engolia a falha do comparador. MAJOR corrigido: o README foi editado no espelho em vez da fonte. Na integração: `yml/quotes`, prettier e manifest da CLI desatualizado. Minor: o repositório está fixo no workflow |
| N7 | PASS | `42c19fde` | 1 ciclo + lint e prettier na integração. A mensagem original ("Claude Code") reprovava no validador e foi corrigida sem mudar a árvore. O bundle core atual não emite nada (`client_enabled: false`); minor: `PLATFORM_SURFACES` não anuncia as superfícies novas |
| N8 | PASS (árbitro Commander) | `389035c4` | 3 ciclos sem 2 rodadas secas; 11 bypasses fechados; fuzz 600k com 0 regressões; perf 2–4× a master, linear. O confronto achou 2 variantes ainda abertas (a master também as permite): ficaram pinadas como limitação, o CHANGELOG foi corrigido e a estratégia trocada (tokenizer real) virou item próprio, conforme §3h. Lint corrigido na integração |
| N9 | RELATÓRIO | — | O ruído vem do prefixo em aliases (`ui.login`, `sso-login`), não da heurística. Proposta: prefixo só com ≥3 caracteres. Decisão do owner |
| N10 | BLOCKED | — | Nenhuma tag `contracts-v*` posterior a `contracts-v0.4.0` no ECP |
| N11 | PASS | `0ce62cf7` | 1 ciclo; 2 dos 4 standards estão em `.specs/cross/`. "Teams notified" fica para o owner |
| N12 | RELATÓRIO | — | 352 divergências, das quais 305 envolvem hseos (269 internas). São artefato de classificação de modalidade (polaridade MUST/MUST_NOT), sem contradição real nas amostras. Decisão do owner |

Inventário do pacote: 1472 em todas as ondas. O 1474 visto por um revisor do N5 veio de resíduo no worktree do nó.

## Lições do run

- O pre-commit dos executores não pegou lint, prettier nem manifest desatualizado: os 3 só apareceram na validação da onda. Próximo run: o executor roda `eslint` + `prettier --list-different` nos arquivos tocados e `npm run compile:cli` quando mexer em comandos.
- Mensagem de commit e nome de branch de tarefa não podem conter o termo do fornecedor (o nome `task/n7-claude-…` quebrou a mensagem de merge padrão). Nomear tarefas sem esse termo.
- Commit/amend fora do `heavy-run` com `TMPDIR` padrão quebra o pre-commit (`/build/tmp/.codex`). Até a #202 entrar na master, todo commit usa `TMPDIR=/build/hseos-qg-tmp`.
- O push no GitHub devolveu 500 por cerca de 30 min enquanto a página de status dizia "operational"; a nova tentativa passou.

## Pendente para o owner

- Merge das PRs #201–#205 (`hseos pr closeout <n> --approved`, com a branch atualizada contra a master). #204 exige a Engineering Leadership.
- Notificar os times (ADR-0039).
- Decidir o drift real `postgres-shared-lan` / `registry-mirror` × policy.
- Decidir N9 (prefixo ≥3) e N12 (tratamento das 305 divergências).
- Depois dos merges: remover os worktrees `task/*` e `wave-*` (`worktree-manager.sh remove`). O diff no checkout principal é idêntico ao N0 e some quando a master for atualizada.

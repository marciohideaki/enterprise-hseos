# STATUS — owner-decisions (2026-10-30)

G2 aprovado pelo owner em 2026-10-30 ("Plano aprovado"). Merge das PRs ainda NÃO autorizado.

| Onda | Task | Item | Executor | Estado | Commit | Revisão |
|---|---|---|---|---|---|---|
| W1 | D2 revalidação dos aceites (só leitura) | 2 | reval-accepts (Sonnet) | concluída | — (logs/D2-REPORT.md) | Commander confrontou o item 23: a "escrita antes da decisão" era efeito de fuso (`e9920773` = 2026-10-21 01:21 UTC) |
| W1 | D3 aceite dos ADRs 0042–0045 | 3 | exec-d3 (Sonnet) | aceita (rodada 1) | `f1b365b9` | rev-d3 PASS-WITH-NOTES (runbook fourth-family e STATE-LIFECYCLE obsoletos) → corrigido |
| W1 | D5 ADR-0049 Code OSS (Proposed) | 5 | exec-d5 (Sonnet) | aceita (rodada 1) | `ce59e6d8` | rev-d5 PASS-WITH-NOTES (OpenVSCode incoerente, fatos externos, seções da política, PLAN W6) → corrigido |
| W1 | integração | — | Commander | merges `19eb1b0b`, `9fbcc9fb`; suíte da onda 102/102, 3996 testes, 0 falhas, exit 0 (19:58–20:37Z), checkers W4/W5 ok; PR #258 aberta, aguardando CI e autorização de merge | `9fbcc9fb` | — |
| W2 | D6 ledger e banco no c8 | 6 | exec-d6 (Sonnet) | aceita (rodada 1), prova final na suíte da W2 | `8b884f59` | rev-d6 PASS-WITH-NOTES (asserções decorativas; linha do inalcançável 177-181) → corrigido |
| W2 | D7 token no ambiente filho | 7 | exec-d7 (Sonnet) | aceita (rodada 2) | `654e3644` | rev-d7 PASS-WITH-NOTES (pontos com env por allowlist; linha do leak.js) → corrigido; lsp/browser host excluídos com motivo (sandbox --clearenv e só requires node:/irmãos); resíduo: descendentes dentro do bwrap não marcados (--unshare-all, --die-with-parent) |
| W2 | D8a retenção de 90 dias | 8a | exec-d8a (Sonnet) | aceita (rodada 1) | `67e80ee8` | rev-d8a PASS-WITH-NOTES (N1: corpo de chave com cabeçalho DER retido; 3 lacunas de teste) → corrigido, 218/218, 4 mutações mortas |
| W3 | D4 `operational` revalidado | 4 | exec-d4 (Sonnet) | aceita (sem rodada) | `8a84d1ab` | rev-d4 PASS-WITH-NOTES: nenhuma família tem as 3 provas; F19/F20 dependem de evidência de execução no project.db real (fora do escopo); guard só checa existência do arquivo de evidência |
| W3 | D8b digest com sal v2 | 8b | exec-d8b (Sonnet) | aceita (rodada 1, reconferida) | `acdaae93` | rev-d8b FAIL (teste novo fora da suíte — pego pelo verify da #255; corrida nlink na criação da chave; ENOENT cru; c8 do manifesto) → corrigido; reconferência PASS-WITH-NOTES (80×8 processos sem erro; manifesto c8 100/100) |
| W4 | D1 reauditoria focada | 1 | — | aguardando W3 | — | — |

## Perguntas abertas ao owner (da D2)
6 perguntas sobre os aceites dos itens 4, 5, 11, 15, 16, 19 e 23 e sobre onde registrar o aceite do owner. Estão em `logs/D2-REPORT.md` e foram apresentadas em 2026-10-30. Ainda sem resposta.
- 2026-10-30 (Commander): na D8a, a saída retida passa a ser recusada (`credential_pattern`) quando contém corpo de chave privada com cabeçalho DER/OpenSSH. A heurística ampla de base64 continua fora da saída retida. Só endurece; o owner é informado.
- 2026-10-30: `feature/owner-decisions-w3` empilhada sobre `feature/owner-decisions-w2` (`c8f2a17e`), por dependência real: a D8b toca os adapters alterados pela D8a. A PR da W3 terá como base a da W2 até ela ser mergeada (AGENTS.md §5.1).
- 2026-10-30 21:04Z: a suíte da W2 integrada (`c8f2a17e`) FALHOU (exit 1, 100/102 itens).
  - **(a) `test:sandbox` e `test:kernel`.** O caso "cleared environment" de `test-engineering-sandbox-check.js` recebe o token do supervisor, que a D7 passou a repassar. O executor testou fora do supervisor e não viu. A correção foi para a rodada 2 da D7.
  - **(b) `test:kernel-coverage`.** Saiu cerca de 130 `ERROR: Coverage (0%)` em arquivos normalmente cobertos, que não aparecem na W1. A hipótese é perda dos dados de cobertura por algum teste incluído pela D6. Em diagnóstico com o exec-d6.
  - A W2 não sobe para PR até a suíte passar.
  - 21:05Z: o exec-d6 provou a causa de (b). O teste de (a) quebra o segmento de engineering do `test:kernel`, que é uma cadeia `&&`, e os segmentos seguintes não rodam: o 0% em massa é 'segmento não executado'. Causa única: D7. Sugestão a levar ao owner, sem alteração de gate: avisar 'segmento não executado' no relatório do kernel-coverage.
- 2026-10-30 21:32Z: a suíte da W3 (`463496b8`) falhou (exit 1).
  - `test:sandbox` e `test:kernel-coverage`: mesma causa da W2 (token do D7).
  - `test:agent-provider-conformance`: falhou no caso "canonical local runner", em que `test-engineering-task-runtime.js` saiu com 1 depois de 138 s, sob load 5–8. O Commander reproduziu na W3: o arquivo isolado deu 49/49 com e sem token, e o caso da conformance isolado deu 1/1, exit 0. Não reproduziu; a classificação provisória é instabilidade por carga. A confirmação fica para a reexecução da suíte depois da rodada 2 da D7.
- 2026-10-30 22:10Z: D7 rodada 2 (`654e3644`). Teste por ponto nos 13 pontos, com 13 mutações mortas, e token também em `codex-acp-launcher.js` e `agent-provider-conformance.js`. A asserção do sandbox-check passou a ser precisa (só HOME, PATH e o token válido). Execuções com e sem token: 416/416. Reintegrado: W2 `382a9509`, W3 `3e6eb81b`. Suítes W2 e W3 reexecutadas em sequência.

## Decisões do owner — segunda rodada (2026-10-30, AskUserQuestion)
- **Merges:** W1, W2 e W3 autorizados, na ordem.
- **Aceites de resíduos do `w5/STATUS`:**
  - itens 5, 11 e 16: aceitos;
  - item 15: retry no CI;
  - item 4 e A-05: corrigir; o aceite fica só para o que não for seguro corrigir;
  - item 19: aceitar e abrir a task de recusa sem imagem;
  - item 23: confirmado e registrado;
  - local do registro: bloco no `w5/STATUS`.
- **F19/F20:** leitura do `project.db` com `immutable=1` autorizada.
- **ADR-0049:** segue Proposed.
- **Resíduos a corrigir:** N-1, A-15 e A-09. Aviso de segmento não executado no c8.
- **A-18:** reinstalar após os merges e corrigir o pin.
- **A-17:** editar os corpos das PRs.
- **Sunset:** sem data.
- **W9:** remover os worktrees já contidos.
- **G3:** elevar pelo medido.
- **Bindings:** definir o critério como proposta.
- **Codex:** exercitar com teto de US$ 2; login do owner agora.
- **g9:** corrigir agora.
- **G2 da rodada 2:** aprovado. Plano em `PLAN-2.md`. As PRs das ondas W4–W7 pedem autorização de merge própria.
- 2026-10-30: W1 (#258, `cd57f328`) e W2 (#259, `da2c0c76`) mergeadas com autorização do owner; tags `hseos-owner-decisions-w1` e `w2`. A W3 foi remontada sobre a master por cherry-pick dos commits revisados D8b (`515d0167`) e D4 (`093fb574`). Desvio: o cherry-pick foi direto na branch de integração, não por worktree de task. O conflito de uma linha no MAPA §8 foi resolvido pelo Commander com o estado real pós-W1/W2/D4.
- 2026-10-30 (A-17, autorizado pelo owner): removida a linha de atribuição dos corpos das PRs #186–#195 e #197 via `gh pr edit`. Conferido por script: o único conteúdo removido foi essa linha. Cópia dos corpos originais em `/build/tmp/owner-decisions/pr-bodies/`. Commits e histórico git intocados.
- 2026-10-31 00:5xZ: W3 (#260, `0efe5698`) mergeada; tag `hseos-owner-decisions-w3`; CI completo na master disparado (run 41151054824). Worktrees das W1–W3, de integração e da reauditoria removidos; branches `feature/owner-decisions-w1..w3` apagadas (local e remoto).
- W4 (`feature/owner-decisions-w4`, a partir de `0efe5698`): E1 (aceites e registros), E2 (retry no CI e aviso de segmento) e E3 (N-1 e lock em init/uninstall) em execução.
| W4 | E1 registros dos aceites e decisões | A1,A4,A5,A7,A14,A16 | exec-e1 (Sonnet) | aceita (rodada 1) | `9b1b30de` | rev-e1 PASS-WITH-NOTES (item 15 "corrigido" antes do merge; aviso antigo do MAPA §8) → corrigido |
| W4 | E2 retry no CI e aviso de segmentos | A2, A11 | exec-e2 (Sonnet) | aceita (rodada 1) | `26f4bcea` | rev-e2 PASS-WITH-NOTES (teste do net_retry não executava a função, M1 sobrevivia; nota do kernel-coverage; BACKOFF_MS morto) → corrigido, M1 morta |
| W4 | E3 N-1 e lock em init/uninstall | A8, A9 | exec-e3 (Sonnet) | aceita (rodada 1) | `f3915ab2` | rev-e3 PASS-WITH-NOTES (caminho com espaço/Windows/UNC vazava; mutantes de concorrência e exit sobreviviam) → corrigido, 8 mutações mortas |
- 2026-10-31: W4 integrada (`57fc0ebd`), com a suíte da onda em execução. W5 (`feature/owner-decisions-w5`, a partir de `0efe5698`, sem colisão de arquivos com a W4): E4 (redação curta e cifrada), E5 (computer.* sem imagem) e E6 (g9 conforme o ADR-0048) em execução. O E6 não edita o MAPA, para evitar conflito.
- 2026-10-31 (E6, `9278dd75`): o gate `g9-adr0048-activation-criterion` substitui o `g9-zero-legacy-window`. Decisões novas a levar ao owner:
  - (a) o formato do registro da janela supervisionada, um JSON escrito pelo operador antes do `apply`, com `operator`, `stopped_consumers`, `original_sha256_before` e `recorded_at` < `started_at`, e o caminho dele;
  - (b) se o `apply` passa a gravar a janela no recibo, o que toca o K2;
  - (c) se entram as flags de CLI `--activation-db/--activation-receipt/--activation-window/--activation-adr` no `agent-provider-validate`. Sem elas, o gate fica sempre pendente pela CLI.
- 2026-10-31 (E5, `f5ad2c56`): o protocolo MCP implementado não carrega imagem na elicitação nem tem sinal de que o cliente a exibe. A recusa `ENV_COMPUTER_IMAGE_APPROVAL_UNSUPPORTED` virou o padrão para `computer.act`; o override `allow_digest_only_approval === true` fica no host. Decisão nova para o owner: (d) ligar o override à configuração de produção (`~/.config/hseos/config.yaml` → `environment.computer`). Sem isso, o computer-use por MCP fica desligado em produção.
| W5 | E5 recusa de computer.* sem imagem | A4 | exec-e5 (Sonnet) | aceita (rodada 1) | `11e99912` | rev-e5 PASS-WITH-NOTES (doc citava chave de config inexistente; start aprovado inutilmente) → corrigido; recusa fail-closed em start e act, override só pelo host |
- 2026-10-31 (E6): rev-e6 PASS-WITH-NOTES. O gate não cobria o ADR-0048 2(a)–(f) nem as pré-condições do item 7, e aceitava recibo forjado ou backup apagado. Rodada 1: o gate só fica satisfeito com todo o critério provado, e o que não for verificável fica pendente; recibo amarrado ao backup e ao banco ativado. O formato da janela e as flags de CLI seguem como decisão do owner.
- 2026-10-31 01:42Z: a suíte da W4 (`57fc0ebd`) falhou só em `check:cli`: o manifesto da CLI ficou stale, porque o E3 alterou init/uninstall. Os outros 4186 testes passaram, com 0 falhas. Correção: E3 rodada 2 (regenerar o manifesto). O check:cli roda primeiro na cadeia, e o restante da suíte rodou.
- 2026-10-31: W4 reintegrada (`4c2fa9a8`), check:cli 0 e checkers W4 20 / W5 43. PR #261 aberta. **Merge exige autorização do owner**: a autorização dada cobria só as PRs #258–#260.
| W5 | E6 g9 conforme o ADR-0048 | A19 | exec-e6 (Sonnet) | aceita (rodada 1, reconferida) | `c4e0737b` | rev-e6 PASS-WITH-NOTES → critério completo (4 verificáveis + 9 sempre pendentes), anti-forja; reconferência PASS-WITH-NOTES (backup falso sem assinatura passa as 4 verificáveis, mas o gate fica pendente pelas 9) |
- 2026-10-31: o owner autorizou o merge da W4 (#261), da W5 e da W6, com suíte local e CI verdes.
- 2026-10-31: W4 (#261, `e6239c2a`) mergeada; tag `hseos-owner-decisions-w4`. W6 (`feature/owner-decisions-w6`, a partir de `e6239c2a`): E8 (ADR-0050 Proposed, critério de bindings) e E9 (evidência de F19/F20 por cópia do `project.db`) em execução; E7 (resto do c8) aguarda vaga. Método do E9 ajustado pelo Commander: o banco real tem WAL vivo, então lê-se uma cópia instantânea, nunca o original.
- 2026-10-31 (E9, `16ef8da8`): F19 e F20 seguem `not_authorized`. O banco real tem 10428 eventos pós-ativação, todos de `scheduler_sweep_orphans` (ator system); não há `tools/call` de cliente nem aprovações. Decisão nova para o owner: (e) promover a F19 com escopo reduzido a 'ledger e projeção', o que redefine a família. E7 despachado.
| W6 | E9 evidência de F19/F20 no banco real | A6 | exec-e9 (Sonnet) | aceita (rodada 1) | `c4d48597` | rev-e9 PASS-WITH-NOTES (contagens reproduzidas em cópia própria; intervalo e ressalva corrigidos); F19/F20 seguem not_authorized |
| W6 | E8 ADR-0050 Proposed (critério de bindings) | A17 | exec-e8 (Sonnet) | aceita (rodada 1) | `f847be80` | rev-e8 PASS-WITH-NOTES (assinatura primeiro; real_consumers sem valor para API; L0/L2; Related ADR-0046; estado atual dos bindings) → corrigido; 12 questões para o aceite. Ressalva: cita o STATUS desta run, que entra no repo no commit dos registros |
| W5 | E4 redação curta, cifrada, prefixos, JSON e teto | A3 | exec-e4 (Sonnet) | aceita (rodada 2) | `9e789577` | rev-e4 PASS-WITH-NOTES → r1 prefixos/JSON/teto; reconferência: token cruzando o teto da cauda → r2 descarta a linha parcial; 0 vazamentos em 12k combinações |
- 2026-10-31 (W5): suíte da onda (02:23–02:57Z) com 4259 testes e 1 falha, o guard de 200 ms do `test:capability-intake-guard` (870 ms sob carga, resíduo 6, arquivo fora da onda). Reexecução isolada do guard verde; checkers W4 20 / W5 43. PR #262 aberta; merge autorizado após CI verde.
- 2026-10-31 (E7, `6237deac`): os 6 arquivos entraram no gate c8 com linhas/branches ≥ 90/80 (4 em 100/100; capability-catalog 100/95,01). `test:kernel-coverage` definitivo exit 0, peso 920; 3 mutações mortas. rev-e7 em andamento.
| W6 | E7 resto do gate c8 | A10 | exec-e7 (Sonnet) | aceita (rodada 1) | `a65eade5` | rev-e7 PASS-WITH-NOTES (c8 confirmado nos 6 arquivos; título de teste contraditório) → corrigido |
- 2026-10-31: W6 integrada em `/build/tmp/owner-decisions/int-w6` (E8, E9, E7); suíte da onda a seguir.
- 2026-10-31 03:2xZ: o CI da PR #262 falhou no shard 5/6 (Node 24, job 124426311390), em `test-install-lock.js:444`, teste de corrida da W4 (E3). A causa está no teste: `release()` síncrono deixa o primeiro terminar antes de o segundo tentar. O código do lock está correto. Em vez de rerun, o Commander abriu a task E10 (só de teste, na W5) para tornar a ordem determinística.
- 2026-10-31 (W6): suíte da onda (03:17–03:51Z) com 4339 testes, 0 falhas, exit 0; kernel-coverage passou (982 s); checkers W4 20 / W5 43. PR #263 aberta. O merge vem depois da W5: `update-branch` e CI verde.
| W5 | E10 teste de corrida determinístico | CI #262 | exec-e10 (Sonnet) | entregue, sem revisão (revisão conjunta com o E11) | `e8f3ed9d` | integrado em `107e7b95`; 30/30 no teste novo; mutação morta |
- 2026-10-31 03:5xZ: na repetição do E10, `test-install-lock.js:152` (takeover) teve 1 violação em 30, com dois processos na seção crítica. Causa provável, segundo o Commander: com o lock ausente no momento da releitura sob o mutex, o taker considera `alive:false` e chama `fs.remove(lockFile)`, apagando o lock vivo que outro taker acabou de criar. O defeito é real e está na master desde a W4/T5. A task E11 (large, W5) corrige: só se remove o mesmo arquivo julgado morto. O merge da W5 fica condicionado ao E11 com revisão.
- 2026-10-31 04:1xZ (E11, `95372dfd`): rev-e11 PASS-WITH-NOTES. E10 passa. No E11, a janela residual documentada estava errada: um lock vivo liberado e recriado entre o stat e o rename ainda pode se perder (reproduzido). A mutação "sem inode" sobreviveu, e o catch do rename engole erros. Rodada 2: o rename só acontece com o pid morto lido sob o mutex, e o comentário documenta o residual com precisão.
| W5 | E11 corrida no takeover do lock | CI #262 | exec-e11 (Sonnet) | aceita (rodada 2) | `20416fe7` | rev-e11 PASS-WITH-NOTES → janela residual reproduzida → r2 rename só após pid morto lido sob mutex com stat estável; reconferência PASS-WITH-NOTES (mutação a2, remoção extra no caminho ENOENT, sobrevive, caminho raro; aceita como nota) |
- 2026-10-31 04:3xZ: E11 integrado em `de416cc3`; test:install 0; verify OK; push feito e CI da #262 reexecutando.
- 2026-10-31: W5 (#262, `75b472e0`) mergeada, com tag `hseos-owner-decisions-w5`, CI 24/24. W6: master incorporada em `b3707d93` (verify OK, package-surface e kernel-quality-surface 10/10), push feito e CI da #263 em execução.
- 2026-10-31: W6 (#263, `55d3d1aa`) mergeada, com tag `hseos-owner-decisions-w6`, CI 24/24.
- 2026-10-31 (W7, A12, parcial): release imutável `/workspace/local/tooling/hseos-releases/55d3d1aa…` construído e verificado.
  - Verificações: tgz sha256 `199082bb821b298e2202bc2d9eda4d3deddcc812d240d3481db68a0c97ca05c9`, 1541 entradas; package.json igual ao do tarball; `npm ls --omit=dev` ok; better-sqlite3 abre com v24.15.0 (ABI 137); cápsula de governança e `--version` resolvem a partir do release.
  - Desvio: a primeira montagem saiu sem `heavy-run` no PATH. Como o pipe mascarou o erro do `set -e`, o diretório incompleto foi movido para o lugar final. Não havia nenhuma referência a ele, e o Commander o removeu e refez com `pipefail`.
  - Pendente de decisão do owner (pergunta sem resposta): a janela para parar os 4 serviços systemd hseos-* (que rodam do CLI global), instalar o CLI global, repontar hooks e MCPs do Codex e corrigir o pin no AGENTS.md global. O host não foi alterado.
  - Achado: o pin do AGENTS.md global (2b4d6f37) diverge do que está em uso. As MCPs do Codex e parte dos hooks do Codex apontam para o 795e6540, e os hooks do Claude para o 2b4d6f37.
- 2026-10-31 (achado novo): o timer `hseos-liveness-watch` falha a cada ciclo com "Operational state requires schema v4 … this legacy server cannot open it": o watchdog abre o project.db ativado pelo caminho legado. Decisão do owner pendente: corrigir, registrar ou desligar o timer.
- 2026-10-31 (W7, A15): higiene W9.
  - Removido: `w0-8-governance-clock`, com os 2 commits equivalentes por patch na master (`git cherry`), limpo; o branch head era `d2a01588`.
  - Mantidos, porque não está provado que o conteúdo está na master:
    - `harness-*` (5): sem PR, com arquivos que diferem da master;
    - `dg27-scope`: PR #220 aberta;
    - `aew-graph-source-2b4d6f3`: usado por sessões do vortex-events;
    - os worktrees com mudanças não commitadas: hseos-evolution-w0..w3, v4-consolidation, plan-w4-w8, w5-live-t1, legacy-code-review-skill, harness-private-executor.
- A18 (Codex): o login do owner ainda não foi confirmado, então a campanha não começou.
- 2026-10-31 (owner, AskUserQuestion): A12 em janela completa; watchdog corrigido numa task (E12, W8, PR própria; o timer volta após a reinstalação); A18 "já está logado"; merge da #264 autorizado com CI verde.
  - Ordem do Commander: E12 → merge da W8 → A12 no SHA final (o release `55d3d1aa` vira intermediário, e a unidade `hseos-liveness-watch` precisa ser repontada) → A18 contra o release final → atualização e merge da #264.
  - Verificado: `codex-cli 0.166.0`, "Logged in using ChatGPT" (conta de assinatura, não chave de API). O teto em US$ e o "custo real" do recibo precisam ser confirmados com o owner antes da campanha.
  - Encontrado: a unidade `hseos-liveness-watch.service` executa `<release 795e>/tools/cli/hseos-cli.js liveness watch --once`. A falha vem de `openLivenessDb` (escrita), que usa o abridor legado v4 num banco ativado.
- 2026-10-31 06:5xZ: E12 aceita na rodada 1 (`448f0bd8`). A rev-e12 deu FAIL de início: o teste estava fora da suíte e faltava o fixture sem marcador. A reconferência deu PASS. Integrada na W8 (`5e733ab5`); a suíte da onda está rodando.
- 2026-10-31 (owner): A18 roda pela assinatura ChatGPT, com o teto convertido em limite de execução (jornada curta, ≤5 `tools/call`, 1 aprovação MRTR, tempo máximo). O recibo registra "cota de assinatura, US$ 0 incremental" e o uso reportado. A janela A12 abre logo após o merge da W8, parando os serviços só por `systemctl --user stop`.
| W8 | E12 watchdog no banco ativado | owner 2026-10-31 | exec-e12 (Sonnet) | aceita (rodada 1) | `448f0bd8` | rev-e12 FAIL (teste fora da suíte; fixture sem marcador) → corrigido; reconferência PASS |
- 2026-10-31: W8 com suíte da onda de 4422 testes, 0 falhas, e checkers W4 20 / W5 43. Mergeada como #265 (`817da40b`), tag `hseos-owner-decisions-w8`, CI 24/24.
- 2026-10-31 07:5xZ (A12, feita): janela no SHA `817da40b`.
  - O release intermediário `55d3d1aa`, sem referências, foi removido.
  - CLI global instalado pelo tarball (sha256 `74709ecfd41950ba033edc9d68e8591512121a0404860724ec00dc98985b16f7`).
  - 20 referências repontadas: hooks Claude/Codex, MCPs do Codex e unidade do watchdog. Pin do `~/.claude/AGENTS.md` corrigido.
  - Os 4 serviços `hseos-*` foram parados por `systemctl` e subidos um a um, saudáveis em 3100–3103.
  - O watchdog volta a sair com 0 e o timer está ativo.
  - Recibo `~/.local/state/hseos/distributions/817da40b…/verification.json`.
  - Desvios: (1) a primeira execução do script parou no check de hash, antes de qualquer mudança, porque o caminho do `package.sha256` é relativo; corrigido. (2) O `diff` reescrito pelo rtk deu um falso "identical"; o `diff` real confirmou a mudança.
  - Rollback: restauração testada em diretório descartável; a reinstalação do CLI anterior ficou NOT VERIFIED.
- 2026-10-31 08:00Z (A18, feita até o limite do protocolo): ver `logs/A18-CODEX.md`.
  - `tools/call` real provado, Codex 0.166.0 logado → `agent_runs_list ok:true` (2 de 5 chamadas).
  - MRTR não exercitável: o Codex negocia `2024-11-05`, e as ferramentas com aprovação só existem no `2026-07-28`.
  - Achados: a política padrão do `codex exec` bloqueia MCP; o modelo inventou um resultado.
- 2026-10-31: MAPA §8 atualizado com W8, A12 e A18.
- 2026-10-31 (owner, AskUserQuestion): decisões tomadas.
  - (a) JSON do operador.
  - (b) Referência no recibo.
  - (c) Flags na CLI.
  - (d) Override de computer-use mantido desligado.
  - (e) F19 não reduzida.
  - MRTR: sondar o Claude Code.
  - ADR-0050: 12 respostas e aceite.
  - Execução: "Nova onda agora", com reinstalação. O plano está em `PLAN-3.md`.
- 2026-10-31 (MRTR, sondagem do Commander):
  - Bloqueio: a `allowedMcpServers` do `~/.claude/settings.json` do owner só permite `axon`, `playwright` e `playwright-remote`. Um servidor de sondagem foi bloqueado ("blocked by enterprise policy"). A política não foi contornada.
  - Inspeção estática do Claude Code 2.1.316: há cliente da era `2026-07-28` (sonda `server/discover`, input requests).
  - Exercitar o MRTR com ele exige decisão do owner: incluir `hseos-state-tracking` na allowlist e habilitar `memory.*` no project-state.
| W9 | F3 ADR-0050 aceito + vocabulário real_consumers | owner 2026-10-31 | exec-f3 (Sonnet) | aceita (rodada 1) | `cb30add0` | rev-f3 PASS-WITH-NOTES (contenção da evidência sem teste; respostas 8 e 10 só na lista) → corrigido; reconferência PASS |
| W9 | F2 flags de ativação no agent-provider-validate | (c) | exec-f2 (Sonnet) | aceita (rodada 1) | `605d7458` | rev-f2 aprovado com ressalvas (bullet antigo do runbook; flags sem `--activation-db` aceitas em silêncio) → corrigido; reconferência aprovada |
| W9 | F1 janela validada no apply e ligada ao recibo v2 | (a)+(b) | exec-f1 (Sonnet) | aceita (rodada 2) | `2f56a7de` | rev-f1 aprovado com ressalvas (v3 sem window não testado; recusa com WAL deixava diretório; data sem fuso; leitura dupla) → r1; reconferência: o teste de fuso dependia do TZ do host → r2 independente de fuso |
- 2026-10-31: W9 integrada (`0d64ee86`) sem conflitos; `check:cli` 0 e `verify` OK depois da integração; suíte da onda em execução. Desvio: os executores F1 e F2 relataram que o `verify --shards 6` "não existe". O entrypoint é `node .github/scripts/ci-test-shards.mjs verify --shards 6`; os revisores rodaram o comando e ele passou.

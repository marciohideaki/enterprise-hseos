# R-F2 — revisão cética de F2 (commit c2695789, base 88db0f11)

Veredito: APROVADO COM RESSALVAS (nenhum bloqueante; 1 achado de documentação a corrigir antes do merge).

## Passagem 1 (cega)
1. Repasse: `activation` chega a `validateProviderEnvironment` e daí a `verifyActivationCriterion(activation.databasePath, activation)`. `receiptPath` é de fato usado (o verificador só cai no `<backup>.receipt.json` se `receiptPath` faltar). Nenhuma flag marca condição como atendida sem evidência: as condições seguem sendo calculadas pelo verificador existente (receipt shape, sha256, `isRegularFile` por lstat, janela estritamente anterior). Probe com arquivos `{}` forjados nas 3 flags: só `adr_accepted` atendida. Gate permanece em `remaining_gates` e `activation_authorized=false` mesmo com tudo provado (teste confirma).
2. Entrada: caminho inexistente e diretório -> exit 1, mensagem curta com basename, sem stack. Flag sem valor -> erro do commander, exit 1. ADR fora de `ADR-NNNN` recusado (ancorado `^...$`). Symlink: aceito pelo comando (existsSync/statSync seguem o link) mas barrado depois pelo verificador (lstat) para receipt/window; para o banco, um symlink para SQLite real é aberto read-only. Sem risco de falso positivo.
3. `activation_inputs` traz só basenames + ADR validado; teste afirma ausência do diretório no stdout. Sem credenciais.
4. Manifesto regenerado; `npm run check:cli` exit 0.
5. Testes: os 3 testam comportamento real via spawn da CLI. As 4 condições atendidas batem com o fixture (sem janela: 3; com janela: 4). Fixture usa mkdtemp via helper `fixture` ($TMPDIR; não vi /tmp literal).
6. Mutações (cópia sob /build/tmp/rev-f2, removida): (a) ignorar `--activation-receipt` -> derruba "CLI activation flags evaluate..." (11/12). (b) aceitar qualquer ADR -> derruba "CLI refuses a missing activation path..." (11/12). Ambas mortas; nenhuma sobreviveu.
7. node_modules próprio: o worktree não tinha; criei `npm ci --ignore-scripts` + `npm rebuild better-sqlite3` (heavy-run). Com ele, via cg.sh: test-agent-provider-binding.js + test-package-surface.js = 13/13 pass; eslint 0 (--max-warnings=0) nos 2 JS; prettier ok nos 4 arquivos; check:cli exit 0. Não verificado: `verify --shards 6` — o comando não existe nesta checkout nem no `hseos` global (`unknown command 'verify'`); confio apenas no relato do executor (102 itens). Pergunta ao lead: qual é o entrypoint real.
8. Runbook: seção 3e correta e consistente com o código. ACHADO (médio, docs): o bullet "Decisão do owner, ainda aberta: ... e as flags de CLI que o informam ... a CLI reporta o gate sempre pendente" (~l.99) segue afirmando o contrário da 3e; o `.md` fica auto-contraditório. Corrigir (de preferência junto do F1 para evitar colisão, ou no merge).
9. Sem atribuição de IA no commit (autor/mensagem limpos).

## Achados menores (não bloqueantes)
- `--activation-receipt` ou `--activation-window` sem `--activation-db` é aceito em silêncio e aparece em `activation_inputs`, mas o gate fica "no database to inspect": pode induzir o operador a achar que o recibo foi avaliado. Sugestão: recusar a combinação ou documentar.
- Refinamento: o mesmo caminho em `--activation-db` e `--activation-receipt` é aceito (ex.: `f.json` nos três); inofensivo, o verificador rejeita.
- O arquivo do comando não está em `.c8-kernel.json` (já reportado pelo executor); cobertura só via spawn.

## Passagem 2 (confronto com logs/F2.md)
Confirmado: flags, validação, activation_inputs só basenames, manifesto/check:cli, 3 testes, mutação (executor: windowPath; eu: receipt e ADR), eslint/prettier, bullet l.99 desatualizado (admitido). Não reproduzido: `verify --shards 6` (comando inexistente aqui). Alegação "13/13" reproduzida com node_modules do próprio worktree, portanto não depende do checkout principal.

## Reconferência rodada 1 (commit 605d7458)
Veredito: APROVADO COM 1 RESSALVA DOCUMENTAL (não bloqueante).
- Bullet l.99 reescrito para o estado decidido (flags, sem "sempre pendente"); não contradiz mais a 3e. RESSALVA: ele manda ver a seção "Registro da janela supervisionada", que NÃO existe no runbook (grep sem outro hit) — referência pendurada; criar a seção ou apontar para o formato (`operator`, `stopped_consumers`, `original_sha256_before`, `recorded_at`).
- Guarda `--activation-receipt/--window` sem `--activation-db` recusada com exit != 0; `--activation-adr` sozinho segue aceito. Mutação removendo a guarda (cópia /build/tmp/rev-f2, removida) derruba o novo teste "CLI refuses activation receipt or window without the activation database" (12/13).
- Via cg.sh, node_modules do worktree: test-agent-provider-binding 13... 13/13 pass (pass 13, fail 0); check:cli 0; eslint 0; prettier ok.
- `node .github/scripts/ci-test-shards.mjs verify --shards 6`: OK, 102 itens, 234 arquivos de teste cobertos uma vez (confirma o relato do executor).

# R-E6 — Revisão cética do commit 9278dd75 (g9-adr0048-activation-criterion)

Revisor isolado; nada foi editado no worktree. Scratch em /build/tmp/rev-e6/.

## Veredito: PASS-WITH-NOTES

Nenhum FAIL funcional. O gate não afrouxa nada e a CLI não consegue satisfazê-lo. Há 1 achado MÉDIO (prova forjável por arquivo à mão) e 1 decisão de owner pendente (contrato novo da janela e semântica pós-apply).

## (1) Condições x ADR-0048 — PARCIAL (nota)

As três condições (adr_accepted, database_authorized, supervised_window) seguem o que o prompt E6 pediu e nenhuma é mais fraca que o texto de Decision 6/7. Mas o gate chamado "critério do ADR-0048" cobre só um subconjunto do critério 2(a)-(f) e do item 7:
- Não verifica (a) suítes de contrato sobre banco ativado, (b) ensaio concluído, (b2) integrity_check+sha do backup real, (c) journey 503/0/4, (d) prova com cliente real, (e)/(f) compat legado-dentro-do-moderno.
- Não verifica o teste de escritor único, a lista nominal de re-registro, nem a ciência da perda de escritas (Decision 5).
- Severidade BAIXA/NOTA: o nome do gate promete mais que a verificação. Recomendo registrar no runbook que os itens (a)-(f) continuam evidência humana (o gate `explicit-human-cutover` segue na lista). Isto está dentro do que o owner pediu ("use o que existe, não reimplemente").

## (2) Tentativas de enganar (script /build/tmp/rev-e6/forge.js, banco ativado real via activateExecutionLedger)

Rejeitados corretamente: sha divergente, operador vazio, consumidores vazio/item vazio, recorded_at posterior, recorded_at nulo/inválido, recibo de outro banco, outro ADR, JSON não-objeto, ADR com status duplicado, ADR com prosa depois da data, `inspectDatabase:false`, ADR-0047 via `internal.criterionAdrs`.

ACHADOS (satisfeito indevidamente):
- MÉDIO — recibo escrito à mão satisfaz `database_authorized`: basta JSON com `adr`, `adr_status:"Accepted"`, `database_path` e `original_sha256_before` (qualquer hex de 64) e `started_at`; nenhum campo é confrontado com a realidade (`backup_path`/`backup_sha256`/`adr_sha256`/`commit` ignorados). Banco ativado por qualquer meio + dois JSON forjados = gate satisfeito. Reprodução: forge.js, caso "handwritten receipt + matching window" → `[]`. Em `tools/mcp-project-state/lib/operational-state-db.js:566-578`.
- MÉDIO/BAIXO — recibo com o backup apagado continua satisfazendo (caso "backup deleted"): o gate não exige que `backup_path` exista com `backup_sha256` correto, que é a prova de que o apply de fato aconteceu com rollback possível. Mesmo arquivo, linhas 566-578.
- BAIXO — `recorded_at` aceita número (`1` vira 2001) e `recorded_at == started_at` (a doc diz "anterior"; o código rejeita só `>`, linha 596). `stopped_consumers: ["zzz"]` qualquer nome serve (não confronta lista nominal).
- BAIXO — symlink de recibo/janela é seguido (`readFileSync`); campos extras ignorados. Sem impacto de segurança dado o modelo local, mas fica registrado.
- Limite aceito: o ensaio/binding é read-only; a falsificação exige escrita local, mesmo nível de confiança do restante do repo. Mitigação sugerida (não aplicada, sem corrigir): exigir `backup_path` existente com sha igual a `backup_sha256` e `original_sha256_before`.

## (3) Formato do registro da janela — contrato NOVO, EXIGE DECISÃO DO OWNER

- Documentado apenas em 1 bullet do runbook `docs/evolution/runbooks/activation.md:95` (campos `operator`, `stopped_consumers`, `original_sha256_before`, `recorded_at`). Sem schema, sem template, sem exemplo, sem comando que o escreva: o operador escreve à mão, onde quiser (caminho passado só por API: `activation.windowPath`).
- Nenhuma flag na CLI: `tools/cli/commands/agent-activation-rehearsal.js:125` e `agent-provider-validate.js:37` não repassam `activation`; o gate fica sempre pendente pela CLI (confirma a alegação do executor, e o runbook:274 declara isso).
- Semântica a decidir: o gate só fecha DEPOIS do `apply` (precisa de recibo e banco ativado), mas está na lista de gates que precedem o cutover (`requires` do candidato). Na prática ele nunca fecha no ensaio pré-ativação; fecha como auditoria pós-apply. Classificação: decisão do owner (formato oficial da janela, quem o escreve, se o `apply` deve gerá-lo ou exigir `--window`, e se o gate deve ser pré ou pós-apply).

## (4) Ensaio, binding, registros antigos, manifesto — OK com nota

- Ensaio usa `inspectDatabase:false`: gate pendente com motivo explícito ("database not inspected ..."); teste afirma `['database_authorized','supervised_window']` pendentes. Binding avalia o banco ativado (`activation` opcional) — teste de binding cobre pendente e satisfeito.
- `g9-zero-legacy-window` não foi reescrito em `_graph/**`, `docs/evolution/w10/evidence/**`, k3/k7 README, MAPA.md/PLAN.md (fora do diff).
- O manifesto `.agents/activation/agent-openai-compatible-candidate.yaml` não é compilado nem pinado em `.agents/manifest.yaml` (grep vazio). O único pin é `docs/evolution/baseline.json:8` (sha256 histórico `1e6cd856...`, igual ao da master; agora diverge `fb153115...`); nenhum código/teste lê esse baseline (só docs e evidências). NOTA BAIXA: snapshot histórico, não gate. `node scripts/generate-cli-command-manifest.js --check` rc=0.
- `rehearsal` valida `requires` do manifesto contra a lista do código (`agentic-activation-rehearsal.js:~98`), então nome e manifesto estão consistentes (testes verdes).

## (5) Cobertura c8 (seleção: operational-state-db, execution-ledger-activation, operational-state-gate, execution-state-gate)

| | lines | branches | testes |
|---|---|---|---|
| master 0efe5698 (cópia git archive + git init) | 92.18 | 87.75 | 80 |
| 9278dd75 | 92.94 | 90.30 | 85 |

Acima de 90/80 e melhor que a master. Bloco novo (linhas 533-619) sem linhas descobertas. A alegação do executor de 88,55/87,32 é de outra seleção (só o arquivo isolado), não refutada nem reproduzida; na seleção pedida o arquivo passa o gate.

## (6) Mutações próprias (cópia descartável /build/tmp/rev-e6/mut, 3 arquivos de teste, 56 testes)

- `recorded > started` → `false`: derruba "rejects a window ... recorded after the apply".
- ignorar sha do recibo: derruba o mesmo teste.
- ignorar realpath do banco: derruba "rejects a receipt of another database ...".
- aceitar `stopped_consumers` vazio: derruba o teste da janela.
- (executor) `satisfied: true`: derruba 4 testes (confirmado: binding probe, binding gate, rehearsal, criterion-pending).
Lacuna: `recorded_at == started_at` e `recorded_at` numérico não têm teste.

## (7) Verdes

- cg.sh, 5 arquivos (rehearsal, provider-binding, execution-ledger-activation, operational-state-db, operational-state-gate): 71/71 (executor: 62/62 em 4 arquivos; sem divergência material).
- `ci-test-shards verify --shards 6`: OK, 102 itens/230 arquivos; test-package-surface 1/1; check-w4 20 rejeitadas/0 falhas; check-w5 43/0.
- eslint --max-warnings=0 e prettier --check nos 8 arquivos do commit: ok. `check:cli --check`: rc=0.
- Commit: assunto de 78 caracteres (<=100), corpo sem atribuição de IA; `git status` do worktree limpo.

## Passagem 2 (confronto) — alegações do executor

- 62/62: confirmado como subconjunto (71/71 no conjunto de 5).
- Mutação `satisfied:true` derruba 4: CONFIRMADO.
- Bloco novo 100% coberto: CONFIRMADO.
- 88,55/87,32 isolado: não reproduzido; na seleção de 4 arquivos do kernel o arquivo tem 92,94/90,30.
- CLI não consegue satisfazer o gate: CONFIRMADO (nenhum caller passa `activation`).
- Não declarado pelo executor: recibo/janela forjáveis à mão (item 2) e o contrato novo da janela sem escritor (item 3).

## Reconferência c4e0737b

Veredito: PASS-WITH-NOTES.

1. Mapeamento ADR -> condição: verificáveis (adr_accepted=6, database_authorized=1/6, backup_integrity=2(b2), supervised_window=7) mais 9 não verificáveis (2(a), 2(b), 2(c), 2(d), 2(e), 2(f), 5, 7 escritor único, 7 re-registro), todos com `reason` fixa "não verificável pelo ensaio" e `met:false` por construção (`criterionCondition` com razão não nula; nenhum caminho de código os avalia). Prova: em 17 cenários, `unverif_met=0/9` e `satisfied=false` sempre; teste de binding afirma o prefixo da razão. O gate hoje nunca fecha sozinho. Itens 3 (sunset, data do owner), 4 (rollback, coberto pelo ensaio 2(b)) e as ressalvas de item 7 (WAL, K8) não têm condição própria; aceitável, só nota.
2. Anti-forja (repetida em c4e0737b): recibo à mão, recibo copiado fora do caminho `<backup>.receipt.json`, symlink de recibo, symlink de janela, symlink de backup, backup apagado, anexado, com páginas danificadas, backup_sha != original, versões incoerentes, sem migrações, finished<started, sem backup_path: todos mantêm a condição correspondente pendente. Nota BAIXA remanescente: um par coerente "backup falso (outro v4) + recibo coerente no caminho padrão + janela" passa as 4 condições verificáveis (sem assinatura); o gate continua pendente pelos 9 não verificáveis.
3. Consumidores: 73/73 nos 5 arquivos via cg.sh (rehearsal, provider-binding, ledger-activation, operational-state-db, operational-state-gate). Ensaio e binding reportam o gate pendente com motivos.
4. c8 (seleção do kernel, 87 testes): operational-state-db.js 93,47 linhas / 90,59 branches (>=90/80; master 92,18/87,75).
Limpeza: /build/tmp/rev-e6 removido. Worktree sem alteração.

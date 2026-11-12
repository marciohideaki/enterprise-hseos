# Prompts da onda TD (fechamento)

Regras comuns: `prompts/TB-executor-common.md`. Nesta onda o executor **pode** editar documentação canônica e o `requirements.json`,
mas **nunca** muda um valor de `status.*` (deterministic, real_consumers, operational) de nenhuma família: só textos (`gap`, `tests`,
`evolution_evidence`, `evolution_scope`) e só onde a task diz. Rode `node --test --test-concurrency=1 test/test-kernel-quality-surface.js`
e `node test/test-evolution-trace.js` depois de tocar o `requirements.json`.

## TD1 — reconciliação do inventário e dos docs canônicos (GM-09 a GM-14)

Fonte: `.hseos/runs/dev-squad/20261111-terminal-closeout/TERMINAL-GAP-MAP.md` (linhas GM-09..GM-14 e a revisão). Fazer:
1. `docs/evolution/requirements.json`:
   - F01, F11, F16: acrescentar `evolution_evidence` (lista de strings no mesmo formato das outras famílias, citando
     `docs/evolution/w2/STATUS.md:42` e `:61`, `docs/evolution/w2/evidence/receipt.json`, `test/journeys/core-journey.mjs` e os testes da
     família) e `evolution_scope` que diga **exatamente**: o valor `verified_installed_local_scope_only` foi atribuído em 2026-09-26
     (commit `52f891f2`) com base em CLI/API/SDKs instalados por tarball fora do checkout e jornadas roteirizadas, sem modelo real; o
     ADR-0050 (aceito em 2026-10-31) restringe o valor a binding local instalado (L95) e diz que consumidor sintético não certifica acima
     de L1 (L133, L136); a manutenção do valor depende de ratificação do owner, registrada como OWNER-GATE `OG-01` da run
     `20261111-terminal-closeout`. F21: acrescentar ao `evolution_scope` existente a mesma nota de dependência (`OG-01`), sem apagar o texto atual.
   - F12: `gap` reescrito para dizer que filhos tardios, expansão concorrente e expansão em dois processos estão provados em
     `test/test-workflow-expansion.js` (cite linhas) e que expansão depois do claim é recusada por desenho; incluir esse arquivo em `tests`.
   - F22: `gap` separado em duas frases: contratos de plugin de execução (W4, provados) e catálogo certificado de extensões da IDE (W6,
     fora do terminal).
   - F06: `gap` diz que `not_before` (adiamento) é persistente e provado por reabertura (`test/test-job-control.js`, testes da TB5) e
     que agendamento recorrente não existe (desenho aberto); corrigir a citação do `evolution_scope` de `w4/STATUS.md:582` para a linha de
     `docs/evolution/w4/evidence/final/traceability.md` que trata de FR03 (confira).
2. `docs/evolution/PLAN.md`, seção "Pendências antes de abrir a W6", item 6: A-09 e A-15 fechados no código (cite `.c8-kernel.json` e
   `tools/cli/commands/init.js:88`, `uninstall.js:122`), A-05 segue residual do owner. Acrescentar abaixo da tabela um parágrafo
   "Fechamento do terminal (2026-11-11)" curto, apontando para `docs/evolution/terminal-closeout/` (sem antecipar o veredito; o TD4
   completa).
3. `docs/evolution/pendencias-w0-w5/MAPA.md`: §2 W0 (F23 já `verified_w0_scope_only` desde 2026-11-04) e uma §10 nova curta
   "Fechamento do terminal (run 20261111-terminal-closeout)" listando GM-01..GM-05 fechados pela TB com os arquivos de teste.
4. `docs/evolution/STATUS.md`: uma linha/entrada curta com o mesmo conteúdo (siga o formato do arquivo).
Aceite: guard `test-kernel-quality-surface.js` e `test-evolution-trace.js` verdes; nenhum `status.*` mudou (prove com
`git diff -U0 -- docs/evolution/requirements.json | grep '"deterministic"\|"real_consumers"\|"operational"'` vazio); neutralidade verde.

## TD2 — documentação de usuário do terminal (GM-08)

Arquivo novo `docs/terminal.md` (fora do `files` do pacote; não mude o `package.json`), em português, link a partir de `docs/README.md`.
Seções: o que é o terminal do HSEOS (CLI, API local versionada, SDK JS/TS e Python, MCP moderno e compat, terminais e jobs); requisitos
(Linux, Node 22/24, cgroup v2 delegado, bubblewrap, pidfd; sem eles `ENGINEERING_ISOLATION_UNAVAILABLE`); instalar (tarball, offline);
usar (comandos reais tirados de `hseos --help` e do manifesto da CLI — rode `node tools/cli/hseos-cli.js --help` e os `--help` dos
subcomandos citados; não invente flag); API (`docs/engineering-control-api.md`); limites; **o que não está certificado** (consumidor
real por família, campanhas, quarta integração, navegador e computer-use na CLI, macOS/Windows, acesso remoto, eixo operacional) com
link para `docs/evolution/terminal-closeout/`. Aceite: cada comando citado existe no manifesto (`npm run check:cli` verde e um
script de conferência simples no relatório), neutralidade verde, prettier.

## TD3 — gate de prontidão e pacote de entrada da W6 (GM-16)

1. `docs/evolution/terminal-closeout/terminal-readiness.json`: `schema_version: 1`, `revision` (SHA da master na geração), `verdict`
   (um de `TERMINAL_PRONTO`, `TERMINAL_PRONTO_COM_GATES_DECLARADOS`, `NAO_PRONTO`), `criteria` com T1..T12 (cada um: `id`,
   `description`, `mechanism`, `command`, `evidence` [caminhos no checkout], `result` em `ok|parcial|ausente`, `result_source` [saída
   copiada ou id de run do CI]), e `families` com **todas** as famílias de W0 a W5 (onda 0–5; F23 sem onda conta como W0): `id`, `wave`,
   `deterministic`, `real_consumers` (iguais ao `requirements.json`), `class` (para cada eixo não verificado: uma de `FECHAVEL`,
   `OWNER_DECISAO`, `DEPENDENCIA_EXTERNA`, `GASTO_NECESSARIO`, `DESENHO_ABERTO`, `FORA_DO_TERMINAL`), `owner_gate` (id `OG-NN` do
   `OWNER-GATES.md` da run, obrigatório quando `real_consumers` é `not_verified` ou `deterministic` não é verificado).
   Os valores (resultados, classes, OG) vêm do Commander no prompt da task; o executor não os decide.
2. `test/test-terminal-readiness.js` (registrar `test:terminal-readiness` no `package.json` e no agregado; shards verify) que **falha**:
   T1..T12 ausentes ou duplicados; `result: ok` sem evidência ou com evidência que não resolve para arquivo no checkout; famílias de W0–W5
   faltando ou sobrando; status divergente do `requirements.json`; eixo não verificado sem `class` válida ou sem `owner_gate`; `owner_gate`
   que não aparece no `OWNER-GATES.md` da run; `verdict` incoerente com a regra (qualquer de T1, T2, T5–T10, T12 diferente de `ok` ⇒ não
   pode ser `TERMINAL_PRONTO`; `TERMINAL_PRONTO` exige todas as famílias com `real_consumers` verificado); `W6-ENTRY.md` sem as seções
   obrigatórias. Inclua casos negativos (o teste chama a função de validação com documentos adulterados e espera erro).
3. `docs/evolution/terminal-closeout/W6-ENTRY.md`: seções obrigatórias `## Superfície estável`, `## Versões`, `## Cursor de eventos`,
   `## Terminais`, `## Aprovação`, `## Riscos`, `## Gates do owner`, `## Fora de escopo` — superfície que a IDE vai consumir (versões da
   API `/v1`, do SDK, do protocolo MCP, do schema do ledger; cursor; terminais; aprovação separada de conclusão), **sem iniciar a W6**.

# TC1 - Aceite instalado local (GM-06, GM-07, GM-17)

Run `20261111-terminal-closeout`, task TC1. Revisão: commit `026acac92c6b21cd9c912fc10a3ad80555debeb6` (topo da onda TB, código de produto idêntico ao da master). Data de execução: 2026-11-11/12 (UTC).

## Escopo

Provar, numa instalação limpa do tarball desta revisão, fora do checkout, que CLI, API, SDK JS/TS/Python e MCP (legado e moderno) funcionam ponta a ponta, e que upgrade, downgrade e rollback não reescrevem eventos. Sem gasto, sem chave, sem modelo, sem provedor. Nenhum `project.db` real nem a instalação global foram tocados (os tarballs anteriores foram só lidos). Evidência em `docs/evolution/terminal-closeout/evidence/` (fora do pacote). Nos JSONs, `$TMPDIR` (`/build/tmp`) foi substituído por `<tmp>` e o diretório pessoal por `<home>`.

## Pacote e instalação

| Item                                         | Resultado                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm pack` desta revisão                     | `hseos-4.0.0-rc.0.tgz`, sha256 `a2ed5a455b89232669f88e9426d8048998fd87984c9801d709c546db73ddcb00`, 1550 arquivos |
| tgz schema 17 (`25e673ff`)                   | sha256 `e1ebeab0...677586`, confere com o `package.sha256` ao lado                                               |
| tgz schema 16 (`2b4d6f37`)                   | sha256 `3d130c8b...e52942`, confere com o `verification.json` (sem `package.sha256` no diretório)                |
| `npm install --offline --no-audit --no-fund` | rc=0, 147 pacotes, 3 s, em `consumer-legacy` e em `consumer-modern`                                              |

A instalação totalmente offline foi provada para os dois consumidores (sem recorrer a `--prefer-offline`), com o cache npm desta máquina. Isso não prova instalação em máquina sem cache prévio.

## Jornadas (heavy-run --mem 4G, uma por vez, modo `user`)

| Jornada                                    | Veredito | Contagem                                                | Passos não-PASS |
| ------------------------------------------ | -------- | ------------------------------------------------------- | --------------- |
| `core-journey.mjs` (API, SDK JS/TS/Python) | exit 0   | PASS=12, FAIL=0, BLOCKED=0 (s00 a s11)                  | nenhum          |
| `mcp-journey.mjs` legado                   | PASS     | PASS=144, FAIL=0, BLOCKED=0, NOT_EXERCISED=0, orphans 0 | nenhum          |
| `mcp-journey.mjs --mode modern` (+compat)  | PASS     | PASS=507, FAIL=0, BLOCKED=0, NOT_EXERCISED=0, orphans 0 | nenhum          |

No mcp-journey o `axon` real estava no PATH e foi exercitado (`axon_real: exercised`), em ambos os modos. No moderno o banco foi ativado com fixture ADR-0048 (user_version 17) e o ledger recebeu eventos (`execution:ExecutionAuthorized` 207, `ExecutionStarted` 207, `ExecutionSucceeded` 82, `ExecutionFailed` 125, `mcp_gateway:ExecutionFailed` 124). Achados: lista vazia nos dois.

Arquivos: `core-journey-result.json`, `mcp-legacy-journey-result.json`, `mcp-modern-journey-result.json`, `versions.json`.

## GM-17 - equivalência pela CLI

O `core-journey` usa o binário instalado (`<consumer>/node_modules/.bin/hseos`) e compara com o SDK. Checagens PASS copiadas do resultado:

- s03: "CLI `control query` equals SDK status"; "CLI `control events --after 3` equals SDK page"; "CLI `control prepare` equals SDK prepare" (eventos: 67 pelo JS, TS e Python, paginados de 7 em 7, idênticos à leitura completa);
- s05: "CLI `control job-query` equals SDK".

Tentativa adicional minha, depois da jornada, de consultar o estado mantido (`--keep-work`) com `hseos control query --state <dir> --resource <id>`: erro `ERR_INVALID_URL`. Achado de uso, não defeito: a CLI `control query/events` exige `--url` de um servidor em execução e `--state` só vale para `serve`; com o servidor encerrado não há consulta offline equivalente pela CLI. A equivalência está provada contra o servidor vivo, dentro da jornada.

## Upgrade, downgrade, schema 16 e rollback

Roteiro versionado: `evidence/upgrade-rollback.mjs`; saída: `evidence/upgrade-rollback-result.json`. Hash de eventos: sha256 do JSON das linhas de `execution_events` em ordem de posição (posição, ids, tipo, agregado, sequência, versão de schema, `occurred_at`, correlação, causação, ator, operação, payload, referências), calculado numa cópia do arquivo; hash por evento além do hash do conjunto.

**(a) Mesmo schema 17.** Banco ativado e com 3 eventos pelo pacote `25e673ff` (user_version 4 -> 17, 13 migrações, backup com sha igual ao original). Instalada esta revisão por cima (`npm install --offline`): `resolveGovernedExecutionMode` retorna `modern`/17; leitura e anexação de 2 eventos ok. Resultado: os 3 hashes antigos são iguais antes e depois, `only_appended=2`, user_version 17, `integrity_check` = ok. PASS.

**(b) Downgrade (pacote de schema 16 sobre banco 17).** O pacote `2b4d6f37` recusa abrir: `EXECUTION_ACTIVATION_PENDING` ("Operational state requires schema v4; pending execution schema is not activated"); a CLI `hseos state-list` com `HSEOS_STATE_DB` apontando ao banco sai com rc=1 e o mesmo código. sha256 do arquivo do banco antes e depois idêntico (`ae675463...103b5b`), sem arquivos `-wal`/`-shm` criados, eventos inalterados. PASS: recusa sem escrita. Observação: esse pacote não exporta `resolveGovernedExecutionMode`, então só a abertura e a CLI foram usadas como prova de recusa.

**(c) Schema 16 -> 17.** O pacote `2b4d6f37` não contém código de ativação (`activateExecutionLedger` ausente; só as migrações 005 a 016 em `migrations-pending-activation`), então um banco ativado em 16 não pode ser produzido com ele. Reconstruí um banco user_version 16 com 3 eventos usando o ativador desta revisão apontado para as migrações 005-016 extraídas do tarball (reconstrução, não artefato nativo daquele pacote). Esta revisão, ao abri-lo: `EXECUTION_ACTIVATION_PENDING` ("inconsistent (user_version 16, expected 4 or 17)"), em modo e em anexação; `planExecutionLedgerActivation` e `hseos execution-activation plan` (rc=2): bloqueio `EXECUTION_ACTIVATION_ALREADY_ACTIVATED`. sha256 do arquivo e hashes de eventos inalterados. Resultado: **recusa verificada; migração 16 -> 17 pelo produto: BLOCKED**, porque o produto não oferece caminho (a ativação só aceita banco v4; recusa também um 16 "ativado"). O caminho seguro hoje é restaurar o backup pré-ativação. Decisão humana necessária se se quiser um caminho 16 -> 17.

**(d) Rollback.** Banco v4 (sha `80ba02dd...ad7490e`) ativado com 2 eventos; `hseos execution-activation rollback --db --backup --expected-sha256` (rc=0): `restored: true`, `receipt_verified: true`, `content_matches_original: true`, sha restaurado igual ao backup e ao original, user_version 4, sem tabelas de execução, `integrity_check` ok. O arquivo ativado foi preservado (`post_activation_writes_preserved_at`) e seus 2 eventos têm hashes iguais aos de antes do rollback. Os eventos posteriores à ativação deixam de existir no banco restaurado, por desenho do rollback; não foram reescritos, ficam na cópia preservada.

## Higiene

Varredura de segredo (`sk-`, `ghp_`, `AKIA`, `-----BEGIN`) sobre todos os arquivos de `evidence/`: 0 acertos (a primeira passada com `sk-` sem fronteira acusou 31 falsos positivos em ids como `task-traversal` e `task-<timestamp>`; com fronteira de palavra e comprimento mínimo, 0). Scratch removido (`$TMPDIR/tc` e o diretório de fixture do core-journey).

## does_not_prove

- Respostas são fixtures roteirizadas: nenhum modelo, provedor ou gasto reais; adaptadores `not_certified`, provider binding positivo não exercitado.
- Somente Linux (kernel 7.0.0-42, Node 24.15.0 e sandbox Node 22.22.1, bwrap 0.11.1), cgroup delegado do systemd --user desta máquina; `--service-mode system` e CI não exercitados.
- Instalação offline provada só com o cache npm local; máquina limpa sem cache não.
- ADR-0048 foi fixture `Accepted`; o ADR real não foi aceito nem tocado. A ativação no projeto real não foi exercitada.
- O banco schema 16 de (c) é reconstrução com o ativador atual e as migrações de 16; não prova o comportamento de um banco realmente ativado por aquele pacote (que não tinha ativador).
- (a) a (d) usaram bancos descartáveis com poucos eventos de tipo `ControlCommandRecorded`; não cobrem volume, projeções populadas nem corrupção.
- Rollback restaura o estado pré-ativação; não prova rollback parcial nem preservação dos eventos pós-ativação no banco restaurado.
- Consulta offline do estado pela CLI (sem servidor) não existe; GM-17 vale contra servidor vivo.

# FINAL-REPORT — run `20261113-repo-hygiene`

## Veredito: **HIGIENIZADO COM GATES**

- **Andaime removido e arquivado.** Todo arquivo classificado como ANDAIME por prova determinística saiu do repositório: são 145. Antes de removê-los, a árvore foi arquivada na tag `hseos-hygiene-archive-20261113`, publicada.
- **Branches e worktrees.** Não restou nenhuma branch nem worktree órfão dentro do que a seção 1 do prompt autoriza apagar.
- **Guard.** O guard contra reacúmulo está ativo na suíte e verde no CI.
- **OWNER-GATES.** 11 itens ficam para decisão do owner (`OWNER-GATES.md`).

## Números (fatos de ferramenta)

| Medida | Antes (`a4fabbd5`) | Depois (`4e797b52`) | Notas |
|---|---|---|---|
| Arquivos versionados | 4986 | 4863 | A #320, de outra sessão, entrou no meio. Pela higiene, contando a partir da tag: −145, +6 e 3 modificados |
| `.hseos/runs` | 293 | 163 | −143 removidos; +13 são registros desta run |
| `docs/audits` | 3 | 1 | Fica `PCCP-COMPLETION-AUDIT.md`, que é citado |
| Bytes versionados | 65,4 MB | 68,9 MB | **A higiene não reduziu bytes.** Saíram 0,56 MB. Entraram 3,8 MB em `docs/hygiene/`, quase tudo o `reference-graph.json` que o prompt mandou versionar. O resto do crescimento veio da #320 |
| Worktrees | 9 (2 prunable) | 5 | O principal mais 4 de outras sessões (OG-H06) |
| Branches locais | 36 | 5 | `master` mais 4 de outra sessão (`*provider-publication*`, `task/provider-release-ci`, `archive/…`) |
| Branches remotas | 17 | 8 | Nenhuma órfã autorizada restante |

## O que foi removido, por classe

| Classe | Itens | Destino |
|---|---|---|
| ANDAIME (versionado) | 145 arquivos, 562188 B: 140 registros de run de `dev-squad` não citados (prompts, logs, INTAKE/PLAN sem citante e o ponteiro `.current-run-id`), a run `standalone-migration` (3) e `docs/audits/2026-09-07-repository-consolidation/` (2) | Recuperação: `git show hseos-hygiene-archive-20261113:<caminho>`. Lista: `docs/hygiene/20261113/MANIFEST.md` |
| DUPLICADO | 0 | A hipótese de que `.specs/` da raiz duplicaria `.enterprise/.specs` foi refutada: 0 de 42 blobs iguais |
| Branches locais | 28 apagadas: 14 patch-equivalentes; 14 com commit sem equivalente, preservadas antes em bundle verificado | `/build/artifacts/hygiene-20261113/` (14 bundles, `SHA256SUMS` `079bf4a6…`, `README.md` de recuperação). Cada arquivo foi classificado: 0 únicos |
| Branches remotas | 8 apagadas, todas com PR MERGED, ponta conferida na hora e `git cherry` sem `+` | Patch-equivalentes na `master` |
| Worktrees | 2 registros `prunable` (diretórios ausentes) | `git worktree prune` |
| LIXO-LOCAL | 75 logs ignorados com mais de 7 dias, 3674718 B | Regeneráveis; nada versionado |

**Ficam, com prova:**
- `docs/evolution/**`, `docs/v4`, `_graph`, `docs/evidence`: evidência citada. A cadeia continua ancorada por documento vivo, teste, ADR ou guard mesmo no cenário mais permissivo.
- `.specs/`, `plugins/`, `smithery.yaml`, `docs/releases/`, `.logs/` versionado: são necessários.

## Guard novo

`test/helpers/repo-hygiene.js` lê a política `docs/hygiene/repo-hygiene-policy.json`. Os casos ficam em `test/test-governance-scripts.js`, que roda no passo `test:governance` da suíte e do CI. O mecanismo é o ADR-0052. Regras:

| Regra | O que bloqueia |
|---|---|
| R1 | Raiz versionada fora da lista |
| R2 | Run sem `STATUS.md` |
| R3 | Arquivo solto em `.hseos/runs` |
| R4 | Entrada nova no topo de `docs/evolution/` |
| R5 | Caminho removido que volta, ou manifest de remoção ausente ou vazio |

Mudar a política de propósito exige PR revisada.

## OWNER-GATES (ação exata em `OWNER-GATES.md`)

| ID | Item |
|---|---|
| OG-H01 | `HSEOS-GOAL-HARNESS-AUTONOMO.md` e `_pipeline/`: são versionados (o prompt os supunha não versionados). Ficam até o owner decidir |
| OG-H02 | Remotas `backup/*` e `preservation/*` |
| OG-H03 | Remotas `feature/stab3-f14v4-spec` (#310) e `feature/stab3-f15l2-fix` (#306): MERGED, mas sem patch-equivalência. Têm bundle |
| OG-H04 | Remota `feature/capability-graph-governance` (#146 CLOSED, 8 commits únicos) |
| OG-H05 | Remota `feature/solo-maintainer-protection` (contida na `master`, sem PR) |
| OG-H06 | Worktrees e branches de outras sessões |
| OG-H07 | Cerca de 84 arquivos de run citados só pelo `STATUS.md` da própria run |
| OG-H08 | `docs/goals/` (11), citado pela especificação pt-br |
| OG-H09 | `/build/artifacts` (bundles desta run e resíduo de 2026-11-06) não é backup durável |
| OG-H10 | `$TMPDIR/hseos-*` (933 entradas, cerca de 310 MB, nenhuma com mais de 7 dias) e o vazamento de origem nos testes |
| OG-H11 | Ratificar a regra D2 (inventários-instantâneo não citam), que liberou 53 dos 145 |

## Evidência por onda

| Onda | PR | Merge | Tag | Validação |
|---|---|---|---|---|
| HA (análise) | #321 | `56478fa4` | `hseos-hygiene-wa` | Suíte de linha de base: 115/116 itens com teto de 4G; o kernel-coverage passou com 8G (2466/0). CI com 24 checks verdes |
| HB (git) | — | — | — | Revisão APROVADO |
| Arquivo | — | — | `hseos-hygiene-archive-20261113` (`56478fa4`) | Publicada antes da remoção |
| HC (remoção) | #322 | `af343965` | `hseos-hygiene-wc` | Suíte completa simulada com 117 passos pass; 0 links quebrados novos; CI da `master` pós-remoção verde |
| HD (guard) | #323 | `4e797b52` | `hseos-hygiene-wd` | Guard 19/0, mutação R1–R5; CI com 24 checks verdes |
| HE (fechamento) | PR desta onda | — | `hseos-hygiene-close` no merge | Reauditoria cega final: HIGIENIZADO COM GATES |

Revisões: `REVIEW-HA.md`, `REVIEW-HB.md`, `REVIEW-HC-HD.md` e `REAUDIT-FINAL.md`. Gasto pago: US$ 0. Nenhuma mudança em `package.json` pela higiene, em status de família, em ADR, em publicação ou em ativação.

## O que a higiene não prova

- **Leitura dinâmica de caminhos** (`path.join`, `readdir`): não aparece no grafo. A cobertura dela vem da suíte completa e do CI depois da remoção.
- **Citações sem caminho:** uma citação pelo nome da run ou por um nome de arquivo genérico não protege o arquivo. Links absolutos para o GitHub e menções em prosa não foram verificados.
- **Leitores externos:** não prova que nenhum leitor fora do repositório (vault, outras ferramentas) use os registros removidos. Todos continuam recuperáveis pela tag.
- **`git cherry` e "superado":** `git cherry` prova equivalência de patch, não de valor. "Superado" quer dizer apenas que o arquivo foi alterado depois. Os bundles cobrem esse risco, mas só nesta máquina (OG-H09).
- **Limites do guard:** a R4 cobre só o 1º nível de `docs/evolution/`. O guard vê apenas o índice git e não barra arquivo grande nem duplicata.
- **Cobertura da classificação:** a classificação é conservadora. Ficaram 2,9% de redução em número de arquivos; o restante depende do owner (OG-H07, OG-H08, OG-H11).

## Incidentes

- **Teto de memória:** o teto de 4G do `heavy-run` era pequeno demais para o kernel-coverage. A decisão D1 fixou 8G. Nenhum limiar mudou.
- **Merge da HA2 com arquivos não versionados:** a primeira tentativa de merge falhou porque os arquivos não versionados da run, no checkout principal, colidiam com os do commit. Ao conferir, o commit e a branch da task estavam intactos (não foram apagados pelo `remove`). Os arquivos não versionados eram idênticos aos do commit. A cópia não versionada foi removida e o merge foi refeito.
- **Edição da HC3 perdida:** o `validate` da HC3 falhou porque o Node do `PATH` era o 22, e o `remove` seguinte, encadeado com `;`, apagou a edição ainda não commitada. A edição foi refeita por script, validada com Node 24 e só então commitada.
- **Fila do `heavy-run`:** a suíte da HC esperou cerca de 1 h na fila, atrás de jobs de outras sessões (exit 75 na primeira tentativa).

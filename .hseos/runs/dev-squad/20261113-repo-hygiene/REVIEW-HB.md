# REVIEW-HB — revisão cética da higiene de git (onda HB)

Revisor Sonnet isolado, em duas passagens (cega e confronto). Ele reporta e não corrige. Veredito: **APROVADO**, com 0 BLOCKER e 0 MAJOR.

## Passagem cega: regras R1 a R4

| Regra | Resultado | Evidência |
|---|---|---|
| R1. Branch local apagada só se contida, patch-equivalente ou com bundle | cumprida | 28 apagadas. 14 têm `git cherry` sem `+`. As outras 14 têm bundle cuja `list-heads` bate com a ponta antiga. Os 14 bundles passam em `git bundle verify`. `sha256sum -c` dá 14 de 14 OK |
| R2. Branch remota apagada só se a PR foi MERGED e a ponta é equivalente | cumprida | 8 remotas. Para cada uma: PR MERGED (#299, #302, #307, #308, #309, #311, #312, #313), `headRefOid` igual ao recibo e `cherry` só com `-` |
| R3. Intocados | cumprida | Os SHAs de `backup/*`, `preservation/*`, `capability-graph-governance`, `solo-maintainer-protection`, `stab3-f14v4-spec`, `stab3-f15l2-fix`, `repo-hygiene-ha` e das branches e worktrees de outras sessões são iguais aos do recibo de antes |
| R4. Nada único perdido | cumprida | A classificação de cada arquivo foi refeita: 0 arquivos únicos. Os que não estão integrados aparecem como superados, porque a `master` alterou o arquivo depois |

## Confronto com o recibo

As contagens de antes e depois conferem. Os textos do `GIT-HYGIENE.md` e do `README.md` dos bundles também conferem.

## Ressalvas (MINOR e NOTE)

- **MINOR-1.** "Superado" significa só que a `master` alterou o arquivo depois. Não prova que o conteúdo perdeu o valor. Os 9 arquivos superados estão cobertos pelos bundles.
- **MINOR-2.** Os bundles existem só em `/build/artifacts`, que não é armazenamento durável. Isso já está registrado em OG-H09.
- **MINOR-3.** As 14 branches patch-equivalentes ficaram sem bundle. A garantia delas é a equivalência de patch na `master`.
- **NOTE-1.** `task/provider-native-compose` (`d9e2d1fd` → `080a5416`) recebeu um commit de outra sessão durante a onda. Não é efeito da HB.
- **NOTE-2.** O recibo `before-worktrees.txt` foi compactado pelo filtro de saída do shell, então a contagem de 9 worktrees antes não é verificável por texto. Ela é coerente com 7 restantes mais 2 removidos pelo prune.

Sha256 do `SHA256SUMS` dos bundles: `079bf4a626567bed2d62609c7b73ba3f50b122915a5ddabc256aec6a1ad15209`.

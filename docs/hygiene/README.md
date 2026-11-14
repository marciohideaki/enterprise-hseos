# Higiene do repositório

Esta pasta guarda a política do guard contra o reacúmulo de andaime (relatórios de run, rascunhos e planos soltos) e os registros das auditorias de higiene. Nada aqui é empacotado.

## O guard

A política fica em `repo-hygiene-policy.json`. A lógica pura está em `test/helpers/repo-hygiene.js` e é exercida por `test/test-governance-scripts.js`. O guard lê a lista de arquivos versionados (`git ls-files`) e aplica cinco regras:

| Regra | Violação                | O que exige                                                                                                                       |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R1    | `root-not-allowed`      | Todo arquivo versionado tem primeiro componente de caminho em `allowedRoots`.                                                     |
| R2    | `run-without-status`    | Toda run `.hseos/runs/<categoria>/<run>/` com arquivo versionado tem `STATUS.md` versionado.                                      |
| R3    | `loose-run-file`        | Nenhum arquivo versionado direto em `.hseos/runs/` nem em `.hseos/runs/<categoria>/`.                                             |
| R4    | `docs-evolution-entry`  | Toda entrada de 1º nível de `docs/evolution/` está em `docsEvolutionEntries`.                                                     |
| R5    | `removed-path-returned` | Nenhum caminho listado em `removalManifests` volta a ser versionado. Manifest ausente ou vazio também é violação (falha fechada). |

## Mudar a política de propósito

Para aceitar uma nova raiz, entrada de `docs/evolution/` ou manifest, edite `repo-hygiene-policy.json` na mesma PR que introduz o arquivo e justifique na descrição. A mudança é sempre revisada. Não afrouxe a regra nem apague o teste para fazer uma PR passar.

## Enforcement

Teste determinístico no passo `test:governance` da suíte (`test/test-governance-scripts.js`), que roda em todo PR pelo CI (ADR-0052, política `deterministic-first`).

## Limite conhecido

R4 só confere os nomes de 1º nível. Ela não prova que cada arquivo de `docs/evolution/` tem citação viva, porque isso exige o grafo de referências completo, caro demais para a suíte. O grafo de `20261113/` é a ferramenta para auditorias periódicas.

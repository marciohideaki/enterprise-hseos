# T1a - triagem de `ci/commit-tier-gates`

Run `20261106-1721-stab2-wave-a`. Proposta para o owner decidir; nada foi mesclado.

## Origem

- Bundle `residue-branches.bundle`, ramo `ci/commit-tier-gates`, 2 commits sobre a base `eecfaa90`:
  `ab76dba5` (divide a validacao em faixa de commit e faixa de PR) e `27147390` (documenta as faixas).
- Diff contra a base: 4 arquivos, +139 -9.
- A master atual e `1d061a05` (ramo `feature/stab2-wave-a`).

## Tabela por arquivo

| Arquivo                               | Alterado na master desde a base?                    | Situacao                              | Evidencia                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.husky/pre-commit`                   | nao                                                 | Falta na master; sem conflito         | Master ainda chama `quality-gates.sh --phase code`; o ramo troca para `--phase commit`.                                                                                                                     |
| `AGENTS.md`                           | nao                                                 | Falta na master; sem conflito textual | Master (linha 166) diz que o hook roda `--phase code`; o ramo reescreve com tabela de faixas (Commit, Commit message, Pull request, Manual). Texto fica incoerente com a master (ver abaixo).               |
| `scripts/governance/quality-gates.sh` | sim, 3 commits (`64be5e19`, `a068913c`, `f1d1f72e`) | Conflita                              | Conflito de conteudo na linha de uso: master descreve o Gate 3 "light" e `HSEOS_HOOK_MODE`; o ramo troca por `<doc\|commit\|code\|ci>`. Os demais trechos mesclam sem marcador, mas se sobrepoem em funcao. |
| `test/test-governance-scripts.js`     | nao                                                 | Falta na master; sem conflito         | O ramo acrescenta o teste "commit-tier gate lints only staged files and never runs the test chain" (+44). Ele exige `--phase commit` no hook e `gate_code_staged`.                                          |

## Resultado do merge

`git merge-tree --write-tree HEAD refs/tmp-stab2/T1a` terminou com codigo 1:
`CONFLICT (content): Merge conflict in scripts/governance/quality-gates.sh`. Os outros 3 arquivos mesclam limpos.

Conforme o criterio, nao forcei o merge e nao rodei o teste do ramo contra a master. O worktree ficou sem alteracao alem deste documento.

## Analise de sobreposicao

A master resolveu o mesmo problema (commit lento) por outro caminho, em `64be5e19`, `a068913c` e `f1d1f72e`:

- O hook continua em `--phase code`, mas o Gate 3 roda no modo "light" por padrao (`HSEOS_HOOK_MODE=light`, escape `--full`).
- `gate_code_light` faz lint e prettier dos arquivos staged, roda os testes dos arquivos tocados e dos que os referenciam, com teto `HSEOS_HOOK_MAX_TESTS=40`, e sempre roda o gate de superficie de pacote (G3).
- A suite completa roda no CI em shards (`ci.yaml`), com `systemd-run` e `Delegate=yes`.

O ramo propoe uma faixa de commit diferente: `gate_code_staged` (lint dos staged e schema de agente, sem testes) e uma fase nova `commit`. Isso e uma segunda implementacao do mesmo objetivo, com semantica menor que a da master: nao roda nenhum teste no commit, enquanto a master roda os testes afetados.

Trechos que ainda teriam valor e nao existem na master:

1. `with_delegated_cgroup` e `HSEOS_DELEGATE_CGROUP=1`: roda `npm test` local num scope de usuario com `Delegate=yes`, porque as suites de isolamento de agente exigem cgroup delegado. Na master, `run_node_check` executa `"$@"` direto. A necessidade e real para o `--full`/`--phase code` completo, mas nao foi verificado se ainda ocorre.
2. A tabela de faixas em `AGENTS.md` (commit, commit-msg, PR, manual) e a nota de que mover checagem pesada para os checks obrigatorios do PR nao enfraquece o gate. Precisaria ser reescrita para descrever o modo light.

## Veredito proposto: descartar o ramo e, se o owner quiser, reescrever so dois itens

- **Descartar** a implementacao `--phase commit` / `gate_code_staged` e o teste associado: estao superados pelo hook light da master (3 commits posteriores a base) e conflitam com ele.
- **Opcional, como tarefa pequena nova na master** (nao como merge do ramo):
  a) documentar em `AGENTS.md` a faixa real (hook light, CI em shards, `--full` manual), pois a secao 8 ainda diz apenas `--phase code`;
  b) avaliar a cgroup delegada local para `--full`, apenas se o problema das suites de isolamento for reproduzido.
- Razao: aplicar o ramo exigiria resolver o conflito manualmente e conviver com dois mecanismos para o mesmo fim, sem ganho sobre o que a master ja entrega.

## Nao verificado

- Teste do ramo contra a master (nao executado por causa do conflito).
- Se o ramo, depois de resolvido o conflito do cabecalho, compilaria e passaria no teste proprio.
- Se a necessidade de cgroup delegado local ainda ocorre na master.
- Se ha regras de branch protection (`.github/branch-protection.yaml`) que o ramo assumiria; nao li.

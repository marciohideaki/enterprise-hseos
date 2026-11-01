# R-A3 — revisão cética da task A3 (commit dd7f106b)

Veredito: **PASS-WITH-NOTES**

## Passagem 1 (cega)
1. Enum: `not_verified_for_evolution` | `/^verified_w([0-8])_scope_only$/`. Sondas com espaço antes/depois, `\n` final, maiúscula (`Verified_`, `W1`) e sufixo (`x`, `_extra`): todas recusadas. `w08` e `w9` recusados nos testes.
2. `LEGACY_DETERMINISTIC`: 18 famílias, comparação programática com `requirements.json` (ID e valor): idêntica. Nenhuma família fora dela passa sem `deterministic_evidence` resolvível (teste 1 faz deepEqual entre os não evidenciados e o legado). Alterar F01 de w2 para w3 no JSON de uma cópia descartável derrubou o teste (exit 1, 12/13).
3. Contenção: realpath + `startsWith(root+sep)` + `isFile`. Testes cobrem `../outside`, arquivo existente fora (relativo e absoluto), inexistente, diretório, lista vazia, evidência em família não promovida.
4. `requirements.json` não consta no diff (`git diff --stat` vazio); 1 arquivo alterado, test/test-kernel-quality-surface.js (+103).
5. Mutações minhas (cópia em /build/tmp/rev-a3, removida): (a) remover F22 do legado: derrubou 1 teste; (b) `[0-8]` para `[0-9]`: derrubou 1 teste; (c) bônus, mudar valor de legado: derrubou 1 teste.
6. Gates via cg.sh (Node 24): test-kernel-quality-surface 13/13 exit 0; `ci-test-shards verify --shards 6` OK (102 itens); eslint 0; prettier OK. Worktree limpo.
7. Sem atribuição de IA no diff nem na mensagem do commit.

## Passagem 2 (confronto com logs/A3.md)
Todas as alegações confirmadas: 18 famílias (F01-F06, F09-F16, F19-F22), 13/13, legado re-promovido em outra onda exige evidência, nenhum status mudou, mutações derrubam teste, verify/eslint/prettier OK. Não verifiquei o "14/14 do hook de commit" nem o vermelho inicial (ReferenceError); sem o estado pré-commit, aceito por não refutável.

## Notas (não bloqueantes)
- `root = path.resolve(__dirname, '..')` não passa por realpath; se o checkout estiver sob caminho com symlink, evidência legítima seria recusada (falha fechada, não permissiva). Mesmo padrão dos guards de `operational`/`real_consumers`.
- Os 18 do legado continuam sem evidência; decisão de retroagir fica para o owner/ondas futuras, conforme a spec.

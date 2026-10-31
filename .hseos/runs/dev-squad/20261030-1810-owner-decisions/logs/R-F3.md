# R-F3 — revisão cética de F3 (commit eaeb9046)

Veredito: PASS-WITH-NOTES

## Achados
1. ADR-0050: `**Status:** Accepted — 2026-10-31` casa com `ACCEPTED_STATUS_LINE` (`Accepted — <data>`) e o parser lê a forma inline `**Status:**` (ADR-0003 etc. a usam). As 12 respostas são literais ao PLAN-3. Nenhuma decisão acrescentada; "Activation date" ganhou texto próprio ("critério vigente; nenhuma campanha autorizada"), coerente com o corpo. Os "a confirmar" sumiram (grep limpo). Respostas citadas no corpo: 1,2,3,4,5,6,7,9,11,12. As respostas 8 (quarta família liberada para planejamento) e 10 só estão na lista final, sem citação no corpo (nota menor; a 10 é a regra 7 dos pré-requisitos, já no corpo).
2. `_INDEX.md`: `git diff -w` reduz o diff a 2 linhas: a linha separadora da tabela (largura) e a linha do ADR-0050 (Accepted; removido "aguarda aceite"; acrescentado o valor novo). Nenhuma outra linha mudou de conteúdo.
3. Guard `real_consumers`: enum fechado = 3 valores; no `requirements.json` só existem `not_verified` (23) e `verified_installed_local_scope_only` (4). Valor novo exige `real_consumers_evidence` não vazio, resolvido por realpath, arquivo, dentro do checkout; evidência em outro valor é recusada. `requirements.json` intacto, nenhuma família mudou de status.
4. Mutações minhas (cópia em /build/tmp/rev-f3, removida): (m1) aceitar valor desconhecido -> teste do guard falha (morta); (m2) pular a resolução da evidência -> falha (morta). Base: 2 pass.
5. MAPA §8: (d) desligado, (e) não reduzir/F19 `not_authorized`, ADR-0050 aceito com as 12 respostas, ADR-0049 com 14 pendentes: fiel. MRTR descrito como sondagem do Commander, sem resultado.
6. Execução (cg.sh, Node 24): 3 arquivos de teste = 19 pass, 0 fail; `verify --shards 6` OK (102 itens); prettier limpo nos arquivos do commit. Sem atribuição de IA na mensagem do commit.

## Notas (não bloqueiam)
- LACUNA DE TESTE: a mutação m3 (remover só a cláusula `resolved.startsWith(root + sep)`) sobrevive (2 pass). O caso "path outside the checkout" usa `../outside`, que não existe e cai em "does not resolve" pelo catch, logo a checagem de contenção não é exercida de verdade. Um arquivo existente fora do checkout seria aceito se a cláusula fosse removida. Sugestão: caso com arquivo real fora do root (ex.: `../` + um arquivo existente do pai, ou symlink) no teste negativo.
- Passagem 2 (confronto com logs/F3.md): "19 pass" confirmado; "mutações mortas" confirmado para as duas alegadas (enum e exigência de evidência), mas a alegação não cobre a contenção, que não é testada (nota acima). O log admite que o guard entrou sem vermelho prévio; aceitável.
- `logs/F2.md` aparece como não rastreado no worktree (outra task); não faz parte do commit.

## Reconferência rodada 1 (cb30add0)
Veredito: PASS
1. Teste de contenção agora usa arquivo existente fora do checkout, por caminho relativo (`..`) e absoluto. Minha mutação 3 (remover só o `startsWith(root)`) morre (era 2 pass, agora fail).
2. Respostas 8 e 10 citadas no corpo (pré-requisito 7 e "Quem autoriza"), sem decisão nova.
3. test-kernel-quality-surface + test-documentation-neutrality via cg.sh passam; `verify --shards 6` OK; prettier limpo.
4. O arquivo temporário é criado em `$TMPDIR` e removido por `t.after(rmSync)`; nenhum `real-consumers-*` restante.

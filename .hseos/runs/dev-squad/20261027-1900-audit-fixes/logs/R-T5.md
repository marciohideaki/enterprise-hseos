# R-T5 — revisão cética do commit ad8c91cc (worktree audit-t5-control-lock)

Veredito: **PASS-WITH-NOTES**. HEAD confirmado = ad8c91cc; worktree limpo.

## Achados

| # | Sev | Local | Achado |
|---|---|---|---|
| 1 | média/baixa | `tools/cli/installers/lib/core/installer.js:78-83` (ramo "devolve via link") | O rename + link de devolução não é atômico: entre o `rename(takeover, aside)` e o `link(aside, takeover)` o caminho do mutex está vazio. Um terceiro taker C cria o mutex (`wx`) nessa janela. Resultado: o link falha, o mutex de B (fresco, vivo) foi substituído pelo de C, e B segue na seção crítica achando que a detém. B e C ficam juntos dentro do mutex, e o `remove(takeover)` do primeiro a sair apaga o mutex do outro. Consequência: dois takers podem reler "dead" e um deles remover (`installer.js` `fs.remove(lockFile)`) o lock recém-criado por um holder vivo. Reproduzido por injeção determinística (`/build/tmp/rev-t5/scr/race.js`, saída: "third taker C acquired mutex while B (fresh) believed to hold it", mutex final = `C-taker`). Exige mutex velho + 3 takers + janela de microssegundos. O executor declarou esse limite residual, então não é omissão. É estritamente menor que a corrida original (stat-then-remove), mas "fecha a corrida" no commit/comentário é exagero: ela foi estreitada, não eliminada. Sem teste cobrindo esse ramo de devolução. |
| 2 | baixa | `test/test-install-lock.js` (teste "live holder is refused immediately") | O limite `< 1000 ms` não mata o mutante `holder.alive \|\|` removido: com holder vivo o `acquireTakeover` tem sucesso, o laço roda sem sleep e recusa em ~74 ms (o executor mediu o mesmo). Quem mata é a asserção `mutexWrites == []`. Ela é determinística e independe do tempo do host; o limite de tempo é decorativo (não flaky, só inócuo). O comentário "Time limits below leave room..." sugere que o tempo importa. |
| 3 | info | teste empty/half-written | A asserção usa 2 s do código (`age < 2000`, `installer.js:~56`) e envelhece o arquivo em 10 s (não é o 10 s do mutex, outro número). Não pina a fronteira de 2 s; um mutante 2000→9000 sobreviveria. Aceitável. |
| 4 | info | `:307` ensureDir | Justificado: o lock vive em `projectDir`. Mas o comentário "no refusal creates it" é impreciso: recusa em diretório inexistente cria o diretório (ensureDir precede o lock). A afirmação correta é "criado antes, pois o lock exige". Não é erro de comportamento. |

## Interleavings do `acquireTakeover` (raciocínio)
- Dois takers, mutex velho S: A rename(S)→aside, B rename → ENOENT → catch → retry `wx` (pode ganhar, A também retenta e perde com EEXIST+fresco → false). Seguro.
- A stat S; B remove S e cria F; A rename(F): `ino`/`mtime` diferem → devolve (achado 1). Reuso de inode é improvável porque `mtimeMs` também é comparado.
- Preso para sempre: não. Crash entre rename e remove deixa `.takeover.stale.*` órfão (inofensivo, não bloqueia); mutex órfão é reclamado após 10 s.
- Remover o lock de install de holder vivo: só via achado 1 (dois dentro do mutex). Sem ele, o re-read sob o mutex protege.

## Verificações executadas
- Mutante `:363` (`admission && binding`→`binding`) em cópia: só o teste novo falha (control 25/26). Morto.
- Mutante `:390` (`if (admission)`→`if (true)`): só o teste novo falha (plugin-model 22/23). Morto.
- Mutante `holder.alive ||` removido: 17/18, falha o teste novo "live holder". Morto.
- Mutante "sem checagem ino/mtime" e "volta a `remove(takeover)`": ambos 17/18, falha o teste de corrida novo. Mortos.
- `test-install-lock.js` 5x: 18/18 em todas, sem flakiness.
- test-engineering-control 26/26; plugin-model 23/23; task-contract 60/60; install-non-interactive 3/3; install-upgrade-path 16/16; package-surface 1/1.
- eslint e prettier limpos nos 4 arquivos. Diff de test/ só adiciona (18+16+97 inserções, 0 remoções). Mensagem do commit sem atribuição de IA; assunto com 91 caracteres.

## Alegação → veredito
| Alegação do executor | Resultado |
|---|---|
| rename atômico + checagem ino/mtime + devolução via link | Confirmada (com a ressalva do achado 1) |
| ensureDir antes do lock, comentário adicionado | Confirmada (ver achado 4) |
| 18 casos passam; só 1 falha com installer de HEAD anterior | Parcialmente verificada: mutante "remove(takeover)" reproduz 17/18 |
| Contagens 26 / 83 (23+60) / 20 (3+16+1) | Confirmadas |
| eslint/prettier limpos | Confirmada |
| Mutantes :363, :390 e holder.alive mortos | Confirmada |
| Limite de 1 s sozinho não mata o mutante | Confirmada (achado 2) |
| Limite residual da janela rename→link | Confirmada e reproduzida (achado 1) |
| c8 não medido porque control.js não foi tocado | Confirmada: diff não toca `engineering-control.js` |

## Não verificado
- Teste do executor contra o installer de HEAD anterior (usei mutante equivalente, não o arquivo original).
- c8.
- Comportamento em FS sem hard links no ramo de devolução (`link` com `.catch(() => {})` engole EPERM; nesse FS o mutex fresco devolvido seria perdido, agravando o achado 1; não testado).
- Suíte completa.
- Limpeza: cópias em /build/tmp/rev-t5 removidas ao fim.

# R-E1 — revisão cética da E1 (a9a8ad95)

Veredito: **PASS-WITH-NOTES**. Revisor reporta, não corrige.

## Itens
1. Decisões registradas: PASS, com nota N1. Bloco `w5/STATUS.md` (+13): item 4 "em correção (W5/E4); aceite residual a confirmar", não consta como aceito; 5/11/16/19 aceitos com data; 23 confirmado; 24 resolvido (#259). MAPA §5 itens 2–6 e 8 com data e destino. A-05/A-15/N-1/N-3 aparecem só com onda prevista.
2. "Corrigido em PR" só para mergeado: PASS. A-16 e A-09 (parcial) apontam #259; A-07 aponta #260; item 24 aponta #259 e `.c8-kernel.json` ganhou `packages/agent-environment/index.js` na #259 (confirmado no diff do merge). A-17 não usa PR.
3. Originais intactos: PASS. `w5/STATUS.md` tem 0 linhas removidas; nenhum `evidence/**` tocado. Remoções no MAPA/PLAN são só reescrita dos itens 2–6/8/9 do §5 (acréscimo de "Decidido em...") e realinhamento de tabela do PLAN (espaços).
4. MAPA sem dupla verdade: PASS. §5 e §8 "Estado em 2026-10-30" concordam entre si e com o bloco do STATUS. Observação: o texto antigo do §8 ("Nenhum item abaixo está mergeado") continua acima da nova subseção e vira anacrônico (N2).
5. Runbook: PASS. `contract-registry.js:479-481` e `store.js:157` (`admitWrite`) sustentam "deny por padrão + varredura de credencial". Não há afirmação de aprovação de runtime.
6. Cópia da reauditoria: PASS. Diferença com o original: só linhas em branco (prettier) mais o cabeçalho de 2 linhas.
7. Verificações: PASS. `test-documentation-neutrality.js` 2/2 verde; `ci-test-shards verify --shards 6` OK; prettier --check OK nos 5 .md; links da cópia resolvem (CONFORMIDADE, MAPA); commit sem atribuição de IA.

## Passagem 2 (confronto com as alegações)
Bloco de 8 itens, runbook, MAPA §5 e §8, cópia com prettier e PLAN item 6: confirmados. Nenhuma refutada.

## Achados
- N1 (baixa) `docs/evolution/w5/STATUS.md`, bloco "Aceites", linha do item 15: "corrigido em W4/E2". E2 não está mergeada; a spec mandou esse texto, mas a regra "corrigido só para o mergeado" sugere "previsto/em correção em W4/E2 (retry no CI)". Decisão do Commander; ajustar após merge da E2 ou reescrever agora.
- N2 (baixa) `MAPA.md` §8, parágrafo introdutório (linha ~132): "Nenhum item abaixo está mergeado" convive com o novo "Estado em 2026-10-30" (#258–#260 mergeados). A subseção nova explica, mas o aviso antigo pode confundir.
- N3 (informativa) `activation.md:~145`: o bullet termina com ";" como os vizinhos; ok pelo estilo da lista.

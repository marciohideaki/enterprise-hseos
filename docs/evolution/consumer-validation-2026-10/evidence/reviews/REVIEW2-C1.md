# Re-revisao C1 rodada 2 - veredito: APROVAR COM AJUSTES (nenhum bloqueante)
Repro: attack2.test.js (B1-B6), mutantes m1..m5 em /tmp/hseos-crp/rev/ (copias do worktree, nada editado nele). GREEN 21/21.

| Achado r1 | Estado | Evidencia |
|---|---|---|
| 1 ALTA patch do check.js | FECHADO | B1: check.js protegido + patch -> failed; parse recusa entrypoint gravavel/nao protegido/arg gravavel (teste) |
| 2 digest | FECHADO (doc) | doc admite re-prepare por mudanca de CODE_SHA256 |
| 3 review sem command_checks | FECHADO | review grava command_checks; prompt traz failed_commands (teste exit 3) |
| 4 reconciliacao | PARCIAL | codigo ok (runCommandChecks:false), mas mutante m3 (flag ignorado) sobrevive 21/21: teste usa files:[] e cai em protected-files-changed antes do flag |
| RED fraco | PARCIAL | m1 (loop sem approved=false) mata 5 testes, nao 7; teste "timeout" sobrevive (budget expira antes, nao exercita timeout do comando); m2 (guarda entrypoint) mata 1; m4 (comparacao protected) mata 1; m5 (defesa em profundidade task-state) sobrevive: sem teste |

Novos contornos
- B2 transitivo: check.js protegido requer helper.js em write scope; modelo edita helper -> APPROVED. Nao coberto pelo mecanismo; so por doc. A doc e explicita e honesta (residual + orientar protected_paths); aceitavel, mas o parse nao tem como saber os imports.
- B4 args: `--config=index.js` e `../project/index.js` ACEITOS (a checagem e match exato apos tirar `./`); `index.js`, `./index.js`, `--file ./index.js` recusados. BAIXA: lacuna real para config via flag; sugerir recusar arg que contenha path gravavel como substring/sufixo apos `=`, ou doc.
- B3: write fora do scope recusado, nenhum node_modules criado; shadowing exige arquivo no write scope (mesmo risco transitivo).
- Symlink/hardlink: nao ha tool de link; prepare/hydrate ja recusa link e initial_files divergente do baseline (teste existente 'refuses links...'). Protegido ausente do snapshot ou de initial_files: fail-closed (`protected-files-changed`, mutante m4 prova). B6: protected sobreposto a write recusado.
- TOCTOU: snapshot -> verificacao -> reconferencia do digest (uncertainty se mudou), tools.drain/assertQuiescent antes, executor workspace read_only; sem escritor concorrente alem das tools in-process. Nao reproduzi corrida; sem brecha identificada.

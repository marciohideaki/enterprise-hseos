# REVIEW C2 (instalacao/upgrade) - worktree crp-c2-install-upgrade, base e079409c
Veredito: NAO APROVAR como esta. 1 achado ALTO (remedio documentado cai em loop) + 1 MEDIO. Demais alegacoes confirmadas.

## Achados
| ID | Sev | Achado | Repro (scratch em /tmp) |
|---|---|---|---|
| C2-1 | ALTA | O remedio que a propria mensagem manda executar (mover tudo exceto runs/ e state/) leva a `install --yes` a exit 1 "Source for module 'runs' is not available", deixa instalacao parcial (_config _memory core hsm) e SOBRESCREVE runs/config.yaml e state/config.yaml preexistentes (conteudo do usuario vira "# RUNS Module Configuration"). O installer trata subdiretorio com config.yaml como modulo instalado. Teste (b) so semeia runs/state sem config.yaml, por isso nao pega. | install ok (cria runs/config.yaml, state/config.yaml); mv de tudo exceto runs/ state/ para fora; `hseos install --yes --tools none` => exit 1. Variante: `.hseos/runs/config.yaml` com "USER" => sobrescrito + exit 1. |
| C2-2 | MEDIA | Instalacao nova que falha no meio (EACCES em runs/) deixa .hseos parcial com manifest sem version; a proxima execucao classifica como legado e recusa (exit 1, mensagem de "legado" enganosa). Sem rollback. Upgrade que falha no meio e seguro: version do manifest so muda no fim (0.9.0 permaneceu; retry => 4.0.0-rc.0). | `chmod 000 .hseos/runs` ; install ; chmod 755 ; install de novo => exit 1 legacy |
| C2-3 | BAIXA/MEDIA | `isProjectStateOnly` exige igualdade estrita: `.gitkeep`, `.DS_Store` ou um dir `reports/` ao lado de runs/state viram "legado" e recusam. Sem caminho nao-interativo alem de mover manualmente. | `.hseos/{runs,state,.gitkeep}` => exit 1 |
| C2-4 | BAIXA | Saidas de erro exit 1 imprimem stack trace (6 linhas "at ..."); `.hseos` como arquivo => ENOTDIR cru (exit 1, nada alterado). | manifest corrompido; `echo x > .hseos` |
| C2-5 | BAIXA | O installer grava config.yaml dentro de runs/, state/ e config/ (diretorios classificados como estado do projeto). Nao altera arquivos existentes na instalacao feliz, mas polui estado. | ls apos instalar |
| C2-6 | BAIXA | `hseos/` bare com subdir `core` de um projeto qualquer e tratado como legado pre-v4 (heuristica ampla), recusado sem --yes interativo ok. | `mkdir -p hseos/core` => exit 1 |

## Alegacoes (confirmadas com evidencia)
- Testes 11/11 (rodado); RED na base: 9 falham, 2 passam (state a, hook-instalado) - usado archive de e079409c em /tmp/hseos-crp/rev/base3.
- state-only instala e preserva (hash por arquivo de runs/state/links/ocultos identico; arquivos novos so adicionados); mesma versao idempotente (so lastUpdated/files-manifest mudam); 0.9.0 e 4.0.0-beta.1 => quick-update exit 0; `v4.0.0-rc.0` e `+build` tratados como mesma versao; version null/'banana'/numero => legado exit 1; manifest YAML corrompido => exit 1; manifest removido com core => exit 1; alpha => exit 1 com mensagem; 99.0.0 => "Refusing to downgrade" exit 1; `--action bogus` exit 1; update/compile-agents exit 0.
- --tools none: nenhum .claude-plugin/.codex-plugin; hook so com scripts/governance/quality-gates.sh (core.hooksPath ignorado, hook vai em .git/hooks - pre-existente).
- Interativo via pty (50x160): legado + Enter (default cancel) => exit 1; Ctrl-C => exit 130; Ctrl-C em state-only => 130. Caminho "Proceed anyway" nao concluido (fica esperando prompts seguintes) - NAO verificado.
- .hseos symlink para dir: instala dentro do alvo (aceitavel). Permissao 000 em dir de estado: falha exit 1 (ver C2-2).
- Nao verificado: Windows, showLegacyVersionWarning fora do caminho --yes, install sem --tools none.

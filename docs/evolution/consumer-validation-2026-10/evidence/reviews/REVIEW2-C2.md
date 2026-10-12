# REVIEW2 C2 (rodada 2) - testes 16/16 (rodado)
Veredito: APROVAR COM RESSALVAS (todos os achados da rodada 1 fechados; 2 riscos baixos novos).

| ID | Status | Evidencia (reexecucao) |
|---|---|---|
| C2-1 remedio da mensagem | FECHADO | install -> config.yaml de usuario em runs/ state/ + config/platform-bindings.yaml -> mover tudo exceto runs/state/config -> install --yes: exit 0, instalacao completa, "USER runs"/"USER state"/"USER cfg" intactos, ev.json intacto; reinstall idempotente exit 0. runs/state/config nao viram modulos (PROJECT_STATE_ENTRIES nos 5 pontos de varredura) e nao recebem mais config.yaml |
| C2-2 falha no meio | FECHADO | kill -9 no meio de install novo: sobra `.install-in-progress _config core runs state`; retry => exit 0, marcador removido, version 4.0.0-rc.0. Falha EACCES (projeto read-only) deixa so runs state e o retry instala. Upgrade interrompido: version antiga mantida, retry ok. (EACCES em runs/ nem ocorre mais: runs/ nao e tocado) |
| C2-3 dotfiles | FECHADO | `.gitkeep`, `.DS_Store`, `reports/` ao lado de runs/state: exit 0, instalados e preservados |
| C2-4 stack trace | FECHADO | corrompido/arquivo `.hseos`: 0 linhas "at", mensagem de uma linha, exit 1 (stack so com --debug/DEBUG) |
| C2-5 poluicao config.yaml | FECHADO | runs/ state/ config/ so contem o que o usuario/HSEOS-config tinha (config/hseos.config.yaml e do HSEOS) |

## Regressoes procuradas
| Cenario | Resultado |
|---|---|
| marcador velho + instalacao completa | repara, exit 0, marcador removido |
| dois installs simultaneos mesmo dir | ambos exit 0, resultado consistente (manifest valido). Sem lock/PID: o marcador e escrito e removido por ambos; o 1o a terminar remove o marcador enquanto o 2o ainda roda (janela em que uma morte do 2o deixaria instalacao parcial SEM marcador => "legado"). BAIXA, sem repro de corrupcao |
| marcador "vivo" de outro processo | 2o install trata como interrompido e repara por cima (nao ha deteccao de processo vivo) - BAIXA |
| marcadores conhecidos x instalacao antiga | INSTALL_MARKERS = _config _cfg _memory core hsm workflows agents. Instalacao so com modulo customizado e sem nenhum desses seria vista como state-only e instalada por cima (nao destrutivo; sem manifest nao ha upgrade guiado). BAIXA |
| config/ do projeto vs HSEOS | config/ preservado (platform-bindings do usuario intacto); hseos.config.yaml e escrito/atualizado pelo installer - sem colisao observada |
| --action update/quick-update/compile-agents | exit 0; marcador nao fica |

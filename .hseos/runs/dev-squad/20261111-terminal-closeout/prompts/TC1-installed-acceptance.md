# TC1 — aceite instalado local (GM-06, GM-07, GM-17)

Regras comuns: `prompts/TB-executor-common.md` (obrigatórias). Exceções desta task, autorizadas pelo Commander:
- Você **roda as jornadas** (estágio pesado), uma por vez, cada uma por `heavy-run --mem 4G -- <comando>` (nunca duas ao mesmo tempo,
  `uptime` antes de cada uma; não envolva em `heavy-run` o que já o chama por dentro). Cada jornada leva minutos: rode-a em primeiro plano
  com `timeout` generoso (até 540 s por chamada; se precisar mais, rode desacoplada gravando `{"exit_code":N}` num arquivo de status e
  espere com `hseos liveness await --cmd-status <arquivo> --max 540` repetido no mesmo turno). Nunca termine o turno esperando.
- Você cria arquivos em `docs/evolution/terminal-closeout/` (recibo e `evidence/`), que ficam **fora do pacote**.

## Objetivo

Provar, numa instalação limpa **fora do checkout**, que a superfície do terminal funciona de ponta a ponta nesta revisão, e que
instalação offline, upgrade, downgrade e rollback não reescrevem eventos. Fatos (exit, contagens, hashes) copiados das ferramentas.

## Passos

1. **Pacote desta revisão.** No worktree, `npm pack --pack-destination $TMPDIR/tc/pack` (registre sha256 e o SHA do commit).
2. **Instalação offline fora do checkout.** `$TMPDIR/tc/consumer-legacy` e `$TMPDIR/tc/consumer-modern` (um consumidor por modo, como
   manda `test/journeys/README.md`): `npm init -y` e `npm install --offline --no-audit --no-fund <tgz>`. Se `--offline` falhar por
   dependência ausente no cache, registre o erro exato e repita com `--prefer-offline` (declare no recibo que a instalação totalmente
   offline **não** foi provada).
3. **Jornadas** (leia `test/journeys/README.md` e o cabeçalho de cada script; use `--service-mode user`):
   - `node test/journeys/core-journey.mjs --prefix <consumer-legacy> --tgz <tgz> --out $TMPDIR/tc/out/core`
   - `node test/journeys/mcp-journey.mjs --prefix <consumer-legacy> --tgz <tgz> --out $TMPDIR/tc/out/mcp-legacy`
   - `node test/journeys/mcp-journey.mjs --mode modern --prefix <consumer-modern> --tgz <tgz> --out $TMPDIR/tc/out/mcp-modern`
   Copie de cada `*-result.json`: veredito, contagem de passos PASS/FAIL/BLOCKED/NOT_EXERCISED e os ids de passo que não forem PASS.
4. **GM-17 (equivalência pela CLI).** No consumidor instalado, use o binário instalado (`<consumer>/node_modules/.bin/hseos`) para
   consultar pela CLI algo que a jornada criou pela API/SDK (descubra no `hseos --help`/`hseos control --help` o comando de consulta de
   estado/eventos; se a jornada apaga o estado ao fim, use `--keep-work` do core-journey). Registre comando, saída resumida e se bate com o
   que o SDK viu. Se a CLI não expõe consulta equivalente, registre isso como achado (não invente).
5. **Upgrade, downgrade e rollback sem reescrever eventos.** Tarballs anteriores (somente leitura; não altere nada lá):
   `~/.local/state/hseos/distributions/2b4d6f37caf748947cca8195f16b8534b5c8ab9e/hseos-4.0.0-rc.0.tgz` (schema de ativação 16, 2026-09-30)
   e `~/.local/state/hseos/distributions/25e673ff9c7e9dee99ef88a554cc9144d99c5b40/hseos-4.0.0-rc.0.tgz` (schema 17, distribuição global
   atual). Confira cada um contra o `package.sha256` ao lado. **Nunca** toque no `project.db` real de nenhum projeto nem na instalação
   global; tudo em `$TMPDIR/tc/`.
   - (a) **Mesmo schema (17):** consumidor com o tgz `25e673ff`; gere um banco **ativado** com eventos (o `mcp-journey --mode modern` faz
     isso com fixture do ADR-0048, ou use o caminho que o próprio pacote expõe); calcule o hash canônico dos eventos (ordem por posição;
     campos de identidade, tipo e payload) e `PRAGMA user_version`; instale o tgz desta revisão por cima (`npm install --offline`); abra o
     banco pelo pacote novo (uma operação de leitura e uma de escrita que anexe evento); confira que os eventos antigos têm o **mesmo**
     hash e que só houve anexação; `PRAGMA integrity_check`.
   - (b) **Downgrade:** com o banco já escrito pela revisão nova, reinstale o tgz `2b4d6f37` (schema 16) e tente abrir/servir: o esperado
     pelo PLAN é recusa sem escrita (`EXECUTION_ACTIVATION_PENDING` ou equivalente); confira o sha256 do arquivo do banco antes/depois.
   - (c) **Schema 16 → 17:** se for viável ativar um banco com o pacote `2b4d6f37`, faça-o e verifique o que o pacote novo faz com ele
     (recusa até nova ativação? migração por `hseos execution-activation plan|apply` com backup?). Exercite o caminho que o produto
     oferece e registre; hash dos eventos antes/depois. Se não for viável sem decisão humana (ex.: exige ADR aceito no projeto
     consumidor), registre BLOCKED com a causa exata.
   - (d) **Rollback:** pelo mecanismo do produto (`hseos execution-activation rollback` ou restauração do backup gerado), volte ao banco
     anterior e confira o sha256 contra o backup.
   Escreva o roteiro como script versionado `docs/evolution/terminal-closeout/evidence/upgrade-rollback.mjs` (o lint do CI cobre esse
   caminho: sem `catch {}` vazio, sem `process.exit`, sem caminho absoluto de `/build/tmp` no fonte — receba diretórios por argumento ou
   `process.env.TMPDIR`), rode-o e salve a saída JSON em `docs/evolution/terminal-closeout/evidence/upgrade-rollback-result.json`.
6. **Evidência das jornadas.** Copie para `docs/evolution/terminal-closeout/evidence/` os `*-result.json` (sem caminhos absolutos do host
   se possível; se o JSON os contiver, substitua `$TMPDIR` por `<tmp>` e diga isso no recibo) e um `versions.json` (node, npm, kernel,
   sha do commit, sha256 dos tgz). Rode uma varredura de segredo sobre os arquivos de evidência: `node -e` que procure padrões de chave
   (`sk-`, `ghp_`, `AKIA`, `-----BEGIN`) e registre 0 acertos (sem ler o `pass`).
7. **Recibo** `docs/evolution/terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md` (português, sem nome de fornecedor de IA): escopo,
   comandos, resultados copiados, tabela por jornada, GM-17, (a)–(d), e `does_not_prove` honesto (fixtures roteirizadas, sem modelo real,
   só Linux, cgroup/bwrap do host, o que ficou BLOCKED/NOT_EXERCISED e por quê). Rode `node test/test-documentation-neutrality.js`,
   prettier nos `.md`/`.json`/`.mjs` e `rtk proxy npx eslint --max-warnings=0 docs/evolution/terminal-closeout/evidence/*.mjs`.
8. Limpe `$TMPDIR/tc/` ao fim (os consumidores podem ter centenas de MB), exceto o que copiou para a evidência.

## Aceite

Jornadas executadas com resultado copiado (PASS ou a falha reportada como está, nunca convertida); (a)–(d) executados ou BLOCKED com causa;
recibo com `does_not_prove`; lint/prettier/neutralidade verdes; nada alterado fora de `docs/evolution/terminal-closeout/`. Se uma jornada
falhar por defeito de produto, **pare** naquela jornada, relate a causa (arquivo:linha) e siga para as outras.

Última linha: `LIVENESS: {...}`.

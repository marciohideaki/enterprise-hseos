# W5 — consumidores reais A e B

Jornada: `test/journeys/w5-environment-journey.mjs`. Evidência: [`evidence/real/`](./evidence/real/) (a rodada que
despachou), [`evidence/w5-11b/round1/`](./evidence/w5-11b/round1/) (a rodada sem despacho do código corrigido) e
[`evidence/w5-11b/receipt.json`](./evidence/w5-11b/receipt.json). Base `892388f2`, Node 24.15.0.

## Escopo da prova

Esta jornada prova **instalação fora do checkout, admissão governada de um patch de modelo real em consumidor real
e aceite por vitest mais DOM no navegador**. Ela **não** prova que o LSP ou o DAP guiaram a correção. Limites
declarados:

- o defeito está **descrito na especificação enviada ao modelo** (as duas classes de cor são citadas), e a troca é
  trivial;
- o verificador governado é um **regex** sobre o `.tsx` que repete a expectativa da especificação;
- o DAP depura um **reprodutor do harness** que extrai e avalia a expressão de classe, não o componente;
- o vitest roda **fora do sandbox governado** (o contrato só monta `node_modules` pelo store virtual do pnpm);
- o navegador de A renderiza uma **página de prévia escrita pelo harness** com dois `StatsCard` reais, **não a rota
  real do app** (a rota exige autenticação e API);
- B é **sintético** (teste, defeito e requisito criados pela jornada).

## Revisão da jornada e o que foi revalidado

Os **2 despachos reais** ocorreram na **revisão anterior** da jornada (commit `92b4d622`); a evidência deles está em
`evidence/real/`. Depois da revisão cética (rodada de correção 1), o código novo (gates de recibo e de verificador,
contagem por tipo, redação, prova de rede derivada, prévia do estado defeituoso) foi validado **sem novo despacho**,
por três caminhos: a jornada sem `--allow-dispatch` (`evidence/w5-11b/round1/`), o **replay do ledger real gravado**
(`s11b`) e **ledgers sintéticos adversariais** (`s11a`, `s03d`). Os caminhos que só existem com despacho (checagem do
pin contra o primeiro `reserved` ao vivo, `s11` ao vivo) não foram reexecutados; o pin e o recibo das linhas gravadas
foram revalidados pelo replay.

Contagem de passos, separada por tipo (no resultado da rodada `round1`, sem despacho):
`consumer` 10 PASS e 8 BLOCKED; `control` 6 PASS; `infra` 6 PASS e 1 BLOCKED; `unit` 2 PASS. Na rodada que despachou
(`evidence/real/`, revisão anterior, 29 PASS), 17 passos eram de consumidor com veredito próprio (`s01` a `s09`
de A e B), 6 eram controles e 6 eram de infraestrutura.

## Instalação e identidade

Em 16/10/2026, o core foi empacotado (`hseos-4.0.0-rc.0.tgz`, 1.538 entradas) e instalado com
`npm install --offline` em um diretório novo e vazio, fora do checkout. Os cinco plugins (`lsp`, `dap`, `browser`,
`computer-use`, `memory`) foram empacotados, extraídos em diretório próprio da instalação e conferidos arquivo a
arquivo contra os bytes do core instalado (paridade de digest, ≤ 40 entradas, ≤ 1 MB cada). Os binários e o
`playwright-core` seguem como pins do cache de toolchain, fora dos tarballs.

| Consumidor | Origem (somente leitura)                                            | Papel                                                                       |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **A**      | `hideaki-solutions/cambio-real/apps/platform-web` (HEAD `9b253b91`) | Teste REAL existente com defeito injetado, prova de admissão e aceite       |
| **B**      | `hideaki-solutions/axon-web` (HEAD `eb4102df`)                      | **SINTÉTICO**: teste e defeito sintéticos; segunda prova de UI no navegador |

Os originais nunca foram tocados: toda ação roda em clone descartável sob `$TMPDIR`, removido ao fim. A jornada
registra HEAD, `git status` e um digest de caminho/tamanho/mtime dos originais antes e depois (passo `s12`), e o
`git status` de ambos continuou vazio, nos mesmos HEADs.

## Consumidor A: teste real, defeito injetado

- **Arquivo e linha:** `src/components/Dashboard/StatsCard.tsx`, linha 35. As classes do ternário de tendência foram
  invertidas (`trend === 'up' ? 'text-red-600' : 'text-green-600'`).
- **Teste real existente:** `src/components/Dashboard/StatsCard.test.tsx` (já presente no histórico do `cambio-real`).
  O vitest real (1.6.1, `--maxWorkers=2 --minWorkers=1`) falha em `shows green color for up trend` e `shows red color
for down trend` (2 falhos, 4 passando), antes de qualquer modelo (`s03b`).
- **Estado defeituoso no navegador (`s03c`, sem modelo):** a mesma página de prévia, antes da correção, mostra
  `up=rgb(220, 38, 38) down=rgb(22, 163, 74)`, o inverso do esperado. Screenshot
  [`A-defective.png`](./evidence/w5-11b/round1/screenshots/A-defective.png), para comparar com
  [`A-fixed.png`](./evidence/real/screenshots/A-fixed.png).
- **LSP (`s04`):** definition, references (3), hover (`(parameter) trend: "up" | "down"`) e diagnostics sobre o
  componente, como dados não confiáveis com digest, workspace intacto e arquivo fora do workspace negado
  (`ENV_LSP_OUT_OF_SCOPE`). O defeito não é um erro de tipo: o LSP localiza o símbolo, não o diagnostica.
- **DAP (`s05`):** breakpoint no reprodutor do harness, pilha e variáveis mostram `selected='text-red-600'` para
  `up` e `'text-green-600'` para `down`. Sem descendentes; programa fora do workspace negado.
- **Verificador fixado antes do despacho (`s03`):** o digest cobre o módulo de verificação, a linha de comando do
  vitest, o SHA-256 do arquivo de teste e o contrato da tarefa. Antes do despacho a jornada **recomputa** o digest e o
  compara com o pin; depois do despacho compara o instante do pin com o do **primeiro `reserved`** do ledger (pin
  anterior) e recomputa de novo; antes do aceite recomputa a parte estática. Divergência ou pin posterior falham a
  jornada (`s03d` prova isso com casos adversariais).
- **Correção governada (`s07`):** a saída do modelo entrou por referência de campanha e foi aprovada pelo verificador
  protegido, revisada e aplicada. Só `StatsCard.tsx` mudou, em uma linha.
- **Aceite externo (`s08`):** vitest sobre o clone corrigido, 6 de 6 passando; os dois testes antes falhos passam.
- **Navegador (`s09`):** `playwright-core` + `chrome-headless-shell` no perfil P2. A página de prévia do harness
  informa as cores calculadas: `up=rgb(22, 163, 74) down=rgb(220, 38, 38)`.

## Consumidor B: sintético

O teste e o defeito de B são **sintéticos** e foram criados pela jornada; B não é prova de teste real.

- **Defeito:** em `src/pages/DashboardPage.tsx`, linha 86, o rótulo `Symbols` virou `Symbls`. O requisito sintético
  é que o rótulo diga exatamente `Symbols`. O aceite é o módulo de verificação mais o DOM no navegador.
- **Mudança de alvo:** o plano inicial usava `src/components/Header.tsx` (rótulo "Re-index"). `Header.tsx` não é
  importado por nenhuma página (código morto), então o defeito nunca apareceria no navegador. O alvo passou a ser o
  `DashboardPage.tsx`, que a rota `/` renderiza.
- **Navegador (`s09`):** build real do app (`vite build`), servido em loopback; o DOM mostra `Symbols` e não mostra
  `Symbls`. Screenshot em [`B-fixed.png`](./evidence/real/screenshots/B-fixed.png). Dois ajustes de ambiente, sem
  tocar a fonte: o build usa `VITE_API_BASE=''` (antes o app apontava para um host da LAN, e o egress negado recusa a
  chamada inteira) e a cópia servida do HTML perde 1 tag de fonte de terceiro.
- **Evidência marcada sintética:** `synthetic: true` em cada passo de B no recibo e na saída da jornada.

## Cache dedicado e instalação sem rede

Os lockfiles de A e B pedem pacotes que nenhum cache do host tinha (cerca de 185 de 573 em A e 112 de 222 em B,
incluindo `vitest@1.6.1`, `vite@8` e `react@19.2.5`), e os stores do pnpm também não os tinham. Com autorização do
owner, em 16/10/2026 (~20:59Z), `npm ci --cache <dir novo> --ignore-scripts` rodou **online uma única vez por
consumidor**, só para popular um cache dedicado e novo, sobre cópias dos lockfiles:

| Cache                                   | Tarballs | Tamanho |
| --------------------------------------- | -------: | ------: |
| `/build/cache/hseos-w5-consumers/npm-A` |      510 | 52,9 MB |
| `/build/cache/hseos-w5-consumers/npm-B` |      186 | 38,3 MB |

Os lockfiles não foram atualizados. **Caches existentes:** `hseos-toolchain` e `~/.npm` ficaram intactos. O cache
padrão `/build/npm` **não** fica intacto: a instalação offline do core (`s00`) reescreve entradas de `index-v5` e de
`_logs` a cada execução, sem baixar conteúdo novo. Os caches dedicados A e B só são lidos pela jornada.
`--ignore-scripts` foi compatível com os testes e com os builds; nenhum pacote precisou de script de ciclo de vida.

A jornada roda `npm ci --offline --cache <dir>` dentro de `bwrap --unshare-net`. A ausência de rede é **medida**: um
passo `cat /proc/net/dev` no mesmo sandbox deve listar só `lo` (registrado em `sandbox_interfaces`), e o campo
`offline_without_network` é derivado desse resultado e do sucesso da instalação, não escrito à mão. Os SHA-256 dos
lockfiles estão no detalhe de `s02`.

## Modelo, campanha e custo

- **Rotas inspecionadas (`s05b`, sem inferência):** local ausente (ollama, llama-server, llama-cli, llamafile, lms e
  vllm não existem no host). Assinatura Codex indisponível: conta `chatgpt`, sem créditos pagos, janela de quota
  em 100% de uso. Assinatura Claude elegível. API paga não inspecionada e não usada. A leitura de conta e quota do
  Codex passa pelo app-server do cliente, que contata o provedor (uso de rede não medido em nível de socket); a do
  Claude é um comando local. Nenhuma inferência.
- **Decisão do owner:** rota 2 pela assinatura Claude, no máximo 3 despachos por binding (A:1, B:1, 1 de reserva),
  sem API paga. Fonte: a mensagem do owner de 2026-10-16 ("Decisões do owner (2026-10-16)"), repassada pelo Commander
  na sessão da W5-11b.
- **Binding e campanha (`s06a`):** `binding:claude-w5-account` (`provider-claude-account-adapter`), inspecionado
  duas vezes antes de despachar. A campanha `cbcfc604-34b5-430e-ae3e-a0a52086bd77` abriu com `max_cost_microusd` 0
  (nenhum gasto pago autorizado, abaixo do teto de US$ 1), `max_requests` 2 e `quota_exceptions` com a razão (decisão
  do owner de 2026-10-16, acima) e a validade; o cliente Claude não expõe janela de quota.
- **Despachos reais: 2 de 3 no binding** (a reserva não foi usada), cada um com `reserved` e depois `receipt`
  `completed`:
  - A: `campaign://cbcfc604-34b5-430e-ae3e-a0a52086bd77/4cee0d08-0e31-47f9-9a7f-b49f525cd327` (5.771 tokens de
    entrada, 176 de saída);
  - B: `campaign://cbcfc604-34b5-430e-ae3e-a0a52086bd77/57e73c5e-650c-43fc-8ddb-012148b076ec` (7.346 de entrada, 129
    de saída).
- **Custo:** US$ 0 comprometido, mas **não medido**: `cost_microusd` é nulo no recibo (assinatura) e o ceiling de
  `max_cost_microusd` 0 impede gasto pago. As linhas do ledger estão em
  [`evidence/real/ledger-rows.json`](./evidence/real/ledger-rows.json), com o digest da conta, o id de sessão do
  provedor e o dono do executor **redigidos** (`<redacted>`).

### Gate de recibos

`assertReceipts` verifica: teto de abertura e custo comprometido ≤ US$ 1, custo relatado igual ao recomputado das
linhas, no máximo 3 `reserved` por binding, `receipt` precedido por `reserved` do mesmo `command_id`, binding
coerente entre reserva e recibo, evidência `model_output` bem formada, referência `campaign://<campanha>/<despacho>`
válida, nenhum comando não resolvido. O passo `s11a` roda **17 ledgers adversariais** (4 reservas, recibo sem
reserva ou antes dela, custo acima do teto, abertura acima do teto, custo de recibo 5.000.000 com relatório 0, e 500.000
com relatório 0, referência fora do formato, binding divergente, manifesto divergente, evidência ausente, reserva sem
recibo, sem abertura, sem relatório, comando não resolvido): cada um **precisa ser rejeitado pela sua regra**, e
desligar a regra o deixa passar (a regra é necessária). Remover a checagem "reserved antes de receipt" derruba a
jornada (`s11a` FAIL). O `s11b` reexecuta o gate sobre o ledger real gravado e confere que cada pin precede o primeiro
`reserved` (21:14:00.394Z); o `s11` ao vivo continua BLOCKED sem despacho.

## Controles do harness (fora das etapas de consumidor)

`s07c`, `s08c` e `s09c` repetem a correção governada, a aceitação e o navegador sobre um segundo clone, corrigido
por um patch escrito pelo próprio harness (não é resultado de modelo, marcado `control: true`). Eles provaram a
máquina antes de gastar um despacho. **Não contam** como etapa de consumidor: o resultado emite `kind: control`
separado de `kind: consumer`, `infra` e `unit`. O screenshot do controle de A tem o mesmo digest do de A, o que mostra
renderização determinística.

## Anomalias e limitações

1. **Falso verde do vitest.** Com só `--maxWorkers=2`, o vitest 1.6.1 de A falha com `minThreads and maxThreads
must not conflict`, não executa nenhum teste e **sai com código 0**. Por isso a jornada passa
   `--maxWorkers=2 --minWorkers=1` e trata "0 testes" como falha, nunca como verde.
2. **Patch de revisão em formato de arquivo inteiro.** `reviewProjectResult` gera um patch que reescreve o arquivo
   todo (49 linhas removidas e 49 adicionadas em A, 129 e 129 em B), embora a diferença real seja de uma linha.
3. **Versão do cliente Claude.** O binding foi montado com a versão `2.1.263`, achada no PATH do cgroup, e não com a
   do shell interativo (`2.1.302`). O adapter confere a versão na inspeção e ficou consistente.
4. **B no navegador:** o egress negado recusa a chamada inteira; por isso o `VITE_API_BASE` vazio e a tag de fonte
   removida da cópia servida (acima).
5. **Codex sem quota** e **rota local ausente** (acima).
6. **Não provado:** o que está em "Escopo da prova", mais: o LSP traz 85 diagnósticos de ruído de tipos de dependência
   e o hover dentro do template JSX volta `any`; **Node 22 não verificado** (`better-sqlite3` do worktree é do ABI
   do Node 24; sem rebuild); os caminhos que só existem com despacho (pin ao vivo contra o primeiro `reserved`, `s11`
   ao vivo) foram validados por replay e ledgers sintéticos, não por novo despacho.
7. **Fora do `test:kernel` e do CI.** A jornada fica em `test/journeys`, não faz parte do pacote nem do `test:kernel`:
   nada protege contra regressão dela além de rodá-la à mão. Ela exige cgroup delegado, `bwrap`, os caches
   dedicados e o cache de toolchain.
8. **Reexecução:** a jornada sem `--allow-dispatch` repete os passos que não dependem de modelo com o mesmo veredito e
   deixa os dependentes de despacho em BLOCKED; uma rodada sem despacho não sobrescreve o ledger gravado. Os despachos
   de A e B **não devem ser repetidos** a partir da evidência: cada nova execução com `--allow-dispatch` consome
   assinatura.

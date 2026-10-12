# W5 — capacidades de ambiente, contexto com autoridade e memória

Tipo: plano de execução da onda W5, redigido em 2026-10-10 (W5-01) e atualizado em 2026-10-11 com as decisões do gate G2. Escopo: W5; W6-W8 e quarta família permanecem fora.
Base: `e079409c` (master após a PR #214: W0-W4 e revalidação do core). Feature: `feature/hseos-evolution-w5`; upstream: `master`.
Task inicial: `task/hseos-w5-contracts` (W5-01).
Governança: `AGENTS.md`, Constituição §§2.3/2.6/5/7, políticas de ADR e validação automatizada, ADR-0043 e ADR-0047 (Accepted em 2026-10-11).
Contratos: [spec](../../../.specs/features/harness-w5/spec.md), [design](../../../.specs/features/harness-w5/design.md), [tasks](../../../.specs/features/harness-w5/tasks.md), [intake](../../decisions/harness-w5-intake.md).

## 1. Confronto com o estado atual

A W5 estende a base; não reescreve serviços existentes (invariantes de [../PLAN.md](../PLAN.md)).

| Área                     | Base verificada                                                                          | Trabalho efetivo                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Contexto                 | Fontes sem autoridade nem origem; referências e memória já são dado citado; texto apenas | `authority`, `provenance`, mídia por referência, contador de mídia, proveniência no evento  |
| Execução isolada         | Sem rede, saída 64 KiB, `pids_max` 32, seccomp bloqueia sockets                          | Perfis P0/P1/P2, limites por chamada, canal de artefatos verificado                         |
| LSP / DAP                | Inexistentes                                                                             | Contratos e clientes no core; servidores e adaptadores como toolchain pins                  |
| Navegador / computer-use | Inexistentes; Xvfb e Chromium do Playwright presentes no host                            | Runtime no core (carga tardia) e empacotável em plugin; egresso mediado; aprovação por ação |
| Memória                  | `memory[]` no assembler sem armazenamento                                                | Pacote sobre o ledger com política, TTL e autoridade fixa                                   |
| Compactação              | Testes isolados                                                                          | Cenário combinado compactação, crash, resume e fork                                         |
| MCP                      | Tolerância a tool malformada e servidor legado fora da fixture                           | Falha fechada, negações no ledger, contratos versionados                                    |
| Superfícies              | Evidência sem autoridade/proveniência                                                    | Campos aditivos em API, eventos, CLI e SDKs                                                 |

Decisões do owner (2026-10-09 e 2026-10-10) incorporadas sem reabertura: ondas dev-squad/SWARM; capacidades pesadas e opcionais em plugins separados por mérito (superado no G2 pelo híbrido, seção 7.2); teto 1540 com orçamento por área (superado no G2/G3: teto 1554, `packages` 137, seção 7.3); computer-use só em Xvfb com aprovação por ação; modelo local ou sem custo primeiro, pago só com G4; axon opcional; BLOCKED nunca vira PASS.

## 2. Arquitetura e distribuição híbrida (decidida no G2)

| Item                             | Distribuição                                                                                                | Razão (resumo; completa no design)                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Contexto/autoridade/mídia        | Core                                                                                                        | Contrato transversal, sem dependência externa                          |
| Perfis de isolamento e artefatos | Core                                                                                                        | Fronteira de segurança compartilhada; P0 inalterado                    |
| MCP subordinado                  | Core                                                                                                        | Superfície de segurança; não pode depender de instalação opcional      |
| LSP                              | Core (contrato, runtime, validador), empacotável em `plugins/lsp`; servidores como pins                     | Protocolo leve; validador de escopo é fronteira de segurança           |
| DAP                              | Core (execução roteirizada, sem `evaluate`), empacotável em `plugins/dap`; adaptadores como pins            | Idem; sessão interativa fica para a W6                                 |
| Memória                          | Core, empacotável em `plugins/memory` (distribuição do mesmo código)                                        | Precisa de escrita com CAS no ledger e política, que plugin não recebe |
| Navegador                        | Core (contrato e runtime, `playwright-core` carregado sob demanda do pin), empacotável em `plugins/browser` | Dependência pesada fica fora do tarball e só é carregada ao usar       |
| Computer-use                     | Core (contrato e runtime, Linux, carregamento tardio), empacotável em `plugins/computer-use`                | Idem; gate de aprovação no core                                        |

Regra comum do híbrido: uma só implementação, no core. O plugin é gerado a partir dela (sem duplicar código), com teste de paridade de digest. Binários e `playwright-core` são pins em cache offline fora de qualquer tarball.

## 3. Sequência e entregas

| Onda | Tasks                                | Saída                                                                                                                  | Condição de avanço                                                                 |
| ---- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| B0   | W5-01                                | spec, design, tasks, intake, ADR-0047 (Accepted), grafo                                                                | G2 aprovado em 2026-10-11 (concluído)                                              |
| B1   | W5-02a, W5-02b1 → W5-02b2, W5-04     | contexto com autoridade e mídia; perfis de isolamento e artefatos; MCP subordinado                                     | negativos verdes; P0 inalterado; ensaio de viabilidade de Chromium/Xvfb registrado |
| B2   | W5-03 ∥ (W5-05 → W5-06)              | compactação combinada; LSP; DAP                                                                                        | escopo de workspace e drenagem comprovados                                         |
| B3   | (W5-07 → W5-08) ∥ W5-09              | navegador; computer-use; memória                                                                                       | egresso, aprovação por ação e autoridade de memória comprovados                    |
| B4   | W5-10, W5-10b, W5-11a, W5-11b, W5-12 | superfícies; aceite endurecido do contrato de tarefa; matriz negativa e mutantes; consumidores reais A e B; fechamento | critérios da seção 4; PR (G6)                                                      |

## 4. Verificação e pronto

Pronto por task: positivos e negativos verdes em Node 22 e 24; cobertura de arquivo crítico ≥90% linhas e ≥80% branches (incluindo arquivos novos não executados); nenhum efeito antes de admissão e aprovação; revisão cética de duas passagens; recibo com revisão, ambiente, comando e resultado.

W5 tecnicamente pronta:

- FR01-FR15 implementados e evidenciados; matriz de rastreabilidade FR → task → teste → recibo.
- `npm test`, `test:kernel-coverage`, mutantes W5 e `quality-gates --phase ci` verdes em Node 22 e 24, sequenciais, sem afrouxar threshold.
- Pacote do core dentro do teto medido e aprovado no G3 e dos orçamentos por área (`packages` 137); pacotes de plugin dentro do teto próprio (≤40 entradas, ≤1 MB).
- Consumidor A (`cambio-real/apps/platform-web`) instalado offline fora do checkout percorre LSP → DAP → correção → navegador com screenshot → aceite por verificador externo fixado; consumidor B (`axon-web`) como segunda prova de UI, rotulada sintética; ou BLOCKED explícito com causa.
- Docs distinguem determinístico, consumidor real e ativação.

Três estados por marco, como na W4: determinístico; consumidor real; ativação (não autorizada).

## 5. Riscos

- Chromium e Xvfb dentro de `bwrap` sob seccomp e cgroup: viabilidade, memória e processos não verificados. Mitigação: ensaio em W5-02b1 antes de B3 (Chromium com `--no-sandbox` dentro do `bwrap`); falha = BLOCKED.
- Cache offline de binários (language servers, debugpy, js-debug, playwright-core, `xdotool`): ausentes no host. Sem cache = BLOCKED.
- Filtro seccomp por argumento para P1/P2: mudança de segurança no kernel compartilhado. Mitigação: revisão cética e teste negativo por syscall; aprovado no G2.
- Schema de contexto com impacto amplo: análise de impacto prévia e leitura v1.
- Carga do host: suíte integral leva horas por versão de Node; `heavy-run`, um job pesado por vez, `--maxWorkers` limitado em suítes jsdom do consumidor.
- Consumidor real com muitos workspaces: nunca disparar `pnpm`/`npm test` na raiz de monorepo sem teto (fan-out).

## 6. Governança, ondas e versionamento

Coordenação: dev-squad / SWARM (`.hseos/workflows/dev-squad/workflow.md`, ADR-0015). Commander Opus planeja, extrai handoffs e fecha decisões; squad Sonnet em worktrees `.worktrees/hseos-w5-<task>`. Revisores céticos Sonnet, isolados, sem o raciocínio do executor; reportam e não corrigem. 1 task = 1 commit; 1 onda = 1 PR para `feature/hseos-evolution-w5`; a W5 inteira vira uma PR para a master. Tags locais por onda (`hseos-w5-b1`, ...); push de tags só no merge. No máximo 3 rodadas de correção por entrega; depois, causa raiz e mudança de estratégia registrada. Sem atribuição de IA em commits e PRs. Agentes não fazem merge (`hseos pr closeout <n> --approved` após aprovação).

Gates humanos: G2 (aprovado, seção 7), G3 (teto 1554 e `packages` 137 já aprovados; qualquer aumento acima disso só pelo número medido, ou de orçamento de área além do aprovado), G4 (gasto com modelo pago além do teto de US$ 1 e das assinaturas já autorizadas), G6 (merge da PR da W5). Publicação, instalação global e ativação ficam fora do escopo.

## 7. Decisões do owner (G2, 2026-10-11)

O gate G2 foi aprovado pelo owner em 2026-10-11. Cada decisão abaixo é vinculante para as tasks e foi aplicada em [spec](../../../.specs/features/harness-w5/spec.md), [design](../../../.specs/features/harness-w5/design.md), [tasks](../../../.specs/features/harness-w5/tasks.md) e [ADR-0047](../../../.enterprise/.specs/decisions/ADR-0047-environment-capabilities-and-context-authority.md) (Accepted).

### 7.1 Consumidores reais A + B

|                 | A (prova principal)                                                                                  | B (segundo consumidor de UI)                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Projeto         | `/workspace/github/hideaki-solutions/cambio-real/apps/platform-web`                                  | `/workspace/github/hideaki-solutions/axon-web`                                                      |
| Papel           | jornada completa LSP, DAP, correção, navegador com screenshot, aceite pelo verificador               | segunda UI para o navegador                                                                         |
| Teste e defeito | teste real existente com defeito injetado no clone, ou bug reproduzível                              | **sintéticos**: o harness cria o teste e o defeito no clone; a evidência declara que são sintéticos |
| Restrições      | clone descartável só do app; vitest com `--maxWorkers=2`; nunca comando de teste na raiz do monorepo | clone descartável; sem teste de origem, logo não vale como prova de teste real                      |
| Instalação      | offline, a partir do cache; clone e instalação autorizados                                           | idem                                                                                                |

A evidência de B nunca é apresentada como consumidor real de teste: apenas como segunda prova de UI, rotulada sintética. Instalação offline sem cache suficiente termina em BLOCKED com a causa.

### 7.2 Distribuição híbrida (core e plugin)

Contratos **e runtime** de todas as capacidades (LSP, DAP, memória, navegador, computer-use) ficam no core, com carregamento tardio (`require` sob demanda) das dependências pesadas. Cada capacidade também é empacotável como plugin em `plugins/*`, gerado a partir da **mesma implementação** do core (o empacote copia os arquivos do core no momento do pack; um teste de paridade de digest impede divergência; nenhum código é duplicado no repositório). Os binários (`chrome-headless-shell-1228`, `typescript-language-server`, `pyright`, `debugpy`, `js-debug`, `xdotool`) e o pacote `playwright-core` são pins em cache offline, fora do tarball do core e dos plugins.

| Item                  | Core (contrato + runtime, lazy)                    | Plugin empacotável (`plugins/*`)                    | Pins externos                                   |
| --------------------- | -------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| LSP                   | sim                                                | `plugins/lsp`                                       | typescript-language-server, typescript, pyright |
| DAP                   | sim                                                | `plugins/dap`                                       | debugpy, js-debug                               |
| Navegador             | sim; `playwright-core` carregado do pin só ao usar | `plugins/browser`                                   | playwright-core, `chrome-headless-shell-1228`   |
| Computer-use          | sim; só Linux; carregamento tardio                 | `plugins/computer-use`                              | xdotool, Xvfb, xwd (sistema)                    |
| Memória               | sim (precisa do ledger com CAS)                    | `plugins/memory` como empacotamento de distribuição | nenhum                                          |
| Contexto, perfis, MCP | sim, sem plugin                                    | não aplicável                                       | nenhum                                          |

Memória: o plugin `context-source` do W4 não recebe ledger; por isso `plugins/memory` só distribui o mesmo código do core, que continua escrevendo no ledger pelo host. Consequência: `dependencies` do core permanece inalterado (nenhuma dependência npm nova); os pins são carregados por caminho absoluto de cache pinado.

### 7.3 Orçamento (G3) e inventário

Vence a opção "elevar o teto"; a realocação entre áreas está descartada.

- Orçamento da área `packages`: 123 para **137** (aprovado). As demais áreas ficam como estão até o fechamento de cada onda.
- Teto total do core: **1554** (`packages` 137), aprovado no G3 de 2026-10-11: o owner escolheu a opção "elevar o teto", em que `packages` sobe para 137 e o teto sobe na mesma medida. Acima de 1554 (projeção alta com o híbrido, **≈1565**, estimativa) só vale o número **medido** no fechamento da onda (`npm pack --dry-run --json`), com novo G3.
- Plugins: teto próprio proposto de **≤40 entradas e ≤1 MB cada**, excluídos os pins.
- `test/test-package-surface.js` não é alterado por esta task; a onda que implementa o altera junto com o G3 correspondente.

Medido em `e079409c`, Node 24: 1459 entradas. Referência por área (sem a realocação):

| Área          |      Medido | Orçamento atual | W5 central/alto (híbrido, a remedir) | Situação                                 |
| ------------- | ----------: | --------------: | ------------------------------------ | ---------------------------------------- |
| `packages`    |         113 |             123 | +24 / +32                            | orçamento aprovado em 137                |
| `.agents`     |         186 |             193 | +6 / +8                              | alto pode exceder; decidir pelo medido   |
| `.enterprise` |         446 |             484 | +12 / +16                            | cabe                                     |
| `tools`       |         375 |             393 | +4 / +10                             | cabe                                     |
| `docs`        |           7 |               7 | 0 / +1                               | alto exige +1 somente com doc de usuário |
| demais        | 245/61/19/7 |     250/62/21/7 | 0 / +1                               | cabem                                    |

As colunas W5 do híbrido são **estimativa, não decisão** (o runtime de navegador e computer-use passa a ser do core); o número que vale é o medido no fechamento da onda.

**Risco (`packages` sem folga):** os arquivos novos contratados em `packages/` somam 24 (`agent-environment` 14, `agent-memory` 5, `agent-context` 2, `agent-runtime-contracts` 1, `agent-isolation-attestation` 2); 113 + 24 = 137, folga zero. Se a medição passar de 137, a onda para em G3 com o número medido; o orçamento não é aumentado sem esse gate.

**Risco (`.agents` sem folga):** os 5 plugins (lsp, dap, browser, computer-use, memory) exigem pelo menos 2 entradas por definição em `.enterprise/governance/plugins/definitions/` e o espelho gerado em `.agents/`, cerca de 10 entradas ou mais, contra folga medida de 7 (186 de 193) e W5 projetado em +6/+8. O primeiro estouro é provável a partir da W5-05, que cria o primeiro plugin, e se agrava a cada plugin seguinte. Nenhum orçamento é aumentado: se a medição estourar, a onda para em G3 com o número medido.

**Para a implementação:** o teste de superfície exige soma dos orçamentos por área ≤ teto; com `packages` 137 a soma é 1554, por isso o teto aprovado é 1554. A alteração de `test/test-package-surface.js` (`packages` 137, teto 1554) entra na **W5-02a**, a primeira task que adiciona entradas em `packages`.

### 7.4 Dependências de terceiros e licenças

Aprovada a lista de pins e a política **sem download em tempo de execução; sem cache = BLOCKED**.

| Pin                                              | Licença esperada\*               | Estado no host                                  |
| ------------------------------------------------ | -------------------------------- | ----------------------------------------------- |
| `typescript` / `typescript-language-server`      | Apache-2.0                       | `typescript` 5.9.3 transitivo; servidor ausente |
| `pyright`                                        | MIT                              | ausente                                         |
| `debugpy`                                        | MIT                              | ausente                                         |
| `js-debug`                                       | MIT                              | ausente                                         |
| `playwright-core` + `chrome-headless-shell-1228` | Apache-2.0 + BSD-3 e componentes | Chromium presente; pacote a fixar               |
| `Xvfb`, `xwd`                                    | X11 (estilo MIT)                 | presentes                                       |
| `xdotool` (BSD), pin externo                     | BSD                              | ausente                                         |

\*Licenças conforme os projetos oficiais; **não conferidas** nesta task. A conferência de licença **no artefato fixado** é critério de aceite de cada task de capacidade (W5-02b1 para o ensaio do Chromium, W5-05, W5-06, W5-07, W5-08). `python-xlib` (LGPL-2.1+) foi retirado das alternativas: a entrada X11 é `xdotool`.

### 7.5 Isolamento

Aprovados P1 (loopback) e P2 (egresso mediado pelo broker com allowlist). O filtro seccomp por argumento permite `AF_UNIX` e `AF_INET*` e mantém bloqueados `AF_NETLINK`, `AF_PACKET`, `AF_VSOCK` e `io_uring`. Chromium roda com `--no-sandbox`, sempre dentro do `bwrap` (o `bwrap` é o sandbox). Ensaio inviável = BLOCKED com a causa, nunca perfil afrouxado.

### 7.6 Modelo nos ensaios (W5-11b)

Rotas autorizadas, nesta ordem: (1) local ou de custo zero; (2) assinaturas Claude/Codex com no máximo **3 despachos por binding**; (3) API paga com **teto de US$ 1**. Cada despacho segue reserva e depois recibo. Sem rota disponível a tarefa fica BLOCKED. Gasto além do teto exige nova pergunta ao owner (G4).

### 7.7 Aceite endurecido na W5

O contrato de tarefa de engenharia v2 passa a recusar critérios de aceite fracos (pendência A5b da revalidação): entrega sem verificador executável é recusada com `detail.code` próprio. Inclui o resíduo baixo do REVIEW3-C1 (normalização lexical dos args de `command_checks`). Task nova **W5-10b**, na onda B4. Escolha da onda: B1 já tem o limite aprovado de 3 agentes e a W5-02b2 toca `engineering-task-contract.js` e `engineering-project-verifier.js` (regex de caminho do pnpm e testes nativos do projeto), então a W5-10b depende da W5-02b2 e roda depois, em B4, sem colisão e antes do consumidor real (W5-11b). Detalhes em [tasks.md](../../../.specs/features/harness-w5/tasks.md).

### 7.8 Itens menores

- B1 com 3 agentes simultâneos: W5-02a, W5-02b1 seguida de W5-02b2 (a antiga W5-02b, dividida pelo Commander) e W5-04; builds serializadas.
- Pendências fora da W5, apenas registradas: `loop-guard` em `node_modules`, evidência de saída nos adapters API/ACP/local, digest de conta sem sal, hook de commit com nomes de fornecedor.
- A1/N2 e N1 da [validação em consumidor](../consumer-validation-2026-10/STATUS.md): executor lê o virtual store do pnpm e verificador roda os testes nativos do projeto entram na W5-02b2; `detail.code` nas recusas por regra cruzada (N1) entra na W5-10b.

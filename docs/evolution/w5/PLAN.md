# W5 — capacidades de ambiente, contexto com autoridade e memória

Tipo: plano de execução da onda W5, redigido em 2026-10-10 (W5-01). Escopo: W5; W6-W8 e quarta família permanecem fora.
Base: `e079409c` (master após a PR #214: W0-W4 e revalidação do core). Feature: `feature/hseos-evolution-w5`; upstream: `master`.
Task inicial: `task/hseos-w5-contracts` (W5-01).
Governança: `AGENTS.md`, Constituição §§2.3/2.6/5/7, políticas de ADR e validação automatizada, ADR-0043 e ADR-0047 (Proposed).
Contratos: [spec](../../../.specs/features/harness-w5/spec.md), [design](../../../.specs/features/harness-w5/design.md), [tasks](../../../.specs/features/harness-w5/tasks.md), [intake](../../decisions/harness-w5-intake.md).

## 1. Confronto com o estado atual

A W5 estende a base; não reescreve serviços existentes (invariantes de [../PLAN.md](../PLAN.md)).

| Área                     | Base verificada                                                                          | Trabalho efetivo                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Contexto                 | Fontes sem autoridade nem origem; referências e memória já são dado citado; texto apenas | `authority`, `provenance`, mídia por referência, contador de mídia, proveniência no evento |
| Execução isolada         | Sem rede, saída 64 KiB, `pids_max` 32, seccomp bloqueia sockets                          | Perfis P0/P1/P2, limites por chamada, canal de artefatos verificado                        |
| LSP / DAP                | Inexistentes                                                                             | Contratos e clientes no core; servidores e adaptadores como toolchain pins                 |
| Navegador / computer-use | Inexistentes; Xvfb e Chromium do Playwright presentes no host                            | Plugins separados; egresso mediado; aprovação por ação                                     |
| Memória                  | `memory[]` no assembler sem armazenamento                                                | Pacote sobre o ledger com política, TTL e autoridade fixa                                  |
| Compactação              | Testes isolados                                                                          | Cenário combinado compactação, crash, resume e fork                                        |
| MCP                      | Tolerância a tool malformada e servidor legado fora da fixture                           | Falha fechada, negações no ledger, contratos versionados                                   |
| Superfícies              | Evidência sem autoridade/proveniência                                                    | Campos aditivos em API, eventos, CLI e SDKs                                                |

Decisões do owner (2026-10-09 e 2026-10-10) incorporadas sem reabertura: ondas dev-squad/SWARM; capacidades pesadas e opcionais em plugins separados por mérito; teto 1540 com orçamento por área; computer-use só em Xvfb com aprovação por ação; modelo local ou sem custo primeiro, pago só com G4; axon opcional; BLOCKED nunca vira PASS.

## 2. Arquitetura e distribuição core x plugin (recomendação, por item)

| Item                             | Recomendação                                                           | Razão (resumo; completa no design)                                                |
| -------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Contexto/autoridade/mídia        | Core                                                                   | Contrato transversal, sem dependência externa                                     |
| Perfis de isolamento e artefatos | Core                                                                   | Fronteira de segurança compartilhada; P0 inalterado                               |
| MCP subordinado                  | Core                                                                   | Superfície de segurança; não pode depender de instalação opcional                 |
| LSP                              | **Core** (contrato, cliente stdio, validador); servidores como pins    | Protocolo leve, sem dependência npm; validador de escopo é fronteira de segurança |
| DAP                              | **Core** (execução roteirizada, sem `evaluate`); adaptadores como pins | Idem; sessão interativa fica para a W6                                            |
| Memória                          | **Core**                                                               | Precisa de escrita com CAS no ledger e política, que plugin não recebe            |
| Navegador                        | **Plugin separado** (`plugins/browser`)                                | Playwright e Chromium com ciclo de release e segurança próprios, centenas de MB   |
| Computer-use                     | **Plugin separado** (`plugins/computer-use`), Linux                    | Dependência de sistema X11 e risco próprio; gate de aprovação no core             |

Contratos e validadores de navegador e computer-use ficam no core (pequenos), para que a fronteira de segurança não dependa do plugin.

## 3. Sequência e entregas

| Onda | Tasks                        | Saída                                                                              | Condição de avanço                                                                 |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| B0   | W5-01                        | spec, design, tasks, intake, ADR-0047, grafo                                       | G2 aprovado                                                                        |
| B1   | W5-02a, W5-02b, W5-04        | contexto com autoridade e mídia; perfis de isolamento e artefatos; MCP subordinado | negativos verdes; P0 inalterado; ensaio de viabilidade de Chromium/Xvfb registrado |
| B2   | W5-03, W5-05, W5-06          | compactação combinada; LSP; DAP                                                    | escopo de workspace e drenagem comprovados                                         |
| B3   | W5-07, W5-08, W5-09          | navegador; computer-use; memória                                                   | egresso, aprovação por ação e autoridade de memória comprovados                    |
| B4   | W5-10, W5-11a, W5-11b, W5-12 | superfícies; matriz negativa e mutantes; consumidor real; fechamento               | critérios da seção 4; PR (G6)                                                      |

## 4. Verificação e pronto

Pronto por task: positivos e negativos verdes em Node 22 e 24; cobertura de arquivo crítico ≥90% linhas e ≥80% branches (incluindo arquivos novos não executados); nenhum efeito antes de admissão e aprovação; revisão cética de duas passagens; recibo com revisão, ambiente, comando e resultado.

W5 tecnicamente pronta:

- FR01-FR13 implementados e evidenciados; matriz de rastreabilidade FR → task → teste → recibo.
- `npm test`, `test:kernel-coverage`, mutantes W5 e `quality-gates --phase ci` verdes em Node 22 e 24, sequenciais, sem afrouxar threshold.
- Pacote do core dentro do teto e dos orçamentos por área aprovados no G3; pacotes de plugin dentro do teto próprio.
- Consumidor real instalado offline fora do checkout percorre LSP → DAP → correção → navegador com screenshot → aceite por verificador externo fixado; ou BLOCKED explícito com causa.
- Docs distinguem determinístico, consumidor real e ativação.

Três estados por marco, como na W4: determinístico; consumidor real; ativação (não autorizada).

## 5. Riscos

- Chromium e Xvfb dentro de `bwrap` sob seccomp e cgroup: viabilidade, memória e processos não verificados. Mitigação: ensaio em W5-02b antes de B3; falha = BLOCKED.
- Cache offline de binários (language servers, debugpy, js-debug, playwright-core, ferramenta de entrada X11): ausentes no host. Sem cache = BLOCKED.
- Filtro seccomp por argumento para P1/P2: mudança de segurança no kernel compartilhado. Mitigação: revisão cética e teste negativo por syscall; decisão G2.
- Schema de contexto com impacto amplo: análise de impacto prévia e leitura v1.
- Carga do host: suíte integral leva horas por versão de Node; `heavy-run`, um job pesado por vez, `--maxWorkers` limitado em suítes jsdom do consumidor.
- Consumidor real com muitos workspaces: nunca disparar `pnpm`/`npm test` na raiz de monorepo sem teto (fan-out).

## 6. Governança, ondas e versionamento

Coordenação: dev-squad / SWARM (`.hseos/workflows/dev-squad/workflow.md`, ADR-0015). Commander Opus planeja, extrai handoffs e fecha decisões; squad Sonnet em worktrees `.worktrees/hseos-w5-<task>`. Revisores céticos Sonnet, isolados, sem o raciocínio do executor; reportam e não corrigem. 1 task = 1 commit; 1 onda = 1 PR para `feature/hseos-evolution-w5`; a W5 inteira vira uma PR para a master. Tags locais por onda (`hseos-w5-b1`, ...); push de tags só no merge. No máximo 3 rodadas de correção por entrega; depois, causa raiz e mudança de estratégia registrada. Sem atribuição de IA em commits e PRs. Agentes não fazem merge (`hseos pr closeout <n> --approved` após aprovação).

Gates humanos: G2 (esta seção 7), G3 (qualquer aumento do teto 1540 ou de orçamento de área), G4 (gasto com modelo pago), G6 (merge da PR da W5). Publicação, instalação global e ativação ficam fora do escopo.

## 7. Decisões para o gate G2

O owner precisa decidir, depois que o Commander fechar as recomendações arquiteturais do design:

### 7.1 Consumidor real da W5

Requisito: stack TS/web, testes automatizados e UI para a verificação no navegador, em clone descartável.

|                             | Candidato A (recomendado)                                                                                                                                                                                                                | Candidato B                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Projeto                     | `/workspace/github/hideaki-solutions/cambio-real/apps/platform-web`                                                                                                                                                                      | `/workspace/github/hideaki-solutions/axon-web`                                                                                               |
| Stack                       | React 18, Vite, TypeScript, vitest, Playwright (`playwright.config.ts`, pasta `e2e/`)                                                                                                                                                    | React 19, Vite, TypeScript, ESLint                                                                                                           |
| Testes                      | 86 arquivos `*.test.ts*`/`*.spec.ts*` encontrados, vitest com happy-dom                                                                                                                                                                  | nenhum teste automatizado encontrado                                                                                                         |
| UI para o navegador         | painel de ledger (dashboard) e suíte e2e existente                                                                                                                                                                                       | grafo (sigma) e páginas React                                                                                                                |
| Como obter "teste falhando" | usar um teste real existente com defeito injetado em clone descartável, ou um bug reproduzível; verificador externo fixado = vitest do arquivo afetado                                                                                   | criar o teste e o defeito no clone (sintético, sem teste de origem)                                                                          |
| Pontos de atenção           | `node_modules` ausente; offline install a partir de cache **[não verificado]**; vive em monorepo (`apps/` com várias aplicações): clonar só `apps/platform-web` e rodar com `--maxWorkers=2`, nunca comando de teste na raiz do monorepo | sem `node_modules`; sem testes de origem: a prova de aceite depende do que o harness injeta, o que enfraquece a evidência de consumidor real |
| Justificativa               | exercita LSP/DAP em TypeScript real, tem UI para screenshot e verificador independente já existente                                                                                                                                      | menor e rápido, UI relevante, mas sem testes reais                                                                                           |

Considerado e descartado: `mcp-factory/devflow_mcp` (TS com vitest e `node_modules` presentes, mas sem UI, logo não exercita o navegador). Também pode servir de terceiro consumidor para a perna LSP/DAP isolada.
Pedido ao owner: escolher A, B ou A+B; autorizar o clone descartável e a instalação offline a partir do cache.

### 7.2 Distribuição core x plugin por item

Confirmar a tabela da seção 2 ou indicar mudança item a item. Pontos que merecem atenção explícita: LSP e DAP no core com servidores como pins; memória no core; navegador e computer-use fora do tarball do core em `plugins/*` (diretório novo, fora de `files`); contratos de navegador e computer-use dentro do core.

### 7.3 Orçamento por área (G3)

Medido em `e079409c`, Node 24: 1459 entradas (teto 1540). Projeção W5 do core: central +39 (1498), alta +61 (1520); o teto basta.

| Área                                 |            Medido |   Orçamento atual | W5 central/alto | Decisão pedida                                            |
| ------------------------------------ | ----------------: | ----------------: | --------------- | --------------------------------------------------------- |
| `packages`                           |               113 |               123 | +17 / +24       | **não cabe**: +7 a +14; proposta 123 → 137                |
| `.agents`                            |               186 |               193 | +6 / +8         | alto excede 1; proposta 193 → 194                         |
| `docs`                               |                 7 |                 7 | 0 / +1          | alto exige +1 (somente se houver doc de usuário novo)     |
| `.enterprise`                        |               446 |               484 | +12 / +16       | cabe; folga de 15 pode financiar a realocação (484 → 469) |
| `tools`                              |               375 |               393 | +4 / +10        | cabe                                                      |
| `src`, `.hseos`, `scripts`, `(root)` | 245 / 61 / 19 / 7 | 250 / 62 / 21 / 7 | 0-1             | cabem                                                     |

Opção 1 (recomendada): realocar entre áreas mantendo o teto 1540 (`packages` 137, `.agents` 194, `.enterprise` 469; soma 1540). Opção 2: elevar `packages` e o teto na mesma medida. Opção 3: colocar `agent-environment` e `agent-memory` em `tools/cli/lib` (cabem em `tools`), com perda de reuso pela W6. Teste de pacote só muda com a decisão G3; esta task não o altera. Limites de unpacked (14 MB) continuam: a W5 do core adiciona bem menos de 1 MB.
Pacotes de plugin: pedir aprovação de teto próprio (proposta ≤40 entradas e ≤1 MB cada, excluído o cache de navegador pinado).

### 7.4 Dependências de terceiros e licenças

Aprovar a lista de pins e a política "sem download em runtime, cache offline, sem cache = BLOCKED":

| Pin                                                           | Licença esperada\*               | Estado no host                                  |
| ------------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| `typescript` / `typescript-language-server`                   | Apache-2.0                       | `typescript` 5.9.3 transitivo; servidor ausente |
| `pyright`                                                     | MIT                              | ausente                                         |
| `debugpy`                                                     | MIT                              | ausente                                         |
| `js-debug`                                                    | MIT                              | ausente                                         |
| `playwright-core` + Chromium `chromium-1228`                  | Apache-2.0 + BSD-3 e componentes | Chromium presente; pacote a fixar               |
| `Xvfb`, `xwd`                                                 | X11 (MIT-estilo)                 | presentes                                       |
| `xdotool` (BSD) ou `python-xlib` (LGPL-2.1+) para entrada X11 | ver ao lado                      | ausente: **escolher**                           |

\*Licenças conforme os projetos oficiais; **não conferidas** nesta task. A conferência no artefato fixado é critério de aceite de cada task de capacidade. A licença LGPL, se escolhida para a ferramenta de entrada, exige decisão específica sobre distribuição.

### 7.5 Perfis de isolamento (segurança)

Aprovar a criação dos perfis P1 (loopback) e P2 (egresso mediado) com filtro seccomp por argumento (permitir `AF_UNIX`/`AF_INET*`; manter bloqueio de `AF_NETLINK`, `AF_PACKET`, `AF_VSOCK`, `io_uring`) e o uso de `--no-sandbox` no Chromium dentro do `bwrap`. Alternativa: manter só P0 e adiar navegador, depurador e computer-use.

### 7.6 Autorização de campanha real

A jornada W5-11b usa modelo local ou sem custo. Pedir: (a) confirmar que bindings locais/zero-custo bastam, e (b) se nenhum estiver disponível, a tarefa fica BLOCKED e o owner é perguntado sobre assinatura (Claude/Codex), token de API ou outra rota, com teto explícito (G4). Nenhum gasto pago está autorizado por este plano.

### 7.7 Outras decisões menores

- Endurecer o contrato de tarefa contra critérios fracos (F09/F10, pendência A5b) ou só usar verificador fixado na W5 (recomendado: só verificador fixado; endurecimento como decisão separada).
- B1 com 3 agentes (W5-02a, W5-02b, W5-04) em vez de 2: aceitável porque os arquivos não colidem e as builds são serializadas.
- Itens fora da W5 registrados: `loop-guard` em `node_modules`, evidência de saída nos adapters API/ACP/local, digest de conta sem sal, hook de commit com nomes de fornecedor.

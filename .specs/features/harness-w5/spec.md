# W5 - Capacidades de ambiente, contexto com autoridade e memória

Tipo: especificação de contratos W5 (W5-01), redigida em 2026-10-10. Gate G2 aprovado pelo owner em 2026-10-11. Estado em 2026-10-20: a W5 está na `master` (PR #230, merge `eecfaa90`; depois #231 e #232); o aceite técnico da W5 foi registrado em `docs/evolution/w5/STATUS.md` e a ativação (G6) segue pendente.
Fonte: [plano W5](../../../docs/evolution/w5/PLAN.md), [plano original](../../../docs/evolution/PLAN.md) (linha W5 e invariantes), inventário `docs/evolution/requirements.json` (F14-R1, F15-R1, F20-R1) pendências de [revalidação 2026-10](../../../docs/evolution/revalidation-2026-10/STATUS.md) e pendências da [validação em consumidor 2026-10](../../../docs/evolution/consumer-validation-2026-10/STATUS.md) (A1/N2, verificador com testes nativos, N1).
Base examinada: `e079409c` (master com W0-W4 e revalidação do core).

## Propósito

Dar ao agente percepção e ação sobre o ambiente de engenharia (código, execução, navegador, display) sem criar um segundo plano de autoridade: toda capacidade é admitida como plugin ou módulo governado, executa isolada, passa por ToolRuntime e política, e devolve ao contexto dados com origem, autoridade e digest declarados. Memória e compactação passam a preservar essas declarações entre sessões.

## Atores e escopo

Operador individual, autor de plugin de ambiente, cliente CLI/API/SDK, agente de engenharia (via kernel) e verificador externo fixado.
Famílias de origem: F14 (contexto), F15 (compactação), F20 (MCP) e a linha W5 do plano (LSP, debug, navegador, computer-use, multimodal, memória). Transversais: F09/F10 (aceite independente e correção), F19 (paridade de superfícies).
Dependência: W4 integrada (master) e Fase A de revalidação integrada (PR #214).

## Fora de escopo

- IDE Code OSS, painéis, revisão visual de artefatos e terminais integrados: W6 (F25). A W5 expõe contratos e eventos que a W6 consome; não os apresenta.
- Servidores próprios, identidade por projeto, trabalhadores remotos, execução nativa macOS/Windows: W7. Capacidades W5 certificam Linux x64.
- Campanhas comparativas e quarta família de provider: W8 e posterior.
- Computer-use sobre a sessão gráfica real do operador: **proibido**, não apenas adiado.
- Download de binários em tempo de execução, instalação global, publicação, merge e ativação operacional (decisões separadas).
- Reconhecimento ou geração de áudio/vídeo; a parte multimodal da W5 cobre imagem (ver design, partes de conteúdo).

## Requisitos funcionais

- W5-FR01 (F14-R1): Toda fonte de contexto declara `authority`; dado recuperado, memória, saída de ferramenta, DOM, texto de tela e mídia nunca ampliam política, ferramentas, escopo ou orçamento. Fonte que tente ocupar camada diretiva sem autoridade correspondente é recusada antes da montagem.
- W5-FR02 (F14-R1, linha W5): O contexto aceita partes não textuais (imagem) com `media_type`, `digest`, `bytes`, `source_ref`, `origin` e `transform`; o digest é conferido contra os bytes antes do uso, o teto de bytes e o custo em tokens são contados, e provider sem `image_input` é rejeitado antes de qualquer efeito.
- W5-FR03 (F14-R1): Memória governada persiste entre sessões com política de escrita, TTL, autoridade e origem gravadas; recuperação alimenta `memory[]` do assembler; entrada não consegue elevar a própria autoridade nem escrever sem política que a admita; a ponte `mcp-axon-bridge/memory_search` é opcional e somente leitura.
- W5-FR04 (F15-R1): Compactação, crash, retomada e fork, combinados, produzem estado equivalente ao histórico integral nos aspectos observáveis (lineage, critérios de aceite fixados, `source_refs` e autoridade), sem reescrever eventos.
- W5-FR05 (F20-R1): Servidores MCP permanecem subordinados ao gateway governado e a contratos versionados: servidor/tool malformado falha fechado; tool desconhecida e acesso fora do escopo são negados e registrados no ledger; o caminho legado não executa fora de fixtures.
- W5-FR06 (linha W5): LSP para TypeScript e Python restrito à raiz do workspace; ações diagnostics, definition, references, hover e rename somente em preview (nenhuma escrita em disco).
- W5-FR07 (linha W5): Debug (DAP) para Node e Python dentro do sandbox; ações breakpoints, stack, variables, step e encerramento; tempo limitado; nenhum descendente sobrevive ao término.
- W5-FR08 (linha W5): Navegador headless com egresso somente pelo broker e allowlist (localhost do projeto por padrão); screenshot e DOM viram partes de contexto com URL, hora e digest.
- W5-FR09 (decisão do owner 4): Computer-use somente em display virtual isolado, com aprovação por ação pela policy lattice e captura de tela com proveniência; acesso ao display real é negado.
- W5-FR10 (F22, F04): Distribuição híbrida (G2): contratos e runtime de cada capacidade de ambiente ficam no core com carregamento tardio das dependências pesadas, e cada uma também é empacotável como plugin (`plugins/*`, kind `tool` ou `context-source`) a partir da mesma implementação, sem duplicar código; binários são pins em cache offline fora dos tarballs; todas executam em perfil de isolamento declarado, sem import no host, e declaram limites de processos, memória, tempo e saída adequados à capacidade.
- W5-FR11 (F19 transversal): Autoridade e proveniência são visíveis em `/v1/tasks/{id}/evidence` e nos eventos, com paridade CLI e SDK JS/TS/Python; leitores v1 continuam funcionando; nenhum código executável trafega por HTTP.
- W5-FR12 (F09/F10): Os consumidores reais A (`cambio-real/apps/platform-web`, prova principal) e B (`axon-web`, segunda prova de UI com teste e defeito sintéticos declarados) são aceitos por verificador externo fixado antes do despacho; critério de aceite interno fraco (por exemplo um único `content-includes`) não é aceito como prova isolada (pendência A5b).
- W5-FR13 (revalidação): As pendências de MCP e de limites do executor registradas na revalidação são absorvidas ou explicitamente classificadas como fora da W5 (ver design, tabela de pendências).
- W5-FR14 (F09/F10, A5b, REVIEW3-C1, N1): O contrato de tarefa de engenharia v2 recusa na admissão entrega sem verificador executável (`verifier.command_checks` com `protected_paths`, ou verificador fixado), com `detail.code` próprio; os args de `command_checks` seguem alfabeto conservador; recusas por regra cruzada expõem `detail.code`. Task W5-10b.
- W5-FR15 (validação em consumidor, A1/N2): O executor do projeto gerenciado lê o virtual store do pnpm (caminhos com `@`, symlinks e hardlinks do store dentro de raiz verificada, limites de caminhos, bytes e comprimento tratados sem truncar em silêncio) e o verificador executa os testes nativos do projeto como `command_checks`. Task W5-02b2.

### Rastreabilidade FR para task

| FR   | Task(s)                        | NFR relacionadas |
| ---- | ------------------------------ | ---------------- |
| FR01 | W5-02a                         | NFR01, NFR02     |
| FR02 | W5-02a                         | NFR03, NFR06     |
| FR03 | W5-09                          | NFR03, NFR08     |
| FR04 | W5-03                          | NFR02            |
| FR05 | W5-04                          | NFR02            |
| FR06 | W5-05                          | NFR07            |
| FR07 | W5-06                          | NFR07            |
| FR08 | W5-07                          | NFR03, NFR07     |
| FR09 | W5-08                          | NFR01, NFR07     |
| FR10 | W5-02b1, W5-05, 06, 07, 08, 09 | NFR05, NFR06     |
| FR11 | W5-10                          | NFR02            |
| FR12 | W5-11b, W5-10b                 | NFR05            |
| FR13 | W5-04, W5-02b1, W5-10          | NFR02            |
| FR14 | W5-10b                         | NFR02            |
| FR15 | W5-02b2                        | NFR05            |

W5-11a (matriz negativa e mutantes) e W5-12 (fechamento) cobrem NFR04, NFR06 e NFR07 sobre todas as FR. Esta matriz é a fonte única: o `requirements` de cada task em `tasks.md` lista as FR da task e a união das NFR dessas FR; W5-11a acrescenta NFR04 e W5-12 acrescenta NFR04, NFR06 e NFR07 sobre todas as FR (FR01-FR15).

## Requisitos não funcionais e constraints

- NFR01: autoridade só diminui na delegação; capacidade nova não amplia política, grants nem orçamento. Constituição §§2.3/2.6/5/7; `deriveChildAuthority` (`packages/agent-policy-lattice/index.js:189`).
- NFR02: contratos e eventos novos recebem versão explícita; históricos v1 permanecem legíveis; nenhum evento é reescrito para obter PASS. Data Contracts & Schema Evolution Standard.
- NFR03: segredos, cookies, tokens e credenciais não entram em prompt, workspace, log, screenshot persistido ou memória; mídia e DOM passam por varredura de credenciais antes de persistir (reuso de `containsCredential`, `tools/cli/lib/campaign-evidence-store.js`).
- NFR04: matriz Node 22/24 sequencial; cobertura crítica por arquivo 90% linhas e 80% branches, incluindo arquivos não executados; mutantes W5 para ampliação de autoridade, perda de proveniência e bypass de aprovação.
- NFR05: cargas pesadas (suíte integral, Chromium, language servers, depurador) seguem `heavy-run` e a regra de um job pesado por vez (AGENTS global §3f); `uptime` antes de cada execução.
- NFR06: pacote npm do core permanece dentro do teto de entradas e dos orçamentos por área de `test/test-package-surface.js`; aumento de qualquer orçamento de área é decisão G3 e não é feito por esta task.
- NFR07: dependências de terceiros são fixadas por versão e digest, com licença registrada; instalação offline a partir de cache local; sem cache o resultado é BLOCKED, nunca PASS.
- NFR08: axon é integração opcional; nenhum caminho de aceite depende do índice axon.
- NFR09: intake v2 antes de novos exports ([intake](../../../docs/decisions/harness-w5-intake.md)); AEW aplicação/enforcement não verificados nesta unidade.

## Decisões confirmadas e fronteiras

1. Execução em ondas dev-squad/SWARM (B1 a B4); 1 task = 1 commit; 1 onda = 1 PR para `feature/hseos-evolution-w5`.
2. Distribuição híbrida (G2, 2026-10-11): contratos e runtime de todas as capacidades (LSP, DAP, memória, navegador, computer-use) no core com carregamento tardio; cada uma também empacotável em `plugins/*` a partir da mesma implementação; binários como pins em cache offline fora dos tarballs. Justificativa por item em [design.md](design.md).
3. Computer-use somente em Xvfb isolado com aprovação por ação.
4. Modelos reais: local ou sem custo primeiro; assinaturas Claude/Codex com no máximo 3 despachos por binding; API paga com teto de US$ 1; cada despacho segue reserva e recibo; gasto além do teto exige G4; sem rota, BLOCKED.
5. Teto do core 1554 com orçamento de `packages` em 137 (opção "elevar o teto", G3 de 2026-10-11); acima disso só pelo número medido no fechamento da onda, com novo G3; plugins ≤40 entradas e ≤1 MB cada.
6. Axon é integração opcional. BLOCKED nunca vira PASS; nenhum gate é afrouxado.
7. ADR-0047 é Accepted (2026-10-11): aprova o design da W5; merge, publicação e ativação operacional continuam não concedidos.

Contratos detalhados em [design.md](design.md); sequência em [tasks.md](tasks.md).

## Aceite e evidências

Três estados separados por requisito, como na W4: determinístico, consumidor real e ativação.

- Determinístico: cada FR tem caso positivo, rejeição relevante e recibo no snapshot examinado; matriz de negativos da W5-11.
- Consumidor real: core e plugins instalados offline fora do checkout; o consumidor A (projeto TS com teste falhando) percorre LSP, DAP, correção, verificação no navegador com screenshot e aceite por verificador externo fixado; o consumidor B é segunda prova de UI, com teste e defeito sintéticos declarados. Rotas de modelo e teto na decisão 4. Bloqueio vira BLOCKED com causa.
- Ativação: não autorizada por esta especificação.

Não declarar PASS por presença de código, mocks, logs de outra revisão ou plataforma não exercitada.

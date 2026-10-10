# W5 - Capacidades de ambiente, contexto com autoridade e memória

Tipo: especificação de contratos W5 (W5-01), redigida em 2026-10-10. Aceite técnico pendente; gate humano G2 pendente.
Fonte: [plano W5](../../../docs/evolution/w5/PLAN.md), [plano original](../../../docs/evolution/PLAN.md) (linha W5 e invariantes), inventário `docs/evolution/requirements.json` (F14-R1, F15-R1, F20-R1) e pendências de [revalidação 2026-10](../../../docs/evolution/revalidation-2026-10/STATUS.md).
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
- W5-FR10 (F22, F04): Cada capacidade de ambiente é um plugin (kind `tool` ou `context-source`) ou módulo do core com justificativa registrada; todas executam em perfil de isolamento declarado, sem import no host, e declaram limites de processos, memória, tempo e saída adequados à capacidade.
- W5-FR11 (F19 transversal): Autoridade e proveniência são visíveis em `/v1/tasks/{id}/evidence` e nos eventos, com paridade CLI e SDK JS/TS/Python; leitores v1 continuam funcionando; nenhum código executável trafega por HTTP.
- W5-FR12 (F09/F10): O consumidor real é aceito por verificador externo fixado antes do despacho; critério de aceite interno fraco (por exemplo um único `content-includes`) não é aceito como prova isolada (pendência A5b).
- W5-FR13 (revalidação): As pendências de MCP e de limites do executor registradas na revalidação são absorvidas ou explicitamente classificadas como fora da W5 (ver design, tabela de pendências).

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
2. Capacidades pesadas e opcionais (navegador, computer-use) ficam em pacotes de plugin separados por mérito arquitetural; LSP, DAP e memória ficam no core conforme justificativa por item em [design.md](design.md).
3. Computer-use somente em Xvfb isolado com aprovação por ação.
4. Modelos reais: local ou sem custo primeiro; pago só com autorização própria (G4); bloqueio é BLOCKED.
5. Teto do pacote 1540 com orçamento por área; qualquer aumento (inclusive de uma área) é G3.
6. Axon é integração opcional. BLOCKED nunca vira PASS; nenhum gate é afrouxado.
7. ADR-0047 é Proposed: documenta a implementação candidata, sem aprovação institucional nem ativação.

Contratos detalhados em [design.md](design.md); sequência em [tasks.md](tasks.md).

## Aceite e evidências

Três estados separados por requisito, como na W4: determinístico, consumidor real e ativação.

- Determinístico: cada FR tem caso positivo, rejeição relevante e recibo no snapshot examinado; matriz de negativos da W5-11.
- Consumidor real: core e plugins instalados offline fora do checkout; um projeto TS com teste falhando percorre LSP, DAP, correção, verificação no navegador com screenshot e aceite por verificador externo fixado, com modelo local. Bloqueio vira BLOCKED com causa.
- Ativação: não autorizada por esta especificação.

Não declarar PASS por presença de código, mocks, logs de outra revisão ou plataforma não exercitada.

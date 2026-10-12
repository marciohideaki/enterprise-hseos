# ADR-0047: Capacidades de ambiente com runtime no core e distribuição por plugin, autoridade e proveniência de contexto, partes multimodais

## Status

Accepted — 2026-10-11. O owner aprovou o gate G2 em 2026-10-11 (proposta original de 2026-10-10,
W5-01 Contratos): design, consumidores reais, distribuição híbrida, perfis de isolamento, pins e
modelo nos ensaios. Merge, publicação e ativação operacional continuam não concedidos; aumento do
teto do pacote só pelo número medido (G3) e gasto acima de US$ 1 com modelo pago exige G4.

## Context

O kernel executa ferramentas, workflows e jobs sob uma única autoridade (ADR-0045), mas não
percebe nem age sobre o ambiente de engenharia: não há LSP, depuração, navegador, display
virtual, contexto multimodal nem memória entre sessões. O contexto trata referências e memória
como dado citado, mas as fontes não declaram autoridade nem origem, e o evento
`context.assembled` registra apenas referências. O executor isolado atual é sem rede, limita a
saída a 64 KiB e usa `pids_max` 32, o que impede navegador, depurador e captura de tela.
Esta decisão se apoia nos ADR-0043, ADR-0044 e ADR-0045, que o índice ainda marca como Proposed ou draft; a aceitação do ADR-0047 não promove nem aceita esses ADRs, e a leitura deles continua sujeita ao status próprio. Capacidades como essas ampliam a superfície de ataque (injeção por dado recuperado, escape de
escopo, egresso de rede, controle de display) e a de distribuição (binários pesados).

## Decision

1. **Autoridade e proveniência de contexto.** Cada fonte declara `authority` (`directive`,
   `operator`, `data`) e `provenance` (origem, digest, hora, confiança, cadeia de
   transformações). Somente configuração do operador ocupa a camada diretiva; dado recuperado,
   memória, saída de ferramenta, DOM, texto de tela e mídia são `data` e nunca ampliam
   política, ferramentas, escopo ou orçamento. Leitura v1 preservada por derivação de camada.
2. **Partes multimodais.** Imagem entra como `media-source` v1 (tipo, digest, bytes,
   origem, transformações) por referência de artefato endereçado por conteúdo; o digest é
   conferido antes do uso, o custo em tokens é contado e provider sem `image_input` é rejeitado
   antes do efeito. `AgentMessage` v1 não muda.
3. **Capacidades de ambiente: distribuição híbrida.** Cada ação é uma tool `environment.*` com
   contrato versionado no ToolRuntime, política da lattice e execução no executor isolado.
   Contratos e runtime de todas as capacidades (LSP, DAP, memória, navegador, computer-use)
   ficam no core, com carregamento tardio das dependências pesadas e sem dependência npm nova.
   Cada capacidade também é empacotável como plugin em `plugins/*` (kind `tool`) a partir da
   mesma implementação, sem duplicar código (teste de paridade de digest). Binários e
   `playwright-core` (Chromium `chromium-1228`, `typescript-language-server`, `pyright`,
   `debugpy`, `js-debug`, `xdotool`) são pins fixados por digest em cache offline, fora dos
   tarballs; sem download em tempo de execução e sem cache o resultado é BLOCKED. Computer-use
   só em display virtual isolado, com aprovação por ação; a entrada X11 é `xdotool` (BSD).
4. **Perfis de isolamento e canal de artefatos.** O executor ganha perfis nomeados escolhidos
   pelo controlador (P0 sem rede, P1 loopback, P2 loopback com egresso mediado por broker com
   allowlist), limites por chamada e um diretório de artefatos verificado pelo controlador.
   P0 permanece o padrão e inalterado. O filtro seccomp por argumento permite `AF_UNIX` e
   `AF_INET*` e mantém bloqueados `AF_NETLINK`, `AF_PACKET`, `AF_VSOCK` e `io_uring`; o Chromium
   roda com `--no-sandbox`, sempre dentro do `bwrap`.
5. **Memória governada no core** sobre o ledger existente, com política de escrita, TTL,
   autoridade fixa `data` e origem gravada; plugin `context-source` não pode hospedá-la porque
   não recebe ledger.
6. **MCP subordinado.** Falha fechada para servidor/tool malformado, caminho legado só em
   fixture, negações registradas no ledger e contratos `environment.*`/`memory.*` versionados.
7. **Aceite endurecido.** O contrato de tarefa de engenharia v2 recusa na admissão entrega sem
   verificador executável (`verifier.command_checks` com `protected_paths`, ou verificador
   fixado), com `detail.code` próprio, e restringe os args de `command_checks` a um alfabeto
   conservador (W5-10b).

## Alternatives Considered

- Nível numérico de confiança em vez de três níveis: convida comparação e soma; rejeitado.
- Imagem como `data:` URI em texto ou troca de `content` por união: quebra leitores v1 ou infla
  ledger e tokens; rejeitado.
- Relaxar o seccomp do executor para todos: amplia superfície de todo plugin; rejeitado em favor de perfis.
- Chromium fora do sandbox: viola isolamento e "sem import no host"; rejeitado.
- Navegador e computer-use somente como plugin, sem runtime no core: descartado no G2 em favor do híbrido; o runtime fica no core com carregamento tardio e os binários e o `playwright-core` nos pins, então a release do HSEOS não se acopla a eles.
- LSP/DAP somente como plugins: o validador de escopo é fronteira de segurança do core; os binários
  pesados já ficam fora como pins. No híbrido, o plugin é gerado do mesmo código.
- Realocar orçamento entre áreas para manter o teto 1540: descartado no G2/G3; vence elevar o teto (`packages` 137 e teto 1554).
- `python-xlib` (LGPL-2.1+) para entrada X11: descartado; `xdotool` (BSD).
- Sessão de depuração interativa persistente: adiada para a W6; execução roteirizada é determinística e testável.
- Memória em store próprio ou banco vetorial: viola ledger canônico e acrescenta dependência pesada não determinística.

## Consequences

Há custo de arquivos no pacote (projeção central de +39 e alta de +61 entradas; com o runtime
híbrido o total alto chega a ≈1565 (estimativa), acima do teto aprovado de 1554, que só sobe pelo número medido com novo G3;
a área `packages` tem orçamento aprovado de 137), de perfis de seccomp a manter e de
manifestos de toolchain a verificar. Capacidades dependem de binários externos; sem cache
offline o resultado é BLOCKED. Mudar o contrato de contexto tem impacto amplo e exige análise de
impacto e leitura v1.

## Mitigations

Perfis por declaração do controlador, filtro seccomp por argumento, drenagem por cgroup,
validadores de escopo e digest no core, aprovação de uso único para computer-use, recusa de
`evaluate` no depurador, eventos versionados, testes negativos e mutantes de autoridade,
proveniência e aprovação, orçamentos por área, teto próprio dos pacotes de plugin (≤40 entradas e
≤1 MB cada), paridade de digest entre core e plugin e recusa de critério de aceite fraco na
admissão. Rollback fecha
admissões, preserva pins e eventos e recusa retomada incompatível.

## References

- Constituição §§2.3/2.6/5/7/10 e `.enterprise/policies/adr-policy.md`.
- ADR-0042/0043/0044/0045 (dependência: 0043/0044/0045 ainda constam como Proposed no índice; esta decisão não substitui nem aceita essas ADRs); padrões Hexagonal & Clean Architecture, Data Contracts & Schema Evolution, Resilience Patterns e Observability Playbook.
- `.specs/features/harness-w5/{spec,design,tasks}.md`.
- `docs/evolution/w5/PLAN.md`; `docs/decisions/harness-w5-intake.md`.
- `docs/evolution/revalidation-2026-10/{STATUS,INVENTORY-CAPACITY}.md`.

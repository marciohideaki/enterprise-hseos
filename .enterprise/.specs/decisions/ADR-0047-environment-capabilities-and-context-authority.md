# ADR-0047: Capacidades de ambiente como plugins governados, autoridade e proveniência de contexto, partes multimodais

## Status

Proposed — 2026-10-10. Documenta a implementação candidata da onda W5 (W5-01 Contratos).
Aprovação institucional, merge, publicação e ativação operacional não concedidos; o gate
humano G2 é pré-condição de qualquer código de produção da W5.

## Context

O kernel executa ferramentas, workflows e jobs sob uma única autoridade (ADR-0045), mas não
percebe nem age sobre o ambiente de engenharia: não há LSP, depuração, navegador, display
virtual, contexto multimodal nem memória entre sessões. O contexto trata referências e memória
como dado citado, mas as fontes não declaram autoridade nem origem, e o evento
`context.assembled` registra apenas referências. O executor isolado atual é sem rede, limita a
saída a 64 KiB e usa `pids_max` 32, o que impede navegador, depurador e captura de tela.
Capacidades como essas ampliam a superfície de ataque (injeção por dado recuperado, escape de
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
3. **Capacidades de ambiente como contratos do core e implementações isoladas.** Cada ação é uma
   tool `environment.*` com contrato versionado no ToolRuntime, política da lattice e execução
   no executor isolado. LSP e DAP (protocolos leves, sem dependência npm nova) ficam no core,
   com servidores/adaptadores como toolchain pins fixados por digest. Navegador e
   computer-use são pacotes de plugin separados (kind `tool`) com tarball próprio.
   Computer-use só em display virtual isolado, com aprovação por ação.
4. **Perfis de isolamento e canal de artefatos.** O executor ganha perfis nomeados escolhidos
   pelo controlador (P0 sem rede, P1 loopback, P2 loopback com egresso mediado por broker com
   allowlist), limites por chamada e um diretório de artefatos verificado pelo controlador.
   P0 permanece o padrão e inalterado.
5. **Memória governada no core** sobre o ledger existente, com política de escrita, TTL,
   autoridade fixa `data` e origem gravada; plugin `context-source` não pode hospedá-la porque
   não recebe ledger.
6. **MCP subordinado.** Falha fechada para servidor/tool malformado, caminho legado só em
   fixture, negações registradas no ledger e contratos `environment.*`/`memory.*` versionados.

## Alternatives Considered

- Nível numérico de confiança em vez de três níveis: convida comparação e soma; rejeitado.
- Imagem como `data:` URI em texto ou troca de `content` por união: quebra leitores v1 ou infla
  ledger e tokens; rejeitado.
- Relaxar o seccomp do executor para todos: amplia superfície de todo plugin; rejeitado em favor de perfis.
- Chromium fora do sandbox: viola isolamento e "sem import no host"; rejeitado.
- Navegador e computer-use no core: acopla release do HSEOS a Playwright e X11; rejeitado.
- LSP/DAP como plugins: o validador de escopo é fronteira de segurança do core; os binários
  pesados já ficam fora como pins.
- Sessão de depuração interativa persistente: adiada para a W6; execução roteirizada é determinística e testável.
- Memória em store próprio ou banco vetorial: viola ledger canônico e acrescenta dependência pesada não determinística.

## Consequences

Há custo de arquivos no pacote (projeção central de +39 e alta de +61 entradas, com a área
`packages` excedendo seu orçamento e exigindo decisão G3), de perfis de seccomp a manter e de
manifestos de toolchain a verificar. Capacidades dependem de binários externos; sem cache
offline o resultado é BLOCKED. Mudar o contrato de contexto tem impacto amplo e exige análise de
impacto e leitura v1.

## Mitigations

Perfis por declaração do controlador, filtro seccomp por argumento, drenagem por cgroup,
validadores de escopo e digest no core, aprovação de uso único para computer-use, recusa de
`evaluate` no depurador, eventos versionados, testes negativos e mutantes de autoridade,
proveniência e aprovação, orçamentos por área e teto próprio dos pacotes de plugin. Rollback fecha
admissões, preserva pins e eventos e recusa retomada incompatível.

## References

- Constituição §§2.3/2.6/5/7/10 e `.enterprise/policies/adr-policy.md`.
- ADR-0042/0043/0044/0045; padrões Hexagonal & Clean Architecture, Data Contracts & Schema Evolution, Resilience Patterns e Observability Playbook.
- `.specs/features/harness-w5/{spec,design,tasks}.md`.
- `docs/evolution/w5/PLAN.md`; `docs/decisions/harness-w5-intake.md`.
- `docs/evolution/revalidation-2026-10/{STATUS,INVENTORY-CAPACITY}.md`.

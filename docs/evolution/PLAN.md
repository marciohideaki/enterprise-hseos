# Plano de execução — evolução do harness

Tipo: plano de implementação. Fonte de intenção: plano do usuário de 2026-09-25.
Autoridade: Constituição 2.2 §§2.3/2.6/5/7, AGENTS.md §§4–9,
ADR-0042, ADR-0043 e política automated-validation.

## Base e isolamento

Feature: `feature/hseos-evolution-w0-quality`; base Git `a842308`.
Task: `task/hseos-evolution-w0`. A candidata não tinha commit consolidado:
seu conteúdo staged foi copiado para esta task, sem alterar o worktree original.
`baseline.json` fixa árvore do índice, patch SHA-256 e hashes dos arquivos.
O diff staged é a candidata importada; o diff não staged contém a evolução.
Não misturar os dois em um commit sem resolver a entrega da candidata.
Nenhum recibo anterior aprova o novo delta.

## Invariantes de todas as ondas

Kernel próprio reutiliza AgentRuntime, ToolRuntime, WorkflowEngine, supervisor,
política, ledger, broker e catálogo. CLI/API/SDK/IDE compartilham serviços; ledger
canônico, projeções descartáveis e trabalhadores remotos via API, sem SQLite
compartilhado em filesystem de rede. Contratos e eventos anteriores continuam
legíveis; nova semântica recebe versão explícita, sem reescrever históricos.

Identidade, sequência esperada e idempotência governam comandos; eventos usam
cursor recuperável. API local autenticada e restrita; remoto opt-in. Terminais
expõem entrada, saída, resize e attach sob a mesma autoridade. Aceite separado de
sessão concluída; verificadores fixados fora do controle da tarefa. Código do
projeto executa isolado; comparação confiável recebe somente resultados limitados.
Diagnóstico precede correção; tentativas e orçamento são finitos e acumulados.
Incerteza exige pergunta; edição concorrente invalida aprovação do baseline.

ModelProvider e RuntimeProvider permanecem distintos. Bindings declaram versões,
transporte, autenticação, cobrança, cotas e evidência de conformidade. Assinatura
primeiro quando oficialmente suportada; credencial efetivamente utilizada deve
ser comprovada. Não reutilizar tokens de assinatura como API genérica. Cota
ignorada é desconhecida, nunca ilimitada. Expiração, esgotamento e incompatibilidade
preservam estado e exigem decisão; mudança de backend não reseta orçamento nem
repete efeitos. Identidades individuais não formam pool compartilhado. Segredos
não entram em prompt, workspace, log ou artefato.

Kernel fora do Electron; IDE Code OSS usa API e extensão própria, com patches
limitados no workbench. Upstream fixado e build descartável reproduzível produzem
instalador independente. Catálogo inicial inclui apenas extensões licenciadas
para redistribuição. Electron não vira dependência do kernel. Alterações externas
são reconciliadas. Linux primeiro; macOS/Windows exigem execução nativa certificada.
Equipes em infraestrutura própria; SaaS multicliente/faturamento fora do escopo.
ADO, GitOps, second brain e managed governance continuam opcionais.

## Ondas sequenciais

| Onda | Entrega e verificação obrigatória                                                                                                                                                                                  | Dependência |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| W0   | Fixar candidata/recibos, lint integral, cobertura medida, docs reconciliadas, inventário das 27 famílias com fontes/testes/lacunas                                                                                 | candidata   |
| W1   | Tarefa v2, workspace/baseline/escopo/comandos, registro protegido Node/TS/Python/web, busca/patch/diff/Git, API versionada e SDK JS/TS/Python; instalação limpa resolve projetos reais e rejeita entrega incorreta | W0          |
| W2   | Terminais e jobs, lifecycle, recuperação/cancelamento transitivo; crash em cada fronteira intenção/efeito/recibo sem repetição automática nem órfãos                                                               | W1          |
| W3   | Codex/Claude/DeepSeek/Antigravity, conta/API/local, manifesto de controle e cobrança; jornada real individual por binding oficial                                                                                  | W2          |
| W4   | Plugins de ferramentas/providers/contexto, DAG, subagentes, agendamento e orçamento agregado; reinício/concorrência/falha preservam autoridade                                                                     | W3          |
| W5   | LSP/debug/browser/computer-use/multimodal/contexto/memória; consumidores reais demonstram delimitação e proveniência                                                                                               | W4          |
| W6   | Code OSS com editor/terminal/Git/debug, planejamento/revisão/evidências/aprovações; fechar/atualizar UI preserva trabalho; upstream/rollback reproduzíveis                                                         | W5          |
| W7   | Servidores próprios, identidade/autorização por projeto, trabalhadores remotos, revisão compartilhada, execução nativa macOS/Windows                                                                               | W6          |
| W8   | Campanhas comparativas, docs de capacidades, migração, rollback e pacotes candidatos; paridade/ganhos comprovados e limitações publicadas                                                                          | W7          |

As dependências são da entrega, não uma alegação de ausência de código existente.
Cada nova superfície deve consultar catálogo e grafo e registrar intake próprio;
não criar implementações paralelas dos serviços existentes. Quando o host não
permitir delegação governada, integrar como cliente do kernel e declarar onde
executa. Mensageria interagentes permanece experimental até ensaios de autoridade,
consumidores e recuperação próprios.

## Estado consolidado frente ao plano de fechamento da fundação (2026-10-23)

O plano de fechamento da fundação (run `.hseos/runs/dev-squad/20261020-w5-closeout/`,
PLAN.md e PLAN-CONCLUSAO.md) não é uma segunda sequência de ondas: é a execução de
conformidade das ondas W1–W5 deste plano, mais a ativação. **A numeração dele é própria**
(fechamento/W0–W6, W8, W9, W10) e não coincide com a das ondas canônicas acima; a tabela
mapeia uma na outra. Cada onda mantém os três estados do marco: determinístico, consumidor
real e ativação. Fontes: [STATUS](STATUS.md), [w5/STATUS](w5/STATUS.md),
[requirements.json](requirements.json), [w10/evidence](w10/evidence/k7/README.md).

| Onda canônica | O que o fechamento da fundação entregou nela                                                                                                                                                                                                                                                                                                                                                                                                                             | Ainda falta                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W0            | Master verde: broker de egress no Node 24.22, relógio de testes (`HSEOS_TEST_CLOCK_OFFSET_DAYS`), relógio dos MCP legados, CI em 6 shards com hook local leve, timeout da conformance. Docs reconciliadas (`verification-receipt`, STATUS, `requirements.json` ligado a evidência citável, contradição M09/M18b/N5). PRs #235 (inclui #234), #236 e #237                                                                                                                 | 9 das 27 famílias seguem `not_verified_for_evolution` (entre elas F08, F17, F18, F24, F25, F27)                                                                                                                                                               |
| W1            | Contrato de tarefa por janela: arquivo grande até 256 KiB, leitura por faixa, patch com `within`, diff por faixas, `budget_exceeded` com números e razão `session-budget-exceeded`, sessão concluída não falha por estimativa (fechamento/W1, #237). Aceite por critério: `check_ids` e `ENGINEERING_ACCEPTANCE_UNCOVERED` (fechamento/W2, #239). Admissão no `agent run` (fechamento/W10, K6)                                                                           | Dívida 18: `max_tokens` abaixo de ~12000 termina em `session-failed:internal_error` sem causa                                                                                                                                                                 |
| W2            | Sem entrega nova; só estabilização (relógio do liveness, flakies e mutantes registrados em w5/STATUS)                                                                                                                                                                                                                                                                                                                                                                    | Resíduos registrados no w5/STATUS, sem dono de onda                                                                                                                                                                                                           |
| W3            | Bateria ao vivo em sessão ligada: T2 #231, T3 #232 (contexto v2), T4 #233, T1 (guard CommonJS) com 9 de 12 na bateria, consolidação L4 (fechamento/W5, #240). Runbook da 4ª família preparado                                                                                                                                                                                                                                                                            | Quarta família não exercitada (Gemini API); `tools/call` e aprovação MRTR do Codex `NOT_EXERCISED` (exigem login e gasto); F17 e F18 sem verificação de evolução                                                                                              |
| W4            | Capacidades ligadas ao runtime e ao MCP (fechamento/W4, #241): `environment.capabilities` no contrato, bundles e aprovação por política, `drain()` e `assertQuiescent()` incluindo serviços de ambiente, providers MCP de `environment.*` e `memory.*`, memória no assembler (autoridade `data`, `untrusted` fora). Host de produção `createProductionEnvironmentHost` (K5)                                                                                              | Plugins seguem `scaffolded`; consumidor real só em F21 (escopo instalado local) entre as famílias de W4                                                                                                                                                       |
| W5            | Stubs `NOT_IMPLEMENTED` de `browser.run`, `computer.*` e `memory.*` trocados por contratos reais com aprovação (fechamento/W3, #238); sink de ledger de ambiente; `forget` com ator `operator` e aprovação de uso único; migration 017 com os 16 tipos `environment.*`; testes de chamador de produção; jornada ponta a ponta no ledger real (C10/C11); CSP no state-ui, `pids_max` em fonte única, extração do chrome-headless-shell em streaming (fechamento/W6, #242) | **Consumidor real não verificado em F14, F15 e F20** (o consumidor B foi sintético); navegador e computer-use na CLI exigem broker de egress, media store e canal de aprovação humana; elicitação de `computer.*` mostra o digest do screenshot, não a imagem |
| W6            | **Nada.** Não há fork nem extensão do Code OSS; o ADR dessa decisão, [ADR-0049](../../.enterprise/.specs/decisions/ADR-0049-code-oss-fork-and-upstream.md), está Accepted em 2026-10-31 (W10), e nada da W6 foi entregue. O que existe em `tools/cli/installers/lib/ide/*` é o instalador para outras IDEs e não conta                                                                                                                                                   | Toda a onda. F25 (UX e serviços auxiliares) é a família ligada                                                                                                                                                                                                |
| W7            | **Nada**                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Toda a onda. F24 (managed governance) é a família ligada                                                                                                                                                                                                      |
| W8            | Só preparação: runbooks da matriz evolutiva e da 4ª família (fechamento/W7); nada despachado                                                                                                                                                                                                                                                                                                                                                                             | Matriz de 18 rodadas e depois ≥30 tarefas ×3; docs de capacidades; pacotes candidatos. F27 é a família ligada                                                                                                                                                 |

### Entregue pelo fechamento fora da tabela de ondas

Itens que o plano canônico não nomeia e que as ondas W4/W5 passaram a exigir:

- **ADR-0048** (critério de ativação do ledger de execução, aceito pelo owner em 2026-10-22, #244): supersede ADR-0022 L117 e ADR-0023 L71; a data fixa de sunset do legado (2026-11-30) deixa de valer, e o sunset fica sem data até haver evidência dos clientes.
- **`hseos execution-activation plan|apply|rollback`**: backup por cópia de bytes com `integrity_check` e sha256, receipt de ativação, rollback testado; servidor MCP moderno sobre banco ativado, com compat legado dentro do moderno (K1–K7, #243). Evidência em `w10/evidence`.
- **Contratos de liveness e de coordenação** e o watchdog `liveness watch`, ligados só neste projeto (#245).
- **CI**: suíte completa em 6 shards só no Node 24 por PR; o Node 22 roda o subconjunto `test:node22-compat` por PR e a suíte completa no agendamento noturno e em `workflow_dispatch` (provado em 2026-10-23, run 39994846645); o `Standalone smoke` não roda mais o `npm test` completo (#247, #248). A regra "matriz evolutiva Node 22/24" abaixo continua cumprida por essa combinação.

### Ativação (estado separado)

Executada em 2026-10-22 com autorização do owner, só no `enterprise-hseos`: distribuição global
do SHA `795e6540` (tarball sha256 `0f21234b…8858e38`), `project.db` do projeto v4→v17 com backup
verificado, 3 MCPs do Codex no release novo, 8 hooks do Codex confiados, timer do watchdog e
10 tags no remoto. Os outros 21 `project.db` do host seguem intocados e **nenhum pacote foi
publicado**. Recibos em `~/.local/state/hseos/distributions/795e6540…/`. Em 2026-10-23 as
dívidas do gerador do timer (`WorkingDirectory` sem aspas) e do campo `commit` do receipt
foram corrigidas (#246); o receipt e as units já instalados não foram reescritos.

### Pendências antes de abrir a W6

Estado em 2026-11-04, ao fim do fechamento pré-W6 (run `20261101-pre-w6-closeout`, PLAN-4; fonte: [MAPA §9](pendencias-w0-w5/MAPA.md) e o `STATUS.md` da run). Nenhum item está marcado como fechado sem evidência; o que não fecha tem a causa escrita.

| #   | Pendência                               | Estado                                                                                                                                                   | Causa ou evidência                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Consumidor real para F14, F15 e F20     | **F20: parcial, promovido com escopo declarado. F14: BLOQUEADO. F15: ABERTO**                                                                            | F20: `real_consumers` passa a `verified_installed_local_scope_only` com o escopo escrito no inventário (MRTR de 2026-10-31 e C11). F14: a C8 observou o cliente real gravando, mas a montagem do contexto, que é o que o F14-R1 pede, foi de um script de teste (consumidor sintético, ADR-0050 §5.2); falta uma tarefa real de modelo lendo a memória promovida. F15: a C9 provou compactação, crash, retomada e linhagem do `fork` com modelo real, mas a retomada do `fork` não chegou à aceitação.   |
| 2   | Decisões do owner abertas               | **Decididas ou BLOQUEADAS**                                                                                                                              | Sunset do legado: decidido "sem data" em 2026-10-30 (MAPA §5). Navegador e computer-use na CLI: adiados (MAPA §5). `tools/call` e MRTR do Codex: decidido exercitar com o login do owner e teto de US$ 2 na W7 (MAPA §5, item 3); hoje **BLOQUEADO pelo cliente**: o Codex 0.166.0 negocia `2024-11-05` e não expõe `memory.*` nem `environment.*`, então a campanha só roda com uma versão que negocie `2026-07-28`. O MRTR foi provado com o Claude Code.                                              |
| 3   | Dívidas técnicas                        | **Fechadas**                                                                                                                                             | `g9-zero-legacy-window` substituído por `g9-adr0048-activation-criterion` (`runbooks/activation.md`); dívida 18 fechada pela A5 (WA); `handle()` do adaptador só repassa mensagem de erro do adaptador (`tools/lib/mcp-2026-adapter.js`). Resíduo N-1 da reauditoria (`EXECUTION_ACTIVATION_*` leva o caminho do banco ao cliente legado) segue declarado.                                                                                                                                               |
| 4   | Auditoria de conformidade de 2026-10-27 | **Aberta nos resíduos declarados**                                                                                                                       | Ver o item 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5   | ADR do fork do Code OSS                 | **Fechado**                                                                                                                                              | [ADR-0049](../../.enterprise/.specs/decisions/ADR-0049-code-oss-fork-and-upstream.md), Accepted em 2026-10-31 (W10).                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | Reauditoria A-01 a A-20                 | **Fechada em A-01 a A-04, A-07, A-08, A-10 a A-14, A-16, A-18, A-19 e A-20; aberta em A-05, A-09 e A-15 (resíduos declarados); A-06 e A-17 com o owner** | A-18 fechada em 2026-11-04 pela reinstalação global (recibo em `~/.local/state/hseos/distributions/25e673ff…/verification.json`). A-20 fechada pela A5/A6 da WA (`w3/TRACE.json`, `w4/TRACE.json` e guard). Resíduos: A-05 (redação de chave de 2 a 4 linhas curtas e PKCS8 cifrado), A-09 (adapters nativos e índices de F17/F18/F22 fora do c8; vai para W6/E7), A-15 (`uninstall` e `init` fora do lock). A-06: decisão registrada no MAPA. A-17: edição dos corpos de PR antigos é decisão do owner. |

Famílias que continuam em `not_verified` por falta de critério atendido, com a causa no inventário: F17 em `deterministic` (composição ACP sem backend efetivo provado e sem binding local) e, no eixo `real_consumers`, F08, F17 e F18 e todas as de binding por API ou conta (campanhas L2 incompletas; a quarta família está diferida, com a C6 BLOCKED por decisão do owner, sem a chave `google/gemini-hseos`). F18 `deterministic` foi promovida em 2026-11-05 sobre os sete bindings oficiais listados no ADR-0050 (respostas posteriores).

## Verificação e fechamento

Executar testes, lint, build, empacotamento e gates sequencialmente, com revisão
fixada. Matriz evolutiva Node 22/24; toolchain da IDE separada. Os recibos Node
20/22 da candidata permanecem históricos e intactos. Cobertura mínima 90/80 nos
arquivos críticos, complementada por falhas e mutação de autorização/orçamento/
recuperação. Suíte reduzida não substitui suíte completa.

Cobrir entrega correta/vazia/incorreta/adulterada; rejeição/diagnóstico/tetos;
crash/perda de recibo/concorrência/reconciliação obsoleta/cancelamento; descendentes
e múltiplos clientes; compactação+resume+fork e replay equivalente; escopo/segredos/
rede/tools desconhecidas; login/logout/cotas/credenciais concorrentes; equivalência
CLI/API/SDK/IDE; instalação externa/offline/lazy; upgrade e rollback sem reescrever
eventos. Downgrade não retoma efeitos de schema incompatível: drenar ou reconciliar.

Campanhas com bindings e orçamento explícitos: iniciar por 18 execuções; depois
≥30 tarefas reservadas, três repetições por configuração elegível. Separar
comparação do harness (modelo/tarefa/ambiente/orçamento iguais quando suportado)
e produto completo (configurações reais e diferenças declaradas). Medir sucesso,
intervenção, latência/recursos/consumo; acoplamento/isolamento/compatibilidade/custo
de carregamento; recuperação/repetição/órfãos/cancelamento; defeitos/aprovações
incorretas/tempo/rastreabilidade da revisão. Ganho exige indicador principal melhor
sem regressão obrigatória, intervalos de confiança agrupados por tarefa e
reavaliação periódica com versões fixadas. Empate/inconclusivo não é superação.

Cada marco mantém três estados: determinístico, consumidor real e ativação.
Merge, publicação, instalação global e ativação exigem decisões próprias.
Completude integral requer todas as capacidades exercitáveis, quatro integrações
classificadas/comprovadas e jornada CLI/API/SDK/IDE com continuidade segura.

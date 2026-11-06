# T1c - triagem dos rascunhos W6-W8

Data: 2026-11-06. Run `20261106-1721-stab2-wave-a`. Proposta para decisão do owner; este documento não integra nem descarta nada.

## Origem e método

Os rascunhos vêm de um worktree antigo (`hseos-plan-w4-w8`, planejamento de 2026-09-27, base `32eaef27`, PR #180) e só existem no arquivo de resíduo `/build/artifacts/hygiene-2026-11-06-residue/worktrees/hseos-plan-w4-w8.untracked.tgz` e no `.tracked.patch` correspondente. O `.tgz` traz também specs W4 e W5 de rascunho; ficam fora desta triagem. O `.tracked.patch` só tem ajustes de `PLAN.md` (tabela reformatada e link), `STATUS.md` e `_INDEX.md` para apontar ao `W4-W8-PLAN.md`; sem conteúdo próprio de W6-W8.

Confronto feito com `docs/evolution/PLAN.md` (inclui "Estado consolidado" e "Pendências antes de abrir a W6"), `STATUS.md`, `requirements.json` (F07, F24, F25, F26, F27), `.specs/features/harness-w3` e `harness-w5`, ADR-0049 e ADR-0050. Fatos de rascunho só valem aqui se a master os confirma.

Observações gerais, válidas para os quatro arquivos:

- Cada spec se declara "especificação proposta de planejamento, 2026-09-27. Implementação não iniciada" e usa os gates G0-G6 "do plano", que é o `W4-W8-PLAN.md` ausente. Na master as ondas W4 e W5 têm o próprio `PLAN.md` (`docs/evolution/w5/PLAN.md`, citado em `harness-w5/spec.md` linha 4), e a spec W5 tem a estrutura que a W6 deveria seguir. Referências `../../../docs/evolution/W4-W8-PLAN.md` ficariam quebradas.
- O bloco de NFR01-NFR07 é idêntico nas três specs. Remete a normas (Constituição §§2.3/2.6/5/7, Quality Gates) que permanecem válidas, mas "AEW aplicação/enforcement não verificados" e "matriz Node 22/24" precisam ser reconferidos contra o estado atual: o `PLAN.md` da master diz que a matriz 22/24 é cumprida por suíte completa só no Node 24 por PR mais `test:node22-compat` por PR e suíte completa noturna no 22.
- A frase "Dependência: W5 aceita no escopo vigente" ficou satisfeita: o `STATUS.md` registra a W5 na master (PR #230, merge `eecfaa90`, mais #231 e #232).

## 1. `.specs/features/harness-w6/spec.md`

### Ainda vale

- Propósito, atores e escopo: IDE Linux independente, continuidade fora do processo da UI. Coerente com F25-R1 (`requirements.json`: "IDE Code OSS usa API externa ao Electron e preserva trabalho ao fechar a UI").
- Fora de escopo: kernel dentro do Electron, fork irrestrito, extensões sem licença de redistribuição, certificação nativa Windows/macOS antes da W7. Confere com ADR-0049 §5 e §8.
- W6-FR01, FR02, FR03, FR04, FR07: sem equivalente na master (o `PLAN.md` diz "W6: **Nada.**"). Servem como base de requisitos funcionais da W6. A spec W5 exclui a IDE de propósito ("IDE Code OSS, painéis, revisão visual de artefatos e terminais integrados: W6 (F25). A W5 expõe contratos e eventos que a W6 consome").
- W6-FR03 (baseline atual, edição concorrente invalida aprovação) e FR04 (reconexão por cursor sem efeito duplicado) alinham com ADR-0049 §7 ("o estado vive no kernel; a UI reconecta e retoma").
- Aceite com três estados (determinístico, consumidor real, ativação) e "não declarar PASS por presença de código, mocks ou plataforma não exercitada": continua a regra do inventário (`status.deterministic/real_consumers/operational`).

### Superado

| Trecho do rascunho                                                                                                                                       | Superado por                                                      | Citação                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Decisões: Fixar upstream/commit, toolchain, catálogo de extensões redistribuíveis, identidade do produto e formato do instalador Linux antes do design" | ADR-0049 (Accepted 2026-10-31)                                    | §1 "fork do `microsoft/vscode` na última tag estável"; §2 `UPSTREAM.lock` com tag e SHA; §4 "Open VSX público... allowlist... licença OSI revisada"; §8 "Formatos de pacote Linux (Q8): tar.gz e .deb". Fica aberto: tag exata (verificada na criação do fork) e a identidade/nome do produto (o ADR exige "marca própria" e `product.json`, sem fixar nome). |
| W6-FR05 "Build deve fixar upstream, dependências e extensões licenciadas; ambiente descartável..."                                                       | ADR-0049 §2-§4                                                    | "Build em container descartável fixado por digest"; comparação "normalizada" com SBOM e hashes por arquivo, "bit a bit fica como meta". O FR do rascunho não tem o critério de comparação normalizada nem o teto de patches (10 arquivos e 1.500 linhas fora de `extensions/`).                                                                               |
| W6-FR06 "Instalar, atualizar e reverter... preservar configuração/ledger"                                                                                | ADR-0049 §7                                                       | "instala a nova versão ao lado da anterior... Atualização da IDE não migra estado do kernel". O rascunho mistura rollback da UI com migração de schema do kernel, que o ADR separa.                                                                                                                                                                           |
| Local do código e da evidência (implícito: tudo no repositório)                                                                                          | ADR-0049 §6                                                       | Repositório separado `marciohideaki/hseos-code`; evidência espelhada aqui "por recibo com hash". Isso muda o "preparar PR" do W6-07 e o lugar de `docs/evolution/w6/evidence/`.                                                                                                                                                                               |
| "Fonte: plano W4-W8... decisão diferida em W3-FR07"                                                                                                      | `PLAN.md` "Estado consolidado" e "Pendências antes de abrir a W6" | A numeração, a fonte e as pendências (itens 1 a 6) estão no `PLAN.md` da master.                                                                                                                                                                                                                                                                              |

### Veredito: aproveitar trechos

Não integrar como está: o cabeçalho, as fontes e a seção "Decisões e questões abertas" estão desatualizados e conflitam com o ADR-0049. Aproveitar os FR01-FR04 e FR07 e o bloco de aceite como insumo do W6-01 (design e tasks), reescrevendo FR05/FR06 sobre o ADR-0049 e a estrutura da spec W5. Razão: são os únicos requisitos funcionais da W6 escritos; a base que os justificava mudou.

## 2. `.specs/features/harness-w7/spec.md`

### Ainda vale

- Propósito e escopo: equipes em infraestrutura própria, isolamento por projeto; fora de escopo SaaS multicliente e faturamento. Coerente com `PLAN.md` (W7) e o texto original "Equipes em infraestrutura própria; SaaS multicliente/faturamento fora do escopo".
- W7-FR01 e FR04: F24-R1 pede "usuário sem autorização não acessa outro projeto" e o gap diz "Identidade e autorização por projeto na API de controle pendentes". Sem entrega na master.
- W7-FR02 e FR03: F26-R1 ("Transporte interagentes só é certificado com consumidores e recuperação"); o gap segue "Experimental".
- W7-FR05: F07-R1 e o gap "execução nativa macOS/Windows não certificada"; ADR-0049 §8 reforça "só entram com execução nativa certificada, na W7".
- W7-FR06: F24-R1 "Operar kernel sem sidecars".
- Decisões abertas (IdP, topologia, certificados, runners nativos): `PLAN.md` da master não as resolveu; seguem abertas.

### Superado ou a ajustar

| Trecho                                                       | Situação                                               | Citação                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependência "W6 aceita"                                      | Continua, mas W6 não começou                           | `PLAN.md`: "W6 ... **Nada**", "W7 ... **Nada**".                                                                                                                                                                     |
| "Fonte... decisão diferida em W3-FR07"                       | Precisa ser ajustada à decisão atual da quarta família | `harness-w3/spec.md`: "A quarta familia só sera testada e validada após a conclusao de todas as fases!"; ADR-0050 §3 fixa o teto padrão (4 requisições, US$ 1,00, 45 min) e exige autorização do owner por campanha. |
| Ausência da campanha de `tools/call` e MRTR com cliente real | Omissão do rascunho                                    | `PLAN.md` "Pendências" item 2: decidido exercitar "na W7, com o login do owner e teto de US$ 2"; hoje BLOQUEADO pelo cliente (negocia `2024-11-05`, não `2026-07-28`). Entra no W7-01.                               |
| W7-FR07 "F13 transversal"                                    | A conferir                                             | F13 não aparece nos campos de F07, F24 ou F26 consultados. Não verifiquei o inventário inteiro quanto a F13.                                                                                                         |

### Veredito: aproveitar trechos

Os FR cobrem exatamente as famílias F07, F24 e F26 e o gap do inventário. Aproveitar como rascunho de requisitos para o W7-01, acrescentando a campanha pendente de `tools/call` e MRTR com cliente real e a regra da quarta família do ADR-0050. Razão: nada supera os FR (a onda não começou), mas o texto que os envolve é de antes do fechamento da fundação.

## 3. `.specs/features/harness-w8/spec.md`

### Ainda vale

- W8-FR01: "18 execuções piloto; ... pelo menos 30 tarefas reservadas e três repetições" é idêntico a F27-R1 ("18 rodadas iniciais; depois ≥30 tarefas ×3"). Vale.
- W8-FR04 (ganho exige indicador principal melhor sem regressão e intervalos agrupados por tarefa; empate é inconclusivo): coerente com "sem alegar ganhos inconclusivos" de F27-R1.
- W8-FR05 (migração e rollback preservam eventos, downgrade incompatível bloqueia): coerente com F27-R1 e `PLAN.md` "Verificação e fechamento" ("Downgrade não retoma efeitos de schema incompatível").
- W8-FR02, FR03, FR06, FR08: sem equivalente na master; o `PLAN.md` só diz "Só preparação: runbooks da matriz evolutiva e da 4ª família... nada despachado".
- Ordem "quarta família só após W4-W8 tecnicamente concluídas, fechamento integral pendente": confere com a decisão do owner de 2026-09-27 (`harness-w3/spec.md`) e com ADR-0050 §3 e consequências ("F18 só avança com a quarta família em L2").

### Superado ou a ajustar

| Trecho                                                                                     | Situação                     | Citação                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W8-FR07 sobre a quarta família                                                             | Incompleto frente ao ADR     | ADR-0050 §3: teto padrão 4 requisições, US$ 1,00, 45 min; autorização "sempre o owner, por campanha". O rascunho diz só "binding/identidade/orçamento admitidos". |
| Orçamento da W3 ("US$ 10, reservas US$ 9, saldo US$ 1, 30 despachos") no plano do rascunho | Estado de 2026-09-27         | Os recibos C1 a C11 e `w3/CLOSEOUT-REVALIDATION.md` (nov/2026) são posteriores; não confirmei o saldo atual.                                                      |
| Fixar corpus, indicador, margens e plano estatístico "antes das campanhas"                 | Segue aberto, sem substituto | Os runbooks de matriz evolutiva de que fala o `PLAN.md` ("fechamento/W7") não foram lidos nesta triagem.                                                          |

### Veredito: aproveitar trechos

Aproveitar FR01-FR06 e FR08 como base do W8-01, que deve registrar o protocolo antes de qualquer resultado. Reescrever FR07 sobre o ADR-0050. Razão: os números de F27-R1 estão corretos e a onda é a mais distante; fixar mais detalhe agora, sem os runbooks, arriscaria divergir deles.

## 4. `docs/evolution/W4-W8-PLAN.md`

### Ainda vale

- Seção "Reuso e lacunas a certificar" (tabela de candidatos: ToolRuntime, WorkflowEngine, `AgentExecutionSupervisor`, `control-sdk`, `agent-message-transport`, `agentic-activation-rehearsal`): serve como ponto de partida para o intake das W6-W8. Os caminhos citados existem como referência; não reabri cada arquivo, apenas confirmei que `F24` e `F26` e `F27` ainda apontam para `managed-governance-client`, `agent-message-transport` e `agentic-activation-rehearsal` no `requirements.json`.
- Tabelas de tasks W6-01 a W6-07, W7-01 a W7-07 e W8-01 a W8-08, com dependências e critérios: úteis como decomposição inicial das três ondas que ainda não têm plano. A própria seção diz que a decomposição é "proposta, não contrato".
- Gates comuns G0-G6 e a regra "Falha de ambiente é bloqueio identificável, não PASS". Compatíveis com as regras vigentes de aceite.
- "Campanhas e orçamento" para W8 (18 piloto, depois 30 x 3, pré-registro de hipóteses, separar harness comparável de produto completo): sem equivalente na master e coerente com F27-R1.
- "Revisão cética do plano": os pontos sobre scheduler em memória, hosts nativos e "sem evidência, não declarar ganho" seguem pertinentes.

### Superado

| Trecho                                                                                                   | Superado por                                      | Citação                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seções W4 e W5 (tasks W4-01..., W5-01...)                                                                | Entrega real na master                            | `STATUS.md`: "W0-W4 foram integradas na `master` pela PR #182"; "a W5 entrou na `master` pela PR #230"; existe `docs/evolution/w4`, `w5` com `PLAN.md` próprio. |
| Base `32eaef27`, branches `feature/hseos-evolution-planning-w4-w8` e `-foundation`, "Git e continuidade" | Fluxo atual de PRs na `master`                    | `git log` mostra as PRs #287 a #290 na master; o fluxo `feature/hseos-evolution-foundation` deixou de ser a base.                                               |
| "Produtor global e709368e..." e "AEW aplicação/enforcement não verificados"                              | Distribuição atual                                | `~/.claude/AGENTS.md` (contexto desta sessão) aponta o produtor `25e673ff`; o `PLAN.md` registra a reinstalação global de 2026-11-04.                           |
| Orçamento de W3 e "Não há novo teto aprovado para W4-W8"                                                 | Decisões posteriores do owner                     | `PLAN.md` "Pendências" item 2 (teto de US$ 2 para `tools/call` e MRTR na W7) e ADR-0050 §3 (teto da quarta família).                                            |
| Decisão "Upstream/licenças/branding/instalador IDE: W6-01"                                               | ADR-0049                                          | Seções 1, 2, 4, 6 e 8 do ADR, já citadas na seção 1.                                                                                                            |
| "Pré-requisito: fechar F14, F15, F20 com consumidor real" (implícito na W5 do rascunho)                  | `PLAN.md` "Pendências antes de abrir a W6" item 1 | F20 parcial; F14 BLOQUEADO; F15 ABERTO.                                                                                                                         |
| Link do `PLAN.md` ao rascunho (patch tracked)                                                            | Não aplicável                                     | O `PLAN.md` da master tem seu próprio "Estado consolidado" e não referencia `W4-W8-PLAN.md`; reintroduzir o link criaria referência a documento desatualizado.  |

### Veredito: descartar como documento; aproveitar trechos

Não integrar o plano inteiro: metade (W4, W5, Git, fontes, orçamento) está superada pela entrega e pelo `PLAN.md` consolidado, e integrá-lo criaria uma segunda fonte de verdade. Aproveitar a tabela de reuso, as tasks de W6-W8, os gates comuns e a seção de campanhas W8 como material para os `PLAN.md` de cada onda (como já existe em `w4` e `w5`), quando o owner abrir a W6. Razão: o valor está nas três ondas não iniciadas; o restante é histórico.

## Resumo dos vereditos

| Arquivo              | Veredito                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `harness-w6/spec.md` | Aproveitar trechos (FR01-FR04, FR07, aceite); reescrever FR05, FR06 e decisões abertas sobre o ADR-0049           |
| `harness-w7/spec.md` | Aproveitar trechos (FR01-FR07 como rascunho); acrescentar a campanha de `tools/call` e MRTR e a regra do ADR-0050 |
| `harness-w8/spec.md` | Aproveitar trechos (FR01-FR06, FR08); reescrever FR07 sobre o ADR-0050                                            |
| `W4-W8-PLAN.md`      | Descartar como documento; reaproveitar tabelas de reuso, tasks W6-W8, gates e campanhas                           |

Nenhum dos quatro deve ser integrado sem edição. O `.tracked.patch` não deve ser reaplicado: seus três arquivos apontam para o `W4-W8-PLAN.md` e para um estado de STATUS anterior à W5.

## O que não consegui verificar

- Não li `docs/evolution/w4/PLAN.md`, `w5/PLAN.md`, `pendencias-w0-w5/MAPA.md` nem os runbooks de `docs/evolution/runbooks/`; as afirmações sobre eles vêm do que o `PLAN.md`, o `STATUS.md` e a spec W5 dizem.
- Não confirmei se F13 existe e como está ligada a F07/F24/F26 (W7-FR07).
- Não reconferi o saldo e o teto atual da campanha da W3, nem se os caminhos de reuso do plano antigo ainda existem com as mesmas assinaturas.
- Os termos de uso do open-vsx.org e a tag exata do Code OSS seguem "não verificados" no próprio ADR-0049.
- Não cotejei linha a linha o bloco NFR01-NFR07 com as normas citadas.

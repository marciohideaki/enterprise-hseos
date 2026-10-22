# ADR-0048: Critério de ativação do ledger de execução governada e do servidor MCP moderno

## Status

Accepted — 2026-10-22

Aceite humano explícito do owner, registrado em 2026-10-22. O aceite não ativa, migra ou
remove coisa alguma: a ativação operacional continua exigindo autorização explícita por banco
(ver Decision, item 6) e a janela supervisionada do item 7.

### Aprovação humana

- **Aprovador:** owner (Marcio Hideaki).
- **Data:** 2026-10-22.
- **Forma:** aceite explícito do owner na sessão de 2026-10-22 ("Aceito o ADR").
- **Escopo do aceite:** o ADR como está, inclusive a exceção de rollback delimitada ao banco
  piloto (Decision, item 5).
- **Não decidido por este aceite (continua pendente de decisão do owner):**
  - a data de sunset do legado: segue "a fixar pelo owner" e, sem data, a compatibilidade
    legada não expira (Decision, item 3);
  - `tools/call` e o fluxo MRTR do Codex na K7 (login e gasto): não autorizados; permanecem
    como limitação declarada;
  - navegador/computer-use na CLI: não autorizado.

**Nota de formato:** a linha de status deve permanecer curta, no formato
`Accepted — AAAA-MM-DD`. O parser do comando de ativação (K2) recusa prosa depois da data. O
parser só aceita formas exatas de aprovado (`fb516b82`). O ADR-0047 real, com prosa na linha de
status, também deixa de passar nesse parser; isso é irrelevante para a ativação, que aponta
apenas para este ADR.

**Estado das entregas (W10, branch `feature/hseos-w5-closeout-w10`):** o código que este ADR
exige já foi entregue na feature e passa a existir na `master` quando a PR da W10 for
mergeada. Nada foi ativado: nenhum `project.db` real foi alterado, nenhum registro de cliente foi
trocado.

| Entrega | Conteúdo                                                                    | Commits / branch                                           |
| ------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| K2      | comando `hseos execution-activation plan\|apply\|rollback`                  | `53cb916a`, `da7bfce7`, `4743ba19`, `961fb250`, `fb516b82` |
| K4      | modo moderno por banco ativado, compat de `initialize`, sunset configurável | `b639f965`                                                 |
| K5      | host de produção na CLI (`agent run`)                                       | `f4532928`, `af600411`                                     |
| K5b     | host de produção no MCP do project-state, memória durável                   | `9370103d`, `f9ed523c`                                     |
| K8      | DoS do adaptador moderno (linha `null`)                                     | `b2b0d5ce`, `30af1f2d`                                     |
| K9      | omissão de `lsp`/`dap` sem isolamento                                       | `e8ad550d`, `60347b3a`, `77129c59`, `ed429562`             |
| K11     | escopo recusado antes da aprovação                                          | `6254db70`                                                 |
| K10     | journey moderno 503/0/4 com negativos de escopo                             | `task/w10-k10` (`e9c5f31b`), ainda fora da feature         |

**Supersedes:** ADR-0022 §Mitigations (último item, critério de ativação e datas) e
ADR-0023 §Mitigations (último item, janela de compatibilidade). A supersessão produz
efeito desde 2026-10-22 (ADR-0048 Accepted); as seções antigas de ADR-0022/0023 permanecem como histórico.
**Superseded By:** N/A
**Atualiza por referência:** ADR-0024 §Activation, item 1 ("ADR-0022/0023 compatibility
evidence and migration gate"), que passa a ser satisfeito pelo critério deste ADR.
**Relacionados:** ADR-0035 (sunset do rastreamento de negações em `as_events`, que depende da
ativação do ledger), ADR-0045 e ADR-0047 (consumidores das ferramentas `environment.*`/`memory.*`).

## Context

ADR-0022 e ADR-0023 condicionam a ativação do ledger e do servidor MCP moderno a 30 dias
consecutivos de zero uso legado, com ativação até 2026-10-31 e remoção do caminho de
compatibilidade até 2026-11-30. Os fatos de 2026-10-22 mostram que esse critério não é
alcançável:

- O uso legado do próprio host do owner foi registrado em 2026-10-16, 2026-10-17 e 2026-10-20
  (**a verificar na K1/K3**: datas vêm do contador de uso legado, ainda não arquivado como evidência).
  O contador de 30 dias reinicia a cada uso e já não pode fechar antes de 2026-10-31.
- O Codex em uso normal negocia a era legada (`2024-11-05`) (**a verificar na K1**); portanto, uso normal de um cliente
  registrado conta como legado, e "zero uso legado" exigiria parar de usar os clientes.
- O runbook de ativação (§9 "Dívida do sunset MCP"; vive em `task/w6-e7`/W6, ainda não
  mergeada, e não existe nesta base) já reconhece que o critério não cabe antes de
  2026-11-30 (o prazo de ativação de 2026-10-31 também já não cabe; **a verificar na K3**
  contra o contador de uso).
- Os quatro servidores nativos instalados (`mcp-project-state`, `mcp-hseos-governance`,
  `mcp-hseos-swarm`, `mcp-axon-bridge`) sobem o servidor legado
  (`tools/lib/legacy-mcp-server.js`), que **não aplica** o sunset (só emite metadado de
  telemetria). O servidor moderno, o único que recusa o legado após o sunset
  (`tools/lib/mcp-2026-adapter.js`), só sobe em fixture e fica bloqueado por
  `EXECUTION_ACTIVATION_PENDING` (`tools/lib/governed-execution/native-mcp-server.js`).
- As ferramentas `environment.*` e `memory.*` (ADR-0047) existem apenas no servidor moderno.
  Sem ativação, a capacidade entregue não é alcançável por nenhum cliente real.

Efeito: o critério vigente trava a ativação por uma condição que o próprio uso do produto
impede, e a data de sunset de 2026-11-30 não é aplicada por nenhum servidor em produção.
Manter as duas é uma regra sem enforcement. É necessário um critério baseado em evidência,
verificável por banco, que preserve a intenção original (não quebrar clientes, não ativar às
cegas, poder voltar atrás).

## Decision

We will substituir o critério de "30 dias de zero uso legado" por um critério de ativação
**por banco**, baseado em evidência, e tornar o sunset do legado condicional à evidência de
protocolo dos clientes registrados.

1. **Piloto e escopo.** O primeiro e único banco coberto por este ADR é
   `.hseos/state/project.db` do repositório enterprise-hseos. Ativa-se um banco por vez. Os
   demais `project.db` do host (a K7 contou 18 no total; contagem a reconfirmar na hora) ficam fora até ADR ou autorização própria.
2. **Critério de ativação (todas as condições, com evidência arquivada).**
   - (a) As suítes de contrato do servidor moderno (`test/test-mcp-2026-adapter.js` e
     `test/test-mcp-contract.js`) passam sobre um **banco existente já ativado** (não apenas
     sobre fixture vazia).
   - (b) O ensaio de ativação e rollback em **cópia** do banco
     (`tools/lib/agentic-activation-rehearsal.js`) conclui.
   - (b2) O backup do banco real traz `PRAGMA integrity_check` = `ok` e o sha256 do
     original e do backup, registrados como evidência própria, separada do ensaio em cópia.
   - (c) A journey MCP moderna (`test/journeys/mcp-journey.mjs`) roda de ponta a ponta com
     **contagens de ferramentas conferidas** contra o catálogo esperado. Contagens medidas na
     K7 (`docs/evolution/w10/evidence/k7/`): governance 15, project-state 15, swarm 5 e
     axon-bridge 6. As famílias `memory.*` (+3, total 18) e `environment.*` (+6 com
     `workspace`, total 24) aparecem **somente no project-state e somente com a seção
     `environment:`** na configuração; nenhum outro servidor passa `environmentHost`. A K7
     também achou que o `mcp-journey.mjs` atual só exercita o caminho legado, e a medição
     do modo moderno vinha de um harness próprio. **Entregue pela K10** (`task/w10-k10`,
     `e9c5f31b`): `mcp-journey.mjs --mode modern` sobre banco ativado, 503 PASS / 0 FAIL / 4
     NOT_EXERCISED (axon real ausente do `PATH`), com os negativos de escopo do swarm
     (evidência em `docs/evolution/w10/evidence/k10/`).
   - (d) Prova com cliente real (Codex instalado) via `tools/list` e `tools/call` contra o
     servidor moderno, com a versão de protocolo negociada registrada.
   - (e) A compatibilidade **legado-dentro-do-moderno** permanece ativa no servidor moderno,
     de modo que clientes só-legado continuam funcionando após a troca.
   - (f) A compat legada do servidor moderno **negocia o `initialize` das revisões legadas
     conhecidas** (`2024-11-05`, `2025-06-18`, `2025-11-25`; a K4 avalia também `2025-03-26`,
     citada na recomendação da K1 e na lista de versões do binário do Codex
     (`binary-strings.txt`), sem frame observado), atendendo-as no modo compat, com aviso de depreciação e
     contador de uso, e **sem executar para esses clientes ferramentas que exigem aprovação**
     (ADR-0023, Decision item 15). A ferramenta continua listada, e a chamada devolve
     `MCP_LEGACY_APPROVAL_UNSUPPORTED` (`tools/lib/mcp-2026-adapter.js:911-917`). No
     `initialize` compat, o servidor **negocia para `2024-11-05`**, como o legado de produção
     responde hoje, salvo evidência em contrário da K1/K4. Motivo (K1, evidência em
     `docs/evolution/w10/evidence/k1/`, branch `task/w10-k1`; SHA não citado por a branch
     ainda estar em revisão): o Codex 0.163.0 envia `initialize` com `2025-06-18` e o
     adaptador atual só aceita `2024-11-05` exato (`tools/lib/mcp-2026-adapter.js:978`),
     recusando com `-32022`; o Claude Code 2.1.305 fala `2026-07-28` por padrão, **mas em 1
     de 8 execuções** caiu em `initialize` `2025-11-25` e foi recusado (causa não
     determinada; hipótese não verificada: flag remota em cache). Portanto o (f) é necessário também para ele. O servidor legado não pode continuar registrado para o Codex,
     pois se recusa a abrir banco ativado. Sem (f), a troca do Codex para o moderno quebra o
     cliente. A mudança é **entregue pela W10/K4** (`b639f965`, na feature: o servidor moderno serve o banco ativado e
     atende o `initialize` das quatro revisões, `2024-11-05`, `2025-03-26`, `2025-06-18` e
     `2025-11-25`, todas negociadas para `2024-11-05`; a `2025-03-26` não teve frame observado
     de cliente real, só o harness da K7) e é
     **alteração parcial do ADR-0023 §Mitigations** (último item): a janela de compatibilidade
     não se estende, mas o "only" de "supports only `2024-11-05` through `R`" é **revogado**,
     pois passam a ser aceitas as revisões `2025-06-18` e `2025-11-25`.
3. **Sunset do legado.** A data fixa 2026-11-30 deixa de valer. O sunset passa a ser
   condicional à evidência (spike K1, `docs/evolution/w10/evidence/k1/`) de que os clientes
   registrados (Codex, Claude Code) falam `2026-07-28` em `tools/list`/`tools/call`. Sem essa
   evidência, a compatibilidade continua. Nova data-limite: **a fixar pelo owner após K1**
   (sem valor proposto aqui); a fixação e qualquer extensão exigem decisão registrada com
   evidência de uso, nos moldes já exigidos por ADR-0022/0023. **Enquanto o owner não fixar a
   data, a compatibilidade legada NÃO expira.**
   O sunset também fica condicionado a que o **Codex estável, sem flag**, envie
   `server/discover` `2026-07-28`; hoje isso exige a feature `mcp_2026_07_28`, em
   desenvolvimento, mais `CODEX_MCP_PROTOCOL_VERSION` (K1). Sem data fixa.
   Consequência de código, **entregue pela W10/K4** (`b639f965`): em banco ativado o sunset
   deixa de ser a constante `LEGACY_SUNSET = '2026-11-30'` e passa a vir da variável
   `HSEOS_MCP_LEGACY_SUNSET` (data ISO ou instante). Sem valor, a compatibilidade não expira;
   valor inválido aborta o boot (código de saída 78 segundo o relato da K4, **a reconfirmar**).
   Fixtures mantêm a data embutida.
   A constante `LEGACY_SUNSET` de `tools/lib/legacy-mcp-server.js`, que era ligada ao critério
   de 30 dias, deixou de existir na mesma entrega (`b639f965`).
4. **Rollback.** Parar os servidores e CLIs que usam o banco, restaurar o backup da etapa (b)
   e re-registrar o servidor legado nos clientes. A **perda das escritas posteriores à
   ativação é aceita explicitamente** (declarada ao owner antes do passo 1b). O banco
   ativado **não é apagado**: é preservado ao lado, como evidência de auditoria.
5. **Reconciliação com ADR-0022 §Rollback.** ADR-0022 proíbe que um backup pré-migração
   volte a ser o estado visível depois do primeiro comando pós-cutover e exige reconstruir a
   projeção de compatibilidade a partir do ledger completo. O rollback do item 4 **não
   cumpre a letra** dessa regra e, por isso, este ADR pede uma **exceção delimitada**:
   - vale apenas para o banco piloto e para a janela de ativação supervisionada
     (servidores parados, um único operador, escritas pós-ativação declaradas descartáveis);
   - preserva o princípio central da regra (nunca apagar o ledger; ele fica como evidência)
     e a regra "autoridade pós-cutover só se reverte por ADR" (este ADR é essa decisão);
   - não se estende a bancos com escritas de valor pós-ativação: nesses, vale a reconstrução
     por projeção descrita em ADR-0022, sem exceção.
     Sem a aceitação expressa dessa exceção pelo owner, o item 4 não pode ser executado e o
     rollback fica restrito ao procedimento original de ADR-0022.
6. **Gate de ativação.** O comando `hseos execution-activation plan|apply|rollback --db
--adr` foi **entregue pela W10/K2** (`53cb916a`, `da7bfce7`, `4743ba19`, `961fb250`, `fb516b82`, na
   feature) e passa a existir na `master` quando a PR da W10 for mergeada; não existia em
   1a23be3b. A recusa de `plan` e `apply` sem `--adr` apontando para um ADR com status
   **Accepted** é parte dele e foi exercitada contra este ADR ainda não aceito (K3, bloqueio
   `EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED`). Este ADR, enquanto não Accepted, não satisfazia o gate; desde 2026-10-22 ele o satisfaz. O
   comando decide o modo por banco: v4 legado; ativado (`user_version` 17, `application_id`
   `0x48534f53` e integridade) é moderno; qualquer outro estado é recusado como
   inconsistente, sem fallback.
7. **Pré-condições do `apply`.**
   - Congelar as escritas legadas e provar o escritor único: reaplica-se a mitigação de
     ADR-0022 §Mitigations ("freeze legacy writes before enabling the new path and add a
     single-writer invariant test"), com o teste de escritor único verde antes do `apply`.
   - **Efeito colateral da ativação:** depois de ativado, `assertOperationalSchemaBoundary`
     (`tools/mcp-project-state/lib/operational-state-db.js:26,82`) e o guard de
     `tools/cli/lib/governed-action.js:83-95` fecham o banco para os 4 servidores MCP
     legados, CLIs e hooks que o usam. Portanto, **antes do `apply`**, todos os clientes,
     CLIs e hooks que usam esse `project.db` devem ser re-registrados no servidor moderno:
     os 4 servidores nativos (`mcp-project-state`, `mcp-hseos-governance`, `mcp-hseos-swarm`,
     `mcp-axon-bridge`) registrados no Codex (3 MCPs do Codex e demais registros, lista
     nominal **a levantar na K3**), no Claude Code e nos hooks. O re-registro entra na
     verificação (d) e no checklist de Compliance; sem lista nominal fechada, o `apply` não
     roda.
   - **Janela supervisionada e prova parcial de "banco não aberto".** A varredura de
     processos do `apply` deixa ≈390 processos não inspecionáveis (K3); o `apply` prossegue
     mesmo assim e a prova de que o banco não está aberto em outro lugar é **parcial**. Por
     isso a ativação real exige janela supervisionada com os servidores, CLIs, hooks e
     sessões que mantêm o `project.db` aberto **parados** (lista nominal levantada na hora,
     por exemplo os MCPs do Codex), e o `apply` recusa se o lock de escrita falhar.
   - **WAL com dados não checkpointados** bloqueia o `apply` ("WAL sidecar still holds
     data"). O banco piloto tem WAL com dados e a K3 não exercitou esse caminho: ele deve ser
     exercitado no ensaio e conferido na ativação real, com os servidores parados.
   - **Gate `g9-zero-legacy-window`.** O ensaio oficial
     (`tools/lib/agentic-activation-rehearsal.js`) ainda lista esse gate, que é o critério
     de 30 dias que este ADR substitui. Reconciliar/atualizar o gate g9 **continua pendente**
     (não entregue); este ADR não altera código.
   - **K8 integrada.** A K7 achou um DoS local no adaptador moderno (linha JSON ou corpo
     HTTP `null` derruba o servidor moderno), **corrigido pela K8** (`b2b0d5ce`, `30af1f2d`, na
     feature; a K10 confirma que linhas `null`, número, `[]` e string não derrubam mais o
     servidor). A condição de integração da K8 está atendida na feature; a ativação real
     continua condicionada à PR da W10 mergeada.

## Consequences

### Positive

- O critério passa a ser verificável e alcançável, e prova o comportamento em banco real em
  vez de depender da ausência de uso.
- A capacidade `environment.*`/`memory.*` (ADR-0047) torna-se alcançável por clientes reais.
- O sunset deixa de ser uma data sem enforcement e passa a depender de evidência de cliente.
- Escopo de um banco por vez limita o raio de dano e produz evidência reutilizável.

### Negative / Trade-offs

- A exceção de rollback (item 5) aceita perda de escritas pós-ativação no piloto.
- A compatibilidade legado-dentro-do-moderno fica mantida por mais tempo que o previsto.
- Limitação declarada: `tools/call` e o fluxo MRTR do Codex ficaram **NOT_EXERCISED** no K1
  (exigem modelo). Entram na prova (d)/K7 apenas se o owner autorizar login e gasto; sem
  autorização permanecem como limitação, e a prova (d) do Codex cobre `tools/list`.
- O piloto passa a ser trabalho operacional adicional (K1–K3, K7) antes de qualquer expansão.

### Risks

- **Ferramentas `environment.lsp`/`environment.dap` exigem cgroup delegado.** Fora dele
  devolvem `ENGINEERING_ISOLATION_UNAVAILABLE`, e um MCP iniciado pelos clientes a partir da
  configuração padrão não roda delegado (K7, F4). Mitigação entregue pela K9 (`e8ad550d`,
  `60347b3a`, `77129c59`, `ed429562`): o servidor omite essas famílias, com aviso, quando o
  isolamento não está disponível, e se a composição do host falhar reinicia uma única vez sem
  host. O lançamento delegado está documentado no runbook. Sem o isolamento, `memory.*`
  continua funcionando. Não verificado com cliente real.
- **DoS local no adaptador moderno** (linha JSON ou corpo HTTP `null`, K7 F1/F1b).
  Mitigação: corrigido pela K8 (`b2b0d5ce`, `30af1f2d`). Resolvido na feature; segue
  dependente do merge da PR da W10.

- **Clientes só-legado quebram após o sunset.** Mitigação: o sunset só vale com a evidência K1
  de que os clientes registrados falam `2026-07-28`; a compat permanece até lá.
- **Banco ativado incompatível com o servidor legado.** Mitigação: o rollback restaura o
  backup e re-registra o legado; o ensaio em cópia (b) prova a volta antes da ativação real.
- **Perda de escritas pós-ativação.** Mitigação: janela supervisionada, servidores parados,
  perda declarada ao owner antes da ativação; ledger ativado preservado como evidência.
- **Ativação sem governança.** Mitigação: o comando entregue pela K2 recusa `plan` e `apply`
  sem `--adr` Accepted (exercitado na K3). A K11 (`6254db70`) também fecha a escrita fora de
  escopo antes de pedir aprovação, sem eventos `ExecutionOutcomeUncertain` (K10).
- **Efeito de precedente.** Mitigação: a exceção do item 5 é restrita ao piloto; os demais
  bancos exigem ADR ou autorização própria.

## Affected Standards

| Standard                                | Section / Rule                                                              | Change                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ADR-0022                                | §Mitigations (critério de ativação e datas); §Rollback (exceção delimitada) | Supersedes o critério; Extends o rollback com exceção do piloto                                                      |
| ADR-0023                                | §Mitigations (janela de compatibilidade e datas)                            | Supersedes a janela e as datas; Amends o "only" de `2024-11-05` (passa a aceitar também `2025-06-18` e `2025-11-25`) |
| ADR-0024                                | §Activation, item 1                                                         | Clarifies (satisfeito pelo critério deste ADR)                                                                       |
| ADR-0035                                | Sunset do rastreamento de negações em `as_events`                           | Clarifies (gatilho passa a ser a ativação conforme este ADR)                                                         |
| `docs/evolution/runbooks/activation.md` | Passo 1b; §9 Dívida do sunset MCP                                           | Passa a citar este ADR; o runbook é atualizado na E7b (`task/w6-e7`, ainda não mergeada)                             |

## Compliance

- [x] Aprovado pelo owner (Accepted) em 2026-10-22, aceite explícito na sessão ("Aceito o ADR")
- [x] Exceção de rollback do item 5 aceita pelo owner no mesmo aceite (o ADR como está, inclusive
      a exceção delimitada ao piloto). A ciência da perda das escritas pós-ativação continua
      exigida antes do passo 1b, na janela supervisionada
- [ ] Data-limite do sunset fixada pelo owner após K1 — **a fixar pelo owner; o aceite não a fixou**
- [x] Evidência K1 (protocolo dos clientes) arquivada em `docs/evolution/w10/evidence/k1/`
      (`task/w10-k1`; sustenta o critério (d) e o sunset). Não é aprovação, só evidência.
- [x] Evidência por critério, em `docs/evolution/w10/evidence/`:
  - (a) K7 (`k7/`): suíte `test-mcp-activated-mode.js` 17/17; as suítes `test-mcp-2026-adapter.js`
    e `test-mcp-contract.js` provadas pelo CI, não nesta evidência. **Parcial.**
  - (b) K3 (`k3/`): ensaio de ativação e rollback em cópia do `project.db` real. **Atendido.**
  - (b2) backup do banco **real** com `integrity_check` e sha256: só existe na ativação real.
    **Pendente.**
  - (c) K7 e K10 (`k7/`, `k10/`): contagens 15/15/5/6 conferidas e journey moderno
    503 PASS / 0 FAIL / 4 NOT_EXERCISED. **Atendido com ressalvas** (axon real ausente).
  - (d) K1 e K7 (`k1/`, `k7/`): Claude Code 8/8 em `2026-07-28`; Codex `initialize` e
    `tools/list` concluem no banco ativado. `tools/call` e MRTR do Codex **NOT_EXERCISED**.
    **Parcial.**
  - (e) K7 e K10: compat legado-dentro-do-moderno mantida. **Atendido.**
  - (f) K7 e K10: `initialize` das revisões legadas negociado para `2024-11-05` nos 4
    servidores, sem executar ferramentas com aprovação. **Atendido.**
- [ ] Entregas de código da W10 mergeadas na `master` (PR da W10): K2, K4, K5/K5b, K8, K9, K11
- [ ] Gate `g9-zero-legacy-window` do ensaio oficial reconciliado — **pendente, não entregue**
- [ ] Owner decide se autoriza `tools/call`/MRTR do Codex na K7 (login/gasto) e navegador/computer-use na CLI — **pendente; o aceite não os autorizou**; sem decisão, limitação declarada
- [ ] Lista nominal de clientes, CLIs e hooks re-registrados no servidor moderno antes do `apply`
- [ ] Janela supervisionada da ativação real (servidores parados; WAL com dados exercitado)
- [ ] Checklist aberto de ADR-0022 (padrões ES/CQRS/AR/Tool Design referenciando o ADR;
      dry-run de migração revisado contra cópia de backup; suíte de conformance de adaptadores;
      equipes notificadas) ligado às evidências acima
- [ ] Checklist aberto de ADR-0023 (quatro servidores nativos passam nos testes de contrato
      modernos; janela de compatibilidade e versão de remoção documentadas; equipes notificadas)
- [ ] Índice de ADRs e documentos citados por ADR-0022 (`.hseos/AGENT-MANIFEST.md`, workflow
      dev-squad, workflows de resume, skill dev-squad, documentação de state-tracking)
      atualizados na ativação
- [ ] Data de ativação: pendente (Accepted em 2026-10-22; falta janela supervisionada e autorização por banco)
- [ ] Data de revisão: 90 dias após a ativação do piloto

## Alternatives Considered

| Alternative                                         | Why Rejected                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manter os 30 dias de zero uso legado                | Inalcançável: o uso normal do owner e do Codex conta como legado e reinicia o contador; trava a ativação por tempo indeterminado e deixa o sunset sem enforcement |
| Ativar sem ADR Accepted, só com a evidência técnica | Remove o gate humano exigido por ADR-0022/0024; evidência técnica não substitui autoridade de decisão                                                             |
| Ativar globalmente em todos os `project.db` do host | Raio de dano máximo, sem evidência de rollback real por banco; o piloto precisa produzir a prova antes de qualquer expansão                                       |
| Remover o legado na data fixa de 2026-11-30         | Pode quebrar clientes que só falam `2024-11-05`; sem evidência K1 a data é arbitrária                                                                             |

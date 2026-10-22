# ADR-0048: Critério de ativação do ledger de execução governada e do servidor MCP moderno

## Status

Proposed — 2026-10-22. Aguarda decisão do owner. Nada neste documento ativa, migra ou remove
coisa alguma: a ativação operacional exige este ADR em **Accepted** e autorização explícita
por banco (ver Decision, item 6). Campos de aprovação humana ficam em branco de propósito.

**Supersedes:** ADR-0022 §Mitigations (último item, critério de ativação e datas) e
ADR-0023 §Mitigations (último item, janela de compatibilidade). A supersessão só produz
efeito quando este ADR for Accepted; até lá os critérios antigos continuam vigentes.
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

- O uso legado do próprio host do owner foi registrado em 2026-10-16, 2026-10-17 e 2026-10-20.
  O contador de 30 dias reinicia a cada uso e já não pode fechar antes de 2026-10-31.
- O Codex em uso normal negocia a era legada (`2024-11-05`); portanto, uso normal de um cliente
  registrado conta como legado, e "zero uso legado" exigiria parar de usar os clientes.
- O runbook de ativação (`docs/evolution/runbooks/activation.md`, §9 "Dívida do sunset MCP")
  já reconhece que o critério não cabe antes de 2026-11-30.
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
   demais 21 `project.db` do workspace ficam fora até ADR ou autorização própria.
2. **Critério de ativação (todas as condições, com evidência arquivada).**
   - (a) A suíte de contrato do servidor moderno passa sobre um **banco existente já
     ativado** (não apenas sobre fixture vazia).
   - (b) O ensaio de ativação e rollback em **cópia** do banco
     (`tools/lib/agentic-activation-rehearsal.js`) conclui, e o backup do banco real traz
     `PRAGMA integrity_check` = `ok` e sha256 do original e do backup.
   - (c) Uma journey MCP moderna roda de ponta a ponta com **contagens de ferramentas
     conferidas** contra o catálogo esperado (inclusive `environment.*` e `memory.*`).
   - (d) Prova com cliente real (Codex instalado) via `tools/list` e `tools/call` contra o
     servidor moderno, com a versão de protocolo negociada registrada.
   - (e) A compatibilidade **legado-dentro-do-moderno** (`2024-11-05`) permanece ativa no
     servidor moderno, de modo que clientes só-legado continuam funcionando após a troca.
3. **Sunset do legado.** A data fixa 2026-11-30 deixa de valer. O sunset passa a ser
   condicional à evidência (spike K1, `docs/evolution/w10/evidence/k1/`) de que os clientes
   registrados (Codex, Claude Code) falam `2026-07-28` em `tools/list`/`tools/call`. Sem essa
   evidência, a compatibilidade continua. Nova data-limite: **a fixar pelo owner após K1**
   (sem valor proposto aqui); a fixação e qualquer extensão exigem decisão registrada com
   evidência de uso, nos moldes já exigidos por ADR-0022/0023.
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
6. **Gate de ativação.** O comando de ativação **recusa** executar sem `--adr` apontando para
   um ADR com status **Accepted**; a recusa é testada (passo negativo obrigatório). Este ADR
   em Proposed não satisfaz o gate.

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
- O piloto passa a ser trabalho operacional adicional (K1–K3, K7) antes de qualquer expansão.

### Risks

- **Clientes só-legado quebram após o sunset.** Mitigação: o sunset só vale com a evidência K1
  de que os clientes registrados falam `2026-07-28`; a compat permanece até lá.
- **Banco ativado incompatível com o servidor legado.** Mitigação: o rollback restaura o
  backup e re-registra o legado; o ensaio em cópia (b) prova a volta antes da ativação real.
- **Perda de escritas pós-ativação.** Mitigação: janela supervisionada, servidores parados,
  perda declarada ao owner antes da ativação; ledger ativado preservado como evidência.
- **Ativação sem governança.** Mitigação: o comando recusa sem `--adr` Accepted.
- **Efeito de precedente.** Mitigação: a exceção do item 5 é restrita ao piloto; os demais
  bancos exigem ADR ou autorização própria.

## Affected Standards

| Standard                                | Section / Rule                                                              | Change                                                          |
| --------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| ADR-0022                                | §Mitigations (critério de ativação e datas); §Rollback (exceção delimitada) | Supersedes o critério; Extends o rollback com exceção do piloto |
| ADR-0023                                | §Mitigations (janela de compatibilidade e datas)                            | Supersedes                                                      |
| ADR-0024                                | §Activation, item 1                                                         | Clarifies (satisfeito pelo critério deste ADR)                  |
| ADR-0035                                | Sunset do rastreamento de negações em `as_events`                           | Clarifies (gatilho passa a ser a ativação conforme este ADR)    |
| `docs/evolution/runbooks/activation.md` | Passo 1b; §9 Dívida do sunset MCP                                           | Passa a citar este ADR (atualização em E7b)                     |

## Compliance

- [ ] Aprovado pelo owner (Accepted) — **pendente; não preenchido por este rascunho**
- [ ] Exceção de rollback do item 5 aceita expressamente pelo owner — pendente
- [ ] Data-limite do sunset fixada pelo owner após K1 — **a fixar pelo owner após K1**
- [ ] Evidência K1 (protocolo dos clientes) arquivada em `docs/evolution/w10/evidence/k1/`
- [ ] Evidência K3 (ensaio de ativação e rollback em cópia; backup com integrity_check e sha256)
- [ ] Evidência K7 (journey MCP moderno, contagens e prova com cliente real)
- [ ] Checklist aberto de ADR-0022 (padrões ES/CQRS/AR/Tool Design referenciando o ADR;
      dry-run de migração revisado contra cópia de backup; suíte de conformance de adaptadores;
      equipes notificadas) ligado às evidências acima
- [ ] Checklist aberto de ADR-0023 (quatro servidores nativos passam nos testes de contrato
      modernos; janela de compatibilidade e versão de remoção documentadas; equipes notificadas)
- [ ] Índice de ADRs e documentos citados por ADR-0022 (`.hseos/AGENT-MANIFEST.md`, workflow
      dev-squad, workflows de resume, skill dev-squad, documentação de state-tracking)
      atualizados na ativação
- [ ] Data de ativação: pendente de Accepted
- [ ] Data de revisão: 90 dias após a ativação do piloto

## Alternatives Considered

| Alternative                                         | Why Rejected                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manter os 30 dias de zero uso legado                | Inalcançável: o uso normal do owner e do Codex conta como legado e reinicia o contador; trava a ativação por tempo indeterminado e deixa o sunset sem enforcement |
| Ativar sem ADR Accepted, só com a evidência técnica | Remove o gate humano exigido por ADR-0022/0024; evidência técnica não substitui autoridade de decisão                                                             |
| Ativar globalmente nos 22 bancos                    | Raio de dano máximo, sem evidência de rollback real por banco; o piloto precisa produzir a prova antes de qualquer expansão                                       |
| Remover o legado na data fixa de 2026-11-30         | Pode quebrar clientes que só falam `2024-11-05`; sem evidência K1 a data é arbitrária                                                                             |

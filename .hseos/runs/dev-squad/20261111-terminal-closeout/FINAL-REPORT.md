# FINAL-REPORT — run `20261111-terminal-closeout` (terminal W0 a W5, antes da W6)

## Veredito

**TERMINAL PRONTO COM GATES DECLARADOS** (regra 7.4 do prompt da run). A completude funcional das linhas W1 a W5 do PLAN está
provada numa instalação limpa do tarball fora do checkout ou classificada; o que resta é certificação (consumidor real, campanhas,
quarta integração) e decisões listadas em `OWNER-GATES.md` (OG-01 a OG-17). Isso não impede validar o terminal antes da IDE.
Gate legível por máquina: `docs/evolution/terminal-closeout/terminal-readiness.json`, validado por `test/test-terminal-readiness.js`.

## T1 a T12

| # | Resultado | Evidência |
|---|---|---|
| T1 | ok | `npm test` exit 0 em `75382d1c`; no topo da TD, scripts 1–39 verdes e 40–115 verdes (76/76), com o 40 instável sob carga (pré-existente, OG-17); lint 0; `test:kernel-coverage` exit 0; Node 22 pelo CI (`test (22.x)` success, run 43137154415; local inviável por ABI do nativo); CI da `master` `a0a09757` verde |
| T2 | ok | `test-kernel-quality-surface.js`, `test-evolution-trace.js`, `test-terminal-readiness.js` verdes; contradições de PLAN/MAPA/STATUS/inventário reconciliadas (TD1); conflito de F01/F11/F16/F21 com o ADR-0050 declarado no inventário (OG-01) |
| T3 | ok | 21 de 22 famílias de W0–W5 em `verified_w<N>_scope_only`; F17 OWNER-DECISÃO (OG-05) |
| T4 | ok | 5 verificadas em escopo local; 17 `not_verified`, todas com classe e OG |
| T5 | ok | `docs/evolution/terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md`: `--offline`; `core-journey` PASS 12, `mcp-journey` legado PASS 144, moderno PASS 507; upgrade sem reescrever eventos; downgrade recusado sem escrita; rollback ao sha256 original. Migração de banco ativado entre schemas sem caminho no produto (OG-16) |
| T6 | ok | crash nas fronteiras e cancelamento transitivo (`test-terminal-control.js`, `test-terminal-executor.js`); 401 por ação sem efeito (TB2); job adiado após fechamento e SIGKILL, despacho único (TB5) |
| T7 | ok | segredo canário em todo artefato de uma execução supervisionada (TB4); teto agregado com 6 processos e disputa observada (TB3); egress, isolamento, aprovações, sem pool de identidades (testes existentes) |
| T8 | ok | `test-compaction-resume-fork.js`, `test-compaction-agent-run.js`, recuperação sem relançar efeito, crash e reinício na jornada instalada |
| T9 | ok | `docs/terminal.md` (instalar, usar, limites, não certificado); `verify-doc-facts.sh` rc=0 depois da correção do README (TD0); neutralidade; `check:cli` 0 |
| T10 | ok | PRs #314, #315, #316 com checks verdes e `CLEAN`; tags `hseos-terminal-wa`..`-wc` (e `-wd` depois do merge da TD); 1 task = 1 commit (correções como commits próprios, D5); 0 atribuição |
| T11 | ok | `REAUDIT-BLIND-TERMINAL-2026-11-11.md`: duas passagens, T11 aprovado sem ressalva impeditiva (NÃO DETERMINÍSTICO; controle: confronto e fatos de ferramenta) |
| T12 | ok | `docs/evolution/terminal-closeout/W6-ENTRY.md` (superfície estável, versões, cursor, terminais, aprovação, riscos, gates, fora de escopo); W6 não iniciada |

## Famílias de W0 a W5, antes e depois

Nenhum `status.*` mudou nesta run (conferido por `git diff 99a54dcc` pela auditoria). `deterministic`: 21 verificadas + F17 `not_verified_for_evolution` (antes e depois). `real_consumers`: F01, F11, F16, F20, F21 `verified_installed_local_scope_only` e 17 `not_verified` (antes e depois); o que mudou foi o registro: F01, F11 e F16 passaram a ter `evolution_evidence` e `evolution_scope` que declaram a base anterior ao ADR-0050 e o OG-01; F06, F12 e F22 tiveram o `gap` corrigido. `operational`: `not_authorized` em todas.

## Lacunas

**Fechadas por esta run:** GM-01 (teste de boot governado dependia do banco do host), GM-02 (401 por ação de terminal), GM-03 (teto agregado entre processos), GM-04 (varredura de segredo canário), GM-05 (job adiado após morte do controlador), GM-06/GM-07/GM-17 (aceite instalado, offline, upgrade, downgrade, rollback, CLI), GM-08 (doc do terminal), GM-09..GM-14 (inventário), GM-16 (gate de prontidão e W6-ENTRY), GM-18 (contagem de skills).

**Adiadas, com a razão:** GM-15 (conjunto do c8: decisão do owner, OG-10); GM-19 (migração de banco ativado entre schemas: desenho aberto, OG-16); consumidor real de 17 famílias (gasto ou ratificação do owner, OG-01..OG-09); limites L-01..L-15 do GAP-MAP (desenho, decisão ou fora do terminal).

**Achados durante a execução:** gate de frescor da F14 v4 acoplado ao `package.json` (regenerado duas vezes, sem gasto; OG-11); defesa em profundidade broker + supervisor contra eco de segredo (o teste não isola cada camada); `w3/TRACE.json` cita linhas do `requirements.json`; instabilidade de desempenho de `test-capability-intake-guard.js:1440` (OG-17); compat MCP legado não expira no produto ativado (a data 2026-11-30 só vale em fixture).

## OWNER-GATES

Ver `OWNER-GATES.md` (OG-01 a OG-17, com classe, ação exata e custo). Os de maior efeito: **OG-01** (ratificar ou rebaixar o valor de consumidor local de F01/F11/F16/F21, US$ 0), **OG-16** (desenho de migração do ledger ativado, antes da próxima mudança de schema e recomendado antes da W6), **OG-02/OG-03/OG-04** (campanhas pagas de consumidor real, ordem de US$ 1 a 3 cada) e **OG-17** (teste instável).

## Custo por atividade

Gasto pago: **US$ 0** (nenhuma chamada a provedor real; ensaio da F14 v4 em modo fixture). Métricas por agente (`interaction-metrics.py`, sem preço declarado; uso de assinatura) em `METRICS.md` desta run: 27 agentes, 361 chamadas de API, 360 chamadas de ferramenta, 266.256 tokens de saída, 22,2 M tokens lidos de cache, 2,1 M escritos, 3.684 s de parede somados. Agentes retomados (rodadas 2) somam as rodadas no mesmo transcript.

## O que esta validação não prova

- Consumidor real com modelo para 17 famílias; nenhuma campanha paga nesta run.
- Jornadas usam respostas roteirizadas, sem modelo; provam o encanamento do produto instalado, não a qualidade de um agente real.
- Só Linux com cgroup v2 delegado, bubblewrap e pidfd; macOS, Windows e acesso remoto ficam na W7.
- A instalação offline usou o cache npm deste host.
- Node 22 local não rodou (ABI do nativo); a prova é do CI.
- Migração de um ledger já ativado entre schemas (OG-16).
- Isolamento real do sandbox nos testes de segredo (shim de `ai-jail`).

## Como o owner valida o terminal agora

1. `git checkout master && git pull` (a `master` contém as quatro ondas).
2. `node --test --test-concurrency=1 test/test-terminal-readiness.js` — o gate confere critérios, evidência, famílias e OGs.
3. `npm pack` e instalação limpa fora do checkout, como em `docs/terminal.md` ("Instalar") e `test/journeys/README.md`:
   `heavy-run --mem 4G -- node test/journeys/core-journey.mjs --prefix <consumidor> --tgz <tgz> --out <dir>` e o mesmo para
   `mcp-journey.mjs` (`--mode modern` num consumidor próprio).
4. Opcional: repetir o roteiro `docs/evolution/terminal-closeout/evidence/upgrade-rollback.mjs` (ver o recibo da TC1 para os argumentos).
5. Decidir os OWNER-GATES, a começar por OG-01, OG-16 e OG-17.

## PRs e tags

#314 (TA) `4c9352c7` `hseos-terminal-wa`; #315 (TB) `4a489344` `hseos-terminal-wb`; #316 (TC) `a0a09757` `hseos-terminal-wc`; PR da TD e `hseos-terminal-wd`: ver `STATUS.md`.

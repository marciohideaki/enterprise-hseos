# Reauditoria focada W0–W5 — 2026-10-30

- **Pedido:** o owner pediu, em 2026-10-30, "Refaça a auditoria focada" (item 1).
- **Objeto:** os 20 achados (A-01..A-20) do relatório de 2026-10-27 (`docs/evolution/audit-2026-10-27/CONFORMIDADE-W0-W5.md`, base `f96c6e9c`), mais os 8 aceites irregulares levantados na revalidação da D2.
- **Alvo:** worktree descartável `2850181a`, que soma:
  - a master `f953992b`, já com as correções #255–#257;
  - as três ondas das decisões do owner de 2026-10-30, integradas localmente: W1 (PR #258), W2 e W3.
- **Exceção na A-16:** foi reavaliada sobre a W2 reintegrada (`382a9509`) com a rodada 2 da D7.
- **Método:** 2 coletores independentes (Sonnet), cada um com:
  - a reprodução original rodada no alvo;
  - código e teste conferidos;
  - mutação dirigida em cópia descartável para os achados de severidade Alta e Média.

  O Commander confrontou os resultados e deu o veredito.
- **Relatórios dos coletores:** `RA-A.md` e `RA-B.md`, no mesmo diretório.

## Veredito por achado

| Achado | Sev. original | Veredito | Evidência principal | Resíduo |
|---|---|---|---|---|
| A-01 CI sem 9 testes | Alta | FECHADO | `verify` cobre 230 arquivos; tirar `test-install-lock.js` do `package.json` → exit 1 | — |
| A-02 `data.issues` do Ajv | Alta | FECHADO | entrada só `keyword`/`instancePath`, saída `issue_count`; mutação morta | — |
| A-03 `error.message` no legado | Alta | FECHADO | allowlist por `code`; mutação morta | N-1: `EXECUTION_ACTIVATION_*` leva o caminho do banco ao cliente legado (baixa, só leitura de código) |
| A-04 gates de mutação | Alta | FECHADO | W4 20/20 e W5 43/43, exit 0; esperado derivado da tabela | — |
| A-05 redação de chave | Média | PARCIAL | linha única e multilinha de Ed25519/RSA/EC redigidas | corpo de 2 a 4 linhas curtas e PKCS8 cifrado (limite já declarado no MAPA) |
| A-06 H-7 | Média | DECISÃO DO OWNER registrada | `MAPA.md:160` | — |
| A-07 `operational` | Média | FECHADO por revalidação | as 27 famílias foram revalidadas; nenhuma tem as três provas; guard com enum e evidência | F19/F20 podem subir se o owner autorizar a prova de execução no banco real |
| A-08 falso verde do swarm | Média | FECHADO | servidor morto no boot → exit 1 (antes: 0) | — |
| A-09 c8 sem ledger | Média | PARCIAL | ledger, banco da ativação e `agent-environment/index.js` no gate, acima de 90/80 | seguem fora: `native-mcp-adapters.js`, `entrypoint-adapters.js`, índices de F17/F18/F22 e `capability-catalog.js` (F21) |
| A-10 swarm por caminho | Média | FECHADO | `mkdirContained` e `readdirContained` por fd, revalidação por componente, testes de troca | não-Linux por caminho (declarado) |
| A-11 mutante `admission &&` | Média | FECHADO | morto por `test-engineering-control.js:669` | — |
| A-12 rollback sem receipt | Média | FECHADO | `EXECUTION_ACTIVATION_RECEIPT_REQUIRED`; mutação derruba 3 testes | colisão de nome em 1 s (fail-closed) |
| A-13 docs desatualizadas | Baixa | FECHADO | afirmações velhas removidas | — |
| A-14 M-10 sem noturno | Média | FECHADO | noturnos de 28, 29 e 30/10 com Node 22 completo em `f953992b`, mais o dispatch 40624450080, todos verdes | — |
| A-15 lock de install | Baixa | PARCIAL | mutante C e corrida do takeover mortos | `uninstall` e `init` fora do lock; janela rename→link declarada |
| A-16 `env: {}` e supervisor | Baixa | FECHADO após a rodada 2 da D7 | token nos 13 pontos, cada um com teste; 13 mutações mortas | descendentes dentro do bwrap `--clearenv` não marcados (`--unshare-all`, `--die-with-parent`) |
| A-17 atribuição em PRs antigas | Baixa | DECISÃO DO OWNER (aberta) | #186–#195 e #197 ainda com a linha; #198 e #250–#258 e os commits desde `f96c6e9c` limpos | — |
| A-18 distribuição global | Baixa | ABERTO (owner) | global sem `hseos-install.lock`; `AGENTS.md` global ainda diz `2b4d6f37` | reinstalar e corrigir exige decisão sua |
| A-19 contagem e M09 | Baixa | FECHADO | MAPA com 20 aceites e M09 morto | — |
| A-20 rastreabilidade | Info | PARCIAL | STATUS das runs reconciliados | W3/W4 sem rastro legível por máquina; runs antigas sem handoffs |

**Contagem:**

| Veredito | Achados |
|---|---|
| Fechados | 13 |
| Parciais | 4 (A-05, A-09, A-15, A-20) |
| Decisão do owner | 3 (A-06 registrada; A-17 e A-18 abertas) |
| Abertos por defeito | 0 |

## Aceites irregulares (D2)
Os 8 itens com dono owner (4, 5, 11, 15, 16, 19, 23 e 24 do `w5/STATUS.md`) seguem sem registro do seu aceite. A exceção é o item 24: o owner decidiu incluir `agent-environment/index.js` no c8 (item 6), e o arquivo agora está no gate. As 6 perguntas da D2 continuam pendentes.

## Veredito do Commander
- **Escopo focado (os 20 achados):** CONFORME COM RESSALVAS. Nenhum achado de severidade Alta segue aberto, e todos os de severidade Média estão fechados ou viraram resíduo declarado. Os parciais são limites documentados, não defeitos novos.
- **Não é veredito da evolução inteira.** Esta reauditoria não reavalia o critério de consumidor real da W5 (F14, F15 e F20, `real_consumers: not_verified`) nem as famílias `not_verified_for_evolution`. Pelo relatório de 2026-10-27, a W5 continua NÃO CONFORME nesse critério.

## Lacunas desta reauditoria
- Suíte completa do alvo combinado não rodou. As suítes das ondas estão em reexecução; ver o STATUS da run.
- c8 do `test:kernel` completo foi medido por onda, não sobre o alvo combinado.
- Não houve corrida real (TOCTOU) no swarm nem no lock.
- A veracidade das decisões do owner foi verificada só no que está escrito.

## Achados novos
- **N-1 (baixa):** mensagens `EXECUTION_ACTIVATION_*` permitidas pela allowlist do transporte legado levam o caminho absoluto do banco ao cliente MCP.
- **N-2 (info):** `uninstall` e `init` ficam fora do lock de install e não constam no MAPA.
- **N-3 (info, processo):** quando um segmento do `test:kernel` falha, a cadeia `&&` não roda os segmentos seguintes, e o relatório c8 mostra 0% em massa. Isso parece defeito de cobertura e é só segmento não executado. Sugestão, sem alterar gate: aviso no relatório.

# REVIEW-HA — revisão cética da classificação (onda HA)

Revisor Sonnet isolado, em duas passagens: cega e confronto. Reporta e não corrige. Objeto revisado: a lista de remoção `REMOVAL-SET.txt` (156 arquivos, sha256 `b295257e…8956`) e o método do grafo nos commits `ae717dc0` e `ddde51e9`. Cobertura: 100% dos itens ANDAIME. O prompt exige pelo menos 30%, e todos estão em `.hseos/runs/` ou `docs/audits/`.

## Achados e tratamento

| # | Severidade | Achado | Tratamento | Evidência |
|---|---|---|---|---|
| 1 | MAJOR | `prompts/T1..T7` da run `20261027-1900-audit-fixes` citam `prompts/COMMON.md`, `AUDIT-REPORT.md` e `PLAN.md` por caminho absoluto | **Aceito.** Os três voltaram a ficar; o grafo foi corrigido (achado 5) | `256426b5`; `removable_by_graph: false` nos três |
| 2 | MINOR | `owner-decisions/logs/D2-REPORT.md:30` cita `AUDIT-REPORT.md:125` pelo nome | Resolvido pelo achado 1: o arquivo fica | — |
| 3 | MINOR | `standalone-migration/handoffs/.gitkeep` é citado só pelo glob genérico `!**/.gitkeep` | **Aceito.** O glob genérico deixou de bloquear (`kind: glob-generic`) e o grafo passou a incluí-lo sem edição manual | `256426b5` |
| 4 | NOTE | Citações pelo run-id sem caminho (MAPA:194/198/250, `w5/STATUS.md:542`, `w3/stab2/T1a..T1d`) | Nenhuma protege arquivo removido; registrado no "não prova" da `CLASSIFICATION.md` | passagem 1 do revisor |
| 5 | MAJOR | O grafo descartava tokens que começam com `/` (citação absoluta) | **Aceito.** Rodada de correção 2: normaliza caminho absoluto para dentro do repositório (nome derivado em runtime), reticências por sufixo e glob genérico não bloqueante | `256426b5`; removíveis 155 → 145 |
| 6 | MINOR | Classes que o grafo não vê: run-id nu, reticências e nome de arquivo genérico | Reticências: corrigido (5). Run-id nu e nome genérico: limites declarados na `CLASSIFICATION.md` | — |
| b | NOTE | `.current-run-id` não tem leitor (ponteiro morto). `mcp-hseos-swarm` lê `STATUS.md` (fica em toda run), `WAVE-*` e `PLAN.md`; para runs antigas sem `PLAN.md`, `dispatch_wave` responde "PLAN.md not found" (só histórico). `ado-preflight-gate.sh:37` é advisory | Aceito como está | passagem 1 (b) |
| c | — | Nenhum dos itens é evidência citada por `requirements.json`, `TRACE.json` ou `terminal-readiness.json` | — | passagem 1 (c) |
| d | — | Sem suspeita de segredo (`prompts/E4.md` cita um cabeçalho PEM em contexto de redação, sem valor) | — | passagem 1 (d) |

O revisor aprovou a lista de não citantes: os 12 inventários-instantâneo e os 2 arquivos de exclusão.

## Reconferência do Commander depois da correção

Lista nova: 145 arquivos, sha256 `6bc5af85…fbbb8`, gerada do grafo sem edição manual.

- **Caminho completo.** Para cada um dos 145, um `git grep -l -F` do caminho na árvore inteira, descontando os próprios removidos, os inventários-instantâneo e `docs/hygiene/`: **0 citações**.
- **Caminho relativo à run.** Para cada removido dentro de uma run, um `grep -F` do caminho relativo nos arquivos que ficam na mesma run: 2 ocorrências, ambas **falsos positivos**.
  - `D2-REPORT.md` cita o `PLAN.md` de outra run (`20261020-w5-closeout`, que fica).
  - `WAVE-A-REPORT.md` contém `W4-W8-PLAN.md` como substring.
- **`STATUS.md`.** Toda run de `dev-squad` mantém o seu.

Veredito do revisor sobre a lista original: **APROVADO COM RESSALVAS**. As ressalvas 1, 3 e 5 foram aplicadas; as demais estão registradas acima. A remoção simulada com a suíte completa fica para a HC (seção 5.4 do prompt).

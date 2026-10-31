# R-D3 — Revisão cética de od-d3-adr-accept (commit 1e1e3023)

Veredito: **PASS-WITH-NOTES**. Revisor não editou nada.

## Itens
| # | Item | Veredito | Evidência |
|---|---|---|---|
| 1 | `Accepted — 2026-10-30` + aceite do owner no formato ADR-0048/adr-policy | PASS | Os 4 ADRs têm `## Status` / `Accepted — 2026-10-30` / "Aceite humano explícito do owner (Marcio Hideaki)…", igual ao ADR-0048:3-8. adr-policy §6/§9 exige seção Status com Accepted e aprovação humana. |
| 2 | Histórico preservado | PASS | Cada ADR traz "Histórico de status:" com texto, estado e data originais (0042: 2026-09-24; 0043: 2026-09-25; 0044: 2026-09-25; 0045: Proposed 2026-09-27). Nenhuma informação perdida na comparação com f953992b. |
| 3 | Corpo da decisão intacto | PASS | Os hunks de cada ADR só tocam a seção de status (0042 :2-14, 0043 :2-15, 0044 :1-14, 0045 :2-13). |
| 4 | Índices/MAPA coerentes, sem dupla verdade | PASS-WITH-NOTES | `_INDEX.md` (4 linhas), `docs/evolution/_INDEX.md:18`, MAPA §1 (título, tabela, parágrafo), §5.1 e "Segue com o owner" coerentes. Notas abaixo. |
| 5 | ADR-0046/47/48 e recibos intactos | PASS | `git diff f953992b HEAD --stat` = 7 arquivos; nenhum ADR-0046/47/48, evidence ou .hseos. |
| 6 | Testes e commit | PASS | `test-documentation-neutrality` + `test-agentic-framework-foundation`: 8 pass / 0 fail. Mensagem do commit sem trailer ou menção a IA (grep = 0). Subject ≤100. Não rodei `ci-test-shards verify` (fora do escopo pedido). |

## Achados
1. **Média/baixa — menção viva remanescente que afirma o status antigo:** `docs/evolution/runbooks/fourth-family.md:15` ("ADR-0044 permanece **candidato** (status draft)", citando ADR-0044:3) e `:89` ("Promover ADR-0044 de candidato a aceito (decisão própria)" como proibição). O runbook é operacional e o ADR-0044 agora está Accepted; o `:3` citado também mudou de conteúdo. A spec mandava ajustar menções vivas que afirmam status. O executor não tocou.
2. **Baixa:** `docs/evolution/w4/STATE-LIFECYCLE.md:4` ("ADR-0045 continua Proposed") e `docs/evolution/w4/STATUS.md:10`, `w2/STATUS.md:71`, `w3/CLOSEOUT*.md`, `audit-2026-10-27/CONFORMIDADE-W0-W5.md:117,332` e `docs/decisions/harness-w4-workflow-reservations-intake.md:3`. Em sua maioria são registros datados/históricos (aceitável deixar; w4/STATUS tem nota de histórico). STATE-LIFECYCLE.md não tem marca de data/histórico e pode ler como estado atual.
3. **Baixa:** MAPA §8 tabela não tem linha A-06/ADRs; a única A-06 (:160) é o H-7. Ver confronto.
4. **Informativa:** ADR-0044 ganhou cabeçalho `## Status` (antes era `Status:` em linha), em conformidade com adr-policy §6.

## Confronto das alegações do executor
| Alegação | Resultado | Evidência |
|---|---|---|
| 4 ADRs Accepted com histórico | Confirmada | itens 1-2 |
| ADR-0044 ganhou `## Status` | Confirmada | diff 0044 :3 |
| ADR-0043 frase extra "não certifica capacidades" | Confirmada | "O aceite não certifica as capacidades listadas nas matrizes de evolução." Preserva a restrição do draft original; compatível, não amplia nada. |
| MAPA §8 sem linha A-06/ADRs; A-06 é o H-7; decisão em "Segue com o owner" | Confirmada | grep A-06 em MAPA.md: só :160 (H-7); a linha dos ADRs foi alterada no bloco "Segue com o owner" (:173). Divergência pequena da spec, justificada. |
| prettier de ADR-0042 e _INDEX já falhava no HEAD | Não verificada | Não rodei prettier (sem permissão de escrever/medir alterações; pedido não incluía). Sem evidência contra. |

# R-E8 — Revisão cética do ADR-0050 (commit e6128b0f)

Veredito: **PASS-WITH-NOTES**. Nenhum bloqueador. Sem edição, sem commit.

## Itens

1. **Status e formato: PASS.** Status Proposed, data 2026-10-31, cabeçalho do _TEMPLATE, seções Mitigations e References presentes, Compliance e Alternatives presentes, 8 questões. Linha no `_INDEX.md` coerente com as vizinhas (ADR-0049). Commit com autor Marcio Hideaki e sem menção a IA (0 ocorrências de co-authored/claude).
2. **Níveis L0–L3 vs invariantes do PLAN: PASS-WITH-NOTES.**
   - Cobertos: versões, transporte, autenticação, cobrança, cotas (L0); credencial efetiva comprovada, cota ignorada = desconhecida, sem pool/fallback, segredos fora de artefato (L2 itens 1,3,6); mudança de backend sem reset (seção 4).
   - N1 (média): **"Assinatura primeiro quando oficialmente suportada" e "não reutilizar tokens de assinatura como API genérica" não aparecem em nenhum nível nem nos pré-requisitos da quarta família.** A quarta família é por chave de API; falta a verificação de que a rota de assinatura oficial foi considerada ou não existe.
   - N2 (baixa): "evidência de conformidade" (último item do invariante "Bindings declaram…") não está listada no L0.
   - N3 (baixa): a tabela do L2 exige "jornada com `tools/call` e aprovação" sem condição, enquanto o item 5 da lista diz "quando o binding oferece essa superfície". Texto interno inconsistente; para F17 (model provider) não fica claro se `tools/call` se aplica.
   - Sem contradição literal com o PLAN.
3. **Mapeamento só com status existentes: PASS-WITH-NOTES.** Valores reais do JSON: `deterministic` = verified_w1/w2/w4/w5_scope_only e not_verified_for_evolution; `real_consumers` = verified_installed_local_scope_only e not_verified; `operational` = not_authorized. O ADR lista exatamente esses e não inventa nenhum.
   - N4 (média): `real_consumers` só tem o valor `verified_installed_local_scope_only`. O ADR o usa para L2 de "bindings locais instalados", mas F18 depende da quarta família por API (Gemini), que nunca poderá justificar esse valor. O ADR não identifica esse beco (só trata L3/operational e o W<N> na Q4/Q5). Deveria entrar nas questões.
   - N5 (baixa): o JSON só tem w1/w2/w4/w5 e não w3; a Q4 já reconhece. Mapear F08/F17/F18 (onda 3) para um `w<N>` de outra onda é decisão do owner.
4. **"Nunca certifica": PASS.** Seção 5 cobre stdio/HTTP sintético sem cliente logado, consumidor sintético, inferência por documentação; ainda inclui SDK como fatura, campanha reaproveitada e mock rotulado como real.
5. **Números inventados: PASS.** Nenhum número de cota/custo/validade novo. O US$ 2 aparece só como "valor de referência" da campanha `tools/call`/MRTR do Codex, atribuído ao owner (2026-10-30), e explicitamente não vira teto da quarta família ("a confirmar no aceite"); o US$ 1 do runbook é citado como ponto de partida, não autorização.
   - N6 (baixa): o US$ 2 do Codex não está registrado em nenhum documento do worktree (só US$ 2 por chamada do Claude em w3/CLAUDE-*.md); o ADR não cita fonte. Conferir se foi registrado em STATUS/PLAN pelo Commander. Fato vem da mensagem do lead, não verificável no repo.
6. **Contradição com decisões anteriores: PASS-WITH-NOTES.** Quarta família mantida adiada (Context, Q8); aceite do ADR-0044 não autoriza gasto (igual ao runbook §8); ADR-0046 não é contradito.
   - N7 (baixa): "Extends: ADR-0046 — níveis de certificação por binding" confunde conceitos. ADR-0046 trata de platform bindings (modos de adoção/ECP), não de provider bindings. Trocar o rótulo ou remover da tabela "Affected Standards". ADR-0046 é Accepted e este ADR não deveria sugerir alterá-lo.
   - N8 (baixa): sem tabela do nível atual dos bindings existentes (Codex conta, Claude, ACP, Antigravity local). Não fica dito quais já estão em L2 ao critério do ADR; a afirmação "três ecossistemas em L2" em F18 não é demonstrada (Codex `tools/call` é `NOT_EXERCISED`, logo não passaria no L2 como escrito).
7. **Testes: PASS.** `node --test --test-concurrency=1 test/test-documentation-neutrality.js test/test-agentic-framework-foundation.js` via cg.sh: 8 testes, 8 pass, 0 fail. (`verify --shards 6` fora do meu escopo.)

## Confronto com o resumo do executor
- Níveis L0–L3: confirmado, cumulativos, com ressalvas N1–N3.
- Mapeamento de status: confirmado só com valores existentes; ressalva N4.
- 8 questões para o aceite: confirmado (8 presentes). Faltam: (a) onde `real_consumers` fica para binding por API (N4); (b) tratamento de assinatura-primeiro (N1).

## Questões que o owner deve ver antes de aceitar
As 8 do ADR, mais: (9) como a quarta família por API pode chegar a `real_consumers` se o único valor é `verified_installed_local_scope_only`? (10) a rota de assinatura oficial da família foi avaliada antes de pedir chave de API (invariante assinatura primeiro)? (11) Codex em L2 exige `tools/call` e MRTR: o owner aceita esse nível como padrão para os demais?

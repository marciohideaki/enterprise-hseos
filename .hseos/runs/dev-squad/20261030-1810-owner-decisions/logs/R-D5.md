# R-D5 — Revisão cética do commit 9383f4f5 (ADR-0049)

Revisor isolado; nada foi editado. Base f953992b. Veredito: **PASS-WITH-NOTES**.

## Itens
1. **Status e template: PASS-WITH-NOTES.** `**Status:** Proposed`, data 2026-10-30, Authors/Affects/Supersedes no formato do `_TEMPLATE.md` (igual ao ADR-0048). Nota (baixa): `adr-policy.md` §6 exige "## Status", "Mitigations" e "References"; o template e o ADR usam Status inline e não têm essas seções (riscos estão em Consequences/Risks). Divergência pré-existente entre política e template, mas o ADR não traz "References".
2. **Invariantes: PASS.** Sem contradição literal: kernel fora do Electron (Decisão 5), API + extensão com patches mínimos (1, 2), upstream fixado (2), build descartável (3), instalador independente (1), catálogo redistribuível (4), Linux primeiro (8), rollback/UI (7). Node >=22 do kernel confere com package.json; F25-R1 e "item 5" do PLAN conferem.
3. **Alternativas: PASS-WITH-NOTES.**
   - Theia: ADR-0043 diz "Não adotar Theia" (Decision) e "Theia: substituído por Code OSS" (Alternatives). Confirmado.
   - (média) "ADR-0043 já decidiu" deve citar que o ADR-0043 está como *Draft de rastreabilidade* (seção Status), não Accepted; o ADR-0049 o trata como decisão firme.
   - (média) "Eclipse Theia ou OpenVSCode Server ... Ambos exigiriam reabrir a decisão do plano" é falso para OpenVSCode Server: ADR-0043 e PLAN não o mencionam. O descarte dele repousa só em "orientado a servidor/navegador" (fato externo não verificado e fora das Questões). Ainda diz "alternativa de fallback" no texto, mas a tabela Alternatives o lista como rejeitado: incoerência interna.
   - VSCodium: motivo ("segundo upstream") é argumento de design, razoável; "ciclo próprio de patches" é afirmação externa não hedgeada.
4. **Fatos externos: PASS-WITH-NOTES.** Versão, termos do marketplace e teto/cadência estão como "a confirmar". Não há número inventado. Notas (baixa): "MIT do código do Code OSS" e "termos do marketplace restringem produtos oficiais" aparecem como fato (o segundo é hedgeado em Alternatives, o primeiro não); `product.json` é citado só pelo prompt, não verificado; licença/termos do Open VSX está na questão 4, mas a premissa "Open VSX sem restrição de redistribuição" não é hedgeada na Decisão 4.
5. **G3 e ADR-0006: PASS.** Repositório separado; ADR-0006 citado só em Affects/tabela ("sem dependência de ~/.claude"), uso apropriado e sem contradição. `test/test-package-surface.js` verde com o ADR adicionado (+1 em `.enterprise`, orçamento 472). Observação: o próprio ADR custa 1 entrada no pacote, aceitável.
6. **_INDEX e PLAN: PASS.** Uma linha no fim do `_INDEX` (Proposed, formato das vizinhas); PLAN item 5 passa a citar o ADR-0049 como Proposed. Sem dupla verdade: a linha W6 da tabela ("Nada... nem ADR dessa decisão", PLAN:89) fica **desatualizada** (nota média): ela diz que não há ADR, o que agora é parcialmente falso. Se for tabela de estado histórico (pós-W5) pode ficar, mas o revisor sugere ao owner/executor decidir.
7. **Testes e commit: PASS.** `test-documentation-neutrality.js` + `test-agentic-framework-foundation.js`: 8/8 verdes (Node 24, concurrency 1); `test-package-surface.js` verde. Commit único, mensagem ≤100 chars, sem trailer de IA (a única ocorrência de "claude" é o texto `~/.claude` do ADR-0006). `ci-test-shards verify` não foi rodado por este revisor.

## Passagem 2 (confronto)
Recomendação do executor confirmada: fork do Code OSS em tag fixa + extensão própria (coerente com PLAN/ADR-0043); repositório separado por causa do G3 (válido: G3 sem folga em tools/packages; a opção `files` é refutada com motivo plausível, mas o argumento "infla clones/CI" é opinião, não medição); Open VSX; `UPSTREAM.lock` (nome proposto, não exigido por nenhuma fonte, aceitável); 10 questões presentes. Refutado em parte: "Theia/OpenVSCode ... reabrem o plano" (só vale para Theia) e "ADR-0043 já decidiu" (é Draft).

## Questões para o owner antes de aceitar
- O ADR-0043 é Draft: aceitar o 0049 sobre ele exige aceitar/promover o 0043? 
- OpenVSCode Server fica descartado ou fallback?
- A contingência "só extensão" (questão 10) emenda o PLAN e a invariante "instalador independente"?
- Repositório separado muda o modelo de verificação de F25-R1 (a evidência vive fora deste repo)? Quem guarda o recibo?
- A linha W6 do PLAN:89 deve ser atualizada?

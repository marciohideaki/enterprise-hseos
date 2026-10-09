# REPORT-T2 — Revisão manual do grupo (c) das divergências de modalidade

Run `20261008-2350-next-steps`. Executor: T2 (Sonnet, somente leitura). O harness bloqueou a gravação pelo subagente; o Commander gravou este arquivo a partir do retorno textual.

- Base: `/workspace/default-workarea/ai-governance/db/ai-governance-rules.db`, aberta com `mode=ro`. Snapshot de 2026-09-14.
- Repo conferido: master `b35ac0dc`.

## Decisão do owner (G1, 2026-10-08)

| Grupo | Qtde | Tratamento |
|---|---|---|
| a. MUST×MUST_NOT | 103 | falso positivo de polaridade, aceito |
| b. com INFORMATIVE | 163 | falso positivo de modal fraco, aceito |
| c. demais | 39 | revisão manual (abaixo) |

O Commander recontou de forma independente e confirmou 305 = 103 + 163 + 39, com `sources_csv` casando o token `hseos` exato.

## Resultado do grupo (c)

| Classe | Qtde |
|---|---|
| REAL | **0** |
| CONTEXTUAL | 3 |
| NOISE | 36 |
| GONE | 0 |

**Não há inconsistência normativa real** e não há edição a propor. Todas as variantes hseos continuam presentes no HEAD.

### NOISE: hooks em JSON (22)

1707, 1709, 1711, 1712, 1738, 1739, 1740, 1741, 1742, 1745, 1746, 1754, 1758, 1762, 1768, 1772, 1778, 1787, 1790, 1794, 1807, 1811.

Os locators `:0` estão em `.claude/hooks.json`, `.agents/manifest.yaml`, nos registries de hooks, em `.codex/hseos-hooks.json` e em `.goose/hooks-metadata.json`. São configuração JSON com modal atribuído por heurística, não prosa normativa.

### NOISE: demais (14)

| Id | Motivo |
|---|---|
| 149 | DC-18 diz que a mudança compatível "pode" sair na mesma versão. O MUST vem de um item de checklist sem modal. |
| 847, 907 | O MAY vem de linhas de tabela de ADR sobre o read model. É outro assunto. |
| 1228 | Os MUST são itens de DoD do govos sem verbo modal. Só há uma variante hseos (`sprint-planning/instructions.md:225`, SHOULD). |
| 2817 | O `QUICK.md` do skill é um checklist sem modal. Repete o DC-11, que é MUST. |
| 3201 | Definição de dado pessoal e linha de índice. |
| 4399 | Agrupamento errado: IG-15 do C# trata de retornar null, IG-15 do Java trata de `Optional.get()`. |
| 6166 | FR-28 do React Native trata de leitura offline, tema diferente dos FR-28 das outras stacks. |
| 6932, 7259, 7538 | "No X may …" é uma proibição lida como MAY pela heurística. A força normativa é a mesma. |
| 7764, 7824 | O SHOULD está num parêntese explicativo ou numa descrição de produto. |
| 10262 | O MAY é uma permissão condicionada à aprovação humana, com a mesma restrição da linha G5 (MUST). |

### CONTEXTUAL (3)

| Id | Motivo |
|---|---|
| 4894 | BT-16: lints no Flutter são SHOULD e golangci-lint no Go é MUST. Stacks diferentes. |
| 5663 | TS-01: o formato de nome de teste é MUST em C#/C++ e SHOULD (frase descritiva) em Flutter/RN. |
| 7105 | O checklist de PR do RN verifica o item, mas FA-25 (Flutter) e RN-34 são SHOULD. |

Os três são os casos mais discutíveis entre CONTEXTUAL e REAL. Ficaram em CONTEXTUAL porque são padrões por stack ou itens de checklist sem modal próprio.

## Observações para quem mantém a base (fora do escopo do HSEOS)

- Excluir dos cálculos de divergência os registros JSON de hook com locator `:0` eliminaria 22 dos 39 casos.
- 6932, 7259 e 7538 mostram que `classify.py` lê "No X may" como MAY. Reescrever o texto no hseos seria só cosmético.

## Confiança

**Medido**
- Contagens 305/103/163/39, recontadas pelo Commander.
- Modais, locators e textos das variantes.
- Presença de arquivo e texto no HEAD.

**Inferido**
- A classe de cada regra é julgamento sobre o texto das variantes e as linhas dos locators.
- A causa dos 22 hooks (modal derivado de metadados JSON como `blocking` e da descrição) é inferência. O `classify.py` não foi lido.

**Não verificado**
- As variantes govos e srm, que são de outro corpus.
- 7 das 10 entradas de `.claude/hooks.json` que deram falso negativo por escape não foram conferidas uma a uma com `grep -F`. Foram conferidas 3: `ado-inbox-check`, `code-index-guard` e `telemetry-export-session`.

## SQL

Conexão: `sqlite3.connect('file:…/ai-governance-rules.db?mode=ro', uri=True)`.

```sql
-- 305 regras
SELECT id, modality_divergence, sources_csv FROM canonical_rules
WHERE modality_divergence IS NOT NULL AND (',' || sources_csv || ',') LIKE '%hseos%';

-- detalhe da regra canônica
SELECT id, sources_csv, modality_divergence, statement, modality FROM canonical_rules WHERE id = ?;

-- variantes (todas as fontes; acrescentar AND s.key = 'hseos' para checar presença)
SELECT s.key, r.locator, r.modality, r.raw_text, r.line_start
FROM canonical_variants cv JOIN rules r ON r.id = cv.rule_id JOIN sources s ON s.id = r.source_id
WHERE cv.canonical_id = ? ORDER BY s.key;
```

Bucketing em Python. Os modais de cada regra são `{p.split('×')[0] for p in modality_divergence.split('; ')}`:
- (a) o conjunto contém MUST e MUST_NOT;
- (b) não está em (a) e o conjunto contém INFORMATIVE;
- (c) o resto.

## Fechamento proposto do item 2

A pendência das 305 divergências se encerra:
- os grupos a e b são falso positivo por decisão do owner;
- o grupo c não tem nenhum caso REAL.

A base não é fonte de verdade para gate de governança. Nenhuma mudança no repo é necessária.

# Template — Layout de estado versionado de um grafo de loops (`_graph/`)

Contrato de estado por goal, committado **no repo do projeto** (o motor global permanece sem estado).
Referenciado por goal-graph §7-bis. Regra de precedência: **git (events.jsonl) > SQLite > markdown.**

## Layout

```
<projeto>/_graph/<goal-id>/
  GOAL-GRAPH.md            # contrato humano (emitido por goal-graph)
  workflow.js              # contrato executável (compilado por goal-graph §7-bis)
  BASELINE.md              # âncoras da realidade, versionadas rN
  state/
    events.jsonl           # FONTE DA VERDADE — append-only, nunca editado/reescrito
    checkpoints/<node_id>.json
    STATE.md               # RENDER derivado (nunca editado à mão)
    RESUME-PROMPT.md       # RENDER derivado (retomada em sessão limpa)
  evidencias/              # binários, nomeados <baseline>-<node>-<seq>-<desc>.<ext>
```

Versionamento: **1 iteração = 1 commit** do diretório `_graph/`; **1 camada/wave concluída = 1 tag** (`graph/<goal-id>/layer-N`).

## BASELINE.md (âncoras — padrão RC generalizado)

```markdown
# BASELINE r<N> — <goal-id> · emitido <data> por <quem>
| Âncora | Valor |
|---|---|
| git HEAD do projeto | <sha> |
| imagens/deploys relevantes | <digests> |
| versão de schema/contrato | <versões> |

## Baselines invalidados
- r<N-1>: INVÁLIDO em <data> — motivo: <push/mudança que o invalidou>
```

Regra: mudança em qualquer âncora ⇒ novo rN com invalidação explícita do anterior ⇒ checkpoints com `baseline_ref` antigo **invalidam em cascata** (certificação não atravessa mudança de baseline).

## checkpoints/<node_id>.json

```json
{
  "node_id": "n07-portar-handler",
  "input_hash": "sha256 do input efetivo do nó (prompt resolvido + refs)",
  "baseline_ref": "r3",
  "verdict": "PASS",
  "verified_by": "deterministico:<cmd> | adversarial:<n-votos>",
  "output": { "inline se pequeno" : "…" },
  "output_ref": "path/para/artefato quando grande",
  "cost": { "tokens_in": 0, "tokens_out": 0 },
  "completed_at": "ISO-8601",
  "side_effects": [ { "efeito": "PR aberto #123", "idempotency_key": "…" } ]
}
```

Validade do checkpoint = `input_hash` idêntico **e** `baseline_ref` vigente. Nó idempotente consulta antes de gastar; hit válido ⇒ retorna `output` sem executar. Nó com `side_effects` checa a `idempotency_key` antes de re-executar o efeito (decisão ≠ execução).

## events.jsonl (evento por linha, append-only)

```json
{"ts":"…","kind":"start|checkpoint|verify|gate|baseline|complete|abort","node_id":"…","detail":{}}
```

- `gate`: registra o pedido de autoridade humana e a decisão (quem/quando) — nunca inferida.
- `baseline`: registra emissão/invalidação de rN.
- Espelhar em SQLite via `hseos state-emit` quando o CLI existir no PATH (best-effort; ausência não bloqueia).

## Retomada (qualquer sessão, qualquer momento)

1. Ler `RESUME-PROMPT.md` (render) — dica, não verdade.
2. **Revalidar âncoras** de `BASELINE.md` contra a realidade (git/cluster é a verdade). Divergiu ⇒ emitir novo rN antes de qualquer coisa.
3. Rodar `workflow.js` de novo — nós com checkpoint válido retornam em ms; a execução continua do primeiro nó não-feito.
4. Time-travel: checkout/revert do `_graph/` para a tupla `(contrato, rN, evento)` desejada; `events.jsonl` preserva a história integral.

# Handoff W0 → W1 (ECP foundation)

Pré-condição: owner aceitou ECP Decisions 0006/0008 (0007 segue Proposed) e HSEOS ADR-0046.

Fontes normativas (ler antes de codar):
- ECP `documentation/decisions/0006-contract-authority-and-kinds.md` §2–§10.
- ECP `contracts/capability.contract.v2.schema.json`, `implementations.schema.json`, `capability-registry.schema.json`.
- ECP `tests/fixtures/meta-schemas/vectors.json` — 26 vetores; o validador stdlib da W1 deve dar o MESMO veredito que Python `jsonschema` e Ajv strict.

Regras que o schema NÃO cobre e o validador W1 DEVE implementar e testar:
1. Caminhos relativos: rejeitar absolutos e qualquer segmento `..` (`a/../../x` hoje passa no schema).
2. Datas: calendário real (`2026-02-30` hoje passa no schema).
3. Keyword profile (0006 §5): rejeitar keyword fora da lista, inclusive em schemas de contrato.
4. Versão única: `capability.yaml` == openapi/asyncapi/mcp.
5. Coerência de providers: `capability.yaml` × `providers.toml` × `dispatch.PROVIDER_INVOKERS`.

Ordem W1: T0 loader YAML restrito → T1 validador + migração dos 9 capability.yaml para v2 (`kind: service`,
`compatibility:` → `implementations.json`) → T2 registro (dono único do `ci.yml`) → T3 ∥ T5. T4 em PR separada.

Gotchas:
- `registry.py:24` é parser de linha; `exposure:` é lido errado hoje.
- Testes reescrevem `mcps/ecp.mcp.manifest.json` com caminhos absolutos → restaurar antes do commit até T4.
- Autor: regra vigente `@hideakisolutions.local` até T4 implementar a Decision 0008.
- `test_sdk_generation.py` fixa `capability_count == 9` e muta a árvore.

# R-G1 — revisão cética da task G1 (commit 2350141a)

Revisor isolado. Reporta, não corrige. Nada foi editado/commitado no worktree; mutações feitas em cópia descartável (removida).

## Veredito: APROVADO COM RESSALVAS (nenhum bloqueador; 2 achados MEDIUM, 4 LOW)

Segurança: o schema nunca é mais permissivo de forma que o validador passe a aceitar algo antes recusado. O validador continua rodando depois do adaptador (`packages/governed-execution/runtime.js:256/398` via `contracts.validateInput`). Onde o schema é mais frouxo que o validador, o validador recusa (ver GAPS).

## Passagem 1 (cega)

### Coerência schema x validador (amostragem + sonda de ~35 casos extras)
- Nenhuma entrada que o schema aceita e o validador recusa fora da tabela GAPS, exceto o item L3 abaixo (reason em bytes).
- Schema MAIS restritivo que o validador (validador aceita, schema recusa), reproduzido por sonda:
  - `null` em `source_digest`, `origin`, `trust` (memory.write), `breakpoints`/`capture` (dap.run);
  - `lsp.diagnostics` com `position` (validador aceita; schema, `additionalProperties:false`, recusa);
  - `lsp.*` com `position` contendo campo extra.
  Nenhum é caso legítimo de cliente real; efeito prático é -32602 em entradas esquisitas. LOW.
- Campo a campo `memory.write`, `memory.delete`, `lsp.hover`, `dap.run`: tipos, obrigatórios, enums, limites (ttl 1..7_776_000, line 1..10_000_000, timeout 1000..120000, args<=16/256, breakpoints/steps<=20, capture depth 0..2), regex (id, source_ref, source_digest, module, new_name) e `additionalProperties:false` conferem com `packages/agent-memory/policy.js`, `lsp.js:parseInput`, `dap.js:parseInput`, `computer-contract.js`.

### origin/trust (desvio declarado)
- Confirmado: `origin:'operator'|'agent'+trust:'trusted'|'operator'+'untrusted'` passam no adaptador e são recusados no handler (`operational-runtime.js:350-353`, `MEMORY_WRITE_FIELD_NOT_ALLOWED` ou `AGENT_MEMORY_TRUST_INVALID`); teste F1 (`test-mcp-environment-host.js:~425`) afirma ledger `agent_memory` vazio e retrieve vazio. Nada é gravado.
- Mas o schema publica ao modelo o enum completo (`operator`, `trust:trusted`) que sempre será recusado. Ver M2.

### Efeito colateral -32602
- Ledger/auditoria: nada se perde. `validateInput` roda antes de existir `operationId` e de qualquer evento (`runtime.js:398` precede `:445`); a recusa por tipo antes também não gerava registro. O adaptador também não chama `_reportDenied` para erro de schema (comportamento igual para qualquer ferramenta).
- Códigos documentados mudam para clientes existentes: tipo errado deixa de devolver `AGENT_MEMORY_INVALID`/`AGENT_MEMORY_TTL_INVALID`/`ENV_*_INPUT_INVALID` (resultado de ferramenta) e passa a -32602 só com `{keyword,instancePath}`. Está documentado em `docs/v4-migration.md` como "Behaviour change". OK.
- Matriz W5: 43 mutantes rejeitados, exit 0. Mutantes dos validadores continuam mortos (os testes W5 chamam contratos/serviços, não dependem do adaptador).

### Fallback
- `capabilityToolDescriptors` lança TypeError sem schema; `register()` normaliza `input_json_schema` (null = ausente) e congela. Nenhum caminho do `tools/list` MCP volta ao objeto aberto.
- Débito `environmentSchemaJson` (`tools/cli/lib/engineering-task-extensions.js:207`, usado em `:370`): NÃO é exposto a cliente MCP, mas É exposto ao MODELO. O bundle (`definition.input_schema`) vai para `toolRegistry.register(bundle.definition)` (`temporary-kernel-assembly.js:98`) e o provider envia `parameters: tool.input_schema` (`packages/model-providers/openai-compatible-provider.js:57`). Ou seja, o mesmo defeito (modelo sem tipos) persiste no caminho de tarefas de engenharia. M1.

### Teste novo
- Cobre os 12 contratos (VALID/INVALID por contrato; asserção `ALL.length === Object.keys(VALID).length`), caso da campanha presente (`/scope` e `/ttl_seconds`). 34/34 verdes.
- Registrado em `test:kernel` e TAMBÉM em `test:engineering-task` (o log declara só o kernel). `ci-test-shards.mjs verify --shards 6`: OK, 102 itens, 235 arquivos (o log diz 234).

## Mutações minhas (cópia sob /build/tmp/rev-g1, removida)
- (a) `additionalProperties:true` em `memory.delete`: DERRUBOU o teste (`memory.delete ... invalid inputs`). OK.
- (b) remover `required` do `memory.write`: SOBREVIVEU. Removi, um a um, `ttl_seconds`, `memory_id`, `scope`, `content`, `classification`, `source_ref`: 0 falhas em todas. M1b/M2 abaixo.

## Execuções (cg.sh, Node 24)
- test-capability-input-schemas 34/34; mcp-environment-host + mcp-2026-adapter + agent-memory: 109/109; w5 mutations 43/43.
- c8 por seleção (testes que citam contract-registry/operational-runtime + novo + host, 257 testes verdes): contract-registry 99.75 linhas / 97.84 branches; operational-runtime 98 / 93.82. Acima de 90/80.
- eslint --max-warnings=0 e prettier --check limpos; test-package-surface verde (144/144 no c8 combinado).
- Atribuição de IA: commit sem Co-Authored-By/Generated/menção a IA (grep vazio); autor Marcio Hideaki.

## Achados
- **M1 (MEDIUM) — teste de coerência não detecta enfraquecimento de `required`.** Repro: em cópia, remover qualquer item de `required` do `MEMORY_WRITE_JSON_SCHEMA` (`contract-registry.js` ~L471) mantém o teste verde, pois INVALID só tem `{content:'x'}` como caso de campo ausente. Falta, para cada contrato, uma entrada VALID menos um campo obrigatório por vez (derivável de `required`). Mutação (b) pedida na spec sobrevive.
- **M2 (MEDIUM) — débito `environmentSchemaJson`** (acima): o modelo no caminho de tarefas de engenharia ainda recebe objeto aberto. Fora da spec, mas é o mesmo defeito da campanha; abrir tarefa própria, não "vale tarefa" opcional.
- **L1 (LOW) — schema publica `origin` com `operator` e `trust: trusted`**, valores que o MCP sempre recusa; convida o modelo ao erro. Alternativa: enum só `agent`/`untrusted` (o F1 então teria que aceitar -32602 para operator/trusted). Desvio justificado e seguro; apenas pior para o cliente.
- **L2 (LOW)** — schema mais estrito que o validador em nulls e `diagnostics+position`/`position` com campo extra (sonda acima). Não documentado nos GAPS (que só listam o sentido frouxo).
- **L3 (LOW)** — `memory.delete.reason` com 200 caracteres multibyte (400 bytes) passa no schema e é recusado pelo validador; é o mesmo tipo de lacuna de bytes de `content`, mas não está em GAPS.
- **L4 (LOW)** — `computer.act` fixa x<=639,y<=399 (display padrão), embora `computer.start` aceite até 800x600; coerente com o validador do contrato (pré-existente em `computerActSchema`), mas o host real valida pelo tamanho da sessão (`computer-host.js:311`). Não é regressão.

## Passagem 2 (confronto com logs/G1.md)
- Confirmado: arquivos/decisões, mutações 1-2 do executor, matriz W5 43/43, c8 99.75/97.84, shards OK, eslint/prettier limpos, atribuição limpa.
- Refutado/ajustado: (i) "registrado no test:kernel" omite que também entrou em `test:engineering-task`; (ii) contagem 234 vs 235 arquivos; (iii) débito descrito como "caminho de tarefas, não o tools/list MCP" subestima: o schema aberto chega ao modelo; (iv) as duas mutações do executor não incluem a da spec (b, remover `required`), que sobrevive.
- Não verificado: test:kernel completo (não rodado, por regra de carga); gate c8 global.

## Reconferência rodada 1 (commit b554a38f, amend de 2350141a)

Veredito: **APROVADO**. M1 e M2 resolvidos; nenhum achado novo acima de LOW.

1. **M1 resolvido.** Mutação (b) em cópia descartável, um `required` por vez no `memory.write`: `scope`, `content`, `classification`, `memory_id`, `source_ref`, `ttl_seconds` e `scope.project_id` derrubam o teste (fail 1 em todos). `additionalProperties:true` no `memory.delete` também derruba. A lista REQUIRED é escrita à mão a partir dos validadores, não lida do schema.
2. **M2 resolvido.** `environmentSchemaJson(contract)` (`engineering-task-extensions.js:207`) devolve `contract.input_json_schema` a `definition.input_schema` e, dali, ao `parameters` do provider. O teste novo em `test-engineering-environment.js` compara os 14 bundles com o contrato, exige `properties` e proíbe `additionalProperties:true`. `ENVIRONMENT_CAPABILITY_SCHEMA_MISSING` não derruba tarefa legítima: os contratos vêm de `ENVIRONMENT_CONTRACTS`/`CAPABILITY_CONTRACTS`, que são arrays estáticos congelados, e o teste da G1 exige schema nos 14. O erro só dispara em corrupção de código, como o `ENVIRONMENT_CAPABILITY_REGISTRY_DRIFT` vizinho.
3. **Escopo do afrouxamento.** Só afrouxou onde o validador aceita: `null` é lido como omitido (`??`) em `source_digest`, `origin`, `trust`, `breakpoints`, `steps`, `capture`, `timeout_ms`, `target.args`, `display`; `position` sem `additionalProperties:false`. Sonda com 27 casos (nulls em campos obrigatórios, enums inválidos, `position` negativa ou fracionária, `[null]` em listas, `display.width` nulo, `target` nulo): nenhuma nova entrada recusada pelo validador passou no schema. Resíduo único: `origin:null + trust:'trusted'` passa no schema e o validador recusa (`AGENT_MEMORY_TRUST_INVALID`), a mesma classe de lacuna cruzada origin x trust já presente em GAPS. Ainda mais estrito que o validador: `position:null` e `position` malformada em `diagnostics` (`position:'x'` está documentado no teste). LOW, sem efeito prático.
4. **Execução (cg.sh, Node 24):** novo teste, `test-engineering-environment`, host, adapter, agent-memory, `test-environment-production-callers` e package-surface: 214/214; `check-w5-mutations`: 43/43; `verify --shards 6`: OK (102 itens, 235 arquivos); eslint `--max-warnings=0` e prettier limpos; sem atribuição de IA no commit.

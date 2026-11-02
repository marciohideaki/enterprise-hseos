# R-B3 — Revisão cética do commit 0271c40a (F14-R1, memória no contexto)

**Veredito: APROVADO COM RESSALVAS.** Nenhum FAIL de segurança. Um achado MÉDIO (runbook promete caminho inalcançável) e dois menores.

## Passagem 1 (cega)

1. **Opt-in (crítico) — PASS.**
   - `memory` em `createTaskEnvironment` vem de `host.memory` (engineering-task-extensions.js ~:527), nunca do contrato da tarefa nem do modelo.
   - O contrato só fornece `environment.memory.rules/operator`; o schema do `environment:` é `.strict()`, então YAML não injeta `include_untrusted`. O construtor do host de produção (~:535) não define o campo.
   - `memory.retrieve` do modelo com `include_untrusted: true` é recusado (`AGENT_MEMORY_UNTRUSTED_FORBIDDEN`, :348).
   - A memória que entra vem com `trust: untrusted` e `authority: data`; o teste afirma ambos e o bloco `MEMORY_DATA`.
2. **Ledger — PASS.** `payload.sources` (sourceRecord do assembler) traz source_ref, origin, trust, authority, digest. O digest do teste é `sha256Text(NOTE)`, ou seja, do conteúdo que entrou. O `memory_id` sai de `memory://<proj>/<id>` (não é campo próprio). É derivável com o regex do teste, mas ambíguo se `project_id` contiver "/" (não verifiquei se o domínio proíbe).
3. **Teste de jornada — PASS.** Servidor MCP real (processo filho), `project.db` ativado em fixture sob TMPDIR, os 3 casos exercitam comportamento real, só o modelo é scriptado. Registrado em `test:kernel` (antes de test-mcp-transport-robustness). `verify --shards 6`: OK, 103 itens.
4. **Cobertura — a alegação do executor está ERRADA, sem dano.** `engineering-task-extensions.js` ESTÁ no gate (glob `tools/cli/lib/engineering-*.js`). Medi c8 com journey + task-extensions + environment + production-host + mcp-environment-host + agent-memory: **100% linhas / 94,98% branches / 96,38% funcs** (≥ 90/80).
5. **Mutações (cópia sob /build/tmp/rev-b3, removida) — PASS.** Baseline 3/3.
   - (a) `include_untrusted: true` fixo: derruba "sem opt-in" (2 pass/1 fail).
   - (b) `AUTHORITY='instruction'`: derruba 2 testes (1 pass/2 fail).
   - Limite: não existe mutação "aceitar do contrato", porque o contrato não tem caminho para o campo; a mutação (a) é o equivalente mais próximo. Não há teste novo para a recusa em :348 (cobertura de linha não acusou o ramo como descoberto).
6. **Runbook — ressalva.** F14 é honesto sobre o que foi provado (automatizado) e marca o consumidor real como "pendente, nunca PASS". Neutralidade passou (`test-documentation-neutrality`). Veja o achado M1.
7. **Execução (cg.sh, Node 24):** journey + test-agent-context* + test-agent-memory* + test-mcp-environment-host + neutralidade + package-surface: **121 pass / 0 fail**. eslint e prettier limpos nos arquivos tocados. Sem atribuição de IA no commit.

## Achados

- **M1 (médio) — runbook F14, passo 3.** Manda rodar "com o host declarando `memory.include_untrusted: true`", mas nenhum host de produção nem a config `environment:` (strict) consegue declarar isso; só host de teste programático. A campanha com cliente real, como escrita, não é executável. O executor admitiu "sem wiring de config" no log, mas o runbook não diz. Corrigir o texto (declarar a limitação) ou decidir o wiring (decisão do owner).
- **m1 (menor)** — log do executor erra sobre o gate c8 (acima); sem impacto.
- **m2 (menor)** — `memory_id` não é campo próprio do registro; o requisito do prompt pedia "memory_id" por memória. Aceitável por derivação, mas deve constar no recibo que ele é derivado.
- **m3 (cosmético)** — helper `arguments_key` do teste tem nome fora do padrão camelCase e fica solto entre comentários.

## Passagem 2 (confronto com logs-wb/B3.md)

Confirmadas: proveniência pré-existente, vermelho/verde 2/1→3/3, mutações do executor, eslint/prettier/verify. Refutada: "engineering-task-extensions não está no .c8-kernel.json". Omitida pelo executor no runbook: a inalcançabilidade do opt-in (M1).

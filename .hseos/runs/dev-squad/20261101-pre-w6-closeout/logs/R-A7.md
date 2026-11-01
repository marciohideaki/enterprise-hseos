# R-A7 — revisão cética do commit 37825ebe (A7)

Veredito: APROVADO, com 3 observações não bloqueantes. Revisor reporta; nada foi editado.

## Passagem 1 (cega)
1. Runbook fiel ao ADR-0050: teto 4 req / US$ 1,00 (1.000.000 µUSD) / até 45 min com "menor sim, maior exige decisão nova"; `google/gemini-hseos` com chave da NB Eventos proibida e `google/gemini-api-key` substituída; "assinatura primeiro" (seção 3, pré-condição 3, BLOCKED); autorização do owner por campanha (status, seção 4, seção 8, seção 9); critério de aceite (L2, custo <= teto, revisão cética em duas passagens); estado da chave "ainda não existe" em 2026-11-01. Nenhuma decisão inventada; sem "PROPOSTO" nem `gemini-api-key` residual como vigente.
2. Binding: `operational: false`, `authorized: false`, `a confirmar na campanha` em adapter, versões, modelo, endpoint, plano e reserva; sem valor de segredo. Só `secret_refs.source_ref: secret://google/gemini-hseos` (referência por nome, consistente com a regra). `readProviderBinding` recusa com `PROVIDER_BINDING_INVALID` (confirmado). Nenhum teste/runtime varre o diretório: todos os testes e `agent-provider-conformance.js` abrem arquivos nomeados (openai-compatible, codex-app-server, claude-agent-sdk, terceiro-acp-tool-free). A recusa não quebra nada.
3. Commit: 12 arquivos; PLAN.md e prompts/ entraram; de logs/ só A7.md. Untracked fora do commit: logs/A3.md e R-A3.md. Neutralidade verde, sem fornecedor restrito.
4. G3: `git ls-files .agents` = 204 contra orçamento 205; test-package-surface passa. Folga de 1 apenas.
5. Execução (cg.sh, Node 24, todos exit 0): neutrality 2/2; agent-provider-binding 13/13; agentic-framework-foundation 6/6; package-surface 1/1; `ci-test-shards.mjs verify --shards 6`: OK 102 itens; prettier --check verde nos arquivos do commit.
6. Atribuição: mensagem sem trailer nem menção a IA.

## Passagem 2 (confronto com logs/A7.md)
- Confirmado: validador recusa o arquivo; nenhum teste varre o diretório; 20 pass (13+6+1); verify exit 0 (102 itens); prettier verde.
- Desatualizado no log: o título diz "no worktree, não commitado" e a neutralidade consta VERMELHA com bloqueio em PLAN/A1. Hoje está verde (2/2) e o commit existe; o log não foi reescrito após o desbloqueio. Cosmético.

## Observações (não bloqueantes)
1. Formato do binding diverge dos exemplos: sem `profile_id`, e esquema próprio (`route`, `auth`, `billing`, `quota`, `budget_default`) que o validador estrito não conhece. Coerente com o declarado "somente declaração até a B1", mas a B1 precisará ajustar o esquema ou este arquivo.
2. `source_ref` usa esquema `secret://`; os exemplos usam `env://`. Confirmar na B1 que o esquema é aceito.
3. Folga de 1 entrada em `.agents` (204/205): qualquer novo arquivo no pacote estoura o G3.

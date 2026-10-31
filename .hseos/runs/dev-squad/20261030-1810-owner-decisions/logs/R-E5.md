# R-E5 — revisão cética de f5ad2c56 (od-e5-computer-image)

Veredito: PASS-WITH-NOTES

## Itens
1. Ausência de sinal de imagem — CONFIRMADO. `mcp-2026-adapter.js` só exige `capabilities.elicitation` (objeto) e valida a elicitação como `mode: form` com `message` string + `requestedSchema`; `grep image` no adaptador e em `native-mcp-server.js` = 0. Nenhum sinal utilizável; o fail-closed não é mais restritivo que o necessário. Entrega 2 do prompt (incluir imagem) corretamente omitida e registrada em v4-migration.md.
2. Cobertura — OK. contract-registry.js:431-476: screenshot (read_only, sem aprovação), start (irreversible, aprovação genérica, sem screenshot ainda), act (irreversible, aprovação), stop (idempotente, sem aprovação). Só `act` tem digest de screenshot em `describe()`; é o único coberto, e é o correto. NOTA (baixa): `start` continua pedindo aprovação humana mesmo quando `act` será sempre recusado; operador aprova um start que não leva a nenhuma ação. Inofensivo, mas incoerente.
3. Ordem — OK. operational-runtime.js:234-245 lança antes de `host.computer.requestApproval` e antes de montar a mensagem; `preApprovalRefusal: true` faz o adaptador (mcp-2026-adapter.js:962-966) devolver envelope de falha sem abrir elicitação. Código estável `ENV_COMPUTER_IMAGE_APPROVAL_UNSUPPORTED`. Teste assere sem requestApproval/approve/act.
4. Override — PARCIAL (NOTA média). Só `=== true` literal; teste cobre undefined/false/'true'/1. Mas: (a) a docs citam `environment.computer.allow_digest_only_approval` como chave de config; o `environmentConfigSchema` (engineering-task-extensions.js:669, strict) NÃO tem essa chave, então o operador só configura compondo o host em código — a doc promete uma chave que é rejeitada. (b) `createProductionEnvironmentHost` não expõe o override nem `computer`; nenhum composer de produção define `host.computer`, logo `act` já era `capabilityUnavailable` ("host has no computer") antes desta task. Computer-use em produção já estava efetivamente desligado; a task não muda isso. Decisão do owner: se quer chave de config real (schema + parse + teste), ou corrigir a doc para "membro do host, sem chave de config".
5. Testes existentes — OK. Diff de test/ só adiciona `allow_digest_only_approval: true` em 3 hosts de fixture (journey + 2 em governance) e 2 testes novos; nenhum assert removido/enfraquecido. A jornada continua provando o fluxo real com o override.
6. Mutação própria — OK. `!== true` -> `!host.allow_digest_only_approval` (aceita truthy) em cópia sob /build/tmp/rev-e5: o teste novo "computer.act is refused before anyone is asked..." falha (✗), arquivo vermelho.
7. Verdes — OK. cg.sh: 5 arquivos pedidos 129 pass/0 fail (o "184" do executor é de lote maior; não reproduzi esse lote); check-w5-mutations 43 rejeitados/0 falhas, exit 0; eslint rc 0; prettier limpo nos 5 arquivos. c8: operational-runtime.js está em .c8-kernel.json:62 (no gate); não reexecutei c8, 97,78/93,2 do executor não verificado por mim.

## Confronto (passagem 2)
- Recusa padrão, override literal, mutação morta, checker 43/0: CONFIRMADOS.
- Restore de mutação: `git show HEAD` sem `if (false)` (0 ocorrências); commit sem atribuição de IA. CONFIRMADO.
- Vermelho 31/1, verdes 32/0 e 5/0, lote 184/0, c8: não reproduzidos/verificados individualmente (129/0 no meu lote).

## Decisões para o owner
- Chave de config real para o override, ou corrigir a doc (achado 4a).
- Aceitar que computer-use em produção segue desligado (já estava; não é efeito desta task).
- Opcional: recusar também `computer.start` sem override para coerência (achado 2).

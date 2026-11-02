# R-B6 — revisão cética do commit 601a9800 (promoção de memória pelo operador)

Veredito: PASS-WITH-NOTES

## Passagem 1 (cega)
1. Anti-falsificação pelos caminhos pedidos (a)-(f): nenhum funciona.
   - (a) `write()` rejeita campos fora de ENTRY_INPUT_FIELDS e sempre grava `rule:<id>` (admitWrite); `operator:promote` só sai de `promote()`.
   - (b) MCP memory.write não leva campos de promoção (campo desconhecido é recusado); `memory.promote` não existe em nenhum registry/tools/list.
   - (c) aprovação consumida na mesma transação do append (`_withApproval`); (d) operation_id inclui projeto, memória e digest; (e) digest conferido contra o conteúdo guardado, ledger append-only, CAS por versão; (f) `promote` é código de host, sem tool, sem contrato, sem environment.
2. authority.js: a exceção exige camada memory, autoridade data, origem memory, trust trusted e passos `memory.write.operator` + `memory.promote` com input_digest igual ao digest. Outras camadas e outros `trusted` continuam recusados; autoridade nunca vira instruction.
3. Mutante `memory_trust`: mesma propriedade (memória não promovida não vira trusted), âncora agora na expressão `promoted ? 'trusted' : 'untrusted'` trocada por `entry.trust`; matriz continua com 43 mutantes, 43 rejeitados, 0 falhos, exit 0. Não ficou mais fraca.
4. Sem migration: diff vazio em `tools/mcp-project-state`; nenhum tipo de evento novo (usa memory.written + memory.superseded).
5. MCP: sem promoção no tools/list; `memory.retrieve` como tool segue `untrusted` (boundary 'tool' por padrão).
6. CLI: exige --operator e confirmação (TTY ou --yes + --content-sha256). Mora em agent-activation-rehearsal.js como companion `memory <action>`; o nome do arquivo é fraco para o assunto, mas cumpre o teto G3; manifesto regenerado e `check:cli` verde.
7. Mutações próprias (cópia sob TMPDIR, removida): (a) authority aceitando trusted sem prova -> 2 testes caem; (b) promote sem varredura de credencial -> 1 teste cai.
8. Execução (cg.sh): 132/132 nos testes de memory, context, mcp-environment-host e journey; c8 authority 94.18/98.36, policy 100/99.11, store 100/98.51, memory-context-source 100; eslint e prettier nos arquivos tocados limpos; neutralidade e package-surface verdes; mensagem do commit sem atribuição de IA. `verify --shards 6` NÃO foi reexecutado por mim (custo); confio no log do executor.

## Achados
- NOTA 1 (maior das notas, defesa em profundidade): a prova de promoção em authority.js é auto-declarada (ids de transform + digest). Provei com um script de leitura que uma fonte v2 forjada na camada memory com `trust: trusted` e os dois passos é aceita como trusted. Hoje só código de host alimenta `input.memory` (compositor e store; a ponte axon fixa `untrusted`), então nem o modelo, nem o MCP, nem o contrato alcançam isso. Mas a barreira real é "quem produz a fonte", não a verificação. Recomendo registrar como débito ou amarrar a prova ao ledger (verificar o evento) antes de abrir qualquer produtor novo de fontes de memória.
- NOTA 2: o "humano" é declarado. `--operator <id>` é livre e `--yes --content-sha256` emite a aprovação a partir do próprio CLI; um agente com shell e acesso ao project.db poderia rodar o comando. Conforme a spec (confirmação interativa ou --yes), mas vale registrar no runbook que o gate é o acesso ao CLI/DB.
- NOTA 3: desvio parcial da entrega 3: no `context.assembled` aparecem source_ref `...:promoted`, trust trusted, authority data e digest; `promoted_by`, `operation_id` e a origem `agent` ficam no ledger agent_memory, e a entrada promovida tem `origin: operator` (a origem agent só está no registro substituído). O executor declarou isso no log.
- NOTA 4: o executor admite que o vermelho-primeiro não foi feito literalmente; a eficácia foi provada por mutação (8/8 mortas, confirmei 2).
- NOTA 5 (baixa): o id `<memoria>:promoted` pode ser pré-ocupado por uma escrita de agente, o que faz a promoção daquela memória falhar com DUPLICATE (negação pontual, não escalada).

## Passagem 2 (confronto com logs-wb/B6.md)
Alegações confirmadas: matriz 43/43 exit 0, sem migration, sem arquivo novo, c8 bate, 8 mutações (2 reproduzidas). A alegação de anti-falsificação vale para os caminhos de modelo/MCP/contrato/environment; não vale como propriedade da camada authority isolada (NOTA 1).

## Reconferência rodada 1 (ceb70ff5)
Veredito: PASS (nota 1 resolvida no produtor; resta defesa em profundidade no authority).
- Nota 1: `retrieve` só marca `trusted` se `_isAttestedPromotion` passar (forma + memória substituída existe + promotion/approval_id + operation_id do evento == operação de promoção + `execution_approval_uses` JOIN `execution_approvals` na MESMA operação, decision approved). Sem hook de atestação, nada é trusted (fail closed). Os dois produtores de produção (`engineering-task-extensions.js` :826 e :973) passam `db`; não há outro `new MemoryStore`/`createGovernedMemory` fora do `openOperatorMemory`, que também atesta. Há teste de evento forjado sem aprovação consumida. Meu script de fonte forjada no `authority.js` ainda é aceito (a exceção continua só de forma), mas nenhum produtor emite essa fonte; está documentado como defesa em profundidade.
- Nota 5: `write()` recusa sufixo `:promoted` (AGENT_MEMORY_ID_RESERVED), todo caminho de agente/MCP passa por `write()`. Sem DUPLICATE em `promote()`: o original precisa estar ativo e a escrita usa CAS por versão; a segunda promoção do mesmo original é impossível (original fica superseded).
- TTY: sem TTY recusa mesmo com `--yes`. Nenhum CI/journey/automação do repo chama `memory promote` (só os testes dele, ajustados com `interactive` injetável + spawn real que verifica a recusa). Efeito: o `--yes` só vale dentro de um TTY; a campanha F14 precisa do terminal do owner.
- Docs: runbook F14 e `v4-migration` descrevem sufixo reservado, atestação, TTY e o limite residual (pseudo-terminal com acesso ao DB).
- Execução (cg.sh): 144/144 nos testes de memory, context, mcp-environment-host, journey e production-callers; check-w5-mutations 43/43 exit 0; check:cli, eslint e prettier limpos; c8 authority 94,18/98,36, policy 100/99,11, store 100/97,97, memory-context-source 100.

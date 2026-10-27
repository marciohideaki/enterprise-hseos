# STATUS — pendências W0–W5 (P2 e P3)

| Task | Commit | Revisão | Estado |
|---|---|---|---|
| T-1 CLI execution-activation | c5e22ebb | rev-t1 (2 passagens) | APROVADO-COM-RESSALVAS (baixas); INTEGRADO a57fd0ed |
| H-2 handle() sem error.message | 4a6f0b21 | rev-h2 (rigor escalado): APROVADO-COM-RESSALVAS (M1, M2 médias; L1 baixa) | rodada 1 aplicada (b3e8b400); reconferência APROVADO-COM-RESSALVAS (B1-B4 baixas/info); a integrar |
| T-3 K9 com/sem cgroup | ee5c38a8 -> 224ecdae (amend, rodada 1) | rev-t3 (2 passagens + reconferência) | APROVADO; integrando |
| T-6 varredura pids_max | 9af7d352 -> a4d67442 -> ecb7f3f4 (2 rodadas) | rev-t6 (2 passagens + reconferência) + validação do Commander | APROVADO; integrando |
| T-5 mutantes sem detecção | 6e0c4e56 -> 27a8f56e (rodada 1) | rev-t5 (2 passagens + reconferência) | APROVADO-COM-RESSALVAS; integrando |
| H-4 max_tokens mínimo | 93ce4cf7 -> b0c08561 -> 70c89507 (2 rodadas)| rev-h4 (2 passagens + 2 reconferências, rigor escalado)| APROVADO-COM-RESSALVAS (só baixas); integrando |
| H-7 escopo/N1/command_checks | — | — | pendente |
| H-9 PEM multilinha | 435fa42b -> a1d21784 (rodada 1) | rev-h9 (2 passagens + reconferência, rigor escalado)| APROVADO-COM-RESSALVAS (só baixas); integrando |

## Achados fora do escopo (a decidir pelo Commander/owner, não corrigidos nesta run)
- **A1 (info, produção):** `tools/mcp-project-state/lib/operational-state-db.js:529` grava o receipt como `<stamp>-project.db.receipt.json`, mas o rollback (`:727`) procura `<backup>.receipt.json`. Com só `--backup`, o rollback não cruza o receipt (`readReceipt` devolve null). Descoberto pela revisão do T-1. Corrigir muda comportamento de produção da ativação: levar ao owner.
- **A2 (média, produção):** `tools/lib/mcp-2026-adapter.js:937-941`: `data.issues` do Ajv no ramo do `outputSchema` leva nomes de chave vindos da saída da tool ao cliente (na sonda do revisor, `sk-SECRET-key-name` apareceu). Corrigir muda o formato do envelope de erro; fica para o Commander/owner (follow-up do H-2).
- **A3 (info):** `packages/agent-environment/browser.js:19` tem `pids_max: 256` literal igual ao teto da faixa; se o teto baixar, o perfil do navegador falha só em runtime (achado do T-6; exceção justificada no teste).
- **A4 (info):** erros com `code` string mas sem `outcome` (ex. `TASK_NOT_FOUND`, `tools/mcp-project-state/index.js:190`) passam a responder `Internal error` com o H-2; confirmar que nenhum cliente depende da mensagem original.
- **A5 (baixa):** `tools/cli/lib/engineering-task-extensions.js:421` e `:557` lançam `Error` com `outcome:'failed'` sem a nova classe `GovernedRefusalError`; se um dia cruzarem o adaptador MCP, o cliente recebe `Internal error` (achado do H-2; sem consumidor conhecido).
- **A6 (info):** `packages/governed-execution/canonical-envelope.js` fora de `.c8-kernel.json`: o gate de cobertura não mede a classe nova (decisão do owner sobre o conjunto do gate).
- **INCIDENTE (processo):** o revisor rev-h9 relatou ter usado `pkill -f` amplo para abortar uma rodada, o que pode ter derrubado testes de outros agentes. Conferido às 2026-10-24 ~00:46Z: os jobs do T-5 (reconferência) e do H-4 (correção) seguem vivos; nenhuma perda visível. Regra anti-`pkill` amplo adicionada ao `prompts/COMMON.md`. Se algum agente reportar falha estranha de teste interrompido, repetir a rodada dele.
- **A7 (média, pré-existente):** `test/test-mcp-hseos-swarm-scope.js` sai com código 0 e sem a linha de contagem em Node 22 (o servidor filho não carrega `better-sqlite3`, o fluxo nunca termina e o processo sai em silêncio) e ficou VERDE com a mutação `mcp_run_id` aplicada. No CI atual o Node 22 roda só o subconjunto em PR, mas o agendamento noturno roda a suíte completa nele: o teste não protege nada lá (achado do T-5).
- **A8 (info):** equivalentes da triagem T-5 sem lugar durável além do corpo do commit: P04, M21, `toLowerCase` de `browser-contract.js:71`, `assertOpenedInside`, `dap_survivor`; M18b/N5 inexistentes; P01/P04/P06/M03, M04/M24/M22/M01/M07/M21, T01/T06/T07 reconstruídos. Levar ao MAPA/registro de resíduos ao fechar a onda.
- **A9 (info):** a mensagem do commit do T-5 diz "28 -> 42" e o arquivo roda 44; `run_scope_nofollow` rotulado M03 no commit (o STATUS lista M03 como equivalente); a frase "allowlist is lower-case" não é garantida (parseAllowlist aceita `[^:]+`). Sem impacto no código; o merge da feature será squash com corpo corrigido.
- **A10 (baixa, limitações conhecidas do H-9, documentadas):** (a) Ed25519 PKCS8 de UMA linha escapa (indistinguível de digest); (b) uma linha final com < 16 caracteres fica no texto (ex.: `og==` de P-521 PKCS8; linha de CRC `=y+N9` do PGP: 4 a 5 caracteres do fecho); (c) EC P-256 com a primeira linha cortada deixando 3 linhas (39/64/36) escapa; (d) testes só usam corpos sintéticos (falta fixture de chave real montada em partes); (e) `containsCredential` em `campaign-evidence-store.js`, `engineering-task-runtime.js` e `platform-bindings.js` não usam a heurística (decisão do executor, para não bloquear saída de modelo legítima); (f) blocos base64 legítimos de 3+ linhas agora somem do diagnóstico (só o bloco), melhor que descartar o tail inteiro.
- **A11 (baixa, H-4, a registrar no MAPA):** (a) dívida 18 REDUZIDA, não fechada: faixa opaca residual medida = 752–753 tokens acima do piso (schema 1) e 2359 (schema 2, binding/plugin model); extensões, ambiente e memória não medidos; (b) mutação sobrevivente em `tools/cli/lib/engineering-control.js:362` (tirar `admission &&` do recheck do binding não quebra teste: falta teste de `admitCreation(..., {admission:false})` com binding e `max_tokens` baixo, ou seja, claim/recovery de job antigo); (c) precedência de erros no control `create` mais larga que a documentada: `responses`+`binding_id` com `max_tokens` abaixo de 12486 agora devolve o erro do piso em vez de `CONTROL_MODEL_CONFLICT`; binding inexistente e pin de plugin inválido ficam mascarados pelo piso abaixo de 4292; (d) o recheck do plugin ocorre depois de `prepareTaskPluginModel` e `createTaskExtensions().close()` (trabalho extra, sem vazamento); (e) o doc cita 3712 como piso de reserva 1, o que vale para o schema 1 (schema 2 do fixture: 4292).

## P4 e fechamento (2026-10-27)

| Task | Commit | Revisão | Estado |
|---|---|---|---|
| H-7 escopo/N1/command_checks | d2180192 | 2 passagens + reconferência | INTEGRADO; PR #252 mergeada |
| M-8 lock de install concorrente | e332b8d6 | 3 passagens (reprovado 1x por corrida no takeover; corrigido) | INTEGRADO; PR #253 |
| M-10 supervisor de suítes | e8c626b2 | 2 passagens + reconferência | INTEGRADO; PR #253 |

- PR #253 mergeada em 863fec28 (squash, CI 24/24, `CLEAN`). Tags locais `hseos-pend-p2`, `p3` e `p4`.
- Resíduos da P4 e do H-7 em `docs/evolution/pendencias-w0-w5/MAPA.md` §6 e §7.
- Incidente: versão intermediária do M-10 sem comparação de token derrubou sessões do usuário (22:10:54 e 22:17:31); corrigido com comparação exata, `protectedPids()` e teste de regressão.
- Pendente: primeiro run noturno do CI com o supervisor; decisões do owner listadas no MAPA §5.

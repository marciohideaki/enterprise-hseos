# R-D4 — revisão cética de od-d4-operational (commit 8a84d1ab)

Veredito: **PASS-WITH-NOTES**. Nenhuma edição, commit ou stash no worktree; recibos e project.db real não abertos.

## Passagem 1 (cega)

1. Cobertura: a tabela do documento novo tem as 27 linhas (F01..F27) e o teste novo exige uma linha por família. Veredito: OK, com nota N1.
2. Candidatas (sem abrir o project.db real):
   - F16 (replay/persistência): MANTER. O recibo `step1b-activation-receipt.json` prova só a migração v4→v17 e o backup. Replay/cursor exercido sobre o banco ativado não existe nos recibos nem em w10/evidence (K3 e K7 usam banco copiado ou descartável). Promover só dependeria de evidência hoje inexistente, provavelmente no project.db real (fora de escopo).
   - F19 (estado/observabilidade): MANTER. O gap da própria família diz "ativação operacional pendente" e o MAPA §2 W1 registra "sem consumidor real". Há componente e recibo (condições 1 e 2), mas nenhuma prova de duas interfaces consultando tarefa/orçamento no projeto ativado.
   - F20 (MCP): MANTER, é a mais próxima. O WINDOW-SUMMARY prova que os serviços sobem em modo moderno e que o config.toml do Codex aponta ao release novo. Mas K7 diz "Todos os bancos, configs e CODEX_HOME são descartáveis"; K7 critério (d) registra Codex `tools/call` NOT_EXERCISED; K10 (503 PASS) usa banco descartável sem cliente real; PLAN "Pendências" item 1 pede consumidor real de F20. Depende de ler o project.db real ou logs do servidor para ver `tools/call` de clientes reais após 22/10.
   - F21 (perfis): MANTER. O verification.json só cobre `init --help` e governance-context; o gap pede ensaio de perfil novo/atualização/rollback.
   - Outras: F01/F11 (watchdog e hooks não estão em `implementation`; confirmado em requirements.json: nenhuma implementation referencia liveness, hooks ou activity-coordination), nenhuma candidata a mais.
3. Guard: 12/12 verdes em `cg.sh` (kernel-quality-surface + documentation-neutrality + package-surface). Mutações em cópia sob /build/tmp/rev-d4 (removida): M1 remover a exigência de evidência => teste derruba (fail 1); M2 alargar o enum com valor livre => derruba (fail 1); M3 promover F19 sem evidência => derruba; M4 evidência inexistente => derruba; controle M5 promoção com evidência existente => passa (2/2). Guard OK, com nota N2.
4. Docs: STATUS.md (parágrafo "Atualização (2026-10-30)" sem reescrever histórico), MAPA §3, §5 item 7 e §8 A-07 coerentes com o resultado (nenhuma promovida). Sem dupla verdade: requirements.json inalterado e todas as 27 seguem `not_authorized`. OK.
5. Recibos: nenhum arquivo do diretório 795e6540… com mtime posterior a 2026-10-24; commit só toca 4 arquivos (STATUS, revalidação, MAPA, teste). OK. O project.db do checkout principal tem WAL em escrita ativa por hooks vivos; não é do executor.
6. Commit sem atribuição de IA (0 ocorrências de claude/co-authored/generated); worktree limpo; mensagem de 77 chars.

## Notas
- N1: a spec pede `evidência (arquivo/recibo:linha)`; a tabela traz arquivos sem linhas e "—" em 20 famílias (justificado por "nenhum componente ativado liga à implementação"). A coluna "Componente ativado" afirma ausência sem citar a lista de componentes cruzada com `implementation` (o parágrafo C3/C4 cobre só hooks/watchdog). Nota menor.
- N2: o guard só exige que a evidência seja um arquivo dentro do checkout; aceita qualquer arquivo (M5 aceitou STATUS.md como "prova"). Não valida conteúdo/recibo. Aceitável pela spec ("caminho resolvível"), mas fraco como prova.
- N3: F20 cita "WINDOW-SUMMARY (hseos-governance em :3101)": o resumo lista os serviços project-state/governance/swarm em :3100-3102; ok. Para F19 o "project-state sobe moderno" não é a implementação de F19 (execution-ledger-schema.js é), mas o schema v17 está no receipt; sem impacto no veredito.

## Passagem 2 (confronto)
| Alegação do executor | Resultado |
|---|---|
| Nenhuma família promovida | Confirmada (nenhuma tem a 3ª prova) |
| F19 tem componente e recibo, falta caminho real | Confirmada (receipt v17; gap e MAPA §2 W1) |
| F20 sobe moderno, mas K7/K10 em banco/clientes descartáveis e tools/call do Codex NOT_EXERCISED | Confirmada (K7 README, K10 README). Nuance: Claude Code fez tools/call `state_read` em K7, mas também em banco descartável |
| F21 só `init --help` | Confirmada (verification.json + gap) |
| Hooks/watchdog/contratos não são implementation de nenhuma família | Confirmada (grep em requirements.json) |

# R-E9 — revisão cética de 16ef8da8 (F19/F20, evidência do project.db)

Veredito: PASS-WITH-NOTES

## Método do revisor
Cópia própria (cp -p de project.db/-wal/-shm, 2026-10-31T02:13:23Z), integrity_check=ok, leitura readonly com better-sqlite3 sobre a cópia. Original nunca aberto por mim (só cp). Cópia removida ao fim.

## (1) Contagens — CONFIRMADAS
Minha cópia é posterior e o ledger é vivo: 10446 eventos / 3482 execuções (executor: 10428/3476; delta = ~6 execuções novas, coerente com 252 ev/h). Demais fatos idênticos:
- 3 event_type (Authorized/Started/Succeeded), todos aggregate_type=execution, schema_version 1; 0 eventos antes de 2026-10-22; primeiro recorded_at 2026-10-23T01:17Z.
- 1 actor_json distinto (type=system); tool única `scheduler_sweep_orphans`, capability `mcp.project_state`; 3482 correlation/operation ids distintos (1 por execução).
- projeção: 3482 succeeded; checkpoint na cabeça, sem erro. execution_approvals/_uses = 0.
- Busca ativa por `tools/call`, hseos-governance, codex, client em actor/payload: 0. Chaves de actor: só id,type. Chaves de payload: sem campo de cliente/consulta. evidence_refs_json não vazio em 3482 (1 por execução; não é consulta de interface).
- as_events: 16 eventos 10-01..10-09 (pré-ativação), 5 as_agent_runs `running` antigos; as_sessions/handoffs/waves sem uso pós-ativação. Nada perdido pelo executor.
- Dias com eventos: 23,24,25,26,29,30,31 (lacunas 27-28).

## (2) Coerência do veredito — OK
Critério D4 (origem não-teste, volume, pós-ativação) é só parcialmente atendido (volume e data sim; origem = rotina de sistema única, não exercita a aceitação). F19-R1 exige consulta por interfaces distintas: sem evidência. F20-R1 exige negações de servidor malformado/ferramenta desconhecida/fora de escopo no servidor hseos-governance: sem evidência. "Na dúvida, não promove" respeitado.

## (3) Documento novo — OK
Só contagens, tipos, período, nomes de campo e "8 projetos distintos" (sem nomes). Sem conteúdo de eventos nem dados pessoais. Cita só prefixos de sha da cópia.

## (4) Arquivos — OK
Diff: 2 arquivos (+71). requirements.json intacto (F19/F20 seguem not_authorized); revalidação ganha seção "Atualização 2026-10-31" coerente; MAPA não tocado.

## (5) Testes e commit — OK
quality-surface + documentation-neutrality via cg.sh: 11 pass / 0 fail. Mensagem sem atribuição de IA. Worktree limpo.

## Notas (não bloqueantes)
1. "7 dias, 144 horas": o intervalo real é ~8 dias (~193 h) com 7 dias ativos; "144 h" está impreciso. Corrigir ou explicar como horas com atividade.
2. Título/nome do doc usa 2026-10-31 (UTC da cópia) enquanto o commit é de 10-30 local; consistente, só ficar ciente.
3. O doc afirma 0 `tools/call` com base no ledger; o canal do servidor hseos-governance pode não gravar no ledger. Ausência no ledger não prova ausência de uso fora dele (mcp-legacy-usage.db não lido, corretamente fora da autorização). O doc já trata como "falta prova", o que é a postura correta.

## Passagem 2 (confronto)
Alegação de que o original não foi aberto: não é comprovável além do método; o método descrito (cp + ls, leitura só da cópia) é consistente com o AJUSTE e com os resultados (integridade ok, valores reproduzidos na minha cópia independente). Alegação "sha do original não comparável" é aceitável conforme o AJUSTE do Commander.

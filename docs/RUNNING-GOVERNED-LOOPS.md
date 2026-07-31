# Running Governed Loops — o fluxo provado (N1)

Fluxo ponta a ponta para executar um **loop governado** no enterprise-hseos, exatamente como provado pelo loop-piloto N1 em 2026-07-24 (PR #121, tags `pilot-iter-1..5`). Este doc é operacional; o contrato conceitual vive em `.enterprise/governance/autonomy/` (carta, escopo, README do Readiness Gate) e nas skills `goal-graph` / `hseos-goal-loop` / `verifier`.

## Pré-requisitos (uma vez por campanha)

1. **Carta committada** (template 20): objetivo verificável, modelo operacional (Orquestrador/Executor/Verificador), gates humanos escritos ANTES de ligar, mapa de mini-goals. Piloto: `.enterprise/governance/autonomy/CARTA-PILOT-N1.md`.
2. **Allow-list committada** (formato `loop-guard`): paths exatos ou prefixos `dir/`. Piloto: `autonomy/scope-pilot-n1.txt`.
3. **Verificador definido**: determinístico quando existir (ex.: `scripts/governance/verify-doc-facts.sh`); senão, subagente adversarial isolado (skill `verifier`).
4. Axon do repo fresco (≤24h) ou modo declarado sem axon.
5. `uptime` saudável (§3f) — loops compartilham a máquina.

## Ligar o loop

```bash
cd <repo-root>
bash scripts/governance/worktree-manager.sh create <run-id> <feature-branch>
cd .worktrees/<run-id>
bash scripts/governance/loop-guard.sh init --run <run-id> \
  --scope <path/da/allow-list.txt> --budget <N>
# Baseline: rode o verificador e registre o estado inicial honesto
bash scripts/governance/loop-guard.sh iter --run <run-id> \
  --goal "baseline discovery" --verdict REPROVADO --evidence "<medições>"
```

## Cada iteração (1 mini-goal = 1 commit)

1. **Discover**: rode o verificador; escolha UM mini-goal.
2. **Execute**: despache o executor (subagente `model: sonnet`, contexto fresco, contrato fechado: um mini-goal, sem commit, SAÍDA como mensagem antes de encerrar).
3. **Verify** (nunca no contexto do executor):
   ```bash
   bash scripts/governance/loop-guard.sh scope --run <run-id>   # diff ⊆ allow-list e sem âncora
   <verificador determinístico>                                  # reproduza a medição na fonte
   ```
   Amostragem adversarial: reconfira ≥1 evidência citada. Comando escrito em doc deve **reproduzir o número afirmado**.
4. **REPROVADO?** Registre no heartbeat, devolva ao executor o defeito exato, revalide o MESMO aceite (consome budget — correto e esperado).
5. **Registrar + committar** (da RAIZ do repo, não do worktree):
   ```bash
   bash scripts/governance/loop-guard.sh iter --run <run-id> --goal "…" \
     --verdict PASS --evidence "…" --files "…"
   cd <repo-root>
   bash scripts/governance/worktree-manager.sh validate <run-id>
   bash scripts/governance/worktree-manager.sh commit <run-id> "docs(pilot): <mini-goal>"
   cd .worktrees/<run-id> && git tag <run-id>-iter-N
   ```

## Regras que a execução provou

- **Tipo de commit**: `docs(pilot):` (o `validate-commit-msg.sh` não aceita tipo `loop`).
- **Rollback**: teste de propósito após a 1ª iteração aceita (`git revert HEAD` → verificador deve regredir → revert do revert). Aceite do Gate item 4.
- **`git add -A` do worktree-manager** inclui `.hseos/loops/<run-id>/` no commit — o bus de auditoria viaja versionado com o loop (comportamento atual, aceito).
- **Stop conditions**: superfície esgotada (verificador 100% verde) OU budget atingido OU bloqueio → registrar e escalar. FAIL é handoff, não beco.
- **Estado SQLite**: exporte `HSEOS_CURRENT_RUN_ID=<run-id>` na sessão se quiser o run no `state-list`/kanban (o heartbeat do loop-guard NÃO alimenta o store sozinho — learning §6.6 do runbook N1).

## Encerrar (gates humanos — o loop nunca faz sozinho)

```bash
cd .worktrees/<run-id>
git push origin task/<run-id> <run-id>-iter-1 … <run-id>-iter-N
gh pr create --base <feature-branch> --head task/<run-id> \
  --title "docs(pilot): <campanha>" --body-file <relatório>
# HUMANO aprova o merge:
gh pr merge <nr> --merge        # task→feature: merge direto (CI só roda p/ master;
                                # `hseos pr closeout` é exclusivo do fluxo feature→master)
cd <repo-root>
bash scripts/governance/worktree-manager.sh remove <run-id>
git push origin :task/<run-id>
<verificador>                    # confirmação final no checkout principal
```

O corpo do PR é o relatório da campanha: antes/depois, evidência de governança (heartbeat, REPROVADOs, rollback, âncoras), achados fora de escopo para triagem humana e learnings sobre o harness.

## DoD de campanha

- Verificador 100% verde OU classificação honesta do restante com owner.
- **≥1 REPROVADO no heartbeat** (verificador que só aprova é teatro).
- Rollback testado; zero âncora tocada; alerta silencioso (ou disparos explicados).
- PR aberto com relatório; merge e higiene de branch/worktree concluídos.

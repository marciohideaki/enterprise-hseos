# INTAKE — run `20261111-terminal-closeout`

- **Iniciativa:** evolução do harness (`docs/evolution/PLAN.md`), repositório `enterprise-hseos`, modo solo-maintainer.
- **Objetivo:** fechar W0 a W5 com evidência e provar que a solução de terminal (CLI, API local, SDKs, MCP, terminais e jobs) funciona de ponta a ponta, para o owner validar antes da W6 (IDE).
- **Não é objetivo:** IDE (W6), W7, W8, macOS/Windows, eixo `operational`.
- **Prompt de origem:** `second-brain/_knowledge/projects/enterprise-hseos/session-closeouts/2026-11-11-prompt-conclusao-terminal-w0-w5.md` (lido integralmente em 2026-11-11).
- **Commander:** thread principal (Opus). **Squad:** subagentes `model: "sonnet"`.

## Pré-voo (2026-11-11, saída das ferramentas)

| Item | Valor |
|---|---|
| `git fetch` + `git status -sb` | `## master...origin/master`, limpa |
| HEAD / `origin/master` | `99a54dcc` |
| PRs abertas (`gh pr list --state open`) | nenhuma |
| `uptime` | load 5.22 / 4.52 / 3.94 |
| `heavy-run --check` | `normal (load1=5.22 phys=6 avail=20662MiB need=4G)`, rc=0 |
| `command -v claude` | `/home/annonymous/.local/bin/claude` |
| `claude --version` | `2.1.322 (Claude Code)` |
| Node | `v24.15.0` (`/workspace/local/sdk/nvm/versions/node/v24.15.0/bin`) |
| `.axon/index.duckdb` | modificado em 2026-10-31 23:27 (> 24 h, índice defasado; não reindexado nesta run: indexação é estágio pesado e a análise usa leitura direta de arquivos onde o índice não cobre) |
| `.hseos/config/activity-coordination.yaml` | ver STATUS (checado na fase 0) |

## Fontes lidas (seção 3 do prompt)

`AGENTS.md`, `docs/evolution/PLAN.md`, `docs/evolution/requirements.json` (27 famílias, contagem reconferida por script — ver STATUS), `docs/evolution/pendencias-w0-w5/MAPA.md`. As demais (STATUS de onda, ADRs 0042–0052, recibos de campanha, precedentes de run) são lidas pelos exploradores da fase 1 e pelo Commander quando um achado depende delas.

## Autorizações e limites do owner (cópia literal da seção 1 do prompt)

| Item | Valor padrão |
|---|---|
| Gasto pago (API de modelo, campanha com cobrança) | **US$ 0**. Nenhuma campanha paga, nenhuma chamada a provedor real com cobrança. O que exigir gasto vira item do OWNER-GATES (seção 8) |
| Chaves e credenciais | Não criar, rotacionar, revogar nem ler segredo do `pass`. Não fazer login novo em nenhum serviço |
| Cliente real para evidência de consumidor | Só o **próprio cliente desta sessão** e clientes já instalados e autenticados no host, sem login novo e sem gasto de API. Nada além disso |
| Merge de PR | **Autorizado**, por PR, somente com todos os checks obrigatórios verdes e `mergeStateStatus` = `CLEAN`. Preferir `hseos pr closeout <n> --approved`; se falhar, `gh pr merge --squash` com corpo limpo e registrar o motivo |
| Tags | Criar e publicar uma tag por onda concluída: `hseos-terminal-wa` … `hseos-terminal-we` |
| Mudança de status em `requirements.json` | **Só** `real_consumers` → `verified_installed_local_scope_only`, e só com evidência resolvível, `evolution_scope` escrito, guard verde e **reauditoria cega em duas passagens sem ressalva impeditiva**. **Nunca** o eixo `operational`. **Nunca** F14 nem F15 (decisão do owner de 2026-11-09: seguem `not_verified`, sem repetir campanha) |
| Orçamento de capacidade do pacote (G3) | **Não aumentar.** O teto vale para os arquivos **empacotados** (`npm pack`), por área. Arquivo novo numa área empacotada só entra se o `test-package-surface` continuar passando **sem mudar orçamento**; senão vira OWNER-GATE. `docs/evolution/**`, `test/**` e recibos não contam |
| Instalação global, ativação, publicação de pacote, W6, W7, W8 | **Não autorizados** |
| Interação com o owner | **Nenhuma.** Onde o `AGENTS.md` §11 manda parar e perguntar, registre um OWNER-GATE e continue com o trabalho independente |
| Orçamento de esforço | No máximo **5 ondas** (TA a TE), **3 rodadas de correção por entrega**, e uma suíte completa por onda |

Esta tabela é o registro da autorização de merge exigido pelo `AGENTS.md` §9 ("Explicit owner authorization ... must be recorded in the active session/run").

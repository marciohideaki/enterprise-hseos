# INTAKE — run `20261113-repo-hygiene`

- **Pedido do owner (2026-11-13, terminal):** `/plan` sobre o prompt `second-brain/_knowledge/projects/enterprise-hseos/session-closeouts/2026-11-13-prompt-higienizacao-repositorio.md`; plano aprovado pelo owner no terminal (ExitPlanMode) em 2026-11-13. Execução sem interação.
- **Base:** `master` `a4fabbd5`, checkout limpo, nenhuma PR aberta.
- **Modelo:** Commander na thread principal (Opus); exploradores, executores e revisores Sonnet (`model: "sonnet"`).
- **Plano:** `PLAN.md` desta run (ondas HA–HE).

## Autorizações do owner (seção 1 do prompt, copiada literalmente)


Estas autorizações ficam registradas no `INTAKE.md` da run (exigência do `AGENTS.md` §9 para merge). Fora delas, vale o `AGENTS.md` do repositório.

| Item | Valor padrão |
|---|---|
| Gasto pago | **US$ 0** |
| Merge de PR | **Autorizado**, por PR, só com todos os checks obrigatórios verdes e `mergeStateStatus` = `CLEAN` (`hseos pr closeout <n> --approved`; fallback `gh pr merge --squash` com corpo limpo) |
| Remoção de arquivo **versionado** | **Autorizada** só para itens classificados `ANDAIME` ou `DUPLICADO` (seção 6) com: zero referências no grafo de referências (seção 5), tag de arquivo publicada antes, suíte completa verde depois, e revisão cética de duas passagens sem ressalva impeditiva. Qualquer item `DÚVIDA` vira OWNER-GATE |
| Tag de arquivo | **Autorizada**: `hseos-hygiene-archive-20261113` (ou a data da execução) na `master` **antes** de qualquer remoção versionada, publicada no remoto |
| Worktrees | **Autorizado** remover worktree limpo cuja branch esteja contida na `master` ou cuja PR esteja mesclada; `git worktree prune` para os marcados `prunable`. Worktree com mudança não commitada ou commit único: preservar (seção 7) e depois remover |
| Branches **remotas** | **Autorizado** apagar só as de PR `MERGED` ou `CLOSED` cuja ponta esteja contida na `master` ou seja patch-equivalente (`git cherry`); as demais viram OWNER-GATE |
| Branches `backup/*` e `preservation/*` | **Não autorizado** apagar (OWNER-GATE com a ação exata) |
| Branches **locais** sem upstream | **Autorizado** apagar as contidas na `master` ou patch-equivalentes; as com commit único: bundle verificado antes (seção 7), depois apagar |
| Arquivos **não versionados e ignorados** do checkout (`.logs/validation/gate-*.log`, `.logs/runs/*.log`, caches) | **Autorizado** apagar logs e caches regeneráveis com mais de 7 dias; **nunca** `.hseos/state/`, `.axon/`, `.claude/settings.local.json`, `node_modules/`, `.husky/_/` |
| `HSEOS-GOAL-HARNESS-AUTONOMO.md`, `_pipeline/`, `.goose/` (não versionados, na raiz) | **Não tocar** (arquivos alheios ou de outra ferramenta; listar como OWNER-GATE se parecerem órfãos) |
| Worktrees fora do repositório (`/build/aew-graph-source-*`, `/workspace/github/hideaki-solutions-core/.wt/*`) | **Não tocar** além de relatar (podem pertencer a outras sessões); OWNER-GATE |
| Scratch em `$TMPDIR` (`/build/tmp`) | **Autorizado** apagar o que for deste repositório e tiver mais de 7 dias, depois de conferir que nenhum processo usa o diretório (`lsof +D` ou `fuser`) |
| `package.json` | Mudar só se indispensável (mudança invalida o recibo de ensaio da F14 v4: ver a seção 4). Preferir não mudar |
| Capacidade do pacote (G3) | Remover arquivos empacotados é permitido; **nunca** aumentar orçamento |
| Status de família em `requirements.json`, eixo `operational`, ADR `Accepted`, publicação, instalação global, ativação | **Não autorizados** |
| Interação com o owner | **Nenhuma**. Onde o `AGENTS.md` §11 manda parar e perguntar, registre OWNER-GATE e continue o trabalho independente |
| Orçamento de esforço | No máximo **5 ondas**, **3 rodadas de correção por entrega**, uma suíte completa por onda |


## Divergências da linha de base do prompt (conferidas por ferramenta em 2026-11-13)

1. `HSEOS-GOAL-HARNESS-AUTONOMO.md` e `_pipeline/rfc-managed-governance-control-plane.md` **são versionados** (`git ls-files`; introduzidos por #254 e `9a8f4449`). O prompt os trata como não versionados. A regra "não tocar" do prompt prevalece: ficam fora de qualquer remoção e entram em OWNER-GATE.
2. Branches `feature/stab3-*`: 8 locais com upstream e 8 remotas (`git branch -r`); o prompt fala em 9.
3. `.enterprise` tem 472 arquivos versionados (70 com caminho não ASCII); o grafo de referências usa `git ls-files -z`.

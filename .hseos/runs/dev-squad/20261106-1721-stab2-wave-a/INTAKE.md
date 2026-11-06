# INTAKE — stab2-wave-a (Onda A do plano dos 4 pontos em aberto)

**Run:** 20261106-1721-stab2-wave-a · **Base:** `feature/stab2-wave-a` (de `origin/master` `1d061a05`) · **Plano de origem:** `~/.claude/plans/enterprise-hseos-4-pontos-abertos.md`

## Pedido do owner (2026-11-06)
1. Iniciar a Onda A. 2. Higienizar (feito: 5 credenciais `w3-acp-control-*` removidas do `pass`; 11 irmãs `w3-campaign-control-*` aguardam decisão). 3. **Planejamento em Opus, execução em Sonnet.**

## Lote (7 tarefas heterogêneas e independentes; só leitura e documentos; sem custo)
| Id | Tarefa | Natureza |
|---|---|---|
| T1a | triagem de `ci/commit-tier-gates` contra a `master` | análise |
| T1b | triagem de `feature/guard-ts-parser-spike` | análise |
| T1c | triagem dos rascunhos W6–W8 (`hseos-plan-w4-w8`) | análise |
| T1d | triagem da skill `legacy-code-review` | análise |
| T2 | diagnóstico da falha da `4o-3` (F15) | análise de ledger arquivado |
| T3 | opções para validar a janela declarada de um binding contra o backend | **desenho (Opus)** |
| T4 | protocolo pré-registrado das campanhas F14 v3 e F15 L2 | **desenho (Opus)** |
| T5 | inventário do `pass` (nomes, datas, referências; sem valores) | inventário |

## Material e restrições
- Resíduo: `/build/artifacts/hygiene-2026-11-06-residue/` (README, `residue-branches.bundle`, `worktrees/*.patch|tgz`, `SHA256SUMS`). Recuperar com `git fetch <bundle> <branch>:<branch>`; não alterar o arquivo.
- Evidência arquivada da F15: `/build/artifacts/stab-f15c-*/` (ledgers, SSE, hashes). Leitura apenas.
- Sem chamadas pagas ou de rede. Sem segredos impressos. Sem `/tmp`. Sem atribuição de IA em commit.
- Antes de qualquer `push`: `npm run lint` pelo código de saída (o `rtk` esconde saída do eslint), `test-documentation-neutrality`, scan de segredos. Todo arquivo de teste novo registrado no `package.json`.
- Revisor cético isolado em duas passagens por entrega. Portões G1–G6 do plano ficam com o owner.

## Verificação do lote
Heterogêneo (análise de código, de ledger, desenho, inventário), com áreas não colidentes (cada tarefa escreve um documento próprio em `docs/evolution/w3/stab2/`). Paralelizável. Gatilho do dev-squad satisfeito.

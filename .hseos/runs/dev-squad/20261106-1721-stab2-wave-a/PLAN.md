---
g2_approved: true
g2_approved_at: 2026-11-06
g2_approved_by: owner
commander: Opus (sessão principal)
squad_default: Sonnet
---
# PLAN — stab2-wave-a

**Objetivo:** produzir, sem custo e sem mudar produto, a evidência e os desenhos de que o owner precisa para os portões G1 a G3 do plano `~/.claude/plans/enterprise-hseos-4-pontos-abertos.md`. Cada tarefa entrega um documento em `docs/evolution/w3/stab2/<id>.md`.

## Roteamento (restrição real do ambiente)
O hook recusa subagente em Opus, sem exceção. Logo, T3 e T4 são escritas pelo próprio Commander na sessão principal em Opus, e as demais por subagentes com `model: "sonnet"` declarado (T5 em Haiku). A sessão pode ficar em Opus durante a onda: ela só orquestra e desenha; quem executa análise são os subagentes.

## DAG
| Onda | Tarefas | Paralelismo | Razão |
|---|---|---|---|
| 1 | T2, T5, T1c, T1d | paralelas | só leitura, sem suíte de testes |
| 2 | T1a, depois T1b | em série, sob `heavy-run` | podem rodar testes; diretiva de throttling |
| 3 | T3, depois T4 | Commander | T4 consome T2; T3 independente |
| 4 | Revisão cética | um revisor Sonnet por documento de desenho e por T2 | passagem cega, depois confronto |

Dependência real única: **T2 → T4** (`handoffs/T2-to-T4.md`).

## Matriz de tier
| Tarefa | Modelo | Esforço | Razão |
|---|---|---|---|
| T1a | Sonnet | medium | 4 arquivos, roda teste contra a `master` |
| T1b | Sonnet | medium | 6 arquivos, 1.238 linhas |
| T1c | Sonnet | small | leitura e confronto de documentos |
| T1d | Sonnet | medium | governança de skills |
| T2 | Sonnet | medium | leitura de ledger; alimenta T4, sobe um nível |
| T3 | Opus (Commander) | strategic | decisão transversal de esquema; opt-in do owner |
| T4 | Opus (Commander) | strategic | protocolo de campanha; opt-in do owner |
| T5 | Haiku | trivial | inventário de nomes |

## Cartões
**T1a `ci/commit-tier-gates`.** Saída `T1a.md`. Aceite: tabela arquivo a arquivo (já na master / conflita / falta), resultado de `git merge-tree`, resultado do teste do ramo contra a master, veredito proposto (integrar, reescrever ou descartar). Risco: toca `quality-gates.sh` e `AGENTS.md`, superfícies de governança.

**T1b `feature/guard-ts-parser-spike`.** Saída `T1b.md`. Aceite: conclusão do `SPIKE-REPORT.md` citada; o que a master faz hoje no guard; o teste do ramo roda ou não; veredito proposto.

**T1c rascunhos W6–W8.** Saída `T1c.md`. Aceite: para cada um dos 4 arquivos ausentes, o que ainda vale, o que está superado e por qual documento da master; veredito proposto.

**T1d skill `legacy-code-review`.** Saída `T1d.md`. Aceite: inventário dos 16 novos e 3 alterados; confronto com registro de skills, ADR-0015 e validador; custo de integração; veredito proposto.

**T2 falha da `4o-3`.** Saída `T2.md` e `handoffs/T2-to-T4.md`. Aceite: sequência de eventos da retomada compactada citada do ledger; o que a compactação substituiu; comparação com uma execução que passou (`4o-1`); causa classificada como defeito de produto, erro do modelo ou indeterminada, com a evidência. Indeterminada é resultado aceitável; adivinhar não é.

**T3 validação da janela (Commander).** Saída `T3.md`. Aceite: (a) prova em fixture de que `ollama-local.example.yaml` recusa ou não o primeiro pedido real; (b) explicação da falha `tool continuation exceeds provider context` da F17; (c) o que cada backend expõe, separando verificado de não verificado; (d) opções A, B e C com a recomendação; (e) a separação entre três grandezas hoje confundidas: janela do modelo (32.768 no Ollama), contexto efetivo (4.096, só visível com o modelo carregado) e estimativa em bytes do adaptador.

**T4 protocolo das campanhas (Commander).** Saída `T4.md`. Aceite: F14 com regra não adivinhável, n≥10 por célula, ordem aleatorizada com semente, limiares pré-fixados e conta de custo real; F15 com mapa item a item do recibo L2 do ADR-0050 (o que já existe, o que falta, o que exige produto); uso de `provider-campaign-control` (prova de credencial, backend efetivo, cota, replay) em vez do guard; verificação do arquivo inteiro; regra de parada. Sem gasto nesta onda.

**T5 inventário.** Saída `T5.md`. Aceite: só o grupo `enterprise-hseos/` do `pass`, com nome (id em 8 caracteres), data e contagem de referências no repositório e no vault. Nunca `pass show`.

**O que nenhuma tarefa faz:** alterar produto, rodar chamada paga ou de rede, imprimir segredo, apagar o resíduo, usar `/tmp`, fazer commit (o Commander comita pelos scripts).

## Integração
Tarefas de subagente: `worktree-manager.sh create <id> feature/stab2-wave-a`, `validate`, `commit`, `merge`, `remove`, 1 task = 1 commit, sem atribuição de IA. Uma PR da onda para a `master`, mais tag `hseos-stab2-wa` depois do merge. Commit e merge da PR com autorização do owner.

## Perguntas do G2
1. Aprova este plano e a sessão seguir em Opus como Commander, com o squad em Sonnet?
2. As 11 credenciais `w3-campaign-control-*` entram na T5 só como inventário (padrão) ou podem ser apagadas agora?

## Registro do G2 (2026-11-06)
Aprovado pelo owner. Sessão segue em Opus como Commander, squad em Sonnet. As 11 credenciais `w3-campaign-control-*` ficam só no inventário da T5; nada é apagado nesta onda.

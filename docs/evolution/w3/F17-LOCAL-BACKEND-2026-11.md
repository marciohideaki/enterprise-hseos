# Recibo da campanha local da F17 (backend e modelo efetivos), 2026-11-05

Escopo: requisito F17-R1 (`docs/evolution/requirements.json`). Exercita o binding `openai-compatible` contra um **backend de modelo local**, o Ollama da infraestrutura compartilhada (`ollama-shared`, namespace `platform-shared-dev`), e observa o backend e o modelo efetivos no fio. Autorização do owner: "Exercite e valide a campanha local". Custo: zero (modelo local, sem fatura). Roteiro: `evidence/stab-f17/f17-local.cjs`. Este recibo não altera `requirements.json` e não cria binding oficial.

**Resultado: o caminho do binding até um backend local funcionou de ponta a ponta, e o modelo efetivo observado nas 10 respostas é o declarado. Nenhuma das duas tarefas foi aprovada. Rótulo: caminho local exercitado, sem binding local declarado e sem promoção da F17.**

## Backend observado

| Item             | Valor                                                                                                                                  | Como foi observado                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Serviço          | `svc/ollama-shared:11434`, pod `ollama-shared-f76db575f-ff248`                                                                         | `kubectl` do operador (não pelo binding) |
| Imagem           | `docker.io/ollama/ollama@sha256:46399ef0…`, versão 0.30.7                                                                              | `kubectl`                                |
| Processador      | 100% GPU                                                                                                                               | `ollama ps`                              |
| Contexto efetivo | **4096 tokens**                                                                                                                        | `ollama ps`, nas duas rodadas            |
| Caminho de rede  | `kubectl port-forward` para `127.0.0.1:21434`, aberto só durante a campanha e encerrado pelo PID                                       | roteiro e operador                       |
| Origem contada   | só `http://127.0.0.1:21434` conta para o contador e o teto de requisições; qualquer outra URL passa sem contagem e **não é bloqueada** | `fetch-guard.cjs`                        |

## Execuções

| Execução  | Modelo       | Requisições  | Desfecho                             | O que mostrou                                                                                                                                                                        |
| --------- | ------------ | ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run1`    | `qwen2.5:3b` | 5, todas 200 | `failed` / `session-budget-exceeded` | O modelo fez chamadas inválidas (`engineering.diagnose` com campos vazios, `engineering.write` com `path` nulo) e a continuação excedeu a janela de 8192 tokens declarada no binding |
| `run2-7b` | `qwen2.5:7b` | 5, todas 200 | `failed` / `criteria-not-satisfied`  | O modelo leu, escreveu e rodou o `check`, mas gravou `function add` sem exportar; a verificação protegida reprovou. Uma chamada de `diagnose` foi recusada pelo esquema              |

Em todas as 10 respostas o campo `model` do fio foi o declarado (`qwen2.5:3b` e `qwen2.5:7b`), com `usage` informado, `finish_reason` `tool_calls` e `stop`, e chamadas de ferramenta íntegras no formato. Nenhuma ferramenta foi chamada fora do contrato.

## Achado: o binding não é validado contra o backend

O binding declarou `context_tokens: 8192`. O backend atende **4096**. A declaração do binding é do operador e nada a confronta com o que o backend realmente oferece. Aqui isso não causou dano porque o uso real (até 1.807 tokens) coube, mas um binding local pode declarar uma janela que o backend trunca em silêncio. Corrigir exige uma decisão (validar na admissão, ou declarar o limite do backend); não foi alterado.

## Lacunas (`does_not_prove`)

1. **Sem binding local declarado.** Não existe arquivo em `.agents/activation/provider-bindings/` nem manifesto de controle para um modelo local. O vocabulário do manifesto (`provider-control-manifest`) só admite rota `local` para um fornecedor de modelo em `deepseek`; acrescentar um fornecedor local é mudança de esquema governado, que exige decisão do owner. O L1 local, portanto, segue sem declaração a certificar.
2. **Backend efetivo observado pelo operador e pelo campo `model` do fio**, e não por uma verificação do próprio binding. O endpoint foi acessado por túnel local, não pelo DNS do cluster.
3. **Nenhuma tarefa aprovada.** Isso mostra o limite dos modelos pequenos nesta tarefa, e não que o binding esteja correto ou incorreto para uma tarefa concluída.
4. **Uma execução por modelo**, sem repetição; o resultado de um modelo pequeno varia.
5. **A composição ACP tool-free de terceiro** (C4) segue BLOCKED sem chave. Por isso a F17 `deterministic` não pode ser promovida: o critério do ADR-0050 §2 exige todos os bindings.
6. **Infraestrutura compartilhada usada sem alteração.** Os modelos ficaram carregados com `UNTIL Forever`, comportamento que já existia; não foi mudado o contexto, a cota nem a exposição do serviço.
7. Estados completos e SSE bruto ficam em `/build/artifacts/stab-f17-run1` e `stab-f17-run2-7b`, com hashes; não versionados.

# Recibo da F14 pelo `agent run` de produção, 2026-11-06

Escopo: requisito F14-R1 (`docs/evolution/requirements.json`: contexto e memória mantêm fonte e autoridade). Responde às lacunas da reauditoria cega anterior: o consumidor era um roteiro com o host montado à mão, e o requisito da tarefa apontava a memória. Desta vez a tarefa roda pelo **`hseos agent run` de produção**, com a configuração do operador `environment.memory.source_db` (PR #285), modelo real (`gpt-4o-mini`, API oficial, chave `openai/api-key` do `pass`) e um requisito que **não cita a memória**: "seguir as convenções do projeto". Autorização do owner: campanha da F14 de produção, teto de US$ 1,00. Roteiro: `evidence/stab-f14b/f14prod.cjs`. Este recibo não altera `requirements.json`.

**Resultado: depois da promoção feita pelo owner, a tarefa real pelo `agent run` recebeu a convenção como `trusted`/`data`, o modelo escreveu no arquivo a linha de convenção que só existia na nota, e a tarefa foi aprovada; o controle sem promoção, com o mesmo contrato, não recebeu memória e não escreveu a linha. Rótulo: uso de memória promovida por modelo real pelo caminho de produção observado em uma execução com controle; sem promoção da F14 `real_consumers`, que depende de reauditoria cega.**

## Jornada

| Passo                                                                                                                   | Quem                                                           | Evidência                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caixa de teste: `project.db` ativado em diretório temporário, convenção gravada com `origin: agent`, `trust: untrusted` | Roteiro (`prepare`)                                            | `run1/prepare-f14prod-live-KcMJc1.json` (`content_sha256` `b66f28ca…`)                                                                                                                                                                                     |
| Controle antes da promoção, mesmo modelo, mesmo contrato                                                                | `agent run`                                                    | `run1/before-promotion.json`: aprovada, 0 fontes de memória; `index.js` bruto sem a linha de convenção                                                                                                                                                     |
| Promoção                                                                                                                | **Owner, no terminal dele** (saída colada por ele na conversa) | Ledger do `project.db` lido depois: `memory.written` `f14-convention-1:promoted`, `origin: operator`, `trust: trusted`, `promoted_by: owner`, `operation_id memory.promote:f14-prod:f14-convention-1:b66f28ca…`, e `memory.superseded` da nota original    |
| Tarefa real depois da promoção                                                                                          | `agent run`                                                    | `run1/after-promotion.json`: aprovada, 1 fonte `memory://f14-prod/f14-convention-1:promoted`, `origin: memory`, `trust: trusted`, `authority: data`, digest igual ao da nota; `index.js` bruto com `// guarantee-code: OVF-7391` acima da função exportada |
| Banco da fonte                                                                                                          | `agent run`                                                    | `source_db_unchanged: true` nas duas execuções (contagem e última posição do ledger iguais antes e depois)                                                                                                                                                 |

**Prova da promoção arquivada.** Antes de qualquer limpeza, foi feita uma cópia consistente do `project.db` depois da promoção (API de backup do SQLite, integridade `ok`, 3 eventos): sha256 `992e80f95a4744f000e1aca8be7145d165c6f5718445bb2e176e799dd18337aa` (`run1/project-db-after-promotion.sha256`); a cópia fica em `/build/artifacts/stab-f14b-run1/`, fora do git.

## Tentativas e parâmetros de campanha

| Tentativa                                   | Causa                                                                                                                                                | Ajuste                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `before-promotion.attempt1` (7 requisições) | `session-budget-exceeded`: sem a convenção, o modelo fez 2 buscas, 3 leituras e 1 escrita e atingiu o limite de 6 chamadas de ferramenta do contrato | `max_tool_calls` de 6 para 10, para o controle e para a rodada depois da promoção |

Nenhum gate, critério de aceite ou limite de tokens do contrato foi alterado. Os ajustes são do contrato da campanha.

## Custo

18 requisições no total (7 + 6 + 5), estimativa abaixo de US$ 0,02 (não é fatura; a rota não passa por ledger de custo). Muito abaixo do teto de US$ 1,00.

## Lacunas (`does_not_prove`)

1. **Uma execução com controle**, sem repetição, com um modelo pequeno.
2. **O contexto é montado pelo host.** O modelo não chamou `memory.retrieve`; a memória entrou na montagem do contexto. O resultado mede o uso de memória injetada, não uma recuperação espontânea pelo modelo.
3. **O requisito aponta de forma indireta.** "Seguir as convenções do projeto" remete a uma fonte de convenções sem citar a memória, mas ainda sugere que ela exista. O controle sem memória mostra que o modelo não inventa a linha por conta própria.
4. **A nota foi escrita para ser detectável** (um marcador distinto) e é redigida como convenção, em forma imperativa. O modelo agiu sobre ela, embora `authority: data`. Se uma memória de autoridade `data` deve poder moldar o comportamento dessa maneira é uma questão de política, não decidida por este recibo.
5. **Banco de teste.** O `project.db` é um fixture temporário, não o banco real do projeto. O caminho de produção foi exercitado com a chave `source_db` do operador apontando para ele.
6. **Garantia humana.** A promoção foi rodada pelo owner no terminal dele (declarado); o ledger prova a operação e o ator `owner`, não a presença de uma pessoa.
7. **Isolamento entre projetos com memória confiável de outro projeto** segue provado só por `test/test-memory-context-journey.js`.
8. Estados completos e SSE bruto ficam em `/build/artifacts/stab-f14b-run1/`, com hashes; não versionados.

# Revalidação do core HSEOS — 2026-10

Revalidação independente do core integrado na `master` (base `4a95592b`, após a
PR #182 que integrou W0–W4). O objetivo é separar o que está **provado** do que
foi apenas declarado nos checkpoints das ondas, usando o pacote como um consumidor
o instalaria. Estado corrente das etapas: [STATUS.md](STATUS.md).

## O que foi revalidado

- Linha de base determinística da `master`: suíte integral, cobertura crítica por
  arquivo, matriz de mutantes W4 e gates de qualidade, em Node 22 e 24.
- Pacote npm: tarball gerado por `npm pack`, instalado offline fora do checkout.
- Jornada de consumidor real do plano de controle: API HTTP + SDKs JavaScript,
  TypeScript e Python contra **uma** instância de `hseos control serve`.
- Jornada de consumidor real dos quatro servidores MCP do pacote instalado.
- Correções dos achados A3/A4 (etapa A6), com revisão cética de duas passagens.

## Método

- Tudo roda a partir do **pacote instalado**, não do checkout. As jornadas ficam em
  [`test/journeys`](../../../test/journeys/README.md) (fora do pacote) e rodam no CI
  por [`core-journey.yaml`](../../../.github/workflows/core-journey.yaml).
- Cada passo termina em PASS, FAIL ou BLOCKED. Falha nunca vira PASS e nenhum
  threshold ou gate foi afrouxado. Tentativas que falharam não contam como aprovação.
- Execução sequencial com controle de carga do host e cgroup delegado (isolamento
  do executor exige cgroup v2 delegado).
- Respostas de execução são fixtures roteirizadas: sem despacho a modelo ou provedor
  e sem chamada paga nesta revalidação.

## Três estados

Cada resultado deve ser lido em um dos três estados, que não se substituem:

| Estado          | Significado                                                  | Situação nesta revalidação                                                                                                              |
| --------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Determinístico  | Testes, cobertura, mutantes e gates com fixtures             | Linha de base da `master` verificada (A1); recibo [verification-receipt.json](verification-receipt.json). Matriz pós-correções pendente |
| Consumidor real | Pacote instalado fora do checkout, usado por CLI/API/SDK/MCP | A3 e A4 executadas; achados corrigidos em A6 em branches de tarefa ainda não integradas nesta base                                      |
| Ativação        | Uso operacional com modelo real, orçamento e contas          | **Não autorizada.** A5 (modelo real) não foi executada                                                                                  |

## Evidências

- [evidence/a1](evidence/a1): logs (gzip) e `stages.jsonl` da linha de base.
- [evidence/a3/core-journey-result.json](evidence/a3/core-journey-result.json): resultado da jornada do plano de controle (antes das correções A6).
- [evidence/a4/mcp-journey-result.json](evidence/a4/mcp-journey-result.json): resultado da jornada MCP (antes das correções A6).
- [verification-receipt.json](verification-receipt.json): recibo da linha de base, estado `BASELINE_VERIFIED_PRE_FIX`.

As evidências A3/A4 foram geradas **antes** das correções A6; o resultado pós-correção
será anexado quando as correções forem integradas e a jornada reexecutada pelo CI.
Nenhuma credencial é gravada; os JSON registram apenas nomes de verificações.

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
- Matriz final pós-correções em Node 22 e 24 e jornadas de pacote instalado repetidas.
- Execução com modelo real (A5, A5b), com autorização do dono, orçamento e verificador externo fixado.

## Método

- Tudo roda a partir do **pacote instalado**, não do checkout. As jornadas ficam em
  [`test/journeys`](../../../test/journeys/README.md) (fora do pacote) e rodam no CI
  por [`core-journey.yaml`](../../../.github/workflows/core-journey.yaml).
- Cada passo termina em PASS, FAIL ou BLOCKED. Falha nunca vira PASS e nenhum
  threshold ou gate foi afrouxado. Tentativas que falharam não contam como aprovação.
- Execução sequencial com controle de carga do host e cgroup delegado (isolamento
  do executor exige cgroup v2 delegado).
- Nas jornadas de pacote instalado (A3, A4, final3) as respostas de execução são fixtures
  roteirizadas: sem despacho a modelo ou provedor. O modelo real só entra em A5 e A5b, sob
  autorização do dono de 2026-10-09 (teto de US$ 1 na API paga).

## Três estados

Cada resultado deve ser lido em um dos três estados, que não se substituem:

| Estado          | Significado                                                  | Situação nesta revalidação                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Determinístico  | Testes, cobertura, mutantes e gates com fixtures             | Linha de base (A1) e matriz final: `npm test` 1493/1493 em Node 22 e 24; cobertura 96,86/90,26 em `1ae317c0`. A cobertura **falhou** em `82e4c2cc` por dois testes sob c8 e foi corrigida e reexecutada. Recibo [verification-receipt.json](verification-receipt.json) |
| Consumidor real | Pacote instalado fora do checkout, usado por CLI/API/SDK/MCP | Jornada do plano de controle 12/12 PASS e jornada MCP PASS (0 órfãos) em `82e4c2cc`, com pacote de 1459 entradas                                                                                                                                                       |
| Ativação        | Uso operacional com modelo real, orçamento e contas          | **Não autorizada.** Modelo real exercitado apenas em A5/A5b (uma tarefa descartável, orçamento fixo). Rota de API paga: aceite do verificador externo **FAIL** na A5b                                                                                                  |

## Evidências

- [evidence/a1](evidence/a1): logs (gzip), `stages.jsonl` e recibo da linha de base.
- [evidence/a3](evidence/a3/core-journey-result.json) e [evidence/a4](evidence/a4/mcp-journey-result.json): jornadas **antes** das correções A6.
- [evidence/final3](evidence/final3) (ponta `82e4c2cc`): matriz completa, incluindo a falha de `kernel-coverage`, e as jornadas pós-correção.
- [evidence/final4](evidence/final4) (ponta `1ae317c0`): repetição de cobertura e `npm test` após a correção de teste.
- [evidence/a5](evidence/a5) e [evidence/a5b](evidence/a5b): relatórios, resultados e registros de autorização do modelo real.
- [verification-receipt.json](verification-receipt.json): recibo final, estado `VERIFIED_BEFORE_PR`.

Nenhuma credencial é gravada. Antes de copiar, os arquivos foram varridos em busca do
valor da chave de API, de prefixos de chave, de endereços de e-mail e de identificadores de
organização, sem ocorrências. As pendências abertas estão em [STATUS.md](STATUS.md).

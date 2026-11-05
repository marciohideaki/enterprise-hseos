# Recibo da repetição da F15 (fork), 2026-11-05

Escopo: repetição autorizada pelo owner da jornada da C9 (compactação, SIGKILL, retomada com reconciliação, `fork`), com binding `gpt-4o-mini` na API oficial, teto de US$ 1,00, 12 requisições e 45 minutos. Roteiro: `evidence/stab-f15/orchestrate.cjs` (cópia da C9 que preserva os estados). Evidência: `evidence/stab-f15/run1/`. Este recibo não altera `requirements.json`.

**Resultado: o `fork` falhou de novo (`failed`/`criteria-not-satisfied`). A retomada do `fork` NÃO foi aprovada. A F15 `real_consumers` segue sem promoção. Não é PASS.**

## O que correu

- 11 requisições, todas concluídas; estimativa de custo abaixo de US$ 0,01 (não é fatura; a rota não passa por ledger de custo).
- Referência sem compactação: aprovada. Execução compactada com crash e retomada reconciliada: aprovada. Linhagem do `fork` (ancestry, prefixo, pai inalterado): verificada.
- Retomada do `fork` (checkpoint na sequência 58, antes da primeira escrita): reprovada.

## Causa, agora lida do ledger preservado (na C9 era inferida)

1. O `fork` nasce de um checkpoint anterior à primeira escrita; o workspace do `fork` está vazio.
2. A retomada injeta a volta `verified-reconciliation` (sequência 60), que manda diagnosticar antes de agir.
3. O modelo leu `add.js` (vazio), chamou `engineering.diagnose` (sequência 178) e a ferramenta recusou: `No rejected review requires a diagnosis` (`PROVIDER_EXECUTION_FAILED`, sequência 179).
4. O modelo então escreveu um resumo em texto e terminou sem agir. Os critérios protegidos não foram satisfeitos.

Duas execuções reais independentes (C9 e esta) deram o mesmo desfecho pelo mesmo caminho. Isso afasta o acaso de amostragem. É comportamento induzido pelo desenho do produto: a volta de reconciliação conduz a `diagnose`, e `diagnose` só aceita um review rejeitado. Corrigir é decisão de produto (o prompt de reconciliação ou a admissão de `diagnose` num `fork` sem review) e fica fora desta campanha.

## Lacunas (`does_not_prove`)

1. `fork` aprovado com modelo real: não provado.
2. Gatilho da compactação, compactações múltiplas (`single_compaction: false`), uma execução por etapa e conta dona da chave: como na C9.
3. Os estados completos (2 MB) e o SSE bruto ficam em `/build/artifacts/stab-f15-run1/` com hashes; não versionados.

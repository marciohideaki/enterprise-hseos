# W4-07a — matriz determinística

Este diretório guarda os recibos da revisão W4-07a. Os logs brutos comprimidos e
seus hashes estão em `verification-receipt.json`. O inventário de distribuição
registra os arquivos do pacote e confirma o teto de 1.457 entradas.

| Célula | Suíte executada                          | FR     |
| ------ | ---------------------------------------- | ------ |
| P1     | `test/test-execution-plugin-manifest.js` | 01     |
| P2     | `test/test-execution-plugin-runtime.js`  | 02, 05 |
| J1     | `test/test-job-control.js`               | 03     |
| J2     | `test/test-job-recovery.js`              | 03, 05 |
| F1     | `test/test-job-faults.js`                | 03, 06 |
| D1     | `test/test-workflow-expansion.js`        | 04, 05 |
| B1     | `test/test-job-campaign.js`              | 06     |
| I1     | `test/test-execution-plugin-install.js`  | 07     |
| S1     | `test/test-job-surfaces.js`              | 08     |

Os 18 mutantes dirigidos removem proteções de autorização, orçamento,
revisão, reserva, cancelamento e recuperação. A cobertura inclui arquivos
críticos não executados e exige 90% das linhas e 80% dos branches por arquivo.

R1 pertence à W4-07b: consumidores reais externos e binding vigente precisam
de recibos próprios. Os ensaios acima usam fixtures; não atestam consumidor
real, ativação operacional nem gasto de campanha.

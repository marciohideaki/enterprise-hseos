# Evolução do harness HSEOS

Artefatos: plano de execução, inventário verificável e recibos da onda 0.
Autoridade: plano fornecido pelo usuário em 2026-09-25; Constituição 2.2,
AGENTS.md, governance-discovery, automated-validation e ADR-0043.

Comece por [STATUS](STATUS.md), depois [PLAN](PLAN.md). Consulte
[requirements.json](requirements.json) para as 27 famílias, seus requisitos,
fontes, testes existentes, dependências e lacunas. A existência de um teste não
prova aprovação: todos os estados de evolução começam não verificados.

- [Comparação original preservada](COMPARISON-2026-09-25.md)
- [Manifesto imutável da candidata](baseline.json)
- [Plano e critérios por onda](PLAN.md)
- [Estado e verificações](STATUS.md)
- [Verificação de fechamento W0](W0-CLOSEOUT.md)
- [Decisão arquitetural](../../.enterprise/.specs/decisions/ADR-0043-harness-evolution.md)

`npm run test:kernel-quality` verifica integridade da fonte, completude das
famílias, referências e cobertura de lint. `npm run test:kernel-coverage:measure`
mede a base. `npm run test:kernel-coverage` exige 90% de linhas e 80% de branches
**por arquivo** crítico, incluindo arquivos não executados. Medição sem gate não
é aprovação. `npm run test:kernel-mutations` executa controles e três mutantes
isolados, sequencialmente, para autoridade, orçamento e reconciliação. O loader
de testes altera apenas o código em memória dos subprocessos; não edita fontes
nem contribui com execuções mutantes para a cobertura. Esse conjunto dirigido
não representa um mutation score exaustivo do kernel.

Glossário: baseline = conteúdo fixado para comparação; recibo = resultado
vinculado à revisão; binding = combinação declarada de backend, transporte,
autenticação e cobrança. Implementação, consumidor real e ativação são estados
separados.

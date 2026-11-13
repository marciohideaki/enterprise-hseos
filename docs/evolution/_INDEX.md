# Evolução do harness HSEOS

Artefatos: plano de execução, inventário verificável e recibos das ondas 0 a 5, da revalidação 2026-10, do fechamento pré-W6 e do fechamento do terminal (2026-11-11).
Autoridade: plano fornecido pelo usuário em 2026-09-25; Constituição 2.2,
AGENTS.md, governance-discovery, automated-validation e ADR-0043.

Comece por [STATUS](STATUS.md), depois [PLAN](PLAN.md). Consulte
[requirements.json](requirements.json) para as 27 famílias, seus requisitos,
fontes, testes existentes, dependências e lacunas. A existência de um teste não
prova aprovação: em 2026-09-25 todos os estados de evolução começavam não verificados. O estado atual está em
[requirements.json](requirements.json) e no [STATUS](STATUS.md).

- [Comparação original preservada](COMPARISON-2026-09-25.md)
- [Manifesto imutável da candidata](baseline.json)
- [Plano e critérios por onda](PLAN.md)
- [Estado consolidado por onda frente ao fechamento da fundação](PLAN.md#estado-consolidado-frente-ao-plano-de-fechamento-da-fundação-2026-10-23)
- [Estado e verificações](STATUS.md)
- [Verificação de fechamento W0](W0-CLOSEOUT.md)
- [Decisão arquitetural (ADR-0043, Accepted em 2026-10-30)](../../.enterprise/.specs/decisions/ADR-0043-harness-evolution.md)

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

- [Onda 1 — implementação e evidências](w1/STATUS.md)
- [Onda 2 — terminais e lifecycle](w2/STATUS.md)
- [Onda 3 — adapters e campanha](w3/STATUS.md)
- [Onda 4 — plugins de execução, jobs e workflows](w4/STATUS.md) ([README](w4/README.md))
- [Onda 5 — memória, compactação e consumidores](w5/STATUS.md) ([README](w5/README.md), [consumidores](w5/CONSUMERS.md))
- [Evidências do fechamento da fundação (W10)](w10/evidence/k7/README.md)
- [Revalidação do core 2026-10](revalidation-2026-10/README.md) ([estado](revalidation-2026-10/STATUS.md))
- [Validação em consumidor real 2026-10](consumer-validation-2026-10/README.md) ([estado](consumer-validation-2026-10/STATUS.md))
- [Revalidação real e revisão adversarial](w3/LIVE-REVALIDATION.md)
- [ACP restrito: compatibilidade, fronteira e campanha real](w3/ACP-CAMPAIGN.md)
- [Pendências das ondas W0–W5: mapa e plano](pendencias-w0-w5/MAPA.md) ([plano](pendencias-w0-w5/PLAN.md))
- [Fechamento do terminal (2026-11-11): TERMINAL PRONTO COM GATES DECLARADOS — pacote de entrada da W6](terminal-closeout/W6-ENTRY.md)
- [Aceite instalado do terminal](terminal-closeout/TC-INSTALLED-ACCEPTANCE-2026-11.md)
- [Gate de prontidão legível por máquina](terminal-closeout/terminal-readiness.json)
- [Terminal de engenharia (guia)](../terminal.md)

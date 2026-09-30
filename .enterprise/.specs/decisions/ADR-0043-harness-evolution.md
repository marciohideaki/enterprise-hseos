# ADR-0043 — Evolução do harness e IDE Code OSS

## Status

Draft de rastreabilidade do plano de implementação fornecido pelo responsável em
2026-09-25. Não certifica capacidades nem autoriza merge/publicação/ativação.

## Context

A candidata 4.0.0-rc.0 tem kernel, contratos, política, ledger, isolamento e três
verificadores concretos. A matriz comparativa identifica 27 famílias cuja
amplitude e comprovação operacional precisam evoluir. O kernel estava excluído
parcialmente do lint e a cobertura medida limitava-se ao catálogo. Node 20 está
EOL; o responsável escolheu Node 22/24 para a evolução, preservando recibos 20/22.

## Decision

Reutilizar o kernel e suas autoridades; generalizar serviços para CLI, API
versionada, SDK JavaScript/TypeScript/Python e IDE Code OSS. Ledger canônico,
trabalhadores remotos via API, kernel fora do Electron, extensão HSEOS com patches
limitados, upstream fixado e instalador separado. Não adotar Theia nesta evolução.

Separar ModelProvider e RuntimeProvider e declarar bindings oficiais de conta,
API e execução local. Preferir assinatura compatível; mudança de cobrança exige
decisão explícita. Identidades individuais e cotas observadas, sem pool de contas.

Ondas sequenciais W0–W8 e aceite do plano em `docs/evolution/PLAN.md`.
W0 inclui todos os packages no lint, preserva exceções locais justificadas para
semântica de protocolo e configura cobertura por arquivo crítico em 90% de
linhas e 80% de branches, contando arquivos não executados. O comando de medição
não é gate de aprovação. A evolução requer Node >=22; CI usa 22/24. Toolchain da
IDE terá ciclo separado. Não mudar hashes ou recibos históricos para obter verde.

## Relação com ADR-0025

O plano explícito do responsável em 2026-09-25 exige preservar a comparação e
identificar as quatro integrações. Para esse escopo, a autorização mais recente
permite referências de fornecedores somente em
`docs/evolution/COMPARISON-2026-09-25.md` e `docs/evolution/PLAN.md`. A guarda
mantém a restrição nos demais documentos e continua rejeitando alegações de
derivação inclusive nesses dois registros. Comparação não é evidência de
completude: cada requisito exige implementação e verificação HSEOS próprias.
O ADR-0025 aceito permanece intacto; esta exceção limitada não altera contratos
nem concede ativação operacional.

## Alternatives Considered

- Duplicar runtime/broker/ledger: rejeitado; catálogo e serviços existentes são
  a base da evolução, conforme Constituição §2.6 e ADR-0042.
- Embed do kernel no Electron: rejeitado por acoplar trabalho ao lifecycle da UI.
- Theia: substituído por Code OSS por decisão explícita do plano.
- Manter Node 20 como alvo futuro: rejeitado pelo EOL e pela decisão do plano.
- Aprovar cobertura agregada ocultando módulos fracos: rejeitado; medir todos os
  arquivos do escopo crítico e impor o mínimo por arquivo.

## Consequences

A evolução é incompatível com Node 20; a candidata histórica mantém sua evidência.
Nenhum instalador global é atualizado nesta task. Dependências nativas precisam
ser instaladas com o ABI de cada versão Node. Testes e campanhas anteriores não
certificam o novo delta. Aumento de superfície de ferramentas/API/IDE exige ensaios
adversariais próprios e conformance dos bindings oficiais.

## Risks and Mitigations

O fim da exclusão de lint exige ajustes em arquivos antes não analisados. Preservar
semântica com testes focados e revisão do diff, especialmente replay e política.
Coverage não substitui mutação nem recuperação real. Uma falha de gate impede
classificar o marco como verificado. Instalação, plataforma nativa e campanhas
reais serão comprovadas separadamente.

## Rollout and Rollback

Trabalhar em task isolada da candidata preservada, manter recibo SHA-256 e
inventário de gaps. Avançar ondas após seus critérios. Publicação/ativação exigem
decisão própria. Rollback restaura distribuição anterior sem reescrever ledger;
execuções com schema incompatível são drenadas ou reconciliadas, nunca retomadas
silenciosamente pelo downgrade.

## References

- [Constituição 2.2](../constitution/Enterprise-Constitution.md), §§2.3, 2.6, 5, 7, 10.
- [ADR-0042](ADR-0042-v4-kernel-and-optional-capabilities.md).
- [Automated validation](../../policies/automated-validation.md).
- [Deprecation & Sunset](../core/Deprecation%20%26%20Sunset%20Policy.md).
- [Plano](../../../docs/evolution/PLAN.md).
- [Calendário oficial Node](https://nodejs.org/en/about/previous-releases), consultado em 2026-09-25: Node 22/24 LTS e Node 20 EOL.

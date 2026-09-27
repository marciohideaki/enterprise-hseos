# Revisão W4-02b

Tipo: revisão adversarial; Constituição §§2.3/2.6/7; ADR-0045 Proposed; FR02/05.

- Snapshot contém apenas bytes verificados e é readonly. Troca de fonte após snapshot não troca código da execução; chamada seguinte recusa o drift.
- Import/CJS/ESM, testes fornecidos pelo plugin e filhos rodam no executor existente. Nenhum require externo no host.
- Limites efetivos 256 MiB/32 processos; duração/saída limitadas ao manifesto. Conformance compartilha prazo finito.
- Saída é JSON estrito com identidade/request/digest; resultado ainda precisa passar pelo contrato do port em W4-02c.
- Rede e host são inacessíveis no ensaio. Cancelamento observa ao menos três processos e comprova remoção do grupo, além do recibo de drain.
- Falha depois de tentar executar conserva PLUGIN_TEARDOWN_UNCERTAIN; preparação recusada antes do launch usa PLUGIN_ISOLATION_FAILED. Não repetir automaticamente.
- Conformance fornecida pelo plugin retorna certified:false. Não equivale a certificação independente ou consumidor real.
- Primeiro ensaio falhou fechado antes de launch por composição inválida de política. Corrigida para snapshot filho do controle privado, com arquivo protegido externo ao workspace; executor não alterado.

Gate integral pendente; somente validações focadas atestadas neste recibo.

## Gate integral — inventário npm

Primeira execução falhou no teto histórico de 1439 entradas. Comparação npm 11.12.1
entre base e task comprovou somente execution-plugin-runtime.js adicional (1440);
evidências não são publicadas. Teste passa a exigir manifesto/runtime e mantém
exclusões de estado/segredos/configuração e limite de tamanho. Delta em package-delta.json.

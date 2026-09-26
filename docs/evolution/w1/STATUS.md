# Onda 1 — engenharia geral

**Implementada e verificada deterministicamente como candidata Linux.**
O programa W0–W8 permanece em evolução. Modelos reais não foram certificados e
não houve ativação operacional, merge, publicação ou instalação global.

Base lógica: `feature/hseos-evolution-w0-quality`; entrega:
`feature/hseos-evolution-w1-engineering`; execução isolada:
`task/hseos-evolution-w1`. A importação W0 permanece no índice
`28f6ba59233e80bc35cdf51e12f433ec9efed9b8`; o delta W1 está separado.

## Entrega

- Contrato v2 com workspace Git, baseline, escopos, comandos, orçamento e aceite
  fixados; leitura v1 preservada, sem reescrever históricos.
- Verificadores protegidos Node/TypeScript, Python e conteúdo web estático; fontes
  executadas no sandbox existente, resultados avaliados pelo controlador.
- Busca, patch com precondição, diferenças, revisão e aplicação Git explícita.
  Edição concorrente invalida aprovação; entrega incorreta exige diagnóstico.
- Serviço/API local autenticada com sequência, idempotência, eventos com cursor,
  retomada, cancelamento, reconciliação, evidências e consulta de sessão/workflow.
- CLI e clientes JavaScript/TypeScript/Python compartilhando esses serviços.
- Exemplos multiarquivo de relatório TypeScript e inventário Python, instalados
  fora do checkout e exercitados até a aplicação do resultado aprovado.

## Verificação sequencial

| Verificação | Node 24.15.0 | Node 22.23.3 |
|---|---|---|
| Suíte integral/gates | 887 testes Node; 0 falhas/skips | 887 testes Node; 0 falhas/skips |
| Suíte crítica final | 416 testes; 0 falhas/skips | 416 testes; 0 falhas/skips |
| Cobertura crítica | 95,41% linhas / 88,06% branches | 95,41% linhas / 88,10% branches |
| Gate por arquivo | todos >=90% linhas e >=80% branches | todos >=90% linhas e >=80% branches |
| Instalação externa | dois projetos aprovados e aplicados | dois projetos aprovados e aplicados |

Cada suíte integral incluiu PostgreSQL real; scripts auxiliares também passaram.
Os gates mantêm um aviso histórico de placeholders no template de épicos;
markdownlint indisponível não é apresentado como verificação documental executada.
Lint, formatação, declarações TypeScript, catálogo, manifest e checks documentais
constam do recibo final. Não houve subagentes nem sobreposição de etapas pesadas.

**Vínculo das revisões:** as suítes integrais precedem o último endurecimento de
Git. A suíte crítica final foi reexecutada integralmente nas duas versões após
esse ajuste, incluindo suas novas regressões. O recibo registra o snapshot da
suíte integral, os arquivos posteriores e a validação final; não confunde todos
os resultados com uma única execução sobre a mesma árvore.

Instalações usaram `npm install --offline` após provisionamento. O rastreamento de
`connect` observou somente nove conexões INET loopback por jornada instalada e
nenhuma tentativa INET externa. Isso não equivale a isolar a rede do controlador;
o código do projeto continua sob a fronteira de isolamento do executor.

## Achados corrigidos e revisão adversarial

- Schema candidato 11 acrescenta os recibos de controle. Ensaios de migração e
  rollback foram atualizados; o banco operacional permanece v4 e byte a byte
  preservado. Nenhuma migration operacional foi autorizada.
- A seleção do gate podia omitir testes por SIGPIPE em `echo | grep -q` sob
  pipefail. Here-string elimina essa falha; alterações em packages/test também
  selecionam validação. Regressão usa 20 mil caminhos. Execuções anteriores que
  omitiram testes estão identificadas e não contam como suíte integral.
- Filtro Git local executou no experimento adversarial anterior à correção. O
  fluxo final rejeita filtros, fixa a raiz e desabilita hooks/fsmonitor/diff
  externos. Novos testes verificam ausência do efeito e aplicação legítima.
- Pin de aceite alterado, entrega incorreta com exit zero, patch sem diagnóstico,
  escopo/binding/origem/sequência inválidos e edição após aprovação são rejeitados.
- SIGKILL antes/depois do recibo de patch não provoca reaplicação automática.
  Quando falta evidência, exige pergunta e decisão sobre o estado atual.
- O teto de assets passou de 1400 para 1420, acomodando 1413 arquivos reais;
  exclusões de estado e segredos permanecem. Pacote: 8.776.730 bytes descompactados.

## Limites e próximos estados

Estado candidato temporário; sem garantia de persistência após limpeza/reinício
do sistema. TypeScript usa remoção de tipos, não `tsc` completo. Web valida conteúdo
estático, não browser. Somente texto e escopo finito; repositórios com filtros Git
configurados são recusados. Workflows não têm aplicação agregada de patches.
Campanhas com modelos/bindings reais, certificação de provedores e ativação são
marcos separados. Terminais e ampliação do lifecycle pertencem à Onda 2.

| Marco | Estado |
|---|---|
| Implementado e verificado deterministicamente | concluído no escopo W1 |
| Consumidores reais | CLI/API/SDK instalados verificados; modelos reais não certificados |
| Autorizado e ativado operacionalmente | não ativado |

## Artefatos de revisão

- [Recibo e hashes](evidence/receipt.json)
- [Separação Git](evidence/git-separation.json)
- [Manifesto de fontes](evidence/sources.json)
- [Pacote candidato](evidence/package-receipt.json)
- [Especificação](../../../.specs/features/harness-w1/spec.md),
  [design](../../../.specs/features/harness-w1/design.md) e
  [tasks](../../../.specs/features/harness-w1/tasks.md)
- [API e operação](../../engineering-control-api.md),
  [SDK](../../../packages/control-sdk/README.md),
  [intake/reuso](../../decisions/harness-w1-intake.md) e
  [ADR-0044](../../../.enterprise/.specs/decisions/ADR-0044-project-engineering-control.md)

Governança: produtor e709368, Constituição, governance-discovery, capability-graph,
Data Contracts & Schema Evolution, Hexagonal & Clean Architecture, ADR-0043.
Skills spec-driven, capability-check/core-drift e verification-before-completion.
AEW aplicação/enforcement não verificados; sem promoção ou mudanças em outros
projetos. A candidata v4 e os recibos W0 foram preservados.

# Estado da evolução — 2026-09-26

Onda 2 implementada e verificada como candidata Linux: [estado específico](w2/STATUS.md).
Matriz Node 22/24: 914 testes integrais e 440 críticos por versão, cobertura
95,63% linhas / 88,46% branches, instalações externas e protocolo de crash
verificados. Modelos reais não certificados; operacional não ativado.

Onda 1 implementada e verificada deterministicamente: [estado específico](w1/STATUS.md).

**Onda 0 implementada e verificada deterministicamente. O programa W0–W8 não está concluído.**
Verificação mais recente: [W0-CLOSEOUT.md](W0-CLOSEOUT.md).
Implementação local ainda sem commit, merge, publicação ou ativação. Não há
certificação nova de bindings reais nem IDE entregue.

## Implementado nesta task

- Cópia isolada da candidata, preservando índice, conteúdo e recibos originais;
  manifesto `baseline.json` com SHA-256 por arquivo e hash do patch importado.
- Fim da exclusão global de packages no ESLint. Todo código autoral de packages
  passa pela configuração raiz; `no-undef` e `no-unreachable` ficam ativos.
  Exceções pontuais documentam semântica intencional de protocolo/segurança.
- Configuração c8 com arquivos não executados, relatórios reproduzíveis e gate
  por arquivo crítico de 90% linhas/80% branches. CI executa esse gate depois
  da suíte normal, sequencialmente. O gate não é omitido por estar vermelho.
- Guardas verificam a superfície de lint com erro injetado em memória,
  integridade/completude das 27 famílias e referências existentes. Inventário
  distingue evidência histórica, teste existente e aceite futuro.
- Runtime mínimo dos packages/root Node 22; CI evolutiva 22/24, smoke e release
  22. Evidências históricas Node 20/22 não foram editadas.
- Documentação da candidata distingue histórico de estado atual; plano completo
  por ondas, migração e ADR-0043 tornam as decisões rastreáveis.

## Verificação inicial (histórica)

Resultados e hashes finais registrados em [evidence/receipt.json](evidence/receipt.json).

| Verificação | Resultado |
|---|---|
| Regressão focada, Node 24.15.0 | 326 testes passaram; zero falhas/skips |
| Guardas de qualidade/inventário | 3 testes passaram |
| Lint integral | passou, zero avisos |
| Formatação integral | passou |
| Cobertura crítica | 89,61% linhas / 79,96% branches; 14 arquivos abaixo de 90/80 |
| Gate de cobertura por arquivo | reprovado (exit 1) |
| Suíte integral/gates completos/Node 22/instalação externa | não executados nesta revisão |

A instrumentação revelou ambiente congelado incompatível com a normalização
do spawn no driver de app-server. A reprodução falhou antes do ajuste; o driver
agora entrega uma cópia e conserva seu ambiente congelado. Os oito testes do
driver passaram, depois incorporados à regressão final. Ajustes finais em oito
arquivos foram exclusivamente formatação, com equivalência AST verificada.
As dependências usadas vieram do checkout pai, não de uma instalação limpa.
Os logs temporários ficam em `.logs/validation/evolution/`.
A matriz configurada no GitHub Actions não equivale a uma execução remota.

## Continuação sequencial — 2026-09-25

A pedido do usuário, toda validação foi executada uma de cada vez, com
`--test-concurrency=1`, Node 24.15.0 e prioridade `nice -n 10`. Não houve
subagentes nem sobreposição entre testes, lint, build ou empacotamento.

- Ampliados testes de compactação, encerramento do supervisor, limites de
  ferramentas, reconciliação, replay, workflows e autenticação nominal de
  políticas de isolamento. Witnesses adulterados são rejeitados por injeção de
  falhas no subprocesso; os testes reais de isolamento continuam separados.
- Compatibilidade com streams históricos é exercitada sem repetir efeitos.
  Replay incremental e integral são comparados em cada fronteira de um fluxo
  real de modelo/ferramenta. Reconciliação preserva a evidência incerta anterior
  e rejeita troca de identidade, evidência inválida e liquidação duplicada.
- O comando de cobertura agora inclui o completion audit existente e os novos
  testes de fronteiras e falhas de isolamento.
- Três mutantes dirigidos (autoridade, orçamento e recuperação) foram mortos
  pelos testes correspondentes; cada mutante teve controle íntegro aprovado.
  Isso não equivale a uma campanha exaustiva de mutação.
- Uma medição passou em 364 testes. A execução limpa seguinte teve 372/373
  aprovações: uma fixture nova omitia o término do modelo antes de declarar
  sucesso. Corrigida a fixture, os 18 testes de persistência passaram e o c8
  acumulado aprovou todos os arquivos em **90% linhas/80% branches**, com
  **95,01% linhas/87,48% branches** agregados. Nenhum limite foi reduzido.
  Não é apresentado como uma única execução limpa com 373 aprovações.
- O benchmark de replay falhou duas vezes e passou nas duas medições seguintes
  sem alteração de código ou limiares. A variação permanece registrada; sua
  estabilidade não está certificada. Load observado nesta continuação: 8–22,
  em host com seis cores físicos.
- Lint integral passou sem avisos; formatação integral passou. Os seis testes
  de qualidade e mutação passaram, sem skips. Nenhum commit foi criado.
- Baseline original revalidado: 1.956 hashes e índice Git intactos.

Recibos desta continuação: [evidence/sequential/receipt.json](evidence/sequential/receipt.json).
A validação inicial acima permanece histórica e não substitui os novos recibos.

## Fechamento da onda 0

Após autorização explícita para execução sequencial, os gates completos e a
suíte integral passaram em Node 22.23.3 e Node 24.15.0: **849 testes Node por
versão, zero falhas e zero skips**, além dos checks auxiliares. Cada execução
incluiu 15 testes PostgreSQL reais. Os gates reportaram zero falhas e um aviso
histórico do template de épicos. A correção documental, os limites de evidência
e os recibos completos estão em [W0-CLOSEOUT.md](W0-CLOSEOUT.md).

A matriz crítica limpa, cobertura 90/80 por arquivo e instalações externas
estão verificadas. Baseline e índice da candidata preservados; patches de
importação e W0 separados e reconstituídos para revisão. Entrega local sem
commit, PR, merge, publicação ou ativação. No fechamento W0, o próximo trabalho
funcional era W1; W1–W8 não eram critérios adicionais de fechamento de W0.

## Três estados

| Marco | Determinístico | Consumidores reais | Operacional |
|---|---|---|---|
| W0 | implementado e verificado; matriz integral e cobertura aprovadas | CLI instalada com jornadas locais verificada; providers reais não certificados | não ativado |
| W1 | implementada e verificada; ver estado específico | CLI/API/SDK instalados verificados; modelos reais não certificados | não ativado |
| W2 | implementada e verificada; matriz 22/24 e crash/recuperação | CLI/API/SDK instalados verificados; modelos reais não certificados | não ativado |
| W3–W8 | não implementados nesta task | não certificado | não autorizado |

## Revisão adversarial

- Exclusão futura de um package: a guarda enumera arquivos e consulta o ESLint
  efetivo; uma configuração que ignore arquivo ou desligue regras críticas falha.
- Arquivo crítico nunca executado: `all: true` conserva o arquivo no denominador;
  o gate é por arquivo e não mascara módulos fracos por média agregada.
- Inventário incompleto ou referência inventada: a guarda compara IDs/nomes com
  a matriz preservada por SHA-256 e resolve cada fonte/teste dentro do checkout.
- Evidência histórica confundida com entrega atual: estados iniciam como não
  verificados; baseline preservado e recibo novo referenciam revisões distintas.
- Ajuste no teste do supervisor: snapshot da allowlist é feito antes de `spawn`,
  pois o Node injeta NODE_V8_COVERAGE no próprio objeto durante instrumentação.
  A comparação de allowlist e os canários de segredo continuam exigidos.

## Governança e continuidade

Fontes lidas: AGENTS.md global/projeto; distribuição e709368,
`.enterprise/policies/governance-discovery.md`, Constituição 2.2, índice core,
regras de agentes, Quality Gates, Deprecation & Sunset; políticas locais
capability-graph/automated-validation, registro e fragmento de capacidades,
ADR-0042 e skills verification-before-completion/systematic-debugging/test-coverage. Para W0 foram estendidos lint,
c8 e testes existentes; não foi criado outro serviço de runtime.

Axon sem índice utilizável. A busca em `.hseos`, `.codex`,
`.agents/instructions` e repository-contract não comprovou ativação AEW;
aplicação/enforcement **não verificados**. Nenhuma memória canônica foi alterada.
Pendências herdadas de outros trabalhos não foram encerradas por esta task.

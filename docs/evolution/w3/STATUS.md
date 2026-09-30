# W3 — estado de execução

**Entrega técnica corrente de W3 validada**, com campanha da quarta família
diferida para depois de todas as fases por decisão explícita do proprietário.
Essa jornada permanece pendente, não PASS, e não bloqueia o avanço atual.

- Matriz funcional integral Node 22/24 aprovada, zero falhas/skips e um aviso
  histórico por runtime.
- Cobertura integral aprovada nos dois runtimes: 56 arquivos críticos, todos
  acima de 90% linhas / 80% ramos. Node 22: 528 testes, 96,24% linhas/89,57% ramos;
  Node 24: 96,24% linhas/89,54% ramos. Exceção de recursos Node 22 autorizada pelo
  dono, com processo principal limitado a 1 CPU/3 GB.
- Consumidores externos instalados: 64/64 por runtime, fixtures explícitas e
  SQLite ABI correspondente provisionado após instalação offline.
- Campanhas reais ACP/Codex, Claude e Antigravity local reexercitadas: oito novos
  despachos, recuperação semântica, replay idempotente e zero comandos vivos/incertos.
  Antigravity foi executado por último; Gemini API não foi exercitada.
- Teto original US$ 10, reservas US$ 9, saldo US$ 1; 30 despachos acumulados. SDK Claude
  informou US$ 0,008886 nesta rodada, sem liberar reserva. Autorização adicional
  de duas chamadas Claude consumida.

Task `task/hseos-w3-prototype`, feature `feature/hseos-evolution-w3-bindings`,
base `feature/hseos-evolution-foundation`. Integração da task e PR seguem o
lifecycle governado; merge da PR exige autorização explícita do proprietário.
Publicação e ativação operacional não executadas. W4–W8 não concluídas.

Ver [aceite final](CLOSEOUT.md), [campanhas reais](REAL-CAMPAIGNS-RESUME.md),
[matriz anterior](MATRIX-RESUME.md) e [correções](CLOSEOUT-REVALIDATION.md).
Os checkpoints abaixo são históricos; seus estados não descrevem o aceite atual.

Autorizada pelo usuário em 2026-09-26, junto da revisão/correção W2 e integração
Git W1/W2. Escopo completo em `.specs/features/harness-w3/`; intake em
`docs/decisions/harness-w3-intake.md`. Execução sequencial, sem subagentes.

- Especificação, design, tasks e ADR draft definidos.
- Descoberta confirmou reuso de contratos de provider, bindings, adapters,
  EngineeringControl, SDKs e ledger existentes.
- Fontes oficiais consultadas para autenticação/cobrança de Codex, Claude e
  Antigravity; checkout oficial do provider compatível/ACP preservado como fonte versionada.
- T1/T2 em implementação: manifesto estrito, admissão, autorização de uso único,
  reservas/recibos no ledger existente, API/CLI e SDKs JS/TS/Python.
- Validação focada: 16/16 testes passaram em Node 24 e Node 22, incluindo paridade
  CLI/HTTP/JS/Python, autorização, orçamento, concorrência e falhas de recibo.
- Cobertura medida dos dois módulos novos: 100% linhas / 96,53% branches,
  gate por arquivo 90/80 aprovado. Não substitui cobertura da matriz integral.
  Evidências e hashes em `evidence/prototype/receipt.json`.
- Uma tentativa inicial usou o symlink de dependências Node 22 com Node 24 e
  falhou no carregamento nativo de SQLite; o symlink local foi removido, e a
  execução correta usou as dependências Node 24 da raiz. Não foi defeito funcional.
- T3/adapters, matriz completa, cobertura e campanha real ainda pendentes.
  Configuração pública de adapters não foi liberada; testes usam adapters locais
  controlados. Essas fixtures não comprovam autenticação/consumo real.
- Inventário local sanitizado: Codex 0.157.1 e Claude Code 2.1.283 reportam login
  nativo. Identidade, quota e elegibilidade para campanha não foram certificadas;
  nenhum segredo foi registrado. Escopo em `evidence/host-inventory.json`.
- Bindings/contas autorizados e teto financeiro foram solicitados; nenhuma
  chamada de inferência real foi feita. FR07 permanece obrigatório.
- Operacional não ativado; publicação e migração não executadas.

Base atual: `feature/hseos-evolution-foundation`, commit `b9db33bfcf53681d91c64ca8a0dd42c74b0fb24c`,
incluindo as quatro correções do attach e a CI corrigida. Feature W3:
`feature/hseos-evolution-w3-bindings`; task atual: `task/hseos-w3-prototype`.
W1 e W2 integradas por PRs #178 e #179, com closeout governado e checks verdes.
W2 final: 919 testes integrais +445 críticos por Node 22/24, zero falhas/skips,
cobertura crítica 95,64% linhas / 88,57% branches. A integração foi na foundation,
não em master. Evidência em `evidence/integrated-base/w1-w2-integration.json`.
O índice deste worktree contém somente o delta W3 (27 arquivos ao reaplicar),
sem atribuir alterações de W0/W1/W2 à onda atual.

Histórico: o protótipo foi desenvolvido em `task/hseos-evolution-w3` sobre a
importação W2 `81439e1bbdaea349a85a10793f7e30b92e533115`. O worktree original foi
preservado. Um symlink temporário de dependências Node 22 foi removido daquele
índice e excluído do patch; nenhum `node_modules` integra o delta W3.
Reaplicação verificada a partir do snapshot
`bbc73c7a2c4a20aac0c91848e3b8ab6d2b0fb4b9`. Regressão final na base integrada:
37/37 testes por Node 22/24 (providers, controle de engenharia, terminais e
empacotamento), zero falhas/skips; lint, formato, manifesto CLI e TypeScript PASS.
O limite de empacotamento foi ajustado após comparar a base: exatamente dois
novos módulos, 1418 → 1420 entradas; nenhum artefato interno adicional.
Cobertura dos dois módulos novos remedida após formatação: 100%/96,53%.
Recibo e hashes em `evidence/integrated-base/receipt.json`. Isso não conclui T4:
matriz integral e consumidores W3 instalados ainda pendentes.
Não há commit W3 nem certificação de campanha real.

## Continuação — componente Antigravity

Implementado cliente Python opcional que restringe o SDK a ferramentas da API
HSEOS para uma tarefa e envelopes resume/cancel fornecidos pelo operador. São dez
testes Python determinísticos; wrapper Node e teste de pacote passaram. Lint dos
JS alterados, Prettier e parsing Python passaram. Configuração também exercitada
com SDK oficial 0.1.18 em venv temporário, com rede e processos proibidos pelo teste.
Ver `ANTIGRAVITY-CLIENT.md` e `evidence/antigravity-client/`.

Não fecha T3: falta loader/adapter com estado durável, identidade/quota efetivas,
limite e drain do processo e orçamento que cubra o modelo da tarefa subordinada.
Não foi habilitado launcher que dispense esses controles. Rotas e referências dos
quatro bindings e teto financeiro foram solicitados novamente após “Prossiga”.
A inferência real continua não executada.

A matriz integral desta revisão foi iniciada e interrompida para respeitar o
limite de carga do host (seis núcleos físicos). As verificações de carga permaneceram acima do limite (última 14,83); runner e
port-forward próprios foram encerrados. A matriz aguarda nova janela de capacidade;
resultados anteriores pertencem aos snapshots anteriores, não certificam os novos
arquivos. O pacote agora tem um terceiro artefato W3: `antigravity_client.py`.

## Continuação — loader e regressão candidata

A autorização mais recente exige executar atividades 1–4 e somente após validação
das entregas proceder aos commits e PR (atividade 5). O loader de configuração
foi ligado a `control serve`, preservando a configuração legada e recusando
factories não registradas. Fixa device/inode do diretório e SQLite, valida grants
e manifests antes das factories, revalida identidade após construção e sanitiza
erros. Reutiliza a validação de fixture do ledger: não habilita estado operacional.

Sete testes novos do loader e a regressão afetada passaram: 44/44 em Node 22 e
44/44 em Node 24, zero falhas/skips. Cobertura focada do loader: 100% linhas e
branches em Node 24. Lint, formato, TypeScript e manifesto CLI passaram; o manifesto
foi regenerado por mudança de hash em `control.js`. A primeira chamada de testes
de providers sem cgroup delegado foi corrigida e a rodada delegada passou 23/23.
Recibo e hashes em `evidence/configuration-loader/receipt.json`.

A reabertura de fixture é persistência entre processos, não prova retenção após
limpeza de `/tmp` ou reinício do host. Adapters reais, orçamento composto, consumidor
instalado W3 e campanha das quatro famílias continuam pendentes. Em particular,
quota percentual não deve ser convertida em uma contagem inventada; o custo de
resume do modelo subordinado precisa de reserva na mesma campanha. O registro de
factories do CLI continua vazio até demonstrar esses controles. Não houve inferência.

Com carga do host 2,82 para seis núcleos, a matriz integral foi retomada em Node 24,
com Node 22 e cobertura em sequência. O resultado será registrado separadamente;
esta anotação de início não equivale a PASS. Não há commit nem PR W3.

## Resultado da matriz retomada

Node 24: 943/943 testes integrais e gates completos PASS; 469/469 críticos PASS,
cobertura 95,87% linhas / 89,13% branches e gate por arquivo 90/80 aprovado.
Node 22: 943/943 testes integrais e gates completos PASS. Zero falhas/skips em todas
as etapas concluídas. A cobertura crítica Node 22 não começou: leituras consecutivas
de carga 9,20 / 10,15 / 9,77, acima dos seis núcleos físicos. Runner ocioso e
port-forward próprios encerrados; symlink temporário de dependências removido.
O consumidor instalado foi preparado, mas não executado nessa janela.

Duas falhas dos gates foram corrigidas antes da rodada verde: redação W3 agora usa
a fronteira ACP e aponta ao registro comparativo autorizado, em conformidade com
ADR-0025; o teste de campo secreto proibido usa valor gerado em vez de literal.
Nenhuma exceção de gate foi ampliada. Evidências finais deste checkpoint e hashes:
`evidence/matrix-checkpoint/receipt.json`. Os logs anteriores preservam as falhas.

As atividades 1 e 2 seguem parciais (factories reais e orçamento composto pendentes),
a atividade 3 ainda exige cobertura Node 22 e consumidor instalado, a atividade 4
aguarda configuração e orçamento do proprietário, e a atividade 5 não foi iniciada.
Aprovação de regressão do candidato não equivale à entrega integral de W3.

## Continuação — transporte API, composição e runner

O registro CLI agora contém uma factory real para a rota API compatível. Seleciona
credencial explícita por referência, valida seu fingerprint, observa saldo USD
e usa o broker existente para transporte. Não inventa identidade de conta nem
converte quota percentual em requests. O custo faturado desconhecido mantém a
reserva integral. As tarifas são declaradas e expiráveis, não uma fatura verificada.

O controlador reserva pai e subordinados no mesmo orçamento, fixa a composição,
recusa escopo antes da inspeção e propaga cancelamento. Shutdown aguarda filhos;
recibo perdido mantém reserva e impede repetição automática. O runner usa UUIDs
estáveis para replay, recusa cobertura incompleta das quatro famílias antes de
consumir autorização e diferencia ensaio de controle de recuperação nativa.

A regressão encontrou que registrar a observação inteira infringia o contrato de
payload do ledger. A gravação foi reduzida a quota/validade e hash, sem ampliar
permissões do ledger. Após a correção, 42/42 testes focados passaram em Node 24.
Evidências finais desta revisão serão registradas em `evidence/adapters-composition/`.
Nenhuma inferência real, migração, publicação, commit ou PR W3 foi executado.

## Resultado — adapters e composição

Node 24 e Node 22: 962/962 testes integrais e gates completos PASS em cada runtime;
488/488 críticos em cada runtime, zero falhas/skips. Cobertura crítica total
95,99% linhas / 89,16% branches, com gate por arquivo 90/80 aprovado nas duas
versões. O único aviso dos gates é o placeholder preexistente no template de
épicos. Regressão afetada: 64/64 por runtime. Consumidor instalado: 42/42 por
runtime; instalação offline com scripts desativados e binário SQLite compatível
com cada ABI provisionado explicitamente. Import Python opcional também PASS.

Lint, TypeScript, manifesto CLI e formato das fontes PASS. A varredura ampla de
formato identificou dois JSONs históricos de evidência; seus bytes/hashes foram
preservados. Não foram alterados gates nem normalizados logs de evidência.
Recibos: `evidence/adapters-composition/receipt.json` e
`evidence/installed-consumer/receipt.json`.

T3 permanece parcial: uma factory API implementada, três adapters de campanha e
ponte de composição Antigravity pendentes. T5 tem runner verificável, mas nenhuma
campanha real executada. Rotas/bindings, referências de acesso e teto USD foram
solicitados ao proprietário. A atividade 5 de commits/PR não foi iniciada porque
as entregas 1–4 ainda não estão completas. O estado segue temporário e candidato.

## Incremento — adapters nativos, ponte Python e revisão adversarial

As quatro factories estão registradas: API compatível, Codex conta/App Server,
Claude API/Agent SDK e Antigravity local/LiteRT. A ponte Python agora reserva a
chamada subordinada no orçamento da mesma campanha antes do efeito, fixa o filho
e exige conclusão da chamada para confirmar o pai. Processos têm limites finitos
e drain de descendentes; isso não certifica isolamento de filesystem.

Foram corrigidos: fechamento do ledger durante inspeção ativa, quota de requests
ocultando saldo monetário insuficiente, uso cumulativo Codex em vez do turno,
contagem de cache Claude, substituição silenciosa de sessão na retomada e ausência
de identidade de sessão nos recibos. `resume_from` exige recibo conhecido e nova
reserva. Exceção de quota desconhecida requer decisão explícita, motivo e prazo;
nenhuma foi criada para execução real. O SDK oficial também revelou requisito de
32 caracteres mínimos para conversa, agora validado no cliente e recibo Antigravity.

Validação final de código: Node 22 504/504 críticos, cobertura 96,08% linhas /
89,04% branches e gate por arquivo 90/80 PASS; Node 24 88/88 afetados. O checkpoint
crítico Node 24 anterior ao ajuste mínimo do identificador teve 504/504 e cobertura
96,08/89,03; a correção subsequente foi revalidada na suíte afetada Node 24 e na
suíte crítica completa Node 22. Não foi repetida a matriz integral npm test deste
novo snapshot. Os resultados 962/488 acima são históricos, não a certificação
atual. Lint, TypeScript, manifesto CLI e formato das fontes PASS.

O SDK oficial 0.1.18 aceitou configuração LiteRT com ferramenta única e UUID,
com rede/processos proibidos. Seu worker real passou na inspeção de metadados sob
cgroup. O checkpoint desse ensaio era placeholder; nenhuma inferência foi feita.
A revisão cética em ADVERSARIAL-REVIEW.md confronta implementação e alegações.
**W3 não aprovado para fechamento:** FR07, provisão/autorização real e retenção
operacional continuam abertos. T3 avançou na implementação; T5 não foi executada.
Os bindings/rotas, referências de acesso, checkpoint e teto USD do proprietário
continuam necessários. A condição anterior para commits/PR não foi satisfeita.

Evidências deste incremento: `evidence/campaign-adapters/receipt.json`.
A verificação ampla de whitespace encontra espaços emitidos nos logs brutos de
cobertura históricos; eles foram preservados. A verificação de fontes exclui
explicitamente esses recibos, sem alterar os gates ou seus limites.

Consumidor instalado final: 58/58 testes em Node 22 e 58/58 em Node 24, zero
falhas/skips; pacote com 1430 arquivos. Instalação offline com scripts desativados,
SQLite ABI correspondente provisionado explicitamente e import Python opcional
aprovado. A primeira tentativa falhou por erro de aspas no harness externo de
cópia dos fixtures; não era defeito do pacote. Logs dessa falha foram preservados.

## Campanha real — teto autorizado de US$ 10

O proprietário autorizou o teto global de US$ 10. Foi iniciada uma tentativa
Codex real, admitida por identidade e quota observadas. Ela ficou sem recibo e
permanece incerta, sem retry automático. O diagnóstico confirmou esgotamento do limite de processos pelo cliente.
Desabilitar os MCPs herdados teve sucessos isolados, mas não resolveu de forma
estável; a correção não foi certificada. Os experimentos não enviaram turnos
de modelo. Reconciliação explícita foi solicitada.
Claude tem credencial válida e SDK instalado, mas aguarda decisão sobre quota
indisponível. Referência da API compatível e checkpoint LiteRT continuam pendentes.
Detalhes em LIVE-CAMPAIGN-10USD.md. FR07 não está concluído; orçamento autorizado
não equivale a campanha executada com sucesso.

## Revalidação real — correções de recursos e retomada

Este resultado sucede o checkpoint acima. O piloto Codex concluiu criação e
retomada reais na mesma sessão, duas respostas exatas e replay idempotente. Foram
corrigidos o perfil finito de threads/processos (opcional 32–256; padrão 32) e a
atribuição indevida de consumo histórico ao turno novo. O teste adversarial de
identidade também revelou e corrigiu uma rejeição assíncrona não observada.

As duas tentativas históricas incertas foram reconciliadas para encerramento,
preservando a incerteza, as reservas e o histórico. Cinco despachos acumulados,
três recibos concluídos, zero micros comprometidos no ledger da rota de assinatura;
não é atestado de faturamento. Teto global de US$ 10 preservado entre ensaios.
Nenhuma API paga foi executada. Todas as campanhas destes ensaios estão canceladas.

Relatório atual: [LIVE-REVALIDATION.md](./LIVE-REVALIDATION.md). FR07 e fechamento
W3 continuam abertos para as outras três famílias e retenção operacional.

Regressão deste incremento: 65/65 em Node 22 e 65/65 em Node 24, zero falhas/skips;
lint, formato e governança CI PASS (um aviso preexistente). Matriz completa e
cobertura global não repetidas. Recibo: `evidence/live-revalidation/receipt.json`.

## Claude — exceção admitida, saldo insuficiente

O proprietário autorizou até duas chamadas Claude de US$ 2 cada. A primeira foi
admitida pelo controlador, mas o cliente registrou `billing_error` por saldo
insuficiente e zero tokens. A segunda não foi executada. Campanha cancelada sem
liberar a reserva incerta de US$ 2; teto global US$ 10, saldo não comprometido US$ 8,
seis despachos acumulados. Nenhuma cobrança foi confirmada. O proprietário confirmou
que Antigravity não está provisionado; escolha de provisionamento e referência ACP
continuam pendentes. Ver [CLAUDE-LIVE.md](./CLAUDE-LIVE.md) e seu recibo de evidências.

## Claude após créditos — inferência confirmada, recibo pendente

Com a recarga informada pelo proprietário, a tentativa restante gerou a resposta
exata e o cliente registrou US$ 0,002483. O adapter ainda terminou sem recibo;
retomada não exercitada. Campanha cancelada, resultado incerto preservado e nenhum
retry automático. Acumulado: sete despachos, US$ 4 de reservas conservadoras e
US$ 6 não comprometidos no teto global de US$ 10. As duas tentativas da exceção
Claude foram usadas; questionário enviado para até duas chamadas adicionais
limitadas, após preparação da captura de protocolo. Relatório:
[CLAUDE-FUNDED.md](./CLAUDE-FUNDED.md). FR07 continua aberto.

## Claude — recibo confirmado após correção do evento de progresso

As duas chamadas adicionais autorizadas foram usadas. O diagnóstico identificou
`system/thinking_tokens` não reconhecido pelo driver. Após correção restrita e
validação dos campos, a chamada real confirmou resposta exata, recibo e replay.
Reanexação real passou sem inferência; continuidade semântica em novo turno ainda
não exercitada. Regressão 76/76 em Node 22 e 76/76 em Node 24; lint/formato PASS.

Acumulado: nove despachos, quatro recibos concluídos, reservas conservadoras de
US$ 8 e saldo não comprometido US$ 2 no teto global US$ 10. Registros nativos Claude
somam aproximadamente US$ 0,00925, sem verificação de fatura. Relatório atual:
[CLAUDE-VERIFIED.md](./CLAUDE-VERIFIED.md). FR07 permanece aberto.

## Rota Antigravity local exercitada — 2026-09-26

Implementada conexão LiteRT controlada, sem aquecimento não contabilizado, com
métricas nativas e repasse explícito dos limites. Ferramentas mantêm admissão única
quando o SDK copia configurações. A composição aceita cliente terminal com
identidade preservada e sem recursão. Retomada usa RESUME e orçamento incremental
por turno, sem resetar o ledger.

Campanha final real: dois turnos Antigravity na mesma sessão, um filho Codex por
conta em cada turno, quatro dispatches, replay sem novos efeitos, encerramento
sem pendências e reserva adicional zero. Global permanece USD 10, sendo USD 8
retidos historicamente e USD 2 disponíveis. Node 22/24: 78/78 por runtime;
17 testes Python incluídos. Detalhes, limites e refutação das afirmações amplas em
[ANTIGRAVITY-LOCAL.md](ANTIGRAVITY-LOCAL.md) e `evidence/litert-local-verified/`.
Gemini API e teste de agente ACP não são declarados concluídos por este incremento.

## Teste ACP real — 2026-09-26

`codex-acp@1.13.1` exercitado com transporte HSEOS e Codex 0.157.1: sessão somente
leitura, resposta esperada, restart/load do histórico e cancelamento durante geração
confirmados; dois prompts por conta, sem API paga. Regressão ACP: 38/38 Node 24.
Admissão L0 foi testada separadamente e recusada já em initialize, sem inferência:
capacidades adicionais não aceitas e ausência de atestação de fronteira sem efeitos.
Teste de interoperabilidade concluído; integração L0/campanha não certificada.
Ver [ACP-REAL.md](ACP-REAL.md). Teto/reservas globais permanecem inalterados.

## ACP restrito integrado à campanha — 2026-09-26

Sequência 1 → 2 → 3 implementada: compatibilidade com agente fixado, composição
sem ferramentas verificável e factory integrada ao ledger existente. O checkpoint
ACP anterior permanece histórico; seu bloqueio de admissão foi resolvido para
esta composição, sem relaxar a ponte L0 genérica.

Campanha final: dois turnos reais na mesma sessão, replay sem novo dispatch,
encerramento cancelado e zero pendências/processos ativos. Prova offline recusa
execução, patch freeform, delegação e imagem, com zero ferramentas oferecidas.
Cancelamento durante resposta exercitado separadamente. Cache integra entrada;
parâmetro nativo de saída não suportado foi removido, sem alegar cap remoto.

Global: 22 dispatches de campanha acumulados, incluindo a tentativa ACP de
startup reconciliada; cinco prompts diagnósticos ACP fora do ledger, contando os
dois do checkpoint anterior. Reservas históricas USD 8, saldo de orçamento USD 2,
teto original USD 10 e nenhuma nova chamada API paga. Relatório e revisão
adversarial: [ACP-CAMPAIGN.md](ACP-CAMPAIGN.md). Escopo candidato fixado; certificação
multifamília, API Gemini e fechamento integral de W3 não são declarados concluídos.

Regressão afetada: 101/101 Node 22 e 101/101 Node 24. Lint/formato verificados e
CI com zero falhas, um alerta preexistente; markdownlint indisponível. Hash do
adapter da campanha final coincide com a fonte entregue. Evidências anteriores
permanecem imutáveis; merge e certificação integral W3 ainda não realizados.

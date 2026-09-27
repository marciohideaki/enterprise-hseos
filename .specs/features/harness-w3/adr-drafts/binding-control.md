# ADR draft — Controle de bindings e campanhas

Status: draft. Autoridade: solicitação W3 de 2026-09-26, ADR-0043/0044,
Constituição §§2.3/2.6/5/7; Data Contracts & Schema Evolution e Resilience Patterns.

Proposta: envelope versionado de controle/cobrança sobre bindings existentes,
com reservas e recibos no ExecutionEventLedger. Manter modelo, runtime delegado
e cliente do kernel distintos. Recusar nova admissão sob incerteza, quota
desconhecida, credencial concorrente ou drift de identidade/versão.

Alternativas rejeitadas: tokens de assinatura como API genérica; store independente
de orçamento; pooling de contas; elevar conformance por anúncio de SDK; fallback
sem sandbox. Todos enfraquecem a autoridade ou a rastreabilidade existente.

Consequências: integração oficial com menos controles pode atuar como cliente,
com limitações explícitas. A certificação real depende de provisionamento e
orçamento do proprietário. Rollback fecha admissões e preserva histórico, sem
reexecutar tentativas. Nenhuma ativação operacional acompanha este draft.

Refinamento candidato: permitir identidade explícita de credencial na rota API,
com fingerprint e `account_sha256: null`, sem alegar identidade de conta quando
a superfície não a fornece. Observação de saldo monetário USD admite reserva
sem converter percentuais em requests. O orçamento composto mantém reservas de
pai e modelos subordinados no mesmo stream, fixando composição e grant. Tarifas
declaradas/expiráveis não certificam faturamento remoto; custo desconhecido
preserva reserva. O runner de controle não certifica recuperação nativa.

Refinamento de quota desconhecida: uma autorização pode registrar exceção explícita
por binding, motivo e prazo limitado ao grant. Isso registra a decisão humana
prevista na especificação, sem inventar quota ou superar esgotamento observado.
Nenhuma exceção real foi autorizada nesta sessão. A ponte Python agora implementa
a composição; recibos conhecidos podem fixar uma retomada nativa com nova reserva.
A prova da campanha e da recuperação real permanece separada.

# W3 — Bindings oficiais, controle e cobrança

Tipo: especificação. Autoridade: solicitação explícita de 2026-09-26,
Constituição §§2.3/2.6/5/7, ADR-0043/0044 e docs/evolution/PLAN.md.
Base lógica W2; execução task/hseos-w3-prototype, feature/hseos-evolution-w3-bindings.

## Propósito, atores e escopo

Operadores individuais e clientes CLI/API/SDK escolhem integrações Codex, Claude,
provider compatível/ACP e Antigravity com controle verificável sobre execução, autenticação,
consumo e recuperação. Manter ModelProvider distinto de RuntimeProvider. Quando
delegação governada não for demonstrável, a integração deve atuar explicitamente
como cliente do kernel pela API existente, sem anunciar autoridade sobre o host.

## Requisitos funcionais

- FR01: manifesto versionado e estrito por binding, com fornecedor, versão,
  modo (modelo/runtime/cliente), transporte, rota oficial, autenticação,
  referência de credencial, cobrança, cotas e controles comprovados/indisponíveis.
  Reutilizar contratos e bindings existentes; preservar parsing/replay anteriores.
- FR02: catálogo classifica conta/assinatura, API e local por fornecedor conforme
  documentação oficial. Ausência de evidência é não verificado, nunca ilimitado
  ou certificação implícita. Não converter tokens de assinatura em chaves de API.
- FR03: admissão exige binding fixado, evidência da identidade/credencial
  efetivamente selecionada e orçamento finito. Credenciais concorrentes,
  expiradas, logout, quota esgotada ou status desconhecido impedem novo efeito
  até decisão explícita, sem perder sessão ou repetir chamadas.
- FR04: consumo é acumulado duravelmente por campanha/tarefa, reservado antes
  do efeito e não reiniciado por troca de binding, resume ou novo processo.
  Recibo perdido mantém reserva incerta e exige reconciliação vinculada ao estado.
- FR05: expor a mesma inspeção/admissão/consulta por CLI/API/SDK, com identidade,
  sequência esperada e idempotência, reaproveitando controle e ledger existentes.
- FR06: completar integração Antigravity por superfície oficial e reutilizar
  adapters existentes das outras três famílias. Nenhum SDK facultativo é carregado
  por help/import ou validação local. Falta de confinamento não permite fallback
  silencioso; usar composição declarada de cliente do kernel quando pertinente.
- FR07: campanha real individual executa tarefa delimitada e jornada de
  recuperação por binding elegível, registra versões, controle disponível,
  credencial efetiva (sem valor), consumo/custo, resultado e limitações. Demonstrar
  consumidores instalados e distinguir mocks de chamadas reais. Cobrir as quatro
  famílias; manter como pendente qualquer jornada não exercitada.
- FR08: testes cobrem login/logout, precedência de credencial, expiração/cota,
  concorrência, falha entre intenção/efeito/recibo, cancelamento, resume e troca
  de binding sem reset de orçamento. Matriz integral Node 22/24 e cobertura 90/80.

## NFR e constraints

Linux primeiro; execução e testes sequenciais. Segredos somente no host autorizado,
por referência; não em ledger, prompt, workspace, logs ou exemplos. API loopback
autenticada; nenhum novo SQLite de domínio ou servidor compartilhado. Seguir
Data Contracts & Schema Evolution, Resilience Patterns e Quality Gates; reusar
AgentRuntime/ToolRuntime, ExecutionEventLedger, políticas e SDKs.

## Fora de escopo

W4–W8, IDE, pooling de contas, redistribuição de binários externos, mudança de
credenciais, publicação e ativação operacional. A campanha não autoriza compras
nem inferência sem bindings e teto financeiro fornecidos pelo proprietário.

## Dependências externas e aceite

Bindings/contas e teto financeiro foram solicitados ao proprietário nesta sessão.
Essa provisão não impede especificação, implementação e validação determinística;
impede o aceite FR07 e a conclusão integral de W3 enquanto faltar. A campanha
real não será substituída por fixtures ou reclassificada como fora de escopo.

## Decisão do proprietário — 2026-09-27

Instrução explícita: “A quarta familia só sera testada e validada após a conclusao
de todas as fases!”. A campanha e validação reais da família API compatível
ficam diferidas para o fechamento de todas as fases. Sua credencial não bloqueia
mais o avanço ou aceite das demais entregas de W3. O requisito FR07 dessa família
continua pendente e rastreável; não pode ser declarado PASS por testes de ACP
sobre Codex nem por fixtures. Não há dispensa de implementação ou de testes
determinísticos dessa família.

O aceite da entrega corrente de W3 deve explicitar essa pendência diferida, sem
alegar a campanha completa das quatro famílias. FR08 permanece integralmente
obrigatório. Antigravity fica por último entre os ensaios das famílias atuais,
conforme instrução anterior; esta decisão não autoriza W4–W8, publicação ou merge.

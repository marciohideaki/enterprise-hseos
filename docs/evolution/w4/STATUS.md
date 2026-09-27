# W4 — estado de execução

Tipo: evidência de progresso, 2026-09-27. Base 32eaef2; upstream
feature/hseos-evolution-foundation; feature/hseos-evolution-w4.
Governança: Constituição §§2.6/5/7, AGENTS.md, ADR-0045 Proposed.

## W4-01

Contratos/spec/design/tasks/intake produzidos. Ensaio do executor herdado Node24:
13 testes, 13 PASS, zero falhas/skips, incluindo filesystem readonly, rede negada,
cancelamento/órfãos e incerteza de drain. Isso verifica ambiente/reuso; não certifica
plugins/jobs W4. Comando/resultado em evidence/contracts/isolation-node24.log.
Launcher systemd delegado resolve a falta de cgroup no processo da sessão.
Node24 24.15.0 e Node22 22.23.3 disponíveis; host Linux x64, Python 3.14.4/bwrap.

Suítes completas não executadas nesta task documental. Carga no pré-check acima
dos seis núcleos físicos; manter testes focados e sequenciais até capacidade adequada.
Gate governado passou: zero falhas, um aviso de placeholder preexistente.
Código/testes não alterados; gate selecionou escopo documental pelos arquivos staged.
Revisão adversarial: a persistência temporária não é anunciada como operacional;
conformance externa não reutiliza host; FR01–FR08 têm tasks/células; campanhas e
ativação continuam pendentes. Contratos prontos para W4-02a.

## Matriz de entrega

| Etapa         | Determinístico           | Consumidor real | Ativação       |
| ------------- | ------------------------ | --------------- | -------------- |
| W4-01         | contratos verificados | não aplicável   | não autorizada |
| W4-02 a W4-06 | pendente                 | pendente        | não autorizada |
| W4-07         | pendente                 | pendente        | não autorizada |
| W4-08         | pendente                 | pendente        | não autorizada |

## Limites e continuidade

- Estado atual do controle é fixture temporária; persistência operacional não certificada.
- US$ 10 de teto e US$ 9 reservados preservados; nenhuma chamada de campanha nesta task.
- W5–W8 e recibos W3 intactos. Arquivo alheio HSEOS-GOAL-HARNESS-AUTONOMO.md preservado.
- ADR Proposed documenta design candidato, não aprovação institucional.
- AEW disponível, stack resolve sem base; aplicação/enforcement não verificados.
- Preflight: registro vault sem modules.md/integrations.md; Axon index não encontrado;
  flag .compacted-without-end-session observada. São avisos, sem mutação de memória.

## W4-02a — admissão candidata

Implementados descritor estrito v1, leitura de catálogo v3 com compatibilidade v2,
hashes/paths/limites, dependências pinadas e admissão nominal sem import de código.
13 testes focados em Node22/24; marketplace 88 PASS. Cobertura e revisão em
evidence/admission/. Gate integral anterior à revisão passou; commit depende do
gate atualizado no hook. Instalação/execução isolada ainda é a próxima task.

## W4-02a integrada / W4-02b em validação

Admissão commitada em feee73c e integrada em d87d964 após gate e hook completo
Node24, incluindo PostgreSQL compartilhado sem skip. W4-01: 344fc13/cae04c8.
W4-02b implementa snapshot readonly, execução/CJS/ESM/conformance isolados e drain.
13 testes focados Node22/24 passaram; evidência/revisão em evidence/isolation/.
Gate integral Node24 passou, zero falhas, um aviso preexistente; recibo em
evidence/isolation/full-gate-receipt.json. Hook de commit ainda revalida.
W4-02c e W4-03–08 permanecem pendentes.
Não houve chamada de campanha, gasto adicional, publicação ou ativação.

## Ponto de retomada — W4-02c2b

W4-02b 00e2881/b68d7cb; W4-02c1 4efbe89/9a03224; W4-02c2a 6253233/414d73f.
Gates e hooks Node24 aprovados. Recibo mais recente do hook em
 evidence/plugin-providers/prior-campaign-commit.log.gz.
Task atual .worktrees/hseos-w4-plugin-providers, branch task/hseos-w4-plugin-providers.
ModelProvider e RuntimeProvider L0 isolados pela ponte de campanha implementados;
65 testes Node22/24 passaram, zero skips, cobertura crítica acima de 90/80.
Revisão independente corrigiu validação tardia; gate integral renovado passou. Composição pública de tarefa (c3), W4-03–08
continuam pendentes. Nenhuma chamada paga, publicação, merge de PR ou ativação.

Recursos: heavy-run --pin --mem 3G; 1 CPU não zero/nice19, controlador e executores
no mesmo cgroup delegado limitado. Node24 /workspace/local/sdk/nvm/versions/node/v24.15.0/bin;
Node22 /build/tmp/hseos-w1-node/node-v22.23.3-linux-x64/bin. Link temporário SQLite
12.9.0 para Node22 removido após ensaio. Suíte integral usa PostgreSQL compartilhado
via túnel 127.0.0.1:39317; pass platform-shared-dev/postgres-platform e referência
enterprise-hseos/ci-postgres-reference. Não imprimir credenciais.

## W4-02c2b integrada / W4-02c3a em validação

Providers: commit 0678177, integração 7de3008, gate e hook Node24 aprovados.
Seleção durável em .worktrees/hseos-w4-plugin-selection, base 7de3008:
8 testes de seleção/distribuição Node22/24 passaram; cobertura 100/100.
Revisão independente em duas passagens, sem bloqueios. Gate integral Node24 passou; hook pendente.
Próximo: composição de tools/context/model pinados em tarefas (W4-02c3b).
W4-03–08 continuam pendentes; sem publicação, campanha paga, PR ou ativação.

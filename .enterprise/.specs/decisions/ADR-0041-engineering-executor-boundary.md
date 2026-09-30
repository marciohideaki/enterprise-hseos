# ADR-0041 — Fronteira do executor de engenharia

**Status:** Accepted (candidate implementation only)
**Date:** 2026-09-20
**Affects Standards:** Enterprise Constitution §5.1/§10; Security & Identity;
Tool Design Governance; ADR-0012/0024/0040

## Status

Accepted para implementação candidata pela seleção explícita do responsável em
2026-09-24; ver decisão registrada ao final. Antes dessa decisão, permaneceu Proposed.
Não altera o supervisor ativo, o broker, controles globais ou gates G9/A13.

## Context

ADR-0040 foi aprovado para implementação candidata. Sua condição de parada exige
nova decisão quando o backend adotado não comprova a separação necessária.
No ambiente observado, ai-jail 1.20.0 executou Node e Python sob lockdown, mas
manteve o workspace montado do host somente leitura mesmo com rw-map explícito.
Isso não impede escrita no /tmp privado: o probe posterior comprovou escrita/leitura
interna, e a inferência de incapacidade total do backend foi retirada.

O bloqueio adicional comprovado é a visibilidade do runtime/broker temporário do
supervisor existente. A cópia Node não executou antes nem depois de acrescentar
map somente leitura: o dry-run de lockdown não incorporou esse map. A tentativa
foi preservada e revertida; não houve promoção de patch ineficaz. O supervisor
permanece fail-closed antes de provider/segredo. Corrigir o provider externo ou
seu perfil por revisão governada é alternativa à proposta abaixo.

A inspeção de dry-run também mostrou mounts somente leitura de /opt e /etc.
Isso não prova isolamento do código arbitrário em relação a todo controle externo;
a integração do broker usa /opt conforme ADR-0012. Não foi lido nenhum segredo.

Já existe packages/agent-isolation-attestation, com backend bwrap que monta apenas
workspace gravável e diretórios de executáveis somente leitura, sem /opt, /etc,
home, checkout principal ou sockets do supervisor. A suíte existente passou 6/6
no ambiente real. Essa evidência demonstra conformance do probe; não demonstra um
executor de tarefas pronto nem cancelamento de todos os seus descendentes.

## Decision

Propomos estender a capacidade existente de isolamento bwrap para duas fronteiras
candidatas, selecionadas explicitamente: worker confiável e executor de código.
O worker recebe os mounts ro exatos do runtime/pacote e do broker privado, com
identidade/digests verificados; somente ele conversa com o broker. O executor recebe
apenas seu workspace descartável e runtime, sem broker ou controles do worker.

Isso requer decisão sobre o uso direto do backend no candidato, além do papel
atual de conformance. ADR-0012 permanece aplicado ao perfil ativo; a proposta é uma
exceção delimitada ao novo candidato, sem editar ou contornar o supervisor atual.
Não introduzir fallback automático para standard ou executar sem isolamento.

- Reutilizar identidade de workspace, política nominal, seccomp e verificações de
  bindings da capacidade existente, sem copiar código de terceiros.
- Executar somente comandos exatos de contratos de tarefa validados; não fornecer
  shell ou parâmetros de montagem escolhidos pelo modelo.
- Código de tarefa recebe somente workspace descartável e runtime necessário ro.
  Não receber broker, credenciais, /opt, controles, ledger ou testes protegidos.
- Demonstrar isolamento de rede/IPC, limites finitos de processos/saída/tempo e
  cancelamento da árvore antes de habilitar qualquer ferramenta executável.
- Integrar ao ToolRuntime/AgentRuntime existentes. Preservar efeito incerto,
  orçamento de sessão, replay/snapshot versionado e verificação independente.
- Ambiente sem as garantias requeridas permanece bloqueado. Não instalar backend,
  mudar AppArmor/sysctl, adicionar privilégios ou alterar anchors ativos.

A aprovação autorizaria somente implementar e validar esse candidato em fixtures.
Merge, pacote, providers pagos, consumidores reais e ativação continuam separados.
A alternativa é corrigir/versionar o provider externo ou seu perfil para comprovar
os mesmos mounts e a separação exigida; nesse caso, o novo backend não é necessário.
A seleção da alternativa é a decisão solicitada, não uma alegação de equivalência
já demonstrada entre implementações.

## Alternatives Considered

| Alternativa | Avaliação |
|---|---|
| Desativar lockdown | Rejeitada: fallback menos restritivo, sem prova equivalente |
| Aguardar mudança no provider externo | Válida; depende de revisão com garantias comprovadas |
| Estender capacidade bwrap existente | Proposta: separa executor do broker sem outro kernel |
| Executar código no host | Rejeitada: viola a fronteira aprovada |

## Consequences

Reutiliza capacidade local já testada, mas amplia sua responsabilidade de conformance
para execução. Exige manutenção e revisão de segurança; o probe atual não basta.
O primeiro suporte permanece Linux x64; demais ambientes falham fechado.

## Mitigations

Candidato desligado, provas adversariais, verificador fora do executor, limites
transitivos, ausência de fallback e promoção somente com autoridade separada.
Rollback remove seleção candidata e fixtures, preservando estado/evidências atuais.

## Acceptance

Testes de comandos Node/Python; proteção de controles e sockets; rede negada;
limites e cancelamento de descendentes; manipulação de links/mounts; deriva de
binding; falsificação de resultado; falha fechada; integração pública com ToolRuntime;
compatibilidade de snapshot; instalação limpa; gates e revisão independente.
Os critérios completos do ADR-0040 e da missão permanecem aplicáveis.

## References

- [ADR-0012](ADR-0012-agent-os-sandboxing.md)
- [ADR-0024](ADR-0024-model-agnostic-agent-framework.md)
- [ADR-0040](ADR-0040-disposable-engineering-execution.md)
- [Enterprise Constitution](../constitution/Enterprise-Constitution.md)
- [ADR Policy](../../policies/adr-policy.md)
- packages/agent-isolation-attestation/index.js; test/test-agent-transitive-isolation.js
- _graph/agentic-framework/state/checkpoints/H4-engineering-boundary.md

## Decisão do responsável — 2026-09-24

O plano HSEOS v4 fornecido pelo responsável nesta sessão seleciona explicitamente
a extensão do isolamento bwrap existente, mantendo inalterado o perfil ativo
ai-jail. A implementação e verificação candidata estão autorizadas por esse plano.
Esta decisão substitui a pendência de seleção acima, preservada como histórico.
Não autoriza merge, publicação, instalação global, providers pagos ou ativação.

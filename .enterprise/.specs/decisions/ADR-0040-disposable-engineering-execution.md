# ADR-0040 — Execução de engenharia em workspace descartável

**Status:** Accepted
**Date:** 2026-09-20
**Authors:** Platform Architecture — proposta para revisão humana
**Affects Standards:** Enterprise Constitution §5.1 e §10; Agent Rules AR-38/39/47/50; Security & Identity Standard; Tool Design Governance Standard; ADR-0024
**Supersedes:** N/A
**Superseded By:** N/A

## Status

Accepted. Aprovação humana explícita em 2026-09-20, mensagem “Aprovado!” nesta
sessão, referente à proposta no commit 96b7a39a515af15ec1a176fdb4fc6ac3ee41fcb1.
A aprovação não comprova implementação ou ativação. Seu escopo permite
implementar e testar um candidato isolado; não autoriza merge, publicação, migração,
uso pago de providers, mudança do runtime global ou cutover G9/A13.

Artifact type: Architecture Decision Record.
Scope: fronteira de ferramentas e verificação para a missão de engenharia autônoma.
Governing documents: Enterprise Constitution; ADR Policy; Automated Validation Rules;
ADR-0022/0023/0024; contrato de intenção HSEOS-GOAL-HARNESS-AUTONOMO.md v1.0.

## Context

No baseline a8423081934d64538d71ef8289f072d51566a870, o perfil público nativo
monta somente createTemporaryStateTool em tools/cli/lib/bound-kernel-agent-runtime.js.
A autoridade temporary-only e a ferramenta temporary.set-state permitem escrever
JSON em uma fixture privada. Não permitem ao modelo implementar e testar software.
Os perfis delegados anunciam somente instruções ou uma execução sem ferramentas;
esses limites devem permanecer honestos.

O supervisor existente impõe sandbox obrigatório, broker Unix sem rede no worker,
resolução tardia de credenciais e promoção validada de snapshot. O snapshot v1 tem
um conjunto fechado de arquivos, incluindo apenas workspace/world-state.json como
artefato opcional. Adicionar execução de programas e arquivos de projeto altera a
superfície de efeitos e a fronteira de confiança; não é apenas adicionar texto ao prompt.

H1 (92dd027) corrige o exit status da CLI; H2 (deecfcf) impede conclusão fictícia no
provider determinístico após falha real de escrita. São commits locais independentes,
com gates completos aprovados, sem merge. Não resolvem a execução de engenharia.

Consultas ao grafo/corpus e inspeção do catálogo foram registradas em H1/H2. A extensão
reutiliza AgentRuntime, ToolRuntime/ExecutionContractRegistry, SessionEventStore,
supervisor, broker e sandbox existentes. Não cria um segundo orquestrador ou ledger.

## Decision

Propomos estender o kernel existente com uma capacidade candidata, desligada por
padrão, para tarefas em workspaces descartáveis. A implementação começa somente após
aprovação desta decisão. Não ampliar silenciosamente temporary-only nem os adapters L0.

### Contrato e caminho público

1. Estender `hseos agent run` por seleção explícita de contrato de tarefa; o nome da
   opção e o schema devem ser implementados e testados antes de serem documentados
   como comandos disponíveis. A extensão usa o mesmo supervisor e kernel.
2. Usar contrato versionado para fontes/digests, requisitos e aceite, arquivos
   iniciais, escopo de leitura/escrita, comandos permitidos, perfil/runtime,
   orçamento finito, verificador e rollback. Validar tudo antes de segredos/processos.
   Reutilizar schemas de sessão/ferramentas; o contrato de tarefa referencia esses
   contratos, sem duplicar configuração de provider ou autoridade.
3. Materializar fontes do projeto como dados com procedência; documento/memória não
   ganha papel de instrução privilegiada. Contradição de intenção bloqueia a tarefa.
4. Primeiras stacks de fixture: JavaScript/Node e Python, sem dependências externas.
   Interpretador ausente ou fora do perfil comprovado bloqueia a tarefa. Não instalar
   pacotes, baixar executáveis ou criar serviços implicitamente.

### Ferramentas e isolamento

- Leitura e escrita por paths relativos declarados, limites de bytes e checks de
  traversal, symlink, hardlink e identidade do workspace. Nada de acesso arbitrário
  ao checkout operacional, home, credenciais ou estado do supervisor.
- Execução de build/teste com executável e argumentos declarados no contrato,
  sem interpolação em shell. Código e subprocessos executam numa fronteira de OS
  comprovada: rede negada, runtime necessário somente leitura, workspace descartável
  gravável, estado/policy/verificador fora do alcance, sem sockets privilegiados.
- Preferir o backend já adotado. Se ele não comprovar essa separação para código
  arbitrário e descendentes, falhar fechado e apresentar nova decisão; não adicionar
  fallback permissivo nem mudar parâmetros globais de segurança.
- Cancelamento/deadline interrompe a árvore inteira e impede novos despachos. Limites
  de tempo, saída, chamadas e recursos pertencem à sessão e não são reiniciados por retry.
- Tentativa com efeito incerto permanece incerta até reconciliação; não repetir
  cegamente. A correção do modelo continua limitada a duas tentativas malsucedidas.

### Aceite independente e durabilidade

- Ferramentas de teste do projeto são feedback do executor; não concedem aceite final.
- Verificador determinístico independente avalia os artefatos/resultados. Policy,
  rubrica, dados de referência, testes protegidos e autoridade ficam fora do contexto
  e do alcance do executor. Não montar respostas de referência na sandbox do candidato.
- Promover artefatos somente após checks de efeito; texto do modelo ou exit 0 isolado
  não comprova a entrega. Registrar approved/failed/blocked/not-executed sem confundi-los.
- Versionar o snapshot para incluir o conjunto exato de artefatos declarado e limitado,
  preservando leitura/replay do formato v1. Validar paths, tamanho, digests, vínculo
  contrato/sessão, revisão e sandbox antes da promoção ou retomada.
- Não migrar stores reais. Validar queda, retomada, drift, cancelamento e invalidação
  de evidência somente em stores descartáveis nesta etapa.

## Acceptance and rollout

A aprovação arquitetural não é prova de implementação. O candidato deve demonstrar:

1. Caminho público docs → contrato → escrita de código → teste → verificador →
   evidência, inicialmente com transporte determinístico claramente rotulado.
2. Falha fechada sem capacidade/sandbox; desligado sem efeitos implícitos.
3. Fixtures negativas: traversal, links, subprocessos, rede, leitura/escrita de
   controles e segredos, adulteração de verificador/evidência e saída falsa.
4. Cancelamento transitivo, efeito incerto, retomada e contrato alterado sem retry cego.
5. Instalação limpa e atualização recuperável a partir do pacote, sem paths pessoais.
6. Gates completos na revisão entregue e revisão independente proporcional ao risco.
7. Campanha real separada: três tarefas, duas stacks, duas famílias de backend e
   três repetições, total 18 execuções; bindings e orçamento requerem autoridade própria.

Sequência: implementação de candidato em worktree; conformance negativa e positiva;
empacotamento; ensaios reais autorizados; revisão de ativação separada. Não alterar
anchors ativos desta sessão. Projeções compiladas afetadas só entram pela governança
específica e revisão do diff; este ADR não concede override genérico de âncoras.
G9 continua exigindo janela real, consumidores/release, auditoria e aprovação explícita.
Rollback de candidato: remover sua seleção e descartar fixtures/artefatos da tarefa;
manter logs e checkpoints. Sem alteração do runtime ativo nesta proposta.

## Consequences

### Positive

Reutiliza o kernel existente, conecta especificações a efeitos verificáveis e permite
comparar backends sem entregar autoridade de aceite ao modelo.

### Negative / Trade-offs

Amplia a superfície de segurança e requer prova de isolamento de processos. O primeiro
recorte sem dependências externas não equivale a suporte a todo projeto legado.
Contratos/snapshots precisam de compatibilidade versionada e testes adicionais.

### Risks

Código hostil pode tentar atingir o controle, exfiltrar dados ou adulterar testes.
O backend instalado pode não oferecer as garantias necessárias. Resultados reais podem
não caber no orçamento. Todos esses casos devem permanecer bloqueios visíveis.

## Mitigations

Perfis desligados por padrão, autoridade por interseção, isolamento comprovado por
fixtures adversariais, segredos somente no broker, verificador fora da sandbox do
executor, orçamentos finitos, compatibilidade v1 e ausência de promoção automática.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Enterprise Constitution | §5.1, §10 | Registra decisão de fronteira; não altera autoridade humana |
| ADR-0024 | ToolRuntime, security, activation | Completa ferramentas no kernel; preserva gates |
| Agent Rules | AR-38/39/47/50 | Timeouts/retries/testes obrigatórios; nenhuma exceção |
| Security & Identity / Tool Design Governance | Isolamento e mediação de efeitos | Aplica a programas e descendentes |
| ADR-0022/0023 | Compatibilidade e cutover | Nenhuma redução ou ativação |

## Compliance

- [x] Approved by repository owner — explicit session approval, 2026-09-20
- [ ] Affected standards reviewed; no automatic modification authorized
- [ ] Consumer documentation and generated projections reviewed before delivery
- [ ] Activation date: pending separate authority and G9/A13 evidence
- [ ] Review date: before enabling any real consumer profile

## Alternatives Considered

| Alternative | Disposition |
|---|---|
| Chamar o smoke JSON de engenharia autônoma | Rejeitada: não satisfaz DOD-05/06/20 |
| Liberar shell no perfil atual | Rejeitada: amplia autoridade sem isolamento comprovado |
| Delegar efeitos a adapter L0 | Rejeitada: contorna a mediação do kernel |
| Criar runtime/ledger paralelo | Rejeitada: duplica mecanismos existentes |
| Candidato explícito sobre kernel/ToolRuntime | Proposta, sujeita à aprovação |

## References

- [ADR-0024](ADR-0024-model-agnostic-agent-framework.md)
- [ADR Policy](../../policies/adr-policy.md)
- [Enterprise Constitution](../constitution/Enterprise-Constitution.md)
- [Agent Rules](../core/AGENT%20RULES%20STANDARD.md)
- Contrato de intenção: HSEOS-GOAL-HARNESS-AUTONOMO.md, fornecido pelo usuário.
- Fontes observadas: tools/cli/lib/bound-kernel-agent-runtime.js,
  bound-kernel-supervisor.js, bound-kernel-state-snapshot.js, temporary-kernel-assembly.js.

---
tags: [pipeline, rfc, architecture, governance, control-plane]
status: em-andamento
created: 2026-08-31
updated: 2026-08-31
---

# RFC: Managed Governance Control Plane

**Autor:** Platform Governance  
**Data:** 2026-08-31  
**Status:** Draft — não normativo  
**Tipo de artefato:** RFC de arquitetura e governança  
**Escopo:** HSEOS, consumidores gerenciados e futuro serviço central de governança

## 1. Sumário executivo

Este RFC propõe um modo opcional de governança gerenciada para o HSEOS. Nesse modo, uma console
central administra políticas, bindings, versões, rollout, aceites, leases, revogações e auditoria;
um preflight valida a governança aplicável antes de liberar cada sessão; hooks e o runtime executam
enforcement local; e o MCP oferece consulta e explicação estruturadas aos agentes.

A análise dos contratos atuais conclui que fazer do PostgreSQL a fonte direta de todo conteúdo
normativo não é a melhor primeira decisão. A abordagem recomendada é:

1. **Git institucional continua canônico para governança publicada.** A governança deixa de ser
   copiada e editada em cada projeto, mas continua versionada, revisável e recuperável em um
   repositório central.
2. **PostgreSQL é canônico para o estado operacional do control plane:** tenants, identidades,
   bindings, drafts, assignments, rollout, aceites, leases, revogações, auditoria e outbox.
3. **Governance Releases imutáveis e assinadas são a unidade de distribuição.** O runtime nunca
   consulta tabelas mutáveis para decidir uma ação em curso.
4. **O MCP é adapter read-only, não autoridade independente nem único enforcement point.** CLI,
   hooks e MCP consomem o mesmo `GovernanceClient` e o mesmo policy decision port.
5. **Cada sessão é vinculada a uma release e a um digest.** Mudança material exige reconhecimento
   explícito antes da continuidade; aprovação de ações críticas permanece separada.
6. **O modo portable existente permanece suportado.** O modo managed é opt-in e preserva um
   bootstrap local mínimo e um snapshot assinado last-known-good.

Se, após operação real, houver evidência de que Git não atende ao ciclo de publicação, um ADR
posterior poderá propor PostgreSQL como fonte normativa. Essa segunda etapa exigiria emenda à
Constituição e substituição explícita de decisões aceitas; não é necessária para entregar o valor
pretendido agora.

## 2. Documentos governantes

Esta proposta é subordinada a:

- `.enterprise/.specs/constitution/Enterprise-Constitution.md`, especialmente §§2.1, 2.5, 3, 4,
  5 e 7;
- `.enterprise/policies/adr-policy.md`;
- `.enterprise/policies/automated-validation.md`;
- `.enterprise/policies/specification-consumption.md`;
- `.enterprise/.specs/core/Engineering Governance Standard.md`;
- `.enterprise/.specs/cross/Security & Identity Standard.md`;
- `.enterprise/.specs/cross/Data Governance & LGPD Standard.md`;
- `.enterprise/.specs/cross/Data Contracts & Schema Evolution Standard.md`;
- `.enterprise/.specs/cross/Tool-Design-Governance-Standard.md`;
- ADR-0001, ADR-0002, ADR-0003, ADR-0006, ADR-0007, ADR-0008, ADR-0022, ADR-0023,
  ADR-0024, ADR-0025, ADR-0026, ADR-0027, ADR-0029, ADR-0030 e ADR-0031.

Este RFC não altera esses documentos. Qualquer implementação que mude autoridade exige um novo
ADR com status inicial `Proposed` e aprovação humana antes da ativação.

## 3. Problema

O HSEOS atual possui boa portabilidade e rastreabilidade, mas distribui a governança como árvores de
arquivos por instalação. Esse modelo cria custos crescentes:

- atualização e rollout por repositório;
- dificuldade para saber qual release efetiva cada projeto está consumindo;
- ausência de console para editar, comparar, simular e publicar políticas;
- falta de bindings centralizados por organização, projeto, ambiente, branch e agente;
- aceites, exceções e revogações sem lifecycle central;
- pouca visibilidade sobre drift, versões vencidas e clientes incompatíveis;
- necessidade de recarregar documentos extensos quando uma decisão estruturada seria suficiente;
- dificuldade para revogar rapidamente uma política comprometida;
- duplicação de conteúdo normativo entre consumidores.

O problema não é Markdown em si. O problema é usar cópias locais editáveis como mecanismo de
distribuição, configuração e controle de lifecycle para governança organizacional.

## 4. Por que agora

A proposta tornou-se viável porque o HSEOS já dispõe de fundações relevantes:

- identidade imutável de repositório por `repository-contract/v1`;
- compiler multi-adapter com hash-pinning e detecção de drift;
- MCP nativo de governança;
- hooks tipados com lifecycle explícito;
- policy/approval port no runtime governado;
- ledger relacional, eventos versionados, outbox e projeções;
- contratos de schema fail-closed;
- catálogo de superfícies que distingue core, module, sidecar, candidate e compatibility;
- migração v3 com fronteiras de compatibilidade explícitas.

Essas fundações reduzem a necessidade de criar um segundo modelo de execução. O control plane deve
usar os contratos existentes e adicionar apenas o bounded context de governança gerenciada.

## 5. Estado atual do HSEOS

### 5.1 Autoridade documental

| Área                                     | Autoridade atual                | Projeção/consumidor                   |
| ---------------------------------------- | ------------------------------- | ------------------------------------- |
| Constituição, standards, policies e ADRs | `.enterprise/` em Git           | MCP, skills, agentes e revisão humana |
| Catálogos canônicos                      | `.enterprise/governance/`       | `.agents/` compilado                  |
| Instruções portáveis                     | `AGENTS.md` + fontes governadas | adapters compilados                   |
| Manifest e assinaturas                   | compiler local                  | verify, audit, doctor e SessionStart  |
| Hooks                                    | registry/handlers canônicos     | adapters por plataforma               |
| Workflows                                | registry canônico               | CLI e MCP por loader compartilhado    |
| Estado operacional                       | ledger/tabelas SQLite           | Markdown, Kanban, JSONL e telemetria  |

### 5.2 MCP de governança

O MCP atual contém cinco consultas e lê diretamente arquivos do repositório por um `spec-reader`:

- `query_constitution`;
- `validate_adr`;
- `check_authority`;
- `list_skills`;
- `list_workflows`.

Ele usa cache em memória, não resolve tenant/binding/release, não emite policy decision, não valida
aceite e não possui estado de sessão. Seu papel atual é consulta documental.

### 5.3 SessionStart e hooks

Os hooks atuais registram sessão, exibem navegação, emitem estado e executam guards específicos. Não
existe um preflight universal bloqueante que:

- resolva a identidade do repositório;
- valide uma release de governança assinada;
- verifique revogação e compatibilidade;
- exija reconhecimento de mudança material;
- vincule uma lease à sessão.

Nem todo adapter oferece um hook `SessionStart` bloqueante. Portanto, apenas adicionar um hook não
prova enforcement universal.

## 6. Matriz de compatibilidade com os contratos existentes

| Fonte atual                               | Relação com a proposta                       | Tratamento requerido                                                                      |
| ----------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Constituição §2.1 — Git como fonte única  | Preservada pela recomendação                 | Publicações normativas continuam em Git institucional                                     |
| Constituição §§3–4 — layout e precedência | Estendida no modo managed                    | Novo ADR deve definir release assinada como projeção consumível                           |
| Constituição §5 — autoridade humana       | Preservada                                   | Console não aprova automaticamente; publication exige autoridade humana                   |
| ADR-0003 — write side relacional          | Compatível                                   | PostgreSQL é autoridade do estado mutável do control plane                                |
| ADR-0006 — standalone e zero global path  | Parcialmente tensionado                      | Managed é opt-in; portable permanece; snapshot local impede dependência online permanente |
| ADR-0007 — compiler multi-adapter         | Estendido                                    | Nova source port para Governance Release, sem parser por adapter                          |
| ADR-0008 — MCP project-local              | Estendido                                    | Binding continua project-local; servidor pode delegar a serviço remoto autenticado        |
| ADR-0022 — policy, approval e ledger      | Reutilizado por contrato                     | Novo bounded context; não compartilhar tabelas com execution ledger                       |
| ADR-0023 — MCP stateless                  | Preservado                                   | MCP delega ao governance port; não cria authority/session model próprio                   |
| ADR-0024 — runtime neutral                | Preservado                                   | Preflight, snapshot e decisões são independentes de adapter                               |
| ADR-0025 — provenance documental          | Preservado e ampliado                        | Toda release carrega origem, commit, issuer, digest e assinatura                          |
| ADR-0026 — fonte canônica do catálogo     | Preservado em portable; estendido em managed | Central Git publica o catálogo; `.agents` continua compilado                              |
| ADR-0027 — hooks e workflows explícitos   | Preservado                                   | Novo hook com status, blocking, fallback e schema explícitos                              |
| ADR-0029 — pacote limitado                | Preservado                                   | Core recebe somente contratos/client; control plane e UI têm lifecycle separado           |
| ADR-0030 — lifecycle de superfícies       | Estendido                                    | Registrar client como module/candidate e control plane como sidecar/service opt-in        |
| ADR-0031 — boundary v3                    | Preservado                                   | Shadow mode pode ser aditivo; retirada da autoridade local exige major posterior          |
| `repository-contract/v1`                  | Preservado                                   | Continua sendo identidade; binding managed usa contrato separado                          |
| `manifest.yaml` atual                     | Precisa evoluir                              | Novo schema para release, issuer, signature e source kind                                 |

## 7. Decisão proposta

### 7.1 Dois modos explícitos

O HSEOS passa a reconhecer:

```yaml
governance:
  mode: portable | managed-shadow | managed-enforced
```

- `portable`: comportamento atual; fontes locais em Git permanecem canônicas.
- `managed-shadow`: resolve release remota, compara contra fontes locais e registra divergência, sem
  bloquear execução.
- `managed-enforced`: exige binding, snapshot válido, release não revogada e lease de sessão.

Não haverá fallback silencioso de `managed-enforced` para `portable`. Uma instalação gerenciada que
perde sua prova de autoridade deve falhar fechado para mutações governadas.

### 7.2 Separação entre conteúdo normativo e estado operacional

| Dado                                                | Autoridade proposta       | Observação                               |
| --------------------------------------------------- | ------------------------- | ---------------------------------------- |
| Constituição, standards, policies e ADRs publicados | Git central institucional | Tags/commits imutáveis e PR review       |
| Catálogos publicados                                | Git central institucional | Compiler gera release assinada           |
| Drafts da console                                   | PostgreSQL                | Não normativos até publicação            |
| Bindings e assignments                              | PostgreSQL                | Estado operacional versionado e auditado |
| Aceites e leases                                    | PostgreSQL                | Nunca ampliam autoridade operacional     |
| Rollout e revogações                                | PostgreSQL                | Revogação é online e assinada            |
| Audit trail e outbox                                | PostgreSQL                | Append-only, com retenção explícita      |
| Governance Release                                  | Artifact store + Git tag  | Imutável e content-addressed             |
| Snapshot local                                      | Cache assinado            | Last-known-good; não editável como fonte |
| Segredos                                            | Secret manager            | Apenas referências no control plane      |

### 7.3 Bounded contexts

1. **Governance Authoring** — drafts, validação, review e publicação.
2. **Governance Catalog** — artifacts, versões, relações e provenance.
3. **Policy Resolution** — precedência e política efetiva por subject/scope.
4. **Release Management** — compilação, assinatura, rollout, rollback e revogação.
5. **Session Governance** — preflight, reconhecimento, lease e refresh.
6. **Governance Audit** — eventos, outbox, retenção e consulta.

Esses contextos não compartilham tabelas com o execution ledger. Integração ocorre por contratos e
referências (`repository_id`, `policy_version`, `operation_id`, `release_id`).

## 8. Arquitetura lógica

```text
                           Governance Console
                                   |
                             Admin API / BFF
                                   |
          +---------------- Governance Control Plane ----------------+
          |                        |                                  |
          |  Authoring/Publishing  | Policy Resolver                  |
          |  Release Compiler      | Acceptance/Lease                 |
          |  Audit/Outbox          | Revocation                       |
          +------------------------+----------------------------------+
                                   |
                              PostgreSQL
                                   |
              +--------------------+--------------------+
              |                                         |
      Git publication adapter                   Artifact publisher
              |                                         |
        central governance repo          signed immutable release
                                                        |
                   +--------------------+---------------+
                   |                    |               |
             Governance CLI       Hook/Preflight   Governance MCP
                   |                    |               |
                   +------------- GovernanceClient -----+
                                        |
                                local signed snapshot
                                        |
                               Policy Enforcement Point
                                        |
                              governed execution runtime
```

PostgreSQL nunca é exposto diretamente ao MCP ou à console. Toda operação passa por API, policy e
auditoria.

## 9. Topologia de repositórios e pacotes

### 9.1 Dentro de `enterprise-hseos`

- contratos e schemas portáveis;
- `GovernanceClient`;
- policy decision port e evaluator local;
- source adapter do compiler para release assinada;
- CLI `hseos governance ...`;
- hook/preflight compilável;
- evolução do MCP de governança;
- conformance fixtures e testes multi-adapter.

### 9.2 Deployable separado

O control plane, a console, migrations PostgreSQL e integrações de identidade devem ter lifecycle de
deploy separado. A implementação pode começar como sidecar candidato, mas a ativação multi-tenant
deve ser versionada e implantada independentemente do pacote CLI.

O contrato entre os repositórios é a Governance API + schemas versionados + Governance Release. O
HSEOS não pode depender de código interno do serviço.

## 10. Contratos novos

### 10.1 `managed-governance-binding/v1`

Bootstrap local sem segredo:

```yaml
contract: managed-governance-binding/v1
mode: managed-shadow
repository_id: 7f9f9b79-638c-4138-9a29-8a2406ad9fb8
organization_id: hideaki-solutions
control_plane_ref: managed-control-plane-primary
issuer: hideaki-governance
trusted_key_ids: [governance-signing-2026]
failure_policy: cached-fail-closed
max_snapshot_age_seconds: 86400
```

O binding não substitui `repository-contract/v1`; ele o referencia. Divergência de identidade
bloqueia o modo managed.

### 10.2 `governance-release/v1`

Campos mínimos:

- `release_id` e sequência monotônica;
- `source_commit` e `source_repository`;
- `previous_release_digest`;
- `content_digest`;
- schemas de artifacts e policy;
- `issued_at`, `effective_at`, `expires_at` e `sunset_at`;
- `change_class` (`editorial`, `compatible`, `enforcement`, `emergency`);
- versão mínima/máxima do runtime;
- lista exata de artifacts e seus hashes;
- issuer, key ID e assinatura detached;
- rollout cohort e restrições de escopo.

### 10.3 `governance-snapshot/v1`

Projeção efetiva e assinada para um binding:

- release e binding digests;
- identidade do repositório;
- escopo efetivo;
- artifacts materializados;
- regras estruturadas e precedência resolvida;
- adapter projections;
- validade e prova de assinatura.

### 10.4 `governance-acceptance/v1`

Registra reconhecimento de uma mudança material:

- subject autenticado;
- repository/organization scope;
- release e policy digests;
- diff digest apresentado;
- timestamp, expiração e método;
- decisão (`accepted` ou `declined`);
- evidência de autenticação.

Aceite não é approval de operação e não concede capacidade adicional.

### 10.5 `governance-session-lease/v1`

- session fingerprint não reversível;
- repository e subject IDs;
- release/policy/binding digests;
- emissão e expiração;
- enforcement level comprovado;
- restrições e capability ceiling;
- nonce e assinatura.

A lease nunca entra em prompt, evento de agente ou log sem redação.

### 10.6 `governance-decision/v1`

Resposta comum para CLI, hook, MCP e runtime:

```json
{
  "schema_version": "1.0",
  "decision": "allow | deny | input_required",
  "reason_code": "string-estavel",
  "policy_version": "string",
  "release_digest": "sha256:...",
  "obligations": [],
  "evidence": [],
  "warnings": []
}
```

Texto explicativo é projeção; códigos, digests e obligations são o contrato.

## 11. Modelo relacional proposto

Tabelas conceituais:

- `organizations`, `projects`, `repositories`, `subjects`;
- `governance_artifacts`, `artifact_versions`, `artifact_relations`;
- `policy_rules`, `policy_scopes`, `policy_bindings`;
- `drafts`, `reviews`, `publication_requests`;
- `governance_releases`, `release_items`, `release_signatures`;
- `project_assignments`, `rollout_cohorts`;
- `acceptance_receipts`, `session_leases`;
- `revocations`, `exceptions`;
- `audit_events`, `outbox_messages`;
- `projection_checkpoints`.

Requisitos:

- `organization_id` em toda linha multi-tenant;
- RLS fail-closed;
- UUIDs e constraints relacionais;
- versões imutáveis depois de publicadas;
- optimistic concurrency para drafts/bindings;
- outbox transacional;
- timestamps UTC;
- classificação de dados por coluna;
- retenção explícita;
- migrations expand-contract;
- restore testado e auditável.

Event Sourcing completo não é proposto para todo o control plane. Versões imutáveis, audit events e
outbox atendem ao problema inicial. Ativação de event sourcing para outro agregado exige decisão
própria conforme ADR-0002.

## 12. Precedência e resolução

Ordem proposta, da mais ampla para a mais específica:

1. Constituição;
2. standards organizacionais;
3. policies organizacionais;
4. portfolio/produto;
5. projeto/repositório;
6. ambiente;
7. branch/ref protegida;
8. agent authority;
9. skill/workflow acionado;
10. exceção aprovada e ainda válida.

Uma camada inferior pode restringir uma superior. Ampliação de autoridade exige regra explícita,
approval compatível e razão auditável. Conflito entre regras de mesma precedência é `deny` e não uma
média ou escolha arbitrária.

O resolver retorna tanto a decisão quanto a árvore de explicação.

## 13. Preflight e lifecycle de sessão

### 13.1 State machine

```text
UNBOUND
  -> SYNC_REQUIRED
  -> ACCEPTANCE_REQUIRED
  -> READY
  -> OFFLINE_CACHED
  -> REFRESH_REQUIRED
  -> REVOKED | BLOCKED
```

### 13.2 Sequência

1. Resolver raiz Git e `repository_id`.
2. Validar binding e trust roots.
3. Obter manifest da release atribuída.
4. Verificar TLS, issuer, assinatura, digest, validade e runtime range.
5. Comparar release e binding contra snapshot local.
6. Baixar para staging e validar todos os artifacts/schemas.
7. Classificar o delta material.
8. Exigir reconhecimento quando aplicável.
9. Compilar adapters e executar conformance em staging.
10. Promover snapshot e adapters atomicamente.
11. Emitir lease vinculada à sessão.
12. Liberar o primeiro prompt.

Uma operação começa e termina sob a mesma release. Refresh não altera policy no meio de tool call.

### 13.3 Gate primário e defesa em profundidade

O gate preferencial ocorre antes do runtime:

```bash
hseos governance preflight --adapter <id> --directory <repo> --json
```

Hooks `SessionStart` e `UserPromptSubmit` são defesa adicional. Um adapter sem prelaunch wrapper ou
hook bloqueante não pode declarar `managed-enforced`; fica em `managed-shadow` ou é recusado pelo
perfil estrito.

O preflight usa `GovernanceClient` diretamente. Ele não depende do cliente MCP já estar iniciado.

### 13.4 Exit codes estáveis

| Código | Significado                  |
| -----: | ---------------------------- |
|      0 | ready                        |
|     20 | acceptance required          |
|     21 | sync required                |
|     22 | untrusted/invalid signature  |
|     23 | revoked                      |
|     24 | offline cache expired        |
|     25 | repository identity mismatch |
|     26 | client/runtime incompatible  |
|     27 | enforcement unavailable      |

## 14. Aceite, approval e imposição

Aceite de governança significa reconhecimento da release aplicável. Não significa aprovação para
merge, release, produção, alteração de segurança ou ação irreversível.

| Mudança     | Comportamento                                                         |
| ----------- | --------------------------------------------------------------------- |
| Editorial   | Atualiza automaticamente; registra diff                               |
| Compatible  | Atualiza; notifica; não amplia autoridade                             |
| Enforcement | Exibe diff e exige reconhecimento                                     |
| Emergency   | Revoga release anterior e bloqueia; nova release exige reconhecimento |

Políticas organizacionais obrigatórias podem ser atribuídas pelo administrador. Nesse caso,
`declined` impede a sessão gerenciada; não desativa a política.

CI e automações não usam `--yes`. Service identities recebem assignments explícitos e releases
pinadas, com aceite administrativo auditável.

## 15. Enforcement

O control plane não deve apenas injetar texto no prompt. Enforcement ocorre em:

- prelaunch/preflight;
- hooks bloqueantes suportados;
- execution policy port do ADR-0022;
- branch/commit/quality gates;
- compiler e manifest verification;
- control plane para assignments, revogação e emissão de lease.

Conteúdo textual recebido é tratado como dado não executável, validado, limitado e separado de
decisões estruturadas. Prompt injection em documentos não pode alterar policy decisions.

## 16. MCP proposto

O MCP continua stateless por request e read-only no primeiro release.

Ferramentas novas:

- `get_effective_governance_context`;
- `evaluate_governed_action`;
- `explain_governance_decision`;
- `get_governance_artifact`;
- `get_governance_release`;
- `diff_governance_releases`;
- `verify_governance_snapshot`;
- `get_governance_session_status`.

As cinco ferramentas atuais permanecem como wrappers de compatibilidade durante uma janela
versionada. Elas deixam de ler arquivos por parser próprio e passam a usar o `GovernanceClient`.

Mutação administrativa não será exposta pelo MCP de runtime. A console usa Admin API separada.

## 17. Console administrativa

Capacidades mínimas:

- visão de organizações, projetos, releases e drift;
- editor schema-driven para drafts;
- diff semântico e textual;
- simulação de política efetiva;
- preview por projeto, ambiente, branch e agente;
- workflow draft -> review -> approve -> publish;
- rollout canário e agendado;
- rollback e revogação;
- gestão de bindings e assignments;
- aceites e leases ativos;
- compatibilidade de runtime/adapters;
- auditoria e exportação;
- health de snapshots e lag de projeções.

Papéis mínimos: `author`, `reviewer`, `approver`, `operator`, `auditor`. Separação de função pode ser
configurável para organizações com um único mantenedor, mas nunca implícita.

## 18. Segurança e privacidade

- OIDC para usuários e workload identity/mTLS para serviços.
- PostgreSQL sem exposição a agentes ou browser.
- RLS por organização e projeto.
- Secrets somente por referência a secret manager.
- Chaves de assinatura fora do banco de aplicação, preferencialmente em KMS/HSM.
- Releases assinadas com suíte criptográfica allowlisted e hash SHA-256.
- Proteção contra replay de lease e acceptance receipt.
- Rate limiting e limites de corpo/schema/tempo.
- Audit events para leitura sensível, publicação, assignment, aceite, lease e revogação.
- Redação de subject identifiers em telemetria.
- DPIA antes de armazenar identidade pessoal ou comportamento detalhado de operadores.
- Backup criptografado e restore drill periódico.

## 19. Disponibilidade e modo offline

| Condição                            | Leitura               | Mutação governada                               |
| ----------------------------------- | --------------------- | ----------------------------------------------- |
| Online + release válida             | Permite               | Conforme policy                                 |
| Offline + cache válido              | Permite               | Somente classes autorizadas pelo failure policy |
| Cache expirado                      | Permite docs públicas | Bloqueia                                        |
| Primeira execução sem control plane | Bloqueia managed      | Bloqueia                                        |
| Assinatura inválida                 | Bloqueia              | Bloqueia                                        |
| Release revogada                    | Bloqueia              | Bloqueia                                        |
| Identity mismatch                   | Bloqueia              | Bloqueia                                        |

Revogações possuem feed pequeno e assinado. O snapshot local preserva last-known-good, mas não pode
anular revogação já observada.

## 20. Compiler, manifest e instalação

O compiler ganha uma `GovernanceSourcePort` com duas implementações:

- `PortableGovernanceSource` — árvore local atual;
- `ManagedReleaseGovernanceSource` — snapshot assinado já validado.

O manifest evolui para registrar:

- `governance_mode`;
- `governance_release_id`;
- `governance_release_digest`;
- `governance_binding_digest`;
- issuer e key ID;
- source kind;
- snapshot creation/expiry;
- acceptance requirement/status;
- enforcement level por adapter;
- hashes de todos os outputs.

O installer nunca busca uma release durante `install-plan --json`. Planejamento permanece puro. Sync
é comando explícito e instalação só promove artifacts após validação integral.

Uninstall preserva binding e recibos necessários para auditoria, salvo purge explícito e governado.

## 21. Lifecycle e packaging

Novas superfícies propostas:

| Superfície                               | Classe          | Disposição inicial | Autoridade                       |
| ---------------------------------------- | --------------- | ------------------ | -------------------------------- |
| `module:managed-governance-client`       | module          | opt-in             | Cliente/validator, sem authoring |
| `candidate:managed-governance-preflight` | candidate       | pre-activation     | Gate local em shadow             |
| `sidecar:governance-control-plane`       | sidecar/service | opt-in             | Estado operacional central       |
| `sidecar:governance-console`             | sidecar         | opt-in             | UI sem acesso direto ao DB       |
| `compatibility:file-governance-reader`   | compatibility   | active no portable | Não remover sem major/telemetria |

O baseline portable não pode ser demovido. O managed client é selecionado explicitamente pelo
perfil e depende de binding válido.

## 22. Alternativas consideradas

### Alternativa A — PostgreSQL canônico para todo conteúdo normativo

**Descrição:** Constituição, standards, policies, ADRs e catálogos vivem apenas no banco.

**Prós:**

- modelo único para UI e consultas;
- bindings e conteúdo na mesma transação;
- elimina filesystem authoring.

**Contras:**

- contradiz diretamente a Constituição e ADR-0006/0026;
- perde revisão/diff Git nativos e recuperação por clone;
- amplia o blast radius do banco e do control plane;
- torna exportação e auditoria independente mais complexas;
- exige migração constitucional antes de provar valor.

**Decisão:** não recomendada na primeira geração. Pode ser reavaliada com evidência operacional.

### Alternativa B — PostgreSQL consultado diretamente por MCP a cada ação

**Descrição:** MCP acessa tabelas e devolve governança live.

**Prós:** implementação inicial aparentemente simples e atualização imediata.

**Contras:**

- MCP vira bootstrap, authority, distribution e enforcement simultaneamente;
- mudança de regra no meio da operação;
- indisponibilidade e latência em cada tool call;
- exposição excessiva do modelo relacional;
- clientes sem MCP não têm enforcement;
- viola a fronteira stateless adapter do ADR-0023.

**Decisão:** rejeitada.

### Alternativa C — Git por projeto com hooks melhores

**Descrição:** manter cópias locais e adicionar update bot/preflight.

**Prós:** menor mudança e máxima portabilidade.

**Contras:** preserva duplicação, rollout fragmentado e ausência de visão central.

**Decisão:** insuficiente como solução final; útil como baseline de migração.

### Alternativa D — Git central + PostgreSQL operacional + releases assinadas

**Descrição:** proposta deste RFC.

**Prós:**

- preserva autoridade e auditoria Git;
- entrega console, bindings, rollout, aceite e revogação;
- runtime determinístico e offline por snapshot;
- MCP permanece adapter;
- migração progressiva e reversível.

**Contras:**

- dois modelos de armazenamento com responsabilidades distintas;
- compiler/publication pipeline mais sofisticado;
- exige gestão de assinatura e artifact retention;
- requer novo serviço e operação PostgreSQL.

**Decisão:** recomendada.

## 23. Trade-offs

| Ganho                            | Custo                                                |
| -------------------------------- | ---------------------------------------------------- |
| Governança central com UX        | Novo control plane e console                         |
| Rollout e revogação auditáveis   | Operação de PostgreSQL, identidade e signer          |
| Menos cópias por projeto         | Dependência explícita no modo managed                |
| Sessões pinadas a releases       | Lifecycle de snapshots e leases                      |
| Enforcement consistente          | Trabalho de conformance por adapter                  |
| Offline controlado               | Regras de staleness e revocation feed                |
| Explicações estruturadas por MCP | Evolução compatível das ferramentas atuais           |
| Git continua auditável           | Pipeline DB -> publication request -> Git -> release |

## 24. Impacto

| Dimensão          | Avaliação                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sistemas afetados | Constitution/ADRs, compiler, manifest, installer, CLI, MCP, hooks, runtime policy, catálogo, CI e novo control plane |
| Breaking changes  | Alto se substituir autoridade local; baixo/médio em shadow opt-in                                                    |
| Esforço estimado  | XL                                                                                                                   |
| Risco             | Alto                                                                                                                 |
| Reversibilidade   | Alta em shadow; parcial após managed-enforced; cara após retirada de fontes locais                                   |
| Dados             | Internal/confidential; potencial identidade pessoal em audit/acceptance                                              |
| Operação          | Novo PostgreSQL, API, signer, artifact store, observabilidade e DR                                                   |

## 25. Plano de migração

### Fase MG0 — decisão e contratos

- revisar este RFC;
- criar ADR `Proposed` somente após concordância sobre a direção;
- criar threat model e classificação de dados;
- definir owner, SLO, key custody e topology.

### Fase MG1 — contrato e importer read-only

- schemas dos artifacts, release, binding, decision e snapshot;
- importar fontes atuais sem alterar autoridade;
- catálogo PostgreSQL e API read-only;
- provar export/import determinístico.

### Fase MG2 — release compiler e assinatura

- compilar fontes Git para release content-addressed;
- assinatura e verificação local;
- artifact retention e rollback;
- conformance contra o compiler atual.

### Fase MG3 — shadow control plane

- bindings e assignments no PostgreSQL;
- resolver política efetiva;
- MCP/CLI em shadow;
- comparar decisão local vs gerenciada em todas as jornadas sentinela.

### Fase MG4 — console de leitura e authoring

- inventário, diff, simulação e drift;
- drafts no PostgreSQL;
- publication request gera PR no repositório central;
- somente merge/tag autorizado cria release.

### Fase MG5 — preflight e lease em candidate

- CLI wrapper e hook bloqueante onde suportado;
- acceptance receipt e session lease;
- cache/offline/revocation;
- adapters sem enforcement comprovado permanecem shadow.

### Fase MG6 — canário managed-enforced

- projetos não críticos e opt-in;
- janela observacional própria, sem reutilizar gates de outra migração;
- métricas de bypass, latency, availability, parity e rollback;
- review adversarial e threat-model verification.

### Fase MG7 — ativação e de-duplicação

- ativar somente após aceite humano e evidências;
- projetos managed reduzem arquivos ao bootstrap e cache compilado;
- portable permanece suportado;
- retirada de compatibility reader exige major e ADR posterior.

### Rollback

- Shadow: desabilitar assignment, sem alteração do runtime.
- Candidate: retornar ao snapshot anterior assinado.
- Managed-enforced: revogar release nova, reatribuir last-known-good e reemitir leases.
- Nunca restaurar um snapshot revogado nem transformar cache obsoleto em autoridade.
- Git central preserva reconstrução completa do catálogo publicado.

## 26. Validação e métricas de sucesso

### Integridade

- 100% dos artifacts publicados cobertos por manifest e hash;
- assinatura inválida, issuer desconhecido ou identity mismatch bloqueiam 100% dos casos;
- release recompilada do mesmo commit produz bytes/digest idênticos;
- zero alteração de policy sem release nova.

### Paridade

- 100% das jornadas sentinela retornam decisão equivalente em portable e managed-shadow;
- CLI, hook, MCP e runtime compartilham o mesmo decision contract;
- nenhum adapter declara enforced sem prova de gate bloqueante.

### Sessão

- primeiro prompt impossível antes de preflight nos adapters classificados como enforced;
- mudança enforcement exige acceptance receipt válido;
- aceite nunca satisfaz approval operacional;
- sessão mantém release pinada durante operação;
- revogação bloqueia nova sessão e refresh dentro do SLO definido.

### Operação

- preflight cacheado p95 <= 250 ms;
- preflight online p95 <= 2 s;
- disponibilidade do control plane >= 99,9% no modo managed;
- rollback de assignment <= 5 min;
- restore drill periódico dentro de RPO/RTO aprovados;
- projection/outbox lag monitorado e não verde acima do threshold.

### Segurança

- zero segredo em binding, snapshot, prompt, MCP result ou audit payload;
- zero acesso cross-tenant em testes de RLS;
- 100% de publish, assignment, acceptance, lease e revocation auditados;
- replay de lease/receipt e widening de scope rejeitados.

## 27. Gates de ativação

Antes de `managed-enforced`:

1. ADR aceito e, se necessário, emenda constitucional aprovada.
2. Threat model sem achado crítico/alto aberto.
3. Schemas e bindings versionados.
4. Paridade shadow integral.
5. Assinatura, rotação e revogação validadas.
6. Backup/restore e rollback exercitados.
7. Conformance por adapter.
8. Compatibilidade com a migração MCP vigente; nenhuma ativação antecipada de superfície gated.
9. Janela canário completa sem bypass.
10. Aprovação humana específica para ativação.

## 28. Questões abertas

1. Qual repositório central será a fonte Git normativa e quem será seu owner?
2. A separação de função será obrigatória ou configurável para organizações de um mantenedor?
3. Qual serviço custodiará as chaves de assinatura e qual o procedimento de rotação emergencial?
4. Qual idade máxima de snapshot offline por classe de ação?
5. O reconhecimento de policy é por usuário, dispositivo, projeto ou combinação desses escopos?
6. Qual retention de audit e acceptance atende à classificação dos dados?
7. Quais adapters conseguem provar prelaunch/hook enforcement e quais ficam em shadow?
8. O control plane deve nascer em repositório separado ou ser extraído após o PoC?
9. Qual SLO de revogação é necessário para incidentes de segurança?
10. Em que release major a autoridade local poderá deixar de ser obrigatória para projetos managed?

## 29. Decisão solicitada aos revisores

Os revisores devem decidir separadamente:

1. Aprovar ou rejeitar o conceito de modo `managed`.
2. Confirmar Git central como fonte normativa inicial.
3. Confirmar PostgreSQL como fonte do estado operacional do control plane.
4. Confirmar releases assinadas como unidade de distribuição.
5. Confirmar preflight + enforcement local, com MCP read-only.
6. Autorizar ou não a elaboração do ADR `Proposed` e do threat model.

Nenhuma dessas decisões é inferida pela existência deste draft.

## 30. Próximo passo recomendado

Revisar este RFC com Platform Governance e Security. Se a direção for aprovada, criar um ADR
`Proposed` que estenda explicitamente ADR-0006/0008/0026/0027/0030, sem modificar ADRs aceitos, e
produzir o threat model antes de qualquer implementação ou mudança de autoridade.

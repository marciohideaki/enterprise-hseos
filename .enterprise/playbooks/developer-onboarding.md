# Developer Onboarding Playbook

**Version:** 1.0
**Status:** Active
**Audience:** New developers joining the engineering organization
**Updated:** 2025-01-01

---

## 1. Visão Geral

Enterprise standards são o conjunto de regras, convenções e decisões de engenharia que definem como software é construído nesta organização. Eles existem por uma razão simples: código escrito por times diferentes deve ser legível, testável e evolutivo da mesma forma — independente de quem o escreveu ou quando. Sem standards, cada serviço se torna uma ilha com suas próprias regras, o que eleva o custo de manutenção, onboarding e operação ao longo do tempo.

Os standards são organizados em camadas de autoridade. A **Constituição** define os princípios inegociáveis. Os **Core Standards** traduzem esses princípios em regras organizacionais concretas — arquitetura, git, qualidade, nomenclatura. Os **Cross-Cutting Standards** cobrem preocupações que atravessam todos os stacks: segurança, observabilidade, contratos de dados, LGPD. Os **Stack Standards** aplicam tudo isso ao contexto específico da sua linguagem e plataforma. Quando há conflito entre camadas, a camada superior prevalece sempre.

Todos os documentos de standards estão em `.enterprise/.specs/`. Você não precisa memorizar tudo no primeiro dia — mas precisa saber onde procurar. Este playbook diz o que ler primeiro, em que ordem, e o que evitar antes mesmo de entender tudo.

---

## 2. Estrutura de Documentação

```
.enterprise/.specs/
│
├── constitution/                         ← Lei máxima — leia no dia 1
│   ├── Enterprise-Constitution.md
│   └── Enterprise-Constitution.md
│
├── core/                                 ← Invariantes organizacionais
│   ├── AGENT RULES STANDARD.md
│   ├── Hexagonal & Clean Architecture Standard.md
│   ├── Naming & Conventions Standard.md
│   ├── Git Flow & Release Governance Standard.md
│   ├── Quality Gates & Compliance Standard.md
│   ├── CQRS Standard.md
│   ├── Event Sourcing Standard.md
│   ├── Saga Pattern Standard.md
│   ├── Microservices Architecture Standard.md
│   ├── Deprecation & Sunset Policy.md
│   └── Engineering Governance Standard.md
│
├── cross/                                ← Aplicam a todos os stacks
│   ├── Security & Identity Standard.md
│   ├── Data Governance & LGPD Standard.md
│   ├── Observability Playbook.md
│   ├── Performance Engineering Standard.md
│   ├── Resilience Patterns Standard.md
│   ├── Data Contracts & Schema Evolution Standard.md
│   ├── Code & API Documentation Standard.md
│   └── Security Scanning & Supply Chain Standard.md
│
├── CSharp/ Java/ Go/ PHP/ Cpp/           ← Específico da sua linguagem
├── Flutter/ ReactNative/                 ← Mobile
│   ├── [Stack] — Architecture Standard.md
│   ├── [Stack] — Functional Requirements (FR).md
│   ├── [Stack] — Non-Functional Requirements (NFR).md
│   ├── [Stack] — Idiomatic Guide.md
│   ├── [Stack] — Build & Toolchain Standard.md
│   ├── [Stack] — Testing Standard.md
│   └── [Stack] — Pull Request Checklist.md  ← Leia ANTES do primeiro PR
│
└── decisions/                            ← ADRs — decisões aprovadas
    ├── ADR-0001-hexagonal-architecture-mandatory.md
    ├── ADR-0002-event-sourcing-opt-in.md
    └── ...
```

**Regra de precedência:** Constituição > Core > Cross > Stack > ADR local

---

## 3. Primeiras 2 Horas — Leitura Obrigatória

Estes documentos se aplicam a **todo desenvolvedor**, independente de stack. Leia nesta ordem:

| # | Documento | Onde encontrar | Por que é obrigatório |
|---|-----------|---------------|----------------------|
| 1 | Enterprise Constitution | `.specs/constitution/Enterprise-Constitution.md` | Define os princípios que todas as outras regras derivam |
| 2 | AGENT RULES STANDARD | `.specs/core/AGENT RULES STANDARD.md` | Regras de comportamento do time — inclui commit hygiene |
| 3 | Hexagonal & Clean Architecture Standard | `.specs/core/Hexagonal & Clean Architecture Standard.md` | Lei da arquitetura — violação bloqueia PR |
| 4 | Naming & Conventions Standard | `.specs/core/Naming & Conventions Standard.md` | Como nomear variáveis, classes, serviços, branches, tudo |
| 5 | Git Flow & Release Governance Standard | `.specs/core/Git Flow & Release Governance Standard.md` | Branches, commits, versioning, release process |
| 6 | Quality Gates & Compliance Standard | `.specs/core/Quality Gates & Compliance Standard.md` | O que bloqueia um PR de ser mergeado |
| 7 | PR Checklist do seu stack | `.specs/[SeuStack]/[Stack] — Pull Request Checklist.md` | Leia antes de abrir seu primeiro PR |

> Tempo estimado: 90-120 minutos. Não pule. Esses documentos evitam os erros mais custosos da primeira semana.

---

## 4. Reading Path por Stack

Após a leitura obrigatória, aprofunde-se no seu stack nesta sequência:

### C# .NET
1. `.specs/CSharp/CSharp DotNET — Architecture Standard.md`
2. `.specs/CSharp/CSharp DotNET — Idiomatic Guide.md`
3. `.specs/CSharp/CSharp DotNET — Testing Standard.md`
4. `.specs/CSharp/CSharp DotNET — Build & Toolchain Standard.md`
5. `.specs/CSharp/CSharp DotNET — Pull Request Checklist.md`

### Java
1. `.specs/Java/Java — Architecture Standard.md`
2. `.specs/Java/Java — Idiomatic Guide.md`
3. `.specs/Java/Java — Testing Standard.md`
4. `.specs/Java/Java — Build & Toolchain Standard.md`
5. `.specs/Java/Java — Pull Request Checklist.md`

### Go
1. `.specs/Go/Go — Architecture Standard.md`
2. `.specs/Go/Go — Idiomatic Guide.md`
3. `.specs/Go/Go — Testing Standard.md`
4. `.specs/Go/Go — Build & Toolchain Standard.md`
5. `.specs/Go/Go — Pull Request Checklist.md`

### PHP
1. `.specs/PHP/PHP — Architecture Standard.md`
2. `.specs/PHP/PHP — Idiomatic Guide.md`
3. `.specs/PHP/PHP — Testing Standard.md`
4. `.specs/PHP/PHP — Build & Toolchain Standard.md`
5. `.specs/PHP/PHP — Pull Request Checklist.md`

### C++
1. `.specs/Cpp/C++ — Architecture Standard.md`
2. `.specs/Cpp/C++ — Idiomatic Guide.md`
3. `.specs/Cpp/C++ — Testing Standard.md`
4. `.specs/Cpp/C++ — Build & Toolchain Standard.md`
5. `.specs/Cpp/C++ — Pull Request Checklist.md`

### Flutter
1. `.specs/Flutter/Flutter — Architecture Standard.md`
2. `.specs/Flutter/Flutter — Idiomatic Guide.md`
3. `.specs/Flutter/Flutter — Testing Standard.md`
4. `.specs/Flutter/Flutter — Build & Toolchain Standard.md`
5. `.specs/Flutter/Flutter — Pull Request Checklist.md`

> Flutter: leia tambem `.specs/cross/` — especialmente Data Governance & LGPD e Security & Identity, pois apps mobile coletam dados sensíveis do usuário.

### React Native
1. `.specs/ReactNative/React Native — Architecture Standard.md`
2. `.specs/ReactNative/React Native — Idiomatic Guide.md`
3. `.specs/ReactNative/React Native — Testing Standard.md`
4. `.specs/ReactNative/React Native — Build & Toolchain Standard.md`
5. `.specs/ReactNative/React Native — Pull Request Checklist.md`

> React Native: mesma observação do Flutter sobre LGPD e Security.

---

## 5. Primeira Semana — Hands-On Checklist

Complete estes itens durante seus primeiros 5 dias:

**Leitura e conhecimento**
- [ ] Leu todos os 7 documentos obrigatórios da seção 3
- [ ] Leu os 5 documentos do seu stack na ordem da seção 4
- [ ] Leu os ADRs ativos que afetam o serviço em que vai trabalhar (`.specs/decisions/`)
- [ ] Conhece onde ficam os ADRs e como criar um novo (ver `.enterprise/policies/adr-policy.md`)

**Ambiente e código**
- [ ] Configurou o ambiente de desenvolvimento conforme o Build & Toolchain do seu stack
- [ ] Conseguiu executar o projeto localmente (build + run)
- [ ] Executou a suite de testes do serviço localmente e todos passaram
- [ ] Leu o `data-lineage.md` do serviço (se existir) — entende quais dados fluem pelo serviço
- [ ] Entende a estrutura de pastas do serviço e como ela mapeia ao Hexagonal Architecture

**Processo e qualidade**
- [ ] Abriu um PR pequeno (bugfix, doc ou test) e passou por todo o review process
- [ ] O PR foi aprovado com o PR Checklist preenchido corretamente
- [ ] Tem acesso ao observability dashboard do serviço (logs, métricas, traces)
- [ ] Sabe onde reportar exceções a standards (`.enterprise/.specs/decisions/`)

---

## 6. Common Pitfalls — 10 Erros Mais Comuns

Estes são os erros que novos desenvolvedores cometem com mais frequência. Todos bloqueiam PR ou causam retrabalho.

| # | Erro | Consequência | Standard de referência |
|---|------|-------------|----------------------|
| 1 | Colocar lógica de negócio na camada de Infrastructure (repositórios, controllers) | Acoplamento forte, impossível testar sem banco/rede | `.specs/core/Hexagonal & Clean Architecture Standard.md` |
| 2 | Usar `new` para instanciar objetos de infraestrutura dentro do Domain | Domain passa a depender de implementação concreta, viola inversão de dependência | `.specs/[Stack]/[Stack] — Architecture Standard.md` |
| 3 | Esquecer de propagar `CancellationToken` em métodos async | Requests não canceláveis, vazamento de recursos sob carga | `.specs/[Stack]/[Stack] — Idiomatic Guide.md` |
| 4 | Fazer commit com `Co-authored-by` ou menção a AI tools na mensagem | Viola commit hygiene policy — o commit pode ser rejeitado pelo hook | `.specs/core/AGENT RULES STANDARD.md` |
| 5 | Abrir PR sem rodar os testes localmente | Pipeline falha, revisores perdem tempo, PR vai para o fim da fila | `.specs/[Stack]/[Stack] — Pull Request Checklist.md` |
| 6 | Nomear variáveis, métodos ou arquivos em português quando o codebase é em inglês | Inconsistência de idioma — quebra a regra de naming uniforme | `.specs/core/Naming & Conventions Standard.md` |
| 7 | Logar dados de usuário (CPF, email, nome) em mensagens de log | Violação de LGPD — dado pessoal não pode aparecer em logs | `.specs/cross/Data Governance & LGPD Standard.md` |
| 8 | Usar `.Result`, `.Wait()` ou `Task.Result` em código async | Deadlock em ambientes ASP.NET e similares; bloqueia thread pool | `.specs/[Stack]/[Stack] — Idiomatic Guide.md` |
| 9 | Criar endpoint sem autenticação sem registrar justificativa | Superfície de ataque exposta — bloqueado pelo Quality Gate | `.specs/cross/Security & Identity Standard.md` |
| 10 | Modificar decisão arquitetural (novo ORM, novo padrão, nova lib de infra) sem ADR | A decisão não tem rastreabilidade, pode ser revertida ou bloqueada em review | `.specs/decisions/_TEMPLATE.md` + `.enterprise/policies/adr-policy.md` |

---

## 7. FAQ

**Q: Posso usar uma biblioteca que não está nos exemplos dos standards?**
A: Sim. Os standards definem padrões arquiteturais e de qualidade, não um catálogo fechado de bibliotecas. Se for uma biblioteca de infraestrutura (ORM, HTTP client, message broker, cache), verifique se ela viola alguma regra do Architecture Standard do seu stack. Se a adoção for ampla ou afetar múltiplos serviços, abra um ADR com status `Proposed` via PR.

**Q: O que faço se um standard contradiz outro?**
A: Aplique a ordem de precedência: Constituição > Core > Cross-Cutting > Stack > ADR local. Se a contradição persistir mesmo com essa ordem, não invente uma interpretação — crie um ADR propondo a clarificação e submeta via PR para discussão. Deixe o ADR em `Proposed` até ser aprovado.

**Q: Preciso de aprovação para cada commit?**
A: Não. Commits na sua branch de feature são livres. O que requer aprovação é o PR (merge para `main` ou `develop`). Commits devem seguir o Conventional Commits format conforme o Git Flow Standard, mas não são revisados individualmente.

**Q: Posso marcar um item do PR Checklist como N/A?**
A: Sim, desde que você escreva a justificativa no PR description. Não deixe itens em branco — o reviewer não tem como saber se você esqueceu ou se conscientemente não se aplica.

**Q: Onde peço exceção formal a um standard?**
A: Em `.enterprise/.specs/decisions/` — use o template `_TEMPLATE.md`, crie um ADR com status `Proposed` e submeta via PR. Para exceções temporárias de emergência, consulte `.enterprise/policies/exceptions.md`.

**Q: Qual é a diferença entre FR e NFR?**
A: Functional Requirements (FR) descrevem o que o serviço deve fazer — contratos de API, comportamentos esperados. Non-Functional Requirements (NFR) descrevem como ele deve se comportar — latência, disponibilidade, limites de memória, segurança. Ambos são obrigatórios e estão no diretório do seu stack.

**Q: Preciso ler os ADRs de todos os serviços?**
A: Não — leia os ADRs que afetam o serviço em que você vai trabalhar. Os ADRs em `.specs/decisions/` são os de escopo organizacional (afetam todos). ADRs de escopo de serviço ficam no repositório do próprio serviço.

---

## 8. Glossário Rápido

| Termo | Definição resumida |
|-------|-------------------|
| **Aggregate** | Cluster de entidades de domínio tratadas como uma unidade para fins de consistência. Todo aggregate tem uma raiz (Aggregate Root) que é o único ponto de entrada. |
| **Bounded Context** | Fronteira explícita dentro da qual um modelo de domínio é consistente e aplicável. Dois contextos diferentes podem ter o mesmo nome para conceitos diferentes. |
| **Port** | Interface definida pelo domínio que representa uma necessidade de comunicação (inbound ou outbound). Não sabe nada sobre implementação. |
| **Adapter** | Implementação concreta de um Port. Fica na camada de Infrastructure e converte entre o mundo externo e o modelo do domínio. |
| **Use Case Handler** | Classe que orquestra a execução de um caso de uso. Fica na camada de Application, invoca Ports, não contém lógica de domínio. |
| **Value Object** | Objeto definido apenas pelos seus atributos, sem identidade própria. Imutável por definição. Exemplos: CPF, Money, Email. |
| **Domain Event** | Fato ocorrido no domínio, expresso no passado. Representa mudança de estado relevante para outros contextos. |
| **CQRS** | Command Query Responsibility Segregation. Separa operações de escrita (Commands) de leitura (Queries) — modelo de escrita e leitura podem ser diferentes. |
| **Command** | Intenção de mudar o estado do sistema. Tem um handler e pode falhar. Nomeado no imperativo: `PlaceOrder`, `CancelSubscription`. |
| **Query** | Solicitação de leitura de dados, sem efeito colateral no estado. Não deve modificar nada. |
| **Saga** | Padrão para transações distribuídas longas. Coordena múltiplos serviços via eventos ou orquestração, com compensações em caso de falha. |
| **Outbox Pattern** | Garantia de entrega de eventos: o evento é gravado na mesma transação do banco de dados antes de ser publicado no message broker. Evita perda de eventos. |
| **Hexagonal Architecture** | Arquitetura que isola o domínio do mundo externo via Ports & Adapters. Também chamada de Ports & Adapters. O domínio não conhece frameworks, bancos ou HTTP. |
| **ADR** | Architecture Decision Record. Documento que registra uma decisão arquitetural significativa: contexto, opções consideradas, decisão tomada e consequências. |
| **PII** | Personally Identifiable Information. Dados que identificam uma pessoa: CPF, nome, email, telefone, IP, cookie de sessão. Sujeito à LGPD. |
| **LGPD** | Lei Geral de Proteção de Dados (Lei 13.709/2018). Regula coleta, uso, armazenamento e compartilhamento de dados pessoais no Brasil. |
| **Contract Testing** | Teste que verifica se produtor e consumidor de uma API respeitam o contrato acordado. Detecta breaking changes antes do deploy. |
| **Mutation Score** | Porcentagem de mutantes (bugs artificiais inseridos no código) detectados pelos testes. Score baixo indica testes que passam sem realmente verificar o comportamento. |
| **Quality Gate** | Conjunto de critérios automatizados que devem ser satisfeitos para um PR ser mergeado. Cobertura mínima, mutation score, lint, security scan, etc. |
| **data-lineage.md** | Documento em nível de serviço que mapeia quais dados pessoais (PII) fluem pelo serviço, suas origens, destinos e tempo de retenção. Obrigatório para serviços que processam dados de usuários. |

---

## 9. Links Rápidos

### Constituição e Regras de Comportamento

| Documento | Caminho |
|-----------|---------|
| Enterprise Constitution | `.enterprise/.specs/constitution/Enterprise-Constitution.md` |
| Enterprise Constitution | `.enterprise/.specs/constitution/Enterprise-Constitution.md` |
| AGENT RULES STANDARD | `.enterprise/.specs/core/AGENT RULES STANDARD.md` |

### Core Standards

| Documento | Caminho |
|-----------|---------|
| Hexagonal & Clean Architecture | `.enterprise/.specs/core/Hexagonal & Clean Architecture Standard.md` |
| Naming & Conventions | `.enterprise/.specs/core/Naming & Conventions Standard.md` |
| Git Flow & Release Governance | `.enterprise/.specs/core/Git Flow & Release Governance Standard.md` |
| Quality Gates & Compliance | `.enterprise/.specs/core/Quality Gates & Compliance Standard.md` |
| CQRS Standard | `.enterprise/.specs/core/CQRS Standard.md` |
| Event Sourcing Standard | `.enterprise/.specs/core/Event Sourcing Standard.md` |
| Saga Pattern Standard | `.enterprise/.specs/core/Saga Pattern Standard.md` |
| Microservices Architecture | `.enterprise/.specs/core/Microservices Architecture Standard.md` |
| Deprecation & Sunset Policy | `.enterprise/.specs/core/Deprecation & Sunset Policy.md` |
| Engineering Governance | `.enterprise/.specs/core/Engineering Governance Standard.md` |

### Cross-Cutting Standards

| Documento | Caminho |
|-----------|---------|
| Security & Identity | `.enterprise/.specs/cross/Security & Identity Standard.md` |
| Data Governance & LGPD | `.enterprise/.specs/cross/Data Governance & LGPD Standard.md` |
| Observability Playbook | `.enterprise/.specs/cross/Observability Playbook.md` |
| Performance Engineering | `.enterprise/.specs/cross/Performance Engineering Standard.md` |
| Resilience Patterns | `.enterprise/.specs/cross/Resilience Patterns Standard.md` |
| Data Contracts & Schema Evolution | `.enterprise/.specs/cross/Data Contracts & Schema Evolution Standard.md` |
| Code & API Documentation | `.enterprise/.specs/cross/Code & API Documentation Standard.md` |
| Security Scanning & Supply Chain | `.enterprise/.specs/cross/Security Scanning & Supply Chain Standard.md` |

### Policies e Processos

| Documento | Caminho |
|-----------|---------|
| ADR Policy | `.enterprise/policies/adr-policy.md` |
| Exceptions Policy | `.enterprise/policies/exceptions.md` |
| Documentation Policy | `.enterprise/policies/documentation-policy.md` |
| Skill Consumption Policy | `.enterprise/policies/skill-consumption.md` |
| Specification Consumption | `.enterprise/policies/specification-consumption.md` |

### ADRs Ativos

| ADR | Caminho |
|-----|---------|
| ADR-0001: Hexagonal Architecture Mandatory | `.enterprise/.specs/decisions/ADR-0001-hexagonal-architecture-mandatory.md` |
| ADR-0002: Event Sourcing Opt-In | `.enterprise/.specs/decisions/ADR-0002-event-sourcing-opt-in.md` |
| ADR-0003: CQRS with Relational Source of Truth | `.enterprise/.specs/decisions/ADR-0003-cqrs-with-relational-source-of-truth.md` |
| ADR-0004: Flutter Architecture Decisions | `.enterprise/.specs/decisions/ADR-0004-flutter-architecture-decisions.md` |
| ADR-0005: Performance Engineering Activation | `.enterprise/.specs/decisions/ADR-0005-performance-engineering-activation-template.md` |
| Template para novo ADR | `.enterprise/.specs/decisions/_TEMPLATE.md` |

### Outros Playbooks

| Documento | Caminho |
|-----------|---------|
| Agent Onboarding | `.enterprise/playbooks/agent-onboarding.md` |
| Enterprise Flow | `.enterprise/playbooks/enterprise-flow.md` |
| Git Workflow | `.enterprise/playbooks/git-workflow.md` |
| Escalation Rules | `.enterprise/playbooks/escalation-rules.md` |
| Repository Vitrine Checklist | `.enterprise/playbooks/repository-vitrine-checklist.md` |

---

*Para dúvidas sobre este playbook ou sobre os standards, abra uma issue no repositório de governança ou consulte o Engineering Governance Standard para o processo correto de proposta de mudança.*

# /goal — Enterprise HSEOS: autonomia de engenharia governada e verificável

**Versão do prompt:** 1.0  
**Preparado em:** 2026-09-20  
**Repositório-alvo:** `marciohideaki/enterprise-hseos`  
**Natureza:** missão de avaliação, implementação incremental, validação e preparação operacional. Não é autorização irrestrita de produção.

> Execute esta missão sobre o checkout real do Enterprise HSEOS. Não responda apenas com um diagnóstico, uma arquitetura ideal, um roadmap ou arquivos de documentação. Investigue, estabeleça contratos verificáveis, implemente as melhorias autorizadas, execute os testes, corrija as falhas e prossiga pelos miniobjetivos até atender à definição de pronto ou encontrar um bloqueio real de autoridade, segurança, ambiente ou orçamento. Não declare concluído aquilo que não foi demonstrado.

## 1. Resultado que deve existir ao final

Evoluir o HSEOS existente para um harness local-first, personalizável, modular e agnóstico que permita a um agente receber um objetivo e trabalhar em um projeto real, novo ou legado, com a seguinte experiência:

```text
Projeto + documentação + especificações + objetivo + autoridade disponível
    → descoberta do ambiente e da verdade disponível
    → entendimento do produto, arquitetura, contratos e estado implementado
    → contrato de execução verificável
    → seleção justificada da próxima atividade
    → implementação em ambiente isolado
    → validação independente do resultado
    → correção dentro do orçamento e da autoridade
    → checkpoint, evidências e retomada
    → entrega verificada ou bloqueio explicável
```

A autonomia deve reduzir decisões humanas repetitivas sem eliminar a autoridade humana sobre mudanças de intenção, riscos e efeitos não delegados. O agente pode escolher **como implementar dentro dos limites aprovados**; não pode decidir sozinho que o produto deveria ter outro comportamento ou que os controles ficaram inconvenientes.

A conclusão desta missão deve demonstrar uma trajetória real de especificação até alteração aceita, não apenas uma chamada ao modelo, um catálogo de agentes, um gerador de Markdown ou uma simulação com respostas pré-programadas.

“Estado da arte”, nesta missão, significa qualidade demonstrada em portabilidade, segurança, entendimento contextual, execução durável, qualidade das entregas e eficiência. Não significa adotar todo framework novo, maximizar quantidade de agentes ou declarar superioridade universal sem comparação.

## 2. Contrato de intenção desta missão

O YAML abaixo define a intenção. **Não presuma que esta sintaxe já seja aceita pelo HSEOS.** Mapeie-a para os contratos existentes; proponha extensão versionada somente quando faltar expressividade. Não crie um segundo sistema de configuração paralelo.

```yaml
intent_version: hseos-evolution-intent/v1
mission_id: hseos-governed-autonomous-engineering
mode: inspect_then_incremental_execution
scope:
  target: enterprise-hseos
  include:
    - existing_core_and_public_execution_paths
    - project_specification_consumption
    - capability_resolution_and_provider_adapters
    - durable_execution_and_evidence
    - security_boundaries_and_negative_tests
    - local_installation_and_upgrade_compatibility
    - representative_consumer_fixtures
  exclude:
    - unrelated_product_implementation
    - mandatory_cloud_control_plane
    - wholesale_language_or_framework_rewrite
    - unauthorized_production_mutation
architecture:
  local_first: true
  preserve_source_generated_local_ownership: true
  reuse_existing_runtime: true
  vendor_specific_behavior_in_adapters: true
  project_structure_is_configurable: true
  optional_capabilities_have_no_implicit_side_effects: true
execution:
  prefer_single_executor: true
  parallel_readonly_discovery: when_safe
  parallel_resource_intensive_stages: explicit_authorization_only
  max_failed_correction_attempts_per_minigoal: 2
  budgets: resolve_and_validate_from_authorized_profile
  on_ambiguous_business_intent: block_affected_scope
  on_missing_required_capability: fail_closed
  on_unknown_external_effect_outcome: reconcile_before_retry
  on_context_limit: checkpoint_and_resume
validation:
  deterministic_gates: mandatory_when_applicable
  real_provider_evidence: separate_from_mocks
  independent_verification: true
  acceptance_frozen_before_implementation: true
  no_retroactive_threshold_reduction: true
  separate_implementation_validation_activation: true
authority:
  local_reversible_implementation: within_existing_policy
  disposable_test_fixtures: allowed_with_explicit_isolation
  protected_anchor_changes: governed_approval_required
  real_state_migrations: explicit_approval_required
  new_paid_or_external_integrations: explicit_approval_required
  merge_publish_deploy: explicit_approval_required
  security_policy_bypass: forbidden
```

Este contrato não substitui políticas superiores da plataforma de execução nem o processo de alteração da governança do repositório. Resolva sua autoridade efetiva antes de atuar.

## 3. Regras de execução que não podem ser negociadas pelo agente

### 3.1 Evoluir o que existe

Não inicie por uma arquitetura imaginária. Inspecione a implementação e encontre consumidores reais de cada abstração antes de criar outra.

Preserve, quando confirmadas no checkout, as fronteiras entre `.enterprise/` como fonte institucional, `.agents/` como materialização compilada e `.hseos/` como configuração e estado de runtime. Atualize artefatos gerados pelo compilador, não por edições manuais divergentes. Preserve customizações locais dos projetos consumidores.

Não transforme este trabalho em migração obrigatória para Rust, Python, .NET, LangGraph ou qualquer outro runtime. A linguagem do harness e a linguagem do projeto consumidor são decisões independentes. Monólito modular bem delimitado é aceitável; independência de responsabilidade não exige microsserviços.

### 3.2 Não aprovar os próprios desvios

O processo que está alterando o HSEOS não pode mudar os controles ativos da própria execução para aprovar a alteração. Fixe o snapshot de política, a referência de aceite e o verificador confiável da execução atual. Novos controles devem ser avaliados como candidatos, em ambiente separado, antes de promoção autorizada.

Não desative hooks, anchors, testes, verificações de assinatura, restrições de branches ou gates para obter uma execução verde. Não reclassifique um requisito obrigatório como opcional depois de falhar. Uma correção legítima em teste ou requisito exige justificativa, rastreabilidade e a autoridade correspondente.

### 3.3 Autoridade e continuidade

Implemente decisões técnicas reversíveis dentro dos contratos aprovados sem pedir confirmação a cada arquivo. Quando surgir uma decisão não delegada, isole o bloqueio e continue apenas os miniobjetivos independentes que permaneçam seguros e autorizados. Se a política vigente exigir parada integral, respeite-a.

Solicite decisões humanas de forma consolidada: decisão necessária, alternativas, recomendação, impacto e ação exata autorizável. Não converta ausência de resposta em aprovação.

Não faça merge, publicação de pacote, ativação de provider, migração de estado operacional, alterações de credenciais, infraestrutura ou produção sem a autorização exigida. Testes com bancos descartáveis devem comprovar que não apontam para bases reais.

## 4. Fase inicial: descoberta e baseline reproduzível

Antes de editar, identifique raiz, branch, SHA, versão, arquivos modificados, worktrees, processos e tarefas concorrentes. Preserve alterações alheias. Use o ciclo de worktree já adotado pelo projeto.

Leia as instruções aplicáveis, constituição, ADRs relevantes, contratos, catálogos, comandos reais, fluxos de instalação, CI e estados de goals relacionados. Carregue apenas as skills necessárias. Descubra qual superfície executa `hseos-goal-loop`, goals e workflows neste checkout. Não presuma que `/goal` exista como alias universal; não invente flags ou comandos.

Inspecione os caminhos de entrada até os efeitos observáveis. Uma exportação em `index.js` não prova que o componente está ligado ao fluxo público. Um teste de schema não prova execução. Um provider anunciado no catálogo não prova autoridade ou capacidade operacional.

Mapeie, quando presentes:

- Contratos de agentes e providers, sessão e eventos, composição de contexto, compactação, runtime, orquestração, ferramentas e execução governada.
- Resolução de capacidades, compilação de artefatos, instalação, atualização, compatibilidade e estado dos consumidores.
- Broker de credenciais e egress, isolamento, delegação, rastreabilidade e verificação independente.
- Skills de goal/loop, comandos públicos, adaptadores de ferramentas e documentação de adoção.

Execute os testes canônicos descobertos, com limites de recursos e sequência compatíveis com a política. Registre comandos, versões, duração, exit code, falhas e indisponibilidades. Separe regressões introduzidas de falhas preexistentes. Não atualize dependências em massa para contornar um problema sem diagnóstico.

Produza um inventário com estas colunas:

```text
Capacidade | requisito | fonte/caminho | consumidor público | teste
Estado observado | limitação | decisão | prioridade | evidência
```

Use estados distintos: documentado, implementado, integrado, validado deterministicamente, validado com provider real, autorizado e operacionalmente ativo. Marque afirmações como observadas, inferidas ou não verificadas.

Classifique cada mudança como **preservar, integrar, completar, corrigir, experimentar ou rejeitar**. Registre o motivo. Um gap alegado deve apontar a um comportamento ausente, inadequado ou não demonstrado, não apenas a uma preferência arquitetural.

A descoberta deve ser suficiente para uma primeira entrega vertical. Não consuma toda a missão auditando sem implementar. Conclua uma fatia funcional antes de expandir para otimizações secundárias.

### Pistas específicas do HSEOS a revalidar

Inspecione a ligação entre `hseos agent`, o kernel nativo, os perfis candidatos e as ferramentas necessárias para editar/testar um projeto. Leia `test/test-agentic-completion-audit.js` e classifique quais propriedades usam doubles, endpoints locais ou integrações reais; preserve o valor de cada camada sem promover uma à outra.

Confronte `docs/RUNNING-GOVERNED-LOOPS.md`, os mecanismos de heartbeat e o estado de sessões: verifique se uma execução aparece de forma consistente nas superfícies públicas, sem depender de uma sincronização manual omitida do fluxo.

Revise `packages/agent-context/context-assembler.js`, em especial a procedência das instâncias, a reconstrução durável e como dados de referência/memória são mapeados para mensagens. Teste as propriedades de confiança e substituição antes de propor alterações.

Confronte regras genéricas, presets SWARM e adapters para separar escolha de fornecedor da política de autoridade. Essas pistas exigem confirmação no SHA atual; não são autorização para remover controles nem afirmação de que todos os caminhos continuam com o mesmo comportamento.

## 5. Arquitetura e desacoplamento que devem ser demonstrados

Valide as responsabilidades abaixo contra os módulos existentes. Estes são limites lógicos, não uma obrigação de criar novos diretórios, pacotes ou processos.

| Responsabilidade | Deve possuir | Não deve possuir |
|---|---|---|
| Contexto e conhecimento | Seleção, proveniência, frescor, orçamento e recuperação de informação | Permissão para executar efeitos |
| Intenção e planejamento | Objetivos, dependências, aceite, escolha justificada da próxima tarefa | Poder para enfraquecer políticas |
| Execução | Ciclo do agente, estado, orçamento, cancelamento e retomada | Regras particulares de cada fornecedor no núcleo |
| Governança e ferramentas | Decisão de autorização, isolamento e mediação de efeitos | Definição de sucesso comercial |
| Verificação e evidências | Execução de verificações e vínculo entre resultado e artefato | Autocertificação baseada no resumo do executor |
| Adaptadores e capacidades | Integração com modelos, runtimes, stacks, SCM e serviços opcionais | Segunda implementação das políticas centrais |

Mapeie dependências e ciclos. Cada módulo deve ter contrato, proprietário de estado e limites de erro. Prove substituição e falha por testes comportamentais, não apenas por busca de nomes de vendors no código.

Revise acoplamentos a classes concretas e verificações nominais. Diferencie acoplamento acidental de garantias intencionais de integridade e procedência. Não remova `instanceof`, factories verificadas ou checks de identidade simplesmente para tornar uma interface mais abstrata; preserve a propriedade de segurança com um contrato equivalente e teste negativo.

Defina a fonte de verdade **por agregado**. Sessões, fatos de execução, planos versionados, evidências e projeções podem ter armazenamentos diferentes. Elimine autoridades concorrentes sobre o mesmo fato; não imponha que todos os dados migrem para uma única tecnologia.

O uso local não deve exigir GitHub, um serviço gerenciado, um vault externo ou uma conta de determinado fabricante para planejamento, estado e validação determinística. Integrações de hospedagem devem ser capacidades explícitas. Uso de modelos ainda depende do backend efetivamente selecionado: não confunda local-first com inferência local automaticamente disponível.

## 6. Conectar especificação de projeto à execução

O HSEOS deve consumir diferentes organizações de documentação por configuração, sem exigir que todo projeto seja convertido para uma árvore rígida.

Reconheça, quando disponíveis, documentos de produto, domínio, arquitetura, design, requisitos funcionais e não funcionais, critérios de aceite, ADRs, specs por feature, OpenAPI, schemas de eventos/configuração, regras de segurança, testes e runbooks. Mantenha aliases e localização configuráveis.

Adote o padrão de feature compatível com a intenção anterior: contexto, objetivo, não objetivos, atores, pré-condições, regras e invariantes, contratos, persistência, transições, falhas, idempotência quando aplicável, segurança, observabilidade, aceite, testes e rollout.

Converta o material disponível em um **índice de especificação rastreável**. Para cada requisito aplicável, relacione fonte, versão/digest, critério de aceite, implementação, teste e evidência. O índice é derivado da fonte aprovada; não se torna uma cópia concorrente da especificação.

Detecte requisitos ausentes, contraditórios, obsoletos e sem prova de implementação. Preserve termos do domínio e um glossário quando necessário para resolver ambiguidade. Diferencie hipótese de requisito aprovado. Engenharia reversa descreve o comportamento observado, não prova que ele é o comportamento desejado.

A Definition of Ready deve ser proporcional à tarefa. Não exija dezenas de documentos para corrigir um bug bem delimitado. Descubra comandos e convenções em arquivos do projeto quando isso for seguro. Bloqueie apenas lacunas que alterem comportamento, contrato, risco ou possibilidade de validação, conforme a política aplicável.

Para cada goal ou miniobjetivo, materialize um contrato com:

```text
Identidade do projeto, repositório e execução; objetivo e não objetivos;
fontes e requisitos aplicáveis; baseline e versões;
pré-condições e dependências; critérios de aceite identificados;
escopo de leitura/escrita; efeitos permitidos e aprovações;
perfil de capacidades; provider/runtime e capacidades negociadas;
comandos de bootstrap, implementação, teste e verificação;
orçamentos; política de correção, bloqueio e cancelamento;
evidências esperadas; rollback e condição de conclusão.
```

Valide o contrato mecanicamente antes dos efeitos. Um YAML bem formado não basta: caminhos inexistentes, critérios sem verificador, capacidades indisponíveis e permissões incompatíveis precisam de diagnóstico preciso.

## 7. Capabilities: personalização sem governança decorativa

Evolua o catálogo e o resolvedor existentes, evitando duplicação de manifests.

Diferencie explicitamente **disponível, habilitada e obrigatória**, além de **suportada, comprovada e autorizada**. Essas dimensões não são sinônimos. Uma capacidade pode estar instalada e ainda não estar autorizada para determinada execução.

A configuração efetiva deve resolver dependências, conflitos, versões, permissões e precedência; fornecer explicação da origem de cada decisão; rejeitar chaves desconhecidas críticas; e gerar estado resolvido verificável. Mudanças semânticas exigem versionamento e migração compatível.

Capacidade opcional desligada não executa hooks, instala binários, abre portas, lê segredos, inicia processos nem acessa serviços silenciosamente. Falta de capacidade opcional pode degradar de maneira documentada; falta de uma capacidade obrigatória para o perfil deve impedir a execução incompatível.

Uma ferramenta de indexação ou dashboard pode ser opcional. Isolamento de efeitos não pode ser silenciosamente opcional para um perfil cuja autonomia depende dele. Negue a execução ou ofereça um modo de menor autonomia claramente distinto, sem promovê-lo automaticamente.

Separe baseline de segurança de preferências metodológicas. DDD, CQRS, event sourcing, GitOps, multiagentes, banco vetorial e estruturas documentais específicas são capacidades ou decisões de projeto, não requisitos universais do núcleo.

Demonstre perfis pequenos e compreensíveis: leitura/diagnóstico, implementação local governada e perfis adicionais por necessidade. Não crie um produto enterprise que exige instalar toda a superfície para corrigir um arquivo.

## 8. Providers, runtimes e protocolos

Preserve a distinção entre **ModelProvider**, quando o HSEOS controla o ciclo e as ferramentas, e **RuntimeProvider**, quando delega a um runtime externo. Não simule controle de ferramentas, contexto ou cancelamento que o runtime delegado não expõe.

Negocie capacidades reais por versão. Normalize eventos, erros, uso, interrupções, aprovações e efeitos por adaptadores tipados. Não baseie conformidade em parsing frágil de texto de terminal quando existir protocolo adequado.

A autoridade efetiva deve respeitar a interseção entre política do projeto, contrato do goal, capacidades do ambiente e capacidades verificadas do provider. Um manifest não pode conceder uma habilidade ausente. Um transporte compatível não comprova comportamento equivalente.

Elimine dependências indevidas de modelos e nomes de vendors no núcleo e nas políticas genéricas. Roteamento por custo, qualidade, contexto e risco deve utilizar perfis configuráveis. Presets específicos podem continuar existindo nos adaptadores corretos, preservando a governança de sua alteração.

Valide pelo menos duas famílias reais de backend para o caminho mínimo de autonomia requerido, sem alterar o núcleo entre elas. Dois modelos do mesmo serviço ou dois endpoints simulados não demonstram essa portabilidade. Os backends podem ser usados pelo kernel nativo; não é obrigatório forçar todos os runtimes delegados à mesma capacidade.

Se um adapter permanecer limitado a instruções ou execução de um turno, anuncie esse limite. Não o apresente como executor autônomo de código. Separe testes de protocolo, smokes autenticados, execução real com ferramentas e validação de uma tarefa de software completa.

Agent Skills, MCP e protocolos de delegação devem ser considerados nas versões oficiais efetivamente disponíveis e compatíveis. Use carregamento progressivo e extensões opcionais. Não trate metadados de skill, MCP ou ACP como substitutos para autorização, sandbox, persistência ou semântica de conclusão.

Avalie extensões negociadas de MCP para tarefas assíncronas e descoberta de skills quando reduzirem trabalho nos adapters. Handles duráveis de uma operação remota não substituem o estado durável do goal inteiro. Não habilite extensões sem suporte declarado nas duas pontas, testes de cancelamento/retomada aplicáveis e análise de permissões.

## 9. Um ciclo autônomo coordenado, não vários loops competindo

Integre as superfícies de goal, workflow e runtime já existentes. Defina qual componente é dono da execução. Um wrapper de `/goal` não deve criar um segundo orquestrador com estado independente ou um loop de retry invisível ao orçamento principal.

O ciclo deve escolher a próxima tarefa por dependências, risco, valor, prontidão e evidência de progresso. A decisão deve deixar uma justificativa curta e auditável; não exija exposição de raciocínio interno do modelo.

Use um executor por padrão. Separe planejamento e verificação por responsabilidade e contexto, não obrigatoriamente por agentes permanentes. Ative execução paralela somente para tarefas realmente independentes, com limites de recursos, escopo e autoridade herdados. Preserve a execução sequencial de estágios pesados enquanto essa for a política vigente.

Quando houver DAG, valide ciclos, pré-condições, joins, resultados parciais, invalidação e cancelamento. Quando houver loop exploratório, defina métrica de progresso e condição de parada. Não crie dez papéis para uma alteração simples.

Toda delegação deve transportar objetivo, entradas versionadas, caminhos permitidos, ferramentas, autoridade, orçamento restante, saída esperada e aceite. O filho nunca recebe autoridade superior à do pai. Limites de custo, profundidade e concorrência devem ser transitivos.

Em caso de falha: diagnostique, corrija o miniobjetivo e reexecute a verificação. Respeite o limite vigente de duas correções malsucedidas, salvo alteração de política explicitamente aprovada. Não reinicie com outro identificador para zerar o contador. Não consuma orçamento em tentativas idênticas sem informação nova.

## 10. Execução durável, reconciliação e recuperação

Prove persistência transacional de estados e transições, versionamento, leases quando necessários e proteção contra escritores concorrentes obsoletos. Valide reboot do processo, reconexão, retentativa, interrupção durante compactação e retomada a partir de evidências persistidas.

Não prometa execução exatamente uma vez de efeitos externos por possuir um event log. Quando uma ação puder ter sido concluída antes de cair a conexão, registre resultado desconhecido e reconcilie com o destino antes de tentar novamente. Use identificadores idempotentes quando suportados.

Retomada não é repetir um resumo. Revalide baseline, especificação, configuração, política, provider, sandbox e dependências. Mudanças relevantes devem invalidar checkpoints e evidências dependentes, sem descartar trabalho independente que continua válido.

Implemente ou complete cancelamento real de processos descendentes, ferramentas, subagentes, filas locais e novas tentativas. A operação deve ser idempotente e produzir estado terminal correto. Remover uma worktree não é uma implementação de cancelamento.

Orçamentos devem ser finitos, verificáveis e associados a toda a árvore de execução: tempo, tokens quando observáveis, chamadas, correções e recursos. Quando custo financeiro não for observável, reporte desconhecido/estimado e mantenha outros limites; não invente precisão. Não abra novos serviços pagos nem ultrapasse limites sem autorização.

Persistência deve sobreviver ao fim do contexto. Antes de encerrar uma sessão, registre o estado, próxima ação segura e dados para retomada. Não afirme que o agente continuará executando fora de uma sessão ou supervisor realmente ativo.

## 11. Context engineering e memória

Ofereça descoberta just-in-time: mapa do projeto, contratos relacionados, símbolos e dependências, arquivos afetados, testes relevantes e conhecimento necessário à tarefa. Evite carregar o repositório, todo o histórico ou a biblioteca completa de skills no prompt.

Mantenha busca por arquivos/texto como caminho mínimo funcional. Índices semânticos, AST/LSP, grafos de dependência, embeddings e reranking são capacidades opcionais, selecionadas por benefício medido. Não imponha banco vetorial ou serviço remoto para ler um repositório pequeno.

Verifique o frescor por conteúdo/commit e escopo, não apenas por idade cronológica. Um índice recente pode estar desatualizado após uma mudança local. Registre o modo de descoberta e os fallbacks; respeite políticas existentes que determinem o uso de índices quando saudáveis.

Toda memória reutilizável deve carregar origem, escopo, versão, validade e classificação de confiança. Diferencie fato verificado, decisão aprovada, hipótese, resultado de ferramenta e resumo. Não promova uma resposta anterior do modelo a verdade do projeto.

Revise o mapeamento de mensagens aos papéis suportados pelos providers. Dados de documentos, memória e ferramentas não devem ganhar autoridade de instrução por serem serializados junto às instruções. Delimitadores e JSON ajudam a representar informação, mas não substituem a mediação dos efeitos fora do modelo.

Compactação deve preservar objetivo, requisitos, decisões aprovadas, pendências, erros relevantes, evidências e limites. Deve manter referência ao conteúdo completo, permitir recuperação e passar por testes de continuidade. Não use um percentual fixo de contexto como garantia universal; reserve espaço para ferramentas, resposta e recuperação com base na capacidade e na medição disponíveis.

Meça contexto selecionado, omissões, desperdício, uso de cache e impacto na resolução da tarefa. Truncamento de saída de ferramenta não pode esconder erro ou evidência crítica; guarde a saída completa sanitizada e permita consulta por trecho.

## 12. Segurança que limita efeitos, inclusive efeitos transitivos

Revise o caminho completo entre pedido do modelo e efeito no ambiente. Shell, scripts, subprocessos, ferramentas MCP, browsers, interpretadores, gerenciadores de pacote e runtimes delegados devem respeitar a mesma autoridade efetiva. Um gateway de ferramentas não protege comandos executados fora dele.

Valide workspace permitido, caminhos normalizados, links simbólicos, traversal, diretório de trabalho, variáveis, processos descendentes, acesso à rede e segredos. Não exponha home pessoal, sockets privilegiados ou Docker do host por conveniência.

Use o backend de isolamento existente quando suficiente e verifique sua execução real. Binário instalado não prova sandbox funcional. Em perfis de escrita autônoma, falha de isolamento deve impedir a execução, não acionar um fallback menos seguro sem autorização.

Egress deve considerar destino, rota/operação, credencial, conta e payload permitido quando aplicável. Liberar um domínio inteiro pode liberar operações de upload ou contas que não pertencem ao projeto. Preserve e revalide o broker existente; não reescreva sua segurança sem necessidade demonstrada.

Resolva segredos no último momento e no menor escopo possível. Não inclua valores em prompts, checkpoints, diffs ou logs. Referências de segredo podem ser persistidas; seus valores, não. Teste redaction, reflexo de credencial na resposta e erros de transporte.

Trate código, hooks, configurações, dependências e documentos de um repositório desconhecido como não confiáveis até estabelecer a fronteira de confiança. A fase de descoberta não pode executar código automaticamente antes dela. Scripts de instalação e ferramentas baixadas exigem política de supply chain, integridade, versão e aprovação compatíveis.

Adicione testes adversariais para prompt injection, escalada por subagente, tool spoofing, mudança de argumentos após aprovação, troca de manifest, escrita fora do workspace, exfiltração e falsificação de evidência. Autorizações devem estar vinculadas à operação e expirar/invalidadas quando seu escopo mudar.

## 13. Validação independente e evidência não negociável

Há dois objetos diferentes a validar: **o HSEOS** e **o software produzido usando o HSEOS**. Um pode funcionar enquanto o outro falha.

Para o harness, use testes unitários, contratos, integração, concorrência, persistência, falhas, segurança, compatibilidade, instalação e regressão. Para o consumidor, execute os verificadores reais do seu perfil: build, testes, APIs, banco descartável, contratos, browser, acessibilidade e smoke operacional quando aplicáveis.

O verificador deve avaliar artefatos e efeitos, não apenas ler o resumo do executor. Mantenha conjuntos de regressão e avaliações independentes protegidos contra adulteração pelo processo avaliado. Teste também o verificador com soluções propositalmente erradas em fixtures; não force uma rejeição artificial em toda entrega válida.

Use avaliação por modelo somente para dimensões que a justifiquem, com rubrica e calibração. Consenso entre modelos não substitui teste de contrato, controle de acesso ou prova de persistência.

Cada evidência relevante deve vincular:

```text
run/goal/task IDs; repositório; baseline e revisão validada;
digest do conteúdo quando houver alterações ainda não commitadas;
requisitos e critérios; versões de spec, política e configuração;
provider/runtime/modelo; ferramentas e ambiente;
comando e argumentos sanitizados; cwd; início/fim; exit code;
resultado esperado e observado; logs/artefatos e seus hashes;
verificador; limitações; validade; aprovações e respectivas referências.
```

Evidência antiga não valida código novo. Hashes detectam alteração em relação a uma referência confiável; não tornam confiável um executor que pode alterar o artefato e o hash juntos. Use a fronteira independente de CI/verificação onde necessária.

Resultados devem distinguir aprovado, reprovado, bloqueado, não executado e não aplicável justificado. `skip`, placeholder, demo e mock não podem ser registrados como sucesso de integração real.

## 14. Instalação, operação local e experiência de uso

Demonstre instalação a partir do artefato empacotado em diretório limpo, sem depender do checkout de desenvolvimento, de caminhos pessoais ou de recursos globais não declarados.

Instalação e atualização devem ter plano/diff, idempotência, preservação de customizações, detecção de drift, integridade, compatibilidade e recuperação de falha. Atualização interrompida não pode deixar metade das capacidades na versão nova sem diagnóstico ou rollback possível.

Não replique a documentação inteira em `AGENTS.md`, `CLAUDE.md` e equivalentes. Mantenha entradas pequenas, precedência clara e referências para o conteúdo canônico. Formatos de adapters devem ser derivados e validados.

Ofereça, nas superfícies existentes ou em extensões justificadas, operações descobríveis para diagnóstico, preparação do projeto, planejamento, execução, estado, explicação de bloqueio, retomada, cancelamento e verificação. Os comandos devem ter ajuda, saída humana e machine-readable, exit codes e exemplos testados. Documente nomes reais, não os nomes desejados deste prompt.

O usuário deve conseguir entender o que está executando, qual foi o último progresso, por que parou, quanto consumiu e o que falta para aceitar o resultado, sem ler um histórico inteiro de conversa.

Telemetria deve funcionar localmente e exportar somente quando habilitada, com sanitização e esquema estável. Preserve adaptadores OpenTelemetry existentes quando adequados. Dashboards não podem virar autoridade de estado nem requisito obrigatório do núcleo. Não exponha portas na rede sem seleção explícita.

## 15. Tecnologia de ponta: experimentar com critérios de promoção

Compare referências atuais em fontes primárias, conferindo data, versão, maturidade, licença, compatibilidade e manutenção. “Mais recente” não é sinônimo de adequado. Não substitua uma implementação boa porque surgiu outra biblioteca.

Avalie, sem tornar tudo obrigatório: descoberta progressiva de ferramentas; execução programática/code mode dentro do gateway e sandbox; cache de prefixos estáveis; roteamento de modelos por custo e dificuldade; recuperação por símbolos e dependências; ambientes por worktree; reflexão orientada por falhas verificadas; orquestração recursiva com limites transitivos; otimização offline de prompts e do harness.

Para cada experimento, defina hipótese, baseline, métrica, dataset de avaliação separado, custo, risco, critério de promoção e rollback. Mantenha experimentos desligados por padrão. Promova apenas ganho reproduzível que compense sua complexidade.

Autoaperfeiçoamento deve significar produzir propostas avaliáveis para uma versão futura. O agente não pode modificar em tempo real a própria autoridade, o aceite, a rubrica ou os testes de controle para aumentar sua pontuação.

Não permita que experimentos secundários bloqueiem a entrega do caminho mínimo autônomo verificado.

## 16. Ordem de implementação

**Etapa A — Baseline e primeira fatia.** Confirmar o estado, contrato mínimo e caminho público. Executar uma tarefa pequena completa em fixture isolada usando o máximo possível da implementação atual. Identificar a primeira quebra real na cadeia.

**Etapa B — Fechamento dos gaps críticos.** Corrigir conexão especificação→contrato→executor→ferramentas→verificador→evidência, permissões, isolamento e resolução de capacidades. Entregar verticalmente; não passar semanas criando interfaces sem consumidor.

**Etapa C — Durabilidade e portabilidade.** Demonstrar retomada, cancelamento, reconciliação, contexto, concorrência controlada e substituição entre backends reais. Completar a experiência de diagnóstico e o empacotamento.

**Etapa D — Consumidores e prontidão operacional.** Revalidar compatibilidade, instalação, atualização e fluxo real em consumidores autorizados ou fixtures representativas. Preparar ativação conforme gates existentes, sem promover automaticamente um candidato.

**Etapa E — Otimizações medidas.** Executar somente experimentos priorizados e financiados depois do caminho essencial estar demonstrado.

Após cada miniobjetivo, atualize o estado canônico, aceite, evidências e próxima atividade. Não abra múltiplos ledgers concorrentes. Corrija a documentação que descreva um comportamento diferente do executado.

## 17. Definition of Done: matriz obrigatória de aceitação

Implemente estes cenários como testes ou ensaios reproduzíveis. Reutilize suites existentes que já demonstrem a propriedade e apenas complete seus gaps. Não duplique testes para aumentar contagem.

| ID | Critério e prova exigida |
|---|---|
| DOD-01 | **Baseline rastreável:** SHA, mudanças locais, versões, comandos, falhas preexistentes e escopo de autorização registrados. |
| DOD-02 | **Instalação limpa:** artefato empacotado instala e executa o caminho suportado sem dependências pessoais ocultas. Reinstalação é idempotente. |
| DOD-03 | **Atualização recuperável:** customização local preservada; drift identificado; falha induzida de upgrade tem recuperação testada. |
| DOD-04 | **Conexão com specs:** requisitos e aceite de uma fixture documental tornam-se contrato executável e evidência vinculada ao código entregue. |
| DOD-05 | **Projeto novo:** agente implementa uma funcionalidade verificável a partir de documentação suficiente, usando ferramentas reais em ambiente descartável, sem implementação humana durante a execução. |
| DOD-06 | **Legado:** agente reproduz um defeito semeado, cria/prova a regressão, corrige e mantém comportamentos não relacionados; não refatora o projeto inteiro. |
| DOD-07 | **Intenção incompleta/conflitante:** contradição de negócio produz bloqueio específico, nunca regra inventada ou conclusão falsa. Lacuna operacional recuperável é descoberta sem burocracia desnecessária. |
| DOD-08 | **Capacidade desligada:** zero efeito implícito da capacidade opcional, inclusive ausência de rede, processos, leitura de segredos e alteração global. |
| DOD-09 | **Capacidade obrigatória ausente:** falha fechada com motivo e solução; execução não continua com garantia inferior disfarçada. |
| DOD-10 | **Portabilidade real:** mesma missão mínima e mesmo núcleo funcionam com duas famílias reais de backend; limites de cada adapter são explícitos. |
| DOD-11 | **Queda e retomada:** interrupção após trabalho parcial não perde aceite/autoridade nem reexecuta cegamente um efeito de resultado desconhecido. |
| DOD-12 | **Cancelamento transitivo:** processos/filhos são encerrados dentro do limite do perfil; nenhuma nova ação é despachada; estado terminal é consistente. |
| DOD-13 | **Compactação:** após pressão de contexto, o agente retoma com requisitos, pendências, fontes e limites preservados, sem declarar sucesso prematuro. |
| DOD-14 | **Drift:** mudança de fonte, código, contrato ou política invalida apenas as evidências/checkpoints dependentes e impede aceite com prova obsoleta. |
| DOD-15 | **Concorrência:** dois workers sobre o mesmo recurso não promovem resultados conflitantes nem aceitam gravações de lease vencido. |
| DOD-16 | **Isolamento:** traversal, symlink, subprocesso, rede não autorizada e ferramenta indireta não atravessam o escopo permitido nas fixtures adversariais. |
| DOD-17 | **Injection e segredos:** conteúdo hostil não amplia autoridade; tentativas de exfiltração/reflexo de credencial falham e não deixam valores em artefatos. |
| DOD-18 | **Integridade do controle:** executor não consegue aprovar sua própria alteração de policy, adulterar evidência protegida ou substituir o verificador confiável. |
| DOD-19 | **Correção limitada:** falha de teste aciona diagnóstico/reparo; ausência de progresso e orçamento esgotado produzem checkpoint e bloqueio, não loop ilimitado. |
| DOD-20 | **Verificador eficaz:** implementações erradas, resultado fabricado e sucesso parcial são rejeitados por checks de efeito/artefato, não apenas por linguagem do relatório. |
| DOD-21 | **Qualidade do repositório:** gates obrigatórios, lint, contratos, testes relevantes, segurança e compatibilidade passam na revisão exata entregue, ou o estado permanece pendente. |
| DOD-22 | **Operação compreensível:** diagnóstico, status, motivo do bloqueio, comando real de retomada/cancelamento e orçamento estão acessíveis e documentados com exemplos executados. |
| DOD-23 | **Evidência real separada:** mocks, smokes, execução completa, autorização e ativação não compartilham um falso indicador único de prontidão. |
| DOD-24 | **Compatibilidade operacional:** gates temporais, consumidores, migração, rollback e autorização de ativação são comprovados conforme a governança vigente. Não substituir observação real por simulação. |
| DOD-25 | **Evolução sustentável:** documentação e adapters correspondem ao código; responsabilidades não se sobrepõem; não há implementação paralela sem consumidor ou expansão de dependências sem justificativa. |

### 17.1 Evals e metas anteriores à implementação

Congele a matriz antes de otimizar. Use pelo menos três tarefas representativas, incluindo projeto novo e legado, cobrindo ao menos duas stacks de consumidores suportadas. Não confunda isso com reescrever o harness em duas linguagens.

Para a prova inicial de repetibilidade, preveja três execuções independentes por tarefa/backend, usando duas famílias reais, totalizando 18 execuções. Só realize chamadas pagas e novos acessos dentro de orçamento e autorização existentes. Se a amostra não couber, registre o resultado como validação reduzida/pendente; não reduza o critério retrospectivamente e anuncie a mesma confiança.

Metas desta prova inicial: todos os casos determinísticos obrigatórios aprovados; nenhuma violação nas fixtures negativas de segurança; todas as execuções da pequena matriz obrigatória aprovadas sem correção humana da implementação. Isso comprova apenas essa matriz, não confiabilidade universal. Falhas devem permanecer visíveis, e novas campanhas devem ter nova versão sem apagar o histórico.

Registre taxa de sucesso, reincidência, intervenções humanas, custo por alteração aceita, tempo, tokens quando observáveis, falhas de ferramenta e retrabalho. Separe primeira tentativa de sucesso obtido após correções. Compare baseline e candidato com tarefas, condições e versões identificadas; não compare modelos diferentes como se o ganho fosse exclusivamente do harness.

Utilize tarefas inéditas/separadas para avaliar otimizações. Não exponha ao executor as respostas de referência ou os testes protegidos. Inclua intervalos/limitações amostrais quando reportar conclusões estatísticas. Ganhos de segurança podem justificar custo adicional, mas o trade-off precisa ser explícito.

## 18. Gates existentes e ativação: não falsificar prontidão

Releia o estado atual dos goals de runtime e compatibilidade. O levantamento externo que originou este prompt encontrou A13 ainda bloqueado para cutover, perfis candidatos e provas reais de providers limitadas em escopo. Isso é uma pista de auditoria, não um retrato garantido do checkout futuro.

Verifique a situação corrente, os ADRs e as evidências. Caso continue vigente a exigência de 30 dias completos de observação G9, valide a janela real disponível. Não altere relógio, gere histórico retroativo fictício, substitua dias reais por ciclos de teste ou declare aprovação humana inexistente.

Prepare e teste o que for possível em ambiente descartável. Evidências e aprovações pendentes devem produzir um estado operacional pendente, não impedir por conveniência todo avanço técnico independente nem autorizar o corte automaticamente.

Mantenha três avaliações separadas:

1. **Implementação de engenharia:** código, integração, testes e empacotamento demonstrados.
2. **Validação/ativação operacional:** providers, consumidores, compatibilidade, observação e autoridades demonstrados.
3. **Publicação/deploy:** ação externa fora do escopo automático desta missão.

Pronto para revisão não é ativado. Aprovado em conformance não é comprovado em produto real. Preparar um release não concede permissão para publicá-lo.

## 19. Entregáveis mínimos

Entregue alterações reais no código e testes, acompanhadas de um conjunto enxuto de artefatos nos locais canônicos já existentes:

- Avaliação baseada em evidências, mapa de responsabilidades e matriz de gaps/decisões.
- Contratos versionados e resolução de configuração; ADRs apenas para decisões que os exigem.
- Caminho público de execução integrado, adapters honestos e fluxo de consumo de especificações.
- Fixtures, testes, campanhas de eval e evidências reproduzíveis vinculadas às revisões.
- Documentação curta de instalação, configuração, operação, limites, migração e rollback.
- Relatório de conclusão legível por máquina e por pessoa, mais checkpoint/retomada quando necessário.

Não crie um arquivo por conceito se o repositório já tem um registro correspondente. Não use geração de documentos como substituto de integração funcionando.

## 20. Condições de parada e relatório final

Continue enquanto existir miniobjetivo relevante, autorizado, dentro do orçamento e com evidência de progresso. Não encerre apenas porque terminou o inventário, escreveu um plano, implementou uma interface ou obteve a primeira resposta do modelo.

Pare de forma controlada quando o objetivo aplicável estiver comprovado; quando não restar ação segura sem autoridade externa; quando faltar ambiente/credencial indispensável; quando um limite de segurança ou orçamento for atingido; ou após o limite vigente de correções malsucedidas.

Utilize os estados nativos de goal/loop do checkout. Não introduza uma enumeração paralela sem necessidade. Expresse separadamente o estado da implementação, da validação real e da ativação, mesmo que a superfície atual use apenas `complete`, `in-progress`, `blocked` e `pending-validation`.

O relatório final deve informar:

```text
Objetivo e escopo efetivamente atendido
Baseline e revisão/artefato entregue
Estado geral e estados por dimensão
Mudanças realizadas e justificativas
Critérios DOD: aprovado/reprovado/bloqueado/não executado/não aplicável
Comandos executados e referências às evidências
Providers/modelos/versões realmente utilizados
Resultados da matriz de eval e suas limitações
Regressões, riscos e dívida residual
Customizações preservadas e compatibilidade comprovada
Autorizações pendentes e efeito exato que exigem
Estado de ativação, rollout e rollback
Checkpoint e próxima ação segura, com comando real quando disponível
```

Não declare `complete` enquanto um requisito obrigatório da missão estiver pendente. Uma entrega técnica útil com bloqueio operacional deve ser apresentada como tal, sem exagerar nem apagar o trabalho realizado.

**Comece agora pela descoberta do checkout e do estado canônico. Defina o primeiro miniobjetivo verificável, execute-o e avance por evidências até a conclusão possível dentro da autoridade disponível.**

---

## Referências para a investigação técnica

Estas referências fornecem evidência de origem e direções de comparação, não autoridade para sobrepor as políticas do ambiente. Confira as versões vigentes na execução. As observações públicas do repositório não equivalem a testes executados por quem preparou este prompt.

```yaml
references:
  repository:
    - https://github.com/marciohideaki/enterprise-hseos
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/AGENTS.md
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/docs/capabilities.md
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/docs/RUNNING-GOVERNED-LOOPS.md
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/test/test-agentic-completion-audit.js
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/_graph/agentic-framework/STATE.md
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/.enterprise/governance/agent-skills/hseos-goal-loop/SKILL.md
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/packages/agent-runtime-contracts/provider-contracts.js
    - https://raw.githubusercontent.com/marciohideaki/enterprise-hseos/master/packages/agent-context/context-assembler.js
  engineering_primary_sources:
    - https://openai.com/index/harness-engineering/
    - https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
    - https://www.anthropic.com/engineering/harness-design-long-running-apps
    - https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
    - https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
    - https://www.anthropic.com/engineering/how-we-contain-claude
  interoperability:
    - https://agentskills.io/specification
    - https://modelcontextprotocol.io/specification/latest
  experimental_not_default:
    - https://arxiv.org/abs/2603.28052
    - https://arxiv.org/abs/2608.23552
```

As pesquisas experimentais sobre otimização de harnesses e ambientes recursivos devem alimentar experimentos isolados e avaliações separadas. Elas não são justificativa para introduzir autoalteração de governança ou infraestrutura obrigatória no caminho mínimo.

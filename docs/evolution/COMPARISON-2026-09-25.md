# HSEOS v4 versus Codex, Claude Code, Antigravity e DeepSeek Harness

Data da inspeção: 2026-09-25. Escopo: capacidades de harness e qualidade observável da implementação, não qualidade dos modelos.

**Conclusão:** HSEOS é uma candidata consistente para execução de engenharia governada e delimitada. Codex e DeepSeek apresentam maior amplitude de runtime e ferramentas de uso geral no código público examinado. Claude Code e Antigravity têm superfícies de produto mais abrangentes documentadas, mas seus repositórios públicos não permitem uma auditoria equivalente do motor completo. Não há evidência para declarar HSEOS superior como produto geral, nem para tratar sua contagem de testes como prova dessa superioridade.

**Método e limites.** Inspeção estática de fontes, contratos, testes e CI; leitura de documentação oficial; comparação com os recibos da v4. Não foram instaladas dependências nem executadas suítes ou tarefas com providers dos concorrentes. Uma checagem sintática sem execução analisou 109 arquivos Python do SDK Anthropic e 99 do SDK Antigravity, sem erro; isso não é teste funcional. Não houve benchmark com mesmo modelo, tarefa, orçamento e ambiente. Não foram usados mirrors de código vazado. Os checkouts de referência preexistentes foram preservados.

**Baseline HSEOS.** `4.0.0-rc.0`, worktree `hseos-v4-consolidation`, base Git `a842308` com alterações staged, ainda sem commit de consolidação. Os recibos recentes mostram `npm test` completo em Node 20.20.2 e 22.23.3: 799 testes Node por versão, zero falhas e skips, mais checks auxiliares, PostgreSQL 16.14 e lint. São testes repetidos entre versões, não 1.598 cenários distintos. Campanha de providers reais, CI hospedada/PostgreSQL 18 e ativação operacional permanecem separadas. A antiga análise de agosto que dizia que HSEOS não tinha agent loop não descreve esta revisão.

## Referências examinadas

| Produto / superfície | Commit | O que pode ser auditado |
|---|---|---|
| `openai/codex` | `1d804e91b75454927fb4f51615b067ba6158c37c` | CLI/runtime Rust, ferramentas, sandbox, persistência, protocolos e testes; não representa todos os serviços cloud da OpenAI |
| `deepseek-ai/deepseek-harness` | `477b4f420553e8a52c2fbccc464d7561b239c443` | Runtime e plugins TypeScript, backends, SDKs, UI e testes; revisão de release `0.1.7-rc.2` |
| `anthropics/claude-code` | `c94815511c7fb7a33900fe094bbc0dbee4a3b8ee` | Plugins, mods, exemplos, changelog e documentação; não o motor completo do CLI |
| `anthropics/claude-agent-sdk-python` | `dbc975eb2771acac751258a8c3b08100cdc54a50` | Cliente SDK, transporte, callbacks, lifecycle, armazenamento de sessão e testes; CLI externo continua sendo dependência |
| `google-antigravity/antigravity-cli` | `6dadd6227a49905f475d22b7f0afe59493229595` | README, changelog e exemplos; 15 arquivos rastreados, sem código do motor |
| `google-antigravity/antigravity-sdk-python` | `7f19db07e7c6c5038102b45a8a7a5da7eecc8b11` | SDK Python, políticas, transporte e testes; README exige binário compilado distribuído nos wheels |

O inventário de paths, revisões e datas está em `hseos-harness-comparison-20260925-sources.json`. `C` abaixo significa código/contrato inspecionado; `D`, documentação oficial ou delegação ao runtime; `ND`, equivalência não demonstrada no escopo examinado, nunca prova de ausência.

## Comparação das 27 famílias de capacidade

| Capacidade | HSEOS v4 | Codex | Claude Code + SDK | Antigravity + SDK | DeepSeek Harness |
|---|---|---|---|---|---|
| 1. Loop e lifecycle | C: loop próprio, limites e eventos | C: runtime de coding e streaming | C SDK / D motor CLI | C SDK / D motor compilado | C: loop substituível via Cordis |
| 2. Contrato objetivo/aceite/escopo | C: contrato estrito na engenharia | Configuração/instruções; equivalência ao aceite protegido ND | Configuração/SDK; equivalência ND | Personas/configuração; equivalência ND | Goal/configuração; equivalência ao aceite protegido ND |
| 3. Trabalhar em código | C: leitura/escrita/comandos Node/Python delimitados | C: patch, shell, ferramentas e contexto amplos | D produto; C integração SDK | D edição multifile/terminal/browser | C: fs, shell, terminal, LSP, browser e computer-use |
| 4. Gateway de tools | C: único caminho governado na composição | C: orquestrador e runtimes de ferramentas | C: callbacks/hooks SDK; motor D | C: policies/hooks/capabilities SDK | C: registry e pipeline pre/guard/around/post/result |
| 5. Política e aprovação | C: deny/ask, aprovação vinculada, autoridade não ampliável | C: política, aprovações e escalada conforme configuração | C/D: modos, permissões e callbacks | C/D: allow/deny/ask com precedência explícita | C: serviço approval com asked/decided e política never |
| 6. Agendamento de efeitos | C: scheduler limitado e barreiras | C: orquestração de tools/processos | Lifecycle acessível pelo SDK; detalhes internos ND | SDK/delegação; detalhe interno ND | C: jobs/schedule/subprocess e ownership |
| 7. Sandbox | C: engenharia Linux bwrap/seccomp/cgroup, sem fallback | C: implementações/configurações multiplataforma e rede | D produto: fs/rede; SDK expõe configurações | D CLI: fs/rede; C SDK: fallback requer atenção | C: sandbox local/SSH; backend informa full/partial |
| 8. Segredos/egress | C: broker, segredo fora do executor, destino fixo | Auth/rede/sandbox presentes; equivalência ao broker HSEOS não auditada | Configuração de auth/sandbox; equivalência ND | Configuração de auth/runtime; equivalência ND | Plugins de credenciais/sandbox; equivalência ND |
| 9. Aceite independente | C: três verificadores protegidos concretos | Review/testes disponíveis; contrato equivalente ND | Hooks/review disponíveis; contrato equivalente ND | Revisão de artifacts disponível; contrato equivalente ND | Relatos/evidências; ralph declara ausência de verificação independente |
| 10. Correção após rejeição | C: diagnóstico obrigatório, teto e reverificação | Iteração model/tools; reviewer de permissões não é aceite de entrega | Iteração/hooks; plugin ralph usa completion promise | D: interação/revisão de artifacts | C: goal/ralph/workflows; sem equiparar relato a aceite protegido |
| 11. Reconciliação de efeitos incertos | C: inspeciona/reverifica/pergunta; resposta ligada ao estado | Resume/restauração; equivalência a esse protocolo ND | Resume/rewind; equivalência ND | Resume/revisão; equivalência ND | Resume/logs/ownership; equivalência ao protocolo ND |
| 12. Subagentes/workflows | C: DAG delimitado, claims, join, cancelamento | C: multiagent, limites e testes de restauração | D produto + C configurações SDK | D subagentes/teamwork + C SDK | C: subagent/workflow/goal/ralph |
| 13. Orçamento | C: reserva, débito e liberação na árvore; sem reset | Controles e contagem; equivalência transacional da árvore ND | Limites SDK; equivalência da árvore ND | BudgetConfig; equivalência da árvore ND | Limites de goals/rounds e plugins; equivalência da árvore ND |
| 14. Contexto | C: precedência, fonte e request persistido | C: montagem de contexto, instruções e metadados | D motor / C opções SDK | D motor / C configurações SDK | C: prompt, runtime-context, skills e workspace |
| 15. Compactação | C: lineage, substituição exata e originais recuperáveis | C: compaction e testes combinados resume/fork | D compact/summarize; transcript original preservado | Detalhe de invariantes internos ND | C: compaction e snapshots de sessão |
| 16. Persistência/replay | C: ledger relacional e replay integral/incremental | C: JSONL, state DB e rollouts imutáveis no revert | C SDK session-store; transcript/motor D | C interface de conversação; persistência interna D | C: eventos, projeções e persistência JSONL versionada |
| 17. Model providers | C: contratos neutros; scripted e OpenAI-compatible | Configuração de modelos/providers; produto orientado ao Codex | SDK orientado ao ecossistema Claude | Gemini e conexões locais/OpenAI no SDK | C: arquitetura de adapters/plugins ampla |
| 18. Runtime providers externos | C: contratos próprios, candidatos L0/run-only conforme adapter | App-server/protocolos; não equivale à fachada HSEOS | SDK encapsula CLI; não fachada neutra genérica | SDK encapsula runtime; não fachada HSEOS | C: ACP, SDKs e composição; sem presumir equivalência contratual |
| 19. Estado/observabilidade | C: ledger, lineage W3C, snapshots, CLI/sidecars | C: rollout-trace, eventos, UI e telemetry | C/D: sessões, transcript e integração | C/D: estado, artifacts e OTEL do SDK | C: sessão, projeções, diagnósticos e UI |
| 20. MCP | C: servidores e execução governada | C: cliente/servidores e integração | C SDK / D produto | C SDK / D produto | C: plugins MCP |
| 21. Perfis/instalação | C: catálogo, dependências, materialização seletiva e lazy loading | Configuração/distribuição própria | Distribuição/plugins/settings próprios | Configuração/binários/SDK próprios | C: profiles/bundles e carregamento modular |
| 22. Extensões | C: skills/hooks/plugins/BYOA e compilação multiadapter | C: skills/hooks/MCP e protocolo app-server | C/D: plugins/hooks/skills/ecossistema | C/D: plugins/hooks/skills | C: plugins no próprio loop, tools, storage, UI e sandbox |
| 23. Governança de engenharia | C: autoridade, ADRs, worktrees e gates Git/PR | Recursos Git/review; conjunto institucional equivalente ND | Plugins/processos; conjunto equivalente ND | Regras/revisão; conjunto equivalente ND | Composição/review; conjunto equivalente ND |
| 24. Managed governance | C: sidecar shadow, catálogo, releases e auditoria | Oferta enterprise não auditada nesta comparação | Oferta enterprise não auditada | Oferta enterprise não auditada | Equivalente completo não demonstrado |
| 25. UX/serviços auxiliares | CLI/kanban/state UI; ainda limitada para coding geral | TUI e integrações documentadas com IDE/app | Terminal/IDE e superfícies documentadas | CLI/IDE/GUI/browser/artifacts documentados | C: web/desktop, terminal e browser |
| 26. Mensageria entre agentes | C experimental, fora do perfil padrão | Multiagent inspecionado; não mesma semântica de relay | Depende superfície; equivalência ND | Depende superfície; equivalência ND | Inbox/equipe/plugins; não mesma semântica HSEOS demonstrada |
| 27. Conformance/migração | C: replay, contratos, providers, ensaio de ativação/rollback | CI e testes de integração especializados | SDK tem testes e session-store conformance; core interno ND | SDK tem testes; core interno ND | CI, snapshots, testes e migrações de formatos |

Esta tabela compara funções, não afirma que qualquer configuração padrão ativa todos esses mecanismos. Um MCP instalado, um hook ou uma persona não tornam uma propriedade de segurança automaticamente obrigatória.

## Qualidade da implementação: achados concretos

**Codex — referência mais forte para estudar um coding harness de uso geral com core público nesta amostra.** `core/src/tools/orchestrator.rs` centraliza aprovação, escolha de sandbox e retry/escalada; `rollout/src/recorder.rs` mantém histórico inspecionável e suporta novo rollout imutável no revert. `core/tests/suite/compact_resume_fork.rs` testa a combinação entre compactação, retomada e fork, uma qualidade melhor que testar cada método isoladamente. Há testes especializados de network approval, multiagent e sandbox. Isso sustenta uma avaliação favorável de engenharia; não prova menor taxa de bugs nem superioridade de segurança em qualquer configuração. A grande superfície de plataforma e protocolos também aumenta o custo de integração. [Orquestrador](https://github.com/openai/codex/blob/1d804e91b75454927fb4f51615b067ba6158c37c/codex-rs/core/src/tools/orchestrator.rs), [persistência](https://github.com/openai/codex/blob/1d804e91b75454927fb4f51615b067ba6158c37c/codex-rs/rollout/src/recorder.rs), [teste combinado](https://github.com/openai/codex/blob/1d804e91b75454927fb4f51615b067ba6158c37c/codex-rs/core/tests/suite/compact_resume_fork.rs).

**DeepSeek — referência mais próxima para modularidade de runtime, com superfície funcional mais ampla que a jornada atual do HSEOS.** O loop, a API de agente, o pipeline de ferramentas e a persistência são separados em plugins. `session-persistence/src/index.ts` explicita revisões, continuidade do log e prefixo herdado no fork. O sandbox reporta enforcement parcial conforme backend, em vez de chamar toda implementação de equivalente. O Vitest configura cobertura por arquivo em 100% para o conjunto incluído, mas contém exclusões e partições: isso não significa cobertura universal nem resultado executado nesta auditoria. A condição developer preview e a multiplicidade de combinações de plugins são riscos de estabilidade/manutenção. [Core](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/README.md), [persistência](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-persistence/src/index.ts), [gate de cobertura](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/vitest.config.ts).

**Claude Code — produto funcionalmente amplo; qualidade interna só parcialmente auditável.** O SDK público contém cuidado concreto com cancelamento: fechamento protegido, espera limitada, terminate/kill e manutenção da identidade do filho para reaper quando ele não foi recolhido. Há testes próprios dessas condições. Isso é evidência positiva do SDK, não acesso ao loop inteiro do Claude Code. A documentação descreve checkpoints e rewind, mas deixa claro que alterações feitas por comandos Bash e efeitos externos não são universalmente revertidos. Não equiparar rewind a reconciliação. [Transporte SDK](https://github.com/anthropics/claude-agent-sdk-python/blob/dbc975eb2771acac751258a8c3b08100cdc54a50/src/claude_agent_sdk/_internal/transport/subprocess_cli.py), [testes de cancelamento](https://github.com/anthropics/claude-agent-sdk-python/blob/dbc975eb2771acac751258a8c3b08100cdc54a50/tests/test_close_cancellation.py), [checkpointing oficial](https://code.claude.com/docs/en/checkpointing).

**Antigravity — referência de interação visual e SDK, com uma ressalva específica de isolamento.** O produto documenta CLI, IDE, browser, artifacts e subagentes. O SDK expõe modelos, ferramentas, políticas, orçamento e continuidade, mas depende de motor Go compilado não presente no checkout. Em `local_connection.py`, `warn_if_sandbox_unavailable` avisa e mantém execução sem sandbox quando o sandbox solicitado está indisponível; sem status reportado, o aviso também não é emitido. Isso impede consumir apenas `enable_sandbox=True` como atestado obrigatório. É um achado no caminho SDK examinado, não uma afirmação sobre toda configuração do CLI/IDE, cuja documentação possui política própria de sandbox e aprovações. [README SDK](https://github.com/google-antigravity/antigravity-sdk-python/blob/7f19db07e7c6c5038102b45a8a7a5da7eecc8b11/README.md), [conexão SDK](https://github.com/google-antigravity/antigravity-sdk-python/blob/7f19db07e7c6c5038102b45a8a7a5da7eecc8b11/google/antigravity/connections/local/local_connection.py), [sandbox CLI/IDE](https://antigravity.google/docs/sandbox/), [artifacts](https://antigravity.google/docs/artifacts/).

**HSEOS — boa profundidade nos invariantes que implementou, com amplitude e comprovação operacional ainda limitadas.** O gateway, os recibos de aprovação, o ledger, o orçamento e a recuperação têm testes adversariais e de interrupção. A evidência recente de duas versões Node e PostgreSQL é concreta. Porém:

- Os verificadores protegidos de engenharia cobrem três fixtures específicas. Ainda falta demonstrar o mesmo contrato em projetos arbitrários e tarefas reais variadas.
- Adapters delegados L0/run-only não ampliam automaticamente as ferramentas do kernel.
- A campanha autorizável de 18 execuções com providers reais ainda não foi realizada.
- `eslint.config.mjs` ignora `packages/*`, exceto `agent-isolation-attestation`; a suíte verde não significa lint aplicado a todos os módulos do kernel.
- O comando `test:contract-coverage` mede dois arquivos específicos; não estabelece cobertura global do core.
- Há deriva documental: `packages/adapter-sdk/README.md` ainda diz scaffolded, enquanto `index.js` e testes implementam funcionalidades; a tabela de retomada em `docs/capabilities.md` ainda resume um estado anterior à reconciliação.
- O executor de engenharia exige um ambiente Linux compatível. Não há evidência nesta entrega de paridade Windows/macOS.
- Managed governance continua shadow e a mensageria continua experimental. Não contar essas superfícies como enforcement ou operação produtiva já ativados.

Esses limites não invalidam os testes que passaram; delimitam o que eles comprovam. Fontes locais: `tools/cli/lib/engineering-task-runtime.js`, `engineering-reconciliation.js`, `engineering-verifier.js`, `test/test-engineering-corrections.js`, `test/test-engineering-reconciliation.js`, `eslint.config.mjs`, `package.json`, `docs/v4/POSTGRES-NODE-MATRIX.md` na worktree candidata.

## Diferenças que mudam uma decisão de arquitetura

**Correção não é a mesma coisa que aprovação independente.** O `ralph` DeepSeek declara que os relatórios de conclusão dos workers não são verificados independentemente. O plugin `ralph-wiggum` do repositório Claude encerra com base em uma completion promise extraída da saída. Ambos podem apoiar iteração útil, mas não oferecem por isso o mesmo invariante do verificador protegido HSEOS. Isso não é alegação de que nenhum outro caminho desses produtos possa verificar resultados. [Ralph DeepSeek](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/workflow/tool-ralph/README.md), [stop hook Claude](https://github.com/anthropics/claude-code/blob/c94815511c7fb7a33900fe094bbc0dbee4a3b8ee/plugins/ralph-wiggum/hooks/stop-hook.sh).

**Sandbox não é um único sim/não.** O candidato HSEOS exige isolamento e bloqueia sem comprovação. Codex permite políticas e caminhos de escalada autorizada. O sandbox de processos DeepSeek delimita efeitos de filesystem; seu próprio contrato diz que a enumeração desses modos não governa rede e visibilidade de processos. Antigravity SDK admite o fallback descrito acima, enquanto o CLI/IDE documenta políticas próprias. Comparar cada composição concreta, não marcas. [Contrato de sandbox DeepSeek](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/sandbox.md), [Claude sandbox](https://code.claude.com/docs/en/sandboxing).

**Persistência não garante efeito exatamente uma vez.** JSONL ou SQLite podem sustentar bons projetos. A propriedade relevante é o que acontece entre intenção, efeito, recibo e retomada. No HSEOS esse caminho foi exercitado com interrupções e perguntas vinculadas ao estado atual. Nos concorrentes, esta inspeção não demonstrou contrato equivalente em todos os efeitos; não se deve converter esse limite de inspeção em alegação de ausência.

**Abertura para reuso é desigual.** Codex apresenta Apache-2.0; DeepSeek, MIT; SDK Python Anthropic, MIT; SDK Antigravity, Apache-2.0. O repositório Claude Code remete aos termos comerciais, e o runtime compilado Antigravity não fica aberto por seu SDK ser aberto. Examinar o arquivo e sua licença antes de qualquer incorporação; esta análise não autoriza copiar código nem instalar runtimes.

## Julgamento e prioridades

| Pergunta | Julgamento sustentado por esta análise |
|---|---|
| Melhor referência de implementação pública de coding harness geral? | Codex, pela amplitude do core disponível e pelos testes de integração examinados; inferência arquitetural, não benchmark |
| Referência mais próxima da modularidade substituível desejada? | DeepSeek, cujo loop e serviços são plugins; maior custo de controlar composições |
| Referências de produto e experiência de uso? | Claude Code e Antigravity, por suas superfícies documentadas; sem ranking de qualidade interna do motor fechado |
| Onde HSEOS tem diferenciação concreta? | Contrato de aceite independente, evidência e reconciliação explícita na jornada delimitada, mais governança institucional integrada |
| HSEOS já é equivalente como coding agent de uso geral? | Não demonstrado: escopo de verificadores, ferramentas, UX, sistemas operacionais e campanha real ainda é menor |
| Podemos atribuir uma nota global de qualidade? | Não com rigor: observabilidade desigual do código e ausência de benchmark comum tornariam a nota arbitrária |

Prioridade recomendada para HSEOS:

1. Generalizar o registro de verificadores protegidos com um consumidor real, preservando isolamento e critérios fora do controle da tarefa.
2. Executar a campanha real já definida: três tarefas, duas famílias de backend, três repetições; medir sucesso verificado, custo, tempo, correções e recuperação.
3. Fechar a exclusão de lint no kernel e medir cobertura dos módulos críticos; reconciliar documentos com a implementação atual.
4. Ampliar ferramentas de engenharia e observação somente com casos reais: diffs, busca estruturada, diagnóstico de testes e navegação de código. Browser/LSP/computer-use conforme demanda, sem adicioná-los apenas para igualar uma lista.
5. Incorporar padrões específicos de Codex para testes compostos e permissões, de DeepSeek para contratos de plugins, do SDK Claude para teardown e do Antigravity para apresentação de evidências/revisão.
6. Manter a migração e ativação produtiva separadas da consolidação técnica. Mais componentes e mais testes não substituem validação de efeito em operação real.

Não foram alterados runtime, dependências ou memória canônica durante esta comparação. As novas referências estão em `/workspace/local/references`; os checkouts anteriores de Claude Code e DeepSeek foram preservados.

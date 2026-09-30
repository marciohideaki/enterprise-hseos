# Plano de execução — evolução do harness

Tipo: plano de implementação. Fonte de intenção: plano do usuário de 2026-09-25.
Autoridade: Constituição 2.2 §§2.3/2.6/5/7, AGENTS.md §§4–9,
ADR-0042, ADR-0043 e política automated-validation.

## Base e isolamento

Feature: `feature/hseos-evolution-w0-quality`; base Git `a842308`.
Task: `task/hseos-evolution-w0`. A candidata não tinha commit consolidado:
seu conteúdo staged foi copiado para esta task, sem alterar o worktree original.
`baseline.json` fixa árvore do índice, patch SHA-256 e hashes dos arquivos.
O diff staged é a candidata importada; o diff não staged contém a evolução.
Não misturar os dois em um commit sem resolver a entrega da candidata.
Nenhum recibo anterior aprova o novo delta.

## Invariantes de todas as ondas

Kernel próprio reutiliza AgentRuntime, ToolRuntime, WorkflowEngine, supervisor,
política, ledger, broker e catálogo. CLI/API/SDK/IDE compartilham serviços; ledger
canônico, projeções descartáveis e trabalhadores remotos via API, sem SQLite
compartilhado em filesystem de rede. Contratos e eventos anteriores continuam
legíveis; nova semântica recebe versão explícita, sem reescrever históricos.

Identidade, sequência esperada e idempotência governam comandos; eventos usam
cursor recuperável. API local autenticada e restrita; remoto opt-in. Terminais
expõem entrada, saída, resize e attach sob a mesma autoridade. Aceite separado de
sessão concluída; verificadores fixados fora do controle da tarefa. Código do
projeto executa isolado; comparação confiável recebe somente resultados limitados.
Diagnóstico precede correção; tentativas e orçamento são finitos e acumulados.
Incerteza exige pergunta; edição concorrente invalida aprovação do baseline.

ModelProvider e RuntimeProvider permanecem distintos. Bindings declaram versões,
transporte, autenticação, cobrança, cotas e evidência de conformidade. Assinatura
primeiro quando oficialmente suportada; credencial efetivamente utilizada deve
ser comprovada. Não reutilizar tokens de assinatura como API genérica. Cota
ignorada é desconhecida, nunca ilimitada. Expiração, esgotamento e incompatibilidade
preservam estado e exigem decisão; mudança de backend não reseta orçamento nem
repete efeitos. Identidades individuais não formam pool compartilhado. Segredos
não entram em prompt, workspace, log ou artefato.

Kernel fora do Electron; IDE Code OSS usa API e extensão própria, com patches
limitados no workbench. Upstream fixado e build descartável reproduzível produzem
instalador independente. Catálogo inicial inclui apenas extensões licenciadas
para redistribuição. Electron não vira dependência do kernel. Alterações externas
são reconciliadas. Linux primeiro; macOS/Windows exigem execução nativa certificada.
Equipes em infraestrutura própria; SaaS multicliente/faturamento fora do escopo.
ADO, GitOps, second brain e managed governance continuam opcionais.

## Ondas sequenciais

| Onda | Entrega e verificação obrigatória | Dependência |
|---|---|---|
| W0 | Fixar candidata/recibos, lint integral, cobertura medida, docs reconciliadas, inventário das 27 famílias com fontes/testes/lacunas | candidata |
| W1 | Tarefa v2, workspace/baseline/escopo/comandos, registro protegido Node/TS/Python/web, busca/patch/diff/Git, API versionada e SDK JS/TS/Python; instalação limpa resolve projetos reais e rejeita entrega incorreta | W0 |
| W2 | Terminais e jobs, lifecycle, recuperação/cancelamento transitivo; crash em cada fronteira intenção/efeito/recibo sem repetição automática nem órfãos | W1 |
| W3 | Codex/Claude/DeepSeek/Antigravity, conta/API/local, manifesto de controle e cobrança; jornada real individual por binding oficial | W2 |
| W4 | Plugins de ferramentas/providers/contexto, DAG, subagentes, agendamento e orçamento agregado; reinício/concorrência/falha preservam autoridade | W3 |
| W5 | LSP/debug/browser/computer-use/multimodal/contexto/memória; consumidores reais demonstram delimitação e proveniência | W4 |
| W6 | Code OSS com editor/terminal/Git/debug, planejamento/revisão/evidências/aprovações; fechar/atualizar UI preserva trabalho; upstream/rollback reproduzíveis | W5 |
| W7 | Servidores próprios, identidade/autorização por projeto, trabalhadores remotos, revisão compartilhada, execução nativa macOS/Windows | W6 |
| W8 | Campanhas comparativas, docs de capacidades, migração, rollback e pacotes candidatos; paridade/ganhos comprovados e limitações publicadas | W7 |

As dependências são da entrega, não uma alegação de ausência de código existente.
Cada nova superfície deve consultar catálogo e grafo e registrar intake próprio;
não criar implementações paralelas dos serviços existentes. Quando o host não
permitir delegação governada, integrar como cliente do kernel e declarar onde
executa. Mensageria interagentes permanece experimental até ensaios de autoridade,
consumidores e recuperação próprios.

## Verificação e fechamento

Executar testes, lint, build, empacotamento e gates sequencialmente, com revisão
fixada. Matriz evolutiva Node 22/24; toolchain da IDE separada. Os recibos Node
20/22 da candidata permanecem históricos e intactos. Cobertura mínima 90/80 nos
arquivos críticos, complementada por falhas e mutação de autorização/orçamento/
recuperação. Suíte reduzida não substitui suíte completa.

Cobrir entrega correta/vazia/incorreta/adulterada; rejeição/diagnóstico/tetos;
crash/perda de recibo/concorrência/reconciliação obsoleta/cancelamento; descendentes
e múltiplos clientes; compactação+resume+fork e replay equivalente; escopo/segredos/
rede/tools desconhecidas; login/logout/cotas/credenciais concorrentes; equivalência
CLI/API/SDK/IDE; instalação externa/offline/lazy; upgrade e rollback sem reescrever
eventos. Downgrade não retoma efeitos de schema incompatível: drenar ou reconciliar.

Campanhas com bindings e orçamento explícitos: iniciar por 18 execuções; depois
≥30 tarefas reservadas, três repetições por configuração elegível. Separar
comparação do harness (modelo/tarefa/ambiente/orçamento iguais quando suportado)
e produto completo (configurações reais e diferenças declaradas). Medir sucesso,
intervenção, latência/recursos/consumo; acoplamento/isolamento/compatibilidade/custo
de carregamento; recuperação/repetição/órfãos/cancelamento; defeitos/aprovações
incorretas/tempo/rastreabilidade da revisão. Ganho exige indicador principal melhor
sem regressão obrigatória, intervalos de confiança agrupados por tarefa e
reavaliação periódica com versões fixadas. Empate/inconclusivo não é superação.

Cada marco mantém três estados: determinístico, consumidor real e ativação.
Merge, publicação, instalação global e ativação exigem decisões próprias.
Completude integral requer todas as capacidades exercitáveis, quatro integrações
classificadas/comprovadas e jornada CLI/API/SDK/IDE com continuidade segura.

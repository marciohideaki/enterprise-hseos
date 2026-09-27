# W4 - Extensibilidade e orquestração durável

Tipo: especificação de execução W4, autorizada em 2026-09-27. Aceite técnico ainda pendente.
Fonte: [plano W4](../../../docs/evolution/w4/PLAN.md), [plano original](../../../docs/evolution/PLAN.md), inventário `docs/evolution/requirements.json` e decisão diferida em W3-FR07.

## Propósito

Permitir composição de ferramentas, providers, contexto, workflows e subagentes mantendo uma única autoridade e orçamento durável.

## Atores e escopo

Operador individual, autores de plugins, clientes CLI/API/SDK, scheduler e subagentes.
Famílias de origem: F04, F06, F12, F13, F21, F22. Dependência: W3 aceita no escopo vigente.

## Fora de escopo

IDE, novas ferramentas de navegador/LSP, trabalhadores remotos multiusuário e campanha real da quarta família.

## Requisitos funcionais

- W4-FR01 (F04/F22): Todo plugin deve declarar identidade, versão, compatibilidade e capacidades; ferramenta desconhecida ou ampliação de autoridade deve ser recusada antes de qualquer efeito.
- W4-FR02 (F22): Um consumidor de cada tipo (ferramenta, provider, contexto) deve ser instalável sem alterar o kernel; falha/import de plugin não pode escapar do gateway ou executar código ainda não admitido.
- W4-FR03 (F06): Jobs devem persistir identidade, dependências, ownership, estado e reservas; dois schedulers concorrentes e reinício com job em voo não podem repetir efeito incerto.
- W4-FR04 (F12): DAG deve rejeitar ciclos e dependências inválidas e governar pré-condições, joins, resultados parciais e invalidação; descendentes dinâmicos mantêm escopo limitado ao pai.
- W4-FR05 (F12): Cancelamento transitivo idempotente deve atingir processos, ferramentas, subagentes, fila e retries; disputa de retomada deve produzir um dono válido e zero órfãos após drain.
- W4-FR06 (F13): Reserva, débito e liberação devem usar o orçamento composto existente; reinício, concorrência, troca de backend e criação de descendentes não podem resetar o teto ou liberar reservas incertas.
- W4-FR07 (F21): Perfis devem resolver dependências e incompatibilidades; help/import e módulos não selecionados não inicializam providers. Instalação externa, offline e upgrade/rollback devem produzir recibos.
- W4-FR08 (F19 transversal): CLI/API/SDK devem observar as mesmas identidades, sequências, reservas e resultados; rejeitar comandos obsoletos e repetição não idempotente.

## Requisitos não funcionais e constraints

- NFR01: autoridade só pode diminuir na delegação; rejeitar efeito sem admissão, aplicar política e gateway existentes. Constituição §§2.3/2.6/5/7 e Engineering Governance Standard.
- NFR02: preservar identidade, idempotência, sequência, orçamento e lineage em falhas; estado incerto exige reconciliação. Resilience Patterns Standard e contratos existentes do ledger.
- NFR03: novos eventos/contratos recebem versão explícita e leitura dos históricos permanece compatível; não reescrever recibos para obter PASS. Data Contracts & Schema Evolution Standard.
- NFR04: logs/eventos ligam tarefa, sessão, binding e revisão, sem valores de segredo; proveniência é parte do aceite. Observability Playbook e política de validação automatizada.
- NFR05: matriz kernel Node 22/24 sequencial; cobertura crítica mínima por arquivo 90% linhas/80% branches, incluindo arquivos não executados. Quality Gates & Compliance Standard.
- NFR06: medir latência/recursos/consumo no ambiente declarado; registrar limiares por cenário no design antes do ensaio. Não inventar SLA nem transferir benchmark de outra máquina.
- NFR07: usar intake v2 antes de novos exports; ledger, broker, política, catálogo e serviços compartilhados são reutilizados. AEW aplicação/enforcement não verificados nesta unidade de planejamento.

## Decisões confirmadas e fronteiras

1. Agendamento pontual e por dependências, sem recorrência.
2. Falha de nó interrompe novos despachos e persiste cancelamento/drain da árvore.
3. Aceite exige consumidores locais reais e bindings atuais elegíveis, sem elevar o teto US$ 10 (US$ 9 reservados).
4. Quarta família diferida para depois de todas as fases.
5. Código externo usa processo isolado; inspeção e resolução não importam módulos.
6. Nova definição de workflow v2 preserva leitura/replay v1; catálogo preserva plugins v2.
7. Instalação global, publicação, ativação e merge da PR dependem de decisões separadas.

Contratos detalhados em [design.md](design.md); sequência em [tasks.md](tasks.md).
ADR-0045 é Proposed: documenta a implementação candidata autorizada, sem declarar
aprovação institucional nem ativar migrations operacionais. A disponibilidade de
binding real não foi presumida; W4-07 deve verificar autorização atual e consumo.

## Aceite e evidências

Aplicar gates G0–G6 do plano. Cada FR exige caso positivo, rejeição/falha relevante e recibo no snapshot examinado. Registrar três estados separados: determinístico, consumidor real e ativação.
Não declarar PASS por presença de código, mocks, logs de outra revisão ou plataforma não exercitada.

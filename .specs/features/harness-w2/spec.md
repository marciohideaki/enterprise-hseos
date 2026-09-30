# W2 — Terminais e lifecycle

## Propósito, atores e escopo

Operador e clientes programáticos controlam comandos declarados de tarefas v2
por terminais PTY ou jobs com pipes, independentemente de IDE. O serviço existente
é a autoridade; nenhum endpoint aceita comando arbitrário, ambiente ou PID.

## Requisitos funcionais

- FR01: iniciar comando declarado com identidade idempotente e sequência esperada;
  persistir intenção antes de qualquer processo. Não repetir intenção sem recibo.
- FR02: entregar saída binária limitada em eventos base64 com cursor persistente;
  anexar/reconectar não reinicia comando. Entrada tem identidade própria.
- FR03: PTY permite entrada, resize, pausa, continuação, SIGINT e encerramento;
  jobs permitem entrada, EOF, acompanhamento e os mesmos controles pertinentes.
- FR04: timeout e saída têm limites finitos do contrato; reservas de chamadas
  persistem e compartilham o orçamento da tarefa com o runtime existente.
- FR05: desconexão do cliente não mata job; morte do controlador encerra o sandbox
  e descendentes. Recuperação drena grupos órfãos, nunca relança comandos.
- FR06: resultado incerto requer reconciliação explícita vinculada ao digest do
  relatório observado. Cancelamento permanece permitido durante recuperação.
- FR07: sessões concorrentes não compartilham entrada/saída; cancelamento de tarefa
  fecha admissões e termina todos seus terminais antes de declarar encerramento.
- FR08: API autenticada, CLI e SDKs JS/TS/Python expõem o mesmo protocolo.

## NFR e constraints

Linux x64, Node 22/24, bwrap/seccomp/cgroup existentes; sem dependência nova.
Workspace readonly, ambiente vazio, rede negada. Saída é dado não confiável;
clientes não devem renderizar controles ANSI automaticamente. Ledger SQLite existente;
sem migração operacional. Data Contracts & Schema Evolution, Resilience Patterns,
Quality Gates e Hexagonal & Clean Architecture governam compatibilidade e falhas.
Testes/builds sequenciais, concorrência 1. Durabilidade limitada ao fixture candidato.

## Fora de escopo

IDE, shells no host, provedores/modelos reais, remoto multiusuário, persistência
operacional, publicação, migração e outras ondas. Recuperação não conserva processo
vivo após morte do controlador: conserva eventos e exige reconciliação do efeito.

## Questões abertas

Nenhuma para a candidata Linux. Primeiro recorte: terminais são admitidos antes da
execução do modelo; parent resume/apply ficam bloqueados enquanto houver terminais
ativos ou incerteza. Isso impede corrida entre ferramentas do modelo e entrada humana.
EOF de PTY é entrada EOT; jobs fecham pipe. Pausa não suspende o orçamento de tempo.
EOF/saída do processo não prova sucesso da tarefa nem aprovação do verificador.

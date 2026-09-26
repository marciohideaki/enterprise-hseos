# Onda 2 — terminais e lifecycle

Revisão posterior autorizada: [REVIEW.md](REVIEW.md). Os resultados abaixo
descrevem a entrega original; correções da revisão exigem recibo separado.

Candidata Linux implementada e verificada deterministicamente em Node 22.23.3 e
24.15.0. Base imediata: `feature/hseos-evolution-w1-engineering`; feature:
`feature/hseos-evolution-w2-terminals`; execução: `task/hseos-evolution-w2`.

PTY com controlling tty e jobs com pipes compartilham o controle autenticado,
ledger, políticas e orçamento da tarefa. Entrada, saída cursorada, resize,
pausa/continuação, interrupção, EOF, anexação, encerramento, recuperação e
cancelamento de descendentes estão implementados. Incerteza exige decisão
explícita vinculada ao relatório; recuperação não relança comandos.

## Verificação e aceite

| Verificação                                    | Node 24                             | Node 22                             |
| ---------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Gates integrais, incluindo PostgreSQL de teste | 914 testes; zero falhas/skips       | 914 testes; zero falhas/skips       |
| Kernel e terminais instrumentados              | 440 testes; zero falhas/skips       | 440 testes; zero falhas/skips       |
| Cobertura crítica JavaScript                   | 95,63% linhas / 88,46% branches     | 95,63% linhas / 88,46% branches     |
| Gate por arquivo crítico                       | aprovado: 90% linhas / 80% branches | aprovado: 90% linhas / 80% branches |
| Pacote instalado fora do checkout              | CLI/HTTP/JS/Python aprovados        | CLI/HTTP/JS/Python aprovados        |

Os 24 testes W2 estão incluídos nos totais; as execuções instrumentadas repetem
testes da suíte integral. Contrato SDK TypeScript compilado com `tsc --strict`.
Lint, formatação, schemas, manifesto CLI e grafo passaram. As etapas foram
sequenciais, com concorrência de testes 1 e sem subagentes. Não houve execução
remota de CI. Um aviso herdado de placeholders no template de épicos permanece.
O c8 mede JavaScript; o broker Python foi exercitado por subprocessos reais.

| Critério                                                 | Evidência                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Intenção/efeito/recibo sem retry automático              | SIGKILL antes da intenção, depois dela, após preparação, antes/depois do recibo e durante recibo de entrada; `test-terminal-control.js` |
| Ausência de descendentes órfãos nos cenários exercitados | cgroup drenado antes da recuperação; deadline, EOF do controlador, interrupção e descendentes destacados; `test-terminal-executor.js`   |
| Incerteza residual                                       | recibo perdido não é fabricado nem reexecutado; decisão exige digest atual; encerramento posterior não apaga a incerteza                |
| Concorrência e recuperação                               | duas sessões, CAS, orçamento compartilhado, recuperação por outro controlador e cancelamento durante recuperação                        |
| Reconexão e consumidores                                 | cursor persistido, attach/detach, API autenticada, CLI/SDKs; jornadas instaladas com PTY e job vivos e cancelamento do parent           |

Recibo: [evidence/receipt.json](evidence/receipt.json). Ele vincula logs, manifests
de fontes, pacote e diferenças documentais posteriores à matriz. A separação Git
está em [evidence/git-separation.json](evidence/git-separation.json).

## Tentativas e correções do ambiente de validação

Uma tentativa sem cgroup delegado falhou antes de lançar comandos. A matriz usou
escopos temporários `systemd-run --user --scope -p Delegate=yes`; a política de
isolamento foi preservada. A primeira cobertura Node 24 herdou o índice Git
temporário nas fixtures e falhou em dois testes de aplicação Git. O runner passou
a remover variáveis Git locais nessa etapa; a repetição na mesma revisão passou.
O primeiro parser de `npm pack --json` recebeu um aviso de stderr junto ao JSON;
stdout/stderr foram separados e o empacotamento foi repetido. Logs preservados.

## Três estados e limites

- Implementado e verificado: candidata Linux, incluindo falhas e concorrência.
- Consumidores: CLI/API/SDKs instalados em ambientes locais verificados; attach
  interativo testado com streams determinísticos e executor PTY real. Não houve
  certificação com modelos reais nem jornada manual de operador.
- Operacional: não ativado; schema candidato 11 e operacional v4 preservados.

Requer cgroup v2 delegado, bubblewrap/seccomp e Python com suporte a pidfd.
Terminais são admitidos antes da execução do modelo, sobre workspace readonly e
com rede negada. Desconexão de cliente preserva processo; morte de controlador
encerra árvore e exige recuperação/reconciliação. Fixture temporário não garante
retenção após limpeza ou reboot. API loopback não certifica acesso remoto W7.
ADR-0044 e o draft de lifecycle permanecem drafts.

## Separação e continuidade

HEAD e refs da cadeia permanecem em `a8423081934d64538d71ef8289f072d51566a870`.
O índice W2 contém a importação completa W1, tree
`0a3dbeecc043127438a9aa16eeb689bf6bc57deb`; não atribuir todo staged à W2.
Delta isolado: `.logs/validation/w2/wave2-delta.patch`, reconstruído em índice
temporário e vinculado ao recibo. Nenhum commit, PR, merge, publicação ou
instalação global foi realizado no repositório nesta entrega.

W1 original: 2.139 hashes de arquivos, índice e patch preservados. Também foram
conferidos 1.956 hashes da candidata v4 e 839 fontes do recibo W0, sem divergências.
Antes de integrar, ler a separação Git W1 e W2 e decidir a sequência governada;
a preparação local não integrou branches. W3 exige escopo próprio. Pendências
herdadas fora da W2 não foram executadas nem encerradas.

Especificação/design/tasks: `.specs/features/harness-w2/`. Intake:
`docs/decisions/harness-w2-intake.md`. Protocolo: `docs/engineering-control-api.md`.
Governança consultada: AGENTS global/projeto; produtor e709368, discovery,
Constituição, core/\_INDEX, Hexagonal Architecture, Data Contracts, Resilience,
Quality Gates, capability-graph e automated-validation. Skills spec-driven,
verification-before-completion e second-brain. AEW aplicação/enforcement não
verificados. A continuidade canônica do projeto no vault aponta para esta W2.

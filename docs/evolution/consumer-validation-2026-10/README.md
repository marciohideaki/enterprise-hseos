# Validação em consumidor real — 2026-10

Registro da bateria de validação do harness HSEOS (`4.0.0-rc.0`) contra um
consumidor real, executada em 2026-10-10 e 2026-10-11, das correções que ela
motivou (C1 a C5) e da reexecução com o harness corrigido. Estado, tabela de
achados e pendências: [STATUS.md](STATUS.md). Recibo da verificação final:
[verification-receipt.json](verification-receipt.json). Evidências: [evidence/](evidence/).

## Por que

A revalidação do core ([revalidation-2026-10](../revalidation-2026-10/README.md))
usou fixtures próprias. Esta bateria troca a fixture por um projeto que o harness
não escreveu, para separar o que funciona no repositório do harness do que funciona
quando um consumidor o instala sobre uma adoção existente.

## Consumidor

- Monorepo pnpm em TypeScript/React (`apps/*` e `packages/*`, 581 arquivos JS/TS/TSX
  rastreados), com adoção prévia do HSEOS (`.hseos/` com runs e state, registros de
  intake próprios).
- Cada rodada usou um **clone descartável** (remote removido). O repositório real
  não foi alterado: o inventário de arquivos (caminho, tamanho, mtime) foi idêntico
  antes e depois. A única exceção observada foi o mtime do diretório `.git`, causado
  por `git status` (ver B2, H1).
- Nenhum fan-out: nada rodou na raiz do monorepo (`pnpm test`, `pnpm -r`, `turbo`);
  tudo por `--filter`/pacote, `vitest run --maxWorkers=2`, sob `heavy-run`.

## Método

- **B1 (instalação, governança, guard, MCP):** instalação sem TTY sobre adoção existente,
  reinstalação e upgrade, `install-plan`, `governance-context`, `capability-check`,
  validação do contrato do repositório, `sandbox`, `plugin`, `agent-core`, o guard
  léxico sobre o corpus inteiro nos modos platform/hybrid/local (581 arquivos lidos,
  0 ilegíveis) e os quatro servidores MCP em stdio, inclusive a ponte real do índice
  de código.
- **B2 (tarefa v2, jobs, terminal, modelo real):** `hseos control serve` em cgroup
  delegado; pacote `packages/formatting` (um arquivo de produção, 32 testes vitest);
  tarefas com entrega correta, incorreta, correção após diagnóstico, escrita fora do
  escopo e edição concorrente; jobs `workflow` (DAG, cancelamento com drenagem);
  terminal pty; e **um** despacho de modelo real pela rota de assinatura
  (`claude/account`, custo registrado zero, 3091 tokens de entrada e 324 de saída),
  com aceite externo pelo vitest real do projeto. Os demais passos usam respostas
  roteirizadas: exercitam kernel, gateway, executor e verificador, não raciocínio de modelo.
- **Reexecução (B1V2, B2V2):** mesmas baterias com clone novo e o pacote construído de
  `df8bae8a` (branch `fix/harness-consumer-findings`), sem novo despacho a modelo.
- **Verificação final:** matriz Node 24.15.0 e 22.23.3 e jornadas do pacote instalado.

## O que foi corrigido

| Correção | Commit     | Escopo                                                                                                            |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| C2       | `96817c92` | instalação, reinstalação e upgrade sobre adoção existente, sem prompt; `--tools none`; `install-plan --directory` |
| C3       | `f9639303` | guard lê os workspaces declarados pelo consumidor e valida registros de intake em JSON                            |
| C1       | `da2e2c42` | `command_checks` e `protected_paths`: comando de aceite que falha reprova a entrega                               |
| C5       | `0a197f55` | eventos e evidência de workflow materializado por job; `detail.code` nas recusas da API                           |
| C4       | `0d970dec` | detecção dos stacks reais de cada pacote e casamento de consultas com várias palavras                             |

Integração: `df8bae8a`. Cada correção passou por revisão cética de duas passagens
(`evidence/reviews/`); o revisor reporta e o executor corrige.

## Limites

- O consumidor é um só; os números do guard e do registro de capacidades valem para
  o corpus e o registry desse consumidor.
- Os aceites do projeto real (vitest, `tsc`) rodaram no host, fora do executor isolado:
  o executor ainda não consegue rodá-los (ver A1/N2 em [STATUS.md](STATUS.md)).
- O que não foi reverificado ou não pôde ser classificado está nomeado em STATUS.md.

# Revalidação do core — estado

Atualizado em 2026-10-10. Base: `master` `4a95592b`. Ponta verificada: `1ae317c0`
(branch `feature/core-revalidation-2026-10`, a integrar na `master`). Decisões do dono
e pendências abertas estão explícitas abaixo; nada pendente é tratado como aprovado.

| Etapa | Escopo                                                              | Resultado                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0    | Preparação: worktree isolado, ambiente Node 22/24, limites de carga | Concluída                                                                                                                                                                                                                                                                                                |
| A1    | Linha de base da `master`                                           | **Aprovada**, ver abaixo                                                                                                                                                                                                                                                                                 |
| A2    | Pacote: `npm pack` e instalação offline fora do checkout            | Linha de base: 1472 entradas. Após G3: 1459 entradas, tarball `hseos-4.0.0-rc.0.tgz` sha256 `fcb81c1adbad85a5c5f057eda42fff5485649996b2126a9ed90531d6697ed0be` (construído de `82e4c2cc`), instalado offline                                                                                             |
| A2b   | Capacidade do inventário do pacote                                  | Análise concluída; resultado aplicado em G3                                                                                                                                                                                                                                                              |
| A3    | Jornada do plano de controle (API + SDK JS/TS/Python)               | Antes das correções: 11/12 PASS, `s09` FAIL. Após A6: **12/12 PASS** em `82e4c2cc` (Node 24), 0 processos residuais. Evidência: [final3](evidence/final3/core-journey-result.json); original: [a3](evidence/a3/core-journey-result.json)                                                                 |
| A4    | Jornada dos 4 servidores MCP                                        | Antes das correções: 13 achados brutos (2 altos, 7 médios, 4 baixos), consolidados em 9. Após A6: veredito **PASS**, 144 verificações PASS, 0 FAIL, 0 BLOCKED, 0 órfãos em `82e4c2cc`. Evidência: [final3](evidence/final3/mcp-journey-result.json); original: [a4](evidence/a4/mcp-journey-result.json) |
| A5    | Execução com modelo real                                            | Executada com autorização do dono (2026-10-09), ver abaixo. Uma rota **BLOCKED** na época e uma ressalva de ponte manual, ambas tratadas em A8/A9 e reexecutadas na A5b                                                                                                                                  |
| A5b   | Jornada governada campanha → tarefa em modelo real                  | Jornada PASS nas duas rotas; aceite do verificador externo **FAIL** na rota de API paga. Ver abaixo                                                                                                                                                                                                      |
| A6    | Correções de A3/A4                                                  | Integradas, todas com revisão cética de duas passagens. Ver abaixo                                                                                                                                                                                                                                       |
| A7    | Documentação, jornadas versionadas e CI                             | Jornadas em `test/journeys`, workflow `core-journey.yaml`, reconciliação dos STATUS                                                                                                                                                                                                                      |
| A8    | Adapter de assinatura `claude/account`                              | Integrado (`fb9e1888`, `3243ec98`, `54028f37`), com revisão cética                                                                                                                                                                                                                                       |
| A9    | Saída de campanha como entrada de tarefa `campaign://`              | Integrada (`616939a7`), com revisão cética de duas passagens                                                                                                                                                                                                                                             |
| G3    | Decisão do dono sobre o teto do inventário do pacote                | **Decidida em 2026-10-09 e aplicada** (`2da8d58c`): 14 arquivos removidos do repositório, 3 excluídos do pacote, teto 1540 entradas, 14 MB desempacotados, orçamento por área                                                                                                                            |

## A1 — linha de base da `master` (2026-10-09)

Node 24.15.0 e Node 22.23.3, executados em sequência com cgroup delegado:

- `npm test`: 1439/1439, zero falhas e zero skips em cada versão.
- `test:kernel-coverage`: 96,8% linhas / 90,1% branches no agregado; gate por arquivo 90/80 aprovado.
- `test:w4-mutations`: 18/18 mutantes rejeitados.
- `quality-gates.sh --phase ci` com `VALIDATION_ENFORCED=true`: zero falhas (um aviso preexistente).

Uma primeira tentativa em Node 24 falhou em 2 testes de desempenho do guard
(201,9 ms contra o limite de 200 ms) sob carga externa. Ela **não** conta como
aprovação; a linha de base é a repetição registrada. Recibo da linha de base:
[evidence/a1/verification-receipt.json](evidence/a1/verification-receipt.json)
(`BASELINE_VERIFIED_PRE_FIX`).

## A6 — correções (todas com revisão cética de duas passagens)

- Transporte MCP fail-closed: mensagens malformadas, parâmetros inválidos e notificações (`843650e5`).
- `axon-bridge` fala MCP com `axon serve` e reporta falhas de forma explícita (`bf4239b5`); espera a saída do `axon serve` antes da chamada seguinte, contra corrida de lock (`5ad4a722`).
- Plano de controle HTTP/SDK/install honra os códigos de status documentados (`af10a352`).
- `swarm` confinado ao diretório de execuções do projeto do consumidor (`3a0bc6a0`).
- Testes de regressão ligados ao `npm test` (`4ee90e1d`) e jornadas fail-closed (`86e745bb`).
- Inventário do pacote (G3, `2da8d58c`).

## Matriz final (A6 em diante)

Dois conjuntos de execuções, ambos em Node 24.15.0 e Node 22.23.3. O recibo é
[verification-receipt.json](verification-receipt.json) (`VERIFIED_BEFORE_PR`).

- **final3, ponta `82e4c2cc`**: `npm test` 1493/1493 em Node 24 e 22; `test:w4-mutations` 18/18; `quality-gates.sh --phase ci` com zero falhas (um aviso); pacote de 1459 entradas instalado offline; jornada do núcleo 12/12 PASS; jornada MCP PASS com 0 órfãos. **`test:kernel-coverage` FALHOU (exit 1) em Node 24 e em Node 22** (agregado 93,76% linhas / 88,7% branches): dois testes do adapter `claude/account` e do driver de CLI falharam sob a cobertura, porque a variável de cobertura chegava ao ambiente do processo filho que as asserções de allowlist verificam. A falha está registrada e não conta como aprovação.
- **final4, ponta `1ae317c0`** (correção `ea1ff3ec`, apenas 3 arquivos de teste): `test:kernel-coverage` aprovado em Node 24 e 22 (96,86% linhas / 90,26% branches, 0 arquivos abaixo de 90/80) e `npm test` 1493/1493 em ambas.

Limite desta matriz: `test:w4-mutations`, `quality-gates` e as jornadas de pacote
instalado **não** foram reexecutados em `1ae317c0`; valem para `82e4c2cc`, e a única
diferença até `1ae317c0` é a troca de testes acima. O commit de documentação desta
entrega fica acima de `1ae317c0` e não foi coberto pelas execuções.

Evidências: [final3](evidence/final3), [final4](evidence/final4).

## A5 — modelo real (autorização do dono, 2026-10-09)

Rotas autorizadas: LiteRT local, assinatura `claude`, assinatura `codex` e API paga com
teto de US$ 1. Tarefa: atualizar uma seção do README em clones descartáveis, com
verificador externo fixado antes dos despachos. Relatório:
[evidence/a5/A5-REPORT.md](evidence/a5/A5-REPORT.md); dados:
[a5-result.json](evidence/a5/a5-result.json).

| Rota                           | Resultado                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Assinatura `codex`             | PASS; 3 de 3 despachos usados (o primeiro falhou antes do turno por `pids.max=64`); verificador externo PASS |
| API paga                       | PASS; US$ 0,00696 reais (SDK), US$ 0,25 reservados; verificador externo PASS                                 |
| Assinatura `claude`            | **BLOCKED**: não havia adapter para a rota; não foi contornado. Motivou A8                                   |
| LiteRT local com filho `codex` | PASS composto: o texto foi escrito pelo filho; o modelo local apenas delegou                                 |

Ressalva: o recibo só trazia o hash da evidência, então o patch foi montado a partir
de transcrições externas ao HSEOS (ponte manual). Isso motivou A9.

## A5b — jornada governada campanha → tarefa

Relatório: [evidence/a5b/A5B-REPORT.md](evidence/a5b/A5B-REPORT.md); dados:
[a5b-result.json](evidence/a5b/a5b-result.json). Sem passo manual: campanha, leitura da
evidência, criação da tarefa com `campaign://`, retomada, revisão e aplicação.

| Rota             | Jornada | Verificador externo | Observação                                                                                                       |
| ---------------- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `claude/account` | PASS    | **PASS**            | 1 de 3 despachos; rota certificada com uso real; custo nulo; exceção de cota do dono registrada                  |
| API paga         | PASS    | **FAIL**            | O critério interno da tarefa (um `content-includes`) aprovou o que o verificador fixado reprova. Não foi refeita |

Reuso da mesma saída em outro recurso foi recusado nas duas rotas
(`CONTROL_CAMPAIGN_EVIDENCE_CONSUMED`). Custo real acumulado da API paga: US$ 0,00696 (A5)
mais US$ 0,016614 (A5b), US$ 0,023574 no total, dentro do teto de US$ 1; o grant da A5b foi de
US$ 0,75, dentro desse teto. O custo vem do estado de custo do SDK, não de fatura.

Lacuna de observabilidade: `init` (`apiKeySource`, `fast_mode_state`, modelo),
`rate_limit_event` e `pids_peak` entram apenas no hash da evidência e não são expostos
pelo recibo. Não eram recuperáveis sem contorno ou despacho extra (a sessão da assinatura não foi
persistida). Portanto, o `apiKeySource` e os demais campos de `init` do despacho real **não foram
observados**; só os testes determinísticos do adapter cobrem esse comportamento.

## Pendências registradas (não resolvidas; candidatas a W5 ou a decisão do dono)

- `loop-guard.sh` com `REPO_ROOT` padrão, no pacote instalado, grava em `node_modules`.
- `pids_max=64` é insuficiente para clientes reais (o cliente `codex` bateu no teto).
- Critérios de aceite fracos da tarefa aprovam entrega que o verificador externo reprova (A5b, API paga).
- Sinais `init`, `rate_limit` e `pids_peak` não são expostos no recibo.
- Adapters de API, ACP e local não retêm a evidência da saída (só o adapter nativo e `claude/account`).
- Divergência `-32600` do adapter `mcp-2026` para notificação de método conhecido.
- `limit` e `stale_minutes` em string agora são rejeitados (mudança de comportamento a comunicar).
- Transporte HTTP legado sem limite de corpo.
- `$ref` não resolvível só falha no momento da chamada.
- Riscos residuais no `swarm`: TOCTOU, hardlink e `cwd` não validado.
- O digest de conta do `claude/account` é calculado sem sal.
- Gotcha operacional: o hook de mensagem de commit bloqueia nomes de fornecedor de IA.
- Os requisitos em [requirements.json](../requirements.json) seguem **sem atualização** para as 27 famílias: não há mapeamento citável entre as famílias e as evidências W3/W4/A1-A9 que permita mudar o estado sem inventá-lo.

## Limites

- A ativação operacional não foi autorizada. As rotas reais foram exercitadas em uma tarefa de documentação descartável, com orçamento fixo; isso não certifica operação geral, outros provedores nem outras tarefas.
- O CI `core-journey.yaml` reflete as correções A6; o resultado do CI na PR ainda não existe e não é afirmado aqui.
- Pendências acima e a falha de `kernel-coverage` em `82e4c2cc` permanecem registradas, não omitidas.

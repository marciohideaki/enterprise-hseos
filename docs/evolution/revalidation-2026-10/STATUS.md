# Revalidação do core — estado

Atualizado em 2026-10-09. Base: `master` `4a95592b`. Decisões do dono pendentes
e a etapa de modelo real estão explícitas abaixo; nada pendente é tratado como aprovado.

| Etapa | Escopo                                                              | Resultado                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0    | Preparação: worktree isolado, ambiente Node 22/24, limites de carga | Concluída                                                                                                                                                                        |
| A1    | Linha de base da `master`                                           | **Aprovada**, ver abaixo                                                                                                                                                         |
| A2    | Pacote: `npm pack` e instalação offline fora do checkout            | Tarball `hseos-4.0.0-rc.0.tgz`, sha256 `ea1a430de8aea5777a9daa6639220720bb809e09e448ccb37500d826ca450064`, 1472 entradas                                                         |
| A2b   | Capacidade do inventário do pacote                                  | Análise concluída: 17 arquivos sem consumidor (textual), recomendação de teto aguarda a decisão G3. Inventário e `test/test-package-surface.js` **não** foram alterados          |
| A3    | Jornada do plano de controle (API + SDK JS/TS/Python)               | 11/12 PASS; `s09` FAIL (ID inexistente de terminal e campanha devolve 409, o contrato exige 404). Evidência: [a3](evidence/a3/core-journey-result.json)                          |
| A4    | Jornada dos 4 servidores MCP                                        | O resultado registra 13 achados brutos (2 altos, 7 médios, 4 baixos); a análise consolidou 9 (2 altos, 4 médios, 3 baixos). Evidência: [a4](evidence/a4/mcp-journey-result.json) |
| A5    | Execução com modelo real                                            | **Pendente.** Não executada; sem despacho a modelo ou provedor, sem custo                                                                                                        |
| A6    | Correções de A3/A4                                                  | Quatro correções aprovadas em revisão cética de duas passagens, em branches de tarefa **ainda não integradas nesta base**                                                        |
| A7    | Documentação, jornadas versionadas e CI                             | Esta entrega: jornadas em `test/journeys`, workflow `core-journey.yaml`, reconciliação dos STATUS                                                                                |
| G3    | Decisão do dono sobre o teto do inventário do pacote                | **Pendente**                                                                                                                                                                     |

## A1 — linha de base (2026-10-09)

Node 24.15.0 e Node 22.23.3, executados em sequência com cgroup delegado:

- `npm test`: 1439/1439, zero falhas e zero skips em cada versão.
- `test:kernel-coverage`: 96,8% linhas / 90,1% branches no agregado; gate por arquivo 90/80 aprovado.
- `test:w4-mutations`: 18/18 mutantes rejeitados.
- `quality-gates.sh --phase ci` com `VALIDATION_ENFORCED=true`: zero falhas (um aviso preexistente).

Uma primeira tentativa em Node 24 falhou em 2 testes de desempenho do guard
(201,9 ms contra o limite de 200 ms) sob carga externa. Ela **não** conta como
aprovação; a linha de base é a repetição registrada. Recibo:
[verification-receipt.json](verification-receipt.json) (`BASELINE_VERIFIED_PRE_FIX`).
A matriz posterior às correções A6 será anexada depois e ainda não existe.

## Pendências registradas (W5-04)

Itens identificados na revisão de A6 e deliberadamente não resolvidos aqui:

- Divergência `-32600` do adapter `mcp-2026` para notificação de método conhecido.
- `limit` e `stale_minutes` em string agora são rejeitados (mudança de comportamento a comunicar).
- Transporte HTTP legado sem limite de corpo.
- `$ref` não resolvível só falha no momento da chamada.
- Riscos residuais de TOCTOU, hardlink e cwd não validado no swarm.

## Limites

- A5 pendente: nada aqui certifica modelo real, provedor ou operação.
- O CI novo (`core-journey.yaml`) falhará nesta base enquanto as correções A6 não forem integradas (`s09` e os achados altos do MCP).
- Os requisitos em [requirements.json](../requirements.json) não foram alterados por esta revalidação: não há mapeamento citável entre as 27 famílias e as evidências W3/W4/A1-A4 que permita mudar seu estado sem inventá-lo.

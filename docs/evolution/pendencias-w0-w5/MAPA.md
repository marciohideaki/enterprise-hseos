# Pendências das ondas W0–W5 — mapa (2026-10-23)

Tipo: levantamento. Não altera estado de nenhuma onda nem aceita nada. Fontes: [requirements.json](../requirements.json),
[PLAN](../PLAN.md), STATUS de [W0](../W0-CLOSEOUT.md), [W1](../w1/STATUS.md), [W2](../w2/STATUS.md), [W3](../w3/STATUS.md),
[W4](../w4/STATUS.md), [W5](../w5/STATUS.md), [revalidação](../revalidation-2026-10/STATUS.md), [consumidor real](../consumer-validation-2026-10/STATUS.md),
ADRs 0042–0048 e `test/test-package-surface.js`. Itens marcados "verificado" foram conferidos no código nesta data; os demais vêm dos documentos.
Nada aqui foi reexecutado.

## 1. Decisões sem dono ou sem aceite

| Item                                       | Situação                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0043 (plano de evolução)               | `Draft de rastreabilidade`; não certifica capacidade nem autoriza merge, publicação ou ativação                                             |
| ADR-0044 (controle de engenharia; W1 e W2) | `draft`                                                                                                                                     |
| ADR-0045 (plugins e jobs duráveis; W4)     | `Proposed`                                                                                                                                  |
| ADR-0042                                   | "decisão de implementação candidata", sem aceite                                                                                            |
| ADR-0046                                   | Aceito, mas depende da Decision 0006 do ECP e diz que não pode ser aceito sem ela; estado dessa decisão não confirmado nos documentos lidos |
| ADR-0047, ADR-0048                         | Aceitos; o 0047 declara que não promove os 0043, 0044 e 0045                                                                                |

W1 a W5 foram construídas e mergeadas sobre ADRs que nunca foram aceitos (0042 a 0045).

## 2. Pendências por onda

**W0.** F23 (governança de engenharia) segue `not_verified_for_evolution`: o gate 90/80 por arquivo existe e passa, mas o gap da família diz que cobertura
e mutação "precisam de evidência". Os 18 mutantes dirigidos não são mutation score exaustivo (`_INDEX.md`).

**W1.** Limites declarados no `w1/STATUS.md` que podem ter mudado depois: TypeScript verificado por remoção de tipos e não por `tsc` completo, web por
conteúdo estático, repositórios com filtros Git recusados, workflows sem aplicação agregada de patches. Dívida 18: `max_tokens` abaixo de ~12000 termina em
`session-failed:internal_error` sem causa. F02, F03, F05, F09, F10 e F19 sem consumidor real.

**W2.** F01, F11 e F16 com consumidor só em escopo instalado local. Bytes anteriores à persistência podem se perder em crash; retenção operacional e acesso
remoto não certificados. Exige cgroup v2 delegado, bubblewrap e pidfd; `test-mcp-environment-host` (K9) falha sem cgroup delegado, também na baseline.

**W3.** Quarta família (família API compatível; o plano canônico lista DeepSeek) não exercitada, por decisão do dono "só depois de todas as fases" (FR07
pendente). F08, F17 e F18 seguem `not_verified_for_evolution` apesar das campanhas reais de Codex, Claude e Antigravity local. `tools/call` e aprovação MRTR do
Codex `NOT_EXERCISED`. Financeiro: teto US$ 10, reservas US$ 9, saldo US$ 1, 30 despachos; a reserva retida pelo recibo rejeitado não tem decisão de liberação.

**W4.** F22 (catálogo certificado de extensões da IDE) pendente. Plugins `scaffolded`. F06 (agendamento persistente), F12 (descendentes dinâmicos) e F13
(campanha concorrente com bindings reais) não certificados; F04, F06, F12, F13 e F22 sem consumidor real. Na A5b, a rota de API paga foi aprovada pelo critério
interno e reprovada pelo verificador externo; a causa foi tratada para novas admissões e a rota não foi refeita.

**W5.** F14, F15 e F20 sem consumidor real (o consumidor A provou instalação e admissão, não que LSP ou DAP guiaram a correção; o B é sintético). Multimodal:
contrato existe, mas a elicitação de `computer.*` mostra o digest do screenshot, não a imagem. Navegador e computer-use na CLI exigem broker de egress, media
store e canal de aprovação humana. Mutantes sem detecção (M09, M18b, N5, `dap_survivor`), CSP sem leitura de violação, `memory.write` sem aprovação do runtime
(decisão do owner de 2026-10-21), `packages/agent-environment/index.js` fora de `.c8-kernel.json`.

## 3. Transversais

- **Aceites do Commander.** Dos 27 resíduos do `w5/STATUS.md`, 17 estão "aceito"; 8 têm o owner como dono (PEM multilinha, `JSON.parse`, CSP, falhas de infra
  do CI, 3 execuções do mesmo teste, elicitação sem imagem, `memory.write`, arquivo fora do c8). O registro não diz que o owner os aceitou.
- **Capacidade do pacote (G3), verificado.** `tools` 393 e `packages` 137 arquivos, iguais aos tetos de `test-package-surface.js`; os orçamentos por área
  somam o teto de 1556. Código novo em `tools/` ou `packages/` exige decisão do owner.
- **Estado operacional.** `requirements.json` marca `operational: not_authorized` em todas as famílias, embora o piloto tenha sido ativado em 2026-10-22.
- **Sunset do legado.** Sem data; a condição do ADR-0048 (Codex em `2026-07-28` sem flag) não foi atendida.
- **ECP.** `ecp-registry.snapshot.json` e `test/fixtures/ecp-registry/*` ainda citam `Hideaki-Solutions-Core`.
- **Integrações.** O plano pede quatro integrações comprovadas; há três.
- **Plataformas.** Só Linux; macOS e Windows são da W7.

## 4. Pendências da revalidação de 2026-10: situação em 2026-10-23

Lista original em [revalidation-2026-10/STATUS.md](../revalidation-2026-10/STATUS.md). Só marco "resolvido" o que tem evidência citada.

| Pendência original                                                              | Situação                                                                                                                                                             | Evidência                                                                                                                                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transporte HTTP legado sem limite de corpo                                      | Resolvido (verificado)                                                                                                                                               | `tools/lib/mcp-transport.js:28,61-86`: teto de 1 MiB, corpo recusado com 413 sem ser interpretado                                                                  |
| Divergência `-32600` do adapter `mcp-2026` para notificação de método conhecido | Resolvido (verificado)                                                                                                                                               | `tools/lib/mcp-2026-adapter.js:1079`: comentário e comportamento alinhados ao `mcp-transport`                                                                      |
| `limit` e `stale_minutes` em string rejeitados (mudança a comunicar)            | Resolvido (verificado)                                                                                                                                               | nota de migração em `docs/v4-migration.md:106`                                                                                                                     |
| `pids_max=64` insuficiente / faixa duplicada                                    | Resolvido (verificado)                                                                                                                                               | `engineering-task-contract.js:8,134` deriva a faixa de `LIMIT_FLOOR`/`LIMIT_CEILING` (`84746de5`); varredura ainda limitada a 5 arquivos (resíduo 12 do w5/STATUS) |
| `loop-guard.sh` grava em `node_modules`                                         | Resolvido segundo o `w5/STATUS.md` (cl1, item 9); não reverificado no código                                                                                         | w5/STATUS, "Fora da W5, só registradas"                                                                                                                            |
| Critérios de aceite fracos aprovam entrega reprovada                            | Tratado para novas admissões (W5-10b, `ENGINEERING_ACCEPTANCE_UNCOVERED`); rota de API paga da A5b não refeita                                                       | w5/STATUS, W5-10b; PLAN de fechamento, W2                                                                                                                          |
| Sinais `init`, `rate_limit`, `pids_peak` fora do recibo                         | Parcial: a W5-10 expôs sinais do executor; `init` e `rate_limit` seguem declarados desconhecidos e `pids_peak` foi reconfirmado como não observável no despacho real | w5/STATUS, W5-10; consumer-validation, A7                                                                                                                          |
| Adapters API, ACP e local sem retenção da saída                                 | Aberto                                                                                                                                                               | decisão de retenção de dados                                                                                                                                       |
| `$ref` não resolvível só falha na chamada                                       | Não verificado                                                                                                                                                       | —                                                                                                                                                                  |
| Riscos residuais do `swarm` (TOCTOU, hardlink, `cwd`)                           | Não verificado                                                                                                                                                       | —                                                                                                                                                                  |
| Digest de conta do `claude/account` sem sal                                     | Aberto                                                                                                                                                               | persistido; mudar exige versionar o formato                                                                                                                        |
| Hook de mensagem de commit bloqueia nomes de fornecedor de IA                   | Aberto (gotcha operacional)                                                                                                                                          | —                                                                                                                                                                  |
| `requirements.json` sem atualização                                             | Parcial: o fechamento ligou evidência a F04, F06, F08, F12, F13, F17, F18 e F21–F23 ou justificou `not_verified`                                                     | w5/STATUS, fechamento/W6-E2                                                                                                                                        |

## 5. Decisões que dependem do owner

1. Aceitar, alterar ou rejeitar os ADRs 0042, 0043, 0044 e 0045; confirmar a situação da Decision 0006 do ECP.
2. O que certifica um binding (F08, F17, F18) e quando a quarta família roda, com credencial e teto.
3. `tools/call` e MRTR do Codex (login e gasto); liberação da reserva de US$ 9.
4. Navegador e computer-use na CLI.
5. Data do sunset do legado.
6. Teto do inventário (G3) ou onde fica o código da W6.
7. O significado de `operational` por família depois da ativação do piloto.
8. Se os aceites do Commander atribuídos ao owner valem como decisão dele.
9. Retenção de evidência nos adapters; formato versionado do digest de conta; lista de gates do ensaio de ativação (`g9-zero-legacy-window`) e conjunto do gate de
   cobertura (`.c8-kernel.json`).
10. macOS e Windows (W7) e tag nova do ECP: dependem de terceiros ou de infraestrutura.

O que pode avançar sem essas decisões está em [PLAN.md](PLAN.md).

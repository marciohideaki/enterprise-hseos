# Pendências das ondas W0–W5 — mapa (2026-10-23)

Tipo: levantamento. Não altera estado de nenhuma onda nem aceita nada. Fontes: [requirements.json](../requirements.json),
[PLAN](../PLAN.md), STATUS de [W0](../W0-CLOSEOUT.md), [W1](../w1/STATUS.md), [W2](../w2/STATUS.md), [W3](../w3/STATUS.md),
[W4](../w4/STATUS.md), [W5](../w5/STATUS.md), [revalidação](../revalidation-2026-10/STATUS.md), [consumidor real](../consumer-validation-2026-10/STATUS.md),
ADRs 0042–0048 e `test/test-package-surface.js`. Itens marcados "verificado" foram conferidos no código nesta data; os demais vêm dos documentos.
Nada aqui foi reexecutado.

## 1. Decisões sem dono ou sem aceite (ADRs 0042 a 0045 aceitos em 2026-10-30)

| Item                                       | Situação                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0043 (plano de evolução)               | era `Draft de rastreabilidade`; **aceito pelo owner em 2026-10-30**; não certifica capacidade nem autoriza ativação                 |
| ADR-0044 (controle de engenharia; W1 e W2) | era `draft`; **aceito pelo owner em 2026-10-30**                                                                                    |
| ADR-0045 (plugins e jobs duráveis; W4)     | era `Proposed`; **aceito pelo owner em 2026-10-30**                                                                                 |
| ADR-0042                                   | era "decisão de implementação candidata", sem aceite; **aceito pelo owner em 2026-10-30**                                           |
| ADR-0046                                   | Aceito; depende da Decision 0006 do ECP, que está Accepted (2026-10-01, owner), conferido em 2026-10-27 por `gh api` no repo do ECP |
| ADR-0047, ADR-0048                         | Aceitos; o 0047 declara que não promove os 0043, 0044 e 0045                                                                        |

W1 a W5 foram construídas e mergeadas sobre ADRs que, até então, nunca tinham sido aceitos (0042 a 0045). O owner os aceitou em 2026-10-30, reconhecendo a decisão já implementada; o aceite não ativa nem publica nada além do que o ADR-0048 e as autorizações próprias já cobrem.

## 2. Pendências por onda

**W0.** F23 (governança de engenharia) segue `not_verified_for_evolution`: o gate 90/80 por arquivo existe e passa, mas o gap da família diz que cobertura
e mutação "precisam de evidência". Os 18 mutantes dirigidos não são mutation score exaustivo (`_INDEX.md`).

**W1.** Limites declarados no `w1/STATUS.md` que podem ter mudado depois: TypeScript verificado por remoção de tipos e não por `tsc` completo, web por
conteúdo estático, repositórios com filtros Git recusados, workflows sem aplicação agregada de patches. Dívida 18: `max_tokens` abaixo de ~12000 termina em
`session-failed:internal_error` sem causa. F02, F03, F05, F09, F10 e F19 sem consumidor real.

**W2.** F01, F11 e F16 com consumidor só em escopo instalado local. Bytes anteriores à persistência podem se perder em crash; retenção operacional e acesso
remoto não certificados. Exige cgroup v2 delegado, bubblewrap e pidfd; `test-mcp-environment-host` (K9) passa sem cgroup delegado, com 1 skip, desde a P2 (T-3); a falha original já não existe.

**W3.** Quarta família (família API compatível, a quarta das listadas na linha W3 do [PLAN](../PLAN.md)) não exercitada, por decisão do dono "só depois de todas as fases" (FR07
pendente). F08, F17 e F18 seguem `not_verified_for_evolution` apesar das campanhas reais de Codex, Claude e Antigravity local. `tools/call` e aprovação MRTR do
Codex `NOT_EXERCISED`. Financeiro: teto US$ 10, reservas US$ 9, saldo US$ 1, 30 despachos; a reserva retida pelo recibo rejeitado não tem decisão de liberação.

**W4.** F22 (catálogo certificado de extensões da IDE) pendente. Plugins `scaffolded`. F06 (agendamento persistente), F12 (descendentes dinâmicos) e F13
(campanha concorrente com bindings reais) não certificados; F04, F06, F12, F13 e F22 sem consumidor real. Na A5b, a rota de API paga foi aprovada pelo critério
interno e reprovada pelo verificador externo; a causa foi tratada para novas admissões e a rota não foi refeita.

**W5.** F14, F15 e F20 sem consumidor real (o consumidor A provou instalação e admissão, não que LSP ou DAP guiaram a correção; o B é sintético). Multimodal:
contrato existe, mas a elicitação de `computer.*` mostra o digest do screenshot, não a imagem. Navegador e computer-use na CLI exigem broker de egress, media
store e canal de aprovação humana. Mutantes sem detecção (M18b, N5, `dap_survivor`; o M09 foi morto, segundo o recibo da W5-07), CSP sem leitura de violação, `memory.write` sem aprovação do runtime
(decisão do owner de 2026-10-21), `packages/agent-environment/index.js` fora de `.c8-kernel.json`.

## 3. Transversais

- **Aceites do Commander.** Dos 27 resíduos do `w5/STATUS.md`, 20 estão "aceito" (itens 1–7, 10–19, 23–25); 8 têm o owner como dono (itens 4, 5, 11, 15, 16, 19, 23 e 24: PEM multilinha, `JSON.parse`, CSP, falhas de infra
  do CI, 3 execuções do mesmo teste, elicitação sem imagem, `memory.write`, arquivo fora do c8). O registro não diz que o owner os aceitou. (Correção de 2026-10-27: o texto anterior dizia 17.)
- **Capacidade do pacote (G3), verificado.** `tools` 393 e `packages` 137 arquivos, iguais aos tetos de `test-package-surface.js`; os orçamentos por área
  somam o teto de 1556. Código novo em `tools/` ou `packages/` exige decisão do owner.
- **Estado operacional.** `requirements.json` marca `operational: not_authorized` em todas as famílias, embora o piloto tenha sido ativado em 2026-10-22. Revalidado em 2026-10-30 ([operational-revalidation-2026-10-30](../operational-revalidation-2026-10-30.md)): nenhuma família tem as três provas; todas seguem `not_authorized`, e o enum aceita `pilot_enterprise_hseos_only` com `operational_evidence` obrigatório.
- **Sunset do legado.** Sem data; a condição do ADR-0048 (Codex em `2026-07-28` sem flag) não foi atendida.
- **ECP.** `ecp-registry.snapshot.json` e `test/fixtures/ecp-registry/*` ainda citam `Hideaki-Solutions-Core`.
- **Integrações.** O plano pede quatro integrações comprovadas; há três.
- **Plataformas.** Só Linux; macOS e Windows são da W7.

## 4. Pendências da revalidação de 2026-10: situação em 2026-10-23

Lista original em [revalidation-2026-10/STATUS.md](../revalidation-2026-10/STATUS.md). Só marco "resolvido" o que tem evidência citada.

| Pendência original                                                              | Situação                                                                                                                                                             | Evidência                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transporte HTTP legado sem limite de corpo                                      | Resolvido (verificado)                                                                                                                                               | `tools/lib/mcp-transport.js:28,61-86`: teto de 1 MiB, corpo recusado com 413 sem ser interpretado                                                                                                                                   |
| Divergência `-32600` do adapter `mcp-2026` para notificação de método conhecido | Resolvido (verificado)                                                                                                                                               | `tools/lib/mcp-2026-adapter.js:1102`: comentário e comportamento alinhados ao `mcp-transport`                                                                                                                                       |
| `limit` e `stale_minutes` em string rejeitados (mudança a comunicar)            | Resolvido (verificado)                                                                                                                                               | nota de migração em `docs/v4-migration.md:106`                                                                                                                                                                                      |
| `pids_max=64` insuficiente / faixa duplicada                                    | Resolvido (verificado)                                                                                                                                               | `engineering-task-contract.js:8,134` deriva a faixa de `LIMIT_FLOOR`/`LIMIT_CEILING` (`84746de5`); a varredura cobre a árvore toda e o teste está ligado ao CI desde a T1 (o resíduo 12 do w5/STATUS, "5 arquivos", ficou superado) |
| `loop-guard.sh` grava em `node_modules`                                         | Resolvido segundo o `w5/STATUS.md` (cl1, item 9); não reverificado no código                                                                                         | w5/STATUS, "Fora da W5, só registradas"                                                                                                                                                                                             |
| Critérios de aceite fracos aprovam entrega reprovada                            | Tratado para novas admissões (W5-10b, `ENGINEERING_ACCEPTANCE_UNCOVERED`); rota de API paga da A5b não refeita                                                       | w5/STATUS, W5-10b; PLAN de fechamento, W2                                                                                                                                                                                           |
| Sinais `init`, `rate_limit`, `pids_peak` fora do recibo                         | Parcial: a W5-10 expôs sinais do executor; `init` e `rate_limit` seguem declarados desconhecidos e `pids_peak` foi reconfirmado como não observável no despacho real | w5/STATUS, W5-10; consumer-validation, A7                                                                                                                                                                                           |
| Adapters API, ACP e local sem retenção da saída                                 | Aberto                                                                                                                                                               | decisão de retenção de dados                                                                                                                                                                                                        |
| `$ref` não resolvível só falha na chamada                                       | Não verificado                                                                                                                                                       | —                                                                                                                                                                                                                                   |
| Riscos residuais do `swarm` (TOCTOU, hardlink, `cwd`)                           | Não verificado                                                                                                                                                       | —                                                                                                                                                                                                                                   |
| Digest de conta do `claude/account` sem sal                                     | Aberto                                                                                                                                                               | persistido; mudar exige versionar o formato                                                                                                                                                                                         |
| Hook de mensagem de commit bloqueia nomes de fornecedor de IA                   | Aberto (gotcha operacional)                                                                                                                                          | —                                                                                                                                                                                                                                   |
| `requirements.json` sem atualização                                             | Parcial: o fechamento ligou evidência a F04, F06, F08, F12, F13, F17, F18 e F21–F23 ou justificou `not_verified`                                                     | w5/STATUS, fechamento/W6-E2                                                                                                                                                                                                         |

## 5. Decisões que dependem do owner

1. Decidido em 2026-10-30: os ADRs 0042, 0043, 0044 e 0045 foram aceitos pelo owner; a Decision 0006 do ECP está Accepted (§1).
2. O que certifica um binding (F08, F17, F18) e quando a quarta família roda, com credencial e teto. **Decidido em 2026-10-30:** o critério de certificação será proposto (W6/E8).
3. `tools/call` e MRTR do Codex (login e gasto); liberação da reserva de US$ 9. **Decidido em 2026-10-30:** serão exercitados com cliente real, com o login do owner e teto de US$ 2 (W7); a reserva de US$ 9 segue retida até a reconciliação nessa campanha.
4. Navegador e computer-use na CLI. **Decidido em 2026-10-30:** adiados.
5. Data do sunset do legado. **Decidido em 2026-10-30:** continua sem data (ADR-0048).
6. Teto do inventário (G3) ou onde fica o código da W6. **Decidido em 2026-10-30:** o teto sobe pelo número medido no fechamento da onda que precisar de arquivo novo em `tools/` ou `packages/`. O ADR-0049 continua Proposed até o owner responder as 14 questões.
7. O significado de `operational` por família depois da ativação do piloto. **Decidido em 2026-10-30:** revalidar por família e marcar `pilot_enterprise_hseos_only` só com prova; resultado na §3.
8. Se os aceites do Commander atribuídos ao owner valem como decisão dele. **Decidido em 2026-10-30:** itens 5, 11, 16 e 19 aceitos, 23 confirmado; 4, 15 e 24 com destino próprio; registro em [w5/STATUS](../w5/STATUS.md), "Aceites do owner (2026-10-30)".
9. Retenção de evidência nos adapters; formato versionado do digest de conta; lista de gates do ensaio de ativação (o `g9-zero-legacy-window` foi substituído por `g9-adr0048-activation-criterion` em W5/E6, PR #262, `75b472e0`: 4 condições verificáveis, e 9 que ficam sempre pendentes) e conjunto do gate de
   cobertura (`.c8-kernel.json`).
10. macOS e Windows (W7) e tag nova do ECP: dependem de terceiros ou de infraestrutura.

O que pode avançar sem essas decisões está em [PLAN.md](PLAN.md).

## 6. Execução da P2 e da P3 (2026-10-24): resíduos e achados

Executadas sem decisão do owner (tasks T-1, T-3, T-5, T-6 e H-2, H-4, H-7, H-9). Cada task teve revisão cética isolada em duas passagens. Nada abaixo muda o estado de uma onda; é o que ficou fora do escopo.

| Item                              | Situação                                                                                                                                                                                                                                                     | Dono      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Dívida 18 (`max_tokens` baixo)    | Reduzida, não fechada. O piso é limite inferior; faixa opaca residual de 752–753 tokens (schema 1) e 2359 (schema 2). Extensões, ambiente e memória não medidos                                                                                              | Commander |
| Receipt da ativação               | Corrigido em 2026-10-27: a divergência de nomes não existia (os nomes casam, `operational-state-db.js:528-529` e `:727`). O risco real era receipt ausente ignorado em silêncio; corrigido pela T6a em `3970dd7f` (feature/audit-fix-w2, PR a abrir; ver §8) | —         |
| Envelope de erro do adaptador MCP | `data.issues` do Ajv no ramo do `outputSchema` pode levar nomes de chave da saída da tool ao cliente. Corrigir muda o formato do envelope                                                                                                                    | Owner     |
| Erros com `code` e sem `outcome`  | Passam a responder `Internal error` no adaptador (por exemplo `TASK_NOT_FOUND`); `engineering-task-extensions.js` lança `Error` com `outcome` sem `GovernedRefusalError`. Confirmar que nenhum cliente depende da mensagem                                   | Commander |
| Cobertura (`.c8-kernel.json`)     | `packages/governed-execution/canonical-envelope.js` e `packages/agent-environment/index.js` fora do gate                                                                                                                                                     | Owner     |
| `browser.js:19`                   | `pids_max: 256` literal igual ao teto da faixa; se o teto baixar, falha só em runtime                                                                                                                                                                        | Commander |
| `test-mcp-hseos-swarm-scope.js`   | Correção de 2026-10-27: o "sem contagem no Node 22" era um falso verde do `finally`, independente de versão; corrigido pela T6b em `df3ed51e` (W3, em revisão; ver §8)                                                                                       | Commander |
| Redação de PEM sem marcador (H-9) | Limites conhecidos: Ed25519 PKCS8 de uma linha; última linha com menos de 16 caracteres; sem fixture de chave real; `containsCredential` de três módulos não usa a heurística                                                                                | Commander |
| H-4                               | Mutante sobrevivente em `engineering-control.js:363` (`admission &&` do recheck do binding sem teste de `admission:false`); precedência de erros do `create` mais larga que a documentada                                                                    | Commander |
| H-7                               | `detail.code` próprio nas regras cruzadas secundárias muda valores já publicados (alternativa: campo `detail.rule`); teto de 64 leituras por argumento recusa por `ENGINEERING_COMMAND_ARG_INVALID`                                                          | Owner     |
| T-5                               | Mutantes equivalentes sem lugar durável além do corpo do commit: P04, M21, `toLowerCase` de `browser-contract.js:71`, `assertOpenedInside`, `dap_survivor`                                                                                                   | Commander |

Correções de fato de 2026-10-27 (auditoria): K9 (`test-mcp-environment-host`) e o teste do `apply` pela CLI já estavam fechados na P2 (T-1 e T-3). A varredura de `pids_max` cobre a árvore toda; o teste estava fora do CI e foi ligado pela T1.

## 7. Execução da P4 (2026-10-27): resíduos e achados

Executada sem decisão do owner (M-8 e M-10, PR #253). Cada task teve revisão cética isolada em duas passagens e reconferência; o M-8 foi reprovado uma vez por uma corrida real no takeover e corrigido. O H-7 (P3) fechou na #252. Nada abaixo muda o estado de uma onda.

| Item                                  | Situação                                                                                                                                                                                                     | Dono      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Mutex `<lock>.takeover` preso         | Um crash entre criar e remover o mutex deixa o arquivo; ele é descartado depois de 10 s, então o efeito é só atraso do takeover                                                                              | Commander |
| Temp órfão do lock                    | Um crash entre escrever o temp e o `link()` deixa o arquivo temporário no diretório do install                                                                                                               | Commander |
| Token não revalidado antes do SIGKILL | O supervisor do M-10 lê o ambiente do processo e sinaliza depois, sem reler; um pid reciclado nesse intervalo seria alvo. `protectedPids()` limita o dano (nunca pid ≤ 1, o próprio processo nem ancestrais) | Commander |
| Janela de lock vazio sem teste        | Entre o `link()` e a leitura, o holder pode aparecer com arquivo vazio; o código trata, mas nenhum teste cobre a janela                                                                                      | Commander |
| Limites do supervisor (M-10)          | Só Linux (`/proc`); processo que zera o ambiente escapa da marca; processos de outros usuários não são inspecionáveis. A allowlist (`suite-orphan-allowlist.json`) é vazia e exige motivo                    | Owner     |
| Incidente de processo                 | Uma versão intermediária do M-10 comparava mal o token e o reaper derrubou sessões na máquina de desenvolvimento. Corrigido antes do commit com comparação exata e teste de regressão com `/proc` falso      | —         |
| G3                                    | Sem folga após a P4: `tools` 393 e `packages` 137. O lock ficou dentro de `installer.js`; o supervisor em `.github/scripts` (fora do pacote)                                                                 | Owner     |
| Primeiro run noturno com o M-10       | Ainda não conferido: se uma suíte real vazar processo, o item falha e a causa é corrigida no teste, sem afrouxar o supervisor                                                                                | Commander |

## 8. Auditoria de conformidade 2026-10-27 e correções

Relatório: [CONFORMIDADE-W0-W5.md](../audit-2026-10-27/CONFORMIDADE-W0-W5.md), sobre `f96c6e9c`. Reauditoria de 2026-10-30: [REAUDITORIA-2026-10-30.md](../audit-2026-10-27/REAUDITORIA-2026-10-30.md). Correção pela run `audit-fixes` (dev-squad). Commits por task: T1 `5ca358ad`, T3 `cc7a11e5`, T4 `16ddc595` (PR #255, W1); T2 `a6788e01`, T5 `b7cd77a5`, T6a `3970dd7f` (W2, PR a abrir); T6b `df3ed51e` (W3, em revisão); T7 (esta task, docs). Nenhum item desta tabela original estava mergeado em 2026-10-27: "corrigido" quer dizer commit na branch indicada. O estado atual está em "Estado em 2026-10-30". O número das PRs da W2 e da W3 entra no fechamento da run.

| Achado | Tema                              | Task | Estado                                                                                                                                                                                 |
| ------ | --------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01   | CI não roda todos os testes       | T1   | Corrigido em `5ca358ad` (PR #255, aberta, aguardando merge do owner)                                                                                                                   |
| A-02   | Envelope de erro do adaptador MCP | T3   | Corrigido em `cc7a11e5` (PR #255, aberta, aguardando merge do owner); formato decidido pelo owner (abaixo)                                                                             |
| A-03   | Erro interno com segredo          | T3   | Corrigido em `cc7a11e5` (PR #255, aberta, aguardando merge do owner); mensagens autorais do legado em outras tools não varridas                                                        |
| A-04   | Gates de mutação W4 e W5          | T2   | Corrigido em `a6788e01` (feature/audit-fix-w2, PR a abrir)                                                                                                                             |
| A-05   | Redação de chave (H-9)            | T4   | Corrigido em `16ddc595` (PR #255, aberta, aguardando merge do owner); limites residuais abaixo                                                                                         |
| A-06   | H-7 decidido sem o owner          | T7   | Decidido pelo owner: fica o `detail.code` (abaixo)                                                                                                                                     |
| A-07   | Semântica de `operational`        | —    | Decidido em 2026-10-30; revalidação feita, nenhuma família promovida                                                                                                                   |
| A-08   | Falso verde do `swarm-scope`      | T6b  | Corrigido em `df3ed51e` (W3, em revisão)                                                                                                                                               |
| A-09   | Conjunto do c8                    | —    | Com o owner, fora desta run                                                                                                                                                            |
| A-10   | Riscos do swarm (TOCTOU)          | T6b  | Corrigido em `df3ed51e` (W3, em revisão), só Linux; o mkdir usa o diretório de runs como base quando ele existe (`runDirBase`), com revalidação por componente e teste                 |
| A-11   | Mutante do H-4                    | T5   | Corrigido em `b7cd77a5` (feature/audit-fix-w2, PR a abrir)                                                                                                                             |
| A-12   | Rollback sem receipt              | T6a  | Corrigido em `3970dd7f` (feature/audit-fix-w2, PR a abrir); comportamento decidido pelo owner (abaixo)                                                                                 |
| A-13   | PLAN e MAPA desatualizados        | T7   | Corrigido nesta task (sem merge)                                                                                                                                                       |
| A-14   | M-10 sem prova em Node 22         | —    | Não confirmado: o primeiro noturno com o M-10 ainda não foi conferido (§7)                                                                                                             |
| A-15   | Corrida do lock de install        | T5   | Corrigido em parte, em `b7cd77a5` (feature/audit-fix-w2, PR a abrir); janela residual abaixo                                                                                           |
| A-16   | `env: {}` no supervisor           | —    | Com o owner, fora desta run                                                                                                                                                            |
| A-17   | Corpos de PR antigos              | —    | Com o owner, fora desta run                                                                                                                                                            |
| A-18   | Distribuição global               | —    | Com o owner, fora desta run                                                                                                                                                            |
| A-19   | Contagem de aceites (MAPA §3)     | T7   | Corrigido nesta task (§3; sem merge)                                                                                                                                                   |
| A-20   | Rastreabilidade W3 e W4           | T7   | Tratado: STATUS das runs antigas atualizados nesta task (commit desta task, ainda sem merge). Resíduo: rastro legível por máquina de W3 e W4 e handoffs/logs ausentes nas runs antigas |

### Estado em 2026-10-30

Atualização do estado dos achados após as PRs #258, #259 e #260 e as decisões do owner da mesma data. "Corrigido em <PR>" só vale para o que está mergeado.

| Achado | Estado                                                             |
| ------ | ------------------------------------------------------------------ |
| A-16   | corrigido pela #259                                                |
| A-09   | parcial pela #259; o restante vai para W6/E7                       |
| A-07   | revalidado pela #260; F19/F20 dependem da leitura do banco (W6/E9) |
| A-17   | corpos das PRs #186–#195 e #197 editados em 2026-10-30             |
| A-05   | W5/E4                                                              |
| A-15   | W4/E3                                                              |
| A-18   | reinstalação W7                                                    |
| N-1    | W4/E3                                                              |
| N-3    | aviso do c8, W4/E2                                                 |

### Decisões do owner (2026-10-27)

- **A-02.** `data.issues` do adaptador MCP 2026: na entrada só `keyword` e `instancePath`; na saída só `issue_count`.
- **A-06 (H-7).** Fica o `detail.code` próprio nas regras cruzadas secundárias, já entregue na #252. É aceite do owner.
- **A-12.** O rollback da ativação recusa receipt ausente ou sem `original_sha256_before`, salvo `--allow-missing-receipt`. Receipt corrompido ou contraditório nunca é contornado. Nota de migração em [v4-migration.md](../../v4-migration.md).

### Resíduos novos declarados

- Takeover do lock de install com janela entre o `rename` do mutex velho e o `link` de devolução (T5).
- Rollback com colisão de nome no mesmo segundo (resolução de 1 s); recusa com `BACKUP_EXISTS`, fail-closed (T6a).
- Redação de chave: corpo de duas linhas e PKCS8 cifrado não cobertos (T4).
- `test-campaign-evidence.js` pendura fora do cgroup; deveria falhar rápido.
- Mensagens autorais do legado sem `code` em outras tools não foram varridas.

### Segue com o owner, fora desta run

Decididos pelo owner em 2026-10-30 (run `20261030-1810-owner-decisions`): A-07 revalidado família por família, nenhuma promovida (F19/F20 dependem de prova de execução no banco real); A-09 em parte corrigido pela #259 (ledger e banco da ativação no gate), o restante em correção; A-16 corrigido pela #259; A-17 (editar os corpos das PRs) e A-18 (reinstalar a distribuição global) em execução. Os ADRs 0042–0045 foram aceitos pelo owner em 2026-10-30 (#258).

### Estado em 2026-10-31 (ondas W4–W7)

Fonte: STATUS da run `20261030-1810-owner-decisions` (`.hseos/runs/dev-squad/20261030-1810-owner-decisions/STATUS.md`, versionado no commit dos registros). A numeração A1–A19 é a do PLAN-2 da mesma run; o "A-17" do STATUS (corpos de PR) é o A13 do PLAN-2. Os SHAs de task abaixo são dos commits das branches de task, anteriores ao squash.

| Onda | PR   | Merge      | Tag                        | Tasks                                                                                                                 |
| ---- | ---- | ---------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| W4   | #261 | `e6239c2a` | `hseos-owner-decisions-w4` | E1, E2, E3                                                                                                            |
| W5   | #262 | `75b472e0` | `hseos-owner-decisions-w5` | E4, E5, E6; E10 e E11 nasceram da falha do CI da própria #262                                                         |
| W6   | #263 | `55d3d1aa` | `hseos-owner-decisions-w6` | E7, E8, E9                                                                                                            |
| W7   | —    | —          | —                          | A12 feita (release `817da40b`); A15 parcial; A18 feita até o limite do protocolo do cliente; sem PR, só ações no host |
| W8   | #265 | `817da40b` | `hseos-owner-decisions-w8` | E12 (watchdog de liveness no banco ativado)                                                                           |

CI das PRs #262, #263 e #265: 24/24 no merge; CI completo na master `55d3d1aa` (run 41172438629) verde. As ondas W1–W3 (#258–#260) estão no estado de 2026-10-30, acima.

#### Resultado das decisões A1–A19

| #   | Decisão                          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Aceitar os itens 5, 11 e 16      | Feito no E1 (`9b1b30de`), bloco no `w5/STATUS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A2  | Item 15: retry no CI             | Feito no E2 (`26f4bcea`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A3  | Item 4 e A-05: redação de chave  | Feito no E4 (`9e789577`, rodada 2): prefixos, JSON, teto e descarte da linha parcial da cauda; 0 vazamentos em 12 mil combinações                                                                                                                                                                                                                                                                                                                                                                                                      |
| A4  | Item 19: aceite e recusa         | Aceite registrado no E1; recusa `ENV_COMPUTER_IMAGE_APPROVAL_UNSUPPORTED` em `computer.*` no E5 (`11e99912`). Ligar o override à configuração de produção está pendente (decisão (d) abaixo)                                                                                                                                                                                                                                                                                                                                           |
| A5  | Item 23: confirmar e registrar   | Feito no E1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A6  | F19 e F20 pelo `project.db`      | E9 (`c4d48597`), por cópia instantânea do banco: F19 e F20 seguem `not_authorized`. Há 10428 eventos pós-ativação, todos de `scheduler_sweep_orphans`; sem `tools/call` de cliente nem aprovações                                                                                                                                                                                                                                                                                                                                      |
| A7  | ADR-0049 segue Proposed          | Registrado no E1; as 14 questões seguem com o owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A8  | N-1                              | Feito no E3 (`f3915ab2`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A9  | A-15: lock em `init`/`uninstall` | Feito no E3 (`f3915ab2`); ver o achado E11 sobre o takeover do lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A10 | A-09: resto do c8                | Feito no E7 (`a65eade5`): 6 arquivos no gate, todos ≥ 90/80; `test:kernel-coverage` exit 0; 3 mutações mortas                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A11 | Aviso de segmento não executado  | Feito no E2 (`26f4bcea`); gate e limiares intactos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A12 | A-18: reinstalar a distribuição  | Feito em 2026-10-31 no SHA `817da40b` (master após a W8): CLI global pelo tarball (sha256 `74709ecf…`), hooks do Claude e do Codex, MCPs do Codex e unidade do watchdog repontados (20 referências), pin do `AGENTS.md` global corrigido, 4 serviços `hseos-*` parados por `systemctl` e subidos um a um com health check. Recibo em `~/.local/state/hseos/distributions/817da40b…/verification.json`. Rollback: restauração do host testada em diretório descartável; a reinstalação do CLI anterior não foi executada (NOT VERIFIED) |
| A13 | A-17: corpos das PRs             | Feito em 2026-10-30, pelo Commander, com `gh pr edit` nas PRs #186–#195 e #197; sem mudança de commits                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A14 | Sunset sem data                  | Registrado no E1 (ADR-0048)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A15 | W9: higiene de worktrees         | Parcial: removido um worktree; o restante fica (ver pendentes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A16 | G3 pelo número medido            | Registrado no E1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A17 | Critério de bindings             | Feito no E8 (`f847be80`): ADR-0050 Proposed, 12 questões para o aceite                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A18 | Codex real, teto de US$ 2        | Feito até o limite do protocolo (`logs/A18-CODEX.md` da run). `tools/call` real provado: Codex 0.166.0 logado, `agent_runs_list` com `ok: true` no banco ativado, 2 de 5 chamadas, pela cota de assinatura. A aprovação MRTR **não é exercitável**: o Codex negocia a compatibilidade `2024-11-05`, que não expõe as ferramentas com aprovação                                                                                                                                                                                         |
| A19 | g9 conforme o ADR-0048           | Feito no E6 (`c4e0737b`): gate `g9-adr0048-activation-criterion`, 4 condições verificáveis e 9 sempre pendentes                                                                                                                                                                                                                                                                                                                                                                                                                        |

#### Achado E11: corrida real no takeover do lock de install

Na #262, o CI falhou no shard 5/6 em `test-install-lock.js:444`, teste de corrida da W4 (E3). A causa estava no teste (`release()` síncrono); o E10 (`e8f3ed9d`) o tornou determinístico. Na repetição do E10, o teste de takeover (`test-install-lock.js:152`) teve 1 violação em 30, com dois processos na seção crítica. O defeito era real, estava na master desde a W4/T5: com o lock ausente na releitura sob o mutex, o taker removia o lock vivo criado por outro taker. O E11 corrige (`20416fe7`, rodada 2): o `rename` só acontece com o pid morto lido sob o mutex, com stat estável. Integrado em `de416cc3`; `test:install` exit 0. Residual aceito como nota pela reconferência: uma remoção extra no caminho ENOENT (mutação a2 sobrevive), caminho raro.

#### Pendentes (STATUS da run)

- **Watchdog `hseos-liveness-watch`.** Corrigido na W8 (E12, #265). Depois da reinstalação, o ciclo sai com 0 e o timer está ativo.
- **A18: MRTR e sunset.** O Codex 0.166.0 não fala `2026-07-28`, e pelo ADR-0048 isso impede o sunset do legado enquanto ele for cliente registrado. O critério de consumidor real para MRTR segue aberto. Dois achados de cliente: o `codex exec` bloqueia `tools/call` de MCP com a política padrão (`never`) sem override por ferramenta, e o modelo relatou um resultado inventado para uma chamada que falhou.
- **A15.** Removido: `w0-8-governance-clock` (2 commits equivalentes por patch na master, limpo; head `d2a01588`). Mantidos, porque não está provado que o conteúdo está na master: `harness-*` (5; sem PR e com arquivos que diferem da master), `dg27-scope` (PR #220 aberta), `aew-graph-source-2b4d6f3` (usado por sessões do vortex-events) e os worktrees com mudanças não commitadas (hseos-evolution-w0..w3, v4-consolidation, plan-w4-w8, w5-live-t1, legacy-code-review-skill, harness-private-executor).
- **Questões dos ADRs.** 14 questões do ADR-0049 (Code OSS, Proposed). As 12 do ADR-0050 foram respondidas em 2026-10-31 (ver abaixo).
- **Outros.** F19 e F20 seguem `not_authorized`; a classificação de `test:agent-provider-conformance` na W3 como instabilidade por carga é provisória; o guard de 200 ms do `test:capability-intake-guard` falhou uma vez sob carga na suíte da W5 (870 ms) e passou isolado.

#### Decisões do owner (2026-10-31)

Plano: `PLAN-3.md` da run `20261030-1810-owner-decisions` (onda W9). As decisões (a)-(e) eram as abertas da seção "Pendentes" acima.

- **(a) Janela supervisionada:** executada na W9 (F1). JSON do operador com `operator`, `stopped_consumers[]`, `original_sha256_before` e `recorded_at` anterior a `started_at`, ao lado do recibo; o `apply` o valida.
- **(b) Referência da janela no recibo:** executada na W9 (F1). O `apply` grava `window: {path, sha256}` no recibo, com versão nova do formato; recibos antigos continuam legíveis e o gate cruza recibo e janela.
- **(c) Flags no `agent-provider-validate`:** executada na W9 (F2). `--activation-db`, `--activation-receipt`, `--activation-window` e `--activation-adr`.
- **(d) Override `allow_digest_only_approval` em produção:** mantido desligado. Só registro; o computer-use por MCP segue desligado em produção.
- **(e) F19 com escopo reduzido:** não reduzir. A F19 segue `not_authorized`. Só registro.
- **MRTR:** a sondagem de se o Claude Code ou outro cliente instalado negocia `2026-07-28` é feita pelo Commander, sem gasto relevante. Não há resultado registrado aqui.
- **ADR-0050 aceito (2026-10-31)**, com as 12 respostas: (1) validade do recibo de L2 de 90 dias, além dos gatilhos por mudança; (2) teto padrão da quarta família de 4 requisições, US$ 1,00 e até 45 min, sem aumento sem decisão nova; (3) API Gemini direta com chave própria em `google/gemini-hseos`, chave da NB Eventos proibida; (4) `deterministic` usa `verified_w<N>_scope_only` da onda da prova de L1; (5) `operational` de L3 usa `pilot_enterprise_hseos_only` com `operational_evidence`; (6) teto de US$ 2 de `tools/call` e MRTR por campanha, sem herdar saldo; (7) L2 da F17 só para os bindings oficiais nomeados no PLAN; (8) quarta família liberada para planejamento, execução com autorização própria por campanha; (9) novo valor `verified_api_campaign_scope_only` em `real_consumers`; (10) rota de assinatura avaliada antes de pedir chave de API; (11) L2 padrão = `tools/call` + MRTR, com L2 parcial se o cliente não fala `2026-07-28`; (12) L2 da F17 é geração real com recuperação, sem `tools/call`.
- **Vocabulário:** `verified_api_campaign_scope_only` é admitido (F3) com guard de enum fechado e `real_consumers_evidence` resolvível. Nenhuma família mudou de status.
- **Reinstalação da distribuição global:** pelo Commander, depois do merge da W9.

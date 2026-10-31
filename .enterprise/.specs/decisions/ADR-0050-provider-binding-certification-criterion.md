# ADR-0050 — Critério de certificação de bindings de provider e aceite da quarta família

**Status:** Accepted — 2026-10-31
**Date:** 2026-10-31
**Authors:** Owner (decisão solicitada em 2026-10-30); redação por executor do dev-squad owner-decisions
**Affects Standards:** `docs/evolution/PLAN.md` (invariantes de bindings; linha da W3); `docs/evolution/requirements.json` (F08-R1, F17-R1, F18-R1; vocabulário de `status`); `docs/evolution/runbooks/fourth-family.md`; ADR-0046 (bindings de plataforma e modos); ADR-0043; `docs/evolution/w3/BINDINGS.md`
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

Três famílias do plano de evolução estão `not_verified_for_evolution` em `deterministic` e `not_verified` em `real_consumers`:

- F08, segredos/egress: o gap é "bindings oficiais por conta e cotas precisam de ensaios reais";
- F17, model providers: o gap é "declarações versionadas e certificação de todos os bindings pendentes";
- F18, runtime providers externos: o gap é "Antigravity e classificação oficial por binding pendentes", e o critério exige quatro ecossistemas.

A causa comum é que nunca houve um critério escrito do que certifica um binding. As campanhas reais da W3 (ACP, Claude, Antigravity local) provaram jornadas individuais, mas `docs/evolution/w3/BINDINGS.md` declara que testes de protocolo "não comprovam login, quota, cobrança ou recuperação real", e `docs/evolution/w3/STATUS.md` não declara a certificação multifamília concluída. Sem critério, cada leitura do mesmo recibo chega a uma conclusão diferente, e a pergunta "este binding está certificado?" não tem resposta verificável.

Fatos que o critério precisa respeitar, vindos de `docs/evolution/PLAN.md`:

- bindings declaram versões, transporte, autenticação, cobrança, cotas e evidência de conformidade;
- assinatura primeiro quando oficialmente suportada; a credencial efetivamente utilizada deve ser comprovada;
- cota ignorada é desconhecida, nunca ilimitada;
- identidades individuais não formam pool compartilhado;
- segredos não entram em prompt, workspace, log ou artefato;
- `configuration: valid` e `real_conformance: not_certified` são estados simultâneos e intencionais.

A quarta família (API Gemini ou compatível) está adiada por decisão do owner e não foi exercitada (`docs/evolution/runbooks/fourth-family.md`). O `tools/call` e a aprovação MRTR com cliente real do app-server de código estão `NOT_EXERCISED` e dependem de login e gasto; o owner registrou, em 2026-10-30, o teto de US$ 2 para essa campanha.

Este ADR foi aceito pelo owner em 2026-10-31 (ver "Respostas do aceite"). Ele define o critério e não executa nada: nenhuma campanha paga é autorizada por ele, e nenhum status do `requirements.json` muda por ele.

---

## Decision

We will adotar o critério abaixo para certificar bindings de provider e para admitir a quarta família.

### 1. Níveis de certificação de um binding

Os níveis são cumulativos: um binding só está em N quando cumpre N e todos os anteriores. A certificação é por binding (conta, API ou local, cada um é um binding), nunca por família de produto.

| Nível | Nome            | Evidência mínima                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Verificável por máquina                                                                                                                                            |
| ----- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L0    | Declarado       | Arquivo de binding com versões (cliente, SDK, modelo, endpoint), transporte, autenticação (com o modo declarado: assinatura oficial do cliente ou API, e se a assinatura é oficialmente suportada para o uso), cobrança, cotas (ou exceção explícita, limitada e auditada), evidência de conformidade prevista (qual recibo ou teste prova o quê) e `secret_refs` por referência, nunca valor; cota ausente declarada como desconhecida                                                                                                                                                                         | Sim: validação do esquema do binding e do manifesto de controle; teste que recusa cota ausente tratada como ilimitada e modo de autenticação não declarado         |
| L1    | Determinístico  | L0 mais testes de contrato do adapter em fixture: credencial injetada pelo supervisor e fora do executor, cabeçalho de sobrescrita recusado, eco de credencial bloqueado, tarifa expirada recusada, login expirado e credencial de ambiente sobreposta tratados, mudança silenciosa de cobrança bloqueada, expiração/esgotamento preservando estado                                                                                                                                                                                                                                                             | Sim: testes verdes com contagem e exit registrados em recibo; cada teste ligado ao requisito (F08-R1, F17-R1, F18-R1) que cobre                                    |
| L2    | Consumidor real | L1 mais uma campanha com cliente real, instalado e logado (ou credencial real do binding), com recibo contendo: credencial efetivamente usada comprovada pelo adapter (não só configurada), versão do cliente e do modelo observadas, cota observada (ou exceção auditada), custo real e teto, modo de autenticação efetivo igual ao declarado, jornada com `tools/call` e aprovação (MRTR quando o protocolo a exige) quando o binding expõe ferramentas, recuperação na mesma sessão com mudança observável de estado, replay idempotente sem novo efeito, drain com zero processos órfãos e `does_not_prove` | Parcial: o recibo e a varredura de segredos são verificados por máquina; a comparação "usada = declarada" vem do adapter; a leitura do `does_not_prove` é revisada |
| L3    | Operacional     | L2 mais repetição da campanha em janela posterior sem regressão, recertificação em dia (seção 4), orçamento agregado e decisão do owner de ativar o binding para uso fora de campanha                                                                                                                                                                                                                                                                                                                                                                                                                           | Parcial: a decisão do owner é um ato humano registrado; o restante é por recibo                                                                                    |

Evidência exigida em todo recibo de L2 ou L3, sem exceção:

1. **Credencial efetiva:** referência (nunca valor) da credencial usada e prova do adapter de que foi ela; sem pool e sem fallback para outra credencial.
2. **Assinatura primeiro:** o recibo comprova que o modo de autenticação efetivamente usado corresponde ao declarado no L0. Quando a assinatura é oficialmente suportada para o uso, ela é o modo preferido e uma rota por API só é certificada com a justificativa registrada. Token de assinatura nunca é reutilizado como API genérica; o recibo declara que não foi.
3. **Versões:** cliente, SDK, modelo, endpoint e protocolo observados, não os declarados.
4. **Cota:** observada, ou exceção explícita com motivo, limite e auditoria; cota desconhecida nunca é "ilimitada".
5. **Custo:** custo real ≤ teto autorizado da campanha; valores informados pelo SDK não substituem fatura e são rotulados assim.
6. **Jornada:** pelo menos uma jornada com `tools/call` e aprovação humana quando o binding expõe ferramentas (por exemplo, runtime provider com cliente real). Para binding que não expõe ferramentas, o recibo registra que a superfície não existe e a jornada exigida é a de geração com recuperação; para F17 vale a resposta 12 (geração com recuperação, sem `tools/call`).
7. **Segredos:** nenhuma credencial em log, prompt, workspace, recibo ou artefato, comprovada por varredura sobre todos os artefatos da campanha.
8. **Distinção:** chamada real separada de fixture e mock, em campo explícito do recibo.

Estado atual dos bindings existentes, afirmado só com evidência citada (nenhum foi reavaliado por este ADR; a leitura é do critério proposto):

| Binding                             | Nível que a evidência sustenta | Evidência                                                                                             | Lacuna                                                                                                                  |
| ----------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| App-server de código, conta nativa  | L1; L2 não atingido            | `docs/evolution/w3/CLOSEOUT.md` (FR07: ACP/Codex com recuperação real), `docs/evolution/w3/STATUS.md` | `tools/call` e aprovação MRTR com cliente real `NOT_EXERCISED` (PLAN, pendências 1 e 2); o L2 exige a jornada           |
| Cliente Claude Code headless, conta | L1; L2 candidato               | `docs/evolution/w3/CLAUDE-VERIFIED.md`, `CLOSEOUT.md` (recuperação real, mudança 42 para 43)          | `BINDINGS.md`: sem certificação de campanha; jornada com `tools/call` e aprovação: padrão de L2 definido na resposta 11 |
| Agent SDK Claude, API               | L0/L1                          | `docs/evolution/w3/BINDINGS.md`                                                                       | assinatura não presumida; sem campanha própria registrada neste ADR                                                     |
| Compatível/ACP                      | L1; L2 não atingido            | `docs/evolution/w3/ACP-REAL.md`, `BINDINGS.md`                                                        | endpoint e modelo precisam de prova própria; formato compatível não comprova identidade nem cota                        |
| Antigravity local (LiteRT)          | L1; L2 apenas da rota local    | `docs/evolution/w3/ANTIGRAVITY-LOCAL.md`, `CLOSEOUT.md`                                               | rota por API (quarta família) não exercitada; a rota local não conta como ela                                           |

### 2. O que conta para F08, F17 e F18

O `requirements.json` usa três eixos: `deterministic`, `real_consumers` e `operational`. Os valores existentes, mais o admitido pela resposta 9, são:

- `deterministic`: `verified_w1_scope_only`, `verified_w2_scope_only`, `verified_w4_scope_only`, `verified_w5_scope_only`, `not_verified_for_evolution`;
- `real_consumers`: `verified_installed_local_scope_only`, `verified_api_campaign_scope_only` (admitido em 2026-10-31, resposta 9), `not_verified`;
- `operational`: `not_authorized`.

Mapeamento:

| Eixo             | Sai de                       | Vai para                                                                                                                | Condição                                                                                                                             |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `deterministic`  | `not_verified_for_evolution` | o literal `verified_w<N>_scope_only`, com N a onda em que a prova de L1 for feita (resposta 4)                          | todos os bindings oficiais da família em L1, com cada teste ligado ao requisito                                                      |
| `real_consumers` | `not_verified`               | `verified_installed_local_scope_only` (binding local instalado) ou `verified_api_campaign_scope_only` (binding por API) | local: L2 instalado; API: recibo de campanha L2, custo real ≤ teto e credencial comprovada, com `real_consumers_evidence` resolvível |
| `operational`    | `not_authorized`             | `pilot_enterprise_hseos_only`, já existente, com `operational_evidence` (L3, resposta 5)                                | decisão do owner de ativar o binding (L3); sem ela permanece `not_authorized`                                                        |

Por família:

- **F08 (segredos/egress):** passa quando o L1 liga a verificação do requisito a testes nomeados: login expirado, credencial de ambiente sobreposta, mudança silenciosa de cobrança. Os testes do broker já existentes (injeção pelo supervisor, cabeçalho de sobrescrita, eco bloqueado) contam como parte, mas não bastam sozinhos. O eixo `real_consumers` exige a varredura de segredos (item 7) sobre uma campanha real de L2 de qualquer binding.
- **F17 (model providers):** passa em `deterministic` quando todos os bindings de modelo declarados (local e remoto) estão em L1 com versão, transporte, autenticação, cobrança e cotas; "confirmar backend efetivo e precedência de credenciais" é o teste de credencial efetiva. Binding remoto sem prova de cota só chega a L1 com exceção auditada. `real_consumers` exige L2 apenas dos bindings que o PLAN de evolução nomeia como oficiais (resposta 7).
- **F18 (runtime providers):** o critério "quatro ecossistemas executam a jornada ou atuam como clientes explícitos do kernel" conta somente bindings em L2. Três ecossistemas em L2 e a quarta família pendente deixam F18 em `not_verified`; a rota local de um ecossistema não substitui a rota de API dele e não conta como a quarta família.

**Consumidor real de binding por API (resposta 9):** o valor é `verified_api_campaign_scope_only`. Exige recibo de campanha L2, custo real ≤ teto e credencial comprovada, e é registrado com `real_consumers_evidence` apontando para arquivos existentes no checkout (guard em `test/test-kernel-quality-surface.js`). `verified_installed_local_scope_only` continua restrito a binding local instalado. A admissão do valor não muda o status de nenhuma família.

Uma família só muda de status por ato do Commander no fechamento de uma onda, citando os recibos. Este ADR não faz essa edição.

### 3. A quarta família

Pré-requisitos, todos obrigatórios antes de abrir a campanha:

1. **Credencial:** `google/gemini-hseos` no `pass` (resposta 3), com entrada existente (verificada por `pass ls`, sem imprimir valor) e confirmação de que o uso pelo HSEOS é permitido pela conta dona.
2. **Teto:** valor próprio e novo da campanha, em `max_cost_microusd` e `max_requests`, mais validade explícita. Nenhum saldo, reserva ou grant anterior é reaproveitado.
3. **Binding declarado:** em L0, com versões fixadas de cliente, SDK, modelo e endpoint, e rota `api` com reserva finita positiva por requisição.
4. **Runbook:** `docs/evolution/runbooks/fourth-family.md` atualizado para o binding e o teto concretos.
5. **Testes de L1 verdes** antes da campanha, sem afrouxar gate.
6. **Host:** `uptime` e `heavy-run --check` normais, um job pesado por vez.
7. **Assinatura primeiro (resposta 10):** a rota de assinatura é avaliada e registrada antes de pedir chave de API; registro de que a rota de assinatura oficial da família foi avaliada antes de pedir chave de API (existe ou não, e a fonte), e declaração de que nenhum token de assinatura será usado como API genérica. Sem esse registro, a campanha fica BLOCKED.

Orçamento máximo por campanha: o teto padrão da quarta família, fixado no aceite (respostas 2 e 3), é de 4 requisições, US$ 1,00 (1.000.000 µUSD) e janela de até 45 min, na API Gemini direta, com chave própria da Hideaki Serviços no `pass` (`google/gemini-hseos`); a chave da NB Eventos é proibida. Uma autorização pode fixar valor menor, nunca maior sem decisão nova do owner. O teto de US$ 2 de 2026-10-30 para `tools/call` e MRTR com cliente real vale por campanha, sem herdar saldo (resposta 6; registrado em `.hseos/runs/dev-squad/20261030-1810-owner-decisions/STATUS.md`, linha 50). A quarta família fica liberada para planejamento após este aceite e com a chave no `pass`; a execução pede autorização própria por campanha (resposta 8).

Critério de aceite da campanha (PASS exige todos): evidência de L2 completa (seção 1), custo real ≤ teto, zero execução fora do teto, da validade e dos `task_ids` autorizados, revisão cética isolada em duas passagens (cega e confronto) que reporta e não corrige. FAIL: recibo ausente ou adulterado, custo acima do teto, recuperação sem mudança observável, efeito repetido, órfão não drenado. BLOCKED, com causa e nunca convertido em PASS: referência ausente, grant não autorizado ou expirado, cota ou identidade não comprovadas sem exceção, capacidade do host, endpoint compatível sem prova própria.

Quem autoriza (resposta 8: a quarta família está liberada para planejamento, e a execução pede autorização própria): **sempre o owner, por campanha.** Uma autorização cobre uma campanha, um binding, um teto e uma validade. Aceitar este ADR não autoriza campanha alguma; nenhum agente, hook ou ADR anterior (incluindo o aceite de ADR-0044) autoriza a quarta família ou qualquer gasto.

### 4. Recertificação

A certificação de L2 e L3 perde validade, voltando ao nível anterior até nova campanha, quando:

- a versão do **cliente** muda em major ou minor (patch muda só se o changelog afetar autenticação, cobrança, cota ou protocolo);
- o **modelo** (identificador ou versão) muda;
- o **protocolo** muda (versão do protocolo, formato de `tools/call` ou do fluxo de aprovação);
- a **forma de cobrança ou de cota** muda, ou a credencial é trocada;
- o artefato do adapter muda de forma que afete a superfície certificada.

Validade por tempo: o recibo de L2 tem validade máxima. Valor: 90 dias, além dos gatilhos por mudança acima (resposta 1). Recibo mais antigo que a última mudança observada de versão também não vale.

Recertificar exige a campanha reduzida do item afetado, com nova autorização do owner e novo teto. Mudança de backend não reseta orçamento nem repete efeitos.

### 5. O que nunca certifica

Os itens abaixo não contam para nenhum nível acima de L1, em nenhuma família:

1. **Prova por stdio ou HTTP sintético sem cliente logado.** Um servidor ou cliente de teste que fala o protocolo não prova login, cota, cobrança nem recuperação reais.
2. **Consumidor sintético.** Um cliente escrito para o teste não é consumidor real, mesmo que implemente o protocolo corretamente (é a limitação já registrada em F14, F15 e F20).
3. **Inferência a partir de documentação.** Fonte oficial lida, formato compatível ou presença de uma rota no catálogo não comprovam identidade, cota nem compatibilidade de um endpoint.
4. **Valor informado pelo SDK como fatura.**
5. **Campanha reaproveitada de outro binding**, de outra versão de cliente ou de outro modelo.
6. **Fixture ou mock rotulado como chamada real**, ou recibo sem distinção explícita.

---

## Consequences

### Positive

- A pergunta "este binding está certificado?" passa a ter resposta objetiva, com evidência por nível.
- F08, F17 e F18 têm um caminho escrito para sair de `not_verified_for_evolution` sem inventar status.
- O gasto fica sob autorização explícita do owner por campanha, com teto próprio.
- A recertificação por gatilho impede que um recibo antigo cubra uma versão nova.

### Negative / Trade-offs

- F18 só avança com a quarta família em L2, que depende de credencial, teto e decisão de data do owner.
- L2 exige cliente real logado, o que limita a repetição automática em CI.
- A recertificação gera custo recorrente de campanha a cada mudança de cliente ou modelo.

### Risks

- Clientes e modelos mudam de versão com frequência, e a recertificação pode ficar sempre pendente.
- Um recibo de L2 pode ser lido como autorização operacional; o eixo `operational` permanece `not_authorized` para evitar isso.

---

## Mitigations

- Recertificar por gatilho de mudança observada, não por calendário, e registrar a versão observada em cada recibo.
- Manter `operational` em `not_authorized` até decisão separada do owner sobre o valor e o ato de ativar.
- Varredura automática de segredos sobre todos os artefatos de toda campanha, como condição de PASS.
- Limitar cada campanha a um binding, um teto e uma validade, com revisão cética isolada em duas passagens.
- Registrar o que cada recibo não prova (`does_not_prove`) para impedir que L2 de um binding seja lido como L2 de outro.

---

## References

- `docs/evolution/PLAN.md` (invariantes de bindings; linha da W3; pendências 1 e 2)
- `docs/evolution/requirements.json` (F08-R1, F17-R1, F18-R1)
- `docs/evolution/runbooks/fourth-family.md`
- `docs/evolution/w3/BINDINGS.md`, `STATUS.md`, `CLOSEOUT.md`, `CLAUDE-VERIFIED.md`, `ACP-REAL.md`, `ANTIGRAVITY-LOCAL.md`
- `docs/evolution/operational-revalidation-2026-10-30.md`
- `.agents/activation/provider-bindings/*.example.yaml`
- ADR-0043, ADR-0044, ADR-0046
- `.enterprise/policies/adr-policy.md`

---

## Affected Standards

| Standard                                   | Section / Rule                 | Change                                                                                                                                     |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/evolution/requirements.json`         | `status` de F08, F17, F18      | Clarifies: define a condição para mudar e admite `verified_api_campaign_scope_only` em `real_consumers`; sem edição de status por este ADR |
| `docs/evolution/runbooks/fourth-family.md` | §4 a §7                        | Extends: o teto vira decisão por campanha e o PASS referencia L2                                                                           |
| ADR-0046                                   | bindings de plataforma e modos | Related: trata de platform bindings; não é alterado por este ADR                                                                           |

---

## Compliance

- [x] Approved by Engineering Leadership (owner), 2026-10-31, com as 12 respostas abaixo
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [x] Activation date: 2026-10-31 (critério vigente; nenhuma campanha autorizada)
- [ ] Review date: a cada recertificação (seção 4) ou na mudança do `requirements.json`

---

## Alternatives Considered

| Alternative                                        | Why Rejected                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Certificar por família de produto, não por binding | Conta, API e local têm credencial, cobrança e cota diferentes; uma prova não cobre as outras         |
| Aceitar testes de protocolo como L2                | `BINDINGS.md` já registra que não comprovam login, cota, cobrança nem recuperação                    |
| Criar status novos no `requirements.json`          | Só o valor `verified_api_campaign_scope_only` foi admitido (resposta 9); os demais são os existentes |
| Teto fixo único para toda campanha                 | Cada campanha tem custo e risco próprios; o teto é decisão do owner por campanha                     |
| Recertificação só por calendário                   | Não pega mudança de versão no meio da janela                                                         |

---

## Respostas do aceite (owner, 2026-10-31)

1. Validade do recibo de L2: 90 dias, além dos gatilhos por mudança.
2. Teto padrão da quarta família: 4 requisições, US$ 1,00 (1.000.000 µUSD), janela de até 45 min. Uma autorização pode fixar valor menor, mas nunca maior sem decisão nova.
3. Quarta família: API Gemini direta, com chave própria da Hideaki Serviços no `pass` (`google/gemini-hseos`). A chave da NB Eventos fica proibida.
4. Literal de `deterministic`: `verified_w<N>_scope_only`, com N sendo a onda em que a prova de L1 for feita.
5. `operational` de L3: usa o `pilot_enterprise_hseos_only` existente, com `operational_evidence`.
6. O teto de US$ 2 de `tools/call` e MRTR vale por campanha, sem herdar saldo.
7. O L2 da F17 vale só para os bindings que o PLAN de evolução nomeia como oficiais.
8. A quarta família fica liberada para planejamento depois do aceite deste ADR e com a chave no `pass`. A execução pede autorização própria por campanha.
9. Novo valor de `real_consumers`: `verified_api_campaign_scope_only`. Exige recibo de campanha L2, custo real ≤ teto e credencial comprovada.
10. Rota de assinatura: avaliada e registrada antes de pedir chave de API (é a regra 7 dos pré-requisitos).
11. L2 padrão = `tools/call` + MRTR. Se o cliente não fala `2026-07-28`, o binding fica em L2 parcial, com `tools/call` provado e MRTR bloqueado por protocolo, e não avança além disso.
12. L2 da F17: geração real com recuperação de contexto, sem `tools/call`.

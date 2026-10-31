# ADR-0050 — Critério de certificação de bindings de provider e aceite da quarta família

**Status:** Proposed
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

Este ADR é Proposed. Ele define o critério e não executa nada: nenhuma campanha paga é autorizada por ele, e nenhum status do `requirements.json` muda por ele.

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
6. **Jornada:** pelo menos uma jornada com `tools/call` e aprovação humana quando o binding expõe ferramentas (por exemplo, runtime provider com cliente real). Para binding que não expõe ferramentas, o recibo registra que a superfície não existe e a jornada exigida é a de geração com recuperação; se isso vale para F17 é a questão 12.
7. **Segredos:** nenhuma credencial em log, prompt, workspace, recibo ou artefato, comprovada por varredura sobre todos os artefatos da campanha.
8. **Distinção:** chamada real separada de fixture e mock, em campo explícito do recibo.

Estado atual dos bindings existentes, afirmado só com evidência citada (nenhum foi reavaliado por este ADR; a leitura é do critério proposto):

| Binding                             | Nível que a evidência sustenta | Evidência                                                                                             | Lacuna                                                                                                        |
| ----------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| App-server de código, conta nativa  | L1; L2 não atingido            | `docs/evolution/w3/CLOSEOUT.md` (FR07: ACP/Codex com recuperação real), `docs/evolution/w3/STATUS.md` | `tools/call` e aprovação MRTR com cliente real `NOT_EXERCISED` (PLAN, pendências 1 e 2); o L2 exige a jornada |
| Cliente Claude Code headless, conta | L1; L2 candidato               | `docs/evolution/w3/CLAUDE-VERIFIED.md`, `CLOSEOUT.md` (recuperação real, mudança 42 para 43)          | `BINDINGS.md`: sem certificação de campanha; jornada com `tools/call` e aprovação a confirmar no aceite       |
| Agent SDK Claude, API               | L0/L1                          | `docs/evolution/w3/BINDINGS.md`                                                                       | assinatura não presumida; sem campanha própria registrada neste ADR                                           |
| Compatível/ACP                      | L1; L2 não atingido            | `docs/evolution/w3/ACP-REAL.md`, `BINDINGS.md`                                                        | endpoint e modelo precisam de prova própria; formato compatível não comprova identidade nem cota              |
| Antigravity local (LiteRT)          | L1; L2 apenas da rota local    | `docs/evolution/w3/ANTIGRAVITY-LOCAL.md`, `CLOSEOUT.md`                                               | rota por API (quarta família) não exercitada; a rota local não conta como ela                                 |

### 2. O que conta para F08, F17 e F18

O `requirements.json` usa três eixos: `deterministic`, `real_consumers` e `operational`. Este ADR não cria valores novos. Os valores existentes são:

- `deterministic`: `verified_w1_scope_only`, `verified_w2_scope_only`, `verified_w4_scope_only`, `verified_w5_scope_only`, `not_verified_for_evolution`;
- `real_consumers`: `verified_installed_local_scope_only`, `not_verified`;
- `operational`: `not_authorized`.

Mapeamento:

| Eixo             | Sai de                       | Vai para                                                                         | Condição                                                                                     |
| ---------------- | ---------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `deterministic`  | `not_verified_for_evolution` | o valor `verified_w<N>_scope_only` já existente que corresponde à onda do recibo | todos os bindings oficiais da família em L1, com cada teste ligado ao requisito              |
| `real_consumers` | `not_verified`               | `verified_installed_local_scope_only`, somente para binding local instalado      | binding local instalado em L2; binding por API não tem valor existente e fica `not_verified` |
| `operational`    | `not_authorized`             | permanece `not_authorized`                                                       | não há valor existente além deste; ver "Questões para o aceite"                              |

Por família:

- **F08 (segredos/egress):** passa quando o L1 liga a verificação do requisito a testes nomeados: login expirado, credencial de ambiente sobreposta, mudança silenciosa de cobrança. Os testes do broker já existentes (injeção pelo supervisor, cabeçalho de sobrescrita, eco bloqueado) contam como parte, mas não bastam sozinhos. O eixo `real_consumers` exige a varredura de segredos (item 7) sobre uma campanha real de L2 de qualquer binding.
- **F17 (model providers):** passa em `deterministic` quando todos os bindings de modelo declarados (local e remoto) estão em L1 com versão, transporte, autenticação, cobrança e cotas; "confirmar backend efetivo e precedência de credenciais" é o teste de credencial efetiva. Binding remoto sem prova de cota só chega a L1 com exceção auditada. `real_consumers` exige L2 de cada binding que o plano chama de oficial.
- **F18 (runtime providers):** o critério "quatro ecossistemas executam a jornada ou atuam como clientes explícitos do kernel" conta somente bindings em L2. Três ecossistemas em L2 e a quarta família pendente deixam F18 em `not_verified`; a rota local de um ecossistema não substitui a rota de API dele e não conta como a quarta família.

**Enquanto o owner não decidir qual valor e semântica valem para consumidor real de binding por API (questão 9), F08, F17 e F18 não avançam em `real_consumers`.** O valor existente descreve instalação local e não pode ser usado para binding por API sem decisão. Este ADR não escolhe nem inventa valor.

Uma família só muda de status por ato do Commander no fechamento de uma onda, citando os recibos. Este ADR não faz essa edição.

### 3. A quarta família

Pré-requisitos, todos obrigatórios antes de abrir a campanha:

1. **Credencial:** referência no `pass` confirmada pelo owner, com entrada existente (verificada por `pass ls`, sem imprimir valor) e confirmação de que o uso pelo HSEOS é permitido pela conta dona.
2. **Teto:** valor próprio e novo da campanha, em `max_cost_microusd` e `max_requests`, mais validade explícita. Nenhum saldo, reserva ou grant anterior é reaproveitado.
3. **Binding declarado:** em L0, com versões fixadas de cliente, SDK, modelo e endpoint, e rota `api` com reserva finita positiva por requisição.
4. **Runbook:** `docs/evolution/runbooks/fourth-family.md` atualizado para o binding e o teto concretos.
5. **Testes de L1 verdes** antes da campanha, sem afrouxar gate.
6. **Host:** `uptime` e `heavy-run --check` normais, um job pesado por vez.
7. **Assinatura primeiro:** registro de que a rota de assinatura oficial da família foi avaliada antes de pedir chave de API (existe ou não, e a fonte), e declaração de que nenhum token de assinatura será usado como API genérica. Sem esse registro, a campanha fica BLOCKED.

Orçamento máximo por campanha: o teto proposto no runbook da quarta família (seção 4) é ponto de partida e não autorização. O teto de cada campanha é fixado pelo owner no ato de autorizar; este ADR não fixa número. Referência, sem virar teto da quarta família: a decisão do owner de 2026-10-30 para a campanha do `tools/call` e MRTR com cliente real é o teto de US$ 2 (registrada em `.hseos/runs/dev-squad/20261030-1810-owner-decisions/STATUS.md`, linha 50). Para a quarta família: a confirmar no aceite.

Critério de aceite da campanha (PASS exige todos): evidência de L2 completa (seção 1), custo real ≤ teto, zero execução fora do teto, da validade e dos `task_ids` autorizados, revisão cética isolada em duas passagens (cega e confronto) que reporta e não corrige. FAIL: recibo ausente ou adulterado, custo acima do teto, recuperação sem mudança observável, efeito repetido, órfão não drenado. BLOCKED, com causa e nunca convertido em PASS: referência ausente, grant não autorizado ou expirado, cota ou identidade não comprovadas sem exceção, capacidade do host, endpoint compatível sem prova própria.

Quem autoriza: **sempre o owner, por campanha.** Uma autorização cobre uma campanha, um binding, um teto e uma validade. Aceitar este ADR não autoriza campanha alguma; nenhum agente, hook ou ADR anterior (incluindo o aceite de ADR-0044) autoriza a quarta família ou qualquer gasto.

### 4. Recertificação

A certificação de L2 e L3 perde validade, voltando ao nível anterior até nova campanha, quando:

- a versão do **cliente** muda em major ou minor (patch muda só se o changelog afetar autenticação, cobrança, cota ou protocolo);
- o **modelo** (identificador ou versão) muda;
- o **protocolo** muda (versão do protocolo, formato de `tools/call` ou do fluxo de aprovação);
- a **forma de cobrança ou de cota** muda, ou a credencial é trocada;
- o artefato do adapter muda de forma que afete a superfície certificada.

Validade por tempo: o recibo de L2 tem validade máxima. Valor: a confirmar no aceite. Sem decisão, vale o gatilho por mudança acima, e recibo mais antigo que a última mudança observada de versão não vale.

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

| Standard                                   | Section / Rule                 | Change                                                                               |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------ |
| `docs/evolution/requirements.json`         | `status` de F08, F17, F18      | Clarifies: define a condição para mudar, sem valores novos e sem edição por este ADR |
| `docs/evolution/runbooks/fourth-family.md` | §4 a §7                        | Extends: o teto vira decisão por campanha e o PASS referencia L2                     |
| ADR-0046                                   | bindings de plataforma e modos | Related: trata de platform bindings; não é alterado por este ADR                     |

---

## Compliance

- [ ] Approved by Engineering Leadership (owner)
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: a definir no aceite
- [ ] Review date: a cada recertificação (seção 4) ou na mudança do `requirements.json`

---

## Alternatives Considered

| Alternative                                        | Why Rejected                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Certificar por família de produto, não por binding | Conta, API e local têm credencial, cobrança e cota diferentes; uma prova não cobre as outras |
| Aceitar testes de protocolo como L2                | `BINDINGS.md` já registra que não comprovam login, cota, cobrança nem recuperação            |
| Criar status novos no `requirements.json`          | Fora do escopo e exigiria decisão separada; usar só os existentes                            |
| Teto fixo único para toda campanha                 | Cada campanha tem custo e risco próprios; o teto é decisão do owner por campanha             |
| Recertificação só por calendário                   | Não pega mudança de versão no meio da janela                                                 |

---

## Questões para o aceite

1. Qual a validade máxima por tempo de um recibo de L2 (seção 4)? A confirmar no aceite.
2. Qual o teto da campanha da quarta família (`max_cost_microusd`, `max_requests`) e a validade? A confirmar no aceite; o valor do runbook é só proposta.
3. A quarta família é a API Gemini direta ou um endpoint compatível, e qual a referência `pass` da credencial, incluindo se a chave citada anteriormente pode ser usada? A confirmar no aceite.
4. Qual `verified_w<N>_scope_only` o Commander usa para `deterministic` de F08, F17 e F18, dado que o vocabulário atual não tem uma literal para a W3? Se nenhuma servir, o owner decide se admite um valor novo.
5. O eixo `operational` precisa de um valor além de `not_authorized` para L3? Hoje não existe; a criação de um valor é decisão do owner.
6. O teto de US$ 2 de 2026-10-30 para `tools/call` e MRTR com cliente real vale por campanha ou em soma? O ADR o trata como por campanha; a confirmar.
7. Todos os bindings oficiais de F17 entram no L2 exigido, ou só os que o plano nomeia? A lista de bindings oficiais: a confirmar no aceite.
8. Quando o owner libera a quarta família (hoje adiada para depois de todas as fases)?
9. Qual valor e semântica de `real_consumers` valem para consumidor real de binding por API, já que o único valor existente descreve instalação local? Sem essa decisão, a quarta família por API não chega a `real_consumers`.
10. A rota de assinatura oficial da família da quarta rodada foi avaliada antes de pedir chave de API (assinatura primeiro)? A confirmar no aceite.
11. O owner aceita L2 com `tools/call` e MRTR como padrão para os demais bindings que expõem ferramentas?
12. Para F17 (model provider sem ferramentas), a jornada de L2 é a de geração com recuperação, sem `tools/call`? A confirmar no aceite.

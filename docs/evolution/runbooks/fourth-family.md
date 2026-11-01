# Runbook F2 — ensaio da 4ª família real (Gemini API ou compatível)

Status: **preparação, nada é executado por este documento.** O ADR-0050 (aceito pelo owner em 2026-10-31) fixou o teto padrão, a credencial e o critério de aceite desta família e a liberou **para planejamento**; a execução pede **autorização própria do owner por campanha** (ADR-0050, seção 3 e resposta 8). Este runbook existe para que a campanha comece com escopo, teto e critérios já definidos. Enquanto não for executada, FR07 dessa família permanece **pendente, nunca PASS**.

## 1. Estado atual (com fontes)

| Item                                         | Estado                                                                                                                                                                                                                                                                      | Fonte                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rota local Antigravity (LiteRT)              | Validada: pai local retomado, filhos reais (Codex conta), replay e drain; **não** é a 4ª família por API                                                                                                                                                                    | `docs/evolution/w3/ANTIGRAVITY-LOCAL.md:80-90`, `docs/evolution/w3/CLOSEOUT.md:3-6`                                                                                     |
| Gemini API                                   | **Não exercitada**; nenhuma chamada API paga foi feita                                                                                                                                                                                                                      | `docs/evolution/w3/STATUS.md:17`, `docs/evolution/w3/ANTIGRAVITY-LOCAL.md:55`, `docs/evolution/w3/LITERT-LOCAL-DIAGNOSTIC.md:42`                                        |
| Afirmação "quatro famílias reais concluídas" | **Falsa**, não é feita                                                                                                                                                                                                                                                      | `docs/evolution/w3/CLOSEOUT.md:42-44`                                                                                                                                   |
| Cliente Antigravity                          | SDK Python oficial `google-antigravity==0.1.18`, só ferramentas da API HSEOS por tarefa                                                                                                                                                                                     | `docs/evolution/w3/ANTIGRAVITY-CLIENT.md:4-8`                                                                                                                           |
| Rota `api` no catálogo                       | Antigravity declara `api` com `auth: 'api_key'`; rota `api` exige reserva finita positiva por requisição                                                                                                                                                                    | `tools/lib/provider-control-manifest.js:32,95`                                                                                                                          |
| Credencial                                   | Decidida pelo ADR-0050: `google/gemini-hseos` no `pass`, chave própria da Hideaki Serviços; a chave da NB Eventos é **proibida**. Estado em 2026-11-01: a entrada **ainda não existe**                                                                                      | `.enterprise/.specs/decisions/ADR-0050-provider-binding-certification-criterion.md` (seção 3, resposta 3)                                                               |
| ADR                                          | ADR-0044 aceito em 2026-10-30 e ADR-0050 aceito em 2026-10-31; nenhum dos dois autoriza campanha ou gasto                                                                                                                                                                   | `.enterprise/.specs/decisions/ADR-0044-project-engineering-control.md:3`, `.enterprise/.specs/decisions/ADR-0050-provider-binding-certification-criterion.md` (seção 3) |
| Entrada no `pass`                            | `google/gemini-hseos` ainda não existe; `google/gemini-api-key` (proposta anterior deste runbook) foi substituída e não deve ser criada                                                                                                                                     | ADR-0050, resposta 3; verificar com `pass ls`, sem imprimir valor                                                                                                       |
| Binding L0                                   | Declarado em `.agents/activation/provider-bindings/gemini-api.example.yaml` (`operational: false`, `authorized: false`). O validador atual (`tools/lib/agent-provider-binding.js`) aceita só o adapter `openai-compatible-sse` e recusa este arquivo; o adapter é a task B1 | `.agents/activation/provider-bindings/gemini-api.example.yaml`                                                                                                          |

Escopo: o ensaio é "Gemini API **ou compatível**". Se a campanha usar um endpoint compatível, o formato compatível **não comprova identidade, quota nem compatibilidade** do endpoint (`docs/evolution/w3/BINDINGS.md`, fontes e limites); essa prova é parte do ensaio.

## 2. Regra de orçamento: a reserva da W4-07b NÃO é reutilizável

- Teto original US$ 10, reservas US$ 9, saldo US$ 1, 30 despachos acumulados (`docs/evolution/w3/STATUS.md:18-19`).
- Os grants históricos da W3 expiraram em 26–27/09/2026 (`docs/evolution/w4/STATUS.md:530-531`) e a W4-07b não tem saldo de despachos adicionais (`docs/evolution/w4/STATUS.md:546-547`).
- US$ 9 "reservados" são reservas históricas retidas, **não fatura**, e não representam crédito disponível (`docs/evolution/w3/ANTIGRAVITY-LOCAL.md:56,88` (o documento cita US$ 8; o STATUS cita US$ 9, ambos como reservas históricas)).
- Portanto o ensaio exige **autorização nova e própria**: novo grant, novo teto, nova validade. Nenhum saldo, reserva ou autorização anterior é reaproveitado ou somado, e nenhuma é presumida (`docs/evolution/w3/CLOSEOUT-REVALIDATION.md:64-66`).

## 3. Credencial e assinatura primeiro

Credencial decidida pelo ADR-0050 (resposta 3): **`google/gemini-hseos`** no `pass`, chave própria da Hideaki Serviços, criada pelo owner com `pass insert -e`. Ela substitui a proposta anterior `google/gemini-api-key`. A chave da NB Eventos é **proibida**. Em 2026-11-01 a entrada **ainda não existe**; o agente só lê o valor no momento do uso, via `pass show`, e injeta pelo mecanismo de segredo do binding.

Pedir ao owner, antes da campanha:

1. Criar `google/gemini-hseos` e confirmar que o uso pelo HSEOS é permitido pela conta dona.
2. O escopo da chave: restrição por API/projeto/cota, se existir limite de gasto no lado do provedor.

**Assinatura primeiro (ADR-0050, seção 3, item 7 e resposta 10).** Antes de pedir a chave de API, registrar por escrito que a rota de assinatura oficial da família foi avaliada: se existe ou não, e a fonte. O registro também declara que nenhum token de assinatura será usado como API genérica. Sem esse registro a campanha fica **BLOCKED**.

Regras (`AGENTS.md` global §3c): a chave vai ao `pass` antes do primeiro uso; nunca em prompt, workspace, log, recibo, manifest ou documento (o binding registra a **referência**, não o valor); sem pooling de identidade e sem fallback para outra credencial. Se a referência não existir, o ensaio fica **BLOCKED** com essa causa.

## 4. Teto de orçamento (ADR-0050, seção 3)

O teto padrão foi fixado no aceite do ADR-0050 (respostas 2 e 3). **A autorização é do owner, por campanha, e pode fixar valor menor; valor maior exige decisão nova.** Uma autorização cobre uma campanha, um binding, um teto e uma validade.

| Parâmetro           | Teto padrão                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binding             | um único `binding:gemini-api-<id>`, rota `api` (API Gemini direta), `billing.kind` medido, reserva finita positiva por requisição; L0 em `.agents/activation/provider-bindings/gemini-api.example.yaml` |
| `max_requests`      | 4 (1 inspeção/identidade sem custo adicional não conta; 1 despacho de tarefa; 1 resume; 1 reserva com aviso)                                                                                            |
| `max_cost_microusd` | 1.000.000 (US$ 1,00), **teto novo e independente**, sem herdar saldo                                                                                                                                    |
| Teto por requisição | a definir pelo preço publicado do modelo na data, registrado no manifest (`max_request_microusd`)                                                                                                       |
| Escopo              | uma tarefa delimitada (a tarefa piloto da matriz F1 ou equivalente), sem acesso a outro consumidor                                                                                                      |
| Validade            | uma janela explícita de até 45 min por campanha; expiração encerra a campanha                                                                                                                           |
| Cota                | se o provedor não expõe cota, exceção explícita, limitada e auditada, com motivo (`BINDINGS.md`); cota desconhecida nunca é "ilimitada"                                                                 |
| Fora do escopo      | outras famílias, push de tag, merge, ativação, ampliação do teto sem nova decisão do owner                                                                                                              |

O teto de US$ 2 de `tools/call` e MRTR com cliente real é de outra campanha e também vale por campanha, sem herdar saldo (ADR-0050, resposta 6).

## 5. Pré-condições

1. Autorização própria do owner para esta campanha (um binding, um teto, uma validade); o aceite do ADR-0050 não a substitui.
2. Entrada `google/gemini-hseos` existente (verificar com `pass ls`, sem imprimir valor) e uso confirmado pela conta dona.
3. Registro de "assinatura primeiro" feito (seção 3).
4. Binding L0 com versões fixadas (cliente, SDK, modelo, endpoint; hoje "a confirmar na campanha") e manifest com `pids_max`, memória e prazo declarados. O adapter do binding é a task B1: sem ele a campanha não roda.
5. Host: `uptime` e `heavy-run --check`; um job pesado por vez; execução sob cgroup delegado (`/build/tmp/hseos-w5/bin/run-in-cgroup.sh`).
6. Testes determinísticos (L1) do controle verdes (`test/test-provider-campaign-control.js`, adapters da família), rodados antes e sem afrouxar nada.

## 6. Passos

1. **Inspeção sem inferência**: identidade/projeto efetivos da credencial, endpoint e modelo, preço, cota observável. Registrar no recibo (sem valor da chave).
2. **Abrir campanha** com a autorização da seção 4 (padrão do harness descrito em `docs/evolution/runbooks/evolution-matrix.md`, seção 2: pin do verificador antes da primeira reserva, reserva antes do efeito, recibo depois).
3. **Despacho 1**: tarefa delimitada com verificador externo que rejeita o baseline.
4. **Recuperação/resume**: segundo despacho na **mesma sessão**, com mudança observável de estado, como nas campanhas ACP/Claude (`docs/evolution/w3/CLOSEOUT.md:36-38`); replay idempotente sem novo efeito.
5. **Drain e reconciliação**: zero comandos vivos ou incertos, zero processos órfãos, reserva reconciliada com o recibo.
6. **Recibo final** com versões, controle disponível, credencial efetiva (referência), consumo/custo, resultado e limitações, e `does_not_prove` (FR07, `.specs/features/harness-w3/spec.md:37-41`).
7. **Revisão cética** isolada em duas passagens; reporta, não corrige.

## 7. Critérios de PASS / FAIL / BLOCKED

Critério de aceite da campanha (ADR-0050, seção 3). PASS exige **todos**:

- Evidência de L2 completa (ADR-0050, seção 1), com custo real ≤ teto autorizado.
- Revisão cética isolada em duas passagens (cega e confronto), que reporta e não corrige.
- Identidade, projeto e rota efetivamente usados comprovados pelo adapter (não só configurados).
- Despacho real com recibo e verificação externa aprovada; recuperação real na mesma sessão com mudança observável; replay idempotente.
- Custo/consumo registrado; valores informados pelo SDK **não substituem fatura** e são rotulados assim (`docs/evolution/w3/CLOSEOUT.md:17`).
- Zero execução fora do teto, da validade e do `task_ids` autorizados; zero segredo em artefato.
- Distinção explícita entre chamada real e fixture/mock; teste ACP sobre Codex **não** vale como esta família.

FAIL: recibo ausente/adulterado, custo acima do teto, recuperação sem mudança observável, efeito repetido, órfão não drenado.

BLOCKED (com causa, nunca PASS): referência `pass` ausente; registro de assinatura primeiro ausente; grant não autorizado ou expirado; cota/identidade não comprovadas sem exceção; capacidade do host; endpoint compatível sem prova própria. Não afrouxar gate nem policy para passar.

## 8. Fora de escopo

- Qualquer execução antes da autorização do owner para a campanha.
- Reutilizar a reserva ou os grants da W3/W4-07b.
- Declarar "quatro famílias concluídas" enquanto este ensaio não tiver PASS, ou o programa "terminado" (W4–W8 e validação diferida; `docs/evolution/w3/CLOSEOUT.md:42-44`).
- Tratar o aceite do ADR-0044 (2026-10-30) ou do ADR-0050 (2026-10-31) como autorização para rodar a quarta família: a execução pede autorização do owner por campanha.
- Inclusão nas campanhas comparativas (F1): só depois do PASS aqui.

## 9. Decisões que cabem ao owner

Já decididas no ADR-0050 (2026-10-31): API Gemini direta, chave `google/gemini-hseos`, teto padrão de 4 requisições, US$ 1,00 e 45 min.

Por campanha:

1. Autorizar a campanha e a data (a execução nunca é implícita).
2. Criar `google/gemini-hseos` e confirmar o uso pela conta dona.
3. Teto da campanha (igual ou menor que o padrão; maior exige decisão nova), validade e modelo.
4. Se o resultado entra na matriz F1 e se algum status do `requirements.json` muda (ato do Commander no fechamento de onda, citando os recibos).

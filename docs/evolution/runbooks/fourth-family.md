# Runbook F2 — ensaio da 4ª família real (Gemini API ou compatível)

Status: **preparação (W7), nada é executado por este documento.** Por decisão do owner (2026-09-27) o ensaio fica **adiado para depois de todas as fases** (`.specs/features/harness-w3/spec.md:67-80`). Este runbook existe para que, quando o owner liberar, o ensaio comece com escopo, teto e critérios já definidos. Enquanto não for executado, FR07 dessa família permanece **pendente, nunca PASS**.

## 1. Estado atual (com fontes)

| Item                                         | Estado                                                                                                                       | Fonte                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Rota local Antigravity (LiteRT)              | Validada: pai local retomado, filhos reais (Codex conta), replay e drain; **não** é a 4ª família por API                     | `docs/evolution/w3/ANTIGRAVITY-LOCAL.md:80-90`, `docs/evolution/w3/CLOSEOUT.md:3-6`                                              |
| Gemini API                                   | **Não exercitada**; nenhuma chamada API paga foi feita                                                                       | `docs/evolution/w3/STATUS.md:17`, `docs/evolution/w3/ANTIGRAVITY-LOCAL.md:55`, `docs/evolution/w3/LITERT-LOCAL-DIAGNOSTIC.md:42` |
| Afirmação "quatro famílias reais concluídas" | **Falsa**, não é feita                                                                                                       | `docs/evolution/w3/CLOSEOUT.md:42-44`                                                                                            |
| Cliente Antigravity                          | SDK Python oficial `google-antigravity==0.1.18`, só ferramentas da API HSEOS por tarefa                                      | `docs/evolution/w3/ANTIGRAVITY-CLIENT.md:4-8`                                                                                    |
| Rota `api` no catálogo                       | Antigravity declara `api` com `auth: 'api_key'`; rota `api` exige reserva finita positiva por requisição                     | `tools/lib/provider-control-manifest.js:32,95`                                                                                   |
| Credencial                                   | Referência solicitada ao owner mais de uma vez; a chave citada pertence à NB Eventos e a localização não foi confirmada      | `docs/evolution/w3/LITERT-LOCAL-DIAGNOSTIC.md:54-55`, `docs/evolution/w3/CLOSEOUT-REVALIDATION.md:67-68`                         |
| ADR                                          | ADR-0044 **aceito pelo owner em 2026-10-30** (era draft); o aceite não autoriza a quarta família                             | `.enterprise/.specs/decisions/ADR-0044-project-engineering-control.md:3`, `docs/evolution/w3/CLOSEOUT.md:44`                     |
| Entrada no `pass`                            | Nenhuma entrada Gemini encontrada em `pass ls` (grupo `google/` só tem OAuth/Calendar; `nb-eventos/` não lista chave Gemini) | consulta somente-leitura de nomes em 2026-10-20; **não verificada a existência fora dessa listagem**                             |

Escopo: o ensaio é "Gemini API **ou compatível**". Se a campanha usar um endpoint compatível, o formato compatível **não comprova identidade, quota nem compatibilidade** do endpoint (`docs/evolution/w3/BINDINGS.md`, fontes e limites); essa prova é parte do ensaio.

## 2. Regra de orçamento: a reserva da W4-07b NÃO é reutilizável

- Teto original US$ 10, reservas US$ 9, saldo US$ 1, 30 despachos acumulados (`docs/evolution/w3/STATUS.md:18-19`).
- Os grants históricos da W3 expiraram em 26–27/09/2026 (`docs/evolution/w4/STATUS.md:530-531`) e a W4-07b não tem saldo de despachos adicionais (`docs/evolution/w4/STATUS.md:546-547`).
- US$ 9 "reservados" são reservas históricas retidas, **não fatura**, e não representam crédito disponível (`docs/evolution/w3/ANTIGRAVITY-LOCAL.md:56,88` (o documento cita US$ 8; o STATUS cita US$ 9, ambos como reservas históricas)).
- Portanto o ensaio exige **autorização nova e própria**: novo grant, novo teto, nova validade. Nenhum saldo, reserva ou autorização anterior é reaproveitado ou somado, e nenhuma é presumida (`docs/evolution/w3/CLOSEOUT-REVALIDATION.md:64-66`).

## 3. Credencial a pedir (sem valor)

Pedir ao owner **uma referência**, nunca o valor:

1. Qual projeto/conta Google é dona da chave (a menção anterior é NB Eventos) e se o uso pelo HSEOS é permitido por essa conta.
2. A **referência no `pass`**: proposta de caminho `google/gemini-api-key` (ou `<projeto>/gemini-api-key` se pertencer a um projeto), a ser criada pelo owner com `pass insert -e`. O agente só lê o valor no momento do uso, via `pass show`, e injeta pelo mecanismo de segredo do binding.
3. Escopo da chave: restrição por API/projeto/cota, se existir limite de gasto no lado do provedor.

Regras (`AGENTS.md` global §3c): a chave vai ao `pass` antes do primeiro uso; nunca em prompt, workspace, log, recibo, manifest ou documento (o binding registra a **referência**, não o valor); sem pooling de identidade e sem fallback para outra credencial. Se a referência não existir, o ensaio fica **BLOCKED** com essa causa.

## 4. Teto de orçamento PROPOSTO

Proposta, **a ser autorizada pelo owner** (valores a decidir; não estão autorizados):

| Parâmetro           | Proposta                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Binding             | um único `binding:gemini-api-<id>`, rota `api`, `billing.kind` medido, reserva finita positiva por requisição                           |
| `max_requests`      | 4 (1 inspeção/identidade sem custo adicional não conta; 1 despacho de tarefa; 1 resume; 1 reserva com aviso)                            |
| `max_cost_microusd` | US$ 1,00 (1.000.000 µUSD), **teto novo e independente**; o valor final é do owner                                                       |
| Teto por requisição | a definir pelo preço publicado do modelo na data, registrado no manifest (`max_request_microusd`)                                       |
| Escopo              | uma tarefa delimitada (a tarefa piloto da matriz F1 ou equivalente), sem acesso a outro consumidor                                      |
| Validade            | uma janela explícita (≤ 45 min por campanha); expiração encerra a campanha                                                              |
| Cota                | se o provedor não expõe cota, exceção explícita, limitada e auditada, com motivo (`BINDINGS.md`); cota desconhecida nunca é "ilimitada" |
| Fora do escopo      | outras famílias, push de tag, merge, ativação, ampliação do teto sem nova confirmação                                                   |

## 5. Pré-condições

1. Aceite do owner para iniciar (decisão de data; o adiamento "para depois de todas as fases" só termina com ordem do owner).
2. Referência `pass` confirmada pelo owner e entrada existente (verificar com `pass ls`, sem imprimir valor).
3. Binding e manifest com versões fixadas (cliente, SDK, modelo, endpoint), `pids_max`, memória e prazo declarados.
4. Host: `uptime` e `heavy-run --check`; um job pesado por vez; execução sob cgroup delegado (`/build/tmp/hseos-w5/bin/run-in-cgroup.sh`).
5. Testes determinísticos do controle verdes (`test/test-provider-campaign-control.js`, adapters da família), rodados antes e sem afrouxar nada.

## 6. Passos

1. **Inspeção sem inferência**: identidade/projeto efetivos da credencial, endpoint e modelo, preço, cota observável. Registrar no recibo (sem valor da chave).
2. **Abrir campanha** com a autorização da seção 4 (padrão do harness descrito em `docs/evolution/runbooks/evolution-matrix.md`, seção 2: pin do verificador antes da primeira reserva, reserva antes do efeito, recibo depois).
3. **Despacho 1**: tarefa delimitada com verificador externo que rejeita o baseline.
4. **Recuperação/resume**: segundo despacho na **mesma sessão**, com mudança observável de estado, como nas campanhas ACP/Claude (`docs/evolution/w3/CLOSEOUT.md:36-38`); replay idempotente sem novo efeito.
5. **Drain e reconciliação**: zero comandos vivos ou incertos, zero processos órfãos, reserva reconciliada com o recibo.
6. **Recibo final** com versões, controle disponível, credencial efetiva (referência), consumo/custo, resultado e limitações, e `does_not_prove` (FR07, `.specs/features/harness-w3/spec.md:37-41`).
7. **Revisão cética** isolada em duas passagens; reporta, não corrige.

## 7. Critérios de PASS / FAIL / BLOCKED

PASS exige **todos**:

- Identidade, projeto e rota efetivamente usados comprovados pelo adapter (não só configurados).
- Despacho real com recibo e verificação externa aprovada; recuperação real na mesma sessão com mudança observável; replay idempotente.
- Custo/consumo registrado; valores informados pelo SDK **não substituem fatura** e são rotulados assim (`docs/evolution/w3/CLOSEOUT.md:17`).
- Zero execução fora do teto, da validade e do `task_ids` autorizados; zero segredo em artefato.
- Distinção explícita entre chamada real e fixture/mock; teste ACP sobre Codex **não** vale como esta família.

FAIL: recibo ausente/adulterado, custo acima do teto, recuperação sem mudança observável, efeito repetido, órfão não drenado.

BLOCKED (com causa, nunca PASS): referência `pass` ausente; grant não autorizado ou expirado; cota/identidade não comprovadas sem exceção; capacidade do host; endpoint compatível sem prova própria. Não afrouxar gate nem policy para passar.

## 8. Fora de escopo

- Qualquer execução antes da ordem do owner.
- Reutilizar a reserva ou os grants da W3/W4-07b.
- Declarar "quatro famílias concluídas" enquanto este ensaio não tiver PASS, ou o programa "terminado" (W4–W8 e validação diferida; `docs/evolution/w3/CLOSEOUT.md:42-44`).
- Tratar o aceite do ADR-0044 (2026-10-30) como autorização para rodar a quarta família: credencial e teto seguem como decisão própria do owner.
- Inclusão nas campanhas comparativas (F1): só depois do PASS aqui.

## 9. Decisões que cabem ao owner

1. Quando liberar o ensaio (hoje: depois de todas as fases).
2. Referência `pass` da chave Gemini e se a chave da NB Eventos pode ser usada.
3. Teto (`max_cost_microusd`, `max_requests`), validade e modelo.
4. Gemini API direta ou endpoint compatível (e qual).
5. Se o resultado entra na matriz F1 e se a ADR-0044 muda de status.

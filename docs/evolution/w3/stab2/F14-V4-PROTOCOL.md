# Protocolo proposto da F14 v4, 2026-11-09

**Estado: PROPOSTA. Não aprovada. Nenhuma chamada paga, nenhum código de campanha e nenhum status muda por este documento.** Ele só vale depois da aprovação escrita do owner (seção 13). Complementa a seção "F14 v3" de `T4.md` e responde às ressalvas de `REAUDIT-BLIND-4-2026-11-09.md` e às decisões do owner de 2026-11-09 (ADR-0050, "Respostas posteriores do owner (2026-11-09)"): a F14 só é promovida com tarefas do owner.

## 1. O que muda em relação à v3

| Problema achado na v3 | Mudança na v4 |
| --- | --- |
| Tarefas e regras inventadas pelo executor; resultado "quase certo por construção" | Três regras **reais do owner**, já escritas em diretivas dele, e casos de teste que **não aparecem na nota** (a nota só vale se for aplicada) |
| Promoção feita pela API por baixo do roteiro | Promoção pelo **comando `hseos memory promote`, no terminal do owner** (exige TTY; mostra conteúdo e sha256; uma memória por vez) |
| Limite de 8 requisições punia o controle por esgotamento (14 de 15 no teto; 0 de 8 e 0 de 9 nos testes, abaixo da solução ingênua) | Desfecho principal é "os testes protegidos passam no arquivo final". Teto de requisições sobe para 12, declarado **antes** de qualquer dado, e bater o teto é dado separado |
| Prova do adapter reescrita pelo roteiro em 17 de 33 execuções | **Proibido.** Execução que bate o teto registra a prova como `cap-reached`, à parte; `requests_total` nunca é reescrito |
| Só "nota não promovida" como controle | Acrescenta um braço **placebo**: uma nota promovida irrelevante, para separar "qualquer nota no contexto" de "a nota certa" |
| Recibo com seções de rascunho contradizendo a execução real | O recibo nasce da execução; a seção de rascunho é removida antes da reauditoria |

## 2. Hipótese e o que ela mede

**Hipótese:** memória promovida pelo owner, entregue pelo `agent run` de produção com `source_db`, faz o modelo aplicar uma convenção real do projeto, em casos que a nota não lista, verificada por testes protegidos.

**O que mede:** que a nota promovida chega ao contexto e é **aplicada a entradas novas**. **O que NÃO mede:** utilidade em trabalho real, nem se o modelo a descobriria sozinho em outro contexto. Com regras exatas e nota presente, um resultado favorável continua provável; por isso o critério é só o piso, e o braço placebo e a medida de requisições dão a leitura adicional. A ressalva "quase certo por construção" permanece no recibo.

## 3. As três tarefas

Cada regra existe **só na nota**. O requisito dado ao modelo não cita a regra nem a memória. O agente roda com `HOME` isolado e cada tarefa tem projeto próprio no banco (`f14v4-oidc`, `f14v4-seed`, `f14v4-pass`); os diretórios do owner não são lidos.

### A. `oidc.js`: `oidcConfig(app)`

- **Fonte da regra:** `AGENTS.md` do owner, §3e (IdP compartilhado).
- **Nota promovida (texto):** "Convenção de OIDC do projeto: o issuer é `https://keycloak.hideakiservicos.net/kc/realms/<app>`. A URL do JWKS é sempre a do serviço interno, `http://keycloak-shared.platform-shared-dev.svc.cluster.local:8080/kc/realms/<app>/protocol/openid-connect/certs`, e nunca é derivada do issuer público. Cada app tem dois clientes: `<app>-frontend` (público) e `<app>-backend` (audiência). Exemplo, para o app `demo`: issuer `https://keycloak.hideakiservicos.net/kc/realms/demo` e clientes `demo-frontend` e `demo-backend`." (o exemplo usa só `demo`; os testes usam outros apps).
- **Requisito:** "In oidc.js, export with module.exports a function oidcConfig(app) returning an object with issuer, jwksUrl, frontendClientId and backendClientId for a new application. Follow the project convention."
- **Testes protegidos** (igualdade exata dos 4 campos): `marketplace`, `ai-agents-os`, `poynthub`.
- **Ingênua (filtro):** `issuer = https://keycloak.example.com/auth/realms/${app}`, `jwksUrl = ${issuer}/protocol/openid-connect/certs`, clientes `${app}` e `${app}-api`. Precisa reprovar.

### B. `seed.js`: `seedEmail(role, n, solution)`

- **Fonte da regra:** `AGENTS.md`, §3d-bis (identidades de seed).
- **Nota promovida:** "Convenção de seeds do projeto: o e-mail é `<papel><NNNN>@<solucao>.local`, com `NNNN` em 4 dígitos com zeros à esquerda, tudo em minúsculas, papel no singular. O administrador primário não leva número: `admin@<solucao>.local`. Exemplo: `client0001@demo.local`."
- **Requisito:** "In seed.js, export with module.exports a function seedEmail(role, n, solution) that returns the e-mail of a seeded test account. n is a positive integer, or null for the primary account. Follow the project convention."
- **Testes protegidos:** `('client',1,'poynthub')` dá `client0001@poynthub.local`; `('provider',12,'poynthub')` dá `provider0012@poynthub.local`; `('support',345,'curatex')` dá `support0345@curatex.local`; `('driver',9999,'poynthub')` dá `driver9999@poynthub.local`; `('admin',null,'poynthub')` dá `admin@poynthub.local`; `('admin',2,'poynthub')` dá `admin0002@poynthub.local`.
- **Ingênua:** `${role}${n}@${solution}.com`. Precisa reprovar.

### D. `pass.js`: `passPath(kind, name, project)`

- **Fonte da regra:** `~/.claude/CLAUDE.md` ("Grupos padrão") e `AGENTS.md` §3c.
- **Nota promovida:** "Convenção de segredos do projeto: todo segredo mora no `pass`, em `<grupo>/<nome>`. Grupos: `github/` (tokens e chaves GitHub e Bitbucket), `google/` (service accounts e OAuth clients), `docker/` (credenciais de registry), `kubernetes/` (kubeconfigs e certificados), `ssh/` (chaves privadas SSH), `gitops/` (chaves de automação GitOps), `claude/` (tokens Claude, Anthropic e MCPs), `misc/` (outros). Credenciais da infra compartilhada ficam em `platform-shared-dev/<nome>`; credenciais de um projeto ficam em `<projeto>/<nome>`."
- **Requisito:** "In pass.js, export with module.exports a function passPath(kind, name, project) that returns the pass entry path for a secret. project is only given for project credentials. Follow the project convention."
- **Testes protegidos** (com paráfrases que a nota não usa literalmente): `('GitHub token','ci-bot')` dá `github/ci-bot`; `('Bitbucket token','mirror')` dá `github/mirror`; `('OAuth client','portal')` dá `google/portal`; `('service account','bq-reader')` dá `google/bq-reader`; `('registry credentials','ghcr')` dá `docker/ghcr`; `('kubeconfig','dev-cluster')` dá `kubernetes/dev-cluster`; `('certificate','ingress-tls')` dá `kubernetes/ingress-tls`; `('SSH private key','deploy')` dá `ssh/deploy`; `('GitOps automation key','argocd')` dá `gitops/argocd`; `('MCP token','axon')` dá `claude/axon`; `('shared infra credential','postgres-shared')` dá `platform-shared-dev/postgres-shared`; `('project credential','db-user','poynt')` dá `poynt/db-user`; `('unknown thing','x')` dá `misc/x`.
- **Ingênua:** `secrets/${name}`. Precisa reprovar.

**Filtro mecânico, como na T4:** a ingênua reprova nos testes protegidos, offline e sem custo; depois, 1 piloto sem memória por tarefa (3 no total). Piloto que passa rejeita a tarefa, que é substituída antes da série. As soluções ingênuas acima são propostas do executor, para o owner aceitar ou trocar.

## 4. Condições (três caixas de banco)

| Caixa | Conteúdo no projeto da tarefa | Papel |
| --- | --- | --- |
| A, controle | a nota certa, **escrita e não promovida** | critério |
| B, promovida | a nota certa, **promovida pelo owner** | critério |
| C, placebo | a nota de **outra** tarefa, promovida (A recebe a nota de B, B a de D, D a de A) | informativa |

O placebo não exige texto novo e tem o mesmo formato e tamanho de uma nota real.

## 5. Parâmetros pré-registrados

| Parâmetro | Valor |
| --- | --- |
| Modelo | `gpt-4o-2024-08-06` (nome datado), binding `openai-compatible`, origem `https://api.openai.com` |
| n | 5 por tarefa nas caixas A e B (critério); 3 por tarefa na caixa C (informativa, sem inferência); 3 pilotos. Total: 3 + 15 + 15 + 9 = **42 execuções** |
| Ordem | aleatorizada e intercalada dentro de cada tarefa; semente sorteada na hora e gravada antes da primeira chamada |
| Limite de requisições | **12** por execução (na v3 era 8). Declarado antes de qualquer dado; bater o teto é registrado à parte e não reescreve a prova |
| Banco | cópia do `project.db` real (API de backup do SQLite), varredura de segredos antes de qualquer uso; removida ao fim; no repositório só sha256 e resultado da varredura |
| Medidor | o da F15: arquivo final reconstruído do ledger (`engineering.write` e `engineering.patch`) com conferência de sha256; sem reconstrução é `no-final-write`, nunca aprovação |
| Preço | `--price-in 2.5 --price-out 10`, iguais ao plano |
| Teto | **US$ 3,00** cumulativo, pelo gasto estimado pelo roteiro (sem desconto de cache); parada a 80% **não** se aplica, como na v3; 45 min |

## 6. Promoção pelo owner

1. O passo de preparo do roteiro cria os bancos das caixas A, B e C com as notas escritas como memória **do agente** (não confiável) e imprime, para cada projeto, o comando a rodar.
2. O owner roda, **no próprio terminal**, `hseos memory promote --db <banco> --project <projeto> --memory <id> --reason "<motivo>" --operator owner` para cada uma das **6 promoções** (3 na caixa B, 3 na caixa C). O comando mostra o conteúdo e o sha256 e pede confirmação; o owner confere o texto contra a nota desta seção.
3. O roteiro lê os recibos de promoção, grava os sha256 no recibo da campanha e só então libera a execução. Sem as 6 promoções, a campanha fica BLOCKED.

## 7. Medidas e análise

- **Desfecho principal (por execução):** os testes protegidos passam no arquivo final reconstruído **e** o verificador do produto aprova.
- **Critério (como na T4):** a unidade é a tarefa; teste exato condicional estratificado por tarefa, bilateral, p < 0,05; sucesso se, em **cada** tarefa, promovida ≥ 4 de 5 e controle ≤ 1 de 5, e p < 0,05. Fisher agregado é proibido (pseudo-replicação).
- **Informativas (sem inferência):** placebo por tarefa (n = 3); requisições por execução e por braço; quantos bateram o teto; `note_in_context` por execução (1 fonte `trusted`/`data` na promovida e na placebo, 0 no controle).
- **Parada:** reprovou, encerra e registra, sem rodada extra. Parada por teto, por tempo ou por falha de protocolo é `INCOMPLETE` ou `fail`, como nas campanhas anteriores.

## 8. Custo e crédito

Base medida na v3 pelo roteiro (sem cache): promovida US$ 0,028 por execução (5,1 requisições), controle US$ 0,053 (7,9, quase todas no teto de 8), piloto US$ 0,049. A console deu cerca de 0,69 da estimativa do roteiro.

| Cenário | Estimativa do roteiro | Console esperada (×0,69) |
| --- | --- | --- |
| Controles e placebos com ~10 requisições | cerca de US$ 2,2 | cerca de US$ 1,5 |
| Controles e placebos sempre no teto de 12 | cerca de US$ 2,6 | cerca de US$ 1,8 |

Por isso o teto de US$ 3,00 pelo roteiro (precedente da v3): um teto menor faria a parada por teto cortar a série. O crédito da conta B em 2026-11-09 é US$ 3,17; **o crédito precisa estar em pelo menos US$ 3,00 no início**, senão a campanha para e avisa. A chave `runtime-one` é compartilhada; criar uma chave própria de campanha com limite no painel continua sendo recomendação, e criar ou revogar chave é decisão do owner. A console é lida antes e depois (leitura, Chrome anônimo com login do owner).

## 9. Controles de prova

`provider_proof` lido de `agent evidence` e passado em `summarize-provider-proof.cjs`, sem ajuste. Execução que bate o teto grava a prova original e o marcador `cap-reached`; ela **não** entra na contagem "prova do adapter `pass`", e o recibo diz quantas foram. Modelo datado, origem, versões observadas e `credential_sha256` fora do recibo, como na F15. Endpoint, protocolo e SDK observados entram no recibo (lacuna da v3 e da F15).

## 10. O que este protocolo não prova

- Não prova utilidade em trabalho real; prova aplicação de uma convenção real a entradas novas, com a nota promovida.
- Um modelo, um provedor, uma chave compartilhada, n = 5 por tarefa e condição.
- Não fecha os outros itens do L2 da F14: assinatura primeiro, cota ou exceção auditada, recuperação com mudança de estado, validade de 90 dias e referência da credencial. Isso é trabalho à parte.
- Não promove nada sozinho. A regra de status da T4 continua valendo: recibo L2 completo, prova de credencial do adapter, custo conferido na console, reauditoria em duas passagens e decisão do owner.

## 11. Gates antes de qualquer gasto

Ensaio offline completo com `fetch` falso; testes do roteiro no CI sem Podman e sem rede; mutações que reprovam; revisão cética isolada em duas passagens; impressão digital de confirmação (`F14V4_REAL_CONFIRMED`) fixada pelo owner; as 6 promoções feitas; crédito ≥ US$ 3,00; linha de base da console lida; campanha lançada **sem `heavy-run` externo** e com raiz absoluta.

## 12. Implementação (fora desta PR)

Depois da aprovação: tarefas e testes protegidos da v4 (as três acima), caixa C e o preparo com a impressão dos comandos de promoção, teto de 12 requisições, marcador `cap-reached` sem reescrita de prova, medidor da F15, ensaio, recibo e reauditoria. Cada passo é uma PR própria só com o que o owner aprovou.

## 13. Aprovações pedidas ao owner

1. As três tarefas (A, B e D), ou outras regras suas.
2. Os parâmetros: braço placebo com n = 3, teto de requisições 12, teto de US$ 3,00.
3. Fazer as 6 promoções no seu terminal.
4. Autorizar o gasto de uma campanha com esse teto, depois do ensaio e da reauditoria (a autorização do gasto continua sendo por campanha).

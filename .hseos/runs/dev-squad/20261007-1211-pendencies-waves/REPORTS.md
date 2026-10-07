# Relatórios para decisão do owner — 20261007-1211-pendencies-waves

## N9 — consultas curtas a capabilities

**Resumo:** design.* aparece para consultas curtas, mas o ruído vem do match de prefixo em aliases (ui.login, sso-login), não da heurística de substring. O corte de 3 caracteres na heurística não resolve sso/ui.

### Dados

Snapshot real, 14 capabilities, resolveCapability via loadCapabilityRegistry com node v24. Resultados (query -> capability [match:score]): sso -> design.login-pattern [prefix:40, alias sso-login]; ui -> design.login-pattern [prefix:40, alias ui.login]; design -> design.login-pattern + design.mobile-tokens [prefix:40, namespace]; theme -> design.mobile-tokens [heuristic:10]; tokens -> design.mobile-tokens [heuristic:10]; login -> design.login-pattern [alias:90]; auth -> security.authn [alias:90] e auth.authenticate [prefix:40]; api -> nenhum; db -> nenhum. Ruído: ui (claro), sso (discutível; security.authn tem oidc/keycloak mas não casa). theme/tokens são heurística de score 10, aceitável. A heurística de substring (containsQuery) só roda quando nada casou e já exige >=2 caracteres; nenhuma das 9 consultas curtas ruidosas passou por ela.

### Proposta

Menor mudança que ataca o ruído real: em bestMatch (capability-registry.js ~L388), só tentar o ramo prefix quando queryLower.length >= 3. Isso remove ui e uu, mantém sso, api e auth. Remover sso de verdade exigiria prefixo só em fronteira de token do nome da capability ou piso de score, o que muda o contrato do ADR-0046 §7 e precisa de decisão. Se ainda assim quiserem o mínimo de 3 na heurística (trocar query.length < 2 por < 3 em resolveCapability), isso quebra em test/test-capability-registry.js o teste 'two-character query can still use the heuristic' (~L597-600, usa 'ed'), que teria de virar 'sem hits de heurística'. Casos de heurística com 4+ caracteres (Redis, Authn, JwtBearer, event-envelope, obile, ile tok) não são afetados. Não vi teste de prefixo com consulta de <=2 caracteres, mas isso é leitura do código; a suíte não foi rodada com a mudança. Nada foi implementado.

**Confiança:** alta nas medições; média no impacto nos testes (por leitura, sem execução)

## N12 — divergências de modalidade em canonical_rules

**Resumo:** N12 (somente leitura, nada escrito, base aberta com mode=ro). Total de divergências de modalidade na base: 352 regras únicas (canonical_rules.modality_divergence NOT NULL). Envolvem hseos: 305, número que confere com o da tarefa. A divergência é artefato de medição, não conflito normativo. Cerca de 95% (289 de 305) ainda se aplicam, mas como ruído de classificação. Só 16 sumiram ou perderam a divergência. Nenhuma das 10 amostras revela contradição real.

### Dados

COMO A BASE CALCULA A DIVERGÊNCIA
- Fonte: README.md e tools/canonicalize.py e refresh_canonical.py.
- A divergência fica em canonical_rules.modality_divergence. Ela é preenchida quando as variantes de uma mesma regra única (agrupadas por normalização bilíngue + MinHash) têm verbos modais RFC2119 diferentes.
- A regra canônica adota a modalidade mais forte. O texto de report_canonical.py §6 diz que o relatório da própria base não confirmou nenhuma contradição real e que as divergências são só de força normativa.
- A modalidade vem de heurística de classify.py. O texto de referência é a frase normalizada, que descarta cabeçalhos de coluna de tabela e contexto de seção.

RECONTAGEM
- Total: 352.
- Com hseos: 305. Por composição de fontes: hseos sozinho 269, hseos+srm 26, govos+hseos 8, govos+hseos+srm 2.
- Só 36 das 305 cruzam fontes. As outras 269 são divergência interna do próprio hseos, entre variantes dentro do mesmo corpus.
- Tipo de divergência nas 305:
  - 103 misturam MUST e MUST_NOT.
  - 163 envolvem INFORMATIVE, por exemplo MUST×1; INFORMATIVE×1.
  - 39 são outras combinações, como SHOULD×MUST.
- Os pares MUST × MUST_NOT são em geral a mesma proibição escrita nas duas polaridades (ex.: "Always use env vars" e "Never hardcode secrets").

AMOSTRA DE 10 (critério: mistura MUST/MUST_NOT, depois nº de fontes, depois nº de variantes)
Id da regra única, fontes, divergência, regra e o que significa:
1. 519, hseos+srm, MUST×5; MUST_NOT×3; INFORMATIVE×1. "No hardcoded secrets" (representante em spec/platform/global/CLAUDE.md:97). Mesma proibição em polaridades diferentes.
2. 929, hseos+srm, MUST×7; MUST_NOT×1. "Never log sensitive data".
3. 142, hseos+srm, MUST×5; MUST_NOT×1. "Nunca hardcodar credentials".
4. 951, hseos+srm, MUST×5; MUST_NOT×1. Queries parametrizadas, nunca concatenação de SQL.
5. 13317, govos+hseos, MUST×4; MUST_NOT×1. "Governance Release" só a partir de identidade de repo, commit imutável e tag aprovada (.enterprise/.specs/features/managed-governance-shadow-readiness/spec.md:67).
6. 832, hseos+srm, MUST×3; MUST_NOT×1. Terraform plan antes de apply (AGENTS.md:325).
7. 15011, hseos+srm, MUST×3; MUST_NOT×1. "Force push proibido em todas as branches" (spec/docs/governance.md:171).
8. 13386, govos+hseos, MUST×2; MUST_NOT×1. O importer só descobre raízes canônicas em allowlist e rejeita paths fora do repo e symlink escape (managed-governance-control-plane/spec.md:102).
9. 890, hseos+srm, MUST_NOT×1; MUST×1. "Never swallow exceptions silently".
10. 7495, hseos+srm, MUST_NOT×1; MUST×1. "Never push directly to protected branches" (.enterprise/playbooks/git-workflow.md:142).
Observação: nas amostras 1, 2, 4, 6 e 7 o caminho representante é spec/platform/..., que vem da fonte srm. No repo atual não existe diretório spec/. As variantes hseos dessas regras estão em outros arquivos que ainda existem.

CONFRONTO COM O REPO ATUAL (HEAD de 2026-10-07)
- O repo mudou: 230 commits desde 14/09 e ADR-0046 (aceito em 2026-10-01).
- Método: para cada uma das 305 regras, peguei as variantes de origem hseos e verifiquei se o arquivo (path do locator) existe hoje e se o início do texto bruto (80 caracteres normalizados) ainda está no arquivo.
- Resultado:
  - 289 de 305 (94,8%) têm 2 ou mais variantes hseos com arquivo e texto ainda presentes. A divergência potencial continua.
  - 16 (5,2%) têm menos de 2 variantes vivas, então a divergência provavelmente sumiu. A divergência não é recalculada aqui, só estimada pela presença do texto.
  - Nenhum arquivo-fonte hseos sumiu nas regras divergentes. Os blocos principais são .enterprise/.specs (482 variantes), src/hsm (202), .enterprise/governance (85), .goose/skills (53) e .agents/skills (33).
- Nas 10 amostras, as variantes hseos continuam todas presentes (7495 e 890 têm uma única variante hseos, e o conflito delas vem da variante srm).
- Limite do confronto: ele só prova que o texto ainda existe. Não prova que o verbo modal atual é o mesmo, e não cobre texto novo (ADR-0046, waves recentes) que a base de 14/09 nunca viu.
- ADR-0046 trata de bindings de plataforma, modos de adoção e autoridade do contrato ECP. Não mexe nas regras de segredo, push ou terraform das amostras, mas introduz vocabulário de "modos" que pode ser lido como modalidade se o relatório for regenerado.

### Proposta

1. Não tratar as 305 como defeitos de governança. Mesmo as de 289 que continuam aplicáveis são, nas amostras, a mesma regra enunciada em polaridades ou formas diferentes (proibição vs. obrigação, ou prosa informativa vs. diretiva). O próprio report_canonical.py diz que nenhuma contradição real foi confirmada.
2. Triagem em três baldes, todos na camada de análise (a base é externa e não deve ser regenerada por este agente):
   a. 103 MUST x MUST_NOT: tratar como falso positivo de polaridade. Mudança sugerida, a decidir por quem mantém a base: normalizar a polaridade antes de comparar modais (MUST de "usar X" e MUST_NOT de "não usar Y" da mesma regra não divergem).
   b. 163 com INFORMATIVE: o modal fraco costuma ser exemplo, tabela ou rationale ao lado da regra. Excluir INFORMATIVE da comparação, ou rebaixar a divergência a aviso.
   c. 39 outros (SHOULD x MUST etc.): revisão manual. Esse é o único balde que pode ser uma divergência real de força normativa. O próximo passo concreto é listar esse balde por locator e revisá-lo.
3. Para cada item do balde (c) que sobrar, o dono do arquivo ajusta o texto para o modal certo, ou registra a exceção. Isso entra no repo hseos só depois de confirmação com o texto atual e com a regra da hierarquia (AGENTS.md prevalece).
4. Se for preciso um número confiável no repo, regenerar o snapshot da base (por quem tem a posse dela) depois do ajuste de polaridade. Assim os números pós ADR-0046 ficam comparáveis.
5. Registrar a decisão como nota ou ADR curta só se o mantenedor da base aceitar mudar a heurística. Enquanto isso, a base não é fonte de verdade para gate de governança.

**Confiança:** Alta para as contagens (352 / 305 / composição por fonte) e para o mecanismo de cálculo, lidos direto da base e do código. Média para a taxa de 95% de aplicabilidade, porque ela é só presença de texto e de arquivo, sem recomparar o modal. Os baldes de triagem foram classificados pelas strings de modalidade, e só as amostras tiveram leitura caso a caso.

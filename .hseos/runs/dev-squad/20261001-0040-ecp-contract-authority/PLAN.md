> **G2 — Plan approval: APPROVED** pelo owner em 2026-10-01 (aprovação explícita do plano em sessão).
> Run-id: `20261001-0040-ecp-contract-authority`. Commander: SWARM (Opus). Fonte: plano de sessão aprovado.
>
> **Branch map**
> - HSEOS: `master` → `feature/platform-bindings-w0` (W0) → links seguintes declarados em STATUS.md.
> - ECP: `develop` → `feature/contract-authority-w0` (W0). ECP não usa `worktree-manager.sh`; segue `task/<id>` + 1 commit + merge `--no-ff` no `feature/*`, conforme `ECP/AGENTS.md`.
>
> **W0 task DAG (Commander, sequencial)**
> | Task | Repo | Branch | Entrega |
> |---|---|---|---|
> | E0.1 | ECP | `task/0042-contract-authority-adr` | intent `docs/intents/0042-contract-authority-governance.md` + ADR 0006 |
> | E0.2 | ECP | `task/0042b-design-system-authority-adr` | ADR 0007 (Proposed; 0002/0003 seguem em vigor) |
> | E0.3 | ECP | `task/0042c-configurable-author-adr` | ADR 0008 |
> | E0.4 | ECP | `task/0042d-contract-schemas-v2` | `contracts/capability.contract.v2.schema.json`, `implementations.schema.json`, `capability-registry.schema.json` |
> | H0.1 | HSEOS | `task/w0-adr-0046` | ADR-0046 + `_INDEX.md` |
> | H0.2 | HSEOS | `task/w0-bindings-schema` | `.enterprise/governance/capabilities/schemas/platform-bindings.schema.json` |
> | H0.3 | HSEOS | `task/w0-run-dir` | run-dir deste SWARM (INTAKE/PLAN/STATUS/WAVE-0-REPORT) |
>
> Gate de saída da W0: revisão cética isolada + **aceitação humana das ADRs** antes de qualquer task da W1.

# Plano — Capability Contracts: ECP como autoridade, cores como projeções, HSEOS com bindings habilitáveis

> Planejado em Opus (Commander). Execução em Sonnet via dev-squad/SWARM. Repositórios:
> ECP = `/workspace/github/hideaki-solutions/enterprise-capability-platform` (org GitHub `HideakiSolutions`),
> CORES = `/workspace/github/hideaki-solutions-core/{platform-core,backend-core,frontend-core,mobile-core,design-system-core}` (org `Hideaki-Solutions-Core`),
> HSEOS = `/workspace/github/marciohideaki/enterprise-hseos`.
> Este plano vai até um estado final coerente (W0–W3: autoridade, registro, modos, 3 pilotos). Migração em massa e design system são **Fase 2** (plano próprio, ver final).

## Context

Hoje existem três vocabulários de capability sem mapeamento: ECP (`auth.authenticate`), cores
(`Security.Authn` + `$id` `platform-core/auth/auth-provider`) e grafo HSEOS (`auth`, `contract.*`). Verificado:

- `hseos capability-check` casa substring de nome de arquivo e não enxerga os cores (espera `<ws>/cores/<repo>`; layout real é plano; `walk()` ignora symlinks). `cambio-real-v3` reimplementa Redis/Auth (zero `Hideakisolutions.Platform.*`) sem detecção.
- ECP: sem registro machine-readable, sem versão contrato×implementação, sem gate de compatibilidade; validador por substring; `registry.py:24` é parser de linha (já lê `exposure:` errado); `schema.py` só cobre `type/required/properties/additionalProperties/enum/min/max`; ~45 caminhos `/opt/hideakisolutions`; autor fixo `@hideakisolutions.local`.
- Cores: `platform-capabilities.manifest.json` e ADR-0001..0004 do workspace **não existem em disco** (só no vault; 78 ponteiros pendurados). Conformance faz *skip silencioso* em CI. Nenhum pacote carimba versão de contrato. `Caching.*` não tem contrato. `$ref` entre schemas por `$id` (ex.: `backend-core/api/pagination`).
- HSEOS: sem camada de config de usuário nem de bindings; pins do registry federado fora de `main`; **ADR-0036 (Accepted) nomeia Platform Core como fonte neutra de contratos** e já especifica diff estrutural contra baseline com SHA-256 — precisa ser emendada, não ignorada.

### Decisões do usuário (2026-10-01)
1. **ECP é a autoridade única de contratos**, inclusive visuais.
2. **Separar por tipo**: `kind: service` (integração com provedor externo — uma vez no runtime ECP + SDK fino por stack) e `kind: library` (primitivo in-process — biblioteca por stack nos cores, aprovada pela mesma suíte de conformidade).
3. **Opt-out habilitável**: modo por projeto `platform | hybrid | local` na instalação, com override por capability (`keep-local`/`exception`).
4. **Execução via dev-squad/SWARM.**
5. **Sem atribuição a ferramentas de IA** em commits/PRs (ECP, cores, HSEOS); **autor git configurável**.

## Modelo-alvo

```
ECP (autoridade)                          CORES (projeções)                     HSEOS (aplicação)
capabilities/<id>/capability.yaml  ◄──── contracts/vendor/ecp/<ver>/ (vendorizado) platform-bindings (camadas)
  schema.*.json, conformance/{valid,      ecp-contracts.lock.json (ver+ref+sha)    snapshot do registro ECP
  invalid}/*.json, implementations.json   conformance por $id (store), fail-closed  capability-check / guard por modo
catalog/capability-registry.json ──────► ponteiros = implementations.json   ──►    ecp-registry.snapshot.json (+sha)
bundle contracts-vX.Y.Z (+SHA256SUMS)
```

- **Id canônico** = nome pontuado ECP (`cache.typed`, `security.authn`, `messaging.event-envelope`, `auth.authenticate`). Ids antigos (`$id` dos cores, `auth`/`contract.*` do grafo HSEOS) viram `aliases` no registro.
- **Perfil de palavras-chave de contrato**: schemas de contrato só podem usar `type, required, properties, additionalProperties, enum, const, pattern, items, $ref (local e por $id), oneOf, anyOf, min*/max*`; o validador ECP rejeita o resto. Garante veredito idêntico em ECP (stdlib), ajv, JsonSchema.Net, jsonschema (Python) e Go.
- **Versionamento**: semver em `capability.yaml` (fonte única; openapi/asyncapi/mcp checados). Contrato novo = inicial (sem bump). Em `0.x`, breaking exige bump MINOR; em `≥1.0`, MAJOR com versão paralela e sunset (`Deprecation & Sunset Policy`). Pacotes declaram o `contract_version` implementado.
- **Stubs depreciados** (ids antigos): `{"$id": "<antigo>", "$ref": "<novo $id>", "deprecated": true, "x-superseded-by": "<id>@<ver>"}` — continuam validando consumidores e `$ref` existentes.

### Semântica dos modos (HSEOS)
| Modo | capability-check | intake guard | intake obrigatório |
|---|---|---|---|
| `platform` | resolve pelo snapshot do registro; veredito `consume`/`extend` | bloqueia export compartilhável sem intake (**comportamento atual**) | sim |
| `hybrid` | idem | bloqueia só se o export casa `match{symbols,path_globs,packages}` de uma entrada com `implementations[<stack>].status == stable`; resto advisory | só nesses casos |
| `local` | informativo | não bloqueia | não |

- **Retrocompatibilidade**: projeto sem `.hseos/config/platform-bindings.yaml` = `platform` com a decisão de hoje (não herda defaults do runtime). Arquivo inválido = `platform` + mensagem apontando o erro de parse. `CORE_INTAKE_ACK` em `docs/decisions/*intake*.md` continua válido; `intake_ref` usa o mesmo resolvedor.
- **Stack** detectada por marcadores determinísticos (`*.csproj`, `package.json`, `pyproject.toml`, `go.mod`); decisão só com o snapshot fixado — offline, sem rede no hook, dentro do timeout de 5s.
- **Antes de haver contratos `stable`** (Fase 2), `hybrid` ≈ `local` + avisos — documentado na ADR.
- **Anti-downgrade**: `local` ou modo mais fraco exige `mode_ref` (registro de decisão). Camadas usuário/env/flag só podem **endurecer** o modo, salvo flag com motivo registrado. Edição de `platform-bindings.yaml` por agente é bloqueada (arquivo protegido, só humano). `capability-check --json` reporta modo efetivo e origem.
- Override `keep-local`/`exception` exige `intake_ref`/`exception_ref` existente e `expires` não vencido (fail-closed). Regras globais (infra shared §3a, segredos §3c) valem em qualquer modo.
- **Hook sem node/CLI**: mantém o fail-open atual (como hoje sem `jq`), registrado na ADR-0046.

### Camadas de config (precedência crescente; ver anti-downgrade)
1. **runtime** — `.enterprise/governance/capabilities/platform-bindings.defaults.yaml` + `ecp-registry.snapshot.json` (`source_ref` + sha256) na distribuição global (offline).
2. **usuário/org** — `${XDG_CONFIG_HOME:-~/.config}/hseos/platform-bindings.yaml` ou `HSEOS_PLATFORM_BINDINGS` (opcional; `ecp_root`, `cores_root` para dev; ADR-0006 P5: só lido se existir).
3. **projeto** — `.hseos/config/platform-bindings.yaml` (versionado; sem caminhos absolutos).
4. **flag** — `--platform-mode`, `--platform-binding <cap>=keep-local:<intake-id>`, `--mode-ref`.
- Remoto (`uri`+`ref`) só via `hseos platform-bindings sync` explícito, que verifica sha; nunca em hook.

## Waves e gates

```
W0 ─gate ADRs─► W1(ECP) ─gate tag contracts-v0.2.0─► W2a(ECP pilotos) ─gate v0.3.0─► W3(cores adoção)
                         └──────────────► W2b(HSEOS, fixture) ───────────────────────► integra snapshot v0.3.0
                         └──────────────► W2c(cores resolvedor, valida contra fixture/v0.2.0)
```
Cada wave = 1 PR por repositório tocado.

### W0 — Governança e schemas (Commander/Opus, sequencial; gate humano)
- **ECP `documentation/decisions/0006-contract-authority-and-kinds.md`**: autoridade única; kinds; id + aliases; perfil de keywords; regras semver (0.x/≥1.0, contrato inicial); vendorização em consumidores; stubs. Reproduz o texto da ADR-0002 do workspace (só no vault) para rastreabilidade.
- **ECP `0007-design-system-contract-authority.md`**: Proposed; 0002/0003 do ECP **seguem em vigor até a Fase 2**.
- **ECP `0008-configurable-author-identity.md`**.
- **HSEOS `ADR-0046-platform-bindings-and-modes.md`** (via `_TEMPLATE.md`; atualiza `_INDEX.md`): emenda/supersede a cláusula "Platform Core como fonte neutra" da **ADR-0036** e o vocabulário de contract nodes da **ADR-0033** (alias para ids ECP); define modos, retrocompatibilidade, anti-downgrade, fail-open sem CLI, snapshot; relação com o gate pendente de schema 2.0/intake v3 (não ativa esse gate). Reconcilia o diff estrutural+SHA da ADR-0036 com o `check_compat.py` do ECP.
- **Schemas** (contract-first): `ECP/contracts/capability.contract.schema.json` v2 (`kind`, `aliases`, `deprecation{since,sunset,replaced_by}`, `match`), `ECP/contracts/implementations.schema.json`, `ECP/contracts/capability-registry.schema.json`, `HSEOS/.enterprise/governance/capabilities/schemas/platform-bindings.schema.json`.
- **Gate**: usuário aceita as ADRs antes de W1 (dois ADRs Accepted com autoridades diferentes = parar, AGENTS.md §1).

### W1 — Fundação ECP (ordem: T0 → T1 → T2 → (T3 ∥ T5); T4 em PR separada, fora do caminho crítico)
- **T0 Loader YAML restrito** (stdlib): substitui `parse_capability_yaml` em `runtimes/python/ecp_runtime/registry.py` por gramática definida (mapas aninhados, listas de escalares e de mapas, escalares entre aspas), com testes próprios; corrige o mis-parse de `exposure`. Arquivos novos machine-readable em JSON (`implementations.json`, vetores).
- **T1 Validador real**: `runtimes/python/ecp_runtime/schema.py` cobre o perfil (+`pattern`, `items`, `$ref` local/por `$id`, `const`, `oneOf/anyOf`) e rejeita keywords fora dele; `scripts/governance/validate_contracts.py` aplica o meta-schema v2, `$ref`, coerência de providers (`capability.yaml` × `providers.toml` × `dispatch.PROVIDER_INVOKERS`) e versão única nos 4 arquivos. Migra os 9 `capability.yaml` para v2 (`kind: service`); `compatibility:` → `implementations.json`.
- **T2 Registro**: `generate_registry.py` (via `CapabilityRegistry`) emite `catalog/capability-registry.json` (id, kind, version, stability, deprecation, aliases, match, arquivos+sha256, implementações, conformance), caminhos relativos. **Dono único do `ci.yml`**: job de drift (gera em tmp e compara).
- **T3 Gate de compatibilidade** `scripts/governance/check_compat.py` (stdlib): `--base <ref>` via `git show`, CI com `fetch-depth: 0`; regras semver acima; `experimental` não é isento salvo cláusula explícita na ADR 0006.
- **T5 Bundle**: `capabilities/<id>/conformance/{valid,invalid}/`; `scripts/release/build_contract_bundle.py` (schemas + vetores + registro + `SHA256SUMS`); workflow `contracts-release.yml` em tag `contracts-v*` (publicação só via `workflow_dispatch` + aprovação humana).
- **T4 Portabilidade + autor** (PR própria): `[tool.ecp] workspace_root`/`ECP_WORKSPACE_ROOT` no lugar de `/opt/hideakisolutions` (Makefile, `pyproject.toml`, `catalog_repositories.py`, `internal_mcp.py`, yamls do design-system, testes); manifests gerados relativos; `test_sdk_generation.py` sem contagem fixa e sem mutar a árvore. Autor: `[tool.ecp.governance] allowed_author_pattern` / `ECP_ALLOWED_AUTHOR_PATTERN` (default = padrão atual); denylist de identidades de IA intacta.

### W2a — ECP: contratos piloto (`kind: library`) → tag `contracts-v0.3.0`
- `cache.typed` (novo; base `backend-core/dotnet/src/Hideakisolutions.Platform.Caching.Abstractions/CacheContracts.cs`), `security.authn` (de `backend-core/security/contracts/auth-middleware` + `platform-core/auth/auth-provider`), `messaging.event-envelope` (de `platform-core/messaging/contracts/event-envelope.schema.json`). Aliases para `$id` antigos e ids do grafo HSEOS; `match` preenchido; `auth.authenticate` (service) declara relação com `security.authn`.

### W2b — HSEOS: bindings (contra fixture de registro; ordem interna serial)
1. `tools/cli/lib/capability-catalog.js`: exportar `assertObject`, `assertExactKeys`, `assertStringList`, `readYaml`; gravar bindings no staging de `materializeCapabilityPlan` e junto de `writeCapabilitySelection` (~l.587–631).
2. `tools/cli/lib/platform-bindings.js` (novo): `loadPlatformBindings({runtimeRoot, projectDir, env, flags})`, merge com anti-downgrade, validação fail-closed, `safeResolve` (de `scripts/governance/validate-capability-graph.js`), escrita staging+rename.
3. `tools/cli/lib/capability-registry.js` (novo): carrega snapshot (sha conferido) ou `ecp_root` do usuário; resolve id > alias > pacote/contrato > `match` > prefixo; substring só como fallback `heuristic`.
4. Comando `hseos platform-bindings` (`--guard <file>`, `show`, `sync`) registrado no manifesto CLI.
5. `init.js` (prompt de modo após perfil, `--mode-ref` quando `local`/rebaixamento, linha no `summarizePlan`); `install.js` (flags, allow-list do caminho mínimo ~l.56, gravação ~l.150); `install-plan.js` (bindings efetivos).
6. `capability-check.js`: registro + bindings, `--json` com modo/origem; walk secundário corrigido (layout plano, symlinks com realpath + visited-set).
7. Guard `.enterprise/governance/hooks/handlers/capability-intake-guard.sh`: resolve CLI como os outros handlers (local `tools/cli/hseos-cli.js`, senão `hseos` no PATH) → `hseos platform-bindings --guard`; sem rede; fail-open sem CLI. Proteção de `platform-bindings.yaml` contra edição por agente.
8. Defaults + `ecp-registry.snapshot.json` (fixture até v0.3.0) + teste de superfície do pacote (ADR-0029) + job de drift snapshot × ref ECP fixado.
9. Regeneração única ao final: `.agents/` (`npm run hseos:install`), `.claude/hooks.json`, `.codex/hseos-hooks.json`, `tools/cli/command-manifest.json` (`npm run compile:cli`).
- Policies: `capability-reuse.md` (modos; remove escopo `/opt/hideakisolutions/**`; autoridade ECP), `capability-graph.md` (fonte ECP), `.enterprise/governance/capabilities/README.md`, `docs/capabilities.md`, `docs/getting-started.md`, `docs/pt-br/primeiros-passos.md`, skill `capability-check`. Mudança no `Platform Capability Governance Standard` (shard `core`) = **PR separada com gate de Engineering Leadership**.

### W2c — CORES: resolvedor (backend-core; valida contra fixture/v0.2.0)
- Vendorização: `contracts/vendor/ecp/<ver>/` + `ecp-contracts.lock.json` (versão, ref, sha256) + script de sync que abre PR; CI só confere sha (sem token entre orgs, offline, desacoplado do gate de publicação).
- Resolvedor **dual-source** com store por `$id` + aliases: bundle ECP para ids migrados; snapshot fixado de platform-core para os demais (até a Fase 2). Helpers: `dotnet/tests/Hideakisolutions.Platform.Conformance.Tests/SchemaLocator.cs`, `node/src/_schema.ts`, `python/tests/_schema.py`, `golang/internal/schematest`.
- **Fail-closed com `CI=true`** para toda fonte presente no lock (remove `Assert.True(true)`/`skip`).

### W3 — Adoção nos cores (pilotos, após `contracts-v0.3.0`)
- backend-core: conformance dos pilotos contra vetores ECP vendorizados; carimbo de versão (`AssemblyMetadata("PlatformContract","cache.typed@0.3.0")` via `Directory.Build.props`; campo em package.json/pyproject; const Go).
- Ponteiros (`.platform-capability.json`, `PLATFORM-CAPABILITY.md`, `platformCapability`) apontam id+versão ECP; criar os ausentes (`Caching.Redis`, `Caching.Abstractions`, `Security.Authn`); checagem ponteiro × `implementations.json` em cada core.
- ECP: `implementations.json` dos pilotos com pacotes reais. Cores: schemas antigos dos pilotos → stubs `$ref`; `validate-contracts.mjs` aceita stubs.
- HSEOS: snapshot atualizado para `contracts-v0.3.0`.

## Fase 2 (plano próprio, após ≥1 release de bundle com pilotos verdes em CI)
- Migração em massa (platform-core 22, backend-core 7, mobile-core 4, frontend-core 2) com tabela de mapeamento e stubs.
- Design system (tokens, temas, ~40 componentes) → ECP; ADR 0007 Accepted; frontend-core `sync-snapshot.mjs` lê o bundle; CI do design-system-core sem `|| true`.
- Federação HSEOS: fonte ECP no `registry.yaml`, pins corrigidos + **check de alcançabilidade dos pins em `main`** no CI, `reference-corpus.json` alinhado.
- SDKs tipados .NET/Java/Go no ECP.

## Fora de escopo
Migrar `cambio-real-v3` ou outros produtos (só verificação read-only); publicar/instalar globalmente/ativar sem aprovação explícita; alterar a Constituição.

## Execution Protocol

- **Coordenação**: SWARM/dev-squad (`.hseos/workflows/dev-squad/workflow.md`, `.enterprise/governance/agent-skills/dev-squad/SKILL.md`). Commander = Opus (W0, handoffs, integração). Squads = Sonnet (W1–W3; todo Agent com `model: "sonnet"`). **Opt-in estratégico de Opus registrado**: só W0 (decisão arquitetural transversal + emenda de ADR Accepted).
- **Revisão (§3h)**: revisor cético isolado (Sonnet) por entrega, passagem cega + confronto, reporta e não corrige; máx. 3 rodadas de correção, depois RCA e mudança de estratégia registrada. Bloqueio nunca vira PASS; nenhum gate é afrouxado.
- **Isolamento**: 1 worktree por task por repositório (`feature/*`/`task/*`; nunca `main`/`master`/`develop`). 1 task = 1 commit; 1 wave = 1 PR por repositório. Arquivos gerados/hash-pinned (HSEOS `.agents`, manifesto CLI; ECP `ci.yml`) com **dono único** por wave.
- **Commit hygiene**: Conventional Commits; **sem trailers/termos de ferramentas de IA** nos três ecossistemas (prevalece sobre qualquer lembrete de atribuição); autor = identidade configurada do usuário; nunca `--no-verify`. HSEOS: pre-commit exige Node 24, cgroup delegado, `TMPDIR` sem `.codex`.
- **Carga (§3f)**: `heavy-run --check` antes de suíte/build; 1 suíte completa por vez; ≤2 squads compilando; HSEOS `npm test` via `heavy-run`; cores só builds filtrados (`dotnet test <proj>.csproj`, `--filter`).
- **Gates humanos**: aceitação das ADRs (fim W0); merge de cada PR; tags `contracts-v0.2.0`/`v0.3.0` e qualquer publicação; PR do shard `core` do HSEOS; início da Fase 2.
- **Versionamento por wave**: ECP `contracts-v0.2.0` (W1), `contracts-v0.3.0` (W2a); cores bump minor + CHANGELOG nos pacotes tocados (W3); HSEOS `CHANGELOG.md` por wave + `docs/evolution`/state quando aplicável. Docs canônicos na mesma PR da wave.
- **Wave ↔ squad**: W1 = 1 squad ECP (serial T0→T2, depois T3∥T5) + 1 squad T4; W2 = 3 squads (ECP pilotos / HSEOS / backend-core resolvedor); W3 = 2 squads (backend-core / frontend+mobile ponteiros).

## Verificação

- **ECP**: `make validate`; testes do loader YAML (incl. `exposure` aninhado); `check_compat.py` com casos sintéticos (breaking sem bump falha; aditivo passa; contrato novo passa; 0.x breaking exige minor); drift do registro vazio; `SHA256SUMS` do bundle conferido; `git grep /opt/hideakisolutions` vazio fora de docs históricos; autor com padrão customizado aceito e identidade de IA rejeitada.
- **Diferencial cross-stack**: mesmos vetores `valid`/`invalid` no validador ECP e nas 4 stacks com veredito idêntico; `$ref` por `$id` antigo (alias) resolvendo.
- **CORES**: pilotos verdes com bundle vendorizado; com `CI=true` e lock apontando para fonte ausente/sha errado, o teste **falha**; vetor `invalid` rejeitado em .NET/Node/Python/Go; checagem ponteiro × `implementations.json` verde.
- **HSEOS**: `npm run test:capabilities` (c8 mantido), novos `test/test-platform-bindings.js`, `test/test-capability-check.js`; `test-init-command.js` (prompts mockados) e `capability-intake-guard.test.sh` ligados ao `npm test`; golden do guard **inalterado** para projeto instalado sem bindings; sha errado no snapshot falha; downgrade sem `mode_ref` rejeitado; guard <5s e sem rede; smoke standalone (ADR-0006 P5) da camada de usuário; `npm run check:cli`; recompilação `.agents` sem diff.
- **Ponta a ponta (fixture descartável)**: `hseos install --platform-mode {platform,hybrid,local} [--mode-ref …]` em diretório temporário → `platform-bindings.yaml` correto; guard bloqueia/aconselha/libera conforme modo; `keep-local` sem intake válido rejeitado.
- **Read-only no V3**: `hseos capability-check Redis --directory /workspace/github/cambio-real/cambio-real-v3 --json` lista `cache.typed` → `Hideakisolutions.Platform.Caching.Redis` com modo efetivo `platform` (sem bindings); `Authn`/`Jwt`/`Login` resolvem `security.authn` via alias; duas execuções idênticas.

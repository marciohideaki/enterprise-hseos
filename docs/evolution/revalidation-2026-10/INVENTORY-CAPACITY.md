# A2b — Análise de capacidade do inventário do pacote npm (revalidação 2026-10)

Escopo: tarball `/tmp/hseos-reval/pack/hseos-4.0.0-rc.0.tgz` (1472 entradas, 9.704.156 bytes descompactados), checkout de leitura `.worktrees/core-revalidation` (master 4a95592b). Nada foi editado no repositório; nenhuma suíte, build ou `npm test` foi executado.

## 1. Conclusão em uma página

1. O teto 1472 reflete uso real: não há "gordura" relevante. O peso morto verificável soma **17 arquivos certos (+2 incertos)**, ou seja, ~1,2% do pacote. Remover esses arquivos é legítimo, mas não muda a escala do problema.
2. O espelho `.agents` ↔ `.enterprise` custa **165 arquivos (11,2%)**: 60 não-skill + 105 de skills compiladas. Por decisão do owner, o espelho fica. Não foi proposto nenhum artifício para escondê-lo da contagem.
3. A causa do aperto é crescimento legítimo: ~+157 arquivos em 41 dias (1312 em 24/08 → 1469 em 04/10 pelo `git ls-tree`, equivalente ao pack menos 3 arquivos de raiz). Cada onda recente rendeu +50 a +90.
4. Para W5, a projeção do **core** é +47 a +72 arquivos (central ~60). Browser (Playwright) e computer-use (Xvfb) pertencem a pacotes de plugin por mérito (dependência pesada/opcional, binários de sistema, ciclo de release próprio). Isso tira ~12–20 arquivos do core, mas o motivo é arquitetural, não contagem.
5. **Teto recomendado para W5: 1540** (base 1455 após remoções legítimas + 72 no cenário alto + ~11 de contingência). Sem as remoções, o equivalente seria 1557.
6. Governança: manter o teto absoluto como sentinela anti-vazamento, mas **adicionar orçamento por área** e **apertar o limite de bytes** (22 MB atual contra 9,7 MB reais; sugerido 12 MB). Detalhes na seção 7.

## 2. Método e comandos

Todos os comandos foram leves (leitura, `tar`, `node -e`, `grep`).

```bash
# lista e extração (diretório novo e vazio, conteúdo tratado como não confiável)
node -e 'const p=require("/tmp/hseos-reval/pack/pack.json");console.log((p[0]||p).files.length)'   # 1472
mkdir -p /tmp/hseos-reval/x && cd /tmp/hseos-reval/x && tar -xzf ../pack/hseos-4.0.0-rc.0.tgz
# composição por topo/categoria e duplicação por sha256
node /tmp/hseos-reval/comp.js /tmp/hseos-reval/x/package     # saída em dups.json
# consumidores: grep literal no checkout (exclui node_modules, .git, .axon, .worktrees, runs, state, CHANGELOG, docs/evolution, _graph)
/tmp/hseos-reval/refs.sh "<padrão>"                          # BYPASS_AXON=1 grep -rIlF
# crescimento histórico
git -c core.quotepath=off ls-tree -r --name-only <rev> | grep -E '<globs de "files">' | wc -l
```

Limitações declaradas: o grep é textual. Carregamento dinâmico (caminho montado em runtime, `glob`, `readdir`) pode escapar. Por isso, ausência de referência textual é marcada "remover" apenas quando o arquivo é de natureza claramente mantenedor/estado ou o código que o carregaria é guardado por `pathExists`; os demais ficam "incerto". O índice axon não foi usado (grep literal bastou e o escopo exigia strings de caminho).

## 3. Composição das 1472 entradas

Por diretório de topo (a soma bate com 1472):

| Topo           | Arquivos |       KB | Observação                                                                                         |
| -------------- | -------: | -------: | -------------------------------------------------------------------------------------------------- |
| `.enterprise/` |      450 |     2694 | `.specs` 180, `governance` 188, `agents` 31, `policies` 16, `tooling` 12, `playbooks` 9, demais 14 |
| `tools/`       |      382 |     3091 | `cli` 210, `managed-governance-control-plane` 52, `mcp-*` 62, `lib` 28                             |
| `src/`         |      245 |     1443 | `hsm` 205, `core` 28, `utility` 12                                                                 |
| `.agents/`     |      186 |      909 | `skills` 105, `hooks` 29, `plugins` 17, `capabilities` 15, demais 20                               |
| `packages/`    |      112 |      838 | 18 pacotes, média 6,2 arquivos                                                                     |
| `.hseos/`      |       64 |      146 | `workflows` 41, `agents` 15, demais 8                                                              |
| `scripts/`     |       19 |      160 |                                                                                                    |
| `docs/`        |        7 |       80 |                                                                                                    |
| raiz           |        7 |      115 | AGENTS, CLAUDE, CHANGELOG, SECURITY, LICENSE, README, package.json                                 |
| **Total**      | **1472** | **9475** | 9.704.156 bytes                                                                                    |

Por topo × categoria (categoria por extensão/caminho; "template" = caminho com `templates/`; "outros" = `.sql`, `.xml`, `.txt`, `.ps1`, `.html`, `.css`, `.gitkeep`, `.jsonl`, `LICENSE`):

| Topo          | Código (js/cjs/mjs/sh) | Markdown | Schemas/JSON/YAML | Template | Python | Asset | Outros |     Soma |
| ------------- | ---------------------: | -------: | ----------------: | -------: | -----: | ----: | -----: | -------: |
| raiz          |                      0 |        5 |                 1 |        0 |      0 |     0 |      1 |        7 |
| `.agents`     |                     28 |      119 |                39 |        0 |      0 |     0 |      0 |      186 |
| `.enterprise` |                     28 |      381 |                25 |        1 |      0 |     1 |     14 |      450 |
| `.hseos`      |                      0 |       41 |                20 |        0 |      0 |     0 |      3 |       64 |
| `docs`        |                      0 |        7 |                 0 |        0 |      0 |     0 |      0 |        7 |
| `packages`    |                     70 |       18 |                19 |        0 |      5 |     0 |      0 |      112 |
| `scripts`     |                     19 |        0 |                 0 |        0 |      0 |     0 |      0 |       19 |
| `src`         |                      0 |      173 |                41 |       10 |      0 |     0 |     21 |      245 |
| `tools`       |                    304 |        8 |                 8 |       31 |      3 |     0 |     28 |      382 |
| **Total**     |                **449** |  **752** |           **153** |   **43** |  **8** | **1** | **67** | **1472** |

Leitura: 51% do pacote é Markdown (specs normativas, skills, workflows e instruções, que são o produto de governança), 30% é código executável (js/sh/py = 457), e o restante é dado e configuração. Código de runtime em sentido estrito (`tools`+`packages`+`scripts`+`.agents`/`.enterprise` handlers) é cerca de 450 arquivos.

### Espelho compilado (.agents ↔ .enterprise ↔ .hseos)

| Relação                                                                                   |               Arquivos | Evidência                                                                       |
| ----------------------------------------------------------------------------------------- | ---------------------: | ------------------------------------------------------------------------------- |
| `.agents` idêntico (sha256) a `.enterprise/governance/*`                                  |                    112 | capabilities 15, hooks/handlers 29, plugins 17, QUICK de skills 52              |
| `.agents/skills/*/SKILL.md` com contraparte transformada (front-matter reescrito)         |                 51 + 2 | `diff` de `ado-ops/SKILL.md`: metadados achatados, `source`/`quick` adicionados |
| `.agents` sem contraparte (manifest, activation, adapters, instructions, mcp, registries) |                     21 | únicos                                                                          |
| Total de `.agents` com contraparte canônica em `.enterprise`                              | **165 de 186 (11,2%)** | 60 não-skill + 105 skills                                                       |

Mapeamento de skills: `.enterprise/governance/agent-skills/<grupo>/<nome>/SKILL-QUICK.md` vira `.agents/skills/<grupo>-<nome>/QUICK.md` (slug achatado), por isso um diff ingênuo por caminho acusa 4 "sem contraparte". Não há órfãos.

Outros espelhos: `.hseos/workflows/{delivery-readiness,kube-deploy,release-publish,runtime-deploy}/workflow.md` são idênticos a `src/hsm/workflows/*` (4 arquivos). `.enterprise/governance/autonomy/scope-pilot-n1.txt` é idêntico a `.hseos/loops/pilot-n1/scope.txt`.

## 4. Duplicações por conteúdo (sha256)

122 grupos, **126 arquivos excedentes, 420.090 bytes (4,3% dos bytes)**.

| Par de topos              | Grupos | Excedentes | Natureza                                                                                    |
| ------------------------- | -----: | ---------: | ------------------------------------------------------------------------------------------- |
| `.agents` + `.enterprise` |    112 |        112 | espelho do compilador (seção 3)                                                             |
| `.enterprise` + `tools`   |      1 |          5 | `.gitkeep` vazios (5 caminhos, 0 bytes)                                                     |
| `.hseos` + `src`          |      4 |          4 | workflows `hsm`                                                                             |
| `tools`                   |      4 |          4 | templates `claude-*` = `default-*` (3) e `opencode-workflow` = `opencode-workflow-yaml` (1) |
| `.enterprise` + `.hseos`  |      1 |          1 | `scope-pilot-n1.txt`                                                                        |

Observações:

- Os 5 `.gitkeep` entram no grupo vazio; só o de `templates/split/` mais os 4 de `.specs/` estão no pacote (ver R1).
- `opencode-workflow.md` e `opencode-workflow-yaml.md` são lidos por nome de artefato (`${templateType}-${artifactType}`, `_config-driven.js:~281`). São distintos para o loader, apesar de iguais em conteúdo: **manter**.
- Os `claude-*` idem por nome, mas nenhuma plataforma usa `template_type: claude` (ver C1).

## 5. Quem lê cada lado do espelho

Evidências no código (não suposição):

- O compilador lê a fonte **canônica** `.enterprise/governance/{capabilities,hooks,plugins,agent-skills}` e escreve em `.agents/` do projeto-alvo. O `.agents/` do pacote só serve de fallback "legacy" (`capabilities-source.js:62-84`, `plugins-source.js:163-181`, `hooks-source.js` cabeçalho, `index.js:72-97`).
- O instalador copia o overlay `.enterprise/` inteiro do pacote para o consumidor (`installer.js:3722 installEnterpriseOverlay`) e `.hseos/workflows` (`installGovernanceWorkflowOverlay`). Logo `.enterprise` e `.hseos/workflows` são conteúdo de produto entregue.
- `tools/cli/lib/capability-catalog.js` lê, a partir da raiz do pacote (`getProjectRoot()`): `.agents/manifest.yaml`, `.agents/adapters` e `.agents/skills/*` (linhas 332-349, 370-381) para montar componentes sintéticos de skill do plano de instalação. **`.agents/skills` e `.agents/manifest.yaml` são lidos do pacote.**
- Hook global do host aponta direto para `<distribuição>/.agents/hooks/handlers/governance-context.cjs` (visto em `~/.claude/settings.json`). **`.agents/hooks/handlers` do pacote é lido em runtime** (no mínimo `governance-context.cjs` e `governance-context-state.cjs`). O mesmo handler existe em `.enterprise/governance/hooks/handlers` e é `require`d por `tools/cli/commands/governance-context.js:3`. **Os dois lados são lidos.**
- `.agents/capabilities/*` (15): `capabilityPaths()` prefere `canonical` quando perfis/componentes/superfícies existem (sempre, no pacote). O comentário de `test/test-package-surface.js:~114` já registra que o runtime lê só `.enterprise/.../capabilities`; o espelho é mantido por decisão do owner e coberto por `test-capability-catalog.js`. Além disso `test-package-surface.js:67` exige `.agents/capabilities/surfaces.yaml` no pacote.
- `.agents/plugins/*` (17): `tools/cli/commands/plugin.js` lê `.agents/plugins/...` do **projeto consumidor**, não do pacote. Nenhum leitor encontrado a partir da raiz do pacote. **Incerto** (ver C2).
- Handlers `.agents/hooks/handlers/*.sh` (27 além dos 2 `.cjs`): referenciados por caminho relativo no registry (`bash .agents/hooks/handlers/...`), válido no projeto compilado, não no pacote. **Incerto** (C3).

## 6. Candidatos a peso morto

Escopo de busca padrão de todas as linhas abaixo: `grep -rIlF` em todo o checkout (inclui `tools`, `packages`, `scripts`, `src`, `test`, `.agents`, `.hseos`, `.enterprise`, `.github`, `docs`, `package.json`, `eslint.config.mjs`), exceto `node_modules`, `.git`, `.axon`, `.worktrees`, `runs`, `state`, `CHANGELOG.md`, `docs/evolution`, `_graph`. Script: `/tmp/hseos-reval/refs.sh`.

### Remover legitimamente (17 arquivos)

| Id  | Arquivos                                                                                                                         | Evidência                                                                                                                                                                                                                                                                                                         | Efeito |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: |
| R1  | `.gitkeep` em `.enterprise/.specs/{Cpp,Go,Java,PHP}/`                                                                            | diretórios têm 11-12 arquivos reais cada; `grep gitkeep` em `tools packages scripts src test .enterprise/policies` sem hits                                                                                                                                                                                       |     -4 |
| R2  | `tools/cli/installers/lib/ide/templates/split/.gitkeep`                                                                          | o diretório só tem o `.gitkeep`; `_config-driven.js:318-345` lê `split/` sempre protegido por `fs.pathExists`, com fallback vazio                                                                                                                                                                                 |     -1 |
| R3  | `.hseos/loops/pilot-n1/{budget.txt,heartbeat.jsonl,scope.txt}`                                                                   | estado volátil do piloto N1, encerrado em 2026-07-24 (`autonomy/README.md:34`); `loop-guard.sh:25` lê `${REPO_ROOT}/.hseos/loops` do repositório-alvo, não do pacote; as únicas menções ao caminho são docs. O exemplo de allow-list permanece em `.enterprise/governance/autonomy/scope-pilot-n1.txt` (idêntico) |     -3 |
| R4  | `tools/fix-doc-links.js`, `tools/format-workflow-md.js`, `tools/migrate-custom-module-paths.js`, `tools/validate-svg-changes.sh` | zero referências no escopo; utilitários de manutenção herdados (fix-doc-links, workflow formatter, migração "run once", validação de SVG sobre `src/bmm/docs/...` inexistente)                                                                                                                                    |     -4 |
| R5  | `tools/build-docs.mjs`, `tools/validate-doc-links.js`, `tools/validate-file-refs.js`                                             | `build-docs.mjs` importa de `website/`, que não existe no repositório; o próprio `eslint.config.mjs:21-22` o exclui como "standalone tool"; `validate-doc-links.js` só é referenciado por `build-docs.mjs`; `validate-file-refs.js` não tem referência alguma                                                     |     -3 |
| R6  | `tools/docs/fix-refs.md`, `tools/docs/_prompt-external-modules-page.md`                                                          | zero referências; prompts de manutenção (o primeiro traz nota de proveniência: "recuperado de branch deletada")                                                                                                                                                                                                   |     -2 |

Total: 4+1+3+4+3+2 = 17. Mecanismo correto: entradas negativas em `files` (`"!**/.gitkeep"`, `"!tools/build-docs.mjs"`...) ou remoção do arquivo do repositório; ambos legítimos porque nenhum consumidor de runtime foi encontrado. Não constitui "excluir do `files` algo que o runtime precisa". Uma remoção do repositório (R1-R3) deve ser decisão do owner se quiser preservar o histórico; para o pacote basta a exclusão.

### Incerto (decisão do owner; não incluído na base)

| Id  | Arquivos                                                                                                                | Por que incerto                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | `tools/install-all.sh`                                                                                                  | zero referências, mas é script operacional do owner (`ROOT=/opt/hideakisolutions`, vault de second-brain). Pode ser invocado manualmente a partir do pacote instalado. Provável candidato a `!` em `files`, após confirmação (-1)                                           |
| I2  | `tools/benchmarks/session-replay.js`                                                                                    | zero referências; benchmark que exige `better-sqlite3` e `packages/*`. Pode alimentar evidência de desempenho. Confirmar com owner (-1)                                                                                                                                     |
| C1  | `tools/cli/installers/lib/ide/templates/combined/claude-{agent,workflow,workflow-yaml}.md`                              | idênticos a `default-*`; nenhuma plataforma de `platform-codes.yaml` define `template_type: claude` (claude-code usa `default`). Ponto de extensão para configuração custom: não removi (-3 potencial)                                                                      |
| C2  | `.agents/plugins/**` (17, espelho de `.enterprise/governance/plugins`)                                                  | nenhum leitor a partir da raiz do pacote; `plugin.js` lê do projeto consumidor. Sem teste que exija essa metade. Ausência não provada para consumidores externos de `.agents` (hosts que leem o pacote como projeto)                                                        |
| C3  | `.agents/hooks/handlers/*.sh` (27, exceto os dois `.cjs` do hook global)                                                | só têm sentido num projeto compilado; o consumidor os recebe via compilador a partir de `.enterprise`. Contudo, o repositório se autohospeda e `integrity.js` pina hash `.agents` ↔ `.enterprise`; remover exige alterar a verificação de integridade. Sem remoção proposta |
| C4  | `.enterprise/governance/audits/2026-07-22-cybernetic-audit/AUTONOMY-N1-RUNBOOK.md`, `.enterprise/replay-analysis/*` (2) | sem leitor de código; são documentos de governança entregues ao overlay. Valor de produto, não de runtime                                                                                                                                                                   |
| C5  | `.enterprise/modes/replay-mode.active`                                                                                  | placeholder (`Repository A: <identifier-or-url>`) versionado e copiado a todo consumidor pelo overlay. Os `.ps1` tratam esse caminho como flag de modo. Possível defeito de conteúdo, não de peso; fora do escopo, apenas sinalizado                                        |

### Manter (consumidor identificado)

| Área                                                                 | Arquivos | Consumidor                                                                                                                                           |
| -------------------------------------------------------------------- | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.enterprise/.specs` (constituição, core, specs por linguagem, ADRs) |      180 | `governance-context.cjs` (`REQUIRED`, `corpusFingerprint`), doctor                                                                                   |
| `.enterprise/governance/agent-skills`                                |      110 | compilador (`skills-source.js`), `installer.js`                                                                                                      |
| `.enterprise/governance/{capabilities,hooks,plugins}`                |       62 | compilador; `capability-catalog.js` (canonical)                                                                                                      |
| `.agents/skills` + `manifest.yaml` + `adapters`                      |     ~111 | `capability-catalog.js:332-381`                                                                                                                      |
| `.hseos/workflows`, `.hseos/agents`                                  |       56 | overlay de workflows; registry                                                                                                                       |
| `src/hsm` (205), `src/core` (28), `src/utility` (12)                 |      245 | módulo `hsm` e `core` do instalador; `.txt`/`.xml` lidos por compilação de agentes                                                                   |
| `tools/managed-governance-control-plane`                             |       52 | `tools/cli/lib/managed-governance/commands.js:5-17` (require estático) e `output.js:4`                                                               |
| `tools/mcp-*`, `tools/state-ui-server`, `tools/lib`, `packages/*`    | restante | comandos CLI e servidores MCP; ver testes `test:mcp-*`                                                                                               |
| `tools/usage-dashboard` (5, Python)                                  |        5 | referenciado por `install.js`, `installer.js`, `command-manifest.json`                                                                               |
| `scripts/ado-*.sh`, `scripts/social-login/*`                         |        3 | `ado-*` por registry e workflow; `provision-social-idps.sh` por `policies/social-login.md` (documento é o consumidor; script é a execução prescrita) |
| `.enterprise/tooling/*.ps1` (12)                                     |       12 | `quality-gates.sh`; ferramentas Windows do overlay                                                                                                   |

### Observação arquitetural (não é peso morto)

`tools/managed-governance-control-plane` (52 arquivos, ~356 KB, 6 migrações SQL, UI estática, dependência opcional `pg`) é um servidor com ciclo de release próprio e hoje é carregado com `require` estático pela CLI. É o único candidato real a pacote separado no inventário atual, **porém** isso é refatoração com lazy loading e um contrato de distribuição, fora do orçamento de W5. Fica como opção registrada, não como recomendação para escapar do teto.

## 7. Projeção de W5

Calibragem histórica (equivalente ao pack, `git ls-tree`): 24/08 1312 → 05/09 1359 → 27/09 1439 → 30/09 1455 → 04/10 1469. Ondas recentes: +47 (12 d), +80 (22 d), +30 (7 d). Portanto +50 a +90 por onda é o ritmo observado; a projeção abaixo cai dentro dele.

Padrões de custo observados: pacote de runtime médio 6,2 arquivos (agent-context 6, runtime-contracts 10, runtime-providers 13); servidor MCP 7-34; ADR 1 arquivo (49 ADRs hoje); skill nova custa 4 arquivos (SKILL + QUICK em `.enterprise` e em `.agents`); plugin de execução custa 2× (definição em `.enterprise` + espelho).

Estimativa de arquivos novos **enviados** no pacote:

| Item W5                                                                                       |                    Core |                       Pacote de plugin | Racional da colocação                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ----------------------: | -------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema/contrato multimodal + autoridade (`packages/agent-context`, `agent-runtime-contracts`) |        6-11 (3-6 + 3-5) |                                      0 | contrato transversal; todos consomem; sem dependência externa                                                                                                                                                |
| Endurecimento MCP (`tools/mcp-hseos-governance`, `tools/lib/governed-execution`)              |                     3-6 |                                      0 | superfície de segurança do core; não pode depender de instalação opcional                                                                                                                                    |
| LSP (cliente JSON-RPC por stdio + política)                                                   |                     4-6 | 0-3 (bindings por linguagem como dado) | protocolo leve, sem dependência pesada; servidores de linguagem são binários externos                                                                                                                        |
| DAP (depuração)                                                                               |                     4-6 |                                    0-3 | idem; adaptadores de depuração externos                                                                                                                                                                      |
| Memória governada                                                                             |                     5-8 |                                      0 | usa `better-sqlite3` e o ledger já no core; é estado, precisa do mesmo gate                                                                                                                                  |
| Browser (Playwright)                                                                          |    0-1 (porta/política) |                                   6-10 | Playwright e binários de navegador são pesados, com versão acoplada ao navegador e ciclo de release próprio; carregamento sob demanda (`peerDependenciesMeta.optional` + `require` tardio, como o `pg` hoje) |
| Computer-use (Xvfb)                                                                           |                     0-1 |                                   6-10 | dependência de sistema (X11), só Linux, risco e ciclo de segurança próprios                                                                                                                                  |
| Governança por capacidade (ADR 7, políticas/features ~7-10, 3 skills × 4)                     |                   25-35 |                                      0 | conteúdo normativo, entregue no overlay                                                                                                                                                                      |
| **Core (soma)**                                                                               | **47-72 (central ~60)** |                              **12-26** |                                                                                                                                                                                                              |

Pontos de atenção:

- A divisão core/plugin acima segue o critério pedido: só Playwright e Xvfb têm dependência pesada, opcional e com ciclo próprio. LSP, DAP e memória **ficam no core** porque separá-los só deslocaria a contagem sem ganho técnico (sem dependência pesada, sem benefício de lazy loading).
- O mecanismo de plugin de execução (admissão com hash pinado, W4-02a) já existe; os pacotes de browser e computer-use devem usá-lo. Cada definição de plugin catalogada continua custando arquivos no core (`registry.yaml` é edição, não arquivo novo; a definição `plugin.yaml`+README custa 2×2=4 se mantida em `.enterprise` e em `.agents`).
- A faixa é dominada pelo corpus de governança (25-35), não por código. Isso reforça que o crescimento é conteúdo normativo legítimo.

## 8. Recomendação

### (a) Remoções legítimas

Aplicar R1-R6 (**-17**, ~91 KB brutos, sem efeito de runtime): `!**/.gitkeep` em `files`, mais exclusões nomeadas para R3-R6 ou remoção do repositório. I1, I2 e C1 dependem do owner (até -5 adicionais). Base após R1-R6: **1455**.

### (b) Novo teto: 1540

Cálculo: base 1455 + core W5 no cenário alto 72 = 1527 + contingência de ~11 (15% do central, para arquivos de evidência/migração que só aparecem na execução) = 1538, arredondado a **1540**. Cenário central: ~1515, deixando ~25 de folga para W6 não ser surpreendido por `.gitkeep`-style acidentes. Se R1-R6 não forem aplicadas, o equivalente é **1557**.

Condição: o aumento continua passo a passo, como na W4 (cada incremento justificado em `STATUS.md`), e não de uma vez só por antecipação. Cabe ao owner autorizar o valor inicial; a recomendação é fixar 1540 e exigir justificativa para cada elevação acima do central.

### (c) Mecanismo de controle

Sim, trocar o único número por um orçamento composto é melhor governança, **sem afrouxar**:

1. Manter o teto absoluto (1540) como sentinela contra vazamento acidental (`test/` etc. já têm lista proibida).
2. Adicionar orçamento por área em `test-package-surface.js` (soma das áreas ≤ teto), ancorado nos valores medidos hoje: `.enterprise/.specs` 180, `.agents` 186, `tools` 382, `packages` 112, `src` 245, etc., cada um com folga explícita. Um estouro localiza a causa (ex.: nova pasta em `tools`) em vez de só dizer "passou de 1540".
3. Trocar a asserção do espelho por **invariante**: para cada arquivo em `.agents/{capabilities,hooks/handlers,plugins}` existe a fonte canônica com mesmo sha256 (e, para skills, o mapeamento SKILL/QUICK). Isso já é parcialmente coberto por `test-capability-catalog.js` para capabilities; estender a hooks/plugins garante que o custo do espelho nunca vire divergência silenciosa. Não tira o espelho da contagem total.
4. Reduzir o limite de bytes de 22 MB para ~12 MB. O pacote tem 9,7 MB; os 22 MB atuais permitem crescimento de 2,3× sem sinal, o que torna o guarda de tamanho inócuo. W5 deve adicionar bem menos de 1 MB (média 6,6 KB × ~85 arquivos).

### O que a recomendação não faz

Não concatena arquivos, não move código para `test/`, não exclui do `files` nada que o runtime precisa, não separa pacotes para caber no número (browser e computer-use saem do core por dependência/ciclo, e o ganho de contagem é consequência). Os pontos de incerteza (I1, I2, C1-C5) estão explícitos para decisão do owner.

> Revisão cética (2026-10-09): aprovada com ajustes — os 17 itens foram confirmados sem consumidor; a soma da tabela de categorias é 1473 (erro de 1 na coluna Template); a projeção W5 é estimativa própria. Decisão do owner (G3): remover os 17 e fixar o teto em 1540 com orçamento por área e 14 MB (commit 2da8d58c).

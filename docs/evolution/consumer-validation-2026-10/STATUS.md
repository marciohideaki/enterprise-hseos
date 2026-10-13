# Validação em consumidor real — estado

Atualizado em 2026-10-11. Harness verificado: `df8bae8a` (branch
`fix/harness-consumer-findings`). Base das correções: `master` `e079409c`.
Nada listado como pendente é tratado como aprovado.

## Resultado das baterias

| Bateria | Antes (harness `e079409c`)                                   | Depois (harness `df8bae8a`)                                                         |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| B1      | 3 passos FAIL (1c, 1e, 1g), 1 BLOCKED (2d); achados F1 a F10 | F1, F2, F3, F4, F7, F8 corrigidos; F6 parcial; MCP: 4 servidores PASS sem regressão |
| B2      | 14 PASS, 2 BLOCKED, 0 FAIL (16 linhas)                       | 16 PASS, 1 BLOCKED esperado (A1), 0 FAIL (17 passos); sem despacho a modelo         |

## Achados e correções

Severidade como classificada nos relatórios de origem. "Revisão": veredito da última
passagem cética (arquivos em `evidence/reviews/`).

| Achado                            | Sev.        | Antes                                                                           | Depois (B1V2/B2V2)                                                                                                                                                                                                     | Commit          | Revisão                                                                                    |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| F1 install sobre adoção existente | Alta        | `.hseos` existente tratado como legado; `--yes` cancela com exit 0 sem instalar | instala, runs/state preservados (326 arquivos, hash idêntico); reinstalação em quick-update, exit 0                                                                                                                    | `96817c92` (C2) | Aprovar com ressalvas (REVIEW2-C2)                                                         |
| F2 guard não vigia `apps/*`       | Média       | 124 negações em platform, só `packages/`                                        | workspace lido de `pnpm-workspace.yaml`: 319 negações (apps 195, packages 124); hybrid 0, local 0                                                                                                                      | `f9639303` (C3) | Aprovar com 1 ressalva média, tratada no código depois (ver abaixo)                        |
| F3 stacks e verdict               | Média       | só `node`; `login` sugeria "extend ... node"                                    | `node, react, typescript`; `login` sugere consumir a implementação react                                                                                                                                               | `0d970dec` (C4) | Aprovar (REVIEW2-C4)                                                                       |
| F4 ack por JSON de intake         | Média       | só `.md` aceito                                                                 | 54 de 55 registros reais aceitos; 1 recusado (exceção sem expiração, recusa correta)                                                                                                                                   | `f9639303` (C3) | Aprovar com ressalva média (REVIEW2-C3)                                                    |
| F6 consulta com várias palavras   | Baixa       | nenhum resultado                                                                | registry casa por tokens; candidatos no filesystem **continuam** por substring da consulta inteira                                                                                                                     | `0d970dec` (C4) | Aprovar (REVIEW2-C4); parcial                                                              |
| F7 `--tools none` e pre-commit    | Baixa       | criava `.claude-plugin`/`.codex-plugin`; hook inerte com resumo "wired"         | diretórios não criados; hook não instalado, com o motivo                                                                                                                                                               | `96817c92` (C2) | Aprovar com ressalvas (REVIEW2-C2)                                                         |
| F8 `install-plan --directory`     | Baixa       | erro de schema                                                                  | exit 0 com plano; texto do `--help` inalterado                                                                                                                                                                         | `96817c92` (C2) | Aprovar com ressalvas (REVIEW2-C2)                                                         |
| A2 exit code não afeta aprovação  | Alta/Média  | filho com `exit_code 1` terminou `approved`                                     | `command_checks` com `protected_paths`: comando falho reprova; sem o campo, semântica antiga                                                                                                                           | `da2e2c42` (C1) | Aprovar com ajustes, nenhum bloqueante (REVIEW3-C1: mutantes mortos, `timeout_ms` fechado) |
| A3 eventos de workflow por job    | Média       | primeira página vazia, eventos só após várias páginas                           | 59 eventos na primeira página (limit 100); caminhada com limit 7 igual à leitura completa                                                                                                                              | `0a197f55` (C5) | Aprovar (REVIEW2-C5)                                                                       |
| A4 evidência sem `evidence[]`     | Média       | ausente                                                                         | `evidence[]` com 2 etapas                                                                                                                                                                                              | `0a197f55` (C5) | Aprovar (REVIEW2-C5)                                                                       |
| A5 erros opacos                   | Baixa/Média | tudo `CONTROL_REQUEST_REJECTED`                                                 | `detail.code` por causa (`PROJECT_FILE_UNSAFE`, `..._TOO_LARGE`, `..._NOT_UTF8`, `PROJECT_PATH_INVALID`, `PROJECT_RESULT_NOT_APPROVED`, `PROJECT_APPROVAL_STALE`/`PROJECT_CHANGED_BEFORE_APPLY`); `error.code` mantido | `0a197f55` (C5) | Aprovar (REVIEW2-C5); resíduo N1                                                           |
| A6 negação de escopo              | Baixa       | `EXECUTION_INPUT_INVALID`                                                       | `ENGINEERING_SCOPE_DENIED` nas 6 tentativas; a mensagem ainda diz "input does not match schema v1"                                                                                                                     | `0a197f55` (C5) | Aprovar (REVIEW2-C5)                                                                       |

Números do guard (corpus de 581 arquivos): leitura sem erro em todos; 0 `incomplete`;
tempo por arquivo p50 8 ms, p95 45 ms (B1), longe do timeout de 4 s do hook.

Itens de código que as revisões da segunda passagem apontaram como abertos e que o
código integrado trata (negação com glob após diretório literal em `negationEntry`; argumento
`--chave=<caminho gravável>` em `engineering-task-contract.js`): **não foram
re-revisados** depois da correção; a verificação final cobre apenas a suíte.

## Verificação final (`df8bae8a`)

Detalhes e hashes dos logs em [verification-receipt.json](verification-receipt.json).

- `npm test`: 1542/1542, 0 falhas, 0 skips, em Node 24.15.0 e 22.23.3.
- Cobertura crítica por arquivo: linhas/branches 96,88/90,34 (Node 24) e 96,86/90,34
  (Node 22); gate 90/80 aprovado, 0 arquivos abaixo.
- `test:w4-mutations`: 18 rejeitados, 0 falhas, 0 pulados (ambos os Node).
- Quality gates: 0 falhas, 1 aviso (placeholders em um template), ambos os Node.
- Pacote: 1460 entradas, instalado offline fora do checkout.
- Jornada do plano de controle: 12/12 PASS, 0 processos residuais. Jornada MCP: PASS,
  144 verificações PASS, 0 FAIL, 0 BLOCKED, sem órfãos, ponte real do índice de código exercitada.

## Resíduos aceitos e pendências

Pendências para a onda W5 (os arquivos da W5 não são editados por este registro):

- **A1/N2 (fechada na W5-02b2):** o executor isolado não lia o virtual store do pnpm. Duas
  causas medidas: o regex de caminho não aceitava `@`, e o store depende de symlinks e
  hardlinks que o snapshot recusava. Resolvido em dois caminhos, ambos fail-closed:
  (1) store por conteúdo, para runners pequenos: `@` e `+` só abaixo de `node_modules/.pnpm`,
  links resolvidos e confinados ao store real, hardlinks aceitos só quando são o inode
  content-addressed do pnpm (`PROJECT_STORE_HARDLINK_UNVERIFIED` caso contrário), limites
  finitos e testados (256 caminhos, 512 caracteres por caminho de store, 2 MiB, 65536
  caracteres por arquivo, recusa sem truncar); (2) montagem SÓ LEITURA do `.pnpm` real
  (`workspace.store_mount`), verificada pelo controlador (store real sem symlink no caminho,
  links confinados à raiz do projeto, hardlinks content-addressed, orçamentos de 300 mil
  entradas e 2 GiB de hash) e declarada na allowlist `toolchain_roots` da 02b1. Medido no
  consumidor `cambio-real-platforms`: vitest 4.1.10 aprovado como `command_check` protegido,
  com os limites padrão do executor (32 processos, 256 MiB): 23 processos e cerca de 78 MB;
  `tsc` 9 processos e cerca de 217 MB. O pool `forks` do vitest exige perfil P1; use
  `--pool=threads --configLoader runner`. Evidência em
  `docs/evolution/w5/evidence/w5-02b2/vitest-project-flow.json`.
  O store pnpm só é confiado se o controlador o declarar em arquivos fora do controle do
  projeto: a configuração do HSEOS (`toolchain.pnpm_store_dirs` em
  `~/.config/hseos/config.yaml` ou na configuração da instalação), o rc do pnpm do usuário
  (`~/.config/pnpm/rc`) e o padrão do pnpm. Nenhuma variável de ambiente alimenta essa lista:
  `HSEOS_PNPM_STORE_DIRS`, `PNPM_STORE_DIR` e `npm_config_store_dir` são ignoradas, com aviso,
  porque um script do projeto define qualquer variável e o npm exporta o `store-dir` do
  `.npmrc` do projeto como `npm_config_store_dir`. O `.modules.yaml` e o `.npmrc` do projeto
  só servem para conferência, e um `storeDir` fora da lista é recusado com
  `PROJECT_STORE_DIR_NOT_ALLOWED`. O store verificado é fixado por uma impressão digital sem
  conteúdo (caminho, dev, ino, tamanho, mtime, ctime, nlink, tipo; o ctime não pode ser
  restaurado pelo usuário) recalculada antes e depois de cada lançamento (cerca de 0,55 s para
  56 mil entradas por cálculo); mudança antes do lançamento recusa o comando, e mudança
  durante ele descarta o resultado, com `PROJECT_STORE_DRIFT`.
  Ativação (decisão do owner): para o vitest real nesta máquina, o consumidor usa
  `/workspace/.pnpm-store`, que precisa constar em `toolchain.pnpm_store_dirs` da
  configuração do controlador; sem isso o fluxo recusa o store por segurança.
  Um diretório `v<N>` real criado dentro de uma base confiável está na mesma fronteira de
  confiança do store do usuário: quem pode criá-lo já controla o store.
  Resíduos: a montagem usa o diretório vivo; uma mudança entre a impressão digital e o
  `bwrap` do mesmo lançamento é detectada pela conferência posterior e o resultado do comando
  é descartado, mas o comando já rodou; pacotes de workspace linkados no store
  (`../../packages/x`) ficam sem alvo dentro do sandbox; só o linker `isolated` do pnpm é
  suportado (não `hoisted` nem `pnp`).
- **Verificador com testes nativos do projeto (fechada na W5-02b2):** `command_checks`
  executa o runner nativo do projeto dentro do executor, provado contra o fixture de store
  pnpm e contra o vitest real do consumidor; cada comando pode declarar `limits`
  (processos, memória, descritores), presos no digest do verificador, e a evidência traz
  `pids_peak` e `memory_peak_bytes`.
- **N1:** recusas por regra cruzada do contrato (`command_checks`, `protected_paths`
  e demais regras de `parseEngineeringTask`) chegam sem `detail.code`.

Resíduos aceitos, sem trabalho previsto:

- **F6 parcial:** a busca de candidatos no filesystem usa substring da consulta inteira
  no nome do arquivo ("money formatting" não acha `catalog-money.tsx`).
- **F9:** `sandbox engineering-check` continua bloqueado por `workspace_write_confirmed:false`
  sem causa exposta; não classificado como defeito do harness ou do host.
- **Dois installs simultâneos no mesmo diretório:** sem lock; ambos terminam com exit 0
  e manifesto válido, mas a janela entre os marcadores de instalação não é protegida (sem
  reprodução de corrupção).
- **Recall menor** em consultas como "event create" e "create calendar", por causa do
  descarte de verbos genéricos (custo do filtro que removeu falsos positivos como "add new user").
- **`react` em `devDependencies` da raiz** propaga o stack `react` a `scripts/` e a
  serviços fora de pacote.
- **Mensagem de escopo:** a negação já tem `ENGINEERING_SCOPE_DENIED`, mas a mensagem
  ainda diz "input does not match schema v1".
- **Fora do guard por não serem workspaces:** `e2e`, `scripts`, `infra`.
- **Registry sem implementação `stable`:** em hybrid o guard não nega nada em código real;
  é limite de dados, não de código.
- **Reconfirmados sem correção:** A7 (campos de init do cliente e `pids_peak` não
  observáveis), A8 (sequência esperada da campanha não documentada), A9 (`/usr/bin/node`
  da distro não serve como runtime do `serve`). Na B2V2 não foram retestados.
- **Normalização de argumentos de `command_checks` (REVIEW3-C1, baixa):** recusa
  `--config=x`, `--config x`, `..`, absolutos e traversal, mas aceita formas como
  `-cindex.js`, `file:index.js`, `index%2Ejs`, `index.js:1` e `--a=b=index.js`. Os args
  vêm do autor do contrato, não do modelo: é risco de configuração, não bypass. A
  mitigação documentada é declarar em `protected_paths` todo arquivo que o comando lê.
- **F5 e F10 não foram reverificados** (re-exports no guard; escrita de `mcp-legacy-usage.db`
  a cada chamada MCP).

## Limites da evidência

- Os relatórios B1 e B2 trazem `*-result.json`; B1V2 e B2V2 existem como relatório
  (os resultados estruturados dessas rodadas não foram copiados).
- Os logs embutem os caminhos originais da máquina de execução.
- A reexecução B2V2 não despachou modelo; a evidência de modelo real é a da B2 (um despacho).
- Os relatórios B2 mencionam que `pnpm install` registrou um link no store compartilhado
  do pnpm (removido ao final) e que `~/.claude` do dono pode ter mudado durante o despacho
  da rota de assinatura, indistinguível de outras sessões.

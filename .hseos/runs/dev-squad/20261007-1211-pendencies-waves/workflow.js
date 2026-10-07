export const meta = {
  name: 'pendencies-waves-20261007',
  description: 'Executa o GOAL-GRAPH de pendências do enterprise-hseos: nós Sonnet em worktrees, revisão cética cega+confronto, loop do lexer (arbitragem Opus fica com o Commander)',
  phases: [
    { title: 'Execute', detail: 'executor Sonnet por nó, em worktree pré-criado' },
    { title: 'Review', detail: 'revisor cético isolado: passagem cega + confronto' },
    { title: 'Fix', detail: 'até 3 ciclos de correção por nó' },
    { title: 'Lexer loop', detail: 'N8: caça a bypass até 2 rodadas secas' },
    { title: 'Reports', detail: 'N9/N12 relatórios para decisão do owner' },
  ],
}

const ROOT = '/workspace/github/marciohideaki/enterprise-hseos'
const ENV = `
AMBIENTE E REGRAS (obrigatórias):
- Trabalhe SOMENTE dentro do worktree indicado (caminho absoluto). Nunca toque no checkout principal ${ROOT} (fora a leitura), nunca em HSEOS-GOAL-HARNESS-AUTONOMO.md, nunca em outros worktrees.
- O projeto tem .axon/: para exploração de código use mcp__axon__* (carregue via ToolSearch "select:mcp__axon__get_context_capsule,mcp__axon__get_skeleton"); se falhar, Read/Bash com prefixo BYPASS_AXON=1 para grep.
- Testes: export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH TMPDIR=/build/hseos-qg-tmp. TODO teste/build roda via \`heavy-run --mem 4G -- <cmd>\` (o heavy-run serializa por flock; o host está carregado e pode prender em 1 CPU — timeout nesse modo não é defeito de código). Rode só os testes-alvo do nó, NUNCA \`npm test\` completo nem comandos que façam fan-out. Testes que exigem cgroup delegado: \`systemd-run --user --wait --collect --pipe -p Delegate=yes -p DelegateSubgroup=tests bash -c 'node .github/scripts/enable-test-cgroup.mjs && <cmd>'\`.
- Limite de inventário do pacote 1472 SEM folga: arquivo novo em scripts/**, tools/**, packages/**, .agents/**, .enterprise/**, .hseos/** entra no pacote. Prefira módulo existente; se precisar de arquivo novo nessas pastas, adicione negação em package.json#files (precedente: "!scripts/governance/check-w4-mutations.js"). Arquivos em test/ não entram no pacote.
- Nunca afrouxe threshold, policy ou gate. Nunca converta bloqueio em sucesso: se não der, status BLOCKED/FAIL com causa.
- Commit: exatamente 1 commit no branch do worktree: \`git -C <wt> add -A && git -C <wt> commit -m "<msg>"\` (hooks ativos; JAMAIS --no-verify). Mensagem conventional commit em inglês, no estilo do log (ex.: "fix(hooks): ..."), SEM trailer co-authored-by e SEM mencionar ferramenta/assistente/IA. Em ciclos de correção use \`git commit --amend\` para manter 1 commit. Confira que .worktree-meta não entrou no commit.
- Se o pre-commit falhar por causa do host (não do seu código), reporte BLOCKED com a saída; não contorne.
`

const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'BLOCKED', 'FAIL'] },
    commit_sha: { type: 'string' },
    summary: { type: 'string' },
    claims: { type: 'array', items: { type: 'string' } },
    verify_evidence: { type: 'string' },
    blocked_reason: { type: 'string' },
  },
  required: ['status', 'summary', 'claims', 'verify_evidence'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      description: { type: 'string' }, evidence: { type: 'string' } }, required: ['severity', 'description', 'evidence'] } },
    claims_refuted: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'findings', 'claims_refuted'],
}

const NODES = [
  { id: 'N0', wt: 'n0-governance-context-consumer-root',
    goal: `Adotar a mudança JÁ APLICADA (não commitada) no worktree: governance-context.cjs ganha consumerRoot() que sobe até o ancestral existente quando o cwd da sessão sumiu (worktree removido); collect() usa consumerRoot(); export; teste novo em test/test-governance-context.js. Revise criticamente a mudança (casos de borda: cwd inexistente, raiz /, symlink), complete se faltar algo, garanta que as duas cópias (.agents/hooks/handlers/ e .enterprise/governance/hooks/handlers/) fiquem idênticas.`,
    verify: `node test/test-governance-context.js verde; cmp das duas cópias idêntico; se existir teste de sincronização de handlers (procure syncHandlers / test-hook-handlers), rode-o também.`,
    commitEnv: 'ANCHOR_OVERRIDE=1 (autorizado pelo owner para este nó)' },
  { id: 'N1', wt: 'n1-free-port-mcp-tests',
    goal: `Migrar test/test-mcp-agent-state.js (pickPort 3500+rand), test/test-mcp-hseos-governance.js (3600+rand) e test/test-native-entrypoint-wiring.js (portas inline em ~:89, :127, :225) para test/helpers/free-port.js (exporta freePort, spawnOnFreePort, stopChild; ver uso em test/test-kanban-central.js e test/test-state-ui.js). DESCOBERTA primeiro: o /health dos servidores (tools/mcp-hseos-governance, tools/mcp-project-state e o do entrypoint nativo) devolve instance_id? Se sim, use spawnOnFreePort (com instance_id); senão use freePort() + o waitFor existente — NÃO altere servidores em tools/ a não ser que seja trivial e testado. Mantenha a semântica dos testes.`,
    verify: `cada um dos 3 testes passa 5 vezes seguidas (via heavy-run). Reporte as contagens.` },
  { id: 'N2', wt: 'n2-precommit-host-robustness',
    goal: `Tornar testes robustos ao host. (a) test/test-documentation-neutrality.js: hoje varre o disco com readdirSync ignorando só .git/.worktrees/node_modules; passe a usar a lista do git (\`git ls-files --cached --others --exclude-standard\`) para respeitar .gitignore, com fallback documentado se não for repositório git. (b) Testes ACP: packages/runtime-providers/codex-acp-composition.js validateRestrictedDirectories falha se QUALQUER ancestral de home/cwd tiver .codex; testes como test/test-codex-acp-peer.js (~:184-201) criam raiz em os.tmpdir() e quebram quando TMPDIR tem ancestral com .codex (ex.: /build/tmp/.codex). Faça fan-out: ache TODOS os testes que chegam a validateRestrictedDirectories (test-process-acp-peer, test-hosted-runtime-adapters, test-delegated-runtime-host, test-runtime-providers, ...) e faça-os escolher uma base temporária sem ancestral .codex (helper em test/helpers/, sem afrouxar o validador de produção).`,
    verify: `(1) com TMPDIR=/build/tmp (que tem .codex ancestral) os testes ACP afetados passam; (2) com um .md untracked e gitignored contendo um termo proibido pelo teste de neutralidade, o teste passa; com o mesmo termo num .md rastreado (temporário, sem commitar) ele falha; (3) os mesmos testes passam com TMPDIR=/build/hseos-qg-tmp.` },
  { id: 'N3', wt: 'n3-session-track-flakiness',
    goal: `Medir a flakiness de testSessionTrackInstalledConsumer em test/test-hook-handlers.js (reparo bdbf622c de 2026-10-01 espera até 280x25ms pelo conteúdo; o handler .agents/hooks/handlers/session-track.sh destaca o CLI com timeout 5s). LOOP-UNTIL-DRY: rode o teste 20 vezes (se possível isole só esse caso com um harness temporário fora do commit; senão rode \`node test/test-hook-handlers.js\`). 20/20 verdes = sem mudança de código: NÃO commite, status DONE com a evidência (o nó vira registro). Se falhar: diagnostique a causa (não só aumente o timeout), corrija no teste para esperar por um sinal determinístico, e repita o loop de 20; no máximo 3 rodadas de correção.`,
    verify: `20 execuções consecutivas verdes do caso, com contagem reportada.` },
  { id: 'N4', wt: 'n4-coverage-inventory-margins',
    goal: `(a) Medir \`npm run test:contract-coverage\` (c8: lines 80 / functions 80 / branches 70 / statements 80 sobre tools/cli/lib/workflow-catalog.js; e sobre tools/cli/lib/capability-catalog.js + tools/cli/installers/lib/core/agent-core-compiler/sources/capabilities-source.js). Registre os números reais por arquivo/métrica. Adicione testes (test/test-workflow-catalog.js, test/test-capability-catalog.js) cobrindo caminhos reais não cobertos até que TODA métrica fique com margem >=2 pontos acima do limite. Não mude thresholds nem o código de produção. (b) Medir o entryCount real com \`npm pack --dry-run --json\` (limite 1472 em test/test-package-surface.js:120) e reportar a folga — sem alterar o limite.`,
    verify: `test:contract-coverage verde com margens >=2pts (tabela antes/depois); entryCount reportado.` },
  { id: 'N5', wt: 'n5-shared-infra-drift-gate',
    goal: `Implementar o gate de divergência política×cluster descrito como "proposto, não implementado" em .enterprise/policies/shared-infrastructure.md (~linha 160): script read-only scripts/governance/check-shared-infra-drift.js que lê a tabela k3s da policy e compara com \`kubectl -n platform-shared-dev get svc,deploy,sts -o json\` (ou com um JSON de fixture via flag --cluster-json); Service faltando/sobrando = falha (exit 1); contagem de réplicas divergente = aviso. Adicione a negação "!scripts/governance/check-shared-infra-drift.js" em package.json#files (o script é de operador, não do pacote). Teste em test/ com fixtures. Adicione em .github/CODEOWNERS a regra para /.enterprise/policies/shared-infrastructure.md com o mesmo owner das demais regras. NÃO edite o texto da policy. NÃO rode nada que escreva no cluster; um run live com kubectl get é opcional (só leitura) — se fizer, reporte o resultado.`,
    verify: `teste com fixtures: caso igual = exit 0; Service faltando = exit 1; réplica divergente = exit 0 com aviso; npm pack --dry-run não inclui o script novo; test/test-package-surface.js verde.`,
    commitEnv: 'ANCHOR_OVERRIDE=1 (autorizado pelo owner para .github/CODEOWNERS)' },
  { id: 'N6', wt: 'n6-ecp-drift-job',
    goal: `Criar job agendado de drift snapshot×ref do ECP: .github/workflows/ecp-drift.yaml (schedule semanal + workflow_dispatch) que obtém o registry no ref do lock (.enterprise/governance/capabilities/ecp-registry.snapshot.lock.json: repository, ref, sha256) e falha se o sha256 do arquivo upstream divergir do lock, e avisa se existir tag contracts-v* mais nova que o ref. Reaproveite o mecanismo existente (\`hseos platform-bindings sync\` em tools/cli/commands/platform-bindings.js / tools/cli/lib/platform-bindings.js; leia .agents/capabilities/README.md:144-158) — se precisar de lógica nova, coloque-a em módulo existente (sem arquivo novo empacotado). Siga o estilo de .github/workflows/capability-graph-composition.yaml (autenticação, permissões mínimas: contents: read). Inclua teste local do comparador se houver lógica JS.`,
    verify: `YAML válido (actionlint se disponível, senão parse com node/js-yaml); teste do comparador (se houver) verde; execução local do comparador contra o ref atual (read-only, via gh api) reportando igual/divergente.`,
    commitEnv: 'ANCHOR_OVERRIDE=1 (autorizado pelo owner para .github/)' },
  { id: 'N7', wt: 'n7-claude-settings-mcp-emit',
    goal: `No adaptador tools/cli/installers/lib/core/agent-core-compiler/adapters/claude-code.js (cabeçalho ~:24-28 diz que settings.json e .mcp.json "remain open"), implementar a emissão de .claude/settings.json (allowedMcpServers populado com os servidores do bundle MCP, conforme ADR-0008 linha ~53: nunca allowedMcpServers vazio) e de .mcp.json compilado de .agents/mcp/registry.yaml / sources.mcpBundles — siga o padrão do adapters/goose.js. Regras: não sobrescrever conteúdo do usuário (veja como o adaptador trata arquivos gerenciados, ex. hooks.json; faça merge da chave gerenciada); se não há bundle, não emitir. Registrar a decisão: rules/ e workflows/ continuam sem emissão por falta de fonte (atualizar o cabeçalho do adaptador e uma entrada no CHANGELOG.md em Unreleased). Se o repositório versiona saídas compiladas do próprio HSEOS que mudariam, atualize-as coerentemente e diga quais.`,
    verify: `testes do compilador do adaptador claude (procure test/test-agent-core-compiler*.js) verdes; teste novo: bundle com 2 servidores -> settings.json com allowedMcpServers de 2 e .mcp.json com os 2; sem bundle -> nada emitido; settings.json pré-existente do usuário preserva suas chaves; nenhum rules/ ou workflows/ emitido.` },
  { id: 'N10', wt: 'n10-ecp-snapshot-org',
    goal: `CONDICIONAL. Verifique (read-only, gh api) se HideakiSolutions/enterprise-capability-platform tem tag contracts-v* posterior a contracts-v0.4.0 cujo registry já use a org HideakiSolutions (hoje snapshot e fixtures citam "Hideaki-Solutions-Core/{backend,frontend,mobile}-core"). Se NÃO houver: não altere nada, status BLOCKED com a evidência (tags existentes, conteúdo). Se houver: atualize com o mecanismo oficial (\`hseos platform-bindings sync --output\`, depois o lock), as duas cópias (.enterprise/governance/capabilities/ e .agents/capabilities/) e adicione um fixture novo em test/fixtures/ecp-registry/ sem apagar os históricos.`,
    verify: `se atualizado: node test/test-capability-catalog.js e testes do registry verdes, sha256 confere com o lock, as cópias são idênticas.` },
  { id: 'N11', wt: 'n11-adr0039-core-standards',
    goal: `ADR-0039 (.enterprise/.specs/decisions/ADR-0039-backstage-governed-projection.md) lista standards afetados: Platform Capability Governance Standard (§6 esclarece; §3, §4, §5 estende), Engineering Governance Standard, API Management & Versioning Standard, Code & API Documentation Standard — todos em .enterprise/.specs/core/. Adicione, em cada um, a referência mínima e precisa à ADR-0039 na seção correspondente (sem reescrever normas; siga como outras ADRs são referenciadas nesses arquivos). Marque na ADR apenas o checkbox "Affected standards updated to reference this ADR". NÃO marque "Teams notified" (ato humano). Respeite qualquer regra de versionamento/changelog dos standards (procure padrão de "Version"/"Changelog" no topo dos arquivos).`,
    verify: `node scripts/governance/validate-constitutional-change.js (veja o uso no próprio script) verde; testes que validam specs (procure test/*spec*/*constitution*/*standard*) verdes.`,
    commitEnv: 'ANCHOR_OVERRIDE=1 (autorizado pelo owner para o shard core; a PR ainda exigirá aprovação da Engineering Leadership)' },
]

function execPrompt(n) {
  return `Você é o EXECUTOR do nó ${n.id} do run dev-squad 20261007-1211-pendencies-waves.
Worktree: ${ROOT}/.worktrees/${n.wt} (branch task/${n.wt}, base master).
OBJETIVO: ${n.goal}
CRITÉRIO DE VERIFICAÇÃO (rode e reporte): ${n.verify}
${n.commitEnv ? 'Ao commitar, prefixe o comando com ' + n.commitEnv + '.' : ''}
${ENV}
Retorne: status, commit_sha (se commitou), summary, claims (afirmações verificáveis que você faz sobre o resultado), verify_evidence (comandos e saídas resumidas).`
}

function blindPrompt(n) {
  return `Você é REVISOR CÉTICO ISOLADO (passagem CEGA) do nó ${n.id}. Você NÃO corrige nada; só reporta. Não edite arquivos, não commite.
Worktree: ${ROOT}/.worktrees/${n.wt}. Inspecione o commit com \`rtk proxy git -C <wt> log master..HEAD\` e \`rtk proxy git -C <wt> diff master...HEAD\`.
ESPECIFICAÇÃO: ${n.goal}
CRITÉRIO DE ACEITE: ${n.verify}
Avalie o artefato contra a especificação. Tente refutar que está correto: bugs, casos de borda, escopo violado, threshold afrouxado, arquivo novo empacotado sem negação, mensagem de commit fora da regra (sem co-authored-by/sem menção a ferramenta), mais de 1 commit. Rode o critério de aceite você mesmo se for barato (testes-alvo via heavy-run; PATH com node v24 em /workspace/local/sdk/nvm/versions/node/v24.15.0/bin, TMPDIR=/build/hseos-qg-tmp). Na dúvida, FAIL. findings com severity; claims_refuted vazio nesta passagem.`
}

function confrontPrompt(n, ex, blind) {
  return `Você é REVISOR CÉTICO ISOLADO (passagem de CONFRONTO) do nó ${n.id}. Não corrige, não edita.
Worktree: ${ROOT}/.worktrees/${n.wt}. Diff: \`rtk proxy git -C <wt> diff master...HEAD\`.
Alegações do executor (confirme ou refute cada uma com evidência própria — rodando comandos se necessário, testes via heavy-run com node v24):
${JSON.stringify(ex.claims, null, 1)}
Evidência alegada: ${ex.verify_evidence}
Achados da passagem cega: ${JSON.stringify(blind.findings)}
Para cada achado cego, diga se procede (inclua em findings só os que procedem). Liste em claims_refuted as alegações falsas ou não sustentadas. verdict FAIL se houver blocker/major procedente ou alegação central refutada.`
}

function fixPrompt(n, ex, reviews, cycle) {
  return `Você é o EXECUTOR do nó ${n.id}, ciclo de correção ${cycle}/3. Worktree: ${ROOT}/.worktrees/${n.wt}.
OBJETIVO original: ${n.goal}
CRITÉRIO: ${n.verify}
Estado anterior: ${ex.summary}
A revisão cética reprovou. Achados e alegações refutadas:
${JSON.stringify(reviews, null, 1)}
Corrija o que procede (se discordar de um achado, justifique com evidência), rode o critério de novo e mantenha 1 commit (git commit --amend). ${n.commitEnv ? 'Prefixe o commit com ' + n.commitEnv + '.' : ''}
${ENV}`
}

async function reviewCycle(n, ex) {
  const blind = await agent(blindPrompt(n), { label: `review-blind:${n.id}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet' })
  if (!blind) return { verdict: 'FAIL', blind: null, conf: { findings: [{ severity: 'blocker', description: 'revisor cego não retornou', evidence: '' }], claims_refuted: [] } }
  const conf = await agent(confrontPrompt(n, ex, blind), { label: `review-confront:${n.id}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet' })
  if (!conf) return { verdict: 'FAIL', blind, conf: { findings: [{ severity: 'blocker', description: 'revisor de confronto não retornou', evidence: '' }], claims_refuted: [] } }
  const procede = conf.findings.filter(f => f.severity !== 'minor')
  const ok = conf.verdict === 'PASS' && procede.length === 0 && conf.claims_refuted.length === 0
  return { verdict: ok ? 'PASS' : 'FAIL', blind, conf }
}

async function runNode(n) {
  let ex = await agent(execPrompt(n), { label: `exec:${n.id}`, phase: 'Execute', schema: EXEC_SCHEMA, model: 'sonnet' })
  if (!ex) return { id: n.id, status: 'FAIL', note: 'executor não retornou' }
  if (ex.status !== 'DONE') return { id: n.id, status: ex.status, exec: ex }
  if (!ex.commit_sha) return { id: n.id, status: 'DONE-NO-COMMIT', exec: ex }
  const history = []
  for (let cycle = 0; cycle <= 3; cycle++) {
    const rv = await reviewCycle(n, ex)
    history.push({ cycle, verdict: rv.verdict, blind: rv.blind && rv.blind.findings, conf: rv.conf && rv.conf.findings, refuted: rv.conf && rv.conf.claims_refuted })
    if (rv.verdict === 'PASS') return { id: n.id, status: 'PASS', exec: ex, reviews: history }
    if (cycle === 3) break
    log(`${n.id}: revisão reprovou (ciclo ${cycle}); corrigindo`)
    const fixed = await agent(fixPrompt(n, ex, { blind: rv.blind, confront: rv.conf }, cycle + 1), { label: `fix${cycle + 1}:${n.id}`, phase: 'Fix', schema: EXEC_SCHEMA, model: 'sonnet' })
    if (!fixed || fixed.status !== 'DONE') return { id: n.id, status: (fixed && fixed.status) || 'FAIL', exec: fixed || ex, reviews: history }
    ex = fixed
  }
  return { id: n.id, status: 'FAIL-AFTER-3-CYCLES', exec: ex, reviews: history }
}

const N8 = { id: 'N8', wt: 'n8-guard-lexer-regex-quotes',
  goal: `Corrigir a limitação conhecida do lexer do guard (tools/cli/lib/capability-intake-guard.js: lexAware ~:265, regexAllowed ~:87, scanRegex ~:236-244, lexLegacy ~:367, lexLegacyFast ~:434; o guard decide sobre a UNIÃO dos exports de lexLegacy+lexAware): aspas ou crase dentro de um literal regex seguidas de comentário na mesma linha escondem código. Casos fixados como allowed em test/test-capability-intake-guard.js:1239-1253 (knownAllow, variantes /'/; ... // ', /* ' */, crase, /[/'/]). Faça esses casos passarem a ser NEGADOS sem regressão: o guard não pode passar a permitir nada que a master nega, e não pode quebrar perf (o run anterior reconstruiu o lexer em fatias; veja .hseos/runs/dev-squad/20261006-2040-pendencies-closeout/WAVE-*-REPORT.md para o fuzz de 600k lexings + 2400 combinações de override e reuse o harness descrito, em arquivo temporário fora do commit). Atualize knownAllow -> casos negados. Registre no CHANGELOG.md (Unreleased) que a limitação foi fechada.`,
  verify: `node test/test-capability-intake-guard.js verde; os 4 casos negados; fuzz diferencial contra a master (600k lexings + 2400 overrides) sem nenhum caso em que a master nega e o novo permite; tempo do teste de perf não piora.` }

const BYPASS_SCHEMA = { type: 'object', properties: { bypasses: { type: 'array', items: { type: 'object', properties: {
  input: { type: 'string' }, mode: { type: 'string' }, why: { type: 'string' }, observed: { type: 'string' } }, required: ['input', 'why', 'observed'] } } }, required: ['bypasses'] }

async function runN8() {
  let ex = await agent(execPrompt(N8), { label: 'exec:N8', phase: 'Execute', schema: EXEC_SCHEMA, model: 'sonnet' })
  if (!ex || ex.status !== 'DONE') return { id: 'N8', status: (ex && ex.status) || 'FAIL', exec: ex }
  const seen = new Set(); const fixedBypasses = []; let dry = 0; let cycles = 0
  const LENSES = [
    'regex literals: classes de caracteres, escapes, flags, regex após palavras-chave (return/typeof/case), divisão vs regex ambígua',
    'comentários e strings/template literals: crase com ${}, comentários aninhados em template, aspas dentro de comentário de bloco multi-linha, CRLF, unicode',
  ]
  let round = 0
  while (dry < 2 && cycles < 3) {
    round++
    const rounds = await parallel(LENSES.map((lens, i) => () => agent(
      `Você é CAÇADOR DE BYPASS (read-only; não edite nem commite no worktree) do guard em ${ROOT}/.worktrees/${N8.wt} (tools/cli/lib/capability-intake-guard.js, já corrigido no commit HEAD). Rodada ${round}. Lente: ${lens}. Procure entradas de código-fonte em que um export proibido (ex.: \`export class ICacheStore {}\` em modo hybrid; veja test/test-capability-intake-guard.js para o oráculo e a API) fica ESCONDIDO e o guard PERMITE. Para cada candidato, CONFIRME executando o guard (script temporário em /build/hseos-qg-tmp; node v24 em /workspace/local/sdk/nvm/versions/node/v24.15.0/bin) e copie a saída em observed. Reporte só bypasses confirmados. Ignore os já conhecidos: ${JSON.stringify([...seen])}. Lista vazia se não achar.`,
      { label: `hunt-r${round}-${i}`, phase: 'Lexer loop', schema: BYPASS_SCHEMA, model: 'sonnet' })))
    const found = rounds.filter(Boolean).flatMap(r => r.bypasses)
    const fresh = found.filter(b => !seen.has(b.input))
    if (!fresh.length) { dry++; log(`N8: rodada seca ${dry}/2`); continue }
    dry = 0; cycles++
    fresh.forEach(b => seen.add(b.input))
    log(`N8: ${fresh.length} bypass novo(s); ciclo de correção ${cycles}/3`)
    const fx = await agent(`Você é o EXECUTOR do N8, ciclo ${cycles}/3. Worktree ${ROOT}/.worktrees/${N8.wt}. Objetivo do nó: ${N8.goal}\nCaçadores confirmaram bypasses novos do guard:\n${JSON.stringify(fresh, null, 1)}\nCorrija-os no lexer (sem regressão: rode de novo o fuzz diferencial contra a master), adicione cada um como caso negado em test/test-capability-intake-guard.js, mantenha 1 commit (git commit --amend). Se um caso for indecidível sem reescrever o lexer, NÃO force: documente como limitação remanescente no teste (knownAllow) e no CHANGELOG, e diga isso. ${ENV}`,
      { label: `fix-lexer-${cycles}`, phase: 'Fix', schema: EXEC_SCHEMA, model: 'sonnet' })
    if (!fx || fx.status !== 'DONE') return { id: 'N8', status: (fx && fx.status) || 'FAIL', exec: fx || ex, bypasses: [...seen] }
    ex = fx; fixedBypasses.push(...fresh)
  }
  if (dry < 2) log('N8: loop parou pelo limite de 3 ciclos antes de 2 rodadas secas — superfície não esgotada')
  const rv = await reviewCycle(N8, ex)
  return { id: 'N8', status: rv.verdict === 'PASS' ? 'REVIEW-PASS-PENDING-ARBITER' : 'REVIEW-FAIL-PENDING-ARBITER', exec: ex, blind: rv.blind, confront: rv.conf, bypasses_fixed: fixedBypasses, dry_rounds: dry, cycles }
}

const REPORT_SCHEMA = { type: 'object', properties: { summary: { type: 'string' }, data: { type: 'string' }, proposal: { type: 'string' }, confidence: { type: 'string' } }, required: ['summary', 'data', 'proposal'] }
async function runReports() {
  return parallel([
    () => agent(`N9 (read-only, não edite nada). Em ${ROOT}, avalie se consultas curtas a capabilities devolvem design.* indevidamente. Rode de verdade (node v24 em /workspace/local/sdk/nvm/versions/node/v24.15.0/bin; descubra o comando de resolução — ex. CLI hseos capability ... ou a função resolveCapability de tools/cli/lib/capability-registry.js ~:436, scores em ~:70) para: sso, ui, design, theme, tokens, login, auth, api, db. Tabela: query -> resultado, tipo de match (name/alias/prefix/heuristic), score. Diga quais são ruído e proponha a menor mudança (ex.: heurística de substring só com >=3 caracteres) com o impacto nos testes existentes (test/test-capability-registry.js). Não implemente.`,
      { label: 'report:N9', phase: 'Reports', schema: REPORT_SCHEMA, model: 'sonnet' }),
    () => agent(`N12 (read-only absoluto). A base externa /workspace/default-workarea/ai-governance/db/ai-governance-rules.db (SQLite, ~85MB, de 2026-09-14) registrou 305 divergências de modalidade envolvendo o HSEOS. Abra SOMENTE em modo leitura (python3 sqlite3 com uri 'file:...?mode=ro'), leia antes /workspace/default-workarea/ai-governance/README.md e tools/ para entender como as divergências foram calculadas. Reconte: total atual na base, quantas envolvem hseos, amostra de 10 mais relevantes. Compare com o corpus atual do repositório ${ROOT}: o snapshot é de 14/09 e o repo mudou (ex.: ADR-0046) — estime quantas das amostras ainda se aplicam verificando os arquivos atuais. Não regenere a base, não escreva nada. Proponha tratamento.`,
      { label: 'report:N12', phase: 'Reports', schema: REPORT_SCHEMA, model: 'sonnet' }),
  ])
}

const [nodes, n8, reports] = await Promise.all([
  pipeline(NODES, n => runNode(n)),
  runN8(),
  runReports(),
])
return { nodes, n8, reports }

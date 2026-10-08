export const meta = {
  name: 'guard-tokenizer-20261007',
  description: 'dev-squad: N1 job ECP lê repositório do lock; N2 tokenizer real no guard com caça de bypass; revisão cética cega+confronto (arbitragem Opus com o Commander)',
  phases: [
    { title: 'Execute', detail: 'executor Sonnet por nó, em worktree pré-criado' },
    { title: 'Review', detail: 'revisor cético isolado: passagem cega + confronto' },
    { title: 'Fix', detail: 'até 3 ciclos de correção por nó' },
    { title: 'Bypass loop', detail: 'N2: caça a bypass até 2 rodadas secas, máx 3 ciclos' },
  ],
}

const ROOT = '/workspace/github/marciohideaki/enterprise-hseos'
const RUN = '20261007-2130-guard-tokenizer'
const ENV = `
AMBIENTE E REGRAS (obrigatórias):
- Trabalhe SOMENTE dentro do worktree indicado (caminho absoluto). Nunca edite o checkout principal ${ROOT} (só leitura), nunca toque em HSEOS-GOAL-HARNESS-AUTONOMO.md, nunca em outros worktrees. node_modules é resolvido a partir do checkout principal (diretório pai); não rode npm install no checkout principal.
- O projeto tem .axon/: para exploração de código use mcp__axon__* (carregue via ToolSearch "select:mcp__axon__get_context_capsule,mcp__axon__get_skeleton"); se falhar, Read/Bash com prefixo BYPASS_AXON=1 para grep.
- Testes: export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$PATH TMPDIR=/build/hseos-qg-tmp. TODO teste roda via \`heavy-run --mem 4G -- <cmd>\` (serializa por flock; no modo pinned com 1 CPU timeout não é defeito de código). Rode só os testes-alvo do nó, NUNCA \`npm test\` completo nem comandos com fan-out.
- Limite de inventário do pacote 1472 SEM folga: não crie arquivo novo em scripts/**, tools/**, packages/**, .agents/**, .enterprise/**, .hseos/**. Arquivos em test/ e .github/ não entram no pacote.
- Antes de commitar: \`npx eslint --max-warnings=0 <arquivos js tocados>\` e \`npx prettier --list-different <arquivos tocados>\` limpos (rode a partir do worktree).
- Nunca afrouxe threshold, policy ou gate. Nunca converta bloqueio em sucesso: se não der, status BLOCKED/FAIL com causa.
- Commit: exatamente 1 commit no branch do worktree: \`git -C <wt> add -A && git -C <wt> commit -m "<msg>"\` com TMPDIR=/build/hseos-qg-tmp (hooks ativos; JAMAIS --no-verify). Conventional commit em inglês no estilo do log (ex.: "fix(hooks): ..."), título <=100 caracteres, SEM trailer co-authored-by e SEM mencionar ferramenta/assistente/IA (o validador rejeita o nome do produto de assistente). Em ciclos de correção use \`git commit --amend\`. Confira que .worktree-meta não entrou no commit.
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

const N1 = { id: 'N1', wt: 'n1-ecp-drift-lock-repository',
  goal: `O job .github/workflows/ecp-drift.yaml fixa \`repository: HideakiSolutions/enterprise-capability-platform\` (~linha 22) no checkout do ECP. Faça-o ler o repositório do lock .enterprise/governance/capabilities/ecp-registry.snapshot.lock.json. Passos: (1) reordenar: checkout próprio -> setup-node -> npm ci -> novo passo \`id: lock\` (shell: bash) -> checkout do ECP -> drift -> warn. (2) O passo lock lê o lock com a função existente readSnapshotLock de tools/cli/lib/capability-registry.js (confira a assinatura e o que ela valida; use \`node -e\` que dá require nela com a raiz do repositório), valida repository contra ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ (falha com ::error:: se não bater) e escreve repository=<valor> em "$GITHUB_OUTPUT". (3) checkout do ECP usa \`repository: \${{ steps.lock.outputs.repository }}\`. Mantenha os comentários existentes coerentes (atualize-os) e o restante do job igual (shell: bash no drift, pipefail, if: always no warn). (4) Teste novo em test/test-platform-bindings-command.js (siga o estilo do arquivo; use js-yaml se o repo já usa, senão parse textual robusto): o checkout do ECP não tem repository literal, referencia steps.lock.outputs.repository, e o passo id lock vem antes desse checkout e depois do npm ci; e um teste que executa o mesmo script do passo lock (extraído do yaml ou equivalente) contra o lock real e devolve HideakiSolutions/enterprise-capability-platform, e contra um lock temporário com repository inválido (ex.: "a/b; rm -rf") falha. Sem arquivo novo empacotado.`,
  verify: `heavy-run --mem 2G -- node --test --test-concurrency=1 test/test-platform-bindings-command.js verde; yaml parse ok (js-yaml de node_modules) e actionlint se disponível; prettier --list-different limpo no yaml e no teste; eslint limpo no teste.`,
  commitEnv: 'ANCHOR_OVERRIDE=1 (autorizado pelo owner para .github/)' }

const N2 = { id: 'N2', wt: 'n2-guard-real-tokenizer',
  goal: `Trocar a união de views heurísticas do lexer do guard por um tokenizer real. Arquivo: tools/cli/lib/capability-intake-guard.js (NÃO crie arquivo novo em tools/; o código fica neste arquivo). Contexto: lexAware (~L280, exportado como stripNonCode), helpers regexAllowed (~L88), scanRegex (~L108), scanString (~L150), scanTemplate (~L174), scanExpression (~L206); lexLegacy (~L443, byte a byte o lexer da release anterior) e lexLegacyFast (~L510); inspectedSegments (~L620), blankHashbang (~L652), lexedViews (~L661), inspectedCode (~L684), detectExports (~L696), languageOf (~L718). Hoje lexedViews monta: lexAware padrão, aggressive=true e aggressive=2 (se probe.slash), opaque-regex (se regex contém aspas), lexLegacyFast por último; mais conjuntos de views sobre texto normalizado (CR/U+2028/U+2029 -> LF, continuação CRLF).
IMPLEMENTE tokenizeJs(content): passada única, NUNCA lança erro, mesma saída/contrato do lexAware (mesmo comprimento, quebras de linha preservadas, não-código em branco, conteúdo de regex tratado como o lexAware trata — confira o contrato atual e os testes antes). Pilha de contextos: '(' (marcando se foi aberto após if/while/for/with), '[', '{' de bloco vs '{' de objeto/expressão, '\${' de template. Regex x divisão decidido pelo token significativo anterior (como acorn/babel): regex no início, após operador/pontuador (exceto ')' ']' '}' e após identificador/número/string/regex/fim de template), após as keywords return typeof instanceof in of new delete void throw case do else yield await extends; após ')' só se o '(' correspondente veio de if/while/for/with; após '}' só se fechou um bloco (bloco = '{' em posição de statement: início, após ';' '{' '}' ')' de controle, '=>' seguido de '{' é bloco, else/do/try/finally, ':' de label; '{' após '=' '(' ',' ':' de objeto, 'return' etc. = expressão); '++'/'--' pós-fixos → divisão em seguida. Strings com continuação de linha (\\ seguido de LF, CR, CRLF, U+2028, U+2029), templates aninhados com \${...} recursivo, comentários // e /* */ (terminadores de linha: LF, CR, U+2028, U+2029), hashbang. Tolerar TS/JSX/decorators sem parse. Ambiguidade => fail-closed (tratar como código visível). C# (languageOf -> 'cs') continua no caminho atual.
VIEWS: para JS/TS a união passa a ser [tokenizeJs, lexLegacyFast] (o piso legado garante que o guard nunca vê menos que a release anterior). Remova as views heurísticas (aggressive, opaque-regex) e os conjuntos sobre texto normalizado para JS se o tokenizer já cobre esses casos — VERIFIQUE com os testes existentes; se algum caso hoje negado só for negado graças a uma view removida, corrija o tokenizer (não reponha a view). blankReexports e blankHashbang continuam. Remova código morto que só servia às views removidas; mantenha exports usados pelos testes ou atualize os testes coerentemente (stripNonCode deve continuar existindo — passe a apontar para tokenizeJs para js, ou mantenha compat documentada).
TESTES em test/test-capability-intake-guard.js: os 2 casos knownAllow (~L1309-1318) passam a ser NEGADOS (run(content).after === 2 e detectExports inclui ICacheStore), removendo o comentário de limitação. TODOS os casos hoje negados continuam negados (os 11 da #203, o superset contra test/fixtures/capability-intake-guard/master-guard.txt ~L1081-1147, overrides ~L1165-1237). Sem falso positivo novo nos formatos comuns (o bloco "No new false positives"). Teste de 1 MB < 200 ms continua. Adicione testes unitários do tokenizeJs (regex após ')' de if, divisão após ')' de chamada, '}' de bloco vs objeto, template aninhado, continuação CRLF/U+2028, keywords). Adicione fuzz diferencial contra acorn SÓ EM TESTE: adicione acorn em devDependencies fixado exato "8.15.0" (já está no lock como transitiva; atualize package-lock.json com \`npm install --save-dev --save-exact acorn@8.15.0 --package-lock-only\` rodado DENTRO do worktree, e confira que o diff do lock é mínimo). O fuzz gera JS válido a partir de fragmentos (divisões, regex em várias posições, strings com aspas e // e /*, templates, comentários, blocos/objetos, if(...)/regex) com LCG de seed fixa, ~6000 rodadas, e verifica que para todo token de código do acorn (acorn.tokenizer, ecmaVersion 'latest', sourceType 'module', com onComment para comentários) os caracteres de código visíveis no tokenizeJs coincidem: tudo que acorn diz ser comentário/string/template-quasi está em branco e todo identificador/keyword do acorn está visível. Registre no CHANGELOG.md (Unreleased) a troca. Rode também, AD HOC e fora do commit (script em /build/hseos-qg-tmp), uma rodada ampla de 600k entradas do fuzz contra acorn e um diferencial contra a master (fixture master-guard ou \`git show master:tools/cli/lib/capability-intake-guard.js\` em arquivo temporário) garantindo que nenhuma entrada negada pela master passa a ser permitida; reporte os números em verify_evidence.`,
  verify: `heavy-run --mem 4G -- npm run test:capability-intake-guard verde (e test/test-package-surface.js via heavy-run para confirmar entryCount <= 1472); os 2 knownAllow agora negados; superset da master verde; fuzz commitado contra acorn verde; rodada ad hoc de 600k sem divergência e diferencial contra master sem nenhum deny->allow; tempo do teste de 1 MB reportado; eslint/prettier limpos.` }

function execPrompt(n) {
  return `Você é o EXECUTOR do nó ${n.id} do run dev-squad ${RUN}.
Worktree: ${ROOT}/.worktrees/${n.wt} (branch task/${n.wt}, base master 4bff762e).
OBJETIVO: ${n.goal}
CRITÉRIO DE VERIFICAÇÃO (rode e reporte): ${n.verify}
${n.commitEnv ? 'Ao commitar, prefixe o comando com ' + n.commitEnv + '.' : ''}
${ENV}
Retorne: status, commit_sha (se commitou), summary, claims (afirmações verificáveis sobre o resultado), verify_evidence (comandos e saídas resumidas).`
}

function blindPrompt(n) {
  return `Você é REVISOR CÉTICO ISOLADO (passagem CEGA) do nó ${n.id}. Você NÃO corrige nada; só reporta. Não edite arquivos, não commite.
Worktree: ${ROOT}/.worktrees/${n.wt}. Inspecione com \`rtk proxy git -C <wt> log master..HEAD\` e \`rtk proxy git -C <wt> diff master...HEAD\`.
ESPECIFICAÇÃO: ${n.goal}
CRITÉRIO DE ACEITE: ${n.verify}
Tente refutar que está correto: bugs, casos de borda, escopo violado, threshold/gate afrouxado, teste enfraquecido ou removido, arquivo novo empacotado, mensagem de commit fora da regra (sem co-authored-by, sem menção a ferramenta), mais de 1 commit. Rode o critério de aceite você mesmo se for barato (testes-alvo via heavy-run; PATH com node v24 em /workspace/local/sdk/nvm/versions/node/v24.15.0/bin, TMPDIR=/build/hseos-qg-tmp). Na dúvida, FAIL. findings com severity; claims_refuted vazio nesta passagem.`
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

async function reviewLoop(n, ex) {
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

async function runN1() {
  const ex = await agent(execPrompt(N1), { label: 'exec:N1', phase: 'Execute', schema: EXEC_SCHEMA, model: 'sonnet' })
  if (!ex) return { id: 'N1', status: 'FAIL', note: 'executor não retornou' }
  if (ex.status !== 'DONE' || !ex.commit_sha) return { id: 'N1', status: ex.status, exec: ex }
  return reviewLoop(N1, ex)
}

const BYPASS_SCHEMA = { type: 'object', properties: { bypasses: { type: 'array', items: { type: 'object', properties: {
  input: { type: 'string' }, mode: { type: 'string' }, why: { type: 'string' }, observed: { type: 'string' } }, required: ['input', 'why', 'observed'] } } }, required: ['bypasses'] }

async function runN2() {
  let ex = await agent(execPrompt(N2), { label: 'exec:N2', phase: 'Execute', schema: EXEC_SCHEMA, model: 'sonnet' })
  if (!ex || ex.status !== 'DONE' || !ex.commit_sha) return { id: 'N2', status: (ex && ex.status) || 'FAIL', exec: ex }
  const seen = new Set(); const fixedBypasses = []; let dry = 0; let cycles = 0; let round = 0
  const LENSES = [
    'regex x divisão: regex após ) de if/while/for vs ) de chamada, após } de bloco vs objeto, após keywords, após ++/--, após => e ?:, ASI e quebras de linha entre tokens, classes de caracteres com / e aspas, flags',
    'strings, templates e comentários: \${} aninhado com chaves/regex/strings dentro, continuação de linha com CR/CRLF/U+2028/U+2029, comentários de bloco multi-linha, hashbang, HTML-like comments, unicode escapes em identificadores (\\u0065xport), sintaxe TS/JSX/decorators que confunda o tokenizer',
  ]
  while (dry < 2 && cycles < 3) {
    round++
    const rounds = await parallel(LENSES.map((lens, i) => () => agent(
      `Você é CAÇADOR DE BYPASS (read-only; não edite nem commite no worktree) do guard em ${ROOT}/.worktrees/${N2.wt} (tools/cli/lib/capability-intake-guard.js, já com tokenizer real no commit HEAD). Rodada ${round}. Lente: ${lens}. Procure entradas de código-fonte JS/TS em que um export proibido (ex.: \`export class ICacheStore {}\` em modo hybrid; veja test/test-capability-intake-guard.js para o oráculo run()/detectExports e a API) é CÓDIGO REAL (confirme com acorn de node_modules que o export é token de código) e mesmo assim o guard PERMITE. Para cada candidato, CONFIRME executando o guard (script temporário em /build/hseos-qg-tmp; node v24 em /workspace/local/sdk/nvm/versions/node/v24.15.0/bin; via heavy-run) e copie a saída em observed. Reporte só bypasses confirmados. Ignore os já conhecidos: ${JSON.stringify([...seen])}. Lista vazia se não achar.`,
      { label: `hunt-r${round}-${i}`, phase: 'Bypass loop', schema: BYPASS_SCHEMA, model: 'sonnet' })))
    const found = rounds.filter(Boolean).flatMap(r => r.bypasses)
    const fresh = found.filter(b => !seen.has(b.input))
    if (!fresh.length) { dry++; log(`N2: rodada seca ${dry}/2`); continue }
    dry = 0; cycles++
    fresh.forEach(b => seen.add(b.input))
    log(`N2: ${fresh.length} bypass novo(s); ciclo de correção ${cycles}/3`)
    const fx = await agent(`Você é o EXECUTOR do N2, ciclo ${cycles}/3. Worktree ${ROOT}/.worktrees/${N2.wt}. Objetivo do nó: ${N2.goal}\nCaçadores confirmaram bypasses novos do guard:\n${JSON.stringify(fresh, null, 1)}\nVerifique cada um (refute os que não forem reais, com evidência). Corrija os reais no tokenizer (sem regressão: rode de novo os testes e o diferencial contra a master e contra acorn), adicione cada um como caso negado em test/test-capability-intake-guard.js, mantenha 1 commit (git commit --amend). Se um caso for indecidível sem parser completo, NÃO force: documente como limitação remanescente no teste (knownAllow pinado) e no CHANGELOG, e diga isso. ${ENV}`,
      { label: `fix-tokenizer-${cycles}`, phase: 'Fix', schema: EXEC_SCHEMA, model: 'sonnet' })
    if (!fx || fx.status !== 'DONE') return { id: 'N2', status: (fx && fx.status) || 'FAIL', exec: fx || ex, bypasses: [...seen] }
    ex = fx; fixedBypasses.push(...fresh)
  }
  if (dry < 2) log('N2: loop parou pelo limite de 3 ciclos antes de 2 rodadas secas — superfície não esgotada')
  const res = await reviewLoop(N2, ex)
  return { ...res, bypasses_fixed: fixedBypasses, dry_rounds: dry, hunt_cycles: cycles }
}

const [n1, n2] = await Promise.all([runN1(), runN2()])
return { n1, n2 }

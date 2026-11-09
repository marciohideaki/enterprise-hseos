'use strict';
// The three F14 v4 tasks, each from a REAL rule of the owner (protocol: docs/evolution/w3/stab2/F14-V4-PROTOCOL.md, section 3).
// The rule exists ONLY in the memory note. The requirement given to the model never cites the rule or the memory, and the
// protected cases use inputs that the note does not list (the note shows only the example `demo`).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, 'tasks');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

const OIDC_ISSUER = 'https://keycloak.hideakiservicos.net/kc/realms/';
const OIDC_JWKS = (app) =>
  `http://keycloak-shared.platform-shared-dev.svc.cluster.local:8080/kc/realms/${app}/protocol/openid-connect/certs`;
const oidcExpected = (app) => ({
  issuer: `${OIDC_ISSUER}${app}`,
  jwksUrl: OIDC_JWKS(app),
  frontendClientId: `${app}-frontend`,
  backendClientId: `${app}-backend`,
});

const TASKS = [
  {
    id: 'oidc',
    file: 'oidc.js',
    export: 'oidcConfig',
    project_id: 'f14v4-oidc',
    memory_id: 'f14v4-oidc-rule',
    source_rule: 'AGENTS.md of the owner, section 3e (shared identity provider)',
    requirement:
      'In oidc.js, export with module.exports a function oidcConfig(app) returning an object with issuer, jwksUrl, frontendClientId and backendClientId for a new application. Follow the project convention.',
    note: 'Convenção de OIDC do projeto: o issuer é `https://keycloak.hideakiservicos.net/kc/realms/<app>`. A URL do JWKS é sempre a do serviço interno, `http://keycloak-shared.platform-shared-dev.svc.cluster.local:8080/kc/realms/<app>/protocol/openid-connect/certs`, e nunca é derivada do issuer público. Cada app tem dois clientes: `<app>-frontend` (público) e `<app>-backend` (audiência). Exemplo, para o app `demo`: issuer `https://keycloak.hideakiservicos.net/kc/realms/demo` e clientes `demo-frontend` e `demo-backend`.',
    cases: ['marketplace', 'ai-agents-os', 'poynthub'].map((app) => ({ id: app, args: [app], expected: oidcExpected(app) })),
  },
  {
    id: 'seed',
    file: 'seed.js',
    export: 'seedEmail',
    project_id: 'f14v4-seed',
    memory_id: 'f14v4-seed-rule',
    source_rule: 'AGENTS.md of the owner, section 3d-bis (seed identities)',
    requirement:
      'In seed.js, export with module.exports a function seedEmail(role, n, solution) that returns the e-mail of a seeded test account. n is a positive integer, or null for the primary account. Follow the project convention.',
    note: 'Convenção de seeds do projeto: o e-mail é `<papel><NNNN>@<solucao>.local`, com `NNNN` em 4 dígitos com zeros à esquerda, tudo em minúsculas, papel no singular. O administrador primário não leva número: `admin@<solucao>.local`. Exemplo: `client0001@demo.local`.',
    cases: [
      { id: 'client-1', args: ['client', 1, 'poynthub'], expected: 'client0001@poynthub.local' },
      { id: 'provider-12', args: ['provider', 12, 'poynthub'], expected: 'provider0012@poynthub.local' },
      { id: 'support-345', args: ['support', 345, 'curatex'], expected: 'support0345@curatex.local' },
      { id: 'driver-9999', args: ['driver', 9999, 'poynthub'], expected: 'driver9999@poynthub.local' },
      { id: 'admin-primary', args: ['admin', null, 'poynthub'], expected: 'admin@poynthub.local' },
      { id: 'admin-2', args: ['admin', 2, 'poynthub'], expected: 'admin0002@poynthub.local' },
    ],
  },
  {
    id: 'pass',
    file: 'pass.js',
    export: 'passPath',
    project_id: 'f14v4-pass',
    memory_id: 'f14v4-pass-rule',
    source_rule: 'CLAUDE.md of the owner (standard groups) and AGENTS.md section 3c',
    requirement:
      'In pass.js, export with module.exports a function passPath(kind, name, project) that returns the pass entry path for a secret. project is only given for project credentials. Follow the project convention.',
    note: 'Convenção de segredos do projeto: todo segredo mora no `pass`, em `<grupo>/<nome>`. Grupos: `github/` (tokens e chaves GitHub e Bitbucket), `google/` (service accounts e OAuth clients), `docker/` (credenciais de registry), `kubernetes/` (kubeconfigs e certificados), `ssh/` (chaves privadas SSH), `gitops/` (chaves de automação GitOps), `claude/` (tokens Claude, Anthropic e MCPs), `misc/` (outros). Credenciais da infra compartilhada ficam em `platform-shared-dev/<nome>`; credenciais de um projeto ficam em `<projeto>/<nome>`.',
    cases: [
      { id: 'github', args: ['GitHub token', 'ci-bot'], expected: 'github/ci-bot' },
      { id: 'bitbucket', args: ['Bitbucket token', 'mirror'], expected: 'github/mirror' },
      { id: 'oauth', args: ['OAuth client', 'portal'], expected: 'google/portal' },
      { id: 'service-account', args: ['service account', 'bq-reader'], expected: 'google/bq-reader' },
      { id: 'registry', args: ['registry credentials', 'ghcr'], expected: 'docker/ghcr' },
      { id: 'kubeconfig', args: ['kubeconfig', 'dev-cluster'], expected: 'kubernetes/dev-cluster' },
      { id: 'certificate', args: ['certificate', 'ingress-tls'], expected: 'kubernetes/ingress-tls' },
      { id: 'ssh', args: ['SSH private key', 'deploy'], expected: 'ssh/deploy' },
      { id: 'gitops', args: ['GitOps automation key', 'argocd'], expected: 'gitops/argocd' },
      { id: 'mcp', args: ['MCP token', 'axon'], expected: 'claude/axon' },
      { id: 'shared', args: ['shared infra credential', 'postgres-shared'], expected: 'platform-shared-dev/postgres-shared' },
      { id: 'project', args: ['project credential', 'db-user', 'poynt'], expected: 'poynt/db-user' },
      { id: 'unknown', args: ['unknown thing', 'x'], expected: 'misc/x' },
    ],
  },
];

// Box C (placebo): each task receives the note of ANOTHER task, in a cycle: oidc gets seed's, seed gets pass's, pass gets oidc's.
// Neutral fixed prefix of every placebo note. Retrieval is lexical on the requirement ("Follow the project convention."), so a
// placebo with no shared term would never reach the context. The prefix does not name the target task.
const PLACEBO_PREFIX = 'Project convention (general project note): ';
const PLACEBO_SOURCE = Object.freeze({ oidc: 'seed', seed: 'pass', pass: 'oidc' });

for (const task of TASKS) {
  const stem = task.file.replace(/\.js$/, '');
  task.naive = read(`${stem}.naive.fixture.txt`);
  task.correct = read(`${stem}.correct.fixture.txt`);
  task.stub = `module.exports = function ${task.export}() {\n  throw new Error('not implemented');\n};\n`;
  task.placebo_of = PLACEBO_SOURCE[task.id];
  task.placebo_memory_id = `f14v4-${task.id}-placebo`;
  // The product verifier compares returned values only; every v4 case returns a value, so all of them run in both checkers.
  task.verifier_checks = task.cases
    .filter((item) => !item.throws)
    .map((item, index) => ({ id: `c${index + 1}`, path: task.file, export_name: 'default', args: item.args, expected: item.expected }));
}
for (const task of TASKS) task.placebo_note = `${PLACEBO_PREFIX}${TASKS.find((other) => other.id === task.placebo_of).note}`;

/** Runs the protected cases against candidate source text, in a child process with a minimal environment. */
function runProtected(task, source, { timeoutMs = 10_000 } = {}) {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f14v4-protected-'));
  try {
    const candidate = path.join(scratch, task.file);
    fs.writeFileSync(candidate, source);
    const run = spawnSync(process.execPath, [path.join(__dirname, 'protected-runner.cjs'), candidate, JSON.stringify(task.cases)], {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { PATH: process.env.PATH, TMPDIR: scratch },
      cwd: scratch,
    });
    let results = null;
    try {
      results = JSON.parse((run.stdout || '').trim().split('\n').at(-1));
    } catch (error) {
      results = null;
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (!Array.isArray(results) || results.length !== task.cases.length)
      return { pass: false, passed: 0, total: task.cases.length, failed: ['runner-failed'], results: [] };
    const failed = results.filter((item) => !item.pass).map((item) => item.id);
    return { pass: failed.length === 0, passed: results.length - failed.length, total: results.length, failed, results };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Filter (i): the naive reference must FAIL the protected tests and the correct one must PASS, offline, at no cost. */
function runFilter() {
  const tasks = TASKS.map((task) => {
    const naive = runProtected(task, task.naive);
    const correct = runProtected(task, task.correct);
    const stub = runProtected(task, task.stub);
    return {
      id: task.id,
      naive: { pass: naive.pass, passed: naive.passed, total: naive.total, failed: naive.failed },
      correct: { pass: correct.pass, passed: correct.passed, total: correct.total, failed: correct.failed },
      stub_fails: !stub.pass,
      accepted: !naive.pass && correct.pass && !stub.pass,
    };
  });
  return { filter: 'i-naive-fails-correct-passes', accepted: tasks.every((item) => item.accepted), tasks };
}

module.exports = { TASKS, PLACEBO_PREFIX, PLACEBO_SOURCE, runProtected, runFilter };

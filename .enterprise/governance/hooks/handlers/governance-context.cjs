'use strict';

// Dependency-free: copied intact into .agents/hooks/handlers by the compiler.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sessionState } = require('./governance-context-state.cjs');

const REQUIRED = [
  '.enterprise/.specs/constitution/Enterprise-Constitution.md',
  '.enterprise/.specs/core/_INDEX.md',
  '.enterprise/policies/specification-consumption.md',
  '.enterprise/policies/automated-validation.md',
  '.enterprise/policies/governance-discovery.md',
];

function producerRoot() {
  // Resolve from the installed handler, never from an unrelated consumer cwd.
  let current = __dirname;
  while (path.dirname(current) !== current) {
    if (fs.existsSync(path.join(current, '.enterprise', '.specs', 'constitution'))) return current;
    current = path.dirname(current);
  }
  throw new Error('Governance producer unresolved; discovery incomplete, not absent.');
}

function inspect(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.trim()) throw new Error('empty source');
    return { path: file, status: 'read', sha256: crypto.createHash('sha256').update(content).digest('hex') };
  } catch {
    return { path: file, status: 'unavailable' };
  }
}

function corpusFingerprint(producer, optional = false) {
  const rows = [];
  let bytes = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.md')) {
        if (!entry.isFile()) throw new Error('Governance corpus contains a non-regular document');
        bytes += fs.statSync(file).size;
        if (rows.length >= 2048 || bytes > 8 * 1024 * 1024) throw new Error('Governance corpus exceeds discovery bounds');
        const source = inspect(file);
        if (source.status !== 'read') throw new Error(`Governance source unavailable: ${file}`);
        rows.push([path.relative(producer, file), source.sha256]);
      }
    }
  }
  for (const name of ['.specs', 'policies']) {
    const directory = path.join(producer, '.enterprise', name);
    if (!optional || fs.existsSync(directory)) walk(directory);
  }
  return { sha256: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'), files: rows.length };
}

// A session cwd can vanish under a live session (e.g. a removed git worktree).
// That is an environment fault, not missing governance: resolve the nearest
// existing ancestor so ancestor adapters and producer checks still apply.
function consumerRoot(directory) {
  let current = path.resolve(directory);
  while (!fs.existsSync(current) && path.dirname(current) !== current) current = path.dirname(current);
  return fs.realpathSync(current);
}

function collect({ directory = process.cwd(), sourceRoot = producerRoot() } = {}) {
  const project = consumerRoot(directory);
  if (!fs.statSync(project).isDirectory()) throw new Error('Consumer must be a directory');
  const producer = fs.realpathSync(sourceRoot);
  const sources = REQUIRED.map((file) => inspect(path.join(producer, file)));
  const policy = sources.at(-1);
  const adapters = [];
  let scope = project;
  while (true) {
    adapters.push(...['AGENTS.md', 'CLAUDE.md'].map((file) => inspect(path.join(scope, file))));
    if (path.dirname(scope) === scope) break;
    scope = path.dirname(scope);
  }
  let corpus;
  let consumerCorpus;
  try {
    corpus = corpusFingerprint(producer);
    consumerCorpus = project === producer ? corpus : corpusFingerprint(project, true);
  } catch (error) {
    corpus = { error: error.message };
  }
  return {
    schema_version: 1,
    project_root: project,
    producer_root: producer,
    status: sources.every((source) => source.status === 'read') && !corpus.error ? 'resolved' : 'incomplete',
    sources,
    consumer_adapters: adapters,
    corpus,
    consumer_corpus: consumerCorpus,
    application: 'not_verified',
    enforcement: 'not_verified',
    other_producers: 'not_verified',
    context: policy.status === 'read' ? fs.readFileSync(policy.path, 'utf8') : 'Discovery incomplete; do not infer absence.',
  };
}

function render(report) {
  if (report.status === 'resolved') {
    const capsule = report.context.match(/<!-- injection-capsule:start -->\n([\s\S]*?)\n<!-- injection-capsule:end -->/);
    if (!capsule) throw new Error('Governance injection capsule unavailable');
    return `[GOVERNANCE-CONTEXT] G=${report.producer_root}\n${capsule[1]}`;
  }
  return [
    `[GOVERNANCE-CONTEXT] ${report.status}; consumer=${report.project_root}; producer=${report.producer_root}`,
    ...report.sources.map((source) => `${source.status}: ${source.path}`),
    'Consumer application/enforcement and other producers: not verified.',
    report.corpus.error || 'Discovery incomplete; do not infer absence.',
  ].join('\n');
}

function fingerprint(report) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        report.project_root,
        report.producer_root,
        report.corpus,
        report.consumer_corpus,
        report.sources,
        report.consumer_adapters,
        inspect(__filename).sha256,
        inspect(path.join(__dirname, 'governance-context-state.cjs')).sha256,
      ]),
    )
    .digest('hex');
}

// --cache is opt-in and requires matching lifecycle hooks. No prompt/transcript
// contents are persisted. Standalone/manual discovery always emits its context.
if (require.main === module) {
  try {
    const input = fs.readFileSync(0, 'utf8');
    const payload = input.trim() ? JSON.parse(input) : {};
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid hook payload');
    const eventIndex = process.argv.indexOf('--event');
    const event = eventIndex === -1 ? payload.hook_event_name || 'UserPromptSubmit' : process.argv[eventIndex + 1];
    if (!['UserPromptSubmit', 'SessionStart', 'PreCompact', 'SessionEnd'].includes(event)) throw new Error('Unsupported hook event');
    const jsonHook = process.argv.includes('--json-hook');
    let state;
    if (process.argv.includes('--cache')) {
      try {
        state = sessionState(payload.session_id, jsonHook ? 'codex' : 'claude-code');
      } catch {
        // Cache failures must never suppress the capsule or bypass source checks.
        state = null;
      }
    }
    if (event !== 'UserPromptSubmit') {
      if (!state) throw new Error('Cannot invalidate context without usable session state');
      state.invalidate();
      state = sessionState(payload.session_id, jsonHook ? 'codex' : 'claude-code');
    }
    if (event === 'UserPromptSubmit' || event === 'SessionStart') {
      const report = collect({ directory: payload.cwd || process.cwd() });
      if (report.status === 'resolved') {
        const context = render(report);
        const digest = fingerprint(report);
        let unchanged = false;
        try {
          unchanged = state?.matches(digest) || false;
        } catch {
          /* Re-emit if state is corrupt. */
        }
        if (!unchanged) {
          const output = jsonHook ? JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) : context;
          process.stdout.write(`${output}\n`, () => {
            try {
              state?.remember(digest);
            } catch {
              /* Re-emit on the next prompt. */
            }
          });
        }
      } else {
        process.stderr.write(`${render(report)}\n`);
        process.exitCode = 2;
      }
    }
  } catch (error) {
    process.stderr.write(`[GOVERNANCE-CONTEXT] Discovery incomplete: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { REQUIRED, collect, consumerRoot, render, fingerprint };

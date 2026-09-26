const fs = require('node:fs');
const path = require('node:path');
const { globSync } = require('glob');
const YAML = require('yaml');
const { loadWorkflowCatalog } = require('../lib/workflow-catalog');

const SUPPORTED_PROFILES = new Set(['core', 'release', 'runtime', 'full']);

function getRepoRoot() {
  return path.resolve(__dirname, '../../..');
}

function loadRegistry() {
  return loadWorkflowCatalog(getRepoRoot());
}

function resolveTargetRepo(repoOption) {
  return path.resolve(process.cwd(), repoOption || '.');
}

function hasProfile(check, profile) {
  const profiles = check.profiles || [];
  if (profile === 'full') {
    return true;
  }

  return profiles.includes(profile);
}

function checkCommandExists(command) {
  const envPath = process.env.PATH || '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

  for (const entry of envPath.split(path.delimiter)) {
    if (!entry) {
      continue;
    }

    for (const ext of extensions) {
      const candidate = path.join(entry, `${command}${ext}`);
      if (fs.existsSync(candidate)) {
        return true;
      }
    }
  }

  return false;
}

function readPackageJson(repoRoot, packagePath = 'package.json') {
  const filePath = path.join(repoRoot, packagePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYamlObject(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return YAML.parse(fs.readFileSync(filePath, 'utf8')) || {};
}

function readNestedValue(value, dottedKey) {
  return String(dottedKey)
    .split('.')
    .reduce((current, key) => (current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined), value);
}

function runCheck(repoRoot, check) {
  switch (check.kind) {
    case 'git_repo': {
      return {
        passed: fs.existsSync(path.join(repoRoot, '.git')),
        evidence: '.git',
      };
    }
    case 'path_exists': {
      return {
        passed: fs.existsSync(path.join(repoRoot, check.path)),
        evidence: check.path,
      };
    }
    case 'any_path_exists': {
      const found = (check.paths || []).find((entry) => fs.existsSync(path.join(repoRoot, entry)));
      return {
        passed: Boolean(found),
        evidence: found || (check.paths || []).join(', '),
      };
    }
    case 'glob_exists': {
      const matches = globSync(check.glob, {
        cwd: repoRoot,
        nodir: false,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
      return {
        passed: matches.length > 0,
        evidence: matches[0] || check.glob,
      };
    }
    case 'command_exists': {
      return {
        passed: checkCommandExists(check.command),
        evidence: check.command,
      };
    }
    case 'package_script': {
      const packageJson = readPackageJson(repoRoot, check.path || 'package.json');
      const scripts = packageJson?.scripts || {};
      const missing = (check.scripts || []).filter((script) => !scripts[script]);
      return {
        passed: missing.length === 0,
        evidence: missing.length === 0 ? (check.scripts || []).join(', ') : `missing: ${missing.join(', ')}`,
      };
    }
    case 'config_flag': {
      const config = readYamlObject(repoRoot, check.path);
      return {
        passed: readNestedValue(config, check.key) === true,
        evidence: `${check.path}:${check.key}`,
      };
    }
    case 'env_var': {
      return {
        passed: typeof process.env[check.var] === 'string' && process.env[check.var].length > 0,
        evidence: check.var,
      };
    }
    default: {
      return {
        passed: false,
        evidence: `unsupported check kind: ${check.kind}`,
      };
    }
  }
}

function buildValidationResult(workflow, repoRoot, profile) {
  const results = [];

  for (const check of workflow.checks || []) {
    if (!hasProfile(check, profile)) {
      continue;
    }

    const outcome = runCheck(repoRoot, check);
    results.push({
      id: check.id,
      required: Boolean(check.required),
      passed: outcome.passed,
      evidence: outcome.evidence,
      prepare: check.prepare || '',
    });
  }

  return results;
}

function evaluateReadiness(workflow, repoRoot, profile, workflows) {
  const dependencyResults = [];

  for (const dependency of workflow.depends_on || []) {
    if (!hasProfile(dependency, profile)) {
      continue;
    }

    const dependencyWorkflow = workflows.find((entry) => entry.id === dependency.workflow);
    if (!dependencyWorkflow) {
      dependencyResults.push({
        id: `depends-on:${dependency.workflow}`,
        required: true,
        passed: false,
        evidence: dependency.workflow,
        prepare: `Register the dependent workflow '${dependency.workflow}' before using '${workflow.id}'.`,
      });
      continue;
    }

    const nestedResults = buildValidationResult(dependencyWorkflow, repoRoot, profile);
    for (const result of nestedResults) {
      dependencyResults.push({
        ...result,
        id: `${dependency.workflow}/${result.id}`,
      });
    }
  }

  return [...dependencyResults, ...buildValidationResult(workflow, repoRoot, profile)];
}

function getRunsDir(workflow, repoRoot) {
  const configured = workflow.state?.runs_dir || path.join('.hseos', 'runs', workflow.id);
  return path.join(repoRoot, configured);
}

function getRunPath(workflow, repoRoot, runId) {
  return path.join(getRunsDir(workflow, repoRoot), `${runId}.yaml`);
}

function printEpicSummary(runState) {
  if (runState.workflow_id !== 'epic-delivery') {
    return;
  }

  console.log('');
  console.log(`Epic: ${runState.epic_id || 'n/a'} ${runState.epic_title || ''}`.trim());
  console.log(`Stories: ${(runState.stories || []).length}`);
  for (const story of runState.stories || []) {
    const commitSuffix = story.commit ? ` [${story.commit}]` : '';
    console.log(`- ${story.id} (${story.status}) ${story.title}${commitSuffix}`);
  }
}

function printRunStatus(workflow, runState, runPath) {
  console.log(`Workflow: ${workflow.id}`);
  console.log(`Run: ${runState.run_id}`);
  console.log(`Status: ${runState.status}`);
  console.log(`Repository: ${runState.repo_root}`);
  console.log(`Profile: ${runState.profile}`);
  console.log(`Run file: ${runPath}`);
  console.log('');
  console.log(`Current phase: ${runState.current_phase || 'completed'}`);
  console.log(`Current agent: ${runState.current_agent || 'none'}`);
  console.log('');
  console.log('Phases:');
  for (const phase of runState.phases || []) {
    console.log(`- ${phase.id} (${phase.agent}) -> ${phase.status}`);
  }
  printEpicSummary(runState);
}

function printList(workflows) {
  console.log('HSEOS methodology recipes and optional subsystems:\n');
  for (const workflow of workflows) {
    console.log(`- ${workflow.id}`);
    console.log(`  owner: ${workflow.owner}`);
    console.log(`  profiles: ${(workflow.profiles || []).join(', ')}`);
    console.log(`  entrypoint: ${workflow.entrypoint}`);
    console.log(`  ${workflow.description}`);
  }
}

function printValidation(workflow, repoRoot, profile, results) {
  const requiredFailures = results.filter((entry) => entry.required && !entry.passed);
  const recommendedFailures = results.filter((entry) => !entry.required && !entry.passed);

  console.log(`Workflow: ${workflow.id}`);
  console.log(`Repository: ${repoRoot}`);
  console.log(`Profile: ${profile}`);
  console.log('');

  if (results.length === 0) {
    console.log('No checks defined for the selected profile.');
    return requiredFailures.length === 0;
  }

  console.log('Checks:');
  for (const result of results) {
    const status = result.passed ? 'PASS' : result.required ? 'FAIL' : 'WARN';
    const tier = result.required ? 'required' : 'recommended';
    console.log(`- [${status}] ${result.id} (${tier})`);
    console.log(`  evidence: ${result.evidence}`);
    if (!result.passed && result.prepare) {
      console.log(`  next: ${result.prepare}`);
    }
  }

  console.log('');
  if (requiredFailures.length > 0) {
    console.log('Readiness: BLOCKED');
    console.log('Missing required prerequisites:');
    for (const failure of requiredFailures) {
      console.log(`- ${failure.id}: ${failure.prepare}`);
    }
    return false;
  }

  console.log('Readiness: READY');
  if (recommendedFailures.length > 0) {
    console.log('Recommended follow-up before broader automation:');
    for (const failure of recommendedFailures) {
      console.log(`- ${failure.id}: ${failure.prepare}`);
    }
  }

  return true;
}

module.exports = {
  command: 'workflow [action] [workflowId]',
  description: 'Execute bounded task graphs or inspect methodology recipes and legacy runs',
  options: [
    ['--output <path>', 'New JSON definition destination for explicit migration'],
    ['--definition <path>', 'Executable engineering workflow JSON definition'],
    ['--state <path>', 'Canonical workflow state directory'],
    ['--expected-sequence <number>', 'Optimistic sequence required for resume'],
    ['--reconciliation-decisions <path>', 'Explicit reconciliation answers keyed by workflow task id'],
    ['--create-only', 'Prepare a new workflow without executing tasks'],
    ['--json', 'Emit a JSON receipt'],
    ['--repo <path>', 'Repository for recipe readiness or legacy inspection'],
    ['--profile <profile>', 'Recipe readiness profile: core, release, runtime, or full', 'core'],
    ['--run-id <id>', 'Legacy v3 run identifier (read-only)'],
    ['--epic-id <id>', 'Retired v3 option; see the v4 migration guide'],
    ['--title <text>', 'Retired v3 option'],
    ['--note <text>', 'Retired v3 option'],
    ['--gate <name>', 'Retired v3 option'],
    ['--gate-status <status>', 'Retired v3 option'],
    ['--story-id <id>', 'Retired v3 option'],
    ['--story-status <status>', 'Retired v3 option'],
    ['--commit <sha>', 'Retired v3 option'],
    ['--from-phase <id>', 'Retired v3 option'],
    ['--dry-run', 'Retired v3 option'],
    ['--no-deploy', 'Retired v3 option'],
    ['--no-runtime', 'Retired v3 option'],
    ['--cooldown <seconds>', 'Retired v3 option'],
  ],
  async action(action = 'list', workflowId, options = {}) {
    if (options.reconciliationDecisions && action !== 'resume') throw new Error('Reconciliation decisions apply only to resume');
    if (
      ['init', 'sync', 'batch', 'advance', 'gate', 'story-status', 'story-commit'].includes(action) ||
      (action === 'resume' && options.runId)
    ) {
      throw new Error(
        'V4_WORKFLOW_MIGRATION_REQUIRED: v3 YAML runs are read-only. Preserve the old run, bind a new executable definition, validate it and start workflow run --definition. See docs/v4-migration.md.',
      );
    }
    if (options.definition || options.state || action === 'run' || action === 'cancel' || action === 'resume') {
      const runtime = require('../lib/engineering-workflow-runtime');
      let result;
      if (action === 'migrate') {
        if (!options.definition || !options.output || options.state || workflowId)
          throw new Error('workflow migrate requires --definition and --output only');
        result = runtime.migrateEngineeringWorkflow({ source: options.definition, output: options.output });
      } else if (options.definition && ['validate', 'run'].includes(action)) {
        if (options.state || workflowId) throw new Error('Definition operations do not accept a state or recipe id');
        const definition = runtime.readEngineeringWorkflow(options.definition);
        if (action === 'validate') {
          const parsed = runtime.parseEngineeringWorkflow(definition);
          result = {
            schema_version: 1,
            workflow_id: parsed.definition.workflow_id,
            status: 'structurally-valid',
            tasks: parsed.definition.tasks.length,
            execution_authorized: false,
          };
        } else result = await runtime.runEngineeringWorkflow({ definition, createOnly: options.createOnly === true });
      } else if (options.state && ['status', 'resume', 'cancel', 'reconcile'].includes(action)) {
        if (options.definition || workflowId) throw new Error('State operations do not accept a definition or recipe id');
        const expected = options.expectedSequence === undefined ? undefined : Number(options.expectedSequence);
        if (expected !== undefined && (!/^\d+$/.test(options.expectedSequence) || !Number.isSafeInteger(expected)))
          throw new Error('Invalid expected sequence');
        result = await runtime.inspectEngineeringWorkflow({
          state: options.state,
          action,
          expectedSequence: expected,
          reconciliationDecisions: options.reconciliationDecisions
            ? require('../lib/engineering-reconciliation').readReconciliationDecision(options.reconciliationDecisions, true)
            : undefined,
        });
      } else throw new Error('workflow run/validate requires --definition; status/resume/cancel requires --state');
      console.log(
        options.json
          ? JSON.stringify(result)
          : `Workflow ${result.workflow_id}: ${result.status}\nState: ${result.state || '(not created)'}${(result.questions || []).map((question) => `\nPergunta pendente: ${question}`).join('')}\n${result.reconciliations ? JSON.stringify(result.reconciliations) : ''}`,
      );
      if (['failed', 'blocked', 'cancelling'].includes(result.status)) process.exitCode = 1;
      return result;
    }
    const workflows = loadRegistry();
    if (action === 'list') {
      printList(workflows);
      return;
    }
    const workflow = workflows.find((entry) => entry.id === workflowId);
    if (!workflow) throw new Error(`Unknown recipe or subsystem: ${workflowId || '(missing)'}`);
    const repoRoot = resolveTargetRepo(options.repo);
    if (action === 'validate') {
      if (!SUPPORTED_PROFILES.has(options.profile)) throw new Error(`Unsupported profile: ${options.profile}`);
      process.exitCode = printValidation(
        workflow,
        repoRoot,
        options.profile,
        evaluateReadiness(workflow, repoRoot, options.profile, workflows),
      )
        ? 0
        : 2;
      return;
    }
    if (action === 'status' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.runId || '')) {
      const runPath = getRunPath(workflow, repoRoot, options.runId);
      const fd = fs.openSync(runPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_048_576) throw new Error('Invalid legacy run file');
        const data = Buffer.alloc(1_048_577);
        const size = fs.readSync(fd, data, 0, data.length, 0);
        if (size !== stat.size) throw new Error('Legacy run changed during inspection');
        const run = YAML.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, size)));
        if (options.json) console.log(JSON.stringify({ legacy: true, resumable: false, run }));
        else {
          console.log('Legacy v3 run (read-only; cannot resume in v4)');
          printRunStatus(workflow, run, runPath);
        }
      } finally {
        fs.closeSync(fd);
      }
      return;
    }
    throw new Error(
      'Use list, validate, run, status, resume or cancel. Methodology recipes require bound task definitions before execution.',
    );
  },
};

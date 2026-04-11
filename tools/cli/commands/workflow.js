const fs = require('node:fs');
const path = require('node:path');
const { globSync } = require('glob');
const YAML = require('yaml');

const SUPPORTED_PROFILES = new Set(['core', 'release', 'runtime', 'full']);
const DEFAULT_NOTE = 'Phase advanced without additional note.';

function getRepoRoot() {
  return path.resolve(__dirname, '../../..');
}

function getRegistryPath() {
  return path.join(getRepoRoot(), '.hseos', 'workflows', 'registry.yaml');
}

function loadRegistry() {
  const content = fs.readFileSync(getRegistryPath(), 'utf8');
  const data = YAML.parse(content);
  return data?.workflows || [];
}

function nowIso() {
  return new Date().toISOString();
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

function getBatchPacketDir(workflow, repoRoot, runId) {
  const configured = workflow.batch?.packet_dir || path.join('.hseos', 'batch-packets', workflow.id);
  return path.join(repoRoot, configured, runId);
}

function getBatchLogDir(workflow, repoRoot, runId) {
  const configured = workflow.batch?.log_dir || path.join('.logs', 'runs', 'workflows', workflow.id);
  return path.join(repoRoot, configured, runId);
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function createPhaseState(workflow) {
  return (workflow.phases || []).map((phase, index) => ({
    id: phase.id,
    name: phase.name,
    agent: phase.agent,
    supporting_agents: phase.supporting_agents || [],
    outputs: phase.outputs || [],
    status: index === 0 ? 'in_progress' : 'pending',
    started_at: index === 0 ? nowIso() : '',
    completed_at: '',
    notes: [],
  }));
}

function loadTemplate(repoRoot, workflow) {
  const templatePath = workflow.state?.template ? path.join(repoRoot, workflow.state.template) : null;
  if (!templatePath || !fs.existsSync(templatePath)) {
    return {};
  }

  return YAML.parse(fs.readFileSync(templatePath, 'utf8')) || {};
}

function writeYaml(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, YAML.stringify(value), 'utf8');
}

function readRunState(filePath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function findFirstExistingPath(repoRoot, candidates) {
  for (const candidate of candidates) {
    const resolvedPath = path.join(repoRoot, candidate);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

function loadEpicSpec(repoRoot, epicId) {
  const planningFile = findFirstExistingPath(repoRoot, [
    '.bmad-output/planning-artifacts/epics-v3.md',
    '.bmad-output/planning-artifacts/epics-v2.md',
    '.bmad-output/planning-artifacts/epics.md',
  ]);

  if (!planningFile) {
    return null;
  }

  const content = fs.readFileSync(planningFile, 'utf8');
  const escapedEpicId = String(epicId).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const epicPattern = new RegExp(`## Epic ${escapedEpicId} — ([^\\n]+)\\n([\\s\\S]*?)(?=\\n## Epic \\d+ — |$)`, 'm');
  const epicMatch = epicPattern.exec(content);

  if (!epicMatch) {
    return null;
  }

  const [, epicTitle, epicBody] = epicMatch;
  const storyPattern = new RegExp(`### Story ${escapedEpicId}\\.(\\d+) — ([^\\n]+)`, 'g');
  const stories = [];

  let storyMatch;
  while ((storyMatch = storyPattern.exec(epicBody)) !== null) {
    const storyNumber = storyMatch[1];
    const storyTitle = storyMatch[2].trim();
    const storySlug = slugify(storyTitle);
    stories.push({
      id: `${epicId}.${storyNumber}`,
      key: `${epicId}-${storyNumber}`,
      title: storyTitle,
      slug: storySlug,
      status: 'pending',
      file: `.bmad-output/implementation-artifacts/${epicId}-${storyNumber}-${storySlug}.md`,
      commit: '',
    });
  }

  return {
    planningFile: path.relative(repoRoot, planningFile),
    title: epicTitle.trim(),
    stories,
  };
}

function syncSprintStatus(repoRoot, epicId, stories) {
  const sprintStatusPath = path.join(repoRoot, '.bmad-output', 'implementation-artifacts', 'sprint-status.yaml');
  let sprintStatus = {
    generated: new Date().toISOString().slice(0, 10),
    last_updated: new Date().toISOString().slice(0, 10),
    project: path.basename(repoRoot),
    project_key: 'NOKEY',
    tracking_system: 'file-system',
    story_location: '.bmad-output/implementation-artifacts',
    development_status: {},
  };

  if (fs.existsSync(sprintStatusPath)) {
    sprintStatus = YAML.parse(fs.readFileSync(sprintStatusPath, 'utf8')) || sprintStatus;
    sprintStatus.development_status = sprintStatus.development_status || {};
  }

  let mutated = false;
  const epicKey = `epic-${epicId}`;
  if (!sprintStatus.development_status[epicKey]) {
    sprintStatus.development_status[epicKey] = 'backlog';
    mutated = true;
  }

  for (const story of stories) {
    const storyKey = `${story.key}-${story.slug}`;
    if (!sprintStatus.development_status[storyKey]) {
      sprintStatus.development_status[storyKey] = 'backlog';
      mutated = true;
    }
  }

  if (mutated) {
    sprintStatus.last_updated = new Date().toISOString().slice(0, 10);
    writeYaml(sprintStatusPath, sprintStatus);
  }

  return {
    path: path.relative(repoRoot, sprintStatusPath),
    mutated,
  };
}

function resolveSprintStatusPath(runState, repoRoot) {
  const artifactPath = runState.artifacts?.sprint_status;
  if (artifactPath) {
    return path.join(repoRoot, artifactPath);
  }

  return path.join(repoRoot, '.bmad-output', 'implementation-artifacts', 'sprint-status.yaml');
}

function readSprintStatusMap(repoRoot, runState) {
  const sprintStatusPath = resolveSprintStatusPath(runState, repoRoot);
  if (!fs.existsSync(sprintStatusPath)) {
    return {};
  }

  const sprintStatus = YAML.parse(fs.readFileSync(sprintStatusPath, 'utf8')) || {};
  return sprintStatus.development_status || {};
}

function computeEpicAggregateStatus(stories) {
  if (stories.length === 0) {
    return 'backlog';
  }

  if (stories.every((story) => story.status === 'done')) {
    return 'done';
  }

  if (stories.every((story) => story.status === 'backlog')) {
    return 'backlog';
  }

  return 'in-progress';
}

function inferPhaseFromRunState(runState) {
  const stories = runState.stories || [];
  const gates = runState.gates || {};

  if (stories.some((story) => story.status !== 'done')) {
    return 'implementation';
  }

  if (stories.length > 0 && stories.every((story) => story.status === 'done') && gates.tests !== 'pass') {
    return 'validation';
  }

  if (gates.tests === 'pass' && gates.publish !== 'pass') {
    return 'publish';
  }

  if (gates.publish === 'pass' && gates.runtime !== 'pass') {
    return 'runtime';
  }

  if (gates.runtime === 'pass') {
    return 'consolidation';
  }

  return 'scope';
}

function alignRunPhases(runState, targetPhaseId) {
  const phases = runState.phases || [];
  const phaseIndex = phases.findIndex((phase) => phase.id === targetPhaseId);
  if (phaseIndex === -1) {
    return;
  }

  for (const [index, phase] of phases.entries()) {
    if (index < phaseIndex) {
      phase.status = 'completed';
      phase.completed_at = phase.completed_at || nowIso();
    } else if (index === phaseIndex) {
      phase.status = 'in_progress';
      phase.started_at = phase.started_at || nowIso();
    } else {
      phase.status = 'pending';
      phase.started_at = phase.started_at || '';
      phase.completed_at = '';
    }
  }

  runState.phase_index = phaseIndex;
  runState.current_phase = phases[phaseIndex].id;
  runState.current_agent = phases[phaseIndex].agent;
  runState.phases_completed = phases.slice(0, phaseIndex).map((phase) => phase.id);
  runState.status = 'in_progress';
  runState.last_updated = nowIso();
}

function updateSprintStatusForStory(repoRoot, runState, story) {
  const sprintStatusPath = resolveSprintStatusPath(runState, repoRoot);
  if (!fs.existsSync(sprintStatusPath)) {
    return null;
  }

  const sprintStatus = YAML.parse(fs.readFileSync(sprintStatusPath, 'utf8')) || {};
  sprintStatus.development_status = sprintStatus.development_status || {};

  const epicKey = `epic-${runState.epic_id}`;
  const storyKey = `${story.key}-${story.slug}`;
  sprintStatus.development_status[storyKey] = story.status;
  sprintStatus.development_status[epicKey] = computeEpicAggregateStatus(runState.stories || []);
  sprintStatus.last_updated = new Date().toISOString().slice(0, 10);
  writeYaml(sprintStatusPath, sprintStatus);
  return path.relative(repoRoot, sprintStatusPath);
}

function updateStoryState(runState, storyId, updates) {
  const stories = runState.stories || [];
  const story = stories.find((entry) => entry.id === storyId || entry.key === storyId);
  if (!story) {
    return null;
  }

  Object.assign(story, updates);
  runState.last_updated = nowIso();
  runState.history = [
    ...(runState.history || []),
    {
      at: nowIso(),
      event: 'story-updated',
      story: story.id,
      by: runState.current_agent || runState.owner,
      note: Object.entries(updates)
        .map(([key, value]) => `${key}=${value}`)
        .join(', '),
    },
  ];
  return story;
}

function syncStoriesFromArtifacts(repoRoot, runState) {
  if (runState.workflow_id !== 'epic-delivery' || !runState.epic_id) {
    return { synced: false, count: 0 };
  }

  const epicSpec = loadEpicSpec(repoRoot, runState.epic_id);
  if (!epicSpec) {
    return { synced: false, count: 0 };
  }

  const existingStories = new Map((runState.stories || []).map((story) => [story.id, story]));
  const sprintMap = readSprintStatusMap(repoRoot, runState);
  const mergedStories = epicSpec.stories.map((story) => {
    const existing = existingStories.get(story.id) || {};
    const sprintKey = `${story.key}-${story.slug}`;
    return {
      ...story,
      status: sprintMap[sprintKey] || existing.status || story.status,
      commit: existing.commit || '',
    };
  });

  runState.epic_title = runState.epic_title || epicSpec.title;
  runState.stories = mergedStories;
  runState.artifacts = {
    ...runState.artifacts,
    epic_spec: epicSpec.planningFile,
  };

  const suggestedPhase = inferPhaseFromRunState(runState);
  alignRunPhases(runState, suggestedPhase);
  runState.history = [
    ...(runState.history || []),
    {
      at: nowIso(),
      event: 'stories-synced',
      by: 'ORBIT',
      note: `Synchronized ${mergedStories.length} stories from planning artifacts and sprint status. Suggested phase: ${suggestedPhase}.`,
    },
  ];

  return { synced: true, count: mergedStories.length, phase: suggestedPhase };
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

function initializeRunState(workflow, repoRoot, runId, profile, options) {
  const template = loadTemplate(repoRoot, workflow);
  const phases = createPhaseState(workflow);
  const firstPhase = phases[0] || null;

  return {
    ...template,
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    run_id: runId,
    owner: workflow.owner,
    repo_root: repoRoot,
    profile,
    status: firstPhase ? 'in_progress' : 'completed',
    started_at: nowIso(),
    last_updated: nowIso(),
    current_phase: firstPhase?.id || '',
    current_agent: firstPhase?.agent || '',
    phase_index: firstPhase ? 0 : -1,
    phases_completed: [],
    phases,
    epic_id: options.epicId || template.epic_id || '',
    epic_title: options.title || template.epic_title || '',
    notes: [],
    history: [
      {
        at: nowIso(),
        event: 'initialized',
        by: workflow.owner,
        note: `Run created with profile ${profile}.`,
      },
    ],
  };
}

function enrichEpicDeliveryRunState(runState, repoRoot, options) {
  if (runState.workflow_id !== 'epic-delivery' || !options.epicId) {
    return runState;
  }

  const epicSpec = loadEpicSpec(repoRoot, options.epicId);
  if (!epicSpec) {
    runState.notes = [
      ...(runState.notes || []),
      `Epic ${options.epicId} not found in planning artifacts.`,
    ];
    return runState;
  }

  const sprintStatus = syncSprintStatus(repoRoot, options.epicId, epicSpec.stories);
  runState.epic_id = String(options.epicId);
  runState.epic_title = options.title || epicSpec.title;
  runState.stories = epicSpec.stories;
  runState.artifacts = {
    ...runState.artifacts,
    epic_spec: epicSpec.planningFile,
    sprint_status: sprintStatus.path,
  };
  runState.history = [
    ...(runState.history || []),
    {
      at: nowIso(),
      event: 'epic-synced',
      by: 'ORBIT',
      note: `Loaded ${epicSpec.stories.length} stories from ${epicSpec.planningFile}. Sprint status ${sprintStatus.mutated ? 'updated' : 'already aligned'}.`,
    },
  ];
  return runState;
}

function advanceRunState(runState, note) {
  const currentIndex = runState.phase_index;
  if (currentIndex < 0 || currentIndex >= (runState.phases || []).length) {
    return { advanced: false, reason: 'Run has no active phase.' };
  }

  const currentPhase = runState.phases[currentIndex];
  currentPhase.status = 'completed';
  currentPhase.completed_at = nowIso();
  currentPhase.notes = [...(currentPhase.notes || []), note];

  runState.phases_completed = [...(runState.phases_completed || []), currentPhase.id];
  runState.history = [
    ...(runState.history || []),
    {
      at: nowIso(),
      event: 'phase-completed',
      phase: currentPhase.id,
      by: currentPhase.agent,
      note,
    },
  ];

  const nextPhase = runState.phases[currentIndex + 1];
  if (!nextPhase) {
    runState.phase_index = -1;
    runState.current_phase = '';
    runState.current_agent = '';
    runState.status = 'completed';
    runState.last_updated = nowIso();
    runState.history.push({
      at: nowIso(),
      event: 'workflow-completed',
      by: runState.owner,
      note: 'All phases completed.',
    });
    return { advanced: true, completed: true, phase: currentPhase };
  }

  nextPhase.status = 'in_progress';
  nextPhase.started_at = nextPhase.started_at || nowIso();
  runState.phase_index = currentIndex + 1;
  runState.current_phase = nextPhase.id;
  runState.current_agent = nextPhase.agent;
  runState.status = 'in_progress';
  runState.last_updated = nowIso();
  runState.history.push({
    at: nowIso(),
    event: 'phase-started',
    phase: nextPhase.id,
    by: nextPhase.agent,
    note: `Handoff from ${currentPhase.id}.`,
  });
  return { advanced: true, completed: false, phase: currentPhase, nextPhase };
}

function setGateStatus(runState, gateName, gateStatus, note) {
  runState.gates = runState.gates || {};
  runState.gates[gateName] = gateStatus;
  runState.last_updated = nowIso();
  runState.history = [
    ...(runState.history || []),
    {
      at: nowIso(),
      event: 'gate-updated',
      gate: gateName,
      status: gateStatus,
      by: runState.current_agent || runState.owner,
      note,
    },
  ];
}

function buildBatchPhaseQueue(workflow, runState, options) {
  const phases = runState.phases || [];
  let startIndex = Math.max(runState.phase_index, 0);

  if (options.fromPhase) {
    const requestedIndex = phases.findIndex((phase) => phase.id === options.fromPhase);
    if (requestedIndex !== -1) {
      startIndex = requestedIndex;
    }
  } else if (workflow.batch?.handoff_after_phase) {
    const handoffIndex = phases.findIndex((phase) => phase.id === workflow.batch.handoff_after_phase);
    if (handoffIndex !== -1) {
      startIndex = Math.max(startIndex, handoffIndex + 1);
    }
  }

  return phases.slice(startIndex).filter((phase) => {
    if (options.noDeploy && ['publish', 'runtime'].includes(phase.id)) {
      return false;
    }

    if (options.noRuntime && phase.id === 'runtime') {
      return false;
    }

    return true;
  });
}

function emitBatchPackets(workflow, repoRoot, runState, options) {
  const phaseQueue = buildBatchPhaseQueue(workflow, runState, options);
  const packetDir = getBatchPacketDir(workflow, repoRoot, runState.run_id);
  const logDir = getBatchLogDir(workflow, repoRoot, runState.run_id);
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const logPath = path.join(logDir, `batch-${timestamp}.log`);

  ensureDirectory(packetDir);
  ensureDirectory(logDir);

  const summary = {
    workflow_id: workflow.id,
    run_id: runState.run_id,
    generated_at: nowIso(),
    repo_root: repoRoot,
    profile: runState.profile,
    current_phase: runState.current_phase,
    current_agent: runState.current_agent,
    queue: phaseQueue.map((phase) => ({
      id: phase.id,
      name: phase.name,
      agent: phase.agent,
      supporting_agents: phase.supporting_agents || [],
      outputs: phase.outputs || [],
    })),
    options: {
      dry_run: Boolean(options.dryRun),
      no_deploy: Boolean(options.noDeploy),
      no_runtime: Boolean(options.noRuntime),
      cooldown: Number(options.cooldown || 0),
    },
  };

  const packetFiles = [];
  for (const [index, phase] of phaseQueue.entries()) {
    const packet = {
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      run_id: runState.run_id,
      repo_root: repoRoot,
      profile: runState.profile,
      phase_order: index + 1,
      phase_id: phase.id,
      phase_name: phase.name,
      agent: phase.agent,
      supporting_agents: phase.supporting_agents || [],
      expected_outputs: phase.outputs || [],
      current_state: {
        current_phase: runState.current_phase,
        current_agent: runState.current_agent,
        gates: runState.gates || {},
        stories: runState.stories || [],
        artifacts: runState.artifacts || {},
      },
      instructions: [
        `Execute phase '${phase.id}' for workflow '${workflow.id}'.`,
        'Do not skip gates.',
        'Persist evidence back into the run-state after completion.',
      ],
    };

    const packetPath = path.join(packetDir, `${String(index + 1).padStart(2, '0')}-${phase.id}.json`);
    writeYaml(packetPath.replace(/\.json$/, '.yaml'), packet);
    packetFiles.push(packetPath.replace(/\.json$/, '.yaml'));
  }

  writeYaml(path.join(packetDir, 'batch-summary.yaml'), summary);
  fs.writeFileSync(
    logPath,
    [
      `workflow=${workflow.id}`,
      `run_id=${runState.run_id}`,
      `generated_at=${summary.generated_at}`,
      `queue=${summary.queue.map((phase) => phase.id).join(',')}`,
      `dry_run=${summary.options.dry_run}`,
      `no_deploy=${summary.options.no_deploy}`,
      `no_runtime=${summary.options.no_runtime}`,
      `cooldown=${summary.options.cooldown}`,
    ].join('\n'),
    'utf8',
  );

  return {
    packetDir,
    logPath,
    packetFiles,
    queue: summary.queue,
  };
}

function printList(workflows) {
  console.log('HSEOS workflows:\n');
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
  description: 'List HSEOS workflows or validate repository readiness for a workflow',
  options: [
    ['--repo <path>', 'Target repository path to validate (default: current directory)'],
    ['--profile <profile>', 'Validation profile: core, release, runtime, or full', 'core'],
    ['--run-id <id>', 'Run identifier for stateful workflow execution'],
    ['--epic-id <id>', 'Epic identifier when initializing epic-delivery'],
    ['--title <text>', 'Epic or workflow title for run-state metadata'],
    ['--note <text>', 'Evidence note when advancing the current phase'],
    ['--gate <name>', 'Gate name to update in the run-state'],
    ['--gate-status <status>', 'Gate status: pass, fail, warn, blocked'],
    ['--story-id <id>', 'Story identifier such as 17.1 or 17-1'],
    ['--story-status <status>', 'Story status: backlog, ready-for-dev, in-progress, review, done'],
    ['--commit <sha>', 'Commit SHA associated with a story update'],
    ['--from-phase <id>', 'Phase id to start batch packet generation from'],
    ['--dry-run', 'Generate batch packets without intending immediate execution'],
    ['--no-deploy', 'Exclude publish and runtime phases from batch packet generation'],
    ['--no-runtime', 'Exclude runtime phases from batch packet generation'],
    ['--cooldown <seconds>', 'Suggested cooldown between batch phases', '30'],
  ],
  action: async (action = 'list', workflowId, options) => {
    const workflows = loadRegistry();

    if (action === 'list') {
      printList(workflows);
      return;
    }

    if (!workflowId) {
      console.error('workflowId is required');
      process.exitCode = 1;
      return;
    }

    if (!SUPPORTED_PROFILES.has(options.profile)) {
      console.error(`Unsupported profile: ${options.profile}`);
      process.exitCode = 1;
      return;
    }

    const workflow = workflows.find((entry) => entry.id === workflowId);
    if (!workflow) {
      console.error(`Unknown workflow: ${workflowId}`);
      process.exitCode = 1;
      return;
    }

    const repoRoot = resolveTargetRepo(options.repo);
    if (!fs.existsSync(repoRoot)) {
      console.error(`Repository path does not exist: ${repoRoot}`);
      process.exitCode = 1;
      return;
    }

    if (action === 'validate') {
      const results = evaluateReadiness(workflow, repoRoot, options.profile, workflows);
      const ready = printValidation(workflow, repoRoot, options.profile, results);
      process.exitCode = ready ? 0 : 2;
      return;
    }

    if (action === 'init') {
      if (!options.runId) {
        console.error('--run-id is required for init');
        process.exitCode = 1;
        return;
      }

      const results = evaluateReadiness(workflow, repoRoot, options.profile, workflows);
      const ready = printValidation(workflow, repoRoot, options.profile, results);
      if (!ready) {
        process.exitCode = 2;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (fs.existsSync(runPath)) {
        console.error(`Run already exists: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      let runState = initializeRunState(workflow, repoRoot, options.runId, options.profile, options);
      runState = enrichEpicDeliveryRunState(runState, repoRoot, options);
      writeYaml(runPath, runState);
      console.log('');
      console.log(`Run initialized: ${runPath}`);
      console.log(`Current handoff: ${runState.current_phase} -> ${runState.current_agent}`);
      printEpicSummary(runState);
      return;
    }

    if (action === 'status') {
      if (!options.runId) {
        console.error('--run-id is required for status');
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      printRunStatus(workflow, runState, runPath);
      return;
    }

    if (action === 'sync') {
      if (!options.runId) {
        console.error('--run-id is required for sync');
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      const outcome = syncStoriesFromArtifacts(repoRoot, runState);
      writeYaml(runPath, runState);
      console.log(
        outcome.synced
          ? `Run synchronized: ${outcome.count} stories, suggested phase ${outcome.phase}`
          : 'No synchronization changes were applied.',
      );
      return;
    }

    if (action === 'resume') {
      if (!options.runId) {
        console.error('--run-id is required for resume');
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      const outcome = syncStoriesFromArtifacts(repoRoot, runState);
      writeYaml(runPath, runState);
      console.log(
        outcome.synced
          ? `Resume prepared: ${outcome.count} stories synchronized, handoff ${runState.current_phase} -> ${runState.current_agent}`
          : `Resume prepared: handoff ${runState.current_phase} -> ${runState.current_agent}`,
      );
      printRunStatus(workflow, runState, runPath);
      return;
    }

    if (action === 'batch') {
      if (!options.runId) {
        console.error('--run-id is required for batch');
        process.exitCode = 1;
        return;
      }

      if (!workflow.batch?.enabled) {
        console.error(`Workflow does not support batch handoff: ${workflow.id}`);
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      const outcome = emitBatchPackets(workflow, repoRoot, runState, options);
      console.log(`Batch packets emitted: ${outcome.packetDir}`);
      console.log(`Batch log: ${outcome.logPath}`);
      console.log(`Phases queued: ${outcome.queue.map((phase) => phase.id).join(', ') || '(none)'}`);
      return;
    }

    if (action === 'advance') {
      if (!options.runId) {
        console.error('--run-id is required for advance');
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      const outcome = advanceRunState(runState, options.note || DEFAULT_NOTE);
      if (!outcome.advanced) {
        console.error(outcome.reason);
        process.exitCode = 1;
        return;
      }

      writeYaml(runPath, runState);
      if (outcome.completed) {
        console.log(`Phase completed: ${outcome.phase.id}`);
        console.log('Workflow completed.');
        return;
      }

      console.log(`Phase completed: ${outcome.phase.id}`);
      console.log(`Current handoff: ${outcome.nextPhase.id} -> ${outcome.nextPhase.agent}`);
      return;
    }

    if (action === 'gate') {
      if (!options.runId) {
        console.error('--run-id is required for gate');
        process.exitCode = 1;
        return;
      }

      if (!options.gate || !options.gateStatus) {
        console.error('--gate and --gate-status are required for gate');
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      setGateStatus(runState, options.gate, options.gateStatus, options.note || DEFAULT_NOTE);
      writeYaml(runPath, runState);
      console.log(`Gate updated: ${options.gate} -> ${options.gateStatus}`);
      return;
    }

    if (action === 'story-status') {
      if (!options.runId) {
        console.error('--run-id is required for story-status');
        process.exitCode = 1;
        return;
      }

      if (!options.storyId || !options.storyStatus) {
        console.error('--story-id and --story-status are required for story-status');
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      const story = updateStoryState(runState, options.storyId, { status: options.storyStatus });
      if (!story) {
        console.error(`Story not found in run-state: ${options.storyId}`);
        process.exitCode = 1;
        return;
      }

      const sprintStatusPath = updateSprintStatusForStory(repoRoot, runState, story);
      writeYaml(runPath, runState);
      console.log(`Story updated: ${story.id} -> ${story.status}`);
      if (sprintStatusPath) {
        console.log(`Sprint status synced: ${sprintStatusPath}`);
      }
      return;
    }

    if (action === 'story-commit') {
      if (!options.runId) {
        console.error('--run-id is required for story-commit');
        process.exitCode = 1;
        return;
      }

      if (!options.storyId || !options.commit) {
        console.error('--story-id and --commit are required for story-commit');
        process.exitCode = 1;
        return;
      }

      const runPath = getRunPath(workflow, repoRoot, options.runId);
      if (!fs.existsSync(runPath)) {
        console.error(`Run not found: ${runPath}`);
        process.exitCode = 1;
        return;
      }

      const runState = readRunState(runPath);
      const story = updateStoryState(runState, options.storyId, { commit: options.commit });
      if (!story) {
        console.error(`Story not found in run-state: ${options.storyId}`);
        process.exitCode = 1;
        return;
      }

      writeYaml(runPath, runState);
      console.log(`Story commit recorded: ${story.id} -> ${story.commit}`);
      return;
    }

    console.error(`Unknown workflow action: ${action}`);
    process.exitCode = 1;
  },
};

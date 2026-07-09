const path = require('node:path');
const prompts = require('../lib/prompts');
const { loadAdapterMatrix, loadCapabilityCatalog, parseCsv, resolveCapabilityPlan } = require('../lib/capability-catalog');

function renderList(title, values) {
  if (!values || values.length === 0) return `${title}: (none)`;
  return `${title}:\n${values.map((value) => `  - ${value}`).join('\n')}`;
}

function renderPlan(plan) {
  const withPrereqs = plan.components.filter((component) => (component.prerequisites || []).length > 0);
  const lines = [
    'HSEOS install plan',
    '',
    `Profile: ${plan.profile || '(custom)'}`,
    `Hook profile: ${plan.hook_profile}`,
    '',
    renderList(
      'Components',
      plan.components.map(
        (component) =>
          `${component.id}${component.required ? ' [required]' : ''}${(component.prerequisites || []).length > 0 ? ' [has prerequisites]' : ''}`,
      ),
    ),
    '',
    renderList('Modules', plan.modules),
    '',
    renderList('Tools', plan.tools),
    '',
    renderList('Skills', plan.skills),
    '',
    renderList('Install paths', plan.install_paths),
  ];
  if (withPrereqs.length > 0) {
    lines.push(
      '',
      'Prerequisites (all optional components degrade gracefully when unmet):',
      ...withPrereqs.flatMap((component) => [
        `  ${component.id}:`,
        ...component.prerequisites.map((prerequisite) => `    - ${prerequisite}`),
      ]),
    );
  }
  return lines.join('\n');
}

function renderProfiles(catalog) {
  return [
    'Capability profiles',
    '',
    ...Object.entries(catalog.profiles).map(([id, profile]) => {
      const suffix = profile.default ? ' [default]' : '';
      return `- ${id}${suffix}: ${profile.name}\n  ${profile.description}`;
    }),
  ].join('\n');
}

function renderComponents(catalog, family) {
  const components = catalog.components.filter((component) => !family || component.family === family);
  return [
    'Capability components',
    '',
    ...components.map((component) => {
      const prereqs = (component.prerequisites || []).map((prerequisite) => `\n  prerequisite: ${prerequisite}`).join('');
      return `- ${component.id} [${component.family}]\n  ${component.description || component.name || ''}${prereqs}`;
    }),
  ].join('\n');
}

function renderAdapterMatrix(matrix) {
  const rows = matrix.map((adapter) => {
    const nativeHooks = adapter.hooks.native ? adapter.hooks.events.join(', ') : 'metadata/fallback';
    const commands = adapter.slash_commands?.native ? 'native' : 'fallback';
    const mcp = adapter.mcp?.config || adapter.mcp?.transport || 'n/a';
    return `- ${adapter.id}: entrypoint=${adapter.entrypoint || 'n/a'} hooks=${nativeHooks} commands=${commands} mcp=${mcp}`;
  });
  return ['Adapter capability matrix', '', ...rows].join('\n');
}

module.exports = {
  command: 'install-plan',
  description: 'Inspect capability profiles, components, skills, adapters, and resolved install intent',
  options: [
    ['--directory <path>', 'Repository directory to inspect (default: current HSEOS repository)'],
    ['--profile <id>', 'Capability profile id'],
    ['--components <ids>', 'Comma-separated capability component IDs'],
    ['--skills <ids>', 'Comma-separated skill IDs to include as synthetic skill components'],
    ['--tools <ids>', 'Comma-separated tool IDs to add to the plan'],
    ['--hook-profile <id>', 'Hook profile override: advisory, standard, strict, ci'],
    ['--list-profiles', 'List available capability profiles'],
    ['--list-components', 'List available capability components'],
    ['--family <id>', 'Filter --list-components by family'],
    ['--list-skills', 'List synthetic skill component selectors'],
    ['--adapters', 'Show adapter capability matrix'],
    ['--json', 'Emit JSON'],
  ],
  action: async (options = {}) => {
    const root = path.resolve(options.directory || process.cwd());
    const catalog = loadCapabilityCatalog(root);

    if (options.listProfiles) {
      const profiles = Object.entries(catalog.profiles).map(([id, profile]) => ({ id, ...profile }));
      if (options.json) {
        await prompts.log.message(JSON.stringify({ profiles }, null, 2));
      } else {
        await prompts.log.message(renderProfiles(catalog));
      }
      return;
    }

    if (options.listComponents) {
      const components = catalog.components.filter((component) => !options.family || component.family === options.family);
      if (options.json) {
        await prompts.log.message(JSON.stringify({ components }, null, 2));
      } else {
        await prompts.log.message(renderComponents(catalog, options.family));
      }
      return;
    }

    if (options.listSkills) {
      const skills = catalog.skills.map((skill) => skill.id);
      if (options.json) {
        await prompts.log.message(JSON.stringify({ skills }, null, 2));
      } else {
        await prompts.log.message(renderList('Skill selectors', skills));
      }
      return;
    }

    if (options.adapters) {
      const adapters = loadAdapterMatrix(root);
      if (options.json) {
        await prompts.log.message(JSON.stringify({ adapters }, null, 2));
      } else {
        await prompts.log.message(renderAdapterMatrix(adapters));
      }
      return;
    }

    const hasExplicitSelectors = Boolean(options.profile || options.components || options.skills || options.tools || options.hookProfile);
    const plan = resolveCapabilityPlan({
      root,
      profile: options.profile || (hasExplicitSelectors ? null : 'developer'),
      components: parseCsv(options.components),
      skills: parseCsv(options.skills),
      tools: parseCsv(options.tools),
      hookProfile: options.hookProfile,
    });

    if (options.json) {
      await prompts.log.message(JSON.stringify({ plan }, null, 2));
    } else {
      await prompts.log.message(renderPlan(plan));
    }
  },
};

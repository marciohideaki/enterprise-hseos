const path = require('node:path');
const prompts = require('../lib/prompts');
const { loadAdapterMatrix, loadCapabilityCatalog, parseCsv, resolveCapabilityPlan } = require('../lib/capability-catalog');
const { getProjectRoot } = require('../lib/project-root');
const yaml = require('yaml');
const { PlatformBindingsError, preparePlatformBindings } = require('../lib/platform-bindings-cli');

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
          `${component.id} [${component.surface_class}]${component.required ? ' [required]' : ''}${(component.prerequisites || []).length > 0 ? ' [has prerequisites]' : ''}`,
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
      return `- ${component.id} [${component.family}; ${component.surface_class}]\n  ${component.description || component.name || ''}${prereqs}`;
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
    ['--platform-mode <mode>', 'Preview the platform bindings an install would write: platform, hybrid or local'],
    [
      '--platform-binding <spec...>',
      'Preview per-capability overrides <capability>=<outcome>:<ref>:<YYYY-MM-DD> (one per capability; a new file records mode: platform explicitly)',
    ],
    ['--mode-ref <path>', 'Decision record for a local or weaker platform mode'],
    ['--json', 'Emit JSON'],
  ],
  action: async (options = {}) => {
    const root = options.directory ? path.resolve(options.directory) : getProjectRoot();
    const catalog = loadCapabilityCatalog(root);

    if (options.listProfiles) {
      const profiles = Object.entries(catalog.profiles).map(([id, profile]) => ({ id, ...profile }));
      if (options.json) {
        console.log(JSON.stringify({ profiles }, null, 2));
      } else {
        await prompts.log.message(renderProfiles(catalog));
      }
      return;
    }

    if (options.listComponents) {
      const components = catalog.components.filter((component) => !options.family || component.family === options.family);
      if (options.json) {
        console.log(JSON.stringify({ components }, null, 2));
      } else {
        await prompts.log.message(renderComponents(catalog, options.family));
      }
      return;
    }

    if (options.listSkills) {
      const skills = catalog.skills.map((skill) => skill.id);
      if (options.json) {
        console.log(JSON.stringify({ skills }, null, 2));
      } else {
        await prompts.log.message(renderList('Skill selectors', skills));
      }
      return;
    }

    if (options.adapters) {
      const adapters = loadAdapterMatrix(root);
      if (options.json) {
        console.log(JSON.stringify({ adapters }, null, 2));
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

    // Preview only: the bindings are validated and printed, never written.
    let bindings;
    try {
      bindings = preparePlatformBindings({
        // --directory selects the catalog repository here; the project being installed is the working directory.
        projectDir: process.cwd(),
        runtimeRoot: getProjectRoot(),
        options,
      });
    } catch (error) {
      if (!(error instanceof PlatformBindingsError)) throw error;
      console.error(`error: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      const preview = bindings
        ? {
            plan,
            platform_bindings: bindings.doc,
            ...(bindings.warnings.length > 0 ? { platform_bindings_warnings: bindings.warnings } : {}),
          }
        : { plan };
      console.log(JSON.stringify(preview, null, 2));
    } else {
      await prompts.log.message(renderPlan(plan));
      if (bindings) {
        for (const warning of bindings.warnings) await prompts.log.warn(warning);
        await prompts.log.message(
          `Platform bindings that install would write (.hseos/config/platform-bindings.yaml):\n${yaml.stringify(bindings.doc)}`,
        );
      }
    }
  },
};

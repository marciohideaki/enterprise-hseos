const path = require('node:path');
const fs = require('fs-extra');
const csv = require('csv-parse/sync');
const prompts = require('../../../../lib/prompts');
const { toColonPath, toDashPath, customAgentColonName, customAgentDashName, HSEOS_FOLDER_NAME } = require('./path-utils');

/**
 * Generates command files for each workflow in the manifest
 */
class WorkflowCommandGenerator {
  constructor(hseosFolderName = HSEOS_FOLDER_NAME) {
    this.templatePath = path.join(__dirname, '../templates/workflow-command-template.md');
    this.hseosFolderName = hseosFolderName;
  }

  /**
   * Generate workflow commands from the manifest CSV
   * @param {string} projectDir - Project directory
   * @param {string} hseosDir - HSEOS installation directory
   */
  async generateWorkflowCommands(projectDir, hseosDir) {
    const workflows = await this.loadWorkflowManifest(hseosDir);

    if (!workflows) {
      await prompts.log.warn('Workflow manifest not found. Skipping command generation.');
      return { generated: 0 };
    }

    // ALL workflows now generate commands - no standalone filtering
    const allWorkflows = workflows;

    // Base commands directory
    const baseCommandsDir = path.join(projectDir, '.claude', 'commands', 'hseos');

    let generatedCount = 0;

    // Generate a command file for each workflow, organized by module
    for (const workflow of allWorkflows) {
      const moduleWorkflowsDir = path.join(baseCommandsDir, workflow.module, 'workflows');
      await fs.ensureDir(moduleWorkflowsDir);

      const commandContent = await this.generateCommandContent(workflow, hseosDir);
      const commandPath = path.join(moduleWorkflowsDir, `${workflow.name}.md`);

      await fs.writeFile(commandPath, commandContent);
      generatedCount++;
    }

    // Also create a workflow launcher README in each module
    const groupedWorkflows = this.groupWorkflowsByModule(allWorkflows);
    await this.createModuleWorkflowLaunchers(baseCommandsDir, groupedWorkflows);

    return { generated: generatedCount };
  }

  async collectWorkflowArtifacts(hseosDir) {
    const workflows = await this.loadWorkflowManifest(hseosDir);

    if (!workflows) {
      return { artifacts: [], counts: { commands: 0, launchers: 0 } };
    }

    // ALL workflows now generate commands - no standalone filtering
    const allWorkflows = workflows;

    const artifacts = [];

    for (const workflow of allWorkflows) {
      const commandContent = await this.generateCommandContent(workflow, hseosDir);
      // Calculate the relative workflow path (e.g., bmm/workflows/4-implementation/sprint-planning/workflow.yaml)
      let workflowRelPath = workflow.path || '';
      // Normalize path separators for cross-platform compatibility
      workflowRelPath = workflowRelPath.replaceAll('\\', '/');
      // Remove _hseos/ prefix if present to get relative path from project root
      // Handle both absolute paths (/path/to/_hseos/...) and relative paths (_hseos/...)
      if (workflowRelPath.includes('_hseos/')) {
        const parts = workflowRelPath.split(/_hseos\//);
        if (parts.length > 1) {
          workflowRelPath = parts.slice(1).join('/');
        }
      } else if (workflowRelPath.includes('/src/')) {
        // Normalize source paths (e.g. .../src/bmm/...) to relative module path (e.g. bmm/...)
        const match = workflowRelPath.match(/\/src\/([^/]+)\/(.+)/);
        if (match) {
          workflowRelPath = `${match[1]}/${match[2]}`;
        }
      }
      // Determine if this is a YAML workflow (use normalized path which is guaranteed to be a string)
      const isYamlWorkflow = workflowRelPath.endsWith('.yaml') || workflowRelPath.endsWith('.yml');
      artifacts.push({
        type: 'workflow-command',
        isYamlWorkflow: isYamlWorkflow, // For template selection
        name: workflow.name,
        description: workflow.description || `${workflow.name} workflow`,
        module: workflow.module,
        relativePath: path.join(workflow.module, 'workflows', `${workflow.name}.md`),
        workflowPath: workflowRelPath, // Relative path to actual workflow file
        content: commandContent,
        sourcePath: workflow.path,
      });
    }

    const groupedWorkflows = this.groupWorkflowsByModule(allWorkflows);
    for (const [module, launcherContent] of Object.entries(this.buildModuleWorkflowLaunchers(groupedWorkflows))) {
      artifacts.push({
        type: 'workflow-launcher',
        module,
        relativePath: path.join(module, 'workflows', 'README.md'),
        content: launcherContent,
        sourcePath: null,
      });
    }

    return {
      artifacts,
      counts: {
        commands: allWorkflows.length,
        launchers: Object.keys(groupedWorkflows).length,
      },
    };
  }

  /**
   * Generate command content for a workflow
   */
  async generateCommandContent(workflow, hseosDir) {
    // Determine template based on workflow file type
    const isMarkdownWorkflow = workflow.path.endsWith('workflow.md');
    const templateName = isMarkdownWorkflow ? 'workflow-commander.md' : 'workflow-command-template.md';
    const templatePath = path.join(path.dirname(this.templatePath), templateName);

    // Load the appropriate template
    const template = await fs.readFile(templatePath, 'utf8');

    // Convert source path to installed path
    // From: /Users/.../src/bmm/workflows/.../workflow.yaml
    // To: {project-root}/_hseos/hsm/workflows/.../workflow.yaml
    let workflowPath = workflow.path;

    // Extract the relative path from source
    if (workflowPath.includes('/src/bmm/')) {
      // bmm is directly under src/
      const match = workflowPath.match(/\/src\/bmm\/(.+)/);
      if (match) {
        workflowPath = `${this.hseosFolderName}/bmm/${match[1]}`;
      }
    } else if (workflowPath.includes('/src/core/')) {
      const match = workflowPath.match(/\/src\/core\/(.+)/);
      if (match) {
        workflowPath = `${this.hseosFolderName}/core/${match[1]}`;
      }
    }

    // Replace template variables
    return template
      .replaceAll('{{name}}', workflow.name)
      .replaceAll('{{module}}', workflow.module)
      .replaceAll('{{description}}', workflow.description)
      .replaceAll('{{workflow_path}}', workflowPath)
      .replaceAll('.hseos', this.hseosFolderName);
  }

  /**
   * Create workflow launcher files for each module
   */
  async createModuleWorkflowLaunchers(baseCommandsDir, workflowsByModule) {
    for (const [module, moduleWorkflows] of Object.entries(workflowsByModule)) {
      const content = this.buildLauncherContent(module, moduleWorkflows);
      const moduleWorkflowsDir = path.join(baseCommandsDir, module, 'workflows');
      await fs.ensureDir(moduleWorkflowsDir);
      const launcherPath = path.join(moduleWorkflowsDir, 'README.md');
      await fs.writeFile(launcherPath, content);
    }
  }

  groupWorkflowsByModule(workflows) {
    const workflowsByModule = {};

    for (const workflow of workflows) {
      if (!workflowsByModule[workflow.module]) {
        workflowsByModule[workflow.module] = [];
      }

      workflowsByModule[workflow.module].push({
        ...workflow,
        displayPath: this.transformWorkflowPath(workflow.path),
      });
    }

    return workflowsByModule;
  }

  buildModuleWorkflowLaunchers(groupedWorkflows) {
    const launchers = {};

    for (const [module, moduleWorkflows] of Object.entries(groupedWorkflows)) {
      launchers[module] = this.buildLauncherContent(module, moduleWorkflows);
    }

    return launchers;
  }

  buildLauncherContent(module, moduleWorkflows) {
    let content = `# ${module.toUpperCase()} Workflows

## Available Workflows in ${module}

`;

    for (const workflow of moduleWorkflows) {
      content += `**${workflow.name}**\n`;
      content += `- Path: \`${workflow.displayPath}\`\n`;
      content += `- ${workflow.description}\n\n`;
    }

    content += `
## Execution

When running any workflow:
1. LOAD {project-root}/${this.hseosFolderName}/core/tasks/workflow.xml
2. Pass the workflow path as 'workflow-config' parameter
3. Follow workflow.xml instructions EXACTLY
4. Save outputs after EACH section

## Modes
- Normal: Full interaction
- #yolo: Skip optional steps
`;

    return content;
  }

  transformWorkflowPath(workflowPath) {
    let transformed = workflowPath;

    if (workflowPath.includes('/src/bmm/')) {
      const match = workflowPath.match(/\/src\/bmm\/(.+)/);
      if (match) {
        transformed = `{project-root}/${this.hseosFolderName}/bmm/${match[1]}`;
      }
    } else if (workflowPath.includes('/src/core/')) {
      const match = workflowPath.match(/\/src\/core\/(.+)/);
      if (match) {
        transformed = `{project-root}/${this.hseosFolderName}/core/${match[1]}`;
      }
    }

    return transformed;
  }

  async loadWorkflowManifest(hseosDir) {
    const manifestPath = path.join(hseosDir, '_config', 'workflow-manifest.csv');

    if (!(await fs.pathExists(manifestPath))) {
      return null;
    }

    const csvContent = await fs.readFile(manifestPath, 'utf8');
    return csv.parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
  }

  /**
   * Write workflow command artifacts using underscore format (Windows-compatible)
   * Creates flat files like: hseos_bmm_correct-course.md
   *
   * @param {string} baseCommandsDir - Base commands directory for the IDE
   * @param {Array} artifacts - Workflow artifacts
   * @returns {number} Count of commands written
   */
  async writeColonArtifacts(baseCommandsDir, artifacts) {
    let writtenCount = 0;

    for (const artifact of artifacts) {
      if (artifact.type === 'workflow-command') {
        // Convert relativePath to underscore format: bmm/workflows/correct-course.md → hseos_bmm_correct-course.md
        const flatName = toColonPath(artifact.relativePath);
        const commandPath = path.join(baseCommandsDir, flatName);
        await fs.ensureDir(path.dirname(commandPath));
        await fs.writeFile(commandPath, artifact.content);
        writtenCount++;
      }
    }

    return writtenCount;
  }

  /**
   * Write workflow command artifacts using dash format (NEW STANDARD)
   * Creates flat files like: hseos-bmm-correct-course.md
   *
   * Note: Workflows do NOT have hseos-agent- prefix - only agents do.
   *
   * @param {string} baseCommandsDir - Base commands directory for the IDE
   * @param {Array} artifacts - Workflow artifacts
   * @returns {number} Count of commands written
   */
  async writeDashArtifacts(baseCommandsDir, artifacts) {
    let writtenCount = 0;

    for (const artifact of artifacts) {
      if (artifact.type === 'workflow-command') {
        // Convert relativePath to dash format: bmm/workflows/correct-course.md → hseos-bmm-correct-course.md
        const flatName = toDashPath(artifact.relativePath);
        const commandPath = path.join(baseCommandsDir, flatName);
        await fs.ensureDir(path.dirname(commandPath));
        await fs.writeFile(commandPath, artifact.content);
        writtenCount++;
      }
    }

    return writtenCount;
  }
}

module.exports = { WorkflowCommandGenerator };

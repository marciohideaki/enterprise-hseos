const path = require('node:path');
const fs = require('fs-extra');
const csv = require('csv-parse/sync');
const { toColonName, toColonPath, toDashPath, HSEOS_FOLDER_NAME } = require('./path-utils');

/**
 * Generates command files for standalone tasks and tools
 */
class TaskToolCommandGenerator {
  /**
   * @param {string} hseosFolderName - Name of the HSEOS folder for template rendering (default: '.hseos')
   * Note: This parameter is accepted for API consistency with AgentCommandGenerator and
   * WorkflowCommandGenerator, but is not used for path stripping. The manifest always stores
   * filesystem paths with '_hseos/' prefix (the actual folder name), while hseosFolderName is
   * used for template placeholder rendering ({{hseosFolderName}}).
   */
  constructor(hseosFolderName = HSEOS_FOLDER_NAME) {
    this.hseosFolderName = hseosFolderName;
  }

  /**
   * Collect task and tool artifacts for IDE installation
   * @param {string} hseosDir - HSEOS installation directory
   * @returns {Promise<Object>} Artifacts array with metadata
   */
  async collectTaskToolArtifacts(hseosDir) {
    const tasks = await this.loadTaskManifest(hseosDir);
    const tools = await this.loadToolManifest(hseosDir);

    // All tasks/tools in manifest are standalone (internal=true items are filtered during manifest generation)
    const artifacts = [];
    const hseosPrefix = `${HSEOS_FOLDER_NAME}/`;

    // Collect task artifacts
    for (const task of tasks || []) {
      let taskPath = (task.path || '').replaceAll('\\', '/');
      // Convert absolute paths to relative paths
      if (path.isAbsolute(taskPath)) {
        taskPath = path.relative(hseosDir, taskPath).replaceAll('\\', '/');
      }
      // Remove _hseos/ prefix if present to get relative path within hseos folder
      if (taskPath.startsWith(hseosPrefix)) {
        taskPath = taskPath.slice(hseosPrefix.length);
      }

      const taskExt = path.extname(taskPath) || '.md';
      artifacts.push({
        type: 'task',
        name: task.name,
        displayName: task.displayName || task.name,
        description: task.description || `Execute ${task.displayName || task.name}`,
        module: task.module,
        // Use forward slashes for cross-platform consistency (not path.join which uses backslashes on Windows)
        relativePath: `${task.module}/tasks/${task.name}${taskExt}`,
        path: taskPath,
      });
    }

    // Collect tool artifacts
    for (const tool of tools || []) {
      let toolPath = (tool.path || '').replaceAll('\\', '/');
      // Convert absolute paths to relative paths
      if (path.isAbsolute(toolPath)) {
        toolPath = path.relative(hseosDir, toolPath).replaceAll('\\', '/');
      }
      // Remove _hseos/ prefix if present to get relative path within hseos folder
      if (toolPath.startsWith(hseosPrefix)) {
        toolPath = toolPath.slice(hseosPrefix.length);
      }

      const toolExt = path.extname(toolPath) || '.md';
      artifacts.push({
        type: 'tool',
        name: tool.name,
        displayName: tool.displayName || tool.name,
        description: tool.description || `Execute ${tool.displayName || tool.name}`,
        module: tool.module,
        // Use forward slashes for cross-platform consistency (not path.join which uses backslashes on Windows)
        relativePath: `${tool.module}/tools/${tool.name}${toolExt}`,
        path: toolPath,
      });
    }

    return {
      artifacts,
      counts: {
        tasks: (tasks || []).length,
        tools: (tools || []).length,
      },
    };
  }

  /**
   * Generate task and tool commands from manifest CSVs
   * @param {string} projectDir - Project directory
   * @param {string} hseosDir - HSEOS installation directory
   * @param {string} baseCommandsDir - Optional base commands directory (defaults to .claude/commands/hseos)
   */
  async generateTaskToolCommands(projectDir, hseosDir, baseCommandsDir = null) {
    const tasks = await this.loadTaskManifest(hseosDir);
    const tools = await this.loadToolManifest(hseosDir);

    // Base commands directory - use provided or default to Claude Code structure
    const commandsDir = baseCommandsDir || path.join(projectDir, '.claude', 'commands', 'hseos');

    let generatedCount = 0;

    // Generate command files for tasks
    for (const task of tasks || []) {
      const moduleTasksDir = path.join(commandsDir, task.module, 'tasks');
      await fs.ensureDir(moduleTasksDir);

      const commandContent = this.generateCommandContent(task, 'task');
      const commandPath = path.join(moduleTasksDir, `${task.name}.md`);

      await fs.writeFile(commandPath, commandContent);
      generatedCount++;
    }

    // Generate command files for tools
    for (const tool of tools || []) {
      const moduleToolsDir = path.join(commandsDir, tool.module, 'tools');
      await fs.ensureDir(moduleToolsDir);

      const commandContent = this.generateCommandContent(tool, 'tool');
      const commandPath = path.join(moduleToolsDir, `${tool.name}.md`);

      await fs.writeFile(commandPath, commandContent);
      generatedCount++;
    }

    return {
      generated: generatedCount,
      tasks: (tasks || []).length,
      tools: (tools || []).length,
    };
  }

  /**
   * Generate command content for a task or tool
   */
  generateCommandContent(item, type) {
    const description = item.description || `Execute ${item.displayName || item.name}`;

    // Convert path to use {project-root} placeholder
    // Handle undefined/missing path by constructing from module and name
    let itemPath = item.path;
    if (!itemPath || typeof itemPath !== 'string') {
      // Fallback: construct path from module and name if path is missing
      const typePlural = type === 'task' ? 'tasks' : 'tools';
      itemPath = `{project-root}/${this.hseosFolderName}/${item.module}/${typePlural}/${item.name}.md`;
    } else {
      // Normalize path separators to forward slashes
      itemPath = itemPath.replaceAll('\\', '/');

      // Extract relative path from absolute paths (Windows or Unix)
      // Look for _hseos/ or hseos/ in the path and extract everything after it
      // Match patterns like: /_hseos/core/tasks/... or /hseos/core/tasks/...
      // Use [/\\] to handle both Unix forward slashes and Windows backslashes,
      // and also paths without a leading separator (e.g., C:/_hseos/...)
      const hseosMatch = itemPath.match(/[/\\]_hseos[/\\](.+)$/) || itemPath.match(/[/\\]hseos[/\\](.+)$/);
      if (hseosMatch) {
        // Found /_hseos/ or /hseos/ - use relative path after it
        itemPath = `{project-root}/${this.hseosFolderName}/${hseosMatch[1]}`;
      } else if (itemPath.startsWith(`${HSEOS_FOLDER_NAME}/`)) {
        // Relative path starting with _hseos/
        itemPath = `{project-root}/${this.hseosFolderName}/${itemPath.slice(HSEOS_FOLDER_NAME.length + 1)}`;
      } else if (itemPath.startsWith('hseos/')) {
        // Relative path starting with hseos/
        itemPath = `{project-root}/${this.hseosFolderName}/${itemPath.slice(5)}`;
      } else if (!itemPath.startsWith('{project-root}')) {
        // For other relative paths, prefix with project root and hseos folder
        itemPath = `{project-root}/${this.hseosFolderName}/${itemPath}`;
      }
    }

    return `---
description: '${description.replaceAll("'", "''")}'
---

# ${item.displayName || item.name}

Read the entire ${type} file at: ${itemPath}

Follow all instructions in the ${type} file exactly as written.
`;
  }

  /**
   * Load task manifest CSV
   */
  async loadTaskManifest(hseosDir) {
    const manifestPath = path.join(hseosDir, '_config', 'task-manifest.csv');

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
   * Load tool manifest CSV
   */
  async loadToolManifest(hseosDir) {
    const manifestPath = path.join(hseosDir, '_config', 'tool-manifest.csv');

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
   * Generate task and tool commands using underscore format (Windows-compatible)
   * Creates flat files like: hseos_bmm_help.md
   *
   * @param {string} projectDir - Project directory
   * @param {string} hseosDir - HSEOS installation directory
   * @param {string} baseCommandsDir - Base commands directory for the IDE
   * @returns {Object} Generation results
   */
  async generateColonTaskToolCommands(projectDir, hseosDir, baseCommandsDir) {
    const tasks = await this.loadTaskManifest(hseosDir);
    const tools = await this.loadToolManifest(hseosDir);

    let generatedCount = 0;

    // Generate command files for tasks
    for (const task of tasks || []) {
      const commandContent = this.generateCommandContent(task, 'task');
      // Use underscore format: hseos_bmm_name.md
      const flatName = toColonName(task.module, 'tasks', task.name);
      const commandPath = path.join(baseCommandsDir, flatName);
      await fs.ensureDir(path.dirname(commandPath));
      await fs.writeFile(commandPath, commandContent);
      generatedCount++;
    }

    // Generate command files for tools
    for (const tool of tools || []) {
      const commandContent = this.generateCommandContent(tool, 'tool');
      // Use underscore format: hseos_bmm_name.md
      const flatName = toColonName(tool.module, 'tools', tool.name);
      const commandPath = path.join(baseCommandsDir, flatName);
      await fs.ensureDir(path.dirname(commandPath));
      await fs.writeFile(commandPath, commandContent);
      generatedCount++;
    }

    return {
      generated: generatedCount,
      tasks: (tasks || []).length,
      tools: (tools || []).length,
    };
  }

  /**
   * Generate task and tool commands using underscore format (Windows-compatible)
   * Creates flat files like: hseos_bmm_help.md
   *
   * @param {string} projectDir - Project directory
   * @param {string} hseosDir - HSEOS installation directory
   * @param {string} baseCommandsDir - Base commands directory for the IDE
   * @returns {Object} Generation results
   */
  async generateDashTaskToolCommands(projectDir, hseosDir, baseCommandsDir) {
    const tasks = await this.loadTaskManifest(hseosDir);
    const tools = await this.loadToolManifest(hseosDir);

    let generatedCount = 0;

    // Generate command files for tasks
    for (const task of tasks || []) {
      const commandContent = this.generateCommandContent(task, 'task');
      // Use dash format: hseos-bmm-name.md
      const flatName = toDashPath(`${task.module}/tasks/${task.name}.md`);
      const commandPath = path.join(baseCommandsDir, flatName);
      await fs.ensureDir(path.dirname(commandPath));
      await fs.writeFile(commandPath, commandContent);
      generatedCount++;
    }

    // Generate command files for tools
    for (const tool of tools || []) {
      const commandContent = this.generateCommandContent(tool, 'tool');
      // Use dash format: hseos-bmm-name.md
      const flatName = toDashPath(`${tool.module}/tools/${tool.name}.md`);
      const commandPath = path.join(baseCommandsDir, flatName);
      await fs.ensureDir(path.dirname(commandPath));
      await fs.writeFile(commandPath, commandContent);
      generatedCount++;
    }

    return {
      generated: generatedCount,
      tasks: (tasks || []).length,
      tools: (tools || []).length,
    };
  }

  /**
   * Write task/tool artifacts using underscore format (Windows-compatible)
   * Creates flat files like: hseos_bmm_help.md
   *
   * @param {string} baseCommandsDir - Base commands directory for the IDE
   * @param {Array} artifacts - Task/tool artifacts with relativePath
   * @returns {number} Count of commands written
   */
  async writeColonArtifacts(baseCommandsDir, artifacts) {
    let writtenCount = 0;

    for (const artifact of artifacts) {
      if (artifact.type === 'task' || artifact.type === 'tool') {
        const commandContent = this.generateCommandContent(artifact, artifact.type);
        // Use underscore format: hseos_module_name.md
        const flatName = toColonPath(artifact.relativePath);
        const commandPath = path.join(baseCommandsDir, flatName);
        await fs.ensureDir(path.dirname(commandPath));
        await fs.writeFile(commandPath, commandContent);
        writtenCount++;
      }
    }

    return writtenCount;
  }

  /**
   * Write task/tool artifacts using dash format (NEW STANDARD)
   * Creates flat files like: hseos-bmm-help.md
   *
   * Note: Tasks/tools do NOT have hseos-agent- prefix - only agents do.
   *
   * @param {string} baseCommandsDir - Base commands directory for the IDE
   * @param {Array} artifacts - Task/tool artifacts with relativePath
   * @returns {number} Count of commands written
   */
  async writeDashArtifacts(baseCommandsDir, artifacts) {
    let writtenCount = 0;

    for (const artifact of artifacts) {
      if (artifact.type === 'task' || artifact.type === 'tool') {
        const commandContent = this.generateCommandContent(artifact, artifact.type);
        // Use dash format: hseos-module-name.md
        const flatName = toDashPath(artifact.relativePath);
        const commandPath = path.join(baseCommandsDir, flatName);
        await fs.ensureDir(path.dirname(commandPath));
        await fs.writeFile(commandPath, commandContent);
        writtenCount++;
      }
    }

    return writtenCount;
  }
}

module.exports = { TaskToolCommandGenerator };

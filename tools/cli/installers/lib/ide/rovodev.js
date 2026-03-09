const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { BaseIdeSetup } = require('./_base-ide');
const prompts = require('../../../lib/prompts');
const { AgentCommandGenerator } = require('./shared/agent-command-generator');
const { WorkflowCommandGenerator } = require('./shared/workflow-command-generator');
const { TaskToolCommandGenerator } = require('./shared/task-tool-command-generator');
const { toDashPath } = require('./shared/path-utils');

/**
 * Rovo Dev IDE setup handler
 *
 * Custom installer that writes .md workflow files to .rovodev/workflows/
 * and generates .rovodev/prompts.yml to register them with Rovo Dev's /prompts feature.
 *
 * prompts.yml format (per Rovo Dev docs):
 *   prompts:
 *     - name: hseos-bmm-create-prd
 *       description: "PRD workflow..."
 *       content_file: workflows/hseos-bmm-create-prd.md
 */
class RovoDevSetup extends BaseIdeSetup {
  constructor() {
    super('rovo-dev', 'Rovo Dev', false);
    this.rovoDir = '.rovodev';
    this.workflowsDir = 'workflows';
    this.promptsFile = 'prompts.yml';
  }

  /**
   * Setup Rovo Dev configuration
   * @param {string} projectDir - Project directory
   * @param {string} hseosDir - HSEOS installation directory
   * @param {Object} options - Setup options
   * @returns {Promise<Object>} Setup result with { success, results: { agents, workflows, tasks, tools } }
   */
  async setup(projectDir, hseosDir, options = {}) {
    if (!options.silent) await prompts.log.info(`Setting up ${this.name}...`);

    // Clean up any old HSEOS installation first
    await this.cleanup(projectDir, options);

    const workflowsPath = path.join(projectDir, this.rovoDir, this.workflowsDir);
    await this.ensureDir(workflowsPath);

    const selectedModules = options.selectedModules || [];
    const writtenFiles = [];

    // Generate and write agent launchers
    const agentGen = new AgentCommandGenerator(this.hseosFolderName);
    const { artifacts: agentArtifacts } = await agentGen.collectAgentArtifacts(hseosDir, selectedModules);
    const agentCount = await agentGen.writeDashArtifacts(workflowsPath, agentArtifacts);
    this._collectPromptEntries(writtenFiles, agentArtifacts, ['agent-launcher'], 'agent');

    // Generate and write workflow commands
    const workflowGen = new WorkflowCommandGenerator(this.hseosFolderName);
    const { artifacts: workflowArtifacts } = await workflowGen.collectWorkflowArtifacts(hseosDir);
    const workflowCount = await workflowGen.writeDashArtifacts(workflowsPath, workflowArtifacts);
    this._collectPromptEntries(writtenFiles, workflowArtifacts, ['workflow-command'], 'workflow');

    // Generate and write task/tool commands
    const taskToolGen = new TaskToolCommandGenerator(this.hseosFolderName);
    const { artifacts: taskToolArtifacts, counts: taskToolCounts } = await taskToolGen.collectTaskToolArtifacts(hseosDir);
    await taskToolGen.writeDashArtifacts(workflowsPath, taskToolArtifacts);
    const taskCount = taskToolCounts.tasks || 0;
    const toolCount = taskToolCounts.tools || 0;
    this._collectPromptEntries(writtenFiles, taskToolArtifacts, ['task', 'tool']);

    // Generate prompts.yml manifest (only if we have entries to write)
    if (writtenFiles.length > 0) {
      await this.generatePromptsYml(projectDir, writtenFiles);
    }

    if (!options.silent) {
      await prompts.log.success(
        `${this.name} configured: ${agentCount} agents, ${workflowCount} workflows, ${taskCount} tasks, ${toolCount} tools`,
      );
    }

    return {
      success: true,
      results: {
        agents: agentCount,
        workflows: workflowCount,
        tasks: taskCount,
        tools: toolCount,
      },
    };
  }

  /**
   * Collect prompt entries from artifacts into writtenFiles array
   * @param {Array} writtenFiles - Target array to push entries into
   * @param {Array} artifacts - Artifacts from a generator's collect method
   * @param {string[]} acceptedTypes - Artifact types to include (e.g., ['agent-launcher'])
   * @param {string} [fallbackSuffix] - Suffix for fallback description; defaults to artifact.type
   */
  _collectPromptEntries(writtenFiles, artifacts, acceptedTypes, fallbackSuffix) {
    for (const artifact of artifacts) {
      if (!acceptedTypes.includes(artifact.type)) continue;
      const flatName = toDashPath(artifact.relativePath);
      writtenFiles.push({
        name: path.basename(flatName, '.md'),
        description: artifact.description || `${artifact.name} ${fallbackSuffix || artifact.type}`,
        contentFile: `${this.workflowsDir}/${flatName}`,
      });
    }
  }

  /**
   * Generate .rovodev/prompts.yml manifest
   * Merges with existing user entries -- strips entries with names starting 'hseos-',
   * appends new HSEOS entries, and writes back.
   *
   * @param {string} projectDir - Project directory
   * @param {Array<Object>} writtenFiles - Array of { name, description, contentFile }
   */
  async generatePromptsYml(projectDir, writtenFiles) {
    const promptsPath = path.join(projectDir, this.rovoDir, this.promptsFile);
    let existingPrompts = [];

    // Read existing prompts.yml and preserve non-HSEOS entries
    if (await this.pathExists(promptsPath)) {
      try {
        const content = await this.readFile(promptsPath);
        const parsed = yaml.parse(content);
        if (parsed && Array.isArray(parsed.prompts)) {
          // Keep only non-HSEOS entries (entries whose name does NOT start with hseos-)
          existingPrompts = parsed.prompts.filter((entry) => !entry.name || !entry.name.startsWith('hseos-'));
        }
      } catch {
        // If parsing fails, start fresh but preserve file safety
        existingPrompts = [];
      }
    }

    // Build new HSEOS entries (prefix description with name so /prompts list is scannable)
    const hseosEntries = writtenFiles.map((file) => ({
      name: file.name,
      description: `${file.name} - ${file.description}`,
      content_file: file.contentFile,
    }));

    // Merge: user entries first, then HSEOS entries
    const allPrompts = [...existingPrompts, ...hseosEntries];

    const config = { prompts: allPrompts };
    const yamlContent = yaml.stringify(config, { lineWidth: 0 });
    await this.writeFile(promptsPath, yamlContent);
  }

  /**
   * Cleanup Rovo Dev configuration
   * Removes hseos-* files from .rovodev/workflows/ and strips HSEOS entries from prompts.yml
   * @param {string} projectDir - Project directory
   * @param {Object} options - Cleanup options
   */
  async cleanup(projectDir, options = {}) {
    const workflowsPath = path.join(projectDir, this.rovoDir, this.workflowsDir);

    // Remove all hseos-* entries from workflows dir (aligned with detect() predicate)
    if (await this.pathExists(workflowsPath)) {
      const entries = await fs.readdir(workflowsPath);
      for (const entry of entries) {
        if (entry.startsWith('hseos-')) {
          await fs.remove(path.join(workflowsPath, entry));
        }
      }
    }

    // Clean HSEOS entries from prompts.yml (preserve user entries)
    const promptsPath = path.join(projectDir, this.rovoDir, this.promptsFile);
    if (await this.pathExists(promptsPath)) {
      try {
        const content = await this.readFile(promptsPath);
        const parsed = yaml.parse(content) || {};

        if (Array.isArray(parsed.prompts)) {
          const originalCount = parsed.prompts.length;
          parsed.prompts = parsed.prompts.filter((entry) => !entry.name || !entry.name.startsWith('hseos-'));
          const removedCount = originalCount - parsed.prompts.length;

          if (removedCount > 0) {
            if (parsed.prompts.length === 0) {
              // If no entries remain, remove the file entirely
              await fs.remove(promptsPath);
            } else {
              await this.writeFile(promptsPath, yaml.stringify(parsed, { lineWidth: 0 }));
            }
            if (!options.silent) {
              await prompts.log.message(`Removed ${removedCount} HSEOS entries from ${this.promptsFile}`);
            }
          }
        }
      } catch {
        // If parsing fails, leave file as-is
        if (!options.silent) {
          await prompts.log.warn(`Warning: Could not parse ${this.promptsFile} for cleanup`);
        }
      }
    }

    // Remove empty .rovodev directories
    if (await this.pathExists(workflowsPath)) {
      const remaining = await fs.readdir(workflowsPath);
      if (remaining.length === 0) {
        await fs.remove(workflowsPath);
      }
    }

    const rovoDirPath = path.join(projectDir, this.rovoDir);
    if (await this.pathExists(rovoDirPath)) {
      const remaining = await fs.readdir(rovoDirPath);
      if (remaining.length === 0) {
        await fs.remove(rovoDirPath);
      }
    }
  }

  /**
   * Detect whether Rovo Dev configuration exists in the project
   * Checks for .rovodev/ dir with hseos files or hseos entries in prompts.yml
   * @param {string} projectDir - Project directory
   * @returns {boolean}
   */
  async detect(projectDir) {
    const workflowsPath = path.join(projectDir, this.rovoDir, this.workflowsDir);

    // Check for hseos files in workflows dir
    if (await fs.pathExists(workflowsPath)) {
      const entries = await fs.readdir(workflowsPath);
      if (entries.some((entry) => entry.startsWith('hseos-'))) {
        return true;
      }
    }

    // Check for hseos entries in prompts.yml
    const promptsPath = path.join(projectDir, this.rovoDir, this.promptsFile);
    if (await fs.pathExists(promptsPath)) {
      try {
        const content = await fs.readFile(promptsPath, 'utf8');
        const parsed = yaml.parse(content);
        if (parsed && Array.isArray(parsed.prompts)) {
          return parsed.prompts.some((entry) => entry.name && entry.name.startsWith('hseos-'));
        }
      } catch {
        // If parsing fails, check raw content
        return false;
      }
    }

    return false;
  }
}

module.exports = { RovoDevSetup };

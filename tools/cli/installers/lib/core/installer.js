const path = require('node:path');
const fs = require('fs-extra');
const { Detector } = require('./detector');
const { Manifest } = require('./manifest');
const { ModuleManager } = require('../modules/manager');
const { IdeManager } = require('../ide/manager');
const { FileOps } = require('../../../lib/file-ops');
const { Config } = require('../../../lib/config');
const { XmlHandler } = require('../../../lib/xml-handler');
const { DependencyResolver } = require('./dependency-resolver');
const { ConfigCollector } = require('./config-collector');
const { getProjectRoot, getSourcePath, getModulePath } = require('../../../lib/project-root');
const { CLIUtils } = require('../../../lib/cli-utils');
const { ManifestGenerator } = require('./manifest-generator');
const { IdeConfigManager } = require('./ide-config-manager');
const { CustomHandler } = require('../custom/handler');
const prompts = require('../../../lib/prompts');
const { HSEOS_FOLDER_NAME } = require('../ide/shared/path-utils');

class Installer {
  constructor() {
    this.detector = new Detector();
    this.manifest = new Manifest();
    this.moduleManager = new ModuleManager();
    this.ideManager = new IdeManager();
    this.fileOps = new FileOps();
    this.config = new Config();
    this.xmlHandler = new XmlHandler();
    this.dependencyResolver = new DependencyResolver();
    this.configCollector = new ConfigCollector();
    this.ideConfigManager = new IdeConfigManager();
    this.installedFiles = new Set(); // Track all installed files
    this.hseosFolderName = HSEOS_FOLDER_NAME;
  }

  /**
   * Find the hseos installation directory in a project
   * Always uses the standard .hseos folder name
   * Also checks for legacy _cfg folder for migration
   * @param {string} projectDir - Project directory
   * @returns {Promise<Object>} { hseosDir: string, hasLegacyCfg: boolean }
   */
  async findHseosDir(projectDir) {
    const hseosDir = path.join(projectDir, HSEOS_FOLDER_NAME);

    // Check if project directory exists
    if (!(await fs.pathExists(projectDir))) {
      // Project doesn't exist yet, return default
      return { hseosDir, hasLegacyCfg: false };
    }

    // Check for legacy _cfg folder if hseos directory exists
    let hasLegacyCfg = false;
    if (await fs.pathExists(hseosDir)) {
      const legacyCfgPath = path.join(hseosDir, '_cfg');
      if (await fs.pathExists(legacyCfgPath)) {
        hasLegacyCfg = true;
      }
    }

    return { hseosDir, hasLegacyCfg };
  }

  /**
   * @function copyFileWithPlaceholderReplacement
   * @intent Copy files from HSEOS source to installation directory with dynamic content transformation
   * @why Enables installation-time customization: .hseos replacement
   * @param {string} sourcePath - Absolute path to source file in HSEOS repository
   * @param {string} targetPath - Absolute path to destination file in user's project
   * @param {string} hseosFolderName - User's chosen hseos folder name (default: 'hseos')
   * @returns {Promise<void>} Resolves when file copy and transformation complete
   * @sideeffects Writes transformed file to targetPath, creates parent directories if needed
   * @edgecases Binary files bypass transformation, falls back to raw copy if UTF-8 read fails
   * @calledby installCore(), installModule(), IDE installers during file vendoring
   * @calls fs.readFile(), fs.writeFile(), fs.copy()
   *

   *
   * 3. Document marker in instructions.md (if applicable)
   */
  async copyFileWithPlaceholderReplacement(sourcePath, targetPath) {
    // List of text file extensions that should have placeholder replacement
    const textExtensions = ['.md', '.yaml', '.yml', '.txt', '.json', '.js', '.ts', '.html', '.css', '.sh', '.bat', '.csv', '.xml'];
    const ext = path.extname(sourcePath).toLowerCase();

    // Check if this is a text file that might contain placeholders
    if (textExtensions.includes(ext)) {
      try {
        // Read the file content
        let content = await fs.readFile(sourcePath, 'utf8');

        // Write to target with replaced content
        await fs.ensureDir(path.dirname(targetPath));
        await fs.writeFile(targetPath, content, 'utf8');
      } catch {
        // If reading as text fails (might be binary despite extension), fall back to regular copy
        await fs.copy(sourcePath, targetPath, { overwrite: true });
      }
    } else {
      // Binary file or other file type - just copy directly
      await fs.copy(sourcePath, targetPath, { overwrite: true });
    }
  }

  /**
   * Collect Tool/IDE configurations after module configuration
   * @param {string} projectDir - Project directory
   * @param {Array} selectedModules - Selected modules from configuration
   * @param {boolean} isFullReinstall - Whether this is a full reinstall
   * @param {Array} previousIdes - Previously configured IDEs (for reinstalls)
   * @param {Array} preSelectedIdes - Pre-selected IDEs from early prompt (optional)
   * @param {boolean} skipPrompts - Skip prompts and use defaults (for --yes flag)
   * @returns {Object} Tool/IDE selection and configurations
   */
  async collectToolConfigurations(
    projectDir,
    selectedModules,
    isFullReinstall = false,
    previousIdes = [],
    preSelectedIdes = null,
    skipPrompts = false,
  ) {
    // Use pre-selected IDEs if provided, otherwise prompt
    let toolConfig;
    if (preSelectedIdes === null) {
      // Fallback: prompt for tool selection (backwards compatibility)
      const { UI } = require('../../../lib/ui');
      const ui = new UI();
      toolConfig = await ui.promptToolSelection(projectDir);
    } else {
      // IDEs were already selected during initial prompts
      toolConfig = {
        ides: preSelectedIdes,
        skipIde: !preSelectedIdes || preSelectedIdes.length === 0,
      };
    }

    // Check for already configured IDEs
    const { Detector } = require('./detector');
    const detector = new Detector();
    const hseosDir = path.join(projectDir, HSEOS_FOLDER_NAME);

    // During full reinstall, use the saved previous IDEs since hseos dir was deleted
    // Otherwise detect from existing installation
    let previouslyConfiguredIdes;
    if (isFullReinstall) {
      // During reinstall, treat all IDEs as new (need configuration)
      previouslyConfiguredIdes = [];
    } else {
      const existingInstall = await detector.detect(hseosDir);
      previouslyConfiguredIdes = existingInstall.ides || [];
    }

    // Load saved IDE configurations for already-configured IDEs
    const savedIdeConfigs = await this.ideConfigManager.loadAllIdeConfigs(hseosDir);

    // Collect IDE-specific configurations if any were selected
    const ideConfigurations = {};

    // First, add saved configs for already-configured IDEs
    for (const ide of toolConfig.ides || []) {
      if (previouslyConfiguredIdes.includes(ide) && savedIdeConfigs[ide]) {
        ideConfigurations[ide] = savedIdeConfigs[ide];
      }
    }

    if (!toolConfig.skipIde && toolConfig.ides && toolConfig.ides.length > 0) {
      // Ensure IDE manager is initialized
      await this.ideManager.ensureInitialized();

      // Determine which IDEs are newly selected (not previously configured)
      const newlySelectedIdes = toolConfig.ides.filter((ide) => !previouslyConfiguredIdes.includes(ide));

      if (newlySelectedIdes.length > 0) {
        // Collect configuration for IDEs that support it
        for (const ide of newlySelectedIdes) {
          try {
            const handler = this.ideManager.handlers.get(ide);

            if (!handler) {
              await prompts.log.warn(`Warning: IDE '${ide}' handler not found`);
              continue;
            }

            // Check if this IDE handler has a collectConfiguration method
            // (custom installers like Codex, Kilo may have this)
            if (typeof handler.collectConfiguration === 'function') {
              await prompts.log.info(`Configuring ${ide}...`);
              ideConfigurations[ide] = await handler.collectConfiguration({
                selectedModules: selectedModules || [],
                projectDir,
                hseosDir,
                skipPrompts,
              });
            } else {
              // Config-driven IDEs don't need configuration - mark as ready
              ideConfigurations[ide] = { _noConfigNeeded: true };
            }
          } catch (error) {
            // IDE doesn't support configuration or has an error
            await prompts.log.warn(`Warning: Could not load configuration for ${ide}: ${error.message}`);
          }
        }
      }

      // Log which IDEs are already configured and being kept
      const keptIdes = toolConfig.ides.filter((ide) => previouslyConfiguredIdes.includes(ide));
      if (keptIdes.length > 0) {
        await prompts.log.message(`Keeping existing configuration for: ${keptIdes.join(', ')}`);
      }
    }

    return {
      ides: toolConfig.ides,
      skipIde: toolConfig.skipIde,
      configurations: ideConfigurations,
    };
  }

  /**
   * Main installation method
   * @param {Object} config - Installation configuration
   * @param {string} config.directory - Target directory
   * @param {boolean} config.installCore - Whether to install core
   * @param {string[]} config.modules - Modules to install
   * @param {string[]} config.ides - IDEs to configure
   * @param {boolean} config.skipIde - Skip IDE configuration
   */
  async install(originalConfig) {
    // Clone config to avoid mutating the caller's object
    const config = { ...originalConfig };

    // Check if core config was already collected in UI
    const hasCoreConfig = config.coreConfig && Object.keys(config.coreConfig).length > 0;

    // Only display logo if core config wasn't already collected (meaning we're not continuing from UI)
    if (!hasCoreConfig) {
      // Display HSEOS logo
      await CLIUtils.displayLogo();

      // Display welcome message
      await CLIUtils.displaySection('HSEOS™  Installation', 'Version ' + require(path.join(getProjectRoot(), 'package.json')).version);
    }

    // Note: Legacy V4 detection now happens earlier in UI.promptInstall()
    // before any config collection, so we don't need to check again here

    const projectDir = path.resolve(config.directory);
    const hseosDir = path.join(projectDir, HSEOS_FOLDER_NAME);

    // If core config was pre-collected (from interactive mode), use it
    if (config.coreConfig && Object.keys(config.coreConfig).length > 0) {
      this.configCollector.collectedConfig.core = config.coreConfig;
      // Also store in allAnswers for cross-referencing
      this.configCollector.allAnswers = {};
      for (const [key, value] of Object.entries(config.coreConfig)) {
        this.configCollector.allAnswers[`core_${key}`] = value;
      }
    }

    // Collect configurations for modules (skip if quick update already collected them)
    let moduleConfigs;
    let customModulePaths = new Map();

    if (config._quickUpdate) {
      // Quick update already collected all configs, use them directly
      moduleConfigs = this.configCollector.collectedConfig;

      // For quick update, populate customModulePaths from _customModuleSources
      if (config._customModuleSources) {
        for (const [moduleId, customInfo] of config._customModuleSources) {
          customModulePaths.set(moduleId, customInfo.sourcePath);
        }
      }
    } else {
      // For regular updates (modify flow), check manifest for custom module sources
      if (config._isUpdate && config._existingInstall && config._existingInstall.customModules) {
        for (const customModule of config._existingInstall.customModules) {
          // Ensure we have an absolute sourcePath
          let absoluteSourcePath = customModule.sourcePath;

          // Check if sourcePath is a cache-relative path (starts with _config)
          if (absoluteSourcePath && absoluteSourcePath.startsWith('_config')) {
            // Convert cache-relative path to absolute path
            absoluteSourcePath = path.join(hseosDir, absoluteSourcePath);
          }
          // If no sourcePath but we have relativePath, convert it
          else if (!absoluteSourcePath && customModule.relativePath) {
            // relativePath is relative to the project root (parent of hseos dir)
            absoluteSourcePath = path.resolve(projectDir, customModule.relativePath);
          }
          // Ensure sourcePath is absolute for anything else
          else if (absoluteSourcePath && !path.isAbsolute(absoluteSourcePath)) {
            absoluteSourcePath = path.resolve(absoluteSourcePath);
          }

          if (absoluteSourcePath) {
            customModulePaths.set(customModule.id, absoluteSourcePath);
          }
        }
      }

      // Build custom module paths map from customContent

      // Handle selectedFiles (from existing install path or manual directory input)
      if (config.customContent && config.customContent.selected && config.customContent.selectedFiles) {
        const customHandler = new CustomHandler();
        for (const customFile of config.customContent.selectedFiles) {
          const customInfo = await customHandler.getCustomInfo(customFile, path.resolve(config.directory));
          if (customInfo && customInfo.id) {
            customModulePaths.set(customInfo.id, customInfo.path);
          }
        }
      }

      // Handle new custom content sources from UI
      if (config.customContent && config.customContent.sources) {
        for (const source of config.customContent.sources) {
          customModulePaths.set(source.id, source.path);
        }
      }

      // Handle cachedModules (from new install path where modules are cached)
      // Only include modules that were actually selected for installation
      if (config.customContent && config.customContent.cachedModules) {
        // Get selected cached module IDs (if available)
        const selectedCachedIds = config.customContent.selectedCachedModules || [];
        // If no selection info, include all cached modules (for backward compatibility)
        const shouldIncludeAll = selectedCachedIds.length === 0 && config.customContent.selected;

        for (const cachedModule of config.customContent.cachedModules) {
          // For cached modules, the path is the cachePath which contains the module.yaml
          if (
            cachedModule.id &&
            cachedModule.cachePath && // Include if selected or if we should include all
            (shouldIncludeAll || selectedCachedIds.includes(cachedModule.id))
          ) {
            customModulePaths.set(cachedModule.id, cachedModule.cachePath);
          }
        }
      }

      // Get list of all modules including custom modules
      // Order: core first, then official modules, then custom modules
      const allModulesForConfig = ['core'];

      // Add official modules (excluding core and any custom modules)
      const officialModules = (config.modules || []).filter((m) => m !== 'core' && !customModulePaths.has(m));
      allModulesForConfig.push(...officialModules);

      // Add custom modules at the end
      for (const [moduleId] of customModulePaths) {
        if (!allModulesForConfig.includes(moduleId)) {
          allModulesForConfig.push(moduleId);
        }
      }

      // Check if core was already collected in UI
      if (config.coreConfig && Object.keys(config.coreConfig).length > 0) {
        // Core already collected, skip it in config collection
        const modulesWithoutCore = allModulesForConfig.filter((m) => m !== 'core');
        moduleConfigs = await this.configCollector.collectAllConfigurations(modulesWithoutCore, path.resolve(config.directory), {
          customModulePaths,
          skipPrompts: config.skipPrompts,
        });
      } else {
        // Core not collected yet, include it
        moduleConfigs = await this.configCollector.collectAllConfigurations(allModulesForConfig, path.resolve(config.directory), {
          customModulePaths,
          skipPrompts: config.skipPrompts,
        });
      }
    }

    // Set hseos folder name on module manager and IDE manager for placeholder replacement
    this.moduleManager.setHseosFolderName(HSEOS_FOLDER_NAME);
    this.moduleManager.setCoreConfig(moduleConfigs.core || {});
    this.moduleManager.setCustomModulePaths(customModulePaths);
    this.ideManager.setHseosFolderName(HSEOS_FOLDER_NAME);

    // Tool selection will be collected after we determine if it's a reinstall/update/new install

    const spinner = await prompts.spinner();
    spinner.start('Preparing installation...');

    try {
      // Create a project directory if it doesn't exist (user already confirmed)
      if (!(await fs.pathExists(projectDir))) {
        spinner.message('Creating installation directory...');
        try {
          // fs.ensureDir handles platform-specific directory creation
          // It will recursively create all necessary parent directories
          await fs.ensureDir(projectDir);
        } catch (error) {
          spinner.error('Failed to create installation directory');
          await prompts.log.error(`Error: ${error.message}`);
          // More detailed error for common issues
          if (error.code === 'EACCES') {
            await prompts.log.error('Permission denied. Check parent directory permissions.');
          } else if (error.code === 'ENOSPC') {
            await prompts.log.error('No space left on device.');
          }
          throw new Error(`Cannot create directory: ${projectDir}`);
        }
      }

      // Check existing installation
      spinner.message('Checking for existing installation...');
      const existingInstall = await this.detector.detect(hseosDir);

      if (existingInstall.installed && !config.force && !config._quickUpdate) {
        spinner.stop('Existing installation detected');

        // Check if user already decided what to do (from early menu in ui.js)
        let action = null;
        if (config.actionType === 'update') {
          action = 'update';
        } else if (config.skipPrompts) {
          // Non-interactive mode: default to update
          action = 'update';
        } else {
          // Fallback: Ask the user (backwards compatibility for other code paths)
          await prompts.log.warn('Existing HSEOS installation detected');
          await prompts.log.message(`  Location: ${hseosDir}`);
          await prompts.log.message(`  Version: ${existingInstall.version}`);

          const promptResult = await this.promptUpdateAction();
          action = promptResult.action;
        }

        if (action === 'update') {
          // Store that we're updating for later processing
          config._isUpdate = true;
          config._existingInstall = existingInstall;

          // Detect modules that were previously installed but are NOT in the new selection (to be removed)
          const previouslyInstalledModules = new Set(existingInstall.modules.map((m) => m.id));
          const newlySelectedModules = new Set(config.modules || []);

          // Find modules to remove (installed but not in new selection)
          // Exclude 'core' from being removable
          const modulesToRemove = [...previouslyInstalledModules].filter((m) => !newlySelectedModules.has(m) && m !== 'core');

          // If there are modules to remove, ask for confirmation
          if (modulesToRemove.length > 0) {
            if (config.skipPrompts) {
              // Non-interactive mode: preserve modules (matches prompt default: false)
              for (const moduleId of modulesToRemove) {
                if (!config.modules) config.modules = [];
                config.modules.push(moduleId);
              }
              spinner.start('Preparing update...');
            } else {
              if (spinner.isSpinning) {
                spinner.stop('Module changes reviewed');
              }

              await prompts.log.warn('Modules to be removed:');
              for (const moduleId of modulesToRemove) {
                const moduleInfo = existingInstall.modules.find((m) => m.id === moduleId);
                const displayName = moduleInfo?.name || moduleId;
                const modulePath = path.join(hseosDir, moduleId);
                await prompts.log.error(`  - ${displayName} (${modulePath})`);
              }

              const confirmRemoval = await prompts.confirm({
                message: `Remove ${modulesToRemove.length} module(s) from HSEOS installation?`,
                default: false,
              });

              if (confirmRemoval) {
                // Remove module folders
                for (const moduleId of modulesToRemove) {
                  const modulePath = path.join(hseosDir, moduleId);
                  try {
                    if (await fs.pathExists(modulePath)) {
                      await fs.remove(modulePath);
                      await prompts.log.message(`  Removed: ${moduleId}`);
                    }
                  } catch (error) {
                    await prompts.log.warn(`  Warning: Failed to remove ${moduleId}: ${error.message}`);
                  }
                }
                await prompts.log.success(`  Removed ${modulesToRemove.length} module(s)`);
              } else {
                await prompts.log.message('  Module removal cancelled');
                // Add the modules back to the selection since user cancelled removal
                for (const moduleId of modulesToRemove) {
                  if (!config.modules) config.modules = [];
                  config.modules.push(moduleId);
                }
              }

              spinner.start('Preparing update...');
            }
          }

          // Detect custom and modified files BEFORE updating (compare current files vs files-manifest.csv)
          const existingFilesManifest = await this.readFilesManifest(hseosDir);
          const { customFiles, modifiedFiles } = await this.detectCustomFiles(hseosDir, existingFilesManifest);

          config._customFiles = customFiles;
          config._modifiedFiles = modifiedFiles;

          // Preserve existing core configuration during updates
          // Read the current core config.yaml to maintain user's settings
          const coreConfigPath = path.join(hseosDir, 'core', 'config.yaml');
          if ((await fs.pathExists(coreConfigPath)) && (!config.coreConfig || Object.keys(config.coreConfig).length === 0)) {
            try {
              const yaml = require('yaml');
              const coreConfigContent = await fs.readFile(coreConfigPath, 'utf8');
              const existingCoreConfig = yaml.parse(coreConfigContent);

              // Store in config.coreConfig so it's preserved through the installation
              config.coreConfig = existingCoreConfig;

              // Also store in configCollector for use during config collection
              this.configCollector.collectedConfig.core = existingCoreConfig;
            } catch (error) {
              await prompts.log.warn(`Warning: Could not read existing core config: ${error.message}`);
            }
          }

          // Also check cache directory for custom modules (like quick update does)
          const cacheDir = path.join(hseosDir, '_config', 'custom');
          if (await fs.pathExists(cacheDir)) {
            const cachedModules = await fs.readdir(cacheDir, { withFileTypes: true });

            for (const cachedModule of cachedModules) {
              const moduleId = cachedModule.name;
              const cachedPath = path.join(cacheDir, moduleId);

              // Skip if path doesn't exist (broken symlink, deleted dir) - avoids lstat ENOENT
              if (!(await fs.pathExists(cachedPath)) || !cachedModule.isDirectory()) {
                continue;
              }

              // Skip if we already have this module from manifest
              if (customModulePaths.has(moduleId)) {
                continue;
              }

              // Check if this is an external official module - skip cache for those
              const isExternal = await this.moduleManager.isExternalModule(moduleId);
              if (isExternal) {
                // External modules are handled via cloneExternalModule, not from cache
                continue;
              }

              // Check if this is actually a custom module (has module.yaml)
              const moduleYamlPath = path.join(cachedPath, 'module.yaml');
              if (await fs.pathExists(moduleYamlPath)) {
                customModulePaths.set(moduleId, cachedPath);
              }
            }

            // Update module manager with the new custom module paths from cache
            this.moduleManager.setCustomModulePaths(customModulePaths);
          }

          // If there are custom files, back them up temporarily
          if (customFiles.length > 0) {
            const tempBackupDir = path.join(projectDir, '.hseos-custom-backup-temp');
            await fs.ensureDir(tempBackupDir);

            spinner.start(`Backing up ${customFiles.length} custom files...`);
            for (const customFile of customFiles) {
              const relativePath = path.relative(hseosDir, customFile);
              const backupPath = path.join(tempBackupDir, relativePath);
              await fs.ensureDir(path.dirname(backupPath));
              await fs.copy(customFile, backupPath);
            }
            spinner.stop(`Backed up ${customFiles.length} custom files`);

            config._tempBackupDir = tempBackupDir;
          }

          // For modified files, back them up to temp directory (will be restored as .bak files after install)
          if (modifiedFiles.length > 0) {
            const tempModifiedBackupDir = path.join(projectDir, '.hseos-modified-backup-temp');
            await fs.ensureDir(tempModifiedBackupDir);

            spinner.start(`Backing up ${modifiedFiles.length} modified files...`);
            for (const modifiedFile of modifiedFiles) {
              const relativePath = path.relative(hseosDir, modifiedFile.path);
              const tempBackupPath = path.join(tempModifiedBackupDir, relativePath);
              await fs.ensureDir(path.dirname(tempBackupPath));
              await fs.copy(modifiedFile.path, tempBackupPath, { overwrite: true });
            }
            spinner.stop(`Backed up ${modifiedFiles.length} modified files`);

            config._tempModifiedBackupDir = tempModifiedBackupDir;
          }
        }
      } else if (existingInstall.installed && config._quickUpdate) {
        // Quick update mode - automatically treat as update without prompting
        spinner.message('Preparing quick update...');
        config._isUpdate = true;
        config._existingInstall = existingInstall;

        // Detect custom and modified files BEFORE updating
        const existingFilesManifest = await this.readFilesManifest(hseosDir);
        const { customFiles, modifiedFiles } = await this.detectCustomFiles(hseosDir, existingFilesManifest);

        config._customFiles = customFiles;
        config._modifiedFiles = modifiedFiles;

        // Also check cache directory for custom modules (like quick update does)
        const cacheDir = path.join(hseosDir, '_config', 'custom');
        if (await fs.pathExists(cacheDir)) {
          const cachedModules = await fs.readdir(cacheDir, { withFileTypes: true });

          for (const cachedModule of cachedModules) {
            const moduleId = cachedModule.name;
            const cachedPath = path.join(cacheDir, moduleId);

            // Skip if path doesn't exist (broken symlink, deleted dir) - avoids lstat ENOENT
            if (!(await fs.pathExists(cachedPath)) || !cachedModule.isDirectory()) {
              continue;
            }

            // Skip if we already have this module from manifest
            if (customModulePaths.has(moduleId)) {
              continue;
            }

            // Check if this is an external official module - skip cache for those
            const isExternal = await this.moduleManager.isExternalModule(moduleId);
            if (isExternal) {
              // External modules are handled via cloneExternalModule, not from cache
              continue;
            }

            // Check if this is actually a custom module (has module.yaml)
            const moduleYamlPath = path.join(cachedPath, 'module.yaml');
            if (await fs.pathExists(moduleYamlPath)) {
              customModulePaths.set(moduleId, cachedPath);
            }
          }

          // Update module manager with the new custom module paths from cache
          this.moduleManager.setCustomModulePaths(customModulePaths);
        }

        // Back up custom files
        if (customFiles.length > 0) {
          const tempBackupDir = path.join(projectDir, '.hseos-custom-backup-temp');
          await fs.ensureDir(tempBackupDir);

          spinner.start(`Backing up ${customFiles.length} custom files...`);
          for (const customFile of customFiles) {
            const relativePath = path.relative(hseosDir, customFile);
            const backupPath = path.join(tempBackupDir, relativePath);
            await fs.ensureDir(path.dirname(backupPath));
            await fs.copy(customFile, backupPath);
          }
          spinner.stop(`Backed up ${customFiles.length} custom files`);
          config._tempBackupDir = tempBackupDir;
        }

        // Back up modified files
        if (modifiedFiles.length > 0) {
          const tempModifiedBackupDir = path.join(projectDir, '.hseos-modified-backup-temp');
          await fs.ensureDir(tempModifiedBackupDir);

          spinner.start(`Backing up ${modifiedFiles.length} modified files...`);
          for (const modifiedFile of modifiedFiles) {
            const relativePath = path.relative(hseosDir, modifiedFile.path);
            const tempBackupPath = path.join(tempModifiedBackupDir, relativePath);
            await fs.ensureDir(path.dirname(tempBackupPath));
            await fs.copy(modifiedFile.path, tempBackupPath, { overwrite: true });
          }
          spinner.stop(`Backed up ${modifiedFiles.length} modified files`);
          config._tempModifiedBackupDir = tempModifiedBackupDir;
        }
      }

      // Now collect tool configurations after we know if it's a reinstall
      // Skip for quick update since we already have the IDE list
      spinner.stop('Pre-checks complete');
      let toolSelection;
      if (config._quickUpdate) {
        // Quick update already has IDEs configured, use saved configurations
        const preConfiguredIdes = {};
        const savedIdeConfigs = config._savedIdeConfigs || {};

        for (const ide of config.ides || []) {
          // Use saved config if available, otherwise mark as already configured (legacy)
          if (savedIdeConfigs[ide]) {
            preConfiguredIdes[ide] = savedIdeConfigs[ide];
          } else {
            preConfiguredIdes[ide] = { _alreadyConfigured: true };
          }
        }
        toolSelection = {
          ides: config.ides || [],
          skipIde: !config.ides || config.ides.length === 0,
          configurations: preConfiguredIdes,
        };
      } else {
        // Pass pre-selected IDEs from early prompt (if available)
        // This allows IDE selection to happen before file copying, improving UX
        // Use config.ides if it's an array (even if empty), null means prompt
        const preSelectedIdes = Array.isArray(config.ides) ? config.ides : null;
        toolSelection = await this.collectToolConfigurations(
          path.resolve(config.directory),
          config.modules,
          config._isFullReinstall || false,
          config._previouslyConfiguredIdes || [],
          preSelectedIdes,
          config.skipPrompts || false,
        );
      }

      // Merge tool selection into config (for both quick update and regular flow)
      config.ides = toolSelection.ides;
      config.skipIde = toolSelection.skipIde;
      const ideConfigurations = toolSelection.configurations;

      // Detect IDEs that were previously installed but are NOT in the new selection (to be removed)
      if (config._isUpdate && config._existingInstall) {
        const previouslyInstalledIdes = new Set(config._existingInstall.ides || []);
        const newlySelectedIdes = new Set(config.ides || []);

        const idesToRemove = [...previouslyInstalledIdes].filter((ide) => !newlySelectedIdes.has(ide));

        if (idesToRemove.length > 0) {
          if (config.skipPrompts) {
            // Non-interactive mode: silently preserve existing IDE configs
            if (!config.ides) config.ides = [];
            const savedIdeConfigs = await this.ideConfigManager.loadAllIdeConfigs(hseosDir);
            for (const ide of idesToRemove) {
              config.ides.push(ide);
              if (savedIdeConfigs[ide] && !ideConfigurations[ide]) {
                ideConfigurations[ide] = savedIdeConfigs[ide];
              }
            }
          } else {
            if (spinner.isSpinning) {
              spinner.stop('IDE changes reviewed');
            }

            await prompts.log.warn('IDEs to be removed:');
            for (const ide of idesToRemove) {
              await prompts.log.error(`  - ${ide}`);
            }

            const confirmRemoval = await prompts.confirm({
              message: `Remove HSEOS configuration for ${idesToRemove.length} IDE(s)?`,
              default: false,
            });

            if (confirmRemoval) {
              await this.ideManager.ensureInitialized();
              for (const ide of idesToRemove) {
                try {
                  const handler = this.ideManager.handlers.get(ide);
                  if (handler) {
                    await handler.cleanup(projectDir);
                  }
                  await this.ideConfigManager.deleteIdeConfig(hseosDir, ide);
                  await prompts.log.message(`  Removed: ${ide}`);
                } catch (error) {
                  await prompts.log.warn(`  Warning: Failed to remove ${ide}: ${error.message}`);
                }
              }
              await prompts.log.success(`  Removed ${idesToRemove.length} IDE(s)`);
            } else {
              await prompts.log.message('  IDE removal cancelled');
              // Add IDEs back to selection and restore their saved configurations
              if (!config.ides) config.ides = [];
              const savedIdeConfigs = await this.ideConfigManager.loadAllIdeConfigs(hseosDir);
              for (const ide of idesToRemove) {
                config.ides.push(ide);
                if (savedIdeConfigs[ide] && !ideConfigurations[ide]) {
                  ideConfigurations[ide] = savedIdeConfigs[ide];
                }
              }
            }

            spinner.start('Preparing installation...');
          }
        }
      }

      // Results collector for consolidated summary
      const results = [];
      const addResult = (step, status, detail = '') => results.push({ step, status, detail });

      if (spinner.isSpinning) {
        spinner.message('Preparing installation...');
      } else {
        spinner.start('Preparing installation...');
      }

      // Create hseos directory structure
      spinner.message('Creating directory structure...');
      await this.createDirectoryStructure(hseosDir);

      // Cache custom modules if any
      if (customModulePaths && customModulePaths.size > 0) {
        spinner.message('Caching custom modules...');
        const { CustomModuleCache } = require('./custom-module-cache');
        const customCache = new CustomModuleCache(hseosDir);

        for (const [moduleId, sourcePath] of customModulePaths) {
          const cachedInfo = await customCache.cacheModule(moduleId, sourcePath, {
            sourcePath: sourcePath, // Store original path for updates
          });

          // Update the customModulePaths to use the cached location
          customModulePaths.set(moduleId, cachedInfo.cachePath);
        }

        // Update module manager with the cached paths
        this.moduleManager.setCustomModulePaths(customModulePaths);
        addResult('Custom modules cached', 'ok');
      }

      const projectRoot = getProjectRoot();

      // Custom content is already handled in UI before module selection
      const finalCustomContent = config.customContent;

      // Prepare modules list including cached custom modules
      let allModules = [...(config.modules || [])];

      // During quick update, we might have custom module sources from the manifest
      if (config._customModuleSources) {
        // Add custom modules from stored sources
        for (const [moduleId, customInfo] of config._customModuleSources) {
          if (!allModules.includes(moduleId) && (await fs.pathExists(customInfo.sourcePath))) {
            allModules.push(moduleId);
          }
        }
      }

      // Add cached custom modules
      if (finalCustomContent && finalCustomContent.cachedModules) {
        for (const cachedModule of finalCustomContent.cachedModules) {
          if (!allModules.includes(cachedModule.id)) {
            allModules.push(cachedModule.id);
          }
        }
      }

      // Regular custom content from user input (non-cached)
      if (finalCustomContent && finalCustomContent.selected && finalCustomContent.selectedFiles) {
        // Add custom modules to the installation list
        const customHandler = new CustomHandler();
        for (const customFile of finalCustomContent.selectedFiles) {
          const customInfo = await customHandler.getCustomInfo(customFile, projectDir);
          if (customInfo && customInfo.id) {
            allModules.push(customInfo.id);
          }
        }
      }

      // Don't include core again if already installed
      if (config.installCore) {
        allModules = allModules.filter((m) => m !== 'core');
      }

      // For dependency resolution, we only need regular modules (not custom modules)
      // Custom modules are already installed in .hseos and don't need dependency resolution from source
      const regularModulesForResolution = allModules.filter((module) => {
        // Check if this is a custom module
        const isCustom =
          customModulePaths.has(module) ||
          (finalCustomContent && finalCustomContent.cachedModules && finalCustomContent.cachedModules.some((cm) => cm.id === module)) ||
          (finalCustomContent &&
            finalCustomContent.selected &&
            finalCustomContent.selectedFiles &&
            finalCustomContent.selectedFiles.some((f) => f.includes(module)));
        return !isCustom;
      });

      // Stop spinner before tasks() takes over progress display
      spinner.stop('Preparation complete');

      // ─────────────────────────────────────────────────────────────────────────
      // FIRST TASKS BLOCK: Core installation through manifests (non-interactive)
      // ─────────────────────────────────────────────────────────────────────────
      const isQuickUpdate = config._quickUpdate || false;

      // Shared resolution result across task callbacks (closure-scoped, not on `this`)
      let taskResolution;

      // Collect directory creation results for output after tasks() completes
      const dirResults = { createdDirs: [], movedDirs: [], createdWdsFolders: [] };

      // Build task list conditionally
      const installTasks = [];

      // Core installation task
      if (config.installCore) {
        installTasks.push({
          title: isQuickUpdate ? 'Updating HSEOS core' : 'Installing HSEOS core',
          task: async (message) => {
            await this.installCoreWithDependencies(hseosDir, { core: {} });
            addResult('Core', 'ok', isQuickUpdate ? 'updated' : 'installed');
            await this.generateModuleConfigs(hseosDir, { core: config.coreConfig || {} });
            return isQuickUpdate ? 'Core updated' : 'Core installed';
          },
        });
      }

      // Dependency resolution task
      installTasks.push({
        title: 'Resolving dependencies',
        task: async (message) => {
          // Create a temporary module manager that knows about custom content locations
          const tempModuleManager = new ModuleManager({
            hseosDir: hseosDir,
          });

          taskResolution = await this.dependencyResolver.resolve(projectRoot, regularModulesForResolution, {
            verbose: config.verbose,
            moduleManager: tempModuleManager,
          });
          return 'Dependencies resolved';
        },
      });

      // Module installation task
      if (allModules && allModules.length > 0) {
        installTasks.push({
          title: isQuickUpdate ? `Updating ${allModules.length} module(s)` : `Installing ${allModules.length} module(s)`,
          task: async (message) => {
            const resolution = taskResolution;
            const installedModuleNames = new Set();

            for (const moduleName of allModules) {
              if (installedModuleNames.has(moduleName)) continue;
              installedModuleNames.add(moduleName);

              message(`${isQuickUpdate ? 'Updating' : 'Installing'} ${moduleName}...`);

              // Check if this is a custom module
              let isCustomModule = false;
              let customInfo = null;

              // First check if we have a cached version
              if (finalCustomContent && finalCustomContent.cachedModules) {
                const cachedModule = finalCustomContent.cachedModules.find((m) => m.id === moduleName);
                if (cachedModule) {
                  isCustomModule = true;
                  customInfo = { id: moduleName, path: cachedModule.cachePath, config: {} };
                }
              }

              // Then check custom module sources from manifest (for quick update)
              if (!isCustomModule && config._customModuleSources && config._customModuleSources.has(moduleName)) {
                customInfo = config._customModuleSources.get(moduleName);
                isCustomModule = true;
                if (customInfo.sourcePath && !customInfo.path) {
                  customInfo.path = path.isAbsolute(customInfo.sourcePath)
                    ? customInfo.sourcePath
                    : path.join(hseosDir, customInfo.sourcePath);
                }
              }

              // Finally check regular custom content
              if (!isCustomModule && finalCustomContent && finalCustomContent.selected && finalCustomContent.selectedFiles) {
                const customHandler = new CustomHandler();
                for (const customFile of finalCustomContent.selectedFiles) {
                  const info = await customHandler.getCustomInfo(customFile, projectDir);
                  if (info && info.id === moduleName) {
                    isCustomModule = true;
                    customInfo = info;
                    break;
                  }
                }
              }

              if (isCustomModule && customInfo) {
                if (!customModulePaths.has(moduleName) && customInfo.path) {
                  customModulePaths.set(moduleName, customInfo.path);
                  this.moduleManager.setCustomModulePaths(customModulePaths);
                }

                const collectedModuleConfig = moduleConfigs[moduleName] || {};
                await this.moduleManager.install(
                  moduleName,
                  hseosDir,
                  (filePath) => {
                    this.installedFiles.add(filePath);
                  },
                  {
                    isCustom: true,
                    moduleConfig: collectedModuleConfig,
                    isQuickUpdate: isQuickUpdate,
                    installer: this,
                    silent: true,
                  },
                );
                await this.generateModuleConfigs(hseosDir, {
                  [moduleName]: { ...config.coreConfig, ...customInfo.config, ...collectedModuleConfig },
                });
              } else {
                if (!resolution || !resolution.byModule) {
                  addResult(`Module: ${moduleName}`, 'warn', 'skipped (no resolution data)');
                  continue;
                }
                if (moduleName === 'core') {
                  await this.installCoreWithDependencies(hseosDir, resolution.byModule[moduleName]);
                } else {
                  await this.installModuleWithDependencies(moduleName, hseosDir, resolution.byModule[moduleName]);
                }
              }

              addResult(`Module: ${moduleName}`, 'ok', isQuickUpdate ? 'updated' : 'installed');
            }

            // Install partial modules (only dependencies)
            if (!resolution || !resolution.byModule) {
              return `${allModules.length} module(s) ${isQuickUpdate ? 'updated' : 'installed'}`;
            }
            for (const [module, files] of Object.entries(resolution.byModule)) {
              if (!allModules.includes(module) && module !== 'core') {
                const totalFiles =
                  files.agents.length +
                  files.tasks.length +
                  files.tools.length +
                  files.templates.length +
                  files.data.length +
                  files.other.length;
                if (totalFiles > 0) {
                  message(`Installing ${module} dependencies...`);
                  await this.installPartialModule(module, hseosDir, files);
                }
              }
            }

            return `${allModules.length} module(s) ${isQuickUpdate ? 'updated' : 'installed'}`;
          },
        });
      }

      // Module directory creation task
      installTasks.push({
        title: 'Creating module directories',
        task: async (message) => {
          const resolution = taskResolution;
          if (!resolution || !resolution.byModule) {
            addResult('Module directories', 'warn', 'no resolution data');
            return 'Module directories skipped (no resolution data)';
          }
          const verboseMode = process.env.HSEOS_VERBOSE_INSTALL === 'true' || config.verbose;
          const moduleLogger = {
            log: async (msg) => (verboseMode ? await prompts.log.message(msg) : undefined),
            error: async (msg) => await prompts.log.error(msg),
            warn: async (msg) => await prompts.log.warn(msg),
          };

          // Core module directories
          if (config.installCore || resolution.byModule.core) {
            const result = await this.moduleManager.createModuleDirectories('core', hseosDir, {
              installedIDEs: config.ides || [],
              moduleConfig: moduleConfigs.core || {},
              existingModuleConfig: this.configCollector.existingConfig?.core || {},
              coreConfig: moduleConfigs.core || {},
              logger: moduleLogger,
              silent: true,
            });
            if (result) {
              dirResults.createdDirs.push(...result.createdDirs);
              dirResults.movedDirs.push(...(result.movedDirs || []));
              dirResults.createdWdsFolders.push(...result.createdWdsFolders);
            }
          }

          // User-selected module directories
          if (config.modules && config.modules.length > 0) {
            for (const moduleName of config.modules) {
              message(`Setting up ${moduleName}...`);
              const result = await this.moduleManager.createModuleDirectories(moduleName, hseosDir, {
                installedIDEs: config.ides || [],
                moduleConfig: moduleConfigs[moduleName] || {},
                existingModuleConfig: this.configCollector.existingConfig?.[moduleName] || {},
                coreConfig: moduleConfigs.core || {},
                logger: moduleLogger,
                silent: true,
              });
              if (result) {
                dirResults.createdDirs.push(...result.createdDirs);
                dirResults.movedDirs.push(...(result.movedDirs || []));
                dirResults.createdWdsFolders.push(...result.createdWdsFolders);
              }
            }
          }

          addResult('Module directories', 'ok');
          return 'Module directories created';
        },
      });

      // Configuration generation task (stored as named reference for deferred execution)
      const configTask = {
        title: 'Generating configurations',
        task: async (message) => {
          // Generate clean config.yaml files for each installed module
          await this.generateModuleConfigs(hseosDir, moduleConfigs);
          addResult('Configurations', 'ok', 'generated');

          // Pre-register manifest files
          const cfgDir = path.join(hseosDir, '_config');
          this.installedFiles.add(path.join(cfgDir, 'manifest.yaml'));
          this.installedFiles.add(path.join(cfgDir, 'workflow-manifest.csv'));
          this.installedFiles.add(path.join(cfgDir, 'agent-manifest.csv'));
          this.installedFiles.add(path.join(cfgDir, 'task-manifest.csv'));

          // Generate CSV manifests for workflows, agents, tasks AND ALL FILES with hashes
          // This must happen BEFORE mergeModuleHelpCatalogs because it depends on agent-manifest.csv
          message('Generating manifests...');
          const manifestGen = new ManifestGenerator();

          const allModulesForManifest = config._quickUpdate
            ? config._existingModules || allModules || []
            : config._preserveModules
              ? [...allModules, ...config._preserveModules]
              : allModules || [];

          let modulesForCsvPreserve;
          if (config._quickUpdate) {
            modulesForCsvPreserve = config._existingModules || allModules || [];
          } else {
            modulesForCsvPreserve = config._preserveModules ? [...allModules, ...config._preserveModules] : allModules;
          }

          const manifestStats = await manifestGen.generateManifests(hseosDir, allModulesForManifest, [...this.installedFiles], {
            ides: config.ides || [],
            preservedModules: modulesForCsvPreserve,
          });

          addResult(
            'Manifests',
            'ok',
            `${manifestStats.workflows} workflows, ${manifestStats.agents} agents, ${manifestStats.tasks} tasks, ${manifestStats.tools} tools`,
          );

          // Merge help catalogs
          message('Generating help catalog...');
          await this.mergeModuleHelpCatalogs(hseosDir);
          addResult('Help catalog', 'ok');

          return 'Configurations generated';
        },
      };
      installTasks.push(configTask);

      // Run all tasks except config (which runs after directory output)
      const mainTasks = installTasks.filter((t) => t !== configTask);
      await prompts.tasks(mainTasks);

      // Render directory creation output right after directory task
      const color = await prompts.getColor();
      if (dirResults.movedDirs.length > 0) {
        const lines = dirResults.movedDirs.map((d) => `  ${d}`).join('\n');
        await prompts.log.message(color.cyan(`Moved directories:\n${lines}`));
      }
      if (dirResults.createdDirs.length > 0) {
        const lines = dirResults.createdDirs.map((d) => `  ${d}`).join('\n');
        await prompts.log.message(color.yellow(`Created directories:\n${lines}`));
      }
      if (dirResults.createdWdsFolders.length > 0) {
        const lines = dirResults.createdWdsFolders.map((f) => color.dim(`  \u2713 ${f}/`)).join('\n');
        await prompts.log.message(color.cyan(`Created WDS folder structure:\n${lines}`));
      }

      // Now run configuration generation
      await prompts.tasks([configTask]);

      // Resolution is now available via closure-scoped taskResolution
      const resolution = taskResolution;

      // ─────────────────────────────────────────────────────────────────────────
      // IDE SETUP: Keep as spinner since it may prompt for user input
      // ─────────────────────────────────────────────────────────────────────────
      if (!config.skipIde && config.ides && config.ides.length > 0) {
        await this.ideManager.ensureInitialized();
        const validIdes = config.ides.filter((ide) => ide && typeof ide === 'string');

        if (validIdes.length === 0) {
          addResult('IDE configuration', 'warn', 'no valid IDEs selected');
        } else {
          const needsPrompting = validIdes.some((ide) => !ideConfigurations[ide]);
          const ideSpinner = await prompts.spinner();
          ideSpinner.start('Configuring tools...');

          try {
            for (const ide of validIdes) {
              if (!needsPrompting || ideConfigurations[ide]) {
                ideSpinner.message(`Configuring ${ide}...`);
              } else {
                if (ideSpinner.isSpinning) {
                  ideSpinner.stop('Ready for IDE configuration');
                }
              }

              // Suppress stray console output for pre-configured IDEs (no user interaction)
              const ideHasConfig = Boolean(ideConfigurations[ide]);
              const originalLog = console.log;
              if (!config.verbose && ideHasConfig) {
                console.log = () => {};
              }
              try {
                const setupResult = await this.ideManager.setup(ide, projectDir, hseosDir, {
                  selectedModules: allModules || [],
                  preCollectedConfig: ideConfigurations[ide] || null,
                  verbose: config.verbose,
                  silent: ideHasConfig,
                });

                if (ideConfigurations[ide] && !ideConfigurations[ide]._alreadyConfigured) {
                  await this.ideConfigManager.saveIdeConfig(hseosDir, ide, ideConfigurations[ide]);
                }

                if (setupResult.success) {
                  addResult(ide, 'ok', setupResult.detail || '');
                } else {
                  addResult(ide, 'error', setupResult.error || 'failed');
                }
              } finally {
                console.log = originalLog;
              }

              if (needsPrompting && !ideSpinner.isSpinning) {
                ideSpinner.start('Configuring tools...');
              }
            }
          } finally {
            if (ideSpinner.isSpinning) {
              ideSpinner.stop('Tool configuration complete');
            }
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // SECOND TASKS BLOCK: Post-IDE operations (non-interactive)
      // ─────────────────────────────────────────────────────────────────────────
      const postIdeTasks = [];

      // File restoration task (only for updates)
      if (
        config._isUpdate &&
        ((config._customFiles && config._customFiles.length > 0) || (config._modifiedFiles && config._modifiedFiles.length > 0))
      ) {
        postIdeTasks.push({
          title: 'Finalizing installation',
          task: async (message) => {
            let customFiles = [];
            let modifiedFiles = [];

            if (config._customFiles && config._customFiles.length > 0) {
              message(`Restoring ${config._customFiles.length} custom files...`);

              for (const originalPath of config._customFiles) {
                const relativePath = path.relative(hseosDir, originalPath);
                const backupPath = path.join(config._tempBackupDir, relativePath);

                if (await fs.pathExists(backupPath)) {
                  await fs.ensureDir(path.dirname(originalPath));
                  await fs.copy(backupPath, originalPath, { overwrite: true });
                }
              }

              if (config._tempBackupDir && (await fs.pathExists(config._tempBackupDir))) {
                await fs.remove(config._tempBackupDir);
              }

              customFiles = config._customFiles;
            }

            if (config._modifiedFiles && config._modifiedFiles.length > 0) {
              modifiedFiles = config._modifiedFiles;

              if (config._tempModifiedBackupDir && (await fs.pathExists(config._tempModifiedBackupDir))) {
                message(`Restoring ${modifiedFiles.length} modified files as .bak...`);

                for (const modifiedFile of modifiedFiles) {
                  const relativePath = path.relative(hseosDir, modifiedFile.path);
                  const tempBackupPath = path.join(config._tempModifiedBackupDir, relativePath);
                  const bakPath = modifiedFile.path + '.bak';

                  if (await fs.pathExists(tempBackupPath)) {
                    await fs.ensureDir(path.dirname(bakPath));
                    await fs.copy(tempBackupPath, bakPath, { overwrite: true });
                  }
                }

                await fs.remove(config._tempModifiedBackupDir);
              }
            }

            // Store for summary access
            config._restoredCustomFiles = customFiles;
            config._restoredModifiedFiles = modifiedFiles;

            return 'Installation finalized';
          },
        });
      }

      // Write state management config to hseos.config.yaml
      if (config.stateManagement && config.stateManagement.mode) {
        postIdeTasks.push({
          title: 'Writing state management configuration',
          task: async () => {
            await this.writeStateManagementConfig(projectDir, config.stateManagement);
            return `State management: ${config.stateManagement.mode}`;
          },
        });
      }

      // Write second-brain config to hseos.config.yaml
      if (config.secondBrain) {
        postIdeTasks.push({
          title: 'Writing second-brain configuration',
          task: async () => {
            await this.writeSecondBrainConfig(projectDir, config.secondBrain);
            return `Second-brain: ${config.secondBrain.enabled ? config.secondBrain.path : 'disabled'}`;
          },
        });

        // Inject Second Brain Integration block into CLAUDE.md (idempotent)
        if (config.secondBrain.enabled && config.secondBrain.path) {
          postIdeTasks.push({
            title: 'Injecting Second Brain Integration into CLAUDE.md',
            task: async () => {
              let projectName;
              const pkgPath = path.join(projectDir, 'package.json');
              if (await fs.pathExists(pkgPath)) {
                try {
                  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
                  projectName = pkg.name || path.basename(projectDir);
                } catch {
                  projectName = path.basename(projectDir);
                }
              } else {
                projectName = path.basename(projectDir);
              }
              await this.injectSecondBrainSection(projectDir, projectName, config.secondBrain.path);
              return `CLAUDE.md: Second Brain Integration block injected for ${projectName}`;
            },
          });
        }
      }

      // Install RTK token optimizer (global, not project-scoped)
      if (config.rtk && config.rtk.enabled) {
        postIdeTasks.push(
          {
            title: 'Installing RTK token optimizer',
            task: async () => {
              const result = await this.installRtk();
              return result;
            },
          },
          {
            title: 'Writing RTK configuration',
            task: async () => {
              await this.writeRtkConfig(projectDir, config.rtk);
              return 'RTK: enabled in hseos.config.yaml';
            },
          },
        );
      }

      // Install Usage Dashboard (optional)
      if (config.usageDashboard && config.usageDashboard.enabled) {
        postIdeTasks.push(
          {
            title: 'Installing usage analytics dashboard',
            task: async () => {
              const result = await this.installUsageDashboard(projectDir, config.usageDashboard);
              return result;
            },
          },
          {
            title: 'Writing usage dashboard configuration',
            task: async () => {
              await this.writeUsageDashboardConfig(projectDir, config.usageDashboard);
              return `Usage Dashboard: enabled (${config.usageDashboard.mode}) in hseos.config.yaml`;
            },
          },
        );
      }

      await prompts.tasks(postIdeTasks);

      // Retrieve restored file info for summary
      const customFiles = config._restoredCustomFiles || [];
      const modifiedFiles = config._restoredModifiedFiles || [];

      // Render consolidated summary
      await this.renderInstallSummary(results, {
        hseosDir,
        modules: config.modules,
        ides: config.ides,
        customFiles: customFiles.length > 0 ? customFiles : undefined,
        modifiedFiles: modifiedFiles.length > 0 ? modifiedFiles : undefined,
      });

      return {
        success: true,
        path: hseosDir,
        modules: config.modules,
        ides: config.ides,
        projectDir: projectDir,
      };
    } catch (error) {
      try {
        if (spinner.isSpinning) {
          spinner.error('Installation failed');
        } else {
          await prompts.log.error('Installation failed');
        }
      } catch {
        // Ensure the original error is never swallowed by a logging failure
      }
      throw error;
    }
  }

  /**
   * Render a consolidated install summary using prompts.note()
   * @param {Array} results - Array of {step, status: 'ok'|'error'|'warn', detail}
   * @param {Object} context - {hseosDir, modules, ides, customFiles, modifiedFiles}
   */
  async renderInstallSummary(results, context = {}) {
    const color = await prompts.getColor();

    // Build step lines with status indicators
    const lines = [];
    for (const r of results) {
      let icon;
      if (r.status === 'ok') {
        icon = color.green('\u2713');
      } else if (r.status === 'warn') {
        icon = color.yellow('!');
      } else {
        icon = color.red('\u2717');
      }
      const detail = r.detail ? color.dim(` (${r.detail})`) : '';
      lines.push(`  ${icon}  ${r.step}${detail}`);
    }

    // Context and warnings
    lines.push('');
    if (context.hseosDir) {
      lines.push(`  Installed to: ${color.dim(context.hseosDir)}`);
    }
    if (context.customFiles && context.customFiles.length > 0) {
      lines.push(`  ${color.cyan(`Custom files preserved: ${context.customFiles.length}`)}`);
    }
    if (context.modifiedFiles && context.modifiedFiles.length > 0) {
      lines.push(`  ${color.yellow(`Modified files backed up (.bak): ${context.modifiedFiles.length}`)}`);
    }

    // Next steps
    lines.push(
      '',
      '  Next steps:',
      `    Read our new Docs Site: ${color.dim('https://docs.hseos.org/')}`,
      `    Institution: ${color.dim('Hideaki Solutions — hideaki.dev')}`,
      `    Star us on GitHub: ${color.dim('https://github.com/marciohideaki/hseos')}`,
      `    Subscribe on YouTube: ${color.dim('https://www.youtube.com/@HSEOSCode')}`,
      `    Run ${color.cyan('/hseos-help')} with your IDE Agent and ask it how to get started`,
    );

    await prompts.note(lines.join('\n'), 'HSEOS is ready to use!');
  }

  /**
   * Update existing installation
   */
  async update(config) {
    const spinner = await prompts.spinner();
    spinner.start('Checking installation...');

    try {
      const projectDir = path.resolve(config.directory);
      const { hseosDir } = await this.findHseosDir(projectDir);
      const existingInstall = await this.detector.detect(hseosDir);

      if (!existingInstall.installed) {
        spinner.stop('No HSEOS installation found');
        throw new Error(`No HSEOS installation found at ${hseosDir}`);
      }

      spinner.message('Analyzing update requirements...');

      // Compare versions and determine what needs updating
      const currentVersion = existingInstall.version;
      const newVersion = require(path.join(getProjectRoot(), 'package.json')).version;

      // Check for custom modules with missing sources before update
      const customModuleSources = new Map();

      // Check manifest for backward compatibility
      if (existingInstall.customModules) {
        for (const customModule of existingInstall.customModules) {
          customModuleSources.set(customModule.id, customModule);
        }
      }

      // Also check cache directory
      const cacheDir = path.join(hseosDir, '_config', 'custom');
      if (await fs.pathExists(cacheDir)) {
        const cachedModules = await fs.readdir(cacheDir, { withFileTypes: true });

        for (const cachedModule of cachedModules) {
          if (cachedModule.isDirectory()) {
            const moduleId = cachedModule.name;

            // Skip if we already have this module
            if (customModuleSources.has(moduleId)) {
              continue;
            }

            // Check if this is an external official module - skip cache for those
            const isExternal = await this.moduleManager.isExternalModule(moduleId);
            if (isExternal) {
              // External modules are handled via cloneExternalModule, not from cache
              continue;
            }

            const cachedPath = path.join(cacheDir, moduleId);

            // Check if this is actually a custom module (has module.yaml)
            const moduleYamlPath = path.join(cachedPath, 'module.yaml');
            if (await fs.pathExists(moduleYamlPath)) {
              customModuleSources.set(moduleId, {
                id: moduleId,
                name: moduleId,
                sourcePath: path.join('_config', 'custom', moduleId), // Relative path
                cached: true,
              });
            }
          }
        }
      }

      if (customModuleSources.size > 0) {
        spinner.stop('Update analysis complete');
        await prompts.log.warn('Checking custom module sources before update...');

        const projectRoot = getProjectRoot();
        await this.handleMissingCustomSources(
          customModuleSources,
          hseosDir,
          projectRoot,
          'update',
          existingInstall.modules.map((m) => m.id),
          config.skipPrompts || false,
        );

        spinner.start('Preparing update...');
      }

      if (config.dryRun) {
        spinner.stop('Dry run analysis complete');
        let dryRunContent = `Current version: ${currentVersion}\n`;
        dryRunContent += `New version: ${newVersion}\n`;
        dryRunContent += `Core: ${existingInstall.hasCore ? 'Will be updated' : 'Not installed'}`;

        if (existingInstall.modules.length > 0) {
          dryRunContent += '\n\nModules to update:';
          for (const mod of existingInstall.modules) {
            dryRunContent += `\n  - ${mod.id}`;
          }
        }
        await prompts.note(dryRunContent, 'Update Preview (Dry Run)');
        return;
      }

      // Perform actual update
      if (existingInstall.hasCore) {
        spinner.message('Updating core...');
        await this.updateCore(hseosDir, config.force);
      }

      for (const module of existingInstall.modules) {
        spinner.message(`Updating module: ${module.id}...`);
        await this.moduleManager.update(module.id, hseosDir, config.force, { installer: this });
      }

      // Update manifest
      spinner.message('Updating manifest...');
      await this.manifest.update(hseosDir, {
        version: newVersion,
        updateDate: new Date().toISOString(),
      });

      spinner.stop('Update complete');
      return { success: true };
    } catch (error) {
      spinner.error('Update failed');
      throw error;
    }
  }

  /**
   * Get installation status
   */
  async getStatus(directory) {
    const projectDir = path.resolve(directory);
    const { hseosDir } = await this.findHseosDir(projectDir);
    return await this.detector.detect(hseosDir);
  }

  /**
   * Get available modules
   */
  async getAvailableModules() {
    return await this.moduleManager.listAvailable();
  }

  /**
   * Uninstall HSEOS with selective removal options
   * @param {string} directory - Project directory
   * @param {Object} options - Uninstall options
   * @param {boolean} [options.removeModules=true] - Remove .hseos/ directory
   * @param {boolean} [options.removeIdeConfigs=true] - Remove IDE configurations
   * @param {boolean} [options.removeOutputFolder=false] - Remove user artifacts output folder
   * @returns {Object} Result with success status and removed components
   */
  async uninstall(directory, options = {}) {
    const projectDir = path.resolve(directory);
    const { hseosDir } = await this.findHseosDir(projectDir);

    if (!(await fs.pathExists(hseosDir))) {
      return { success: false, reason: 'not-installed' };
    }

    // 1. DETECT: Read state BEFORE deleting anything
    const existingInstall = await this.detector.detect(hseosDir);
    const outputFolder = await this._readOutputFolder(hseosDir);

    const removed = { modules: false, ideConfigs: false, outputFolder: false };

    // 2. IDE CLEANUP (before .hseos/ deletion so configs are accessible)
    if (options.removeIdeConfigs !== false) {
      await this.uninstallIdeConfigs(projectDir, existingInstall, { silent: options.silent });
      removed.ideConfigs = true;
    }

    // 3. OUTPUT FOLDER (only if explicitly requested)
    if (options.removeOutputFolder === true && outputFolder) {
      removed.outputFolder = await this.uninstallOutputFolder(projectDir, outputFolder);
    }

    // 4. HSEOS DIRECTORY (last, after everything that needs it)
    if (options.removeModules !== false) {
      removed.modules = await this.uninstallModules(projectDir);
    }

    return { success: true, removed, version: existingInstall.version };
  }

  /**
   * Uninstall IDE configurations only
   * @param {string} projectDir - Project directory
   * @param {Object} existingInstall - Detection result from detector.detect()
   * @param {Object} [options] - Options (e.g. { silent: true })
   * @returns {Promise<Object>} Results from IDE cleanup
   */
  async uninstallIdeConfigs(projectDir, existingInstall, options = {}) {
    await this.ideManager.ensureInitialized();
    const cleanupOptions = { isUninstall: true, silent: options.silent };
    const ideList = existingInstall.ides || [];
    if (ideList.length > 0) {
      return this.ideManager.cleanupByList(projectDir, ideList, cleanupOptions);
    }
    return this.ideManager.cleanup(projectDir, cleanupOptions);
  }

  /**
   * Remove user artifacts output folder
   * @param {string} projectDir - Project directory
   * @param {string} outputFolder - Output folder name (relative)
   * @returns {Promise<boolean>} Whether the folder was removed
   */
  async uninstallOutputFolder(projectDir, outputFolder) {
    if (!outputFolder) return false;
    const resolvedProject = path.resolve(projectDir);
    const outputPath = path.resolve(resolvedProject, outputFolder);
    if (!outputPath.startsWith(resolvedProject + path.sep)) {
      return false;
    }
    if (await fs.pathExists(outputPath)) {
      await fs.remove(outputPath);
      return true;
    }
    return false;
  }

  /**
   * Remove the .hseos/ directory
   * @param {string} projectDir - Project directory
   * @returns {Promise<boolean>} Whether the directory was removed
   */
  async uninstallModules(projectDir) {
    const { hseosDir } = await this.findHseosDir(projectDir);
    if (await fs.pathExists(hseosDir)) {
      await fs.remove(hseosDir);
      return true;
    }
    return false;
  }

  /**
   * Get the configured output folder name for a project
   * Resolves hseosDir internally from projectDir
   * @param {string} projectDir - Project directory
   * @returns {string} Output folder name (relative, default: '.hseos-output')
   */
  async getOutputFolder(projectDir) {
    const { hseosDir } = await this.findHseosDir(projectDir);
    return this._readOutputFolder(hseosDir);
  }

  /**
   * Read the output_folder setting from module config files
   * Checks bmm/config.yaml first, then other module configs
   * @param {string} hseosDir - HSEOS installation directory
   * @returns {string} Output folder path or default
   */
  async _readOutputFolder(hseosDir) {
    const yaml = require('yaml');

    // Check bmm/config.yaml first (most common)
    const bmmConfigPath = path.join(hseosDir, 'hsm', 'config.yaml');
    if (await fs.pathExists(bmmConfigPath)) {
      try {
        const content = await fs.readFile(bmmConfigPath, 'utf8');
        const config = yaml.parse(content);
        if (config && config.output_folder) {
          // Strip {project-root}/ prefix if present
          return config.output_folder.replace(/^\{project-root\}[/\\]/, '');
        }
      } catch {
        // Fall through to other modules
      }
    }

    // Scan other module config.yaml files
    try {
      const entries = await fs.readdir(hseosDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'hsm' || entry.name.startsWith('_')) continue;
        const configPath = path.join(hseosDir, entry.name, 'config.yaml');
        if (await fs.pathExists(configPath)) {
          try {
            const content = await fs.readFile(configPath, 'utf8');
            const config = yaml.parse(content);
            if (config && config.output_folder) {
              return config.output_folder.replace(/^\{project-root\}[/\\]/, '');
            }
          } catch {
            // Continue scanning
          }
        }
      }
    } catch {
      // Directory scan failed
    }

    // Default fallback
    return '.hseos-output';
  }

  /**
   * Private: Create directory structure
   */
  /**
   * Merge all module-help.csv files into a single hseos-help.csv
   * Scans all installed modules for module-help.csv and merges them
   * Enriches agent info from agent-manifest.csv
   * Output is written to .hseos/_config/hseos-help.csv
   * @param {string} hseosDir - HSEOS installation directory
   */
  async mergeModuleHelpCatalogs(hseosDir) {
    const allRows = [];
    const headerRow =
      'module,phase,name,code,sequence,workflow-file,command,required,agent-name,agent-command,agent-display-name,agent-title,options,description,output-location,outputs';

    // Load agent manifest for agent info lookup
    const agentManifestPath = path.join(hseosDir, '_config', 'agent-manifest.csv');
    const agentInfo = new Map(); // agent-name -> {command, displayName, title+icon}

    if (await fs.pathExists(agentManifestPath)) {
      const manifestContent = await fs.readFile(agentManifestPath, 'utf8');
      const lines = manifestContent.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        if (line.startsWith('name,')) continue; // Skip header

        const cols = line.split(',');
        if (cols.length >= 4) {
          const agentName = cols[0].replaceAll('"', '').trim();
          const displayName = cols[1].replaceAll('"', '').trim();
          const title = cols[2].replaceAll('"', '').trim();
          const icon = cols[3].replaceAll('"', '').trim();
          const module = cols[10] ? cols[10].replaceAll('"', '').trim() : '';

          // Build agent command: hseos:module:agent:name
          const agentCommand = module ? `hseos:${module}:agent:${agentName}` : `hseos:agent:${agentName}`;

          agentInfo.set(agentName, {
            command: agentCommand,
            displayName: displayName || agentName,
            title: icon && title ? `${icon} ${title}` : title || agentName,
          });
        }
      }
    }

    // Get all installed module directories
    const entries = await fs.readdir(hseosDir, { withFileTypes: true });
    const installedModules = entries
      .filter((entry) => entry.isDirectory() && entry.name !== '_config' && entry.name !== 'docs' && entry.name !== '_memory')
      .map((entry) => entry.name);

    // Add core module to scan (it's installed at root level as _config, but we check src/core)
    const coreModulePath = getSourcePath('core');
    const modulePaths = new Map();

    // Map all module source paths
    if (await fs.pathExists(coreModulePath)) {
      modulePaths.set('core', coreModulePath);
    }

    // Map installed module paths
    for (const moduleName of installedModules) {
      const modulePath = path.join(hseosDir, moduleName);
      modulePaths.set(moduleName, modulePath);
    }

    // Scan each module for module-help.csv
    for (const [moduleName, modulePath] of modulePaths) {
      const helpFilePath = path.join(modulePath, 'module-help.csv');

      if (await fs.pathExists(helpFilePath)) {
        try {
          const content = await fs.readFile(helpFilePath, 'utf8');
          const lines = content.split('\n').filter((line) => line.trim() && !line.startsWith('#'));

          for (const line of lines) {
            // Skip header row
            if (line.startsWith('module,')) {
              continue;
            }

            // Parse the line - handle quoted fields with commas
            const columns = this.parseCSVLine(line);
            if (columns.length >= 12) {
              // Map old schema to new schema
              // Old: module,phase,name,code,sequence,workflow-file,command,required,agent,options,description,output-location,outputs
              // New: module,phase,name,code,sequence,workflow-file,command,required,agent-name,agent-command,agent-display-name,agent-title,options,description,output-location,outputs

              const [
                module,
                phase,
                name,
                code,
                sequence,
                workflowFile,
                command,
                required,
                agentName,
                options,
                description,
                outputLocation,
                outputs,
              ] = columns;

              // If module column is empty, set it to this module's name (except for core which stays empty for universal tools)
              const finalModule = (!module || module.trim() === '') && moduleName !== 'core' ? moduleName : module || '';

              // Lookup agent info
              const cleanAgentName = agentName ? agentName.trim() : '';
              const agentData = agentInfo.get(cleanAgentName) || { command: '', displayName: '', title: '' };

              // Build new row with agent info
              const newRow = [
                finalModule,
                phase || '',
                name || '',
                code || '',
                sequence || '',
                workflowFile || '',
                command || '',
                required || 'false',
                cleanAgentName,
                agentData.command,
                agentData.displayName,
                agentData.title,
                options || '',
                description || '',
                outputLocation || '',
                outputs || '',
              ];

              allRows.push(newRow.map((c) => this.escapeCSVField(c)).join(','));
            }
          }

          if (process.env.HSEOS_VERBOSE_INSTALL === 'true') {
            await prompts.log.message(`  Merged module-help from: ${moduleName}`);
          }
        } catch (error) {
          await prompts.log.warn(`  Warning: Failed to read module-help.csv from ${moduleName}: ${error.message}`);
        }
      }
    }

    // Sort by module, then phase, then sequence
    allRows.sort((a, b) => {
      const colsA = this.parseCSVLine(a);
      const colsB = this.parseCSVLine(b);

      // Module comparison (empty module/universal tools come first)
      const moduleA = (colsA[0] || '').toLowerCase();
      const moduleB = (colsB[0] || '').toLowerCase();
      if (moduleA !== moduleB) {
        return moduleA.localeCompare(moduleB);
      }

      // Phase comparison
      const phaseA = colsA[1] || '';
      const phaseB = colsB[1] || '';
      if (phaseA !== phaseB) {
        return phaseA.localeCompare(phaseB);
      }

      // Sequence comparison
      const seqA = parseInt(colsA[4] || '0', 10);
      const seqB = parseInt(colsB[4] || '0', 10);
      return seqA - seqB;
    });

    // Write merged catalog
    const outputDir = path.join(hseosDir, '_config');
    await fs.ensureDir(outputDir);
    const outputPath = path.join(outputDir, 'hseos-help.csv');

    const mergedContent = [headerRow, ...allRows].join('\n');
    await fs.writeFile(outputPath, mergedContent, 'utf8');

    // Track the installed file
    this.installedFiles.add(outputPath);

    if (process.env.HSEOS_VERBOSE_INSTALL === 'true') {
      await prompts.log.message(`  Generated hseos-help.csv: ${allRows.length} workflows`);
    }
  }

  /**
   * Parse a CSV line, handling quoted fields
   * @param {string} line - CSV line to parse
   * @returns {Array} Array of field values
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Escape a CSV field if it contains special characters
   * @param {string} field - Field value to escape
   * @returns {string} Escaped field
   */
  escapeCSVField(field) {
    if (field === null || field === undefined) {
      return '';
    }
    const str = String(field);
    // If field contains comma, quote, or newline, wrap in quotes and escape inner quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replaceAll('"', '""')}"`;
    }
    return str;
  }

  async createDirectoryStructure(hseosDir) {
    await fs.ensureDir(hseosDir);
    await fs.ensureDir(path.join(hseosDir, '_config'));
    await fs.ensureDir(path.join(hseosDir, '_config', 'agents'));
    await fs.ensureDir(path.join(hseosDir, '_config', 'custom'));
  }

  /**
   * Generate clean config.yaml files for each installed module
   * @param {string} hseosDir - HSEOS installation directory
   * @param {Object} moduleConfigs - Collected configuration values
   */
  async generateModuleConfigs(hseosDir, moduleConfigs) {
    const yaml = require('yaml');

    // Extract core config values to share with other modules
    const coreConfig = moduleConfigs.core || {};

    // Get all installed module directories
    const entries = await fs.readdir(hseosDir, { withFileTypes: true });
    const installedModules = entries
      .filter((entry) => entry.isDirectory() && entry.name !== '_config' && entry.name !== 'docs')
      .map((entry) => entry.name);

    // Generate config.yaml for each installed module
    for (const moduleName of installedModules) {
      const modulePath = path.join(hseosDir, moduleName);

      // Get module-specific config or use empty object if none
      const config = moduleConfigs[moduleName] || {};

      if (await fs.pathExists(modulePath)) {
        const configPath = path.join(modulePath, 'config.yaml');

        // Create header
        const packageJson = require(path.join(getProjectRoot(), 'package.json'));
        const header = `# ${moduleName.toUpperCase()} Module Configuration
# Generated by HSEOS installer
# Version: ${packageJson.version}
# Date: ${new Date().toISOString()}

`;

        // For non-core modules, add core config values directly
        let finalConfig = { ...config };
        let coreSection = '';

        if (moduleName !== 'core' && coreConfig && Object.keys(coreConfig).length > 0) {
          // Add core values directly to the module config
          // These will be available for reference in the module
          finalConfig = {
            ...config,
            ...coreConfig, // Spread core config values directly into the module config
          };

          // Create a comment section to identify core values
          coreSection = '\n# Core Configuration Values\n';
        }

        // Clean the config to remove any non-serializable values (like functions)
        const cleanConfig = structuredClone(finalConfig);

        // Convert config to YAML
        let yamlContent = yaml.stringify(cleanConfig, {
          indent: 2,
          lineWidth: 0,
          minContentWidth: 0,
        });

        // If we have core values, reorganize the YAML to group them with their comment
        if (coreSection && moduleName !== 'core') {
          // Split the YAML into lines
          const lines = yamlContent.split('\n');
          const moduleConfigLines = [];
          const coreConfigLines = [];

          // Separate module-specific and core config lines
          for (const line of lines) {
            const key = line.split(':')[0].trim();
            if (Object.prototype.hasOwnProperty.call(coreConfig, key)) {
              coreConfigLines.push(line);
            } else {
              moduleConfigLines.push(line);
            }
          }

          // Rebuild YAML with module config first, then core config with comment
          yamlContent = moduleConfigLines.join('\n');
          if (coreConfigLines.length > 0) {
            yamlContent += coreSection + coreConfigLines.join('\n');
          }
        }

        // Write the clean config file with POSIX-compliant final newline
        const content = header + yamlContent;
        await fs.writeFile(configPath, content.endsWith('\n') ? content : content + '\n', 'utf8');

        // Track the config file in installedFiles
        this.installedFiles.add(configPath);
      }
    }
  }

  /**
   * Write state_management section to the project's hseos.config.yaml
   * @param {string} projectDir - Project directory
   * @param {Object} stateManagement - State management config object
   */
  async writeStateManagementConfig(projectDir, stateManagement) {
    const yaml = require('yaml');
    const configPath = path.join(projectDir, '.hseos', 'config', 'hseos.config.yaml');

    if (!(await fs.pathExists(configPath))) return;

    const raw = await fs.readFile(configPath, 'utf8');
    const doc = yaml.parseDocument(raw);

    // Build the state_management node
    const smMap = doc.createNode(stateManagement);
    doc.set('state_management', smMap);

    await fs.writeFile(configPath, doc.toString(), 'utf8');
  }

  /**
   * Write second_brain section to the project's hseos.config.yaml
   * @param {string} projectDir - Project directory
   * @param {Object} secondBrain - Second-brain config object { enabled, path }
   */
  async writeSecondBrainConfig(projectDir, secondBrain) {
    const yaml = require('yaml');
    const configPath = path.join(projectDir, '.hseos', 'config', 'hseos.config.yaml');

    if (!(await fs.pathExists(configPath))) return;

    const raw = await fs.readFile(configPath, 'utf8');
    const doc = yaml.parseDocument(raw);

    const sbMap = doc.createNode(secondBrain);
    doc.set('second_brain', sbMap);

    await fs.writeFile(configPath, doc.toString(), 'utf8');
  }

  /**
   * Build the Second Brain Integration block for a project's CLAUDE.md
   * @param {string} projectName - Project name (used in vault paths)
   * @param {string} secondBrainPath - Absolute path to the vault
   * @returns {string} Markdown block to inject
   */
  buildSecondBrainSection(projectName, secondBrainPath) {
    return `## Second Brain Integration

Vault: \`${secondBrainPath}\`
Projeto registrado em: \`_knowledge/projects/${projectName}/\`

### Ao encerrar uma sessão produtiva

Escreva diretamente nos arquivos do vault **antes de sugerir ao usuário que encerre**:

1. **Decisões arquiteturais** → append em \`_knowledge/projects/${projectName}/decisions.md\`
2. **Gotchas descobertos** (bugs, comportamentos não-óbvios) → append em \`_knowledge/projects/${projectName}/gotchas.md\`
3. **Progresso de fase** → atualizar \`_knowledge/projects/${projectName}/roadmap.md\` se a fase avançou
4. **Activity log** → append em \`_memory/activity-log.md\`: \`## [YYYY-MM-DD HH:MM] session-end | ${projectName} — {tipo}: {descrição}\`

Depois sugerir ao usuário: *"Quer que eu também atualize o \`/end-session\` do second-brain para capturar o contexto completo da conversa?"*

### Tipos de trabalho a registrar

\`epic\` \`feature\` \`story\` \`task\` \`fix\` \`chore\` \`spike\` \`session\`

Registrar qualquer implementação que produziu código, decisão ou aprendizado — não apenas epics formais.

### Se o projeto não estiver registrado no vault

Criar \`_knowledge/projects/${projectName}/\` com os 7 arquivos base (README, modules, integrations, gotchas, decisions, roadmap, work-log) e atualizar \`_index/MASTER-INDEX.md\`.

### Constraints HSEOS (respeitar)

- Escrever em \`_decisions/hseos/\` e \`_learnings/hseos-*\` apenas decisões com valor cross-project
- Nunca sobrescrever arquivos do vault sem verificar se existem
- \`_memory/current-state.md\`: o \`/end-session\` do vault é o canal correto para atualizar
`;
  }

  /**
   * Inject Second Brain Integration section into project's CLAUDE.md (idempotent)
   * @param {string} projectDir - Project directory
   * @param {string} projectName - Project name for vault path substitution
   * @param {string} secondBrainPath - Absolute path to the vault
   */
  async injectSecondBrainSection(projectDir, projectName, secondBrainPath) {
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md');

    if (!(await fs.pathExists(claudeMdPath))) return; // no CLAUDE.md — skip silently

    const content = await fs.readFile(claudeMdPath, 'utf8');
    if (content.includes('## Second Brain Integration')) return; // already injected — idempotent

    const section = this.buildSecondBrainSection(projectName, secondBrainPath);
    await fs.appendFile(claudeMdPath, '\n---\n\n' + section, 'utf8');
  }

  // ---------------------------------------------------------------------------
  // RTK — Token Optimizer
  // ---------------------------------------------------------------------------

  /**
   * Install RTK globally: download binary if missing, install Claude Code hook,
   * patch ~/.claude/settings.json with the PreToolUse entry.
   * @returns {string} Summary line for the task log
   */
  async installRtk() {
    const os = require('node:os');
    const { execSync, spawnSync } = require('node:child_process');

    // 1. Check if binary is already available
    let binaryInstalled = false;
    try {
      execSync('which rtk', { stdio: 'ignore' });
      binaryInstalled = true;
    } catch {
      // not in PATH — will install below
    }

    if (!binaryInstalled) {
      await this.downloadRtkBinary();
    }

    // 2. Install Claude Code hook (idempotent)
    await this.installRtkHook();

    // 3. Register hook in ~/.claude/settings.json
    await this.patchClaudeGlobalSettings();

    return binaryInstalled ? 'RTK: hook installed (binary was already present)' : 'RTK: binary downloaded + hook installed';
  }

  /**
   * Download and install the RTK binary from GitHub releases to ~/.local/bin.
   */
  async downloadRtkBinary() {
    const os = require('node:os');
    const { execSync } = require('node:child_process');

    const platform = process.platform;
    const arch = process.arch;

    let target;
    if (platform === 'linux') {
      target = arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-musl';
    } else if (platform === 'darwin') {
      target = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    } else {
      throw new Error(`RTK: unsupported platform ${platform}`);
    }

    // Fetch latest version tag from GitHub API
    let version;
    try {
      const raw = execSync(
        'curl -fsSL "https://api.github.com/repos/rtk-ai/rtk/releases/latest"',
        { encoding: 'utf8', timeout: 15_000 }
      );
      const match = raw.match(/"tag_name"\s*:\s*"([^"]+)"/);
      version = match ? match[1] : null;
    } catch {
      throw new Error('RTK: failed to fetch latest version from GitHub API');
    }

    if (!version) {
      throw new Error('RTK: could not parse latest version tag');
    }

    const installDir = path.join(os.homedir(), '.local', 'bin');
    await fs.ensureDir(installDir);

    const url = `https://github.com/rtk-ai/rtk/releases/download/${version}/rtk-${target}.tar.gz`;

    try {
      execSync(
        `curl -fsSL "${url}" | tar -xzf - -C "${installDir}" rtk && chmod +x "${installDir}/rtk"`,
        { timeout: 60_000 }
      );
    } catch {
      throw new Error(`RTK: failed to download binary from ${url}`);
    }
  }

  /**
   * Install the RTK Claude Code hook script to ~/.claude/hooks/rtk-rewrite.sh (idempotent).
   */
  async installRtkHook() {
    const os = require('node:os');

    const hookScript = `#!/usr/bin/env bash
# rtk-hook-version: 3
# RTK Claude Code hook — rewrites commands to use rtk for token savings.
# Installed by HSEOS installer. Source: https://github.com/rtk-ai/rtk

if ! command -v jq &>/dev/null; then
  echo "[rtk] WARNING: jq is not installed. Hook disabled." >&2
  exit 0
fi

if ! command -v rtk &>/dev/null; then
  echo "[rtk] WARNING: rtk is not installed or not in PATH. Hook disabled." >&2
  exit 0
fi

RTK_VERSION=$(rtk --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -1)
if [ -n "$RTK_VERSION" ]; then
  MAJOR=$(echo "$RTK_VERSION" | cut -d. -f1)
  MINOR=$(echo "$RTK_VERSION" | cut -d. -f2)
  if [ "$MAJOR" -eq 0 ] && [ "$MINOR" -lt 23 ]; then
    echo "[rtk] WARNING: rtk $RTK_VERSION is too old (need >= 0.23.0)." >&2
    exit 0
  fi
fi

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$CMD" ]; then
  exit 0
fi

REWRITTEN=$(rtk rewrite "$CMD" 2>/dev/null)
EXIT_CODE=$?

case $EXIT_CODE in
  0) [ "$CMD" = "$REWRITTEN" ] && exit 0 ;;
  1) exit 0 ;;
  2) exit 0 ;;
  3) ;;
  *) exit 0 ;;
esac

ORIGINAL_INPUT=$(echo "$INPUT" | jq -c '.tool_input')
UPDATED_INPUT=$(echo "$ORIGINAL_INPUT" | jq --arg cmd "$REWRITTEN" '.command = $cmd')

if [ "$EXIT_CODE" -eq 3 ]; then
  jq -n --argjson updated "$UPDATED_INPUT" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "updatedInput": $updated
    }
  }'
else
  jq -n --argjson updated "$UPDATED_INPUT" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "permissionDecisionReason": "RTK auto-rewrite",
      "updatedInput": $updated
    }
  }'
fi
`;

    const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
    const hookPath = path.join(hooksDir, 'rtk-rewrite.sh');

    await fs.ensureDir(hooksDir);
    await fs.writeFile(hookPath, hookScript, { encoding: 'utf8', mode: 0o755 });
  }

  /**
   * Register the RTK hook in ~/.claude/settings.json (idempotent).
   * Merges into existing settings without overwriting unrelated entries.
   */
  async patchClaudeGlobalSettings() {
    const os = require('node:os');

    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const hookPath = path.join(os.homedir(), '.claude', 'hooks', 'rtk-rewrite.sh');

    let settings = {};
    if (await fs.pathExists(settingsPath)) {
      try {
        settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      } catch {
        // corrupt or empty — start fresh
      }
    }

    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

    // Idempotent: only add if not already registered
    const alreadyRegistered = settings.hooks.PreToolUse.some(
      (entry) => entry.hooks && entry.hooks.some((h) => h.command && h.command.includes('rtk-rewrite'))
    );

    if (!alreadyRegistered) {
      settings.hooks.PreToolUse.push({
        matcher: 'Bash',
        hooks: [{ type: 'command', command: hookPath }],
      });
    }

    // Add rtk:* to global allowed tools so rewritten commands execute without prompting
    if (!settings.permissions) settings.permissions = {};
    if (!settings.permissions.allow) settings.permissions.allow = [];
    const rtkPermission = 'Bash(rtk:*)';
    if (!settings.permissions.allow.includes(rtkPermission)) {
      settings.permissions.allow.push(rtkPermission);
    }

    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  /**
   * Install the usage analytics dashboard files to the project directory.
   * Copies Python sources + Docker files from tools/usage-dashboard/.
   * @param {string} projectDir - Project directory
   * @param {Object} dashboardConfig - { enabled, mode }
   * @returns {string} Summary line for the task log
   */
  async installUsageDashboard(projectDir, dashboardConfig) {
    const os = require('node:os');

    // Resolve source: tools/usage-dashboard relative to this installer file
    const sourceDir = path.resolve(__dirname, '..', '..', '..', '..', 'usage-dashboard');
    const destDir = path.join(projectDir, '.hseos', 'usage-dashboard');

    await fs.ensureDir(destDir);

    // Always copy core Python files
    for (const file of ['cli.py', 'scanner.py', 'dashboard.py']) {
      const src = path.join(sourceDir, file);
      if (await fs.pathExists(src)) {
        await fs.copy(src, path.join(destDir, file), { overwrite: true });
      }
    }

    // Always copy Docker files (user can use either mode later)
    for (const file of ['Dockerfile', 'docker-compose.yml']) {
      const src = path.join(sourceDir, file);
      if (await fs.pathExists(src)) {
        await fs.copy(src, path.join(destDir, file), { overwrite: true });
      }
    }

    const mode = dashboardConfig.mode || 'local';
    return `Usage Dashboard: installed to .hseos/usage-dashboard/ (mode: ${mode})`;
  }

  /**
   * Write usageDashboard section to the project's hseos.config.yaml
   * @param {string} projectDir - Project directory
   * @param {Object} dashboardConfig - { enabled, mode }
   */
  async writeUsageDashboardConfig(projectDir, dashboardConfig) {
    const yaml = require('yaml');
    const configPath = path.join(projectDir, '.hseos', 'config', 'hseos.config.yaml');

    if (!(await fs.pathExists(configPath))) return;

    const raw = await fs.readFile(configPath, 'utf8');
    const doc = yaml.parseDocument(raw);

    const dashboardMap = doc.createNode(dashboardConfig);
    doc.set('usageDashboard', dashboardMap);

    await fs.writeFile(configPath, doc.toString(), 'utf8');
  }

  /**
   * Write rtk section to the project's hseos.config.yaml
   * @param {string} projectDir - Project directory
   * @param {Object} rtkConfig - RTK config object { enabled }
   */
  async writeRtkConfig(projectDir, rtkConfig) {
    const yaml = require('yaml');
    const configPath = path.join(projectDir, '.hseos', 'config', 'hseos.config.yaml');

    if (!(await fs.pathExists(configPath))) return;

    const raw = await fs.readFile(configPath, 'utf8');
    const doc = yaml.parseDocument(raw);

    const rtkMap = doc.createNode(rtkConfig);
    doc.set('rtk', rtkMap);

    await fs.writeFile(configPath, doc.toString(), 'utf8');
  }

  // ---------------------------------------------------------------------------

  /**
   * Install core with resolved dependencies
   * @param {string} hseosDir - HSEOS installation directory
   * @param {Object} coreFiles - Core files to install
   */
  async installCoreWithDependencies(hseosDir, coreFiles) {
    const sourcePath = getModulePath('core');
    const targetPath = path.join(hseosDir, 'core');
    await this.installCore(hseosDir);
  }

  /**
   * Install module with resolved dependencies
   * @param {string} moduleName - Module name
   * @param {string} hseosDir - HSEOS installation directory
   * @param {Object} moduleFiles - Module files to install
   */
  async installModuleWithDependencies(moduleName, hseosDir, moduleFiles) {
    // Get module configuration for conditional installation
    const moduleConfig = this.configCollector.collectedConfig[moduleName] || {};

    // Use existing module manager for full installation with file tracking
    // Note: Module-specific installers are called separately after IDE setup
    await this.moduleManager.install(
      moduleName,
      hseosDir,
      (filePath) => {
        this.installedFiles.add(filePath);
      },
      {
        skipModuleInstaller: true, // We'll run it later after IDE setup
        moduleConfig: moduleConfig, // Pass module config for conditional filtering
        installer: this,
        silent: true,
      },
    );

    // Process agent files to build YAML agents and create customize templates
    const modulePath = path.join(hseosDir, moduleName);
    await this.processAgentFiles(modulePath, moduleName);

    // Dependencies are already included in full module install
  }

  /**
   * Install partial module (only dependencies needed by other modules)
   */
  async installPartialModule(moduleName, hseosDir, files) {
    const sourceBase = getModulePath(moduleName);
    const targetBase = path.join(hseosDir, moduleName);

    // Create module directory
    await fs.ensureDir(targetBase);

    // Copy only the required dependency files
    if (files.agents && files.agents.length > 0) {
      const agentsDir = path.join(targetBase, 'agents');
      await fs.ensureDir(agentsDir);

      for (const agentPath of files.agents) {
        const fileName = path.basename(agentPath);
        const sourcePath = path.join(sourceBase, 'agents', fileName);
        const targetPath = path.join(agentsDir, fileName);

        if (await fs.pathExists(sourcePath)) {
          await this.copyFileWithPlaceholderReplacement(sourcePath, targetPath);
          this.installedFiles.add(targetPath);
        }
      }
    }

    if (files.tasks && files.tasks.length > 0) {
      const tasksDir = path.join(targetBase, 'tasks');
      await fs.ensureDir(tasksDir);

      for (const taskPath of files.tasks) {
        const fileName = path.basename(taskPath);
        const sourcePath = path.join(sourceBase, 'tasks', fileName);
        const targetPath = path.join(tasksDir, fileName);

        if (await fs.pathExists(sourcePath)) {
          await this.copyFileWithPlaceholderReplacement(sourcePath, targetPath);
          this.installedFiles.add(targetPath);
        }
      }
    }

    if (files.tools && files.tools.length > 0) {
      const toolsDir = path.join(targetBase, 'tools');
      await fs.ensureDir(toolsDir);

      for (const toolPath of files.tools) {
        const fileName = path.basename(toolPath);
        const sourcePath = path.join(sourceBase, 'tools', fileName);
        const targetPath = path.join(toolsDir, fileName);

        if (await fs.pathExists(sourcePath)) {
          await this.copyFileWithPlaceholderReplacement(sourcePath, targetPath);
          this.installedFiles.add(targetPath);
        }
      }
    }

    if (files.templates && files.templates.length > 0) {
      const templatesDir = path.join(targetBase, 'templates');
      await fs.ensureDir(templatesDir);

      for (const templatePath of files.templates) {
        const fileName = path.basename(templatePath);
        const sourcePath = path.join(sourceBase, 'templates', fileName);
        const targetPath = path.join(templatesDir, fileName);

        if (await fs.pathExists(sourcePath)) {
          await this.copyFileWithPlaceholderReplacement(sourcePath, targetPath);
          this.installedFiles.add(targetPath);
        }
      }
    }

    if (files.data && files.data.length > 0) {
      for (const dataPath of files.data) {
        // Preserve directory structure for data files
        const relative = path.relative(sourceBase, dataPath);
        const targetPath = path.join(targetBase, relative);

        await fs.ensureDir(path.dirname(targetPath));

        if (await fs.pathExists(dataPath)) {
          await this.copyFileWithPlaceholderReplacement(dataPath, targetPath);
          this.installedFiles.add(targetPath);
        }
      }
    }

    // Create a marker file to indicate this is a partial installation
    const markerPath = path.join(targetBase, '.partial');
    await fs.writeFile(
      markerPath,
      `This module contains only dependencies required by other modules.\nInstalled: ${new Date().toISOString()}\n`,
    );
  }

  /**
   * Private: Install core
   * @param {string} hseosDir - HSEOS installation directory
   */
  async installCore(hseosDir) {
    const sourcePath = getModulePath('core');
    const targetPath = path.join(hseosDir, 'core');

    // Copy core files (skip .agent.yaml files like modules do)
    await this.copyCoreFiles(sourcePath, targetPath);

    // Compile agents using the same compiler as modules
    const { ModuleManager } = require('../modules/manager');
    const moduleManager = new ModuleManager();
    await moduleManager.compileModuleAgents(sourcePath, targetPath, 'core', hseosDir, this);

    // Process agent files to inject activation block
    await this.processAgentFiles(targetPath, 'core');
  }

  /**
   * Copy core files (similar to copyModuleWithFiltering but for core)
   * @param {string} sourcePath - Source path
   * @param {string} targetPath - Target path
   */
  async copyCoreFiles(sourcePath, targetPath) {
    // Get all files in source
    const files = await this.getFileList(sourcePath);

    for (const file of files) {
      // Skip sub-modules directory - these are IDE-specific and handled separately
      if (file.startsWith('sub-modules/')) {
        continue;
      }

      // Skip sidecar directories - they are handled separately during agent compilation
      if (
        path
          .dirname(file)
          .split('/')
          .some((dir) => dir.toLowerCase().includes('sidecar'))
      ) {
        continue;
      }

      // Skip module.yaml at root - it's only needed at install time
      if (file === 'module.yaml') {
        continue;
      }

      // Skip config.yaml templates - we'll generate clean ones with actual values
      if (file === 'config.yaml' || file.endsWith('/config.yaml') || file === 'custom.yaml' || file.endsWith('/custom.yaml')) {
        continue;
      }

      // Skip .agent.yaml files - they will be compiled separately
      if (file.endsWith('.agent.yaml')) {
        continue;
      }

      const sourceFile = path.join(sourcePath, file);
      const targetFile = path.join(targetPath, file);

      // Check if this is an agent file
      if (file.startsWith('agents/') && file.endsWith('.md')) {
        // Read the file to check for localskip
        const content = await fs.readFile(sourceFile, 'utf8');

        // Check for localskip="true" in the agent tag
        const agentMatch = content.match(/<agent[^>]*\slocalskip="true"[^>]*>/);
        if (agentMatch) {
          await prompts.log.message(`  Skipping web-only agent: ${path.basename(file)}`);
          continue; // Skip this agent
        }
      }

      // Copy the file with placeholder replacement
      await fs.ensureDir(path.dirname(targetFile));
      await this.copyFileWithPlaceholderReplacement(sourceFile, targetFile);

      // Track the installed file
      this.installedFiles.add(targetFile);
    }
  }

  /**
   * Get list of all files in a directory recursively
   * @param {string} dir - Directory path
   * @param {string} baseDir - Base directory for relative paths
   * @returns {Array} List of relative file paths
   */
  async getFileList(dir, baseDir = dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await this.getFileList(fullPath, baseDir);
        files.push(...subFiles);
      } else {
        files.push(path.relative(baseDir, fullPath));
      }
    }

    return files;
  }

  /**
   * Process agent files to build YAML agents and inject activation blocks
   * @param {string} modulePath - Path to module in hseos/ installation
   * @param {string} moduleName - Module name
   */
  async processAgentFiles(modulePath, moduleName) {
    const agentsPath = path.join(modulePath, 'agents');

    // Check if agents directory exists
    if (!(await fs.pathExists(agentsPath))) {
      return; // No agents to process
    }

    // Determine project directory (parent of hseos/ directory)
    const hseosDir = path.dirname(modulePath);
    const cfgAgentsDir = path.join(hseosDir, '_config', 'agents');

    // Ensure _config/agents directory exists
    await fs.ensureDir(cfgAgentsDir);

    // Get all agent files
    const agentFiles = await fs.readdir(agentsPath);

    for (const agentFile of agentFiles) {
      // Skip .agent.yaml files - they should already be compiled by compileModuleAgents
      if (agentFile.endsWith('.agent.yaml')) {
        continue;
      }

      // Only process .md files (already compiled from YAML)
      if (!agentFile.endsWith('.md')) {
        continue;
      }

      const agentName = agentFile.replace('.md', '');
      const mdPath = path.join(agentsPath, agentFile);
      const customizePath = path.join(cfgAgentsDir, `${moduleName}-${agentName}.customize.yaml`);

      // For .md files that are already compiled, we don't need to do much
      // Just ensure the customize template exists
      if (!(await fs.pathExists(customizePath))) {
        const genericTemplatePath = getSourcePath('utility', 'agent-components', 'agent.customize.template.yaml');
        if (await fs.pathExists(genericTemplatePath)) {
          await this.copyFileWithPlaceholderReplacement(genericTemplatePath, customizePath);
          if (process.env.HSEOS_VERBOSE_INSTALL === 'true') {
            await prompts.log.message(`  Created customize: ${moduleName}-${agentName}.customize.yaml`);
          }
        }
      }
    }
  }

  /**
   * Private: Update core
   */
  async updateCore(hseosDir, force = false) {
    const sourcePath = getModulePath('core');
    const targetPath = path.join(hseosDir, 'core');

    if (force) {
      await fs.remove(targetPath);
      await this.installCore(hseosDir);
    } else {
      // Selective update - preserve user modifications
      await this.fileOps.syncDirectory(sourcePath, targetPath);

      // Recompile agents (#1133)
      const { ModuleManager } = require('../modules/manager');
      const moduleManager = new ModuleManager();
      await moduleManager.compileModuleAgents(sourcePath, targetPath, 'core', hseosDir, this);
      await this.processAgentFiles(targetPath, 'core');
    }
  }

  /**
   * Quick update method - preserves all settings and only prompts for new config fields
   * @param {Object} config - Configuration with directory
   * @returns {Object} Update result
   */
  async quickUpdate(config) {
    const spinner = await prompts.spinner();
    spinner.start('Starting quick update...');

    try {
      const projectDir = path.resolve(config.directory);
      const { hseosDir } = await this.findHseosDir(projectDir);

      // Check if hseos directory exists
      if (!(await fs.pathExists(hseosDir))) {
        spinner.stop('No HSEOS installation found');
        throw new Error(`HSEOS not installed at ${hseosDir}. Use regular install for first-time setup.`);
      }

      spinner.message('Detecting installed modules and configuration...');

      // Detect existing installation
      const existingInstall = await this.detector.detect(hseosDir);
      const installedModules = existingInstall.modules.map((m) => m.id);
      const configuredIdes = existingInstall.ides || [];
      const projectRoot = path.dirname(hseosDir);

      // Get custom module sources: first from --custom-content (re-cache from source), then from cache
      const customModuleSources = new Map();
      if (config.customContent?.sources?.length > 0) {
        for (const source of config.customContent.sources) {
          if (source.id && source.path && (await fs.pathExists(source.path))) {
            customModuleSources.set(source.id, {
              id: source.id,
              name: source.name || source.id,
              sourcePath: source.path,
              cached: false, // From CLI, will be re-cached
            });
          }
        }
      }
      const cacheDir = path.join(hseosDir, '_config', 'custom');
      if (await fs.pathExists(cacheDir)) {
        const cachedModules = await fs.readdir(cacheDir, { withFileTypes: true });

        for (const cachedModule of cachedModules) {
          const moduleId = cachedModule.name;
          const cachedPath = path.join(cacheDir, moduleId);

          // Skip if path doesn't exist (broken symlink, deleted dir) - avoids lstat ENOENT
          if (!(await fs.pathExists(cachedPath))) {
            continue;
          }
          if (!cachedModule.isDirectory()) {
            continue;
          }

          // Skip if we already have this module from manifest
          if (customModuleSources.has(moduleId)) {
            continue;
          }

          // Check if this is an external official module - skip cache for those
          const isExternal = await this.moduleManager.isExternalModule(moduleId);
          if (isExternal) {
            // External modules are handled via cloneExternalModule, not from cache
            continue;
          }

          // Check if this is actually a custom module (has module.yaml)
          const moduleYamlPath = path.join(cachedPath, 'module.yaml');
          if (await fs.pathExists(moduleYamlPath)) {
            // For quick update, we always rebuild from cache
            customModuleSources.set(moduleId, {
              id: moduleId,
              name: moduleId, // We'll read the actual name if needed
              sourcePath: cachedPath,
              cached: true, // Flag to indicate this is from cache
            });
          }
        }
      }

      // Load saved IDE configurations
      const savedIdeConfigs = await this.ideConfigManager.loadAllIdeConfigs(hseosDir);

      // Get available modules (what we have source for)
      const availableModulesData = await this.moduleManager.listAvailable();
      const availableModules = [...availableModulesData.modules, ...availableModulesData.customModules];

      // Add external official modules to available modules
      // These can always be obtained by cloning from their remote URLs
      const { ExternalModuleManager } = require('../modules/external-manager');
      const externalManager = new ExternalModuleManager();
      const externalModules = await externalManager.listAvailable();
      for (const externalModule of externalModules) {
        // Only add if not already in the list and is installed
        if (installedModules.includes(externalModule.code) && !availableModules.some((m) => m.id === externalModule.code)) {
          availableModules.push({
            id: externalModule.code,
            name: externalModule.name,
            isExternal: true,
            fromExternal: true,
          });
        }
      }

      // Add custom modules from manifest if their sources exist
      for (const [moduleId, customModule] of customModuleSources) {
        // Use the absolute sourcePath
        const sourcePath = customModule.sourcePath;

        // Check if source exists at the recorded path
        if (
          sourcePath &&
          (await fs.pathExists(sourcePath)) && // Add to available modules if not already there
          !availableModules.some((m) => m.id === moduleId)
        ) {
          availableModules.push({
            id: moduleId,
            name: customModule.name || moduleId,
            path: sourcePath,
            isCustom: true,
            fromManifest: true,
          });
        }
      }

      // Handle missing custom module sources using shared method
      const customModuleResult = await this.handleMissingCustomSources(
        customModuleSources,
        hseosDir,
        projectRoot,
        'update',
        installedModules,
        config.skipPrompts || false,
      );

      const { validCustomModules, keptModulesWithoutSources } = customModuleResult;

      const customModulesFromManifest = validCustomModules.map((m) => ({
        ...m,
        isCustom: true,
        hasUpdate: true,
      }));

      const allAvailableModules = [...availableModules, ...customModulesFromManifest];
      const availableModuleIds = new Set(allAvailableModules.map((m) => m.id));

      // Core module is special - never include it in update flow
      const nonCoreInstalledModules = installedModules.filter((id) => id !== 'core');

      // Only update modules that are BOTH installed AND available (we have source for)
      const modulesToUpdate = nonCoreInstalledModules.filter((id) => availableModuleIds.has(id));
      const skippedModules = nonCoreInstalledModules.filter((id) => !availableModuleIds.has(id));

      // Add custom modules that were kept without sources to the skipped modules
      // This ensures their agents are preserved in the manifest
      for (const keptModule of keptModulesWithoutSources) {
        if (!skippedModules.includes(keptModule)) {
          skippedModules.push(keptModule);
        }
      }

      spinner.stop(`Found ${modulesToUpdate.length} module(s) to update and ${configuredIdes.length} configured tool(s)`);

      if (skippedModules.length > 0) {
        await prompts.log.warn(`Skipping ${skippedModules.length} module(s) - no source available: ${skippedModules.join(', ')}`);
      }

      // Load existing configs and collect new fields (if any)
      await prompts.log.info('Checking for new configuration options...');
      await this.configCollector.loadExistingConfig(projectDir);

      let promptedForNewFields = false;

      // Check core config for new fields
      const corePrompted = await this.configCollector.collectModuleConfigQuick('core', projectDir, true);
      if (corePrompted) {
        promptedForNewFields = true;
      }

      // Check each module we're updating for new fields (NOT skipped modules)
      for (const moduleName of modulesToUpdate) {
        const modulePrompted = await this.configCollector.collectModuleConfigQuick(moduleName, projectDir, true);
        if (modulePrompted) {
          promptedForNewFields = true;
        }
      }

      if (!promptedForNewFields) {
        await prompts.log.success('All configuration is up to date, no new options to configure');
      }

      // Add metadata
      this.configCollector.collectedConfig._meta = {
        version: require(path.join(getProjectRoot(), 'package.json')).version,
        installDate: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      };

      // Build the config object for the installer
      const installConfig = {
        directory: projectDir,
        installCore: true,
        modules: modulesToUpdate, // Only update modules we have source for
        ides: configuredIdes,
        skipIde: configuredIdes.length === 0,
        coreConfig: this.configCollector.collectedConfig.core,
        actionType: 'install', // Use regular install flow
        _quickUpdate: true, // Flag to skip certain prompts
        _preserveModules: skippedModules, // Preserve these in manifest even though we didn't update them
        _savedIdeConfigs: savedIdeConfigs, // Pass saved IDE configs to installer
        _customModuleSources: customModuleSources, // Pass custom module sources for updates
        _existingModules: installedModules, // Pass all installed modules for manifest generation
        customContent: config.customContent, // Pass through for re-caching from source
      };

      // Call the standard install method
      const result = await this.install(installConfig);

      // Only succeed the spinner if it's still spinning
      // (install method might have stopped it if folder name changed)
      if (spinner.isSpinning) {
        spinner.stop('Quick update complete!');
      }

      return {
        success: true,
        moduleCount: modulesToUpdate.length + 1, // +1 for core
        hadNewFields: promptedForNewFields,
        modules: ['core', ...modulesToUpdate],
        skippedModules: skippedModules,
        ides: configuredIdes,
      };
    } catch (error) {
      spinner.error('Quick update failed');
      throw error;
    }
  }

  /**
   * Compile agents with customizations only
   * @param {Object} config - Configuration with directory
   * @returns {Object} Compilation result
   */
  async compileAgents(config) {
    // Using @clack prompts
    const { ModuleManager } = require('../modules/manager');
    const { getSourcePath } = require('../../../lib/project-root');

    const spinner = await prompts.spinner();
    spinner.start('Recompiling agents with customizations...');

    try {
      const projectDir = path.resolve(config.directory);
      const { hseosDir } = await this.findHseosDir(projectDir);

      // Check if hseos directory exists
      if (!(await fs.pathExists(hseosDir))) {
        spinner.stop('No HSEOS installation found');
        throw new Error(`HSEOS not installed at ${hseosDir}. Use regular install for first-time setup.`);
      }

      // Detect existing installation
      const existingInstall = await this.detector.detect(hseosDir);
      const installedModules = existingInstall.modules.map((m) => m.id);

      // Initialize module manager
      const moduleManager = new ModuleManager();
      moduleManager.setHseosFolderName(path.basename(hseosDir));

      let totalAgentCount = 0;

      // Get custom module sources from cache
      const customModuleSources = new Map();
      const cacheDir = path.join(hseosDir, '_config', 'custom');
      if (await fs.pathExists(cacheDir)) {
        const cachedModules = await fs.readdir(cacheDir, { withFileTypes: true });

        for (const cachedModule of cachedModules) {
          if (cachedModule.isDirectory()) {
            const moduleId = cachedModule.name;
            const cachedPath = path.join(cacheDir, moduleId);
            const moduleYamlPath = path.join(cachedPath, 'module.yaml');

            // Check if this is actually a custom module
            if (await fs.pathExists(moduleYamlPath)) {
              // Check if this is an external official module - skip cache for those
              const isExternal = await this.moduleManager.isExternalModule(moduleId);
              if (isExternal) {
                // External modules are handled via cloneExternalModule, not from cache
                continue;
              }
              customModuleSources.set(moduleId, cachedPath);
            }
          }
        }
      }

      // Process each installed module
      for (const moduleId of installedModules) {
        spinner.message(`Recompiling agents in ${moduleId}...`);

        // Get source path
        let sourcePath;
        if (moduleId === 'core') {
          sourcePath = getSourcePath('core');
        } else {
          // First check if it's in the custom cache
          if (customModuleSources.has(moduleId)) {
            sourcePath = customModuleSources.get(moduleId);
          } else {
            sourcePath = await moduleManager.findModuleSource(moduleId);
          }
        }

        if (!sourcePath) {
          await prompts.log.warn(`Source not found for module ${moduleId}, skipping...`);
          continue;
        }

        const targetPath = path.join(hseosDir, moduleId);

        // Compile agents for this module
        await moduleManager.compileModuleAgents(sourcePath, targetPath, moduleId, hseosDir, this);

        // Count agents (rough estimate based on files)
        const agentsPath = path.join(targetPath, 'agents');
        if (await fs.pathExists(agentsPath)) {
          const agentFiles = await fs.readdir(agentsPath);
          const agentCount = agentFiles.filter((f) => f.endsWith('.md')).length;
          totalAgentCount += agentCount;
        }
      }

      spinner.stop('Agent recompilation complete!');

      return {
        success: true,
        agentCount: totalAgentCount,
        modules: installedModules,
      };
    } catch (error) {
      spinner.error('Agent recompilation failed');
      throw error;
    }
  }

  /**
   * Private: Prompt for update action
   */
  async promptUpdateAction() {
    const action = await prompts.select({
      message: 'What would you like to do?',
      choices: [{ name: 'Update existing installation', value: 'update' }],
    });
    return { action };
  }

  /**
   * Handle legacy HSEOS v4 detection with simple warning
   * @param {string} _projectDir - Project directory (unused in simplified version)
   * @param {Object} _legacyV4 - Legacy V4 detection result (unused in simplified version)
   */
  async handleLegacyV4Migration(_projectDir, _legacyV4) {
    await prompts.note(
      'Found .hseos folder from HSEOS v4 installation.\n\n' +
        'Before continuing with installation, we recommend:\n' +
        '  1. Remove the .hseos folder, OR\n' +
        '  2. Back it up by renaming it to another name (e.g., hseos-backup)\n\n' +
        'If your v4 installation set up rules or commands, you should remove those as well.',
      'Legacy HSEOS v4 detected',
    );

    const proceed = await prompts.select({
      message: 'What would you like to do?',
      choices: [
        {
          name: 'Exit and clean up manually (recommended)',
          value: 'exit',
          hint: 'Exit installation',
        },
        {
          name: 'Continue with installation anyway',
          value: 'continue',
          hint: 'Continue',
        },
      ],
      default: 'exit',
    });

    if (proceed === 'exit') {
      await prompts.log.info('Please remove the .hseos folder and any v4 rules/commands, then run the installer again.');
      // Allow event loop to flush pending I/O before exit
      setImmediate(() => process.exit(0));
      return;
    }

    await prompts.log.warn('Proceeding with installation despite legacy v4 folder');
  }

  /**
   * Read files-manifest.csv
   * @param {string} hseosDir - HSEOS installation directory
   * @returns {Array} Array of file entries from files-manifest.csv
   */
  async readFilesManifest(hseosDir) {
    const filesManifestPath = path.join(hseosDir, '_config', 'files-manifest.csv');
    if (!(await fs.pathExists(filesManifestPath))) {
      return [];
    }

    try {
      const content = await fs.readFile(filesManifestPath, 'utf8');
      const lines = content.split('\n');
      const files = [];

      for (let i = 1; i < lines.length; i++) {
        // Skip header
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV line properly handling quoted values
        const parts = [];
        let current = '';
        let inQuotes = false;

        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            parts.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        parts.push(current); // Add last part

        if (parts.length >= 4) {
          files.push({
            type: parts[0],
            name: parts[1],
            module: parts[2],
            path: parts[3],
            hash: parts[4] || null, // Hash may not exist in old manifests
          });
        }
      }

      return files;
    } catch (error) {
      await prompts.log.warn('Could not read files-manifest.csv: ' + error.message);
      return [];
    }
  }

  /**
   * Detect custom and modified files
   * @param {string} hseosDir - HSEOS installation directory
   * @param {Array} existingFilesManifest - Previous files from files-manifest.csv
   * @returns {Object} Object with customFiles and modifiedFiles arrays
   */
  async detectCustomFiles(hseosDir, existingFilesManifest) {
    const customFiles = [];
    const modifiedFiles = [];

    // Memory is always in .hseos/_memory
    const hseosMemoryPath = '_memory';

    // Check if the manifest has hashes - if not, we can't detect modifications
    let manifestHasHashes = false;
    if (existingFilesManifest && existingFilesManifest.length > 0) {
      manifestHasHashes = existingFilesManifest.some((f) => f.hash);
    }

    // Build map of previously installed files from files-manifest.csv with their hashes
    const installedFilesMap = new Map();
    for (const fileEntry of existingFilesManifest) {
      if (fileEntry.path) {
        const absolutePath = path.join(hseosDir, fileEntry.path);
        installedFilesMap.set(path.normalize(absolutePath), {
          hash: fileEntry.hash,
          relativePath: fileEntry.path,
        });
      }
    }

    // Recursively scan hseosDir for all files
    const scanDirectory = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip certain directories
            if (entry.name === 'node_modules' || entry.name === '.git') {
              continue;
            }
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            const normalizedPath = path.normalize(fullPath);
            const fileInfo = installedFilesMap.get(normalizedPath);

            // Skip certain system files that are auto-generated
            const relativePath = path.relative(hseosDir, fullPath);
            const fileName = path.basename(fullPath);

            // Skip _config directory EXCEPT for modified agent customizations
            if (relativePath.startsWith('_config/') || relativePath.startsWith('_config\\')) {
              // Special handling for .customize.yaml files - only preserve if modified
              if (relativePath.includes('/agents/') && fileName.endsWith('.customize.yaml')) {
                // Check if the customization file has been modified from manifest
                const manifestPath = path.join(hseosDir, '_config', 'manifest.yaml');
                if (await fs.pathExists(manifestPath)) {
                  const crypto = require('node:crypto');
                  const currentContent = await fs.readFile(fullPath, 'utf8');
                  const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');

                  const yaml = require('yaml');
                  const manifestContent = await fs.readFile(manifestPath, 'utf8');
                  const manifestData = yaml.parse(manifestContent);
                  const originalHash = manifestData.agentCustomizations?.[relativePath];

                  // Only add to customFiles if hash differs (user modified)
                  if (originalHash && currentHash !== originalHash) {
                    customFiles.push(fullPath);
                  }
                }
              }
              continue;
            }

            if (relativePath.startsWith(hseosMemoryPath + '/') && path.dirname(relativePath).includes('-sidecar')) {
              continue;
            }

            // Skip config.yaml files - these are regenerated on each install/update
            if (fileName === 'config.yaml') {
              continue;
            }

            if (!fileInfo) {
              // File not in manifest = custom file
              // EXCEPT: Agent .md files in module folders are generated files, not custom
              // Only treat .md files under _config/agents/ as custom
              if (!(fileName.endsWith('.md') && relativePath.includes('/agents/') && !relativePath.startsWith('_config/'))) {
                customFiles.push(fullPath);
              }
            } else if (manifestHasHashes && fileInfo.hash) {
              // File in manifest with hash - check if it was modified
              const currentHash = await this.manifest.calculateFileHash(fullPath);
              if (currentHash && currentHash !== fileInfo.hash) {
                // Hash changed = file was modified
                modifiedFiles.push({
                  path: fullPath,
                  relativePath: fileInfo.relativePath,
                });
              }
            }
          }
        }
      } catch {
        // Ignore errors scanning directories
      }
    };

    await scanDirectory(hseosDir);
    return { customFiles, modifiedFiles };
  }

  /**
   * Handle missing custom module sources interactively
   * @param {Map} customModuleSources - Map of custom module ID to info
   * @param {string} hseosDir - HSEOS directory
   * @param {string} projectRoot - Project root directory
   * @param {string} operation - Current operation ('update', 'compile', etc.)
   * @param {Array} installedModules - Array of installed module IDs (will be modified)
   * @param {boolean} [skipPrompts=false] - Skip interactive prompts and keep all modules with missing sources
   * @returns {Object} Object with validCustomModules array and keptModulesWithoutSources array
   */
  async handleMissingCustomSources(customModuleSources, hseosDir, projectRoot, operation, installedModules, skipPrompts = false) {
    const validCustomModules = [];
    const keptModulesWithoutSources = []; // Track modules kept without sources
    const customModulesWithMissingSources = [];

    // Check which sources exist
    for (const [moduleId, customInfo] of customModuleSources) {
      if (await fs.pathExists(customInfo.sourcePath)) {
        validCustomModules.push({
          id: moduleId,
          name: customInfo.name,
          path: customInfo.sourcePath,
          info: customInfo,
        });
      } else {
        // For cached modules that are missing, we just skip them without prompting
        if (customInfo.cached) {
          // Skip cached modules without prompting
          keptModulesWithoutSources.push({
            id: moduleId,
            name: customInfo.name,
            cached: true,
          });
        } else {
          customModulesWithMissingSources.push({
            id: moduleId,
            name: customInfo.name,
            sourcePath: customInfo.sourcePath,
            relativePath: customInfo.relativePath,
            info: customInfo,
          });
        }
      }
    }

    // If no missing sources, return immediately
    if (customModulesWithMissingSources.length === 0) {
      return {
        validCustomModules,
        keptModulesWithoutSources: [],
      };
    }

    // Non-interactive mode: keep all modules with missing sources
    if (skipPrompts) {
      for (const missing of customModulesWithMissingSources) {
        keptModulesWithoutSources.push(missing.id);
      }
      return { validCustomModules, keptModulesWithoutSources };
    }

    await prompts.log.warn(`Found ${customModulesWithMissingSources.length} custom module(s) with missing sources:`);

    let keptCount = 0;
    let updatedCount = 0;
    let removedCount = 0;

    for (const missing of customModulesWithMissingSources) {
      await prompts.log.message(
        `${missing.name} (${missing.id})\n  Original source: ${missing.relativePath}\n  Full path: ${missing.sourcePath}`,
      );

      const choices = [
        {
          name: 'Keep installed (will not be processed)',
          value: 'keep',
          hint: 'Keep',
        },
        {
          name: 'Specify new source location',
          value: 'update',
          hint: 'Update',
        },
      ];

      // Only add remove option if not just compiling agents
      if (operation !== 'compile-agents') {
        choices.push({
          name: '⚠️  REMOVE module completely (destructive!)',
          value: 'remove',
          hint: 'Remove',
        });
      }

      const action = await prompts.select({
        message: `How would you like to handle "${missing.name}"?`,
        choices,
      });

      switch (action) {
        case 'update': {
          // Use sync validation because @clack/prompts doesn't support async validate
          const newSourcePath = await prompts.text({
            message: 'Enter the new path to the custom module:',
            default: missing.sourcePath,
            validate: (input) => {
              if (!input || input.trim() === '') {
                return 'Please enter a path';
              }
              const expandedPath = path.resolve(input.trim());
              if (!fs.pathExistsSync(expandedPath)) {
                return 'Path does not exist';
              }
              // Check if it looks like a valid module
              const moduleYamlPath = path.join(expandedPath, 'module.yaml');
              const agentsPath = path.join(expandedPath, 'agents');
              const workflowsPath = path.join(expandedPath, 'workflows');

              if (!fs.pathExistsSync(moduleYamlPath) && !fs.pathExistsSync(agentsPath) && !fs.pathExistsSync(workflowsPath)) {
                return 'Path does not appear to contain a valid custom module';
              }
              return; // clack expects undefined for valid input
            },
          });

          // Defensive: handleCancel should have exited, but guard against symbol propagation
          if (typeof newSourcePath !== 'string') {
            keptCount++;
            keptModulesWithoutSources.push(missing.id);
            continue;
          }

          // Update the source in manifest
          const resolvedPath = path.resolve(newSourcePath.trim());
          missing.info.sourcePath = resolvedPath;
          // Remove relativePath - we only store absolute sourcePath now
          delete missing.info.relativePath;
          await this.manifest.addCustomModule(hseosDir, missing.info);

          validCustomModules.push({
            id: missing.id,
            name: missing.name,
            path: resolvedPath,
            info: missing.info,
          });

          updatedCount++;
          await prompts.log.success('Updated source location');

          break;
        }
        case 'remove': {
          // Extra confirmation for destructive remove
          await prompts.log.error(
            `WARNING: This will PERMANENTLY DELETE "${missing.name}" and all its files!\n  Module location: ${path.join(hseosDir, missing.id)}`,
          );

          const confirmDelete = await prompts.confirm({
            message: 'Are you absolutely sure you want to delete this module?',
            default: false,
          });

          if (confirmDelete) {
            const typedConfirm = await prompts.text({
              message: 'Type "DELETE" to confirm permanent deletion:',
              validate: (input) => {
                if (input !== 'DELETE') {
                  return 'You must type "DELETE" exactly to proceed';
                }
                return; // clack expects undefined for valid input
              },
            });

            if (typedConfirm === 'DELETE') {
              // Remove the module from filesystem and manifest
              const modulePath = path.join(hseosDir, missing.id);
              if (await fs.pathExists(modulePath)) {
                const fsExtra = require('fs-extra');
                await fsExtra.remove(modulePath);
                await prompts.log.warn(`Deleted module directory: ${path.relative(projectRoot, modulePath)}`);
              }

              await this.manifest.removeModule(hseosDir, missing.id);
              await this.manifest.removeCustomModule(hseosDir, missing.id);
              await prompts.log.warn('Removed from manifest');

              // Also remove from installedModules list
              if (installedModules && installedModules.includes(missing.id)) {
                const index = installedModules.indexOf(missing.id);
                if (index !== -1) {
                  installedModules.splice(index, 1);
                }
              }

              removedCount++;
              await prompts.log.error(`"${missing.name}" has been permanently removed`);
            } else {
              await prompts.log.message('Removal cancelled - module will be kept');
              keptCount++;
            }
          } else {
            await prompts.log.message('Removal cancelled - module will be kept');
            keptCount++;
          }

          break;
        }
        case 'keep': {
          keptCount++;
          keptModulesWithoutSources.push(missing.id);
          await prompts.log.message('Module will be kept as-is');

          break;
        }
        // No default
      }
    }

    // Show summary
    if (keptCount > 0 || updatedCount > 0 || removedCount > 0) {
      let summary = 'Summary for custom modules with missing sources:';
      if (keptCount > 0) summary += `\n  • ${keptCount} module(s) kept as-is`;
      if (updatedCount > 0) summary += `\n  • ${updatedCount} module(s) updated with new sources`;
      if (removedCount > 0) summary += `\n  • ${removedCount} module(s) permanently deleted`;
      await prompts.log.message(summary);
    }

    return {
      validCustomModules,
      keptModulesWithoutSources,
    };
  }
}

module.exports = { Installer };

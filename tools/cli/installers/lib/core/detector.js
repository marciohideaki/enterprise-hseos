const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { Manifest } = require('./manifest');

class Detector {
  /**
   * Detect existing HSEOS installation
   * @param {string} hseosDir - Path to hseos directory
   * @returns {Object} Installation status and details
   */
  async detect(hseosDir) {
    const result = {
      installed: false,
      path: hseosDir,
      version: null,
      hasCore: false,
      modules: [],
      ides: [],
      customModules: [],
      manifest: null,
    };

    // Check if hseos directory exists
    if (!(await fs.pathExists(hseosDir))) {
      return result;
    }

    // Check for manifest using the Manifest class
    const manifest = new Manifest();
    const manifestData = await manifest.read(hseosDir);
    if (manifestData) {
      result.manifest = manifestData;
      result.version = manifestData.version;
      result.installed = true;
      // Copy custom modules if they exist
      if (manifestData.customModules) {
        result.customModules = manifestData.customModules;
      }
    }

    // Check for core
    const corePath = path.join(hseosDir, 'core');
    if (await fs.pathExists(corePath)) {
      result.hasCore = true;

      // Try to get core version from config
      const coreConfigPath = path.join(corePath, 'config.yaml');
      if (await fs.pathExists(coreConfigPath)) {
        try {
          const configContent = await fs.readFile(coreConfigPath, 'utf8');
          const config = yaml.parse(configContent);
          if (!result.version && config.version) {
            result.version = config.version;
          }
        } catch {
          // Ignore config read errors
        }
      }
    }

    // Check for modules
    // If manifest exists, use it as the source of truth for installed modules
    // Otherwise fall back to directory scanning (legacy installations)
    if (manifestData && manifestData.modules && manifestData.modules.length > 0) {
      // Use manifest module list - these are officially installed modules
      for (const moduleId of manifestData.modules) {
        const modulePath = path.join(hseosDir, moduleId);
        const moduleConfigPath = path.join(modulePath, 'config.yaml');

        const moduleInfo = {
          id: moduleId,
          path: modulePath,
          version: 'unknown',
        };

        if (await fs.pathExists(moduleConfigPath)) {
          try {
            const configContent = await fs.readFile(moduleConfigPath, 'utf8');
            const config = yaml.parse(configContent);
            moduleInfo.version = config.version || 'unknown';
            moduleInfo.name = config.name || moduleId;
            moduleInfo.description = config.description;
          } catch {
            // Ignore config read errors
          }
        }

        result.modules.push(moduleInfo);
      }
    } else {
      // Fallback: scan directory for modules (legacy installations without manifest)
      const entries = await fs.readdir(hseosDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'core' && entry.name !== '_config') {
          const modulePath = path.join(hseosDir, entry.name);
          const moduleConfigPath = path.join(modulePath, 'config.yaml');

          // Only treat it as a module if it has a config.yaml
          if (await fs.pathExists(moduleConfigPath)) {
            const moduleInfo = {
              id: entry.name,
              path: modulePath,
              version: 'unknown',
            };

            try {
              const configContent = await fs.readFile(moduleConfigPath, 'utf8');
              const config = yaml.parse(configContent);
              moduleInfo.version = config.version || 'unknown';
              moduleInfo.name = config.name || entry.name;
              moduleInfo.description = config.description;
            } catch {
              // Ignore config read errors
            }

            result.modules.push(moduleInfo);
          }
        }
      }
    }

    // Check for IDE configurations from manifest
    if (result.manifest && result.manifest.ides) {
      // Filter out any undefined/null values
      result.ides = result.manifest.ides.filter((ide) => ide && typeof ide === 'string');
    }

    // Mark as installed if we found core or modules
    if (result.hasCore || result.modules.length > 0) {
      result.installed = true;
    }

    return result;
  }

  /**
   * Detect legacy installation (_hseos, .bmm, .cis)
   * @param {string} projectDir - Project directory to check
   * @returns {Object} Legacy installation details
   */
  async detectLegacy(projectDir) {
    const result = {
      hasLegacy: false,
      legacyCore: false,
      legacyModules: [],
      paths: [],
    };

    // Check for legacy core (_hseos)
    const legacyCorePath = path.join(projectDir, '_hseos');
    if (await fs.pathExists(legacyCorePath)) {
      result.hasLegacy = true;
      result.legacyCore = true;
      result.paths.push(legacyCorePath);
    }

    // Check for legacy modules (directories starting with .)
    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        entry.name.startsWith('.') &&
        entry.name !== '_hseos' &&
        !entry.name.startsWith('.git') &&
        !entry.name.startsWith('.vscode') &&
        !entry.name.startsWith('.idea')
      ) {
        const modulePath = path.join(projectDir, entry.name);
        const moduleManifestPath = path.join(modulePath, 'install-manifest.yaml');

        // Check if it's likely an HSEOS module
        if ((await fs.pathExists(moduleManifestPath)) || (await fs.pathExists(path.join(modulePath, 'config.yaml')))) {
          result.hasLegacy = true;
          result.legacyModules.push({
            name: entry.name.slice(1), // Remove leading dot
            path: modulePath,
          });
          result.paths.push(modulePath);
        }
      }
    }

    return result;
  }

  /**
   * Check if migration from legacy is needed
   * @param {string} projectDir - Project directory
   * @returns {Object} Migration requirements
   */
  async checkMigrationNeeded(projectDir) {
    const hseosDir = path.join(projectDir, 'hseos');
    const current = await this.detect(hseosDir);
    const legacy = await this.detectLegacy(projectDir);

    return {
      needed: legacy.hasLegacy && !current.installed,
      canMigrate: legacy.hasLegacy,
      legacy: legacy,
      current: current,
    };
  }

  /**
   * Detect legacy HSEOS v4 footprint.
   *
   * Discriminator: v4 used a `_cfg/` config folder under `.hseos/`. v2.0+ uses
   * `_config/`. Mere presence of `.hseos/` is NOT a v4 signal — every
   * successful v2.0 install creates `.hseos/`, so flagging on that alone gives
   * a false positive on every reinstall, telling the user their current install
   * is "legacy v4" and instructing them to delete `.hseos/`. This caused real
   * user data loss (see commit history for `fix/legacy-v4-false-positive`).
   *
   * Trigger only when the directory contains an actual legacy v4 marker:
   *   - `.hseos/_cfg/` (the v4 config folder), OR
   *   - `.hseos/` exists but `.hseos/_config/` does NOT — i.e. a non-v2.0
   *     install layout where the modern config marker is absent.
   *
   * @param {string} projectDir - Project directory to check
   * @returns {{ hasLegacyV4: boolean, offenders: string[] }}
   */
  async detectLegacyV4(projectDir) {
    const offenders = [];
    const hseosMethodPath = path.join(projectDir, '.hseos');

    if (!(await fs.pathExists(hseosMethodPath))) {
      return { hasLegacyV4: false, offenders };
    }

    const legacyCfgPath = path.join(hseosMethodPath, '_cfg');
    const modernConfigPath = path.join(hseosMethodPath, '_config');
    const hasLegacyCfg = await fs.pathExists(legacyCfgPath);
    const hasModernConfig = await fs.pathExists(modernConfigPath);

    if (hasLegacyCfg) {
      offenders.push(legacyCfgPath);
    }
    // If `.hseos/` exists with neither marker, this is a non-standard layout
    // (HSEOS source self-host, alpha drop, manual scaffold, etc.). It is not
    // a current v2.0 install, so warn — but only when the modern marker is
    // missing, to avoid the historic false positive.
    if (!hasLegacyCfg && !hasModernConfig) {
      offenders.push(hseosMethodPath);
    }

    return { hasLegacyV4: offenders.length > 0, offenders };
  }
}

module.exports = { Detector };

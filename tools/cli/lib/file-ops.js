const fs = require('fs-extra');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * File operations utility class
 */
class FileOps {
  /**
   * Copy a directory recursively
   * @param {string} source - Source directory
   * @param {string} dest - Destination directory
   * @param {Object} options - Copy options
   */
  async copyDirectory(source, dest, options = {}) {
    const defaultOptions = {
      overwrite: true,
      errorOnExist: false,
      filter: (src) => !this.shouldIgnore(src),
    };

    const copyOptions = { ...defaultOptions, ...options };
    await fs.copy(source, dest, copyOptions);
  }

  /**
   * Compare two files by content (size fast-path, then sha256).
   * @returns {boolean} True when contents are byte-identical
   */
  async filesIdentical(a, b) {
    const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b)]);
    if (statA.size !== statB.size) return false;
    const [hashA, hashB] = await Promise.all([this.getFileHash(a), this.getFileHash(b)]);
    return hashA === hashB;
  }

  /**
   * Canonical idempotent file sync — the ONE comparison primitive for every
   * installer path. Content-addressed only: mtime is never consulted (git
   * checkouts and npm packs reset it, which made mtime heuristics silently
   * clobber user edits after any source refresh).
   *
   * Decision table:
   *   dest missing                          → copy            ('created')
   *   dest == source                        → no-op           ('in-sync')
   *   recordedHash && dest == recordedHash  → copy            ('updated')       user never touched it
   *   recordedHash && src  == recordedHash  → preserve        ('preserved-modified') only user touched it
   *   recordedHash && both moved            → preserve        ('conflict-preserved') caller reports/backs up
   *   no recordedHash, overwriteModified    → copy            ('updated')       explicit force
   *   no recordedHash                       → preserve        ('preserved-modified') safe default
   *
   * @param {string} sourceFile
   * @param {string} destFile
   * @param {Object} options { recordedHash?, overwriteModified?, copyFn? }
   * @returns {string} verdict
   */
  async syncFileSafe(sourceFile, destFile, options = {}) {
    const copyFn =
      options.copyFn ||
      (async (src, dst) => {
        await fs.ensureDir(path.dirname(dst));
        await fs.copy(src, dst, { overwrite: true });
      });

    if (!(await fs.pathExists(destFile))) {
      await copyFn(sourceFile, destFile);
      return 'created';
    }
    if (await this.filesIdentical(sourceFile, destFile)) {
      return 'in-sync';
    }
    if (options.recordedHash) {
      const destHash = await this.getFileHash(destFile);
      if (destHash === options.recordedHash) {
        await copyFn(sourceFile, destFile);
        return 'updated';
      }
      const sourceHash = await this.getFileHash(sourceFile);
      if (sourceHash === options.recordedHash) {
        return 'preserved-modified';
      }
      return 'conflict-preserved';
    }
    if (options.overwriteModified) {
      await copyFn(sourceFile, destFile);
      return 'updated';
    }
    return 'preserved-modified';
  }

  /**
   * Sync directory (selective copy preserving modifications).
   * Built on syncFileSafe — content-addressed, never mtime-based.
   * @param {string} source - Source directory
   * @param {string} dest - Destination directory
   * @param {Object} options { recordedHashes?: Map<relPath,hash>, overwriteModified?: boolean }
   * @returns {Object} summary { created, updated, inSync, preserved, conflicts, removedOrphans }
   */
  async syncDirectory(source, dest, options = {}) {
    const sourceFiles = await this.getFileList(source);
    const summary = { created: [], updated: [], inSync: [], preserved: [], conflicts: [], removedOrphans: [] };
    const buckets = {
      created: summary.created,
      updated: summary.updated,
      'in-sync': summary.inSync,
      'preserved-modified': summary.preserved,
      'conflict-preserved': summary.conflicts,
    };

    for (const file of sourceFiles) {
      const verdict = await this.syncFileSafe(path.join(source, file), path.join(dest, file), {
        recordedHash: options.recordedHashes?.get?.(file) || null,
        overwriteModified: Boolean(options.overwriteModified),
      });
      buckets[verdict].push(file);
    }

    // Remove files that no longer exist in source
    const destFiles = await this.getFileList(dest);
    for (const file of destFiles) {
      const sourceFile = path.join(source, file);
      const destFile = path.join(dest, file);

      if (!(await fs.pathExists(sourceFile))) {
        await fs.remove(destFile);
        summary.removedOrphans.push(file);
      }
    }

    return summary;
  }

  /**
   * Get list of all files in a directory
   * @param {string} dir - Directory path
   * @returns {Array} List of relative file paths
   */
  async getFileList(dir) {
    const files = [];

    if (!(await fs.pathExists(dir))) {
      return files;
    }

    const walk = async (currentDir, baseDir) => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && !this.shouldIgnore(fullPath)) {
          await walk(fullPath, baseDir);
        } else if (entry.isFile() && !this.shouldIgnore(fullPath)) {
          files.push(path.relative(baseDir, fullPath));
        }
      }
    };

    await walk(dir, dir);
    return files;
  }

  /**
   * Get file hash for comparison
   * @param {string} filePath - File path
   * @returns {string} File hash
   */
  async getFileHash(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    return new Promise((resolve, reject) => {
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Check if a path should be ignored
   * @param {string} filePath - Path to check
   * @returns {boolean} True if should be ignored
   */
  shouldIgnore(filePath) {
    const ignoredPatterns = ['.git', '.DS_Store', 'node_modules', '*.swp', '*.tmp', '.idea', '.vscode', '__pycache__', '*.pyc'];

    const basename = path.basename(filePath);

    for (const pattern of ignoredPatterns) {
      if (pattern.includes('*')) {
        // Simple glob pattern matching
        const regex = new RegExp(pattern.replace('*', '.*'));
        if (regex.test(basename)) {
          return true;
        }
      } else if (basename === pattern) {
        return true;
      }
    }

    return false;
  }

  /**
   * Ensure directory exists
   * @param {string} dir - Directory path
   */
  async ensureDir(dir) {
    await fs.ensureDir(dir);
  }

  /**
   * Remove directory or file
   * @param {string} targetPath - Path to remove
   */
  async remove(targetPath) {
    if (await fs.pathExists(targetPath)) {
      await fs.remove(targetPath);
    }
  }

  /**
   * Read file content
   * @param {string} filePath - File path
   * @returns {string} File content
   */
  async readFile(filePath) {
    return await fs.readFile(filePath, 'utf8');
  }

  /**
   * Write file content
   * @param {string} filePath - File path
   * @param {string} content - File content
   */
  async writeFile(filePath, content) {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Check if path exists
   * @param {string} targetPath - Path to check
   * @returns {boolean} True if exists
   */
  async exists(targetPath) {
    return await fs.pathExists(targetPath);
  }

  /**
   * Get file or directory stats
   * @param {string} targetPath - Path to check
   * @returns {Object} File stats
   */
  async stat(targetPath) {
    return await fs.stat(targetPath);
  }
}

module.exports = { FileOps };

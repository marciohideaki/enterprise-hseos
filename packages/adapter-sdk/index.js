'use strict';

/**
 * @hseos/adapter-sdk
 *
 * Adapter SDK for authoring BYOA (Bring-Your-Own-Adapter) adapters.
 * An adapter converts the vendor-neutral .agents/ source-of-truth into
 * platform-specific configuration files.
 *
 * Usage:
 *   const { AdapterBase, normalizeHookEvent, resolveAdapterOutputDir } = require('@hseos/adapter-sdk');
 *   class MyAdapter extends AdapterBase { ... }
 *   module.exports = MyAdapter;
 *
 * See: ADR-0007 (Compiler v2 multi-adapter contract)
 */

class AdapterBase {
  /**
   * Unique adapter identifier. Must match the id in .agents/adapters/<id>.yaml.
   * @returns {string}
   */
  static get id() {
    throw new Error('AdapterBase: subclass must override static id getter');
  }

  /**
   * Adapter version (semver string).
   * @returns {string}
   */
  static get version() {
    return '1.0';
  }

  /**
   * Declarative capability list. Used to populate CAPABILITY-MATRIX.md.
   * @returns {string[]}
   */
  static get capabilities() {
    return [];
  }

  /**
   * Validate sources before emitting. Return warnings/errors without throwing.
   * @param {object} sources
   * @param {object} manifest
   * @returns {Promise<{ok:boolean, warnings:string[], errors:string[]}>}
   */
  async validate(sources, manifest) {
    void sources;
    void manifest;
    return { ok: true, warnings: [], errors: [] };
  }

  /**
   * Emit platform-specific files into outputDir.
   * @param {object} sources — compiled sources (skills, hooks, mcp, commands, plugins)
   * @param {string} outputDir — absolute path to write adapter output
   * @returns {Promise<void>}
   */
  async emit(sources, outputDir) {
    void sources;
    void outputDir;
    throw new Error(`AdapterBase: ${this.constructor.name} must override async emit(sources, outputDir)`);
  }

  /**
   * Verify previously emitted files for drift/integrity.
   * @param {string} outputDir
   * @returns {Promise<{ok:boolean, drift:string[]}>}
   */
  async verify(outputDir) {
    void outputDir;
    return { ok: true, drift: [] };
  }

  /**
   * Remove all files emitted by this adapter.
   * @param {string} outputDir
   * @returns {Promise<{removed:string[]}>}
   */
  async clean(outputDir) {
    void outputDir;
    return { removed: [] };
  }

  /**
   * Map a neutral hook event name to this platform's vocabulary.
   * Default: identity (most platforms share the same event names).
   * @param {string} neutralEvent
   * @returns {string}
   */
  mapHookEvent(neutralEvent) {
    return neutralEvent;
  }

  /**
   * Map a neutral tool name to this platform's vocabulary.
   * @param {string} neutralName
   * @returns {string}
   */
  mapToolName(neutralName) {
    return neutralName;
  }

  /**
   * Resolve a neutral relative path to a platform-specific path.
   * @param {string} neutralPath
   * @param {object} [ctx]
   * @returns {string}
   */
  resolvePath(neutralPath, ctx) {
    void ctx;
    return neutralPath;
  }
}

/**
 * Normalise a neutral hook event name.
 * Falls back to the raw value if no mapping exists.
 * @param {string} event
 * @param {Record<string,string>} [eventMap]
 * @returns {string}
 */
function normalizeHookEvent(event, eventMap = {}) {
  return eventMap[event] || event;
}

/**
 * Resolve the canonical output directory for a given adapter id.
 * Convention: .<adapter-id>/ at the project root.
 * @param {string} projectRoot
 * @param {string} adapterId
 * @returns {string}
 */
function resolveAdapterOutputDir(projectRoot, adapterId) {
  const path = require('node:path');
  return path.join(projectRoot, `.${adapterId}`);
}

/**
 * Build a conformance report for an adapter class.
 * Checks that required static getters and instance methods are present.
 * @param {typeof AdapterBase} AdapterClass
 * @returns {{ok:boolean, missing:string[]}}
 */
function checkAdapterConformance(AdapterClass) {
  const missing = [];
  let adapterId;
  try {
    adapterId = AdapterClass.id;
  } catch {
    /* getter throws */
  }
  if (typeof adapterId !== 'string') missing.push('static id (string)');
  let adapterVersion;
  try {
    adapterVersion = AdapterClass.version;
  } catch {
    /* getter throws */
  }
  if (typeof adapterVersion !== 'string') missing.push('static version (string)');
  let adapterCaps;
  try {
    adapterCaps = AdapterClass.capabilities;
  } catch {
    /* getter throws */
  }
  if (!Array.isArray(adapterCaps)) missing.push('static capabilities (array)');

  const instance = Object.create(AdapterClass.prototype);
  for (const method of ['validate', 'emit', 'verify', 'clean', 'mapHookEvent', 'mapToolName', 'resolvePath']) {
    if (typeof instance[method] !== 'function') missing.push(`instance method: ${method}`);
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  AdapterBase,
  normalizeHookEvent,
  resolveAdapterOutputDir,
  checkAdapterConformance,
};

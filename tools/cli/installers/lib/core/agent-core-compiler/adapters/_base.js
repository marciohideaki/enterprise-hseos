'use strict';

class AdapterBase {
  static get id() {
    throw new Error('AdapterBase: subclass must override static id getter');
  }

  static get version() {
    return '1.0';
  }

  static get capabilities() {
    return [];
  }

  // Lifecycle hooks. Subclasses override the relevant ones; the rest are no-ops
  // so partial adapters can be shipped incrementally.

  async validate(sources, manifest) {
    return { ok: true, warnings: [], errors: [] };
  }

  async emit(sources, outputDir) {
    throw new Error(`AdapterBase: ${this.constructor.name} must override async emit(sources, outputDir)`);
  }

  async verify(outputDir) {
    return { ok: true, drift: [] };
  }

  async clean(outputDir) {
    return { removed: [] };
  }

  // Capability mapping helpers. Default behaviour is identity; subclasses
  // override when their target uses a different vocabulary.

  mapHookEvent(neutralEvent) {
    return neutralEvent;
  }

  mapToolName(neutralName) {
    return neutralName;
  }

  resolvePath(neutralPath /*, ctx */) {
    return neutralPath;
  }
}

module.exports = { AdapterBase };

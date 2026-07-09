// Shim: delegates to the modular implementation.
// All callers import AgentCoreCompiler from this path — backward-compat preserved.
module.exports = require('./agent-core-compiler/index');

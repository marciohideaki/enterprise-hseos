// Entries under `.hseos/` that belong to the project, not to an installation.
// The installer never treats them as modules and never writes into them.
const PROJECT_STATE_ENTRIES = new Set(['runs', 'state', 'config']);

// Entries that only an installation (current or legacy) creates. Anything else
// next to project state (dotfiles, reports/, ...) is left alone and never makes
// `.hseos/` look like a legacy install.
const INSTALL_MARKERS = new Set(['_config', '_cfg', '_memory', 'core', 'hsm', 'workflows', 'agents']);

// Written when a fresh install starts and removed when it completes; its presence
// means the previous install was interrupted and must be repaired, not refused.
const INSTALL_IN_PROGRESS_FILE = '.install-in-progress';

module.exports = { PROJECT_STATE_ENTRIES, INSTALL_MARKERS, INSTALL_IN_PROGRESS_FILE };

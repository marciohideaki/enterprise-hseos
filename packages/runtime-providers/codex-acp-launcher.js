#!/usr/bin/env node
/* eslint n/hashbang: ["error", {"additionalExecutables": ["codex-acp-launcher.js"]}] */
'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { validateRestrictedComposition, startupArgs } = require('./codex-acp-composition');
try {
  if (process.argv.length !== 3 || process.argv[2] !== 'app-server') throw new Error('launch');
  const composition = JSON.parse(fs.readFileSync(process.env.HSEOS_ACP_COMPOSITION, 'utf8'));
  const { config } = validateRestrictedComposition(composition);
  if (process.env.CODEX_HOME !== composition.home || process.env.HOME !== composition.home) throw new Error('home');
  const child = spawn(composition.binary, startupArgs(config), {
    stdio: 'inherit',
    env: { HOME: composition.home, CODEX_HOME: composition.home, PATH: process.env.PATH },
    cwd: composition.cwd,
    shell: false,
  });
  child.on('error', () => {
    process.exitCode = 1;
  });
  child.on('exit', (code) => process.exit(code ?? 1));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch {
  process.exitCode = 1;
}

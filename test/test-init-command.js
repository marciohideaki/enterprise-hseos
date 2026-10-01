'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const prompts = require('../tools/cli/lib/prompts');
const init = require('../tools/cli/commands/init');
const install = require('../tools/cli/commands/install');

const PROFILE_MESSAGE = /HSEOS profile/;
const MODE_MESSAGE = /platform capabilities/;

function tempProject(files = {}) {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-init-'));
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), content);
  }
  return directory;
}

/**
 * Runs `fn` with interactive TTY flags and stubbed prompts. `answers.profile` and
 * `answers.mode` answer the two select prompts by message; `answers.modeRefs`
 * are fed to the text prompt in order (validate is exercised on every value).
 */
async function withPrompts(answers, fn) {
  const originals = {
    stdinTTY: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdoutTTY: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    select: prompts.select,
    text: prompts.text,
    note: prompts.note,
    confirm: prompts.confirm,
    info: prompts.log.info,
    action: install.action,
  };
  const seen = { selects: [], texts: [], validations: [], summary: undefined, installOptions: undefined };
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    prompts.select = async (options) => {
      seen.selects.push(options);
      if (PROFILE_MESSAGE.test(options.message)) return answers.profile || 'developer';
      assert.match(options.message, MODE_MESSAGE);
      return answers.mode || 'platform';
    };
    prompts.text = async (options) => {
      seen.texts.push(options);
      for (const value of answers.modeRefs || []) {
        const problem = options.validate(value);
        seen.validations.push({ value, problem });
        if (!problem) return value;
      }
      throw new Error('no valid mode_ref was supplied');
    };
    prompts.note = async (message) => {
      seen.summary = message;
    };
    prompts.confirm = async () => answers.approve ?? false;
    prompts.log.info = async () => {};
    install.action = async (options) => {
      seen.installOptions = options;
    };
    await fn(seen);
  } finally {
    if (originals.stdinTTY) Object.defineProperty(process.stdin, 'isTTY', originals.stdinTTY);
    else delete process.stdin.isTTY;
    if (originals.stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', originals.stdoutTTY);
    else delete process.stdout.isTTY;
    Object.assign(prompts, { select: originals.select, text: originals.text, note: originals.note, confirm: originals.confirm });
    prompts.log.info = originals.info;
    install.action = originals.action;
  }
}

test('init refuses non-interactive execution before reading or writing a project', async () => {
  await assert.rejects(init.action({ directory: '/missing-project' }), /requires an interactive terminal/);
});

test('init shows a plan and leaves the project untouched when installation is declined', async () => {
  const directory = tempProject();
  try {
    await withPrompts({ approve: false }, async (seen) => {
      await init.action({ directory });
      assert.match(seen.summary, /Profile: Developer/);
      assert.match(seen.summary, /Optional prerequisites:/);
      assert.match(seen.summary, /Adapters: claude-code, codex/);
      assert.equal(seen.installOptions, undefined);
    });
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('init offers the three platform modes with platform as the recommended default', async () => {
  const directory = tempProject();
  try {
    await withPrompts({}, async (seen) => {
      await init.action({ directory });
      const modePrompt = seen.selects.find((options) => MODE_MESSAGE.test(options.message));
      assert.deepEqual(
        modePrompt.choices.map((choice) => choice.value),
        ['platform', 'hybrid', 'local'],
      );
      assert.equal(modePrompt.default, 'platform');
      assert.match(modePrompt.choices[0].name, /recommended/);
      assert.equal(seen.texts.length, 0);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('init shows detected stacks in the mode prompt and in the plan summary', async () => {
  const directory = tempProject({ 'package.json': '{}', 'App.csproj': '<Project/>' });
  try {
    await withPrompts({}, async (seen) => {
      await init.action({ directory });
      assert.match(seen.selects.find((options) => MODE_MESSAGE.test(options.message)).message, /dotnet, node/);
      assert.match(seen.summary, /Platform bindings: platform \(dotnet, node\)/);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('init reports when no stack is detected', async () => {
  const directory = tempProject();
  try {
    await withPrompts({}, async (seen) => {
      await init.action({ directory });
      assert.match(seen.summary, /Platform bindings: platform \(no stacks detected\)/);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('init asks for a decision record when the chosen mode is weaker than platform', async () => {
  for (const mode of ['hybrid', 'local']) {
    const directory = tempProject({ 'docs/decisions/why.md': '# why\n', 'README.md': '# readme\n' });
    try {
      await withPrompts(
        { mode, modeRefs: ['nope.md', 'README.md', 'docs/decisions/missing.md', ' docs/decisions/why.md '], approve: true },
        async (seen) => {
          await init.action({ directory });
          assert.equal(seen.texts.length, 1);
          assert.match(seen.texts[0].message, new RegExp(`mode '${mode}'`));
          assert.deepEqual(
            seen.validations.map((entry) => Boolean(entry.problem)),
            [true, true, true, false],
          );
          assert.match(seen.validations[0].problem, /mode_ref/);
          assert.match(seen.validations[2].problem, /does not exist/);
          assert.deepEqual(seen.installOptions, { directory, profile: 'developer', platformMode: mode, modeRef: 'docs/decisions/why.md' });
          assert.match(seen.summary, new RegExp(`Platform bindings: ${mode}`));
        },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('init does not ask for a decision record when the recorded mode is already weaker', async () => {
  const directory = tempProject({
    'docs/decisions/why.md': '# why\n',
    '.hseos/config/platform-bindings.yaml': 'schema_version: 1.0.0\nmode: local\nmode_ref: docs/decisions/why.md\n',
  });
  // The recorded mode is read from the committed revision.
  const git = (...args) =>
    execFileSync(
      'git',
      ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      {
        stdio: 'ignore',
      },
    );
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  try {
    await withPrompts({ mode: 'local', approve: true }, async (seen) => {
      await init.action({ directory });
      assert.equal(seen.texts.length, 0);
      assert.deepEqual(seen.installOptions, { directory, profile: 'developer', platformMode: 'local' });
    });
    await withPrompts({ mode: 'hybrid', approve: true }, async (seen) => {
      await init.action({ directory });
      assert.equal(seen.texts.length, 0);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('init passes the reviewed profile, directory and the explicit platform choice to the installer', async () => {
  const directory = tempProject();
  try {
    await withPrompts({ profile: 'governance', approve: true }, async (seen) => {
      await init.action({ directory });
      assert.deepEqual(seen.installOptions, { directory, profile: 'governance', platformMode: 'platform' });
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('summarizePlan omits the bindings line when no choice is passed', () => {
  const plan = { components: [], skills: [], install_paths: [], tools: [], hook_profile: 'standard', profile: 'developer' };
  assert.doesNotMatch(init.summarizePlan(plan, '/p'), /Platform bindings/);
  assert.match(init.summarizePlan(plan, '/p', { mode: 'hybrid', stacks: ['go'] }), /Platform bindings: hybrid \(go\)/);
});

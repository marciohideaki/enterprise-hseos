'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc');
const SDK = path.join(ROOT, 'packages', 'control-sdk', 'index.js').replaceAll('\\', '/');

function typecheck(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-sdk-types-'));
  try {
    fs.writeFileSync(path.join(dir, 'probe.ts'), source);
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, module: 'nodenext', moduleResolution: 'nodenext', noEmit: true, skipLibCheck: false, types: [] },
        files: ['probe.ts'],
      }),
    );
    return spawnSync(TSC, ['-p', dir], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HEAD = `import { ControlClient } from '${SDK}';\nconst client = new ControlClient({ url: 'http://127.0.0.1:1', credential: 'x'.repeat(32) });\n`;

test('SDK query accepts a union-typed view and still rejects unknown views', { skip: !fs.existsSync(TSC) }, () => {
  const accepted = typecheck(
    HEAD +
      `declare const view: 'status' | 'evidence' | 'review' | 'session';\nvoid client.query('id', view);\nvoid client.query('id');\nvoid client.query('id', 'status');\nvoid client.query('id', 'evidence');\n`,
  );
  assert.equal(accepted.status, 0, accepted.stdout);
  const rejected = typecheck(
    HEAD +
      `// @ts-expect-error unknown view\nvoid client.query('id', 'bogus');\ndeclare const wide: string;\n// @ts-expect-error a plain string is not a view\nvoid client.query('id', wide);\ndeclare const mixed: 'status' | 'bogus';\n// @ts-expect-error a union containing an unknown view\nvoid client.query('id', mixed);\n`,
  );
  assert.equal(rejected.status, 0, rejected.stdout);
});

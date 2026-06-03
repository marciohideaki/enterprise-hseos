'use strict';

// Regression test for fix/legacy-v4-false-positive.
//
// Before the fix, Detector.detectLegacyV4 returned hasLegacyV4=true for ANY
// project containing a .hseos/ folder. That meant every reinstall of a
// healthy v2.0 install hit the "Legacy HSEOS v4 detected" prompt which
// instructs users to delete .hseos/ — a documented foot-gun that caused
// real data loss when users wiped the wrong directory.
//
// The fix flags only:
//   (a) the real legacy v4 marker: .hseos/_cfg/, or
//   (b) a non-standard .hseos/ that lacks both _cfg/ and the modern _config/.
//
// A current v2.0 install (.hseos/_config/ present) must NOT be flagged.

const path = require('node:path');
const fs = require('fs-extra');
const os = require('node:os');
const assert = require('node:assert/strict');

const { Detector } = require('../tools/cli/installers/lib/core/detector');

async function mkScratch() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hseos-detector-test-'));
}

(async () => {
  const detector = new Detector();
  const cases = [];

  // Case 1: no .hseos/ at all → false
  {
    const dir = await mkScratch();
    const r = await detector.detectLegacyV4(dir);
    cases.push({ name: 'no .hseos', expected: false, actual: r.hasLegacyV4 });
    await fs.remove(dir);
  }

  // Case 2: modern v2.0 install (.hseos/_config/manifest.yaml present) → false
  {
    const dir = await mkScratch();
    await fs.ensureDir(path.join(dir, '.hseos', '_config'));
    await fs.writeFile(path.join(dir, '.hseos', '_config', 'manifest.yaml'), 'version: 2.0.0\n');
    const r = await detector.detectLegacyV4(dir);
    cases.push({ name: 'modern v2.0 install', expected: false, actual: r.hasLegacyV4 });
    await fs.remove(dir);
  }

  // Case 3: real legacy v4 (.hseos/_cfg/) → true
  {
    const dir = await mkScratch();
    await fs.ensureDir(path.join(dir, '.hseos', '_cfg'));
    const r = await detector.detectLegacyV4(dir);
    cases.push({ name: 'real legacy v4 (_cfg)', expected: true, actual: r.hasLegacyV4 });
    await fs.remove(dir);
  }

  // Case 4: .hseos/ exists but no _cfg AND no _config (HSEOS source self-host,
  // alpha drop, manual scaffold) → true (warn the user)
  {
    const dir = await mkScratch();
    await fs.ensureDir(path.join(dir, '.hseos', 'workflows'));
    const r = await detector.detectLegacyV4(dir);
    cases.push({ name: 'non-standard .hseos (no markers)', expected: true, actual: r.hasLegacyV4 });
    await fs.remove(dir);
  }

  // Case 5: both _cfg AND _config (mid-migration) → true (we err on the side
  // of warning so the user resolves it explicitly)
  {
    const dir = await mkScratch();
    await fs.ensureDir(path.join(dir, '.hseos', '_cfg'));
    await fs.ensureDir(path.join(dir, '.hseos', '_config'));
    const r = await detector.detectLegacyV4(dir);
    cases.push({ name: 'mid-migration (_cfg + _config)', expected: true, actual: r.hasLegacyV4 });
    await fs.remove(dir);
  }

  let failed = 0;
  for (const c of cases) {
    const ok = c.actual === c.expected;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}: expected=${c.expected} actual=${c.actual}`);
    if (!ok) failed++;
  }

  console.log(`\nDetector legacy v4 tests: ${cases.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((error) => {
  console.error('Test failed:', error && error.stack ? error.stack : error);
  process.exit(2);
});

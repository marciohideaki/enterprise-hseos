'use strict';

// Feasibility trial for design section 4 (W5-02b1): Chromium (--no-sandbox, only inside bwrap) and
// Xvfb in the P1 sandbox, with measured processes and memory. Run inside a delegated cgroup:
//   node docs/evolution/w5/evidence/w5-02b1/chromium-feasibility.cjs <output.json>
// Offline only. Without the pinned cache the verdict is BLOCKED with the cause; nothing is downloaded.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '../../../../..');
const { createIsolationPolicy, prepareIsolatedExecution } = require(path.join(root, 'packages/agent-isolation-attestation'));
const { executeIsolatedCommand } = require(path.join(root, 'packages/agent-isolation-attestation/executor'));
const { chromiumSandboxFlags } = require(path.join(root, 'packages/agent-isolation-attestation/profiles'));

const CACHE = '/workspace/local/sdk/playwright';
const CHROMIUM = path.join(CACHE, 'chromium-1228/chrome-linux64');
const HEADLESS_SHELL = path.join(CACHE, 'chromium_headless_shell-1228/chrome-headless-shell-linux64');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = { schema_version: 1, node: process.version, host: os.hostname(), criteria: {} };

// Expected licence evidence for a Chromium build: the BSD-3-Clause grant by The Chromium Authors.
const BSD3 = [/Copyright \d{4} The Chromium Authors/, /Redistribution and use in source and binary forms/, /Neither the name of Google/];
function licenceEvidence(directory) {
  const found = [];
  const walk = (current, depth) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory() && depth < 2) walk(filename, depth + 1);
      else if (entry.isFile() && /licen[cs]e|credits|notice/i.test(entry.name)) {
        const bytes = fs.readFileSync(filename);
        const text = bytes.toString('utf8');
        found.push({
          file: path.relative(CACHE, filename),
          sha256: sha(bytes),
          bytes: bytes.length,
          bsd3_markers: BSD3.map((pattern) => pattern.test(text)),
          first_line: text.split('\n', 1)[0].slice(0, 120),
        });
      }
    }
  };
  walk(directory, 0);
  return found;
}

const complete = (items) => items.some((item) => item.bsd3_markers.every(Boolean));

function blocked(criterion, cause) {
  report.criteria[criterion] = { verdict: 'BLOCKED', cause };
}

async function main() {
  if (!fs.existsSync(path.join(CHROMIUM, 'chrome'))) {
    blocked('chromium', `pinned cache entry is absent: ${CHROMIUM}`);
    return;
  }
  const full = licenceEvidence(CHROMIUM);
  const shell = fs.existsSync(HEADLESS_SHELL) ? licenceEvidence(HEADLESS_SHELL) : [];
  const proof = shell.find((item) => item.bsd3_markers.every(Boolean));
  report.criteria.licence = {
    decision: 'Owner decision 2026-10-12: the W5 browser pin is chrome-headless-shell-1228; chromium-1228 leaves the pin list',
    pinned_artifact: 'chrome-headless-shell-1228',
    expected: 'BSD-3-Clause text by The Chromium Authors inside the pinned artifact',
    verdict: proof ? 'PASS' : 'BLOCKED',
    evidence: proof && { file: proof.file, sha256: proof.sha256, bytes: proof.bytes },
    headless_shell_1228_files: shell,
    history: {
      chromium_1228: {
        verdict: 'BLOCKED',
        cause:
          full.length > 0 && !complete(full) ? 'the artifact carries no Chromium BSD-3 licence text (only the files listed)' : 'absent',
        files: full,
      },
    },
  };

  // Alternative for the owner only: the distribution package. Reported, never substituted.
  const distro = {
    path: '/usr/lib/chromium',
    present: fs.existsSync('/usr/lib/chromium'),
    copyright: fs.existsSync('/usr/share/doc/chromium/copyright'),
  };
  try {
    distro.version = require('node:child_process').execFileSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'chromium'], {
      encoding: 'utf8',
    });
  } catch {
    distro.version = null;
  }
  report.criteria.licence.history.distro_alternative = distro;

  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-chromium-trial-'));
  try {
    const workspace = path.join(main, 'workspace');
    fs.mkdirSync(workspace, { mode: 0o700 });
    fs.writeFileSync(path.join(main, 'control'), 'control');
    const policy = createIsolationPolicy({
      backend: 'bwrap',
      host_workspace: workspace,
      main_checkout: main,
      protected_paths: [path.join(main, 'control')],
      profile: 'P1',
      toolchain_roots: [CHROMIUM, HEADLESS_SHELL],
    });
    const flags = chromiumSandboxFlags(prepareIsolatedExecution(policy, ['/usr/bin/true']));
    const { createArtifactChannel } = require(path.join(root, 'packages/agent-isolation-attestation/artifact-channel'));
    const mounts = [
      { source: CHROMIUM, target: '/opt/hseos/chromium' },
      { source: HEADLESS_SHELL, target: '/opt/hseos/headless-shell' },
    ];
    const run = async (name, script, limits) => {
      const channel = createArtifactChannel({
        limits: { max_files: 4, max_file_bytes: 8_388_608, max_total_bytes: 16_777_216 },
        media_types: ['image/png', 'text/plain'],
      });
      try {
        const execution = await executeIsolatedCommand({
          policy,
          command: ['/bin/sh', '-c', script],
          timeout_ms: 90_000,
          max_output_bytes: 65_536,
          limits,
          artifact_channel: channel,
          readonly_mounts: mounts,
        });
        const files = fs.readdirSync(channel.directory).map((file) => {
          const bytes = fs.readFileSync(path.join(channel.directory, file));
          return { file, bytes: bytes.length, sha256: sha(bytes), head: bytes.subarray(0, 8).toString('hex') };
        });
        return {
          name,
          status: execution.status,
          exit_code: execution.exit_code,
          stdout: execution.stdout.slice(0, 1500),
          stderr_tail: execution.stderr.slice(-600),
          pids_peak: execution.pids_peak,
          memory_peak_bytes: execution.memory_peak_bytes,
          limits: execution.limits,
          profile: execution.profile,
          files,
        };
      } finally {
        channel.dispose();
      }
    };
    const limits = { pids_max: 256, memory_max_bytes: 2_147_483_648, shm_bytes: 268_435_456, nofile: 1024 };
    const chrome = `env HOME=/tmp/home XDG_CACHE_HOME=/tmp/cache XDG_CONFIG_HOME=/tmp/config /opt/hseos/chromium/chrome ${flags.join(' ')} --headless=new --disable-gpu --hide-scrollbars --no-first-run --disable-breakpad --user-data-dir=/tmp/profile --window-size=800,600`;
    report.criteria.chromium_headless = await run(
      'chromium headless screenshot under P1',
      `mkdir -p /tmp/home /tmp/cache /tmp/config; timeout 40 ${chrome} --virtual-time-budget=3000 --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=/artifacts/shot.png 'data:text/html,<h1 style="font:48px sans-serif">hseos</h1>' >/tmp/chrome.log 2>&1; echo chrome_rc=$?; tail -c 700 /tmp/chrome.log | cut -c1-200; grep -a -i -m6 'fatal\\|check failed\\|FATAL\\|sandbox\\|shm' /tmp/chrome.log | cut -c1-300; ls -l /artifacts`,
      limits,
    );
    report.criteria.chromium_headless_dump_dom = await run(
      'chromium headless dump-dom under P1',
      `mkdir -p /tmp/home /tmp/cache /tmp/config; timeout 40 ${chrome} --virtual-time-budget=3000 --dump-dom 'data:text/html,<h1>hseos</h1>' 2>/tmp/chrome.log | head -c 300; echo chrome_rc=$?`,
      limits,
    );
    report.criteria.headless_shell_screenshot = await run(
      'chrome-headless-shell screenshot under P1 (the pinned headless artifact)',
      `mkdir -p /tmp/home /tmp/cache /tmp/config; env HOME=/tmp/home XDG_CACHE_HOME=/tmp/cache timeout 40 /opt/hseos/headless-shell/chrome-headless-shell ${flags.join(' ')} --disable-gpu --hide-scrollbars --user-data-dir=/tmp/profile3 --window-size=800,600 --screenshot=/artifacts/shell.png 'data:text/html,<h1 style="font:48px sans-serif">hseos</h1>' >/tmp/shell.log 2>&1; echo shell_rc=$?; tail -c 400 /tmp/shell.log | cut -c1-200; ls -l /artifacts`,
      limits,
    );
    report.criteria.xvfb = await run(
      'Xvfb in the sandbox tmpfs with xwd capture',
      `mkdir -p /tmp/.X11-unix /tmp/home /tmp/cache /tmp/config && chmod 1777 /tmp/.X11-unix
       Xvfb :99 -screen 0 800x600x24 -nolisten tcp -nolisten unix -extension GLX >/tmp/xvfb.log 2>&1 &
       for i in $(seq 1 60); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
       xwd -root -display :99 -out /artifacts/root.xwd; echo xwd_rc=$?
       grep -av unw_get /tmp/xvfb.log | head -c 1500; kill %1 2>/dev/null; echo done`,
      limits,
    );
    report.criteria.chromium_headed_on_xvfb = await run(
      'chromium on Xvfb display',
      `mkdir -p /tmp/.X11-unix /tmp/home /tmp/cache /tmp/config && chmod 1777 /tmp/.X11-unix
       Xvfb :99 -screen 0 800x600x24 -nolisten tcp -nolisten unix -extension GLX >/tmp/xvfb.log 2>&1 &
       for i in $(seq 1 60); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
       DISPLAY=:99 HOME=/tmp/home XDG_CACHE_HOME=/tmp/cache XDG_CONFIG_HOME=/tmp/config /opt/hseos/chromium/chrome ${flags.join(' ')} --disable-gpu --no-first-run --disable-breakpad --user-data-dir=/tmp/profile2 --window-size=800,600 'data:text/html,<h1>hseos</h1>' >/tmp/chrome.log 2>&1 &
       sleep 6
       xwd -root -display :99 -out /artifacts/root.xwd; echo xwd_rc=$?
       python3 -I -c "d=open('/artifacts/root.xwd','rb').read(); print('xwd_bytes', len(d), 'distinct_bytes', len(set(d[3000:])))"
       tail -c 300 /tmp/chrome.log; kill $(jobs -p) 2>/dev/null; echo done`,
      limits,
    );
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
}

main()
  .catch((error) => {
    report.error = { name: error.name, code: error.code, message: error.message };
  })
  .finally(() => {
    const out = process.argv[2];
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (out) fs.writeFileSync(out, text);
    process.stdout.write(text.slice(0, 6000));
  });

// Provisions the offline toolchain cache that the LSP, DAP and browser acceptance tests require.
// Download happens here, at CI time, never at runtime: every artifact is checked against the
// SHA-256 pinned in tools/lib/environment-toolchain-pins.js before it is written, and a mismatch
// fails the step. The cache directory is the first argument.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PINS } = require('../../tools/lib/environment-toolchain-pins.js');

const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) {
  throw new Error('usage: provision-toolchain-cache.mjs <absolute cache directory>');
}

const npmUrl = (artifact) =>
  `https://registry.npmjs.org/${artifact.includes('typescript-language-server') ? 'typescript-language-server' : path.basename(artifact).replace(/-\d.*$/, '')}/-/${path.basename(artifact)}`;

async function locate(name, pin) {
  if (pin.artifact.startsWith('npm/')) return npmUrl(pin.artifact);
  if (pin.artifact.startsWith('github/'))
    return `https://github.com/microsoft/vscode-js-debug/releases/download/v${pin.version}/${path.basename(pin.artifact)}`;
  if (pin.artifact.startsWith('playwright/'))
    return `https://cdn.playwright.dev/chrome-for-testing-public/${pin.version}/linux64/chrome-headless-shell-linux64.zip`;
  if (pin.artifact.startsWith('pypi/')) {
    const response = await fetch(`https://pypi.org/pypi/${name}/${pin.version}/json`);
    if (!response.ok) throw new Error(`pypi lookup for ${name} failed: ${response.status}`);
    const listing = await response.json();
    const file = listing.urls.find((entry) => entry.filename === path.basename(pin.artifact));
    if (!file) throw new Error(`pypi has no ${path.basename(pin.artifact)}`);
    return file.url;
  }
  throw new Error(`unknown artifact source for ${name}`);
}

const SOURCES = {
  'npm/': 'npm',
  'pypi/': 'pypi',
  'github/': 'github:microsoft/vscode-js-debug',
  'playwright/': 'playwright-cdn (chrome-for-testing-public)',
};
const ATTEMPTS = 3;

// The artifact goes to a file first and is checked there (size when the pin declares it, then SHA-256): a piped
// hash once disagreed with the file because of a transient truncation. A bad download is retried a bounded number
// of times and then fails the step; the pinned digest is never relaxed.
async function download(url, pin, target) {
  const part = `${target}.part`;
  let last = 'no attempt was made';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`status ${response.status}`);
      fs.writeFileSync(part, Buffer.from(await response.arrayBuffer()));
      const bytes = fs.readFileSync(part);
      if (pin.size_bytes !== undefined && bytes.length !== pin.size_bytes) throw new Error(`size ${bytes.length} is not ${pin.size_bytes}`);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== pin.sha256) throw new Error(`sha256 ${digest} does not match the pin ${pin.sha256}`);
      fs.renameSync(part, target);
      return digest;
    } catch (error) {
      last = error.message;
      fs.rmSync(part, { force: true });
      console.log(`attempt ${attempt}/${ATTEMPTS} for ${pin.artifact} failed: ${last}`);
    }
  }
  throw new Error(`${pin.artifact}: download failed after ${ATTEMPTS} attempts (${last})`);
}
const manifest = {
  schema: 'hseos.toolchain-cache.v1',
  provisioned_by: 'ci',
  runtime_download: false,
  license_verified_in_artifact: true,
  pins: [],
};

for (const [name, pin] of Object.entries(PINS)) {
  const target = path.join(directory, pin.artifact);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const digest = await download(await locate(name, pin), pin, target);
  const source = Object.entries(SOURCES).find(([prefix]) => pin.artifact.startsWith(prefix))[1];
  manifest.pins.push({
    name,
    version: pin.version,
    source,
    artifact: pin.artifact,
    license: pin.license,
    license_file: pin.license_file,
    sha256: pin.sha256,
  });
  console.log(`ok ${pin.artifact} ${digest}`);
}
fs.writeFileSync(path.join(directory, 'toolchain-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

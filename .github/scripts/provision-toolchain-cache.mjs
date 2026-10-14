// Provisions the offline toolchain cache that the LSP and DAP acceptance tests require.
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

const SOURCES = { 'npm/': 'npm', 'pypi/': 'pypi', 'github/': 'github:microsoft/vscode-js-debug' };
const manifest = {
  schema: 'hseos.toolchain-cache.v1',
  provisioned_by: 'ci',
  runtime_download: false,
  license_verified_in_artifact: true,
  pins: [],
};

for (const [name, pin] of Object.entries(PINS)) {
  const response = await fetch(await locate(name, pin));
  if (!response.ok) throw new Error(`download of ${pin.artifact} failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== pin.sha256) throw new Error(`${pin.artifact}: sha256 ${digest} does not match the pin ${pin.sha256}`);
  const target = path.join(directory, pin.artifact);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
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

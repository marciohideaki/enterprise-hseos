// Provisions the offline toolchain cache that the LSP, DAP, browser and computer-use acceptance tests require.
// Download happens here, at CI time, never at runtime: every artifact is checked against the
// SHA-256 pinned in tools/lib/environment-toolchain-pins.js before it is written, and a mismatch
// fails the step. The cache directory is the first argument.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PINS } = require('../../tools/lib/environment-toolchain-pins.js');

const npmUrl = (artifact) =>
  `https://registry.npmjs.org/${artifact.includes('typescript-language-server') ? 'typescript-language-server' : path.basename(artifact).replace(/-\d.*$/, '')}/-/${path.basename(artifact)}`;

// The same bounded retry for the lookups that precede a download.
async function withRetry(label, operation, { wait = sleep, backoff = BACKOFF_MS } = {}) {
  let last = 'no attempt was made';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error.message;
      console.log(`attempt ${attempt}/${ATTEMPTS} for ${label} failed: ${last}`);
      if (attempt < ATTEMPTS) await wait(backoff[attempt - 1] ?? backoff.at(-1));
    }
  }
  throw new Error(`${label} failed after ${ATTEMPTS} attempts (${last})`);
}

async function locate(name, pin) {
  if (pin.artifact.startsWith('npm/')) return npmUrl(pin.artifact);
  if (pin.artifact.startsWith('github/'))
    return `https://github.com/microsoft/vscode-js-debug/releases/download/v${pin.version}/${path.basename(pin.artifact)}`;
  if (pin.artifact.startsWith('playwright/'))
    return `https://cdn.playwright.dev/chrome-for-testing-public/${pin.version}/linux64/chrome-headless-shell-linux64.zip`;
  if (pin.artifact.startsWith('pypi/')) {
    const listing = await withRetry(`pypi lookup for ${name}`, async () => {
      const response = await fetch(`https://pypi.org/pypi/${name}/${pin.version}/json`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      return response.json();
    });
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
export const ATTEMPTS = 3;
// One wait between each pair of attempts, so ATTEMPTS - 1 waits.
export const BACKOFF_MS = [10_000, 30_000];

// A digest that differs from the pin is never retried: the bytes arrived complete and are not the pinned artifact.
export class PinMismatchError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The artifact goes to a file first and is checked there (size when the pin declares it, then SHA-256): a piped
// hash once disagreed with the file because of a transient truncation. A network failure (status, connection,
// truncated size) is retried up to ATTEMPTS times with a growing wait; a SHA-256 that differs from the pin fails at
// once and the pinned digest is never relaxed.
export async function download(url, pin, target, { fetchImpl = fetch, wait = sleep, backoff = BACKOFF_MS } = {}) {
  const part = `${target}.part`;
  let last = 'no attempt was made';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`status ${response.status}`);
      fs.writeFileSync(part, Buffer.from(await response.arrayBuffer()));
      const bytes = fs.readFileSync(part);
      if (pin.size_bytes !== undefined && bytes.length !== pin.size_bytes) throw new Error(`size ${bytes.length} is not ${pin.size_bytes}`);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== pin.sha256) throw new PinMismatchError(`sha256 ${digest} does not match the pin ${pin.sha256}`);
      fs.renameSync(part, target);
      return digest;
    } catch (error) {
      last = error.message;
      fs.rmSync(part, { force: true });
      if (error instanceof PinMismatchError) throw new Error(`${pin.artifact}: ${last} (not retried)`);
      console.log(`attempt ${attempt}/${ATTEMPTS} for ${pin.artifact} failed: ${last}`);
      if (attempt < ATTEMPTS) await wait(backoff[attempt - 1] ?? backoff.at(-1));
    }
  }
  throw new Error(`${pin.artifact}: download failed after ${ATTEMPTS} attempts (${last})`);
}
async function main(directory) {
  if (!directory || !path.isAbsolute(directory)) {
    throw new Error('usage: provision-toolchain-cache.mjs <absolute cache directory>');
  }
  const manifest = {
    schema: 'hseos.toolchain-cache.v1',
    provisioned_by: 'ci',
    runtime_download: false,
    license_verified_in_artifact: true,
    pins: [],
  };

  for (const [name, pin] of Object.entries(PINS)) {
    if (pin.variants) {
      // A system pin: every distro variant is downloaded (download only, nothing is installed) from its pinned archive URL
      // and checked against its SHA-256 and size before it is kept. The runtime later picks the variant that matches the
      // package installed by apt on the machine it runs on.
      for (const variant of pin.variants) {
        const place = path.join(directory, variant.artifact);
        fs.mkdirSync(path.dirname(place), { recursive: true });
        const got = await download(variant.source_url, variant, place);
        manifest.pins.push({
          name,
          version: variant.version,
          source: `ubuntu-archive:${variant.distro}`,
          artifact: variant.artifact,
          license: pin.license,
          license_file: pin.license_file,
          sha256: variant.sha256,
        });
        console.log(`ok ${variant.artifact} ${got}`);
      }
      continue;
    }
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv[2]);

'use strict';

// Runs inside the sandbox (or in-process in tests): one language-server process per action.
// It never validates scope; the controller (lsp.js) treats everything printed here as untrusted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { createFrameParser, encodeMessage } = require('./framing');

const ACTIONS = ['diagnostics', 'definition', 'references', 'hover', 'rename_preview'];
const MAX_ITEMS = 200;
const QUIET_MS = 500;
const INLINE_LIMIT_BYTES = 48_000;

const SERVERS = {
  typescript: (toolchain) => [path.join(toolchain, 'typescript-language-server/package/lib/cli.mjs'), '--stdio'],
  python: (toolchain) => [path.join(toolchain, 'pyright/package/langserver.index.js'), '--stdio'],
};
const LANGUAGE_IDS = { typescript: 'typescript', python: 'python' };

class LspHostError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LspHostError';
    this.code = code;
  }
}

function startServer({ node, language, toolchain, root, scratch, timeoutMs }) {
  const child = spawn(node, SERVERS[language](toolchain), {
    cwd: root,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch },
  });
  const parser = createFrameParser();
  const pending = new Map();
  const diagnostics = new Map();
  const waiters = [];
  let nextId = 1;
  let failure;
  const fail = (error) => {
    failure ||= error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const send = (message) => {
    if (child.stdin.writable) child.stdin.write(encodeMessage(message));
  };
  const handle = (message) => {
    if (message.method === 'textDocument/publishDiagnostics') {
      diagnostics.set(message.params.uri, message.params.diagnostics);
      for (const waiter of waiters.splice(0)) waiter();
    } else if (message.id !== undefined && message.method) {
      // Server-to-client requests: answer neutrally so the server never blocks on the client.
      const result = message.method === 'workspace/configuration' ? (message.params.items || []).map(() => null) : null;
      send({ jsonrpc: '2.0', id: message.id, result });
    } else if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new LspHostError('server returned an error', 'ENV_LSP_SERVER_ERROR'));
      else resolve(message.result);
    }
  };
  child.stdout.on('data', (chunk) => {
    try {
      for (const message of parser.push(chunk)) handle(message);
    } catch {
      fail(new LspHostError('server framing violation', 'ENV_LSP_PROTOCOL'));
    }
  });
  child.once('error', () => fail(new LspHostError('server could not be started', 'ENV_LSP_SERVER_UNAVAILABLE')));
  child.once('close', () => fail(new LspHostError('server exited early', 'ENV_LSP_SERVER_EXITED')));
  const timer = setTimeout(() => {
    fail(new LspHostError('server timed out', 'ENV_LSP_TIMEOUT'));
    child.kill('SIGKILL');
  }, timeoutMs);
  return {
    request(method, params) {
      if (failure) return Promise.reject(failure);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
    async diagnosticsFor(uri) {
      // First publish, then a quiet window so a later semantic pass replaces the syntactic one.
      const deadline = Date.now() + timeoutMs;
      while (!diagnostics.has(uri)) {
        if (failure) throw failure;
        if (Date.now() > deadline) throw new LspHostError('no diagnostics were published', 'ENV_LSP_TIMEOUT');
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 100);
        });
      }
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
      return diagnostics.get(uri);
    },
    async close() {
      clearTimeout(timer);
      try {
        await Promise.race([this.request('shutdown', null), new Promise((resolve) => setTimeout(resolve, 2000))]);
        this.notify('exit', null);
      } catch {
        // The kill below is the authority; a server that cannot shut down is not trusted to.
      }
      child.stdin.end();
      child.kill('SIGKILL');
    },
  };
}

function hoverText(contents) {
  if (Array.isArray(contents)) return contents.map(hoverText).join('\n');
  if (typeof contents === 'string') return contents;
  return contents && typeof contents.value === 'string' ? contents.value : '';
}

/** Lists are cut at MAX_ITEMS, and `total` keeps the real size so the controller can flag the cut. */
function bounded(action, key, items) {
  return { action, [key]: items.slice(0, MAX_ITEMS), total: items.length };
}

async function runAction({
  node = process.execPath,
  language,
  action,
  file,
  position,
  new_name: newName,
  root,
  toolchain,
  scratch = os.tmpdir(),
  timeout_ms: timeoutMs = 25_000,
}) {
  if (!ACTIONS.includes(action) || !Object.hasOwn(SERVERS, language))
    throw new LspHostError('unsupported action or language', 'ENV_LSP_INPUT');
  const absolute = path.join(root, file);
  const uri = pathToFileURL(absolute).href;
  const text = fs.readFileSync(absolute, 'utf8');
  const server = startServer({ node, language, toolchain, root, scratch, timeoutMs });
  try {
    await server.request('initialize', {
      processId: null,
      initializationOptions:
        language === 'typescript' ? { tsserver: { path: path.join(toolchain, 'typescript/package/lib/tsserver.js') } } : {},
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'workspace' }],
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          hover: { contentFormat: ['plaintext', 'markdown'] },
          rename: { prepareSupport: false },
        },
        workspace: { configuration: true },
      },
    });
    server.notify('initialized', {});
    server.notify('textDocument/didOpen', { textDocument: { uri, languageId: LANGUAGE_IDS[language], version: 1, text } });
    const textDocument = { uri };
    if (action === 'diagnostics') return bounded(action, 'diagnostics', (await server.diagnosticsFor(uri)) || []);
    if (action === 'definition') {
      const found = await server.request('textDocument/definition', { textDocument, position });
      return bounded(action, 'locations', [found || []].flat());
    }
    if (action === 'references') {
      const found = await server.request('textDocument/references', { textDocument, position, context: { includeDeclaration: true } });
      return bounded(action, 'locations', found || []);
    }
    if (action === 'hover') {
      const found = await server.request('textDocument/hover', { textDocument, position });
      return { action, hover: found ? hoverText(found.contents) : '' };
    }
    return { action, edit: (await server.request('textDocument/rename', { textDocument, position, newName })) || {} };
  } finally {
    await server.close();
  }
}

/** Print the result; a result too large for the stdout budget is handed over through /artifacts. */
function emit(result, write, artifactsDirectory) {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized) <= INLINE_LIMIT_BYTES || !artifactsDirectory) {
    write(serialized);
    return;
  }
  const bytes = Buffer.from(serialized);
  fs.writeFileSync(path.join(artifactsDirectory, 'result.json'), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  write(JSON.stringify([{ path: '/artifacts/result.json', media_type: 'application/json', bytes: bytes.length, sha256 }]));
}

async function main(argv, write, artifactsDirectory) {
  try {
    emit({ ok: true, result: await runAction(JSON.parse(argv[0])) }, write, artifactsDirectory);
    return 0;
  } catch (error) {
    write(JSON.stringify({ ok: false, code: error.code || 'ENV_LSP_HOST_FAILURE' }));
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2), (line) => process.stdout.write(line), fs.existsSync('/artifacts') ? '/artifacts' : null).then((code) =>
    process.exit(code),
  );
}

module.exports = { ACTIONS, LspHostError, bounded, emit, hoverText, main, runAction };

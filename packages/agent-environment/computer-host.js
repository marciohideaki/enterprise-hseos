'use strict';

// Runs inside the P1 sandbox as the one long-lived job of a computer-use session: a private Xvfb, the GUI target and
// a line protocol on stdin/stdout. The controller (computer.js) treats everything printed here as untrusted. The
// operator's display cannot be reached from in here: the sandbox has its own network namespace and its own /tmp.
const fs = require('node:fs');
const net = require('node:net');
const zlib = require('node:zlib');
const childProcess = require('node:child_process');
const { LIMITS, parseAction, sha256 } = require('./computer-contract');

const XVFB = '/usr/bin/Xvfb';
const XDOTOOL = '/usr/bin/xdotool';
const XWD = '/usr/bin/xwd';
// Only these reach a child: the operator's DISPLAY, XAUTHORITY, WAYLAND_DISPLAY and XDG_RUNTIME_DIR never do.
const BASE_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/tmp', LANG: 'C' });
const FIRST_DISPLAY = 99;
const READY_ATTEMPTS = 50;
const READY_STEP_MS = 100;
const WINDOW_ATTEMPTS = 30;
const PAINT_ATTEMPTS = 30;
const TOOL_TIMEOUT_MS = 8000;
const OUTPUT_RESERVE_BYTES = 4096;
const XWD_HEADER_FIELDS = 25;
const XWD_MAX_BYTES = 4_194_304;
const DISPLAY_NAME = /^:[0-9]{1,3}(?:\.[0-9]{1,2})?$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class HostError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'HostError';
    this.code = code;
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let value = 0xff_ff_ff_ff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** PNG from 8-bit RGB. A picture of at most 256 colours becomes an indexed PNG: far smaller, and screens are mostly flat. */
function encodePng(width, height, rgb) {
  const palette = new Map();
  for (let at = 0; at < rgb.length && palette.size <= 256; at += 3) {
    const key = (rgb[at] << 16) | (rgb[at + 1] << 8) | rgb[at + 2];
    if (!palette.has(key)) palette.set(key, palette.size);
  }
  const indexed = palette.size <= 256;
  const stride = indexed ? width : width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const out = row * (stride + 1) + 1;
    for (let column = 0; column < width; column += 1) {
      const at = (row * width + column) * 3;
      if (indexed) raw[out + column] = palette.get((rgb[at] << 16) | (rgb[at + 1] << 8) | rgb[at + 2]);
      else rgb.copy(raw, out + column * 3, at, at + 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = indexed ? 3 : 2;
  const parts = [PNG_SIGNATURE, chunk('IHDR', header)];
  if (indexed) {
    const table = Buffer.alloc(palette.size * 3);
    for (const [key, index] of palette) table.set([(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff], index * 3);
    parts.push(chunk('PLTE', table));
  }
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function maskShift(mask) {
  let shift = 0;
  while (mask > 0 && (mask >>> shift) % 2 === 0) shift += 1;
  return shift;
}

/** Decode the XWD that `xwd -root` prints (32 bits per pixel, TrueColor) into PNG. Anything else is refused. */
function xwdToPng(bytes, limits = LIMITS) {
  const fail = (message) => {
    throw new HostError(message, 'ENV_COMPUTER_SCREENSHOT_FAILED');
  };
  if (!Buffer.isBuffer(bytes) || bytes.length < XWD_HEADER_FIELDS * 4 || bytes.length > XWD_MAX_BYTES)
    fail('xwd output has an unusable size');
  const field = (index) => bytes.readUInt32BE(index * 4);
  const header = {
    headerSize: field(0),
    version: field(1),
    depth: field(3),
    width: field(4),
    height: field(5),
    order: field(7),
    bitsPerPixel: field(11),
    bytesPerLine: field(12),
    redMask: field(14),
    greenMask: field(15),
    blueMask: field(16),
    colors: field(18),
  };
  const { headerSize, version, depth, width, height, order, bitsPerPixel, bytesPerLine, redMask, greenMask, blueMask, colors } = header;
  if (version !== 7 || bitsPerPixel !== 32 || ![24, 32].includes(depth)) fail('xwd format is not 32-bit TrueColor');
  if (width < limits.min_width || width > limits.max_width || height < limits.min_height || height > limits.max_height)
    fail('xwd size is outside the display limits');
  const offset = headerSize + colors * 12;
  if (headerSize < XWD_HEADER_FIELDS * 4 || bytesPerLine < width * 4 || bytes.length < offset + bytesPerLine * height)
    fail('xwd payload is truncated');
  const shifts = [redMask, greenMask, blueMask].map(maskShift);
  const rgb = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const at = offset + row * bytesPerLine + column * 4;
      const pixel = order === 0 ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
      const out = (row * width + column) * 3;
      rgb[out] = (pixel & redMask) >>> shifts[0];
      rgb[out + 1] = (pixel & greenMask) >>> shifts[1];
      rgb[out + 2] = (pixel & blueMask) >>> shifts[2];
    }
  }
  return { png: encodePng(width, height, rgb), width, height };
}

/** True once the capture holds more than one colour. A mapped window is blank until its client has handled the first Expose. */
function xwdDrawn(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < XWD_HEADER_FIELDS * 4) return false;
  const field = (index) => bytes.readUInt32BE(index * 4);
  const [width, height, order, bytesPerLine] = [field(4), field(5), field(7), field(12)];
  const offset = field(0) + field(18) * 12;
  if (bytesPerLine < width * 4 || bytes.length < offset + bytesPerLine * height) return false;
  const mask = (field(14) | field(15) | field(16)) >>> 0;
  const read = (at) => ((order === 0 ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at)) & mask) >>> 0;
  const first = read(offset);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (read(offset + row * bytesPerLine + column * 4) !== first) return true;
    }
  }
  return false;
}

/** The xdotool command line for one validated action. No shell, no string is ever interpreted. */
function xdotoolArguments(action, args) {
  switch (action) {
    case 'move': {
      return ['mousemove', String(args.x), String(args.y)];
    }
    case 'click': {
      return ['mousemove', String(args.x), String(args.y), 'click', String(args.button)];
    }
    case 'double_click': {
      return ['mousemove', String(args.x), String(args.y), 'click', '--repeat', '2', '--delay', '80', '1'];
    }
    case 'type': {
      return ['type', '--delay', '12', '--', args.text];
    }
    case 'key': {
      return ['key', '--', args.key];
    }
    case 'scroll': {
      return ['click', '--repeat', String(args.amount), '--delay', '20', args.direction === 'up' ? '4' : '5'];
    }
    default: {
      throw new HostError('action has no input mapping', 'ENV_COMPUTER_ACTION_FAILED');
    }
  }
}

/** A display name that is neither refused nor the operator's: the namespace is private, the number is only a name. */
function pickDisplay(deny = []) {
  const taken = new Set(deny.filter((name) => DISPLAY_NAME.test(name)).map((name) => Number(name.slice(1).split('.')[0])));
  let number = FIRST_DISPLAY;
  while (taken.has(number)) number -= 1;
  return `:${number}`;
}

/**
 * Can this process connect to the abstract X socket of `name` (":0")? No X protocol, so no cookie is needed: a display
 * that demands authorization still answers a plain connect, which is what makes this probe a real test of reachability.
 */
function abstractSocketReachable(name) {
  return new Promise((resolve) => {
    const socket = net.connect({ path: `\0/tmp/.X11-unix/X${name.slice(1).split('.')[0]}` });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function createHost({
  spawn = childProcess.spawn,
  spawnSync = childProcess.spawnSync,
  fsApi = fs,
  connect = abstractSocketReachable,
  emit,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  limits = LIMITS,
} = {}) {
  let written = 0;
  let display = null;
  let size = null;
  let env = null;
  let xvfb = null;
  let target = null;
  let screenshots = 0;
  const out = (value) => {
    const line = `${JSON.stringify(value)}\n`;
    written += Buffer.byteLength(line);
    emit(line);
  };
  const tool = (binary, args) => spawnSync(binary, args, { env, timeout: TOOL_TIMEOUT_MS, maxBuffer: XWD_MAX_BYTES });

  /** The operator's display must be unreachable from in here. Reaching it breaks the session before anything runs. */
  async function assertIsolation(deny) {
    for (const name of deny) {
      const probe = spawnSync(XDOTOOL, ['getdisplaygeometry'], { env: { ...BASE_ENV, DISPLAY: name }, timeout: TOOL_TIMEOUT_MS });
      if ((await connect(name)) || probe.status === 0) {
        throw new HostError('the operator display is reachable from the sandbox', 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN');
      }
    }
    const sockets = fsApi.existsSync('/tmp/.X11-unix') ? fsApi.readdirSync('/tmp/.X11-unix') : [];
    if (sockets.length > 0) throw new HostError('a filesystem X socket exists in the sandbox', 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN');
    return sockets;
  }

  async function start(request) {
    const deny = (request.deny_displays ?? []).filter((name) => typeof name === 'string' && DISPLAY_NAME.test(name));
    const sockets = await assertIsolation(deny);
    display = pickDisplay(deny);
    size = request.display;
    env = Object.freeze({ ...BASE_ENV, DISPLAY: display });
    // GLX is off because the software GL path of some hosts aborts the server; the socket is abstract (private namespace).
    xvfb = spawn(
      XVFB,
      [display, '-nolisten', 'tcp', '-nolisten', 'unix', '-extension', 'GLX', '-screen', '0', `${size.width}x${size.height}x24`],
      {
        env: BASE_ENV,
        stdio: 'ignore',
      },
    );
    let xvfbGone = false;
    xvfb.once('exit', () => {
      xvfbGone = true;
    });
    xvfb.once('error', () => {
      xvfbGone = true;
    });
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      if (xvfbGone) throw new HostError('Xvfb exited before the display was ready', 'ENV_COMPUTER_UNAVAILABLE');
      if (tool(XDOTOOL, ['getdisplaygeometry']).status === 0) break;
      if (attempt === READY_ATTEMPTS - 1) throw new HostError('the display did not become ready', 'ENV_COMPUTER_UNAVAILABLE');
      await sleep(READY_STEP_MS);
    }
    target = spawn(request.target.command, request.target.args, { env, stdio: 'ignore' });
    target.once('error', () => {});
    // The first screenshot should show the target, not the empty root: wait (bounded) for its first visible window.
    let windowShown = false;
    for (let attempt = 0; attempt < WINDOW_ATTEMPTS && !windowShown; attempt += 1) {
      const found = tool(XDOTOOL, ['search', '--onlyvisible', '--name', '.']);
      windowShown = found.status === 0 && found.stdout?.length > 0;
      if (!windowShown) await sleep(READY_STEP_MS);
    }
    // The window is mapped before its client has drawn it, and a screenshot of the blank root is no use to the model:
    // wait (bounded) until the root shows more than one colour. A target that never draws still starts.
    if (windowShown) {
      for (let attempt = 0; attempt < PAINT_ATTEMPTS; attempt += 1) {
        const capture = tool(XWD, ['-root', '-silent']);
        if (capture.status === 0 && xwdDrawn(capture.stdout)) break;
        await sleep(READY_STEP_MS);
      }
    }
    out({ event: 'ready', display: { width: size.width, height: size.height }, sockets, target_window: windowShown });
  }

  function screenshot(seq) {
    if (screenshots >= limits.max_screenshots) throw new HostError('screenshot quota is spent', 'ENV_COMPUTER_SCREENSHOT_QUOTA');
    const capture = tool(XWD, ['-root', '-silent']);
    if (capture.status !== 0 || !Buffer.isBuffer(capture.stdout)) throw new HostError('xwd failed', 'ENV_COMPUTER_SCREENSHOT_FAILED');
    const { png, width, height } = xwdToPng(capture.stdout, limits);
    if (png.length > limits.max_screenshot_bytes)
      throw new HostError('screenshot exceeds its size ceiling', 'ENV_COMPUTER_SCREENSHOT_TOO_LARGE');
    const encoded = png.toString('base64');
    // The session's whole output is capped by the terminal broker: never start a line that would be cut in half.
    if (written + encoded.length + OUTPUT_RESERVE_BYTES > limits.max_output_bytes) {
      throw new HostError('session output budget is spent', 'ENV_COMPUTER_OUTPUT_BUDGET');
    }
    screenshots += 1;
    return { width, height, bytes: png.length, sha256: sha256(png), png_base64: encoded, seq };
  }

  function perform(message) {
    const parsed = parseAction({ action: message.action, ...message.args }, size);
    if (!parsed.success) throw new HostError(parsed.error.issues[0].message, 'ENV_COMPUTER_INPUT_INVALID');
    const { action, args } = parsed.data;
    if (action === 'screenshot') return screenshot(message.seq);
    const run = tool(XDOTOOL, xdotoolArguments(action, args));
    if (run.status !== 0) throw new HostError(`${action} was not delivered`, 'ENV_COMPUTER_ACTION_FAILED');
    return { seq: message.seq };
  }

  /** One request per line. A failure is a result, never a crash: the session stays open until it is stopped. */
  function handle(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      out({ event: 'result', seq: null, ok: false, code: 'ENV_COMPUTER_INPUT_INVALID' });
      return;
    }
    if (message?.op === 'stop') {
      stop();
      return;
    }
    try {
      if (!Number.isSafeInteger(message?.seq)) throw new HostError('request has no sequence', 'ENV_COMPUTER_INPUT_INVALID');
      const done = perform(message);
      out({ event: 'result', ok: true, action: message.action, target_alive: target?.exitCode === null, ...done });
    } catch (error) {
      const code = error instanceof HostError ? error.code : 'ENV_COMPUTER_ACTION_FAILED';
      out({ event: 'result', seq: Number.isSafeInteger(message?.seq) ? message.seq : null, ok: false, code });
    }
  }

  function stop() {
    for (const child of [target, xvfb]) {
      if (child && child.exitCode === null) child.kill('SIGKILL');
    }
    out({ event: 'stopped' });
  }

  return Object.freeze({ start, handle, stop, written: () => written });
}

/** Process entry: argv[2] is the session request; stdin carries one JSON request per line until `stop` or EOF. */
async function main({
  argv = process.argv,
  stdin = process.stdin,
  stdout = process.stdout,
  exit = (code) => process.exit(code),
  host,
} = {}) {
  const emit = (line) => stdout.write(line);
  const session = host ?? createHost({ emit });
  let buffer = '';
  let stopped = false;
  const finish = (code) => {
    if (!stopped) {
      stopped = true;
      session.stop();
    }
    exit(code);
  };
  try {
    await session.start(JSON.parse(argv[2]));
  } catch (error) {
    emit(`${JSON.stringify({ event: 'error', code: error instanceof HostError ? error.code : 'ENV_COMPUTER_UNAVAILABLE' })}\n`);
    return finish(1);
  }
  stdin.on('data', (data) => {
    buffer += data.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.includes('"op":"stop"')) {
        stopped = true;
        session.handle(line);
        return exit(0);
      }
      session.handle(line);
    }
  });
  stdin.on('end', () => finish(0));
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = {
  HostError,
  abstractSocketReachable,
  XDOTOOL,
  XVFB,
  XWD,
  PAINT_ATTEMPTS,
  createHost,
  xwdDrawn,
  crc32,
  encodePng,
  main,
  pickDisplay,
  xdotoolArguments,
  xwdToPng,
};

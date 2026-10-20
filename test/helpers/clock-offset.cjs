'use strict';

// Test-only advanced clock. Loaded with `node -r` (or NODE_OPTIONS=--require) it shifts the real clock
// by HSEOS_TEST_CLOCK_OFFSET_DAYS so tests that pin absolute dates (2026-*) while production code reads
// the wall clock (age windows, TTL, leases, expiry) fail loudly instead of rotting silently.
//
// Shifted: Date.now(), new Date() without arguments, Date() called as a function, and SQLite
// 'now' time values (better-sqlite3 prepare/exec/pragma SQL is rewritten to 'now','+N days').
// NOT shifted: performance.now()/process.hrtime (monotonic), file mtimes, timers, subprocesses that
// are not Node (they inherit the env but not the preload), and SQL built by other drivers.

const days = Number(process.env.HSEOS_TEST_CLOCK_OFFSET_DAYS || 0);
if (!Number.isFinite(days)) throw new Error('HSEOS_TEST_CLOCK_OFFSET_DAYS must be numeric');

if (days !== 0 && !globalThis.__hseosClockOffsetInstalled) {
  globalThis.__hseosClockOffsetInstalled = true;
  const offsetMs = days * 86_400_000;
  const RealDate = Date;
  const shiftedNow = () => RealDate.now() + offsetMs;

  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      args.length === 0 ? Reflect.construct(target, [shiftedNow()], newTarget) : Reflect.construct(target, args, newTarget),
    apply: () => new RealDate(shiftedNow()).toString(),
    get: (target, prop, receiver) => (prop === 'now' ? shiftedNow : Reflect.get(target, prop, receiver)),
  });

  // Patch better-sqlite3 lazily, on first load, so the preload never adds modules to a process that
  // does not use it (some tests assert the exact set of loaded modules).
  const Module = require('node:module');
  const modifier = `'now','${days >= 0 ? '+' : '-'}${Math.abs(days)} days'`;
  const rewrite = (sql) => (typeof sql === 'string' ? sql.replaceAll(/'now'/gi, modifier) : sql);
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    const exported = originalLoad.call(this, request, parent, isMain);
    if (request === 'better-sqlite3' && exported && exported.prototype && !exported.prototype.__hseosClockPatched) {
      for (const method of ['prepare', 'exec']) {
        const original = exported.prototype[method];
        exported.prototype[method] = function patched(sql, ...rest) {
          return original.call(this, rewrite(sql), ...rest);
        };
      }
      Object.defineProperty(exported.prototype, '__hseosClockPatched', { value: true });
    }
    return exported;
  };
}

// Leave no trace in require.cache: tests assert the exact modules a probe process loaded.
delete require.cache[__filename];

'use strict';

// Test-only preload for spawned legacy MCP servers (`node -r`). Legacy compatibility ends at the
// 2026-11-30 sunset by the wall clock, so a server child that must still answer legacy clients is started
// inside the window. Time keeps flowing from the pinned base (monotonic elapsed time), so it is immune to
// the real date and to any other clock-shifting preload. Production code reads nothing new.
//
// Only the JS Date is pinned. SQLite datetime('now') in the child still follows the real date. Today the
// heartbeat/stale comparisons in the legacy servers are SQL-vs-SQL, so this is safe; a comparison between a
// JS timestamp and a SQL timestamp inside the child would break under this preload.
//
// HSEOS_TEST_LEGACY_CLOCK_BASE (test-only, read by this preload and never by production) overrides the
// pinned instant, e.g. a date after the sunset to prove the real process refuses legacy clients.

const BASE = Date.parse(process.env.HSEOS_TEST_LEGACY_CLOCK_BASE || '2026-08-21T12:00:00.000Z');
if (!Number.isFinite(BASE)) throw new Error('HSEOS_TEST_LEGACY_CLOCK_BASE must be an ISO date');
const START = performance.now();
const pinnedNow = () => BASE + Math.round(performance.now() - START);
const RealDate = Date;

globalThis.Date = new Proxy(RealDate, {
  construct: (target, args, newTarget) =>
    args.length === 0 ? Reflect.construct(target, [pinnedNow()], newTarget) : Reflect.construct(target, args, newTarget),
  apply: () => new RealDate(pinnedNow()).toString(),
  get: (target, prop, receiver) => (prop === 'now' ? pinnedNow : Reflect.get(target, prop, receiver)),
});

// Leave no trace in require.cache: tests assert the exact modules a probe process loaded.
delete require.cache[__filename];

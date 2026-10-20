'use strict';

// Test-only preload for spawned legacy MCP servers (`node -r`). Legacy compatibility ends at the
// 2026-11-30 sunset by the wall clock, so a server child that must still answer legacy clients is started
// inside the window. Time keeps flowing from the pinned base (monotonic elapsed time), so it is immune to
// the real date and to any other clock-shifting preload. Production code reads nothing new.

const BASE = Date.parse('2026-08-21T12:00:00.000Z');
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

'use strict';

// Bounded per-peer, per-scope rate limiting (design.md admission-sequence step 5). "Bounded
// source cardinality" (T10 constraint) means the tracked-key map itself can never grow without
// limit: an attacker who can vary their claimed identity (a spoofed X-Forwarded-For, if ever
// trusted, or simply many distinct real source addresses) must not be able to exhaust server
// memory by forcing this module to track ever more distinct keys. The map evicts its oldest
// entry, by insertion order, whenever it would otherwise grow past maxTrackedKeys -- a bounded
// LRU, not an unbounded ledger.

const DEFAULT_MAX_TRACKED_KEYS = 10_000;
const WINDOW_MS = 60_000;

function createRateLimiter({ limitsByScope, maxTrackedKeys = DEFAULT_MAX_TRACKED_KEYS, now = () => Date.now() } = {}) {
  if (!limitsByScope || typeof limitsByScope !== 'object' || Array.isArray(limitsByScope)) {
    throw new TypeError('limitsByScope is required');
  }
  const scopes = Object.keys(limitsByScope);
  if (scopes.length === 0) throw new TypeError('limitsByScope must declare at least one scope');
  for (const scope of scopes) {
    const limit = limitsByScope[scope];
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100_000) {
      throw new TypeError(`rate limit for scope "${scope}" must be a positive bounded integer`);
    }
  }
  if (!Number.isInteger(maxTrackedKeys) || maxTrackedKeys <= 0) throw new TypeError('maxTrackedKeys must be a positive integer');

  const windows = new Map();

  return Object.freeze({
    check(scope, key) {
      const limit = limitsByScope[scope];
      if (!Number.isInteger(limit)) throw new TypeError(`unknown rate-limit scope: ${scope}`);
      if (typeof key !== 'string' || key.length === 0 || key.length > 512) throw new TypeError('rate-limit key is invalid');
      const trackingKey = `${scope}:${key}`;
      const timestamp = now();
      const existing = windows.get(trackingKey);
      const fresh = !existing || timestamp - existing.start >= WINDOW_MS;
      const count = (fresh ? 0 : existing.count) + 1;
      // Delete-then-set so the key moves to the most-recently-used end of Map's insertion order,
      // making "oldest key" == "least recently active" for eviction below.
      windows.delete(trackingKey);
      windows.set(trackingKey, { start: fresh ? timestamp : existing.start, count });
      while (windows.size > maxTrackedKeys) {
        windows.delete(windows.keys().next().value);
      }
      return Object.freeze({ allowed: count <= limit, remaining: Math.max(0, limit - count) });
    },
    get trackedKeyCount() {
      return windows.size;
    },
  });
}

module.exports = { DEFAULT_MAX_TRACKED_KEYS, WINDOW_MS, createRateLimiter };

'use strict';
// Campaign preload: composes the SHARED fetch guard with the local tunnel origin without editing the guard.
// The shared guard only recognises api.openai.com and mock.invalid. Here the inner "real" fetch is a mapper that rewrites the
// guard's https://api.openai.com/ URLs to F17_ORIGIN and refuses everything else, so no request can reach a paid provider.
const ORIGIN = process.env.F17_ORIGIN;
if (!ORIGIN || !/^http:\/\/127\.0\.0\.1:\d+$/.test(ORIGIN)) throw new Error('F17_ORIGIN must be the local tunnel');
const net = globalThis.fetch;
const OPENAI = 'https://api.openai.com/';
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith(OPENAI)) throw new Error('blocked-non-local-origin');
  return net(ORIGIN + '/' + u.slice(OPENAI.length), init);
};
require('../shared/fetch-guard.cjs');
const guarded = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = String(url);
  if (u.startsWith(ORIGIN + '/')) return guarded(OPENAI + u.slice(ORIGIN.length + 1), init);
  return guarded(url, init);
};

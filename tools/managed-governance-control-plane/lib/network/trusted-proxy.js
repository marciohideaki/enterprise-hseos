'use strict';

const { buildAllowlist, ipFamily } = require('./ip');

// design.md's admission sequence, step 3: "Derive the peer from the socket. Forwarding headers
// have no authority unless the direct peer is in trusted_proxies; ambiguous forwarding chains
// fail closed." T09's raw-socket admission runs before any HTTP header exists, so it can only
// ever see the direct TCP peer -- the one topology it cannot see is "client -> trusted reverse
// proxy -> server", where every direct connection legitimately comes from the proxy's own fixed
// address. This module runs at the HTTP layer (headers are parsed by then) and answers a
// narrower, harder question: for THIS request, whose address should audit and rate-limiting
// attribute it to? An untrusted intermediary's X-Forwarded-For claim is never honored -- not
// partially trusted, not used as a fallback, just ignored outright (FR-023, "Untrusted
// forwarding headers ignored").

class AmbiguousForwardingChainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AmbiguousForwardingChainError';
  }
}

function resolveClientAddress({ directPeer, forwardedForHeader, trustedProxyCidrs }) {
  if (typeof directPeer !== 'string' || ipFamily(directPeer) === null) {
    throw new AmbiguousForwardingChainError('direct peer address is invalid');
  }
  if (!Array.isArray(trustedProxyCidrs) || trustedProxyCidrs.length === 0) {
    return Object.freeze({ address: directPeer, trusted: false });
  }
  const trustedAllowlist = buildAllowlist(trustedProxyCidrs);
  if (!trustedAllowlist.matches(directPeer)) {
    // The direct peer is not a trusted proxy: any X-Forwarded-For it sent is a claim from an
    // untrusted party about its own upstream, and is discarded without inspection.
    return Object.freeze({ address: directPeer, trusted: false });
  }
  if (forwardedForHeader === undefined || forwardedForHeader === null) {
    return Object.freeze({ address: directPeer, trusted: false });
  }
  // Node folds repeated headers into an array; more than one X-Forwarded-For header is itself
  // an ambiguous chain, never merged or first-wins.
  if (Array.isArray(forwardedForHeader)) {
    throw new AmbiguousForwardingChainError('more than one X-Forwarded-For header was supplied');
  }
  if (typeof forwardedForHeader !== 'string') {
    throw new AmbiguousForwardingChainError('X-Forwarded-For header is malformed');
  }
  const hops = forwardedForHeader
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  // Only the single-hop "one trusted proxy in front of the server" topology design.md documents
  // is supported. A multi-hop chain cannot be resolved without knowing whether every
  // intermediate hop is also trusted, so it fails closed rather than guessing which entry is
  // the real client.
  if (hops.length !== 1 || ipFamily(hops[0]) === null) {
    throw new AmbiguousForwardingChainError('X-Forwarded-For must name exactly one valid client address behind a trusted proxy');
  }
  return Object.freeze({ address: hops[0], trusted: true });
}

module.exports = { AmbiguousForwardingChainError, resolveClientAddress };

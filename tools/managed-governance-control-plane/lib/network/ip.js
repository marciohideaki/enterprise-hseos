'use strict';

const net = require('node:net');

// A thin, deliberately small wrapper around Node's own net.BlockList rather than a hand-rolled
// bit-level CIDR matcher. Node's C++ implementation already canonicalizes IPv4-mapped IPv6
// addresses (::ffff:192.0.2.1) against an IPv4 subnet when checked with family 'ipv6' -- exactly
// the "IPv4, IPv6 and mapped addresses are canonical" acceptance criterion FR-019/FR-021 require.
// A dual-stack Node HTTP server reports a real IPv4 client's socket.remoteAddress in that mapped
// form, so an allowlist written as a plain IPv4 CIDR must still match it or the allowlist would
// silently reject every real client. Re-implementing CIDR arithmetic by hand would only risk
// reproducing bugs Node has already fixed in a widely used primitive.

const CIDR_PATTERN = /^(.+)\/(\d{1,3})$/;

class InvalidCidrError extends RangeError {
  constructor(message) {
    super(message);
    this.name = 'InvalidCidrError';
  }
}

class InvalidPeerAddressError extends RangeError {
  constructor(message) {
    super(message);
    this.name = 'InvalidPeerAddressError';
  }
}

function ipFamily(address) {
  const version = net.isIP(address);
  return version === 4 ? 'ipv4' : version === 6 ? 'ipv6' : null;
}

// Parses "base/prefix" into the pieces net.BlockList#addSubnet needs, with error types and
// messages meant for a configuration-validation surface rather than net.BlockList's own
// TypeError/RangeError (which describe the constructor's own low-level parameter shape).
function parseCidr(cidr) {
  if (typeof cidr !== 'string') throw new InvalidCidrError('CIDR must be a string');
  const match = CIDR_PATTERN.exec(cidr);
  if (!match) throw new InvalidCidrError(`CIDR is malformed: ${cidr}`);
  const [, base, prefixText] = match;
  const family = ipFamily(base);
  if (family === null) throw new InvalidCidrError(`CIDR base address is invalid: ${cidr}`);
  if (!/^\d{1,3}$/.test(prefixText)) throw new InvalidCidrError(`CIDR prefix is invalid: ${cidr}`);
  const prefix = Number(prefixText);
  const maxPrefix = family === 'ipv4' ? 32 : 128;
  if (prefix > maxPrefix) throw new InvalidCidrError(`CIDR prefix is out of range for ${family}: ${cidr}`);
  return Object.freeze({ cidr, base, prefix, family });
}

// Builds one matcher covering every CIDR in the list. Rules are added by family so an IPv4 rule
// only ever matches IPv4 (or IPv4-mapped-IPv6) peers and an IPv6 rule only ever matches IPv6
// peers -- confirmed against net.BlockList directly, not assumed.
function buildAllowlist(cidrs) {
  if (!Array.isArray(cidrs)) throw new InvalidCidrError('CIDR allowlist must be an array');
  const blockList = new net.BlockList();
  const rules = cidrs.map((cidr) => {
    const parsed = parseCidr(cidr);
    blockList.addSubnet(parsed.base, parsed.prefix, parsed.family);
    return parsed;
  });
  return Object.freeze({
    rules,
    matches(peerAddress) {
      const family = ipFamily(peerAddress);
      if (family === null) return false;
      return blockList.check(peerAddress, family);
    },
  });
}

function canonicalPeerFamily(peerAddress) {
  const family = ipFamily(peerAddress);
  if (family === null) throw new InvalidPeerAddressError(`peer address is not a valid IPv4 or IPv6 address: ${String(peerAddress)}`);
  return family;
}

module.exports = {
  InvalidCidrError,
  InvalidPeerAddressError,
  buildAllowlist,
  canonicalPeerFamily,
  ipFamily,
  parseCidr,
};

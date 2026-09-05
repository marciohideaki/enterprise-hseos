'use strict';

const { buildAllowlist, ipFamily } = require('./ip');

// FR-019/FR-020/FR-021: portable and managed-shadow installations bind to loopback unless an
// operator explicitly selects the shared-network profile, which requires a complete, non-empty
// client allowlist plus transport and authentication configuration -- never a package default.
// Binding to 0.0.0.0 is accepted only after the exact same validation as any other shared-network
// host; it is never a shortcut around the allowlist.
//
// This module only decides admission (design.md's admission-sequence steps 1-4: validate the
// profile, then match the raw socket peer against the allowlist). Trusted-proxy forwarding,
// authentication, rate limits and audit (steps 3's proxy exception and steps 5-7) are T10's job
// -- this module never looks at a forwarding header, only the socket's own remote address.

const LOOPBACK_CIDRS = Object.freeze(['127.0.0.1/32', '::1/128']);
const ALLOW_ALL_CIDRS = Object.freeze(['0.0.0.0/0', '::/0']);

class NetworkAdmissionError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_NETWORK_ADMISSION_INVALID', details = {}) {
    super(message);
    this.name = 'NetworkAdmissionError';
    this.code = code;
    this.details = details;
  }
}

// Re-validates the structural invariants ManagedNetworkProfileSchema already enforces at the
// contract layer (packages/managed-governance-contracts) -- defense in depth, matching this
// codebase's other domain modules that never trust a hand-built object just because some other
// layer happens to validate it too. A caller that constructs a profile without going through
// parseContract must not be able to skip these checks and open a socket anyway.
function assertNetworkProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new NetworkAdmissionError('network profile is required');
  }
  if (profile.profile === 'loopback') return profile;
  if (profile.profile !== 'shared-network') {
    throw new NetworkAdmissionError(`unsupported network profile: ${profile.profile}`, 'MANAGED_GOVERNANCE_NETWORK_PROFILE_INVALID');
  }
  if (typeof profile.listen_host !== 'string' || profile.listen_host.length === 0 || !Number.isInteger(profile.port)) {
    throw new NetworkAdmissionError('shared-network profile requires an explicit listen host and port', 'MANAGED_GOVERNANCE_NETWORK_LISTENER_INVALID');
  }
  if (!Array.isArray(profile.allowed_clients) || profile.allowed_clients.length === 0) {
    throw new NetworkAdmissionError(
      'shared-network profile requires a non-empty client allowlist',
      'MANAGED_GOVERNANCE_NETWORK_ALLOWLIST_EMPTY',
    );
  }
  // An allow-all entry never degrades to allow-all even if every other rule is present and
  // well-formed (FR-021). This is checked here, not left to ManagedNetworkProfileSchema alone,
  // because this function is the defense-in-depth backstop for a hand-built profile that never
  // went through parseContract at all.
  if (profile.allowed_clients.some((cidr) => ALLOW_ALL_CIDRS.includes(cidr))) {
    throw new NetworkAdmissionError('shared-network profile allowlist must not contain an allow-all network', 'MANAGED_GOVERNANCE_NETWORK_ALLOWLIST_ALLOW_ALL');
  }
  if (!profile.transport || !profile.authentication || !profile.rate_limits) {
    throw new NetworkAdmissionError(
      'shared-network profile requires transport, authentication and rate limits',
      'MANAGED_GOVERNANCE_NETWORK_CONTROLS_INCOMPLETE',
    );
  }
  return profile;
}

// Every CIDR in allowed_clients is validated up front (buildAllowlist parses and adds each one
// immediately) so a malformed or wildcard allowlist entry fails here, before createNetworkAdmission
// returns -- and therefore before the caller can ever reach server.listen().
function createNetworkAdmission(rawProfile) {
  const profile = assertNetworkProfile(rawProfile);
  if (profile.profile === 'loopback') {
    const allowlist = buildAllowlist(LOOPBACK_CIDRS);
    return Object.freeze({
      profile: 'loopback',
      listenHost: null,
      listenPort: null,
      admit(peerAddress) {
        if (ipFamily(peerAddress) === null) return Object.freeze({ allow: false, deny_reason: 'peer_address_invalid' });
        const allowed = allowlist.matches(peerAddress);
        return Object.freeze({ allow: allowed, deny_reason: allowed ? null : 'not_loopback' });
      },
    });
  }

  const allowlist = buildAllowlist(profile.allowed_clients);
  return Object.freeze({
    profile: 'shared-network',
    listenHost: profile.listen_host,
    listenPort: profile.port,
    admit(peerAddress) {
      if (ipFamily(peerAddress) === null) return Object.freeze({ allow: false, deny_reason: 'peer_address_invalid' });
      const allowed = allowlist.matches(peerAddress);
      return Object.freeze({ allow: allowed, deny_reason: allowed ? null : 'not_allowlisted' });
    },
  });
}

module.exports = {
  LOOPBACK_CIDRS,
  NetworkAdmissionError,
  assertNetworkProfile,
  createNetworkAdmission,
};

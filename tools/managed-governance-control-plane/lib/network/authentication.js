'use strict';

const crypto = require('node:crypto');
const { HttpAuthenticationError, validActor } = require('../interfaces/http/auth');

// FR-020/FR-022: query and read-mostly MCP traffic and administrative console mutations use
// separate, non-overlapping credentials -- a token issued for one scope is never valid for the
// other, in either direction. A leaked lower-privilege query token being usable for an admin
// mutation is exactly the "scope confusion" T10's acceptance criteria forbid; the reverse
// (an admin token also passing as a query credential) is refused too, so there is exactly one
// way to authenticate each scope and no implicit privilege collapse between them.

const SCOPES = Object.freeze(['query', 'admin']);
const CSRF_HMAC_LABEL = 'hseos-governance-csrf-v1';

function boundedToken(value, label) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 512) {
    throw new TypeError(`${label} must be a bounded token of at least 16 characters`);
  }
  return value;
}

function timingSafeEqualStrings(left, right) {
  const bufferLeft = Buffer.from(left, 'utf8');
  const bufferRight = Buffer.from(right, 'utf8');
  if (bufferLeft.length !== bufferRight.length) return false;
  return crypto.timingSafeEqual(bufferLeft, bufferRight);
}

function extractBearer(request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return token.length > 0 && token.length <= 512 ? token : null;
}

function extractActor(request) {
  const roles =
    typeof request.headers['x-hseos-actor-roles'] === 'string'
      ? request.headers['x-hseos-actor-roles']
          .split(',')
          .map((role) => role.trim())
          .filter(Boolean)
      : [];
  return validActor({
    type: request.headers['x-hseos-actor-type'],
    id: request.headers['x-hseos-actor-id'],
    roles,
  });
}

function createNetworkAuthentication({ queryToken, adminToken }) {
  const tokensByScope = Object.freeze({
    query: boundedToken(queryToken, 'query token'),
    admin: boundedToken(adminToken, 'admin token'),
  });
  if (timingSafeEqualStrings(tokensByScope.query, tokensByScope.admin)) {
    throw new TypeError('query and admin tokens must be distinct');
  }

  // Stateless and deterministic on purpose: there is no session store anywhere in this codebase
  // to bind a CSRF token to, so the token is derived directly from the admin credential itself
  // (HMAC, never the bearer token in the clear) rather than inventing new persisted session
  // state this task never asked for. A caller cannot know it without already holding the admin
  // bearer token, and a request that only carries the bearer header (never auto-attached by a
  // browser the way a cookie would be) still must separately echo this value back.
  function csrfTokenForScope(scope) {
    if (scope !== 'admin') return null;
    return crypto.createHmac('sha256', tokensByScope.admin).update(CSRF_HMAC_LABEL).digest('hex');
  }

  return Object.freeze({
    csrfTokenForScope,
    async authenticate(request, scope) {
      if (!SCOPES.includes(scope)) throw new TypeError(`unsupported authentication scope: ${scope}`);
      const supplied = extractBearer(request);
      if (supplied === null || !timingSafeEqualStrings(supplied, tokensByScope[scope])) {
        throw new HttpAuthenticationError();
      }
      const actor = extractActor(request);
      if (!actor) throw new HttpAuthenticationError('actor context is invalid');
      return actor;
    },
  });
}

module.exports = { SCOPES, createNetworkAuthentication };

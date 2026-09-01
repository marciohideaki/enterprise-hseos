'use strict';

const ACTOR_TYPES = new Set(['human', 'agent', 'automation', 'service']);
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;

class HttpAuthenticationError extends Error {
  constructor(message = 'actor authentication is required') {
    super(message);
    this.name = 'HttpAuthenticationError';
    this.code = 'unauthorized';
  }
}

function validActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return null;
  if (!ACTOR_TYPES.has(actor.type) || !IDENTIFIER.test(actor.id)) return null;
  const roles = actor.roles || [];
  if (!Array.isArray(roles) || roles.length > 64 || roles.some((role) => !IDENTIFIER.test(role))) return null;
  return Object.freeze({ type: actor.type, id: actor.id, roles: Object.freeze([...new Set(roles)].sort()) });
}

function createStaticAuth(actor) {
  const normalized = validActor(actor);
  if (!normalized) throw new TypeError('static actor context is invalid');
  return Object.freeze({
    async authenticate() {
      return normalized;
    },
  });
}

function createDevelopmentAuth(options = {}) {
  const enabled = options.enabled === true && process.env.HSEOS_GOVERNANCE_DEV_AUTH === 'true';
  const expectedToken = options.token;
  if (enabled && (typeof expectedToken !== 'string' || expectedToken.length < 16 || expectedToken.length > 512)) {
    throw new TypeError('development authentication requires a bounded token');
  }
  return Object.freeze({
    async authenticate(request) {
      if (!enabled || request.headers.authorization !== `Bearer ${expectedToken}`) throw new HttpAuthenticationError();
      const roles =
        typeof request.headers['x-hseos-actor-roles'] === 'string'
          ? request.headers['x-hseos-actor-roles']
              .split(',')
              .map((role) => role.trim())
              .filter(Boolean)
          : [];
      const actor = validActor({
        type: request.headers['x-hseos-actor-type'],
        id: request.headers['x-hseos-actor-id'],
        roles,
      });
      if (!actor) throw new HttpAuthenticationError('actor context is invalid');
      return actor;
    },
  });
}

const denyAnonymousAuth = Object.freeze({
  async authenticate() {
    throw new HttpAuthenticationError();
  },
});

module.exports = {
  HttpAuthenticationError,
  createDevelopmentAuth,
  createStaticAuth,
  denyAnonymousAuth,
  validActor,
};

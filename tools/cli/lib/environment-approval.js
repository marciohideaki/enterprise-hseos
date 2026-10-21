'use strict';

// Per-action approval for computer-use. An approval is bound to one exact action of one session (session, sequence,
// action, arguments and the digest of the last screenshot the approver looked at), is used once and expires. Nothing
// here can be widened: there is no "approve all", and a bypass or plan execution mode is refused outright.
const { randomUUID } = require('node:crypto');
const { evaluatePermissionLattice } = require('../../../packages/agent-policy-lattice');
const { APPROVED_ACTIONS, LIMITS, canonical, sha256 } = require('../../../packages/agent-environment/computer-contract');

const EVENT = 'environment.computer.approval_outcome';
const MAX_RECORDS = 256;
const BINDING_FIELDS = ['session_id', 'seq', 'action', 'args', 'screenshot_digest'];
const HEX64 = /^[0-9a-f]{64}$/u;
// Anything that asks for a standing or blanket grant is refused, whatever the spelling the caller picked.
const BLANKET = /(?:^|[_-])(?:all|always|session|standing|bypass)(?:$|[_-])/iu;

class ApprovalError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

function bindingOf(request) {
  const binding = {};
  for (const field of BINDING_FIELDS) binding[field] = request?.[field];
  const valid =
    typeof binding.session_id === 'string' &&
    binding.session_id.length > 0 &&
    Number.isSafeInteger(binding.seq) &&
    binding.seq >= 0 &&
    APPROVED_ACTIONS.includes(binding.action) &&
    binding.args !== null &&
    typeof binding.args === 'object' &&
    !Array.isArray(binding.args) &&
    HEX64.test(binding.screenshot_digest ?? '');
  if (!valid) throw new ApprovalError('approval binding is incomplete', 'ENV_COMPUTER_APPROVAL_BINDING_INVALID');
  return { binding, digest: sha256(canonical(binding)) };
}

/** Anything beyond the binding fields is a request for more than one action: refused, never ignored. */
function wantsMoreThanOneAction(request) {
  return Object.keys(request).some((key) => !BINDING_FIELDS.includes(key)) || BLANKET.test(String(request.action));
}

function createApprovalGate({
  rules = [],
  now = () => new Date(),
  ttl_ms = LIMITS.default_approval_ttl_ms,
  ledger = () => {},
  id = randomUUID,
} = {}) {
  if (!Number.isSafeInteger(ttl_ms) || ttl_ms < LIMITS.min_approval_ttl_ms || ttl_ms > LIMITS.max_approval_ttl_ms) {
    throw new ApprovalError('approval ttl is outside the supported range', 'ENV_COMPUTER_APPROVAL_TTL_INVALID');
  }
  const records = new Map();
  const record = (outcome, extra) => ledger(Object.freeze({ type: EVENT, at: now().toISOString(), outcome, ...extra }));

  function purge() {
    if (records.size < MAX_RECORDS) return;
    // A request nobody answered in time is as spent as a consumed one; keeping it would wedge the table for good.
    for (const [key, entry] of records) {
      if ((entry.state !== 'pending' && entry.state !== 'approved') || expired(entry)) records.delete(key);
    }
    if (records.size >= MAX_RECORDS) throw new ApprovalError('too many open approvals', 'ENV_COMPUTER_APPROVAL_LIMIT');
  }

  const expired = (entry) => now().getTime() >= entry.expires_at_ms;

  function refuse(outcome, code, extra = {}) {
    record(outcome, { code, ...extra });
    return Object.freeze({ status: 'refused', code, ...extra });
  }

  /** Open a request for one action. The lattice decides at the `ask` stage; only a person's approve() grants it. */
  function request(input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return refuse('rejected', 'ENV_COMPUTER_APPROVAL_BINDING_INVALID');
    }
    const mode = options.execution_mode ?? 'default';
    if (mode !== 'default' || options.approve_all !== undefined || wantsMoreThanOneAction(input)) {
      return refuse('rejected', 'ENV_COMPUTER_APPROVAL_NOT_APPLICABLE', { action: String(input.action).slice(0, 32) });
    }
    let bound;
    try {
      bound = bindingOf(input);
    } catch (error) {
      return refuse('rejected', error.code);
    }
    // The execution mode is fixed here: a caller cannot turn an `allow` into a standing grant.
    const decision = evaluatePermissionLattice({ rules, execution_mode: 'default' });
    if (decision.decision === 'deny') {
      return refuse('denied', 'ENV_COMPUTER_POLICY_DENIED', { binding_digest: bound.digest, deciding_rule_id: decision.deciding_rule_id });
    }
    try {
      purge();
    } catch (error) {
      return refuse('rejected', error.code, { binding_digest: bound.digest });
    }
    const request_id = id();
    const created = now().getTime();
    records.set(request_id, { state: 'pending', binding: bound.digest, expires_at_ms: created + ttl_ms });
    record('requested', {
      request_id,
      binding_digest: bound.digest,
      action: bound.binding.action,
      session_id: bound.binding.session_id,
      seq: bound.binding.seq,
      lattice: decision.decision,
    });
    return Object.freeze({
      status: 'pending',
      request_id,
      binding_digest: bound.digest,
      expires_at: new Date(created + ttl_ms).toISOString(),
    });
  }

  function resolve(request_id, approved, who) {
    const entry = records.get(request_id);
    if (!entry) return refuse('rejected', 'ENV_COMPUTER_APPROVAL_MISSING');
    if (entry.state !== 'pending') return refuse('rejected', 'ENV_COMPUTER_APPROVAL_NOT_PENDING', { request_id });
    if (typeof who?.approver !== 'string' || who.approver.length === 0) {
      return refuse('rejected', 'ENV_COMPUTER_APPROVER_REQUIRED', { request_id });
    }
    if (expired(entry)) {
      entry.state = 'expired';
      return refuse('expired', 'ENV_COMPUTER_APPROVAL_EXPIRED', { request_id });
    }
    entry.state = approved ? 'approved' : 'denied';
    record(approved ? 'approved' : 'denied', { request_id, binding_digest: entry.binding, approver: who.approver.slice(0, 128) });
    return Object.freeze({ status: entry.state, request_id, binding_digest: entry.binding });
  }

  /** The use: succeeds once, and only for the very binding that was approved. */
  function consume(request_id, input) {
    const entry = records.get(request_id);
    if (!entry) return refuse('rejected', 'ENV_COMPUTER_APPROVAL_MISSING');
    if (entry.state === 'consumed') return refuse('rejected', 'ENV_COMPUTER_APPROVAL_REUSED', { request_id });
    if (entry.state === 'expired' || (['pending', 'approved'].includes(entry.state) && expired(entry))) {
      entry.state = 'expired';
      return refuse('expired', 'ENV_COMPUTER_APPROVAL_EXPIRED', { request_id });
    }
    if (entry.state !== 'approved') return refuse('rejected', 'ENV_COMPUTER_APPROVAL_NOT_GRANTED', { request_id });
    let bound;
    try {
      bound = bindingOf(input);
    } catch (error) {
      return refuse('rejected', error.code, { request_id });
    }
    // A different action, session, sequence or screenshot is refused and does not spend the approval.
    if (bound.digest !== entry.binding) {
      return refuse('rejected', 'ENV_COMPUTER_APPROVAL_MISMATCH', { request_id, binding_digest: bound.digest });
    }
    entry.state = 'consumed';
    record('consumed', { request_id, binding_digest: entry.binding });
    return Object.freeze({ status: 'consumed', request_id, binding_digest: entry.binding });
  }

  return Object.freeze({
    request,
    approve: (request_id, who) => resolve(request_id, true, who),
    deny: (request_id, who) => resolve(request_id, false, who),
    consume,
  });
}

module.exports = { ApprovalError, EVENT, createApprovalGate };

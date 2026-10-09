'use strict';

const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { engineeringDigest } = require('./engineering-task-state');
const { parseProviderControlManifest, inspectProviderControlManifest } = require('../../lib/provider-control-manifest');
const { executorOwner, isExecutorOwnerAlive } = require('../../../packages/agent-isolation-attestation/executor');
const { MAX_EVIDENCE_BYTES, storeEvidence, readEvidence } = require('./campaign-evidence-store');

const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commandSchema = z
  .object({
    schema_version: z.literal(1),
    command_id: z.string().uuid(),
    resource_id: z.string().uuid(),
    expected_sequence: integer,
    action: z.enum(['create', 'run', 'cancel', 'reconcile']),
    input: z.record(z.string(), z.json()),
  })
  .strict();
const inputs = {
  create: z.object({ authorization_id: z.string().uuid() }).strict(),
  run: z.object({ binding_id: z.string().min(1).max(160), task_id: z.string().uuid(), resume_from: z.string().uuid().optional() }).strict(),
  cancel: z.object({}).strict(),
  reconcile: z.object({ report_sha256: hash, answer: z.string().trim().min(1).max(8192) }).strict(),
};
const observationSchema = z
  .object({
    binding_sha256: hash,
    artifact_sha256: hash,
    provider_version: z.string().min(1).max(160),
    account_sha256: hash.nullable(),
    credential_sha256: hash.optional(),
    profile_sha256: hash.optional(),
    authenticated: z.boolean(),
    auth_source: z.string().min(1).max(160),
    observed_at: integer,
    expires_at: integer.nullable(),
    quota_remaining_requests: integer.nullable(),
    quota_available_microusd: integer.optional(),
    quota_windows: z
      .array(z.object({ used_percent: z.number().min(0).max(100), resets_at: integer }).strict())
      .min(1)
      .max(4)
      .optional(),
    competing_credentials: z.boolean(),
  })
  .strict();
const receiptSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'cancelled']),
    binding_sha256: hash,
    evidence_sha256: hash,
    cost_microusd: integer.nullable(),
    input_tokens: integer,
    output_tokens: integer,
    provider_session_id: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
      .optional(),
    // Optional so receipts recorded before model-output retention stay readable without rewriting events.
    evidence_ref: z
      .object({ schema_version: z.literal(1), kind: z.literal('model_output'), sha256: hash, bytes: integer.max(MAX_EVIDENCE_BYTES) })
      .strict()
      .optional(),
    // Declared non-retention keeps the paid dispatch valid; reads answer CONTROL_CAMPAIGN_EVIDENCE_WITHHELD.
    evidence_withheld: z.enum(['too_large', 'credential_pattern', 'integrity_mismatch']).optional(),
  })
  .strict()
  .refine((value) => !(value.evidence_ref && value.evidence_withheld));
const CAMPAIGN_REFERENCE = /^campaign:\/\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/;
const responsesSchema = z.array(z.object({ name: z.string().min(1).max(160), input: z.record(z.string(), z.json()) }).strict()).max(64);
const authorizationSchema = z
  .object({
    max_requests: integer.min(1).max(10_000),
    max_cost_microusd: integer,
    deadline: integer.min(1),
    binding_ids: z.array(z.string().min(1).max(160)).min(1).max(16),
    task_ids: z.array(z.string().uuid()).min(1).max(100),
    quota_exceptions: z
      .record(z.string().min(1).max(160), z.object({ reason: z.string().trim().min(1).max(512), expires_at: integer.positive() }).strict())
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [binding, exception] of Object.entries(value.quota_exceptions ?? {})) {
      if (!value.binding_ids.includes(binding) || exception.expires_at > value.deadline)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Quota exception exceeds authorization scope' });
    }
  });

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

/** Campaign reservations extend the control ledger; adapters remain effect owners. */
class ProviderCampaignControl {
  #lifecycle = { active: new Map(), inspections: new Map(), inflight: new Map(), drains: new Set(), closing: false };
  get active() {
    return this.#lifecycle.active;
  }
  get inspections() {
    return this.#lifecycle.inspections;
  }
  get inflight() {
    return this.#lifecycle.inflight;
  }
  get drains() {
    return this.#lifecycle.drains;
  }
  get closing() {
    return this.#lifecycle.closing;
  }
  set closing(value) {
    this.#lifecycle.closing = value;
  }

  constructor(control, bindings = {}, { now = Date.now, authorizations = {} } = {}) {
    this.control = control;
    this.now = now;
    this.bindings = new Map();
    this.authorizations = new Map(
      Object.entries(authorizations).map(([id, value]) => [z.string().uuid().parse(id), authorizationSchema.parse(value)]),
    );
    for (const [id, configured] of Object.entries(bindings)) {
      const manifest = parseProviderControlManifest(configured.manifest);
      inspectProviderControlManifest(manifest, configured.binding_sha256);
      if (id !== manifest.binding_id || typeof configured.adapter?.inspect !== 'function' || typeof configured.adapter?.run !== 'function')
        reject('CONTROL_PROVIDER_CONFIGURATION_INVALID');
      const subordinateIds = z
        .array(z.string().min(1).max(160))
        .max(16)
        .parse(configured.subordinate_binding_ids || []);
      this.bindings.set(id, { manifest, adapter: configured.adapter, subordinateIds: Object.freeze(subordinateIds) });
    }
    this.validateComposition();
  }
  /** Reconstruct an admitted host adapter without changing durable authority or lifecycle ownership. */
  withBinding(configured) {
    const id = configured?.manifest?.binding_id;
    const current = this.bindings.get(id);
    if (!current || engineeringDigest(current.manifest) !== engineeringDigest(configured.manifest))
      reject('CONTROL_PROVIDER_BINDING_DRIFT');
    const bindings = Object.fromEntries(
      [...this.bindings].map(([key, value]) => [
        key,
        {
          manifest: value.manifest,
          binding_sha256: value.manifest.binding_sha256,
          adapter: key === id ? configured.adapter : value.adapter,
          subordinate_binding_ids: value.subordinateIds,
        },
      ]),
    );
    const facade = new ProviderCampaignControl(this.control, bindings, { now: this.now });
    facade.#lifecycle = this.#lifecycle;
    return facade;
  }
  validateComposition() {
    for (const binding of this.bindings.values()) {
      if (binding.subordinateIds.length > 0 && binding.manifest.provider_kind !== 'client') reject('CONTROL_PROVIDER_COMPOSITION_INVALID');
      for (const id of binding.subordinateIds) {
        const child = this.bindings.get(id);
        if (!child || child === binding || !['model', 'client'].includes(child.manifest.provider_kind) || child.subordinateIds.length > 0)
          reject('CONTROL_PROVIDER_COMPOSITION_INVALID');
      }
    }
  }
  async shutdown() {
    this.closing = true;
    for (const id of new Set([...this.active.keys(), ...this.inspections.keys()])) {
      if (!this.query(id).cancelled)
        await this.execute({
          schema_version: 1,
          command_id: randomUUID(),
          resource_id: id,
          expected_sequence: this.rows(id).length,
          action: 'cancel',
          input: {},
        });
      for (const controller of this.active.get(id) || []) controller.abort();
      for (const controller of this.inspections.get(id) || []) controller.abort();
    }
    await Promise.all(this.drains);
  }
  inspect(bindingId) {
    const binding = this.bindings.get(bindingId);
    if (!binding) reject('CONTROL_PROVIDER_BINDING_UNKNOWN');
    return inspectProviderControlManifest(binding.manifest, binding.manifest.binding_sha256);
  }
  rows(id) {
    z.string().uuid().parse(id);
    return this.control.ledger.readStream('control_provider_campaign', id);
  }
  append(id, payload, aggregate = 'control_provider_campaign') {
    const rows = this.control.ledger.readStream(aggregate, id);
    this.control.ledger.append({
      aggregate_type: aggregate,
      aggregate_id: id,
      expected_version: rows.length,
      events: [
        {
          event_id: randomUUID(),
          event_type: 'ControlCommandRecorded',
          schema_version: 1,
          occurred_at: new Date(this.now()).toISOString(),
          correlation_id: id,
          causation_id: rows.at(-1)?.event_id || id,
          actor: { type: 'hseos', id: 'provider-control' },
          operation_id: null,
          payload: { schema_version: 1, ...payload },
          evidence_refs: [],
        },
      ],
    });
  }
  query(id) {
    const rows = this.rows(id),
      opened = rows.find((r) => r.payload.kind === 'opened')?.payload;
    if (!opened) reject('CONTROL_CAMPAIGN_NOT_FOUND');
    const authorizationRows = z.string().uuid().safeParse(opened.authorization_id).success
      ? this.control.ledger.readStream('control_provider_authorization', opened.authorization_id)
      : [];
    if (
      rows.filter((row) => row.payload.kind === 'opened').length !== 1 ||
      authorizationRows.length !== 1 ||
      authorizationRows[0].payload.kind !== 'claimed' ||
      authorizationRows[0].payload.campaign_id !== id
    )
      reject('CONTROL_CAMPAIGN_AUTHORIZATION_INVALID');
    const reserved = rows.filter((r) => r.payload.kind === 'reserved');
    const reconciled = new Set(rows.filter((r) => r.payload.kind === 'reconciled').flatMap((r) => r.payload.command_ids));
    const pending = reserved.filter(
      (r) =>
        !rows.some((v) => v.payload.kind === 'receipt' && v.payload.command_id === r.payload.command_id) &&
        !reconciled.has(r.payload.command_id),
    );
    let cost = 0;
    for (const row of reserved) {
      const receipt = rows.find((r) => r.payload.kind === 'receipt' && r.payload.command_id === row.payload.command_id)?.payload.receipt;
      const measured = rows.findLast((r) => r.payload.kind === 'uncertain' && r.payload.command_id === row.payload.command_id)?.payload
        .measured_microusd;
      cost = Math.min(Number.MAX_SAFE_INTEGER, cost + (receipt?.cost_microusd ?? Math.max(row.payload.reserved_microusd, measured || 0)));
    }
    const report = {
      resource_id: id,
      current_sequence: rows.length,
      max_requests: opened.max_requests,
      max_cost_microusd: opened.max_cost_microusd,
      deadline: opened.deadline,
      requests: reserved.length,
      committed_microusd: cost,
      cancelled: rows.some((r) => r.payload.kind === 'cancelled'),
      unresolved_commands: pending.map((r) => r.payload.command_id),
      live_commands: pending
        .filter(
          (r) =>
            !rows.some((v) => v.payload.kind === 'uncertain' && v.payload.command_id === r.payload.command_id) &&
            isExecutorOwnerAlive(r.payload.owner),
        )
        .map((r) => r.payload.command_id),
      bindings: [...new Set(reserved.map((r) => r.payload.binding_id))],
    };
    return { ...report, report_sha256: engineeringDigest(report) };
  }
  replay(id, commandId, digest) {
    const rows = this.rows(id),
      intent = rows.find((r) => ['intent', 'reserved'].includes(r.payload.kind) && r.payload.command_id === commandId);
    if (!intent) return null;
    if (intent.payload.digest !== digest) reject('CONTROL_IDEMPOTENCY_CONFLICT');
    const done = rows.find((r) => r.payload.kind === 'done' && r.payload.command_id === commandId);
    if (!done) reject('CONTROL_OUTCOME_UNCERTAIN');
    return done.payload.result;
  }
  /** Governed read of a completed dispatch's model output; the stored artifact is re-hashed against the accepted receipt. */
  evidence(id, commandId) {
    if (!z.string().uuid().safeParse(commandId).success) reject('CONTROL_QUERY_INVALID');
    const state = this.query(id);
    const rows = this.rows(id);
    const reserved = rows.find((r) => r.payload.kind === 'reserved' && r.payload.command_id === commandId)?.payload;
    if (!reserved) reject('CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE');
    const rejected = rows.some(
      (r) =>
        (r.payload.kind === 'uncertain' && r.payload.command_id === commandId) ||
        (r.payload.kind === 'reconciled' && r.payload.command_ids.includes(commandId)),
    );
    if (!rejected && (this.active.has(id) || state.unresolved_commands.includes(commandId))) reject('CONTROL_CAMPAIGN_NOT_COMPLETED');
    const receipt = rows.find((r) => r.payload.kind === 'receipt' && r.payload.command_id === commandId)?.payload.receipt;
    const done = rows.some((r) => r.payload.kind === 'done' && r.payload.command_id === commandId);
    if (!receipt || !done || rejected || receipt.status !== 'completed') reject('CONTROL_CAMPAIGN_EVIDENCE_REJECTED');
    if (receipt.evidence_withheld) reject('CONTROL_CAMPAIGN_EVIDENCE_WITHHELD');
    if (!receipt.evidence_ref) reject('CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE');
    const opened = rows.find((r) => r.payload.kind === 'opened').payload;
    if (opened.binding_manifests[reserved.binding_id] !== reserved.manifest_sha256) reject('CONTROL_PROVIDER_BINDING_DRIFT');
    const text = readEvidence(this.control.state, receipt.evidence_ref);
    return {
      schema_version: 1,
      resource_id: id,
      command_id: commandId,
      task_id: reserved.task_id,
      binding_id: reserved.binding_id,
      binding_sha256: receipt.binding_sha256,
      receipt_sha256: engineeringDigest(receipt),
      evidence_sha256: receipt.evidence_ref.sha256,
      bytes: receipt.evidence_ref.bytes,
      text,
    };
  }
  /** Resolve `campaign://<campaign>/<dispatch>` into scripted tool calls with verifiable provenance. */
  resolveResponses({ ref, binding_sha256: bindingSha256 }, { task_id: taskId }) {
    const match = CAMPAIGN_REFERENCE.exec(ref);
    if (!match) reject('CONTROL_CAMPAIGN_REFERENCE_INVALID');
    const evidence = this.evidence(match[1], match[2]);
    if (evidence.binding_sha256 !== bindingSha256) reject('CONTROL_CAMPAIGN_BINDING_MISMATCH');
    if (evidence.task_id !== taskId) reject('CONTROL_CAMPAIGN_TASK_MISMATCH');
    const fenced = /^\s*```(?:json)?\n([\s\S]*?)\n```\s*$/.exec(evidence.text);
    let responses;
    try {
      responses = responsesSchema.parse(JSON.parse(fenced ? fenced[1] : evidence.text));
    } catch {
      reject('CONTROL_CAMPAIGN_EVIDENCE_INVALID');
    }
    const { text: _text, schema_version: _version, ...provenance } = evidence;
    return { responses, source: { schema_version: 1, ref, ...provenance } };
  }
  /**
   * One dispatch output feeds one consuming resource; replays by that resource stay idempotent. A different resource may take
   * over only for the same task and contract when the previous consumer never registered (the creation failed after the claim).
   */
  claimEvidence(commandId, consumerId, taskId, contractSha256) {
    const rows = this.control.ledger.readStream('control_campaign_evidence', commandId);
    const last = rows.at(-1)?.payload;
    if (last) {
      if (last.contract_sha256 !== contractSha256 || last.task_id !== taskId) reject('CONTROL_CAMPAIGN_EVIDENCE_CONSUMED');
      if (last.consumer_id === consumerId) return;
      if (this.control.rows(last.consumer_id).some((row) => row.payload.kind === 'registered'))
        reject('CONTROL_CAMPAIGN_EVIDENCE_CONSUMED');
    }
    this.append(
      commandId,
      { kind: 'consumed', consumer_id: consumerId, task_id: taskId, contract_sha256: contractSha256 },
      'control_campaign_evidence',
    );
  }
  events(id, { after = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) reject('CONTROL_QUERY_INVALID');
    this.query(id);
    const events = this.rows(id)
      .filter((r) => r.stream_sequence > after)
      .slice(0, limit);
    return { resource_id: id, events, next_cursor: events.at(-1)?.stream_sequence || after };
  }
  assertFreshObservation(observed) {
    const now = this.now();
    if (observed.observed_at > now || now - observed.observed_at > 30_000 || (observed.expires_at !== null && observed.expires_at <= now))
      reject('CONTROL_PROVIDER_OBSERVATION_EXPIRED');
    if (observed.quota_windows?.some((window) => window.resets_at <= now)) reject('CONTROL_PROVIDER_OBSERVATION_EXPIRED');
  }
  quotaAdmission(id, binding, observed) {
    const { manifest } = binding;
    if (manifest.route === 'local') return 'not_applicable';
    if (observed.quota_available_microusd !== undefined && observed.quota_available_microusd < manifest.billing.max_request_microusd)
      reject('CONTROL_PROVIDER_QUOTA_UNAVAILABLE');
    if (observed.quota_remaining_requests !== null) {
      if (observed.quota_remaining_requests < 1) reject('CONTROL_PROVIDER_QUOTA_UNAVAILABLE');
      return 'observed';
    }
    if (observed.quota_windows) {
      if (
        manifest.route !== 'account' ||
        observed.quota_windows.some((window) => window.used_percent >= 100 || window.resets_at <= this.now())
      )
        reject('CONTROL_PROVIDER_QUOTA_UNAVAILABLE');
      return 'observed';
    }
    if (manifest.route === 'api' && observed.quota_available_microusd !== undefined) return 'observed';
    const opened = this.rows(id).find((row) => row.payload.kind === 'opened').payload;
    const exception = opened.quota_exceptions?.[manifest.binding_id];
    if (!exception || exception.expires_at <= this.now() || exception.expires_at > opened.deadline)
      reject('CONTROL_PROVIDER_QUOTA_UNAVAILABLE');
    return 'owner_exception';
  }
  admitDispatch(id, input, binding, parent) {
    const state = this.query(id);
    if (state.cancelled) reject('CONTROL_CAMPAIGN_CANCELLED');
    if (state.unresolved_commands.some((key) => key !== parent?.commandId)) reject('CONTROL_OUTCOME_UNCERTAIN');
    if (parent && (!parent.open || parent.signal.aborted || !state.live_commands.includes(parent.commandId)))
      reject('CONTROL_CAMPAIGN_CANCELLED');
    const { manifest } = binding;
    const opened = this.rows(id).find((r) => r.payload.kind === 'opened').payload;
    if (!opened.binding_ids.includes(input.binding_id) || !opened.task_ids.includes(input.task_id)) reject('CONTROL_CAMPAIGN_SCOPE_DENIED');
    if (input.resume_from) this.resumeSession(id, input);
    if (
      opened.binding_manifests[input.binding_id] !== engineeringDigest(manifest) ||
      (opened.binding_compositions?.[input.binding_id] || engineeringDigest([])) !== engineeringDigest(binding.subordinateIds)
    )
      reject('CONTROL_PROVIDER_BINDING_DRIFT');
    if (
      this.now() >= state.deadline ||
      state.requests >= state.max_requests ||
      this.rows(id).filter((row) => row.payload.kind === 'reserved' && row.payload.binding_id === input.binding_id).length >=
        manifest.limits.max_requests ||
      manifest.billing.max_request_microusd > state.max_cost_microusd - state.committed_microusd
    )
      reject('CONTROL_CAMPAIGN_BUDGET_EXHAUSTED');
  }
  resumeSession(id, input) {
    const rows = this.rows(id);
    const reserved = rows.find((r) => r.payload.kind === 'reserved' && r.payload.command_id === input.resume_from)?.payload;
    const receipt = rows.find((r) => r.payload.kind === 'receipt' && r.payload.command_id === input.resume_from)?.payload.receipt;
    if (
      !reserved ||
      reserved.binding_id !== input.binding_id ||
      reserved.task_id !== input.task_id ||
      receipt?.status !== 'completed' ||
      !receipt.provider_session_id
    )
      reject('CONTROL_PROVIDER_RESUME_UNAVAILABLE');
    return receipt.provider_session_id;
  }
  async execute(raw) {
    const command = commandSchema.parse(raw);
    const key = `${command.resource_id}:${command.command_id}`;
    const digest = engineeringDigest(command);
    const existing = this.inflight.get(key);
    if (existing) {
      if (existing.digest !== digest) reject('CONTROL_IDEMPOTENCY_CONFLICT');
      return existing.promise;
    }
    let settle;
    const operation = new Promise((resolve) => {
      settle = resolve;
    });
    this.drains.add(operation);
    const promise = Promise.resolve().then(() => this.#executeWithinCampaign(command));
    this.inflight.set(key, { digest, promise });
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
      this.drains.delete(operation);
      settle();
    }
  }
  async #executeWithinCampaign(raw, parent = null) {
    if (parent && (!parent.open || parent.signal.aborted)) reject('CONTROL_CAMPAIGN_CANCELLED');
    const command = commandSchema.parse(raw),
      input = inputs[command.action].parse(command.input);
    const { resource_id: id, command_id: commandId, action } = command;
    if (action === 'run' && this.closing) reject('CONTROL_CAMPAIGN_CANCELLED');
    const digest = engineeringDigest(command);
    const replay = this.replay(id, commandId, digest);
    if (replay) return replay;
    let binding, observed;
    if (action === 'run') {
      binding = this.bindings.get(input.binding_id);
      if (!binding) reject('CONTROL_PROVIDER_BINDING_UNKNOWN');
      this.admitDispatch(id, input, binding, parent);
      if (binding.adapter.validateDispatch && binding.adapter.validateDispatch({ task_id: input.task_id, request_id: commandId }) !== true)
        reject('CONTROL_PROVIDER_DISPATCH_DENIED');
      if (this.inspections.size > 0 || [...this.active.keys()].some((activeId) => activeId !== id)) reject('CONTROL_PROVIDER_BUSY');
      const probe = new AbortController();
      const abortProbe = () => probe.abort();
      parent?.signal.addEventListener('abort', abortProbe, { once: true });
      if (parent?.signal.aborted) probe.abort();
      if (!this.inspections.has(id)) this.inspections.set(id, new Set());
      this.inspections.get(id).add(probe);
      try {
        observed = observationSchema.parse(await binding.adapter.inspect({ signal: probe.signal }));
      } catch {
        reject('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
      } finally {
        parent?.signal.removeEventListener('abort', abortProbe);
        this.inspections.get(id).delete(probe);
        if (this.inspections.get(id).size === 0) this.inspections.delete(id);
      }
      const { manifest } = binding;
      if (
        observed.binding_sha256 !== manifest.binding_sha256 ||
        observed.artifact_sha256 !== manifest.artifact_sha256 ||
        observed.provider_version !== manifest.provider_version
      )
        reject('CONTROL_PROVIDER_BINDING_DRIFT');
      if (
        !observed.authenticated ||
        observed.competing_credentials ||
        observed.auth_source !== manifest.authentication.source ||
        (manifest.authentication.identity_kind === 'credential'
          ? observed.credential_sha256 !== manifest.authentication.credential_sha256
          : manifest.authentication.identity_kind === 'local_profile'
            ? observed.profile_sha256 !== manifest.authentication.profile_sha256
            : observed.account_sha256 !== manifest.authentication.account_sha256)
      )
        reject('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
      this.assertFreshObservation(observed);
      this.quotaAdmission(id, binding, observed);
    }
    if (action === 'run' && this.closing) reject('CONTROL_CAMPAIGN_CANCELLED');
    const claimed = this.control.handle.db
      .transaction(() => {
        const prior = this.replay(id, commandId, digest);
        if (prior) return { replay: prior };
        if (this.rows(id).length !== command.expected_sequence) reject('CONTROL_SEQUENCE_CONFLICT');
        if (action === 'create') {
          if (this.rows(id).length > 0) reject('CONTROL_SEQUENCE_CONFLICT');
          const authorization = this.authorizations.get(input.authorization_id);
          if (!authorization || authorization.deadline <= this.now()) reject('CONTROL_CAMPAIGN_AUTHORIZATION_REQUIRED');
          if (this.control.ledger.readStream('control_provider_authorization', input.authorization_id).length > 0)
            reject('CONTROL_CAMPAIGN_AUTHORIZATION_USED');
          const pinned = Object.fromEntries(
            authorization.binding_ids.map((bindingId) => {
              if (!this.bindings.has(bindingId)) reject('CONTROL_PROVIDER_BINDING_UNKNOWN');
              return [bindingId, engineeringDigest(this.bindings.get(bindingId).manifest)];
            }),
          );
          this.append(input.authorization_id, { kind: 'claimed', campaign_id: id }, 'control_provider_authorization');
          this.append(id, {
            kind: 'opened',
            ...authorization,
            binding_manifests: pinned,
            binding_compositions: Object.fromEntries(
              authorization.binding_ids.map((key) => [key, engineeringDigest(this.bindings.get(key).subordinateIds)]),
            ),
            authorization_id: input.authorization_id,
          });
        } else {
          const state = this.query(id);
          if (action === 'run') {
            this.admitDispatch(id, input, binding, parent);
            this.assertFreshObservation(observed);
            const { manifest } = binding;
            this.append(id, {
              kind: 'reserved',
              command_id: commandId,
              digest,
              task_id: input.task_id,
              binding_id: input.binding_id,
              manifest_sha256: engineeringDigest(manifest),
              observation_sha256: engineeringDigest(observed),
              quota_admission: this.quotaAdmission(id, binding, observed),
              observation: {
                observed_at: observed.observed_at,
                expires_at: observed.expires_at,
                quota_remaining_requests: observed.quota_remaining_requests,
                quota_available_microusd: observed.quota_available_microusd ?? null,
                quota_windows: observed.quota_windows ?? null,
              },
              owner: executorOwner(),
              reserved_microusd: manifest.billing.max_request_microusd,
              parent_command_id: parent?.commandId || null,
            });
            return {};
          }
          if (
            action === 'reconcile' &&
            (this.active.has(id) || state.live_commands.length > 0 || state.report_sha256 !== input.report_sha256)
          )
            reject('CONTROL_RECONCILIATION_CONFLICT');
        }
        this.append(id, { kind: 'intent', command_id: commandId, digest });
        if (action === 'cancel') this.append(id, { kind: 'cancelled' });
        if (action === 'reconcile')
          this.append(id, {
            kind: 'reconciled',
            command_ids: this.query(id).unresolved_commands,
            answer: input.answer,
            report_sha256: input.report_sha256,
          });
        const result = { resource_id: id, action };
        this.append(id, { kind: 'done', command_id: commandId, result });
        return { result };
      })
      .immediate();
    if (claimed.replay) return claimed.replay;
    if (action === 'cancel') {
      for (const controller of this.active.get(id) || []) controller.abort();
      for (const controller of this.inspections.get(id) || []) controller.abort();
    }
    if (action !== 'run') return claimed.result;
    let settle;
    const drained = new Promise((resolve) => {
      settle = resolve;
    });
    this.drains.add(drained);
    const abort = new AbortController();
    if (!this.active.has(id)) this.active.set(id, new Set());
    this.active.get(id).add(abort);
    const relay = () => abort.abort();
    parent?.signal.addEventListener('abort', relay, { once: true });
    if (parent?.signal.aborted) abort.abort();
    const context = { commandId, signal: abort.signal, open: true };
    const children = new Set();
    let childFailure = false;
    const runSubordinate = ({ binding_id }) => {
      if (!context.open || context.signal.aborted)
        return Promise.reject(Object.assign(new Error('CONTROL_CAMPAIGN_CANCELLED'), { code: 'CONTROL_CAMPAIGN_CANCELLED' }));
      if (!binding.subordinateIds.includes(binding_id))
        return Promise.reject(Object.assign(new Error('CONTROL_CAMPAIGN_SCOPE_DENIED'), { code: 'CONTROL_CAMPAIGN_SCOPE_DENIED' }));
      const pending = this.#executeWithinCampaign(
        {
          schema_version: 1,
          command_id: randomUUID(),
          resource_id: id,
          expected_sequence: this.rows(id).length,
          action: 'run',
          input: { binding_id, task_id: input.task_id },
        },
        context,
      );
      children.add(pending);
      pending.then(
        () => children.delete(pending),
        () => {
          childFailure = true;
          children.delete(pending);
        },
      );
      return pending;
    };
    const timeout = setTimeout(
      () => abort.abort(),
      Math.min(binding.manifest.limits.max_duration_ms, this.query(id).deadline - this.now()),
    );
    const cancellation = setInterval(() => {
      if (this.query(id).cancelled) abort.abort();
    }, 50);
    let observedReceipt;
    try {
      if (this.query(id).cancelled || this.now() >= this.query(id).deadline) reject('CONTROL_CAMPAIGN_CANCELLED');
      const { output_text: outputText, ...receiptInput } = await binding.adapter.run({
        task_id: input.task_id,
        request_id: commandId,
        manifest: binding.manifest,
        signal: abort.signal,
        runSubordinate,
        ...(input.resume_from ? { resume_session_id: this.resumeSession(id, input) } : {}),
      });
      const receipt = receiptSchema.parse(receiptInput);
      observedReceipt = receipt;
      context.open = false;
      await Promise.allSettled(children);
      if (childFailure) reject('CONTROL_OUTCOME_UNCERTAIN');
      if (input.resume_from && receipt.provider_session_id !== this.resumeSession(id, input)) reject('CONTROL_PROVIDER_RECEIPT_INVALID');
      if (
        receipt.binding_sha256 !== binding.manifest.binding_sha256 ||
        receipt.input_tokens > binding.manifest.limits.max_input_tokens ||
        receipt.output_tokens > binding.manifest.limits.max_output_tokens ||
        (receipt.cost_microusd !== null && receipt.cost_microusd > binding.manifest.billing.max_request_microusd)
      )
        reject('CONTROL_PROVIDER_RECEIPT_INVALID');
      if (Boolean(receipt.evidence_ref) !== (outputText !== undefined)) reject('CONTROL_PROVIDER_RECEIPT_INVALID');
      const stored = receipt.evidence_ref ? storeEvidence(this.control.state, outputText, receipt.evidence_ref) : null;
      const result = { resource_id: id, action, receipt };
      this.control.handle.db
        .transaction(() => {
          if (stored?.repaired) this.append(id, { kind: 'evidence_repaired', command_id: commandId, sha256: receipt.evidence_ref.sha256 });
          this.append(id, { kind: 'receipt', command_id: commandId, receipt });
          this.append(id, { kind: 'done', command_id: commandId, result });
        })
        .immediate();
      return result;
    } catch {
      context.open = false;
      abort.abort();
      await Promise.allSettled(children);
      this.append(id, { kind: 'uncertain', command_id: commandId, measured_microusd: observedReceipt?.cost_microusd ?? null });
      reject('CONTROL_OUTCOME_UNCERTAIN');
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellation);
      context.open = false;
      parent?.signal.removeEventListener('abort', relay);
      this.active.get(id).delete(abort);
      if (this.active.get(id).size === 0) this.active.delete(id);
      this.drains.delete(drained);
      settle();
    }
  }
}

module.exports = { ProviderCampaignControl, authorizationSchema };

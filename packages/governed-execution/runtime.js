'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { executionEnvelope, failureEnvelope } = require('./canonical-envelope');
const { deterministicOperationId } = require('./operation-id');

const TERMINAL_EVENTS = new Set(['ExecutionSucceeded', 'ExecutionFailed', 'ExecutionCancelled', 'ExecutionOutcomeUncertain']);

class GovernedExecutionError extends Error {
  constructor(message, code = 'EXECUTION_GOVERNANCE_FAILED', details = {}) {
    super(message);
    this.name = 'GovernedExecutionError';
    this.code = code;
    this.details = details;
  }
}

class DispatchDeadlineError extends GovernedExecutionError {
  constructor() {
    super('Provider did not settle before the execution deadline', 'EXECUTION_DEADLINE_EXCEEDED');
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function canonicalTime(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new GovernedExecutionError('Clock returned an invalid timestamp');
  return parsed.toISOString();
}

function providerError(error) {
  const candidate = error && typeof error === 'object' ? error : {};
  return {
    code: typeof candidate.code === 'string' ? candidate.code : 'PROVIDER_EXECUTION_FAILED',
    message: typeof candidate.message === 'string' ? candidate.message : 'Provider execution failed',
    retryable: Boolean(candidate.retryable),
  };
}

function providerMetadata(result) {
  for (const field of ['evidence', 'warnings']) {
    if (result[field] !== undefined && (!Array.isArray(result[field]) || result[field].some((value) => typeof value !== 'string'))) {
      throw new GovernedExecutionError(`Provider ${field} must be an array of strings`, 'EXECUTION_PROVIDER_RESULT_INVALID');
    }
  }
  if (result.receipt_ref !== undefined && (typeof result.receipt_ref !== 'string' || result.receipt_ref.length === 0)) {
    throw new GovernedExecutionError('Provider receipt_ref must be a non-empty string', 'EXECUTION_PROVIDER_RESULT_INVALID');
  }
  return {
    evidence: [...(result.evidence || []), ...(result.receipt_ref ? [result.receipt_ref] : [])],
    warnings: result.warnings || [],
  };
}

class GovernedExecutionRuntime {
  constructor({
    contracts,
    event_registry,
    ledger,
    approval_store,
    authority,
    policy,
    providers,
    approval_resolver = null,
    projector = null,
    clock = { now: () => new Date() },
    event_id_factory = randomUUID,
  }) {
    for (const [field, value] of Object.entries({ contracts, event_registry, ledger, authority, policy, providers })) {
      if (!value) throw new GovernedExecutionError(`Missing runtime dependency: ${field}`);
    }
    this.contracts = contracts;
    if (typeof contracts.seal === 'function') contracts.seal();
    if (typeof event_registry.seal === 'function') event_registry.seal();
    if (ledger.eventRegistry !== event_registry) {
      throw new GovernedExecutionError(
        'Governed execution requires the ledger to share its fail-closed event registry',
        'EXECUTION_EVENT_REGISTRY_BOUNDARY_MISSING',
      );
    }
    if (approval_store && approval_store.db !== ledger.db) {
      throw new GovernedExecutionError(
        'Approval consumption and pre-effect facts must share one SQLite connection',
        'EXECUTION_APPROVAL_LEDGER_TRANSACTION_MISMATCH',
      );
    }
    this.eventRegistry = event_registry;
    this.ledger = ledger;
    this.approvalStore = approval_store;
    this.authority = authority;
    this.policy = policy;
    this.providers = providers;
    this.approvalResolver = approval_resolver;
    this.projector = projector;
    this.clock = clock;
    this.eventIdFactory = event_id_factory;
  }

  _fact(type, operation, payload, evidenceRefs = []) {
    const fact = {
      event_id: this.eventIdFactory(),
      event_type: type,
      schema_version: 1,
      occurred_at: canonicalTime(this.clock.now()),
      correlation_id: operation.correlation_id,
      causation_id: operation.causation_id,
      actor: operation.actor,
      operation_id: operation.operation_id,
      payload,
      evidence_refs: evidenceRefs,
    };
    this.eventRegistry.validateForAppend(fact);
    return fact;
  }

  _readExisting(operation, inputDigest, contract) {
    const existing = this.ledger.readStream('execution', operation.operation_id).map((event) => this.eventRegistry.deserialize(event));
    if (existing.length === 0) return null;
    const authorized = existing.find((event) => event.event_type === 'ExecutionAuthorized');
    if (
      existing.some(
        (event) =>
          event.operation_id !== operation.operation_id ||
          event.correlation_id !== operation.correlation_id ||
          event.causation_id !== operation.causation_id,
      ) ||
      !authorized ||
      authorized.payload.tool !== operation.tool ||
      authorized.payload.idempotency_key !== operation.idempotency_key ||
      authorized.payload.input_digest !== inputDigest ||
      authorized.payload.capability !== contract.capability ||
      authorized.payload.policy_version !== contract.policy_version ||
      authorized.payload.input_schema_version !== contract.input_schema.version ||
      authorized.payload.output_schema_version !== contract.output_schema.version ||
      stableJson(authorized.payload.resource_scope) !== stableJson(operation.resource_scope) ||
      stableJson(authorized.actor) !== stableJson(operation.actor) ||
      authorized.correlation_id !== operation.correlation_id ||
      authorized.causation_id !== operation.causation_id
    ) {
      throw new GovernedExecutionError(
        'Idempotency key is already bound to a different operation scope',
        'EXECUTION_IDEMPOTENCY_SCOPE_CONFLICT',
      );
    }
    const terminal = existing.findLast((event) => TERMINAL_EVENTS.has(event.event_type));
    const allEvidence = existing.flatMap((event) => event.evidence_refs);
    const durableWarnings = terminal ? terminal.payload.warnings : authorized.payload.warnings;
    if (!terminal) {
      return failureEnvelope(
        new GovernedExecutionError(
          'Execution started without a durable terminal fact; automatic replay is prohibited',
          'EXECUTION_OUTCOME_IN_DOUBT',
        ),
        operation.operation_id,
        allEvidence,
        durableWarnings,
      );
    }
    if (terminal.event_type === 'ExecutionSucceeded') {
      return executionEnvelope({
        ok: true,
        data: { operation_id: operation.operation_id, result: terminal.payload.result, replayed: true },
        evidence: allEvidence,
        warnings: durableWarnings,
      });
    }
    const codeByType = {
      ExecutionFailed: terminal.payload.error && terminal.payload.error.code,
      ExecutionCancelled: 'EXECUTION_CANCELLED',
      ExecutionOutcomeUncertain: 'EXECUTION_OUTCOME_IN_DOUBT',
    };
    const replayError = new GovernedExecutionError(
      terminal.payload.reason || (terminal.payload.error && terminal.payload.error.message) || 'Execution did not succeed',
      codeByType[terminal.event_type] || 'EXECUTION_FAILED',
    );
    replayError.retryable = Boolean(terminal.event_type === 'ExecutionFailed' && terminal.payload.error.retryable);
    return failureEnvelope(replayError, operation.operation_id, allEvidence, durableWarnings);
  }

  _appendOutcome(operation, type, payload, evidenceRefs) {
    const fact = this._fact(type, operation, payload, evidenceRefs);
    return this.ledger.append({
      aggregate_type: 'execution',
      aggregate_id: operation.operation_id,
      expected_version: 2,
      events: [fact],
    });
  }

  _persistOutcome(operation, type, payload, evidenceRefs, warnings = []) {
    try {
      this._appendOutcome(operation, type, { ...payload, warnings: [...warnings] }, evidenceRefs);
      return null;
    } catch (error) {
      return error;
    }
  }

  _terminalPersistenceFailure(operationId, evidence, warnings, cause) {
    return failureEnvelope(
      new GovernedExecutionError(
        'Provider dispatch began but the terminal outcome could not be persisted; automatic replay is prohibited',
        'EXECUTION_OUTCOME_IN_DOUBT',
      ),
      operationId,
      evidence,
      [...warnings, `terminal_append_failed:${cause.code || cause.message}`],
    );
  }

  _reconcile(warnings) {
    if (!this.projector) return;
    try {
      this.projector.reconcileActive();
    } catch (error) {
      warnings.push(`projection_reconcile_failed:${error.code || error.message}`);
    }
  }

  async cancelQueued(request) {
    let operationId = null;
    const warnings = [];
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new GovernedExecutionError('Execution request must be an object', 'EXECUTION_REQUEST_INVALID');
      }
      const contract = this.contracts.resolve(request.tool);
      if (contract.failure_mode !== 'fail_closed') {
        throw new GovernedExecutionError(
          `Failure mode ${contract.failure_mode} is reserved but not implemented by execution runtime v1`,
          'EXECUTION_FAILURE_MODE_NOT_IMPLEMENTED',
        );
      }
      if (contract.cancellation_policy !== 'cooperative') {
        throw new GovernedExecutionError('Tool contract does not permit cancellation', 'EXECUTION_CANCELLATION_REFUSED');
      }
      const input = this.contracts.validateInput(contract, request.input);
      if (
        !request.actor ||
        typeof request.actor !== 'object' ||
        Array.isArray(request.actor) ||
        typeof request.actor.id !== 'string' ||
        request.actor.id.length === 0 ||
        typeof request.actor.type !== 'string' ||
        request.actor.type.length === 0
      ) {
        throw new GovernedExecutionError('actor must declare non-empty id and type', 'EXECUTION_REQUEST_INVALID');
      }
      if (
        !request.resource_scope ||
        typeof request.resource_scope !== 'object' ||
        Array.isArray(request.resource_scope) ||
        Object.keys(request.resource_scope).length === 0
      ) {
        throw new GovernedExecutionError('resource_scope must be a non-empty object', 'EXECUTION_REQUEST_INVALID');
      }
      const authorityDecision = await this.authority.evaluate({
        contract,
        actor: request.actor,
        resource_scope: request.resource_scope,
      });
      if (!authorityDecision || authorityDecision.allowed !== true) {
        throw new GovernedExecutionError('Authority evaluation denied cancellation', 'EXECUTION_AUTHORITY_DENIED');
      }
      const policyDecision = await this.policy.evaluate({
        contract,
        input,
        actor: request.actor,
        resource_scope: request.resource_scope,
      });
      if (!policyDecision || policyDecision.allowed !== true) {
        throw new GovernedExecutionError('Policy evaluation denied cancellation', 'EXECUTION_POLICY_DENIED');
      }
      if (policyDecision.policy_version !== contract.policy_version) {
        throw new GovernedExecutionError('Policy version does not match the tool contract', 'EXECUTION_POLICY_VERSION_MISMATCH');
      }
      if (
        (policyDecision.requires_approval !== undefined && typeof policyDecision.requires_approval !== 'boolean') ||
        (policyDecision.warnings !== undefined &&
          (!Array.isArray(policyDecision.warnings) || policyDecision.warnings.some((warning) => typeof warning !== 'string')))
      ) {
        throw new GovernedExecutionError('Policy decision has an invalid shape', 'EXECUTION_POLICY_DECISION_INVALID');
      }
      warnings.push(...(policyDecision.warnings || []));
      const idempotencyKey = request.idempotency_key;
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        throw new GovernedExecutionError('Queued cancellation requires its original idempotency key', 'EXECUTION_REQUEST_INVALID');
      }
      operationId = deterministicOperationId(contract.name, idempotencyKey);
      const startedAt = canonicalTime(this.clock.now());
      const deadline = new Date(new Date(startedAt).getTime() + contract.timeout_ms).toISOString();
      const operation = {
        operation_id: operationId,
        tool: contract.name,
        capability: contract.capability,
        actor: request.actor,
        resource_scope: request.resource_scope,
        idempotency_key: idempotencyKey,
        correlation_id: request.correlation_id || operationId,
        causation_id: request.causation_id || `scheduler-cancel:${operationId}`,
        deadline,
      };
      const inputDigest = digest(input);
      const replay = this._readExisting(operation, inputDigest, contract);
      if (replay) return replay;
      const facts = [
        this._fact('ExecutionAuthorized', operation, {
          tool: contract.name,
          capability: contract.capability,
          input_schema_version: contract.input_schema.version,
          output_schema_version: contract.output_schema.version,
          reversibility: contract.reversibility,
          policy_version: contract.policy_version,
          deadline,
          cancellation_policy: contract.cancellation_policy,
          idempotency_key: idempotencyKey,
          resource_scope: request.resource_scope,
          input_digest: inputDigest,
          warnings: [...warnings],
        }),
        this._fact('ExecutionStarted', operation, {
          tool: contract.name,
          provider: contract.provider,
          idempotency_key: idempotencyKey,
          dispatch_attempt: 1,
          deadline,
        }),
        this._fact('ExecutionCancelled', operation, {
          reason: 'cancelled by governed scheduler before provider dispatch',
          phase: 'scheduler_queue',
          warnings: [...warnings],
        }),
      ];
      this.ledger.append({
        aggregate_type: 'execution',
        aggregate_id: operationId,
        expected_version: 0,
        events: facts,
      });
      this._reconcile(warnings);
      return failureEnvelope(
        new GovernedExecutionError('Execution cancelled before provider dispatch', 'EXECUTION_CANCELLED'),
        operationId,
        [],
        warnings,
      );
    } catch (error) {
      return failureEnvelope(error, operationId, [], warnings);
    }
  }

  async execute(request) {
    let operationId = null;
    let providerDispatchBegan = false;
    let operationEvidence = [];
    const warnings = [];
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new GovernedExecutionError('Execution request must be an object', 'EXECUTION_REQUEST_INVALID');
      }
      const contract = this.contracts.resolve(request.tool);
      if (contract.failure_mode !== 'fail_closed') {
        throw new GovernedExecutionError(
          `Failure mode ${contract.failure_mode} is reserved but not implemented by execution runtime v1`,
          'EXECUTION_FAILURE_MODE_NOT_IMPLEMENTED',
        );
      }
      let provider;
      try {
        provider = this.providers.get ? this.providers.get(contract.provider) : this.providers[contract.provider];
      } catch (error) {
        throw new GovernedExecutionError('Provider registry lookup failed', 'EXECUTION_PROVIDER_RESOLUTION_FAILED', {
          cause: error.message,
        });
      }
      if (!provider || typeof provider.execute !== 'function') {
        throw new GovernedExecutionError('Provider is unavailable', 'EXECUTION_PROVIDER_NOT_FOUND');
      }
      const input = this.contracts.validateInput(contract, request.input);
      if (!request.actor || typeof request.actor !== 'object' || Array.isArray(request.actor)) {
        throw new GovernedExecutionError('actor must be an object', 'EXECUTION_REQUEST_INVALID');
      }
      if (
        typeof request.actor.id !== 'string' ||
        request.actor.id.length === 0 ||
        typeof request.actor.type !== 'string' ||
        request.actor.type.length === 0
      ) {
        throw new GovernedExecutionError('actor must declare non-empty id and type', 'EXECUTION_REQUEST_INVALID');
      }
      if (!request.resource_scope || typeof request.resource_scope !== 'object' || Array.isArray(request.resource_scope)) {
        throw new GovernedExecutionError('resource_scope must be an object', 'EXECUTION_REQUEST_INVALID');
      }
      if (Object.keys(request.resource_scope).length === 0) {
        throw new GovernedExecutionError('resource_scope must not be empty', 'EXECUTION_REQUEST_INVALID');
      }
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) {
        throw new GovernedExecutionError('signal must implement the AbortSignal contract', 'EXECUTION_REQUEST_INVALID');
      }

      const authorityDecision = await this.authority.evaluate({ contract, actor: request.actor, resource_scope: request.resource_scope });
      if (!authorityDecision || authorityDecision.allowed !== true) {
        throw new GovernedExecutionError('Authority evaluation denied execution', 'EXECUTION_AUTHORITY_DENIED');
      }
      const policyDecision = await this.policy.evaluate({ contract, input, actor: request.actor, resource_scope: request.resource_scope });
      if (!policyDecision || policyDecision.allowed !== true) {
        throw new GovernedExecutionError('Policy evaluation denied execution', 'EXECUTION_POLICY_DENIED');
      }
      if (policyDecision.policy_version !== contract.policy_version) {
        throw new GovernedExecutionError('Policy version does not match the tool contract', 'EXECUTION_POLICY_VERSION_MISMATCH');
      }
      if (
        (policyDecision.requires_approval !== undefined && typeof policyDecision.requires_approval !== 'boolean') ||
        (policyDecision.warnings !== undefined &&
          (!Array.isArray(policyDecision.warnings) || policyDecision.warnings.some((warning) => typeof warning !== 'string')))
      ) {
        throw new GovernedExecutionError('Policy decision has an invalid shape', 'EXECUTION_POLICY_DECISION_INVALID');
      }
      warnings.push(...(policyDecision.warnings || []));

      const idempotencyKey = request.idempotency_key === undefined ? randomUUID() : request.idempotency_key;
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        throw new GovernedExecutionError('idempotency_key must be a non-empty string', 'EXECUTION_REQUEST_INVALID');
      }
      operationId = deterministicOperationId(contract.name, idempotencyKey);
      const startedAt = canonicalTime(this.clock.now());
      const deadline = new Date(new Date(startedAt).getTime() + contract.timeout_ms).toISOString();
      const operation = {
        operation_id: operationId,
        tool: contract.name,
        capability: contract.capability,
        actor: request.actor,
        resource_scope: request.resource_scope,
        idempotency_key: idempotencyKey,
        correlation_id: request.correlation_id || operationId,
        causation_id: request.causation_id || `request:${operationId}`,
        deadline,
      };
      const inputDigest = digest(input);
      const replay = this._readExisting(operation, inputDigest, contract);
      if (replay) return replay;

      const requiresApproval =
        contract.requires_approval ||
        contract.reversibility === 'irreversible_mutation' ||
        (contract.reversibility !== 'read_only' && !contract.provider_accepts_idempotency) ||
        policyDecision.requires_approval === true;
      let approvalId = null;
      let approvalEvidence = [];
      let approval = null;
      if (requiresApproval) {
        if (!this.approvalStore || typeof this.approvalResolver !== 'function') {
          throw new GovernedExecutionError(
            'Explicit approval is required but no approval boundary is available',
            'EXECUTION_APPROVAL_REQUIRED',
          );
        }
        approvalId = await this.approvalResolver(
          { ...operation, policy_version: contract.policy_version },
          request.approval_context || null,
        );
        if (typeof approvalId !== 'string' || approvalId.length === 0) {
          throw new GovernedExecutionError('Explicit approval is required', 'EXECUTION_APPROVAL_REQUIRED');
        }
        approval = this.approvalStore.get(approvalId);
        approvalEvidence = approval ? [approval.evidence_ref] : [];
      }

      const authorized = this._fact(
        'ExecutionAuthorized',
        operation,
        {
          tool: contract.name,
          capability: contract.capability,
          input_schema_version: contract.input_schema.version,
          output_schema_version: contract.output_schema.version,
          reversibility: contract.reversibility,
          policy_version: contract.policy_version,
          deadline,
          cancellation_policy: contract.cancellation_policy,
          idempotency_key: idempotencyKey,
          resource_scope: request.resource_scope,
          input_digest: inputDigest,
          warnings: [...warnings],
          ...(approvalId ? { approval_id: approvalId } : {}),
        },
        approvalEvidence,
      );
      const started = this._fact('ExecutionStarted', operation, {
        tool: contract.name,
        provider: contract.provider,
        idempotency_key: idempotencyKey,
        dispatch_attempt: 1,
        deadline,
      });
      const appendStartFacts = () =>
        this.ledger.append({
          aggregate_type: 'execution',
          aggregate_id: operationId,
          expected_version: 0,
          events: [authorized, started],
        });
      if (requiresApproval) {
        approval = this.approvalStore.consume(
          {
            approval_id: approvalId,
            operation_id: operationId,
            resource_scope: request.resource_scope,
            policy_version: contract.policy_version,
            now: canonicalTime(this.clock.now()),
          },
          appendStartFacts,
        );
        approvalEvidence = [approval.evidence_ref];
      } else {
        appendStartFacts();
      }
      operationEvidence = [...approvalEvidence];

      if (request.signal && request.signal.aborted && contract.cancellation_policy === 'cooperative') {
        const persistenceError = this._persistOutcome(
          operation,
          'ExecutionCancelled',
          { reason: 'cancelled before provider dispatch', phase: 'pre_dispatch' },
          [],
          warnings,
        );
        if (persistenceError) return this._terminalPersistenceFailure(operationId, approvalEvidence, warnings, persistenceError);
        this._reconcile(warnings);
        return failureEnvelope(
          new GovernedExecutionError('Execution cancelled', 'EXECUTION_CANCELLED'),
          operationId,
          approvalEvidence,
          warnings,
        );
      }

      const remainingMs = new Date(deadline).getTime() - new Date(canonicalTime(this.clock.now())).getTime();
      if (remainingMs <= 0) {
        const persistenceError = this._persistOutcome(
          operation,
          'ExecutionCancelled',
          { reason: 'execution deadline expired before provider dispatch', phase: 'pre_dispatch' },
          [],
          warnings,
        );
        if (persistenceError) return this._terminalPersistenceFailure(operationId, approvalEvidence, warnings, persistenceError);
        this._reconcile(warnings);
        return failureEnvelope(new DispatchDeadlineError(), operationId, approvalEvidence, warnings);
      }

      const controller = new AbortController();
      const forwardAbort = () => controller.abort(request.signal.reason);
      const forwardsCancellation = request.signal && contract.cancellation_policy === 'cooperative';
      if (forwardsCancellation) request.signal.addEventListener('abort', forwardAbort, { once: true });
      let timeoutId;
      let deadlineExceeded = false;
      const deadlinePromise = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          deadlineExceeded = true;
          controller.abort(new DispatchDeadlineError());
          reject(new DispatchDeadlineError());
        }, remainingMs);
      });

      let providerResult;
      try {
        providerDispatchBegan = true;
        providerResult = await Promise.race([
          provider.execute(input, {
            operation_id: operationId,
            idempotency_key: idempotencyKey,
            deadline,
            signal: controller.signal,
            sandbox: contract.sandbox,
            resource_scope: request.resource_scope,
          }),
          deadlinePromise,
        ]);
      } catch (error) {
        const providerFailure = error && typeof error === 'object' ? error : {};
        const normalized = providerError(error);
        const validReceiptRef =
          typeof providerFailure.receipt_ref === 'string' && providerFailure.receipt_ref.length > 0 ? providerFailure.receipt_ref : null;
        if (providerFailure.receipt_ref !== undefined && !validReceiptRef) warnings.push('provider_error_receipt_ref_invalid');
        const outcome = deadlineExceeded
          ? 'uncertain'
          : providerFailure.outcome || (contract.reversibility === 'read_only' ? 'failed' : 'uncertain');
        const receiptRefs = validReceiptRef ? [validReceiptRef] : [];
        const typeByOutcome = {
          cancelled: 'ExecutionCancelled',
          failed: 'ExecutionFailed',
          uncertain: 'ExecutionOutcomeUncertain',
        };
        const type = typeByOutcome[outcome] || 'ExecutionOutcomeUncertain';
        const payloadByType = {
          ExecutionCancelled: {
            reason: normalized.message,
            phase: 'dispatch',
            ...(validReceiptRef ? { provider_receipt_ref: validReceiptRef } : {}),
          },
          ExecutionFailed: { error: normalized, ...(validReceiptRef ? { provider_receipt_ref: validReceiptRef } : {}) },
          ExecutionOutcomeUncertain: {
            reason: deadlineExceeded ? 'provider deadline exceeded after dispatch began' : normalized.message,
            ...(validReceiptRef ? { provider_receipt_ref: validReceiptRef } : {}),
          },
        };
        const persistenceError = this._persistOutcome(operation, type, payloadByType[type], receiptRefs, warnings);
        if (persistenceError) {
          return this._terminalPersistenceFailure(operationId, [...approvalEvidence, ...receiptRefs], warnings, persistenceError);
        }
        this._reconcile(warnings);
        const resultError =
          type === 'ExecutionOutcomeUncertain'
            ? new GovernedExecutionError(payloadByType[type].reason, 'EXECUTION_OUTCOME_IN_DOUBT')
            : new GovernedExecutionError(normalized.message, type === 'ExecutionCancelled' ? 'EXECUTION_CANCELLED' : normalized.code);
        resultError.retryable = Boolean(type === 'ExecutionFailed' && normalized.retryable);
        return failureEnvelope(resultError, operationId, [...approvalEvidence, ...receiptRefs], warnings);
      } finally {
        clearTimeout(timeoutId);
        if (forwardsCancellation) request.signal.removeEventListener('abort', forwardAbort);
      }

      if (!providerResult || typeof providerResult !== 'object' || !Object.hasOwn(providerResult, 'data')) {
        const uncertain = contract.reversibility !== 'read_only';
        const invalidResult = new GovernedExecutionError('Provider result must contain data', 'EXECUTION_PROVIDER_RESULT_INVALID');
        const persistenceError = this._persistOutcome(
          operation,
          uncertain ? 'ExecutionOutcomeUncertain' : 'ExecutionFailed',
          uncertain
            ? { reason: invalidResult.message }
            : { error: { code: invalidResult.code, message: invalidResult.message, retryable: false } },
          [],
          warnings,
        );
        if (persistenceError) return this._terminalPersistenceFailure(operationId, approvalEvidence, warnings, persistenceError);
        this._reconcile(warnings);
        return failureEnvelope(
          new GovernedExecutionError(invalidResult.message, uncertain ? 'EXECUTION_OUTCOME_IN_DOUBT' : invalidResult.code),
          operationId,
          approvalEvidence,
          warnings,
        );
      }
      let metadata;
      try {
        metadata = providerMetadata(providerResult);
      } catch (error) {
        const uncertain = contract.reversibility !== 'read_only';
        const persistenceError = this._persistOutcome(
          operation,
          uncertain ? 'ExecutionOutcomeUncertain' : 'ExecutionFailed',
          uncertain ? { reason: error.message } : { error: { code: error.code, message: error.message, retryable: false } },
          [],
          warnings,
        );
        if (persistenceError) return this._terminalPersistenceFailure(operationId, approvalEvidence, warnings, persistenceError);
        this._reconcile(warnings);
        return failureEnvelope(
          new GovernedExecutionError(error.message, uncertain ? 'EXECUTION_OUTCOME_IN_DOUBT' : error.code),
          operationId,
          approvalEvidence,
          warnings,
        );
      }
      const evidence = [...approvalEvidence, ...metadata.evidence];
      operationEvidence = evidence;
      warnings.push(...metadata.warnings);
      let output;
      try {
        output = this.contracts.validateOutput(contract, providerResult.data);
      } catch (error) {
        const uncertain = contract.reversibility !== 'read_only';
        const persistenceError = this._persistOutcome(
          operation,
          uncertain ? 'ExecutionOutcomeUncertain' : 'ExecutionFailed',
          uncertain
            ? {
                reason: 'provider completed but output schema validation failed',
                ...(providerResult.receipt_ref ? { provider_receipt_ref: providerResult.receipt_ref } : {}),
              }
            : { error: { code: error.code, message: error.message, retryable: false } },
          providerResult.receipt_ref ? [providerResult.receipt_ref] : [],
          warnings,
        );
        if (persistenceError) return this._terminalPersistenceFailure(operationId, evidence, warnings, persistenceError);
        this._reconcile(warnings);
        return failureEnvelope(
          new GovernedExecutionError(error.message, uncertain ? 'EXECUTION_OUTCOME_IN_DOUBT' : error.code),
          operationId,
          evidence,
          warnings,
        );
      }

      const persistenceError = this._persistOutcome(
        operation,
        'ExecutionSucceeded',
        {
          result: output,
          output_schema_version: contract.output_schema.version,
          ...(providerResult.receipt_ref ? { provider_receipt_ref: providerResult.receipt_ref } : {}),
        },
        evidence,
        warnings,
      );
      if (persistenceError) {
        return this._terminalPersistenceFailure(operationId, evidence, warnings, persistenceError);
      }
      this._reconcile(warnings);
      return executionEnvelope({ ok: true, data: { operation_id: operationId, result: output, replayed: false }, evidence, warnings });
    } catch (error) {
      if (providerDispatchBegan) return this._terminalPersistenceFailure(operationId, operationEvidence, warnings, error);
      return failureEnvelope(error, operationId, [], warnings);
    }
  }
}

module.exports = {
  deterministicOperationId,
  DispatchDeadlineError,
  GovernedExecutionError,
  GovernedExecutionRuntime,
};

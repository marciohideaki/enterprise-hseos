'use strict';

class EventSchemaError extends Error {
  constructor(message, code = 'EXECUTION_EVENT_SCHEMA_INVALID', details = {}) {
    super(message);
    this.name = 'EventSchemaError';
    this.code = code;
    this.details = details;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EventSchemaError(`${label} must be an object`);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function assertStrictJson(value, path = 'payload', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EventSchemaError(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== 'object') throw new EventSchemaError(`${path} contains a non-JSON value`);
  if (ancestors.has(value)) throw new EventSchemaError(`${path} contains a cycle`);
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new EventSchemaError(`${path} must contain only plain objects`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new EventSchemaError(`${path} contains a sparse array`);
      assertStrictJson(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    for (const [key, nested] of Object.entries(value)) assertStrictJson(nested, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function canonicalClone(value) {
  assertStrictJson(value);
  let encoded;
  try {
    encoded = JSON.stringify(stableValue(value));
  } catch (error) {
    throw new EventSchemaError('Event payload must be strict JSON', 'EXECUTION_EVENT_PAYLOAD_INVALID', { cause: error.message });
  }
  if (encoded === undefined) throw new EventSchemaError('Event payload must be strict JSON', 'EXECUTION_EVENT_PAYLOAD_INVALID');
  return JSON.parse(encoded);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function normalizeUpcaster(eventType, version, upcaster) {
  assertPlainObject(upcaster, `${eventType} v${version} upcaster`);
  const unknown = Object.keys(upcaster).filter((key) => !['add', 'remove', 'rename'].includes(key));
  if (unknown.length > 0) {
    throw new EventSchemaError(`Unsupported upcaster operation for ${eventType} v${version}`, 'EXECUTION_EVENT_UPCAST_INVALID', {
      operations: unknown,
    });
  }
  const rename = upcaster.rename || {};
  const add = upcaster.add || {};
  const remove = upcaster.remove || [];
  assertPlainObject(rename, `${eventType} v${version} upcaster.rename`);
  assertPlainObject(add, `${eventType} v${version} upcaster.add`);
  if (!Array.isArray(remove) || remove.some((field) => typeof field !== 'string' || field.length === 0)) {
    throw new EventSchemaError(`Invalid remove operation for ${eventType} v${version}`, 'EXECUTION_EVENT_UPCAST_INVALID');
  }
  for (const [from, to] of Object.entries(rename)) {
    if (from.length === 0 || typeof to !== 'string' || to.length === 0) {
      throw new EventSchemaError(`Invalid rename operation for ${eventType} v${version}`, 'EXECUTION_EVENT_UPCAST_INVALID');
    }
  }
  return deepFreeze({ rename: canonicalClone(rename), add: canonicalClone(add), remove: [...new Set(remove)].sort() });
}

function applyDeclarativeUpcaster(payload, upcaster) {
  const result = canonicalClone(payload);
  for (const [from, to] of Object.entries(upcaster.rename).sort(([left], [right]) => left.localeCompare(right))) {
    if (!Object.hasOwn(result, from) || (from !== to && Object.hasOwn(result, to))) {
      throw new EventSchemaError('Upcaster rename precondition failed', 'EXECUTION_EVENT_UPCAST_PRECONDITION_FAILED', { from, to });
    }
    result[to] = result[from];
    if (from !== to) delete result[from];
  }
  for (const field of upcaster.remove) delete result[field];
  for (const [field, value] of Object.entries(upcaster.add).sort(([left], [right]) => left.localeCompare(right))) {
    if (Object.hasOwn(result, field)) {
      throw new EventSchemaError('Upcaster add precondition failed', 'EXECUTION_EVENT_UPCAST_PRECONDITION_FAILED', { field });
    }
    result[field] = canonicalClone(value);
  }
  return result;
}

function validatePayload(eventType, version, schema, payload) {
  assertPlainObject(payload, `${eventType} v${version} payload`);
  const keys = Object.keys(payload);
  const unknown = keys.filter((key) => !schema.allowed_fields.includes(key));
  const missing = schema.required_fields.filter((key) => !Object.hasOwn(payload, key));
  if (unknown.length > 0 || missing.length > 0) {
    throw new EventSchemaError(`Payload does not match ${eventType} v${version}`, 'EXECUTION_EVENT_PAYLOAD_INVALID', {
      event_type: eventType,
      schema_version: version,
      unknown_fields: unknown.sort(),
      missing_fields: missing.sort(),
    });
  }
  if (schema.validate) schema.validate(canonicalClone(payload));
}

class ExecutionEventRegistry {
  constructor(definitions = []) {
    this._definitions = new Map();
    this._sealed = false;
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    if (this._sealed) throw new EventSchemaError('Event registry is sealed', 'EXECUTION_EVENT_REGISTRY_SEALED');
    assertPlainObject(definition, 'event definition');
    const { event_type: eventType, current_version: currentVersion, versions, upcasters = {} } = definition;
    if (typeof eventType !== 'string' || eventType.length === 0 || !Number.isInteger(currentVersion) || currentVersion < 1) {
      throw new EventSchemaError('Event definition requires event_type and a positive current_version');
    }
    if (this._definitions.has(eventType)) {
      throw new EventSchemaError(`Event type already registered: ${eventType}`, 'EXECUTION_EVENT_SCHEMA_DUPLICATE');
    }
    assertPlainObject(versions, `${eventType} versions`);
    const normalizedVersions = new Map();
    for (const [rawVersion, schema] of Object.entries(versions)) {
      const version = Number(rawVersion);
      assertPlainObject(schema, `${eventType} v${version} schema`);
      if (!Number.isInteger(version) || version < 1 || !Array.isArray(schema.allowed_fields) || !Array.isArray(schema.required_fields)) {
        throw new EventSchemaError(`Invalid schema registration for ${eventType} v${rawVersion}`);
      }
      const classifications = schema.classifications || {};
      const unclassified = schema.allowed_fields.filter((field) => typeof classifications[field] !== 'string');
      if (unclassified.length > 0) {
        throw new EventSchemaError(`Every ${eventType} v${version} field requires a data classification`, 'EXECUTION_EVENT_FIELD_UNCLASSIFIED', {
          fields: unclassified,
        });
      }
      normalizedVersions.set(version, {
        allowed_fields: [...new Set(schema.allowed_fields)],
        required_fields: [...new Set(schema.required_fields)],
        classifications: { ...classifications },
        validate: schema.validate || null,
      });
    }
    if (!normalizedVersions.has(currentVersion)) {
      throw new EventSchemaError(`Current schema is missing for ${eventType} v${currentVersion}`);
    }
    for (let version = 1; version < currentVersion; version++) {
      if (!normalizedVersions.has(version) || !upcasters[version]) {
        throw new EventSchemaError(`Missing deterministic upcaster for ${eventType} v${version}`);
      }
    }
    this._definitions.set(eventType, {
      event_type: eventType,
      current_version: currentVersion,
      versions: normalizedVersions,
      upcasters: new Map(
        Object.entries(upcasters).map(([version, upcast]) => [Number(version), normalizeUpcaster(eventType, Number(version), upcast)]),
      ),
    });
    return this;
  }

  definition(eventType) {
    const definition = this._definitions.get(eventType);
    if (!definition) {
      throw new EventSchemaError(`Unregistered event type: ${eventType}`, 'EXECUTION_EVENT_TYPE_UNREGISTERED', {
        event_type: eventType,
      });
    }
    return definition;
  }

  validateForAppend(event) {
    assertPlainObject(event, 'event');
    const definition = this.definition(event.event_type);
    if (event.schema_version !== definition.current_version) {
      throw new EventSchemaError(
        `New ${event.event_type} facts must use schema v${definition.current_version}`,
        'EXECUTION_EVENT_SCHEMA_NOT_CURRENT',
        { event_type: event.event_type, actual: event.schema_version, expected: definition.current_version },
      );
    }
    validatePayload(event.event_type, event.schema_version, definition.versions.get(event.schema_version), event.payload);
    return event;
  }

  deserialize(event) {
    assertPlainObject(event, 'event');
    const definition = this.definition(event.event_type);
    if (!Number.isInteger(event.schema_version) || !definition.versions.has(event.schema_version)) {
      throw new EventSchemaError(
        `Unsupported ${event.event_type} schema v${event.schema_version}`,
        'EXECUTION_EVENT_SCHEMA_UNSUPPORTED',
        { event_type: event.event_type, schema_version: event.schema_version },
      );
    }
    let version = event.schema_version;
    let payload = canonicalClone(event.payload);
    validatePayload(event.event_type, version, definition.versions.get(version), payload);
    while (version < definition.current_version) {
      payload = applyDeclarativeUpcaster(payload, definition.upcasters.get(version));
      version++;
      validatePayload(event.event_type, version, definition.versions.get(version), payload);
    }
    return { ...event, schema_version: version, payload };
  }

  describe() {
    return [...this._definitions.values()]
      .map((definition) => ({
        event_type: definition.event_type,
        current_version: definition.current_version,
        supported_versions: [...definition.versions.keys()].sort((a, b) => a - b),
      }))
      .sort((a, b) => a.event_type.localeCompare(b.event_type));
  }

  seal() {
    this._sealed = true;
    return this;
  }

  get sealed() {
    return this._sealed;
  }
}

function schema(allowedFields, requiredFields = allowedFields, validate = null) {
  return {
    allowed_fields: allowedFields,
    required_fields: requiredFields,
    classifications: Object.fromEntries(allowedFields.map((field) => [field, field.endsWith('_ref') ? 'reference' : 'operational'])),
    validate,
  };
}

function requireStringFields(fields) {
  return (payload) => {
    for (const field of fields) {
      if (typeof payload[field] !== 'string' || payload[field].length === 0) {
        throw new EventSchemaError(`${field} must be a non-empty string`, 'EXECUTION_EVENT_PAYLOAD_INVALID', { field });
      }
    }
  };
}

function combineValidators(...validators) {
  return (payload) => {
    for (const validate of validators.filter(Boolean)) validate(payload);
  };
}

function requirePositiveIntegers(fields) {
  return (payload) => {
    for (const field of fields) {
      if (!Number.isInteger(payload[field]) || payload[field] < 1) {
        throw new EventSchemaError(`${field} must be a positive integer`, 'EXECUTION_EVENT_PAYLOAD_INVALID', { field });
      }
    }
  };
}

function requireOptionalStrings(fields) {
  return (payload) => {
    for (const field of fields) {
      if (Object.hasOwn(payload, field) && (typeof payload[field] !== 'string' || payload[field].length === 0)) {
        throw new EventSchemaError(`${field} must be a non-empty string`, 'EXECUTION_EVENT_PAYLOAD_INVALID', { field });
      }
    }
  };
}

function requireObjectField(field) {
  return (payload) => assertPlainObject(payload[field], field);
}

function requireStringArrayField(field) {
  return (payload) => {
    if (!Array.isArray(payload[field]) || payload[field].some((value) => typeof value !== 'string')) {
      throw new EventSchemaError(`${field} must be an array of strings`, 'EXECUTION_EVENT_PAYLOAD_INVALID', { field });
    }
  };
}

function validateError(payload) {
  assertPlainObject(payload.error, 'error');
  const keys = Object.keys(payload.error);
  if (keys.some((key) => !['code', 'message', 'retryable'].includes(key))) {
    throw new EventSchemaError('error contains an unknown field', 'EXECUTION_EVENT_PAYLOAD_INVALID');
  }
  requireStringFields(['code', 'message'])(payload.error);
  if (typeof payload.error.retryable !== 'boolean') {
    throw new EventSchemaError('error.retryable must be a boolean', 'EXECUTION_EVENT_PAYLOAD_INVALID');
  }
}

function createExecutionEventRegistry() {
  const lifecycle = [
    {
      event_type: 'ExecutionAuthorized',
      fields: [
        'tool',
        'capability',
        'input_schema_version',
        'output_schema_version',
        'reversibility',
        'policy_version',
        'deadline',
        'cancellation_policy',
        'idempotency_key',
        'resource_scope',
        'input_digest',
        'approval_id',
        'warnings',
      ],
      required: [
        'tool',
        'capability',
        'input_schema_version',
        'output_schema_version',
        'reversibility',
        'policy_version',
        'deadline',
        'cancellation_policy',
        'idempotency_key',
        'resource_scope',
        'input_digest',
        'warnings',
      ],
      strings: ['tool', 'capability', 'reversibility', 'policy_version', 'deadline', 'cancellation_policy', 'idempotency_key', 'input_digest'],
      validate: combineValidators(
        requirePositiveIntegers(['input_schema_version', 'output_schema_version']),
        requireObjectField('resource_scope'),
        requireOptionalStrings(['approval_id']),
        requireStringArrayField('warnings'),
      ),
    },
    {
      event_type: 'ExecutionStarted',
      fields: ['tool', 'provider', 'idempotency_key', 'dispatch_attempt', 'deadline'],
      strings: ['tool', 'provider', 'idempotency_key', 'deadline'],
      validate: requirePositiveIntegers(['dispatch_attempt']),
    },
    {
      event_type: 'ExecutionSucceeded',
      fields: ['result', 'output_schema_version', 'provider_receipt_ref', 'warnings'],
      required: ['result', 'output_schema_version', 'warnings'],
      strings: [],
      validate: combineValidators(
        requirePositiveIntegers(['output_schema_version']),
        requireOptionalStrings(['provider_receipt_ref']),
        requireStringArrayField('warnings'),
      ),
    },
    {
      event_type: 'ExecutionFailed',
      fields: ['error', 'provider_receipt_ref', 'warnings'],
      required: ['error', 'warnings'],
      strings: [],
      validate: combineValidators(validateError, requireOptionalStrings(['provider_receipt_ref']), requireStringArrayField('warnings')),
    },
    {
      event_type: 'ExecutionCancelled',
      fields: ['reason', 'phase', 'provider_receipt_ref', 'warnings'],
      required: ['reason', 'phase', 'warnings'],
      strings: ['reason', 'phase'],
      validate: combineValidators(requireOptionalStrings(['provider_receipt_ref']), requireStringArrayField('warnings')),
    },
    {
      event_type: 'ExecutionOutcomeUncertain',
      fields: ['reason', 'provider_receipt_ref', 'warnings'],
      required: ['reason', 'warnings'],
      strings: ['reason'],
      validate: combineValidators(requireOptionalStrings(['provider_receipt_ref']), requireStringArrayField('warnings')),
    },
    {
      event_type: 'ExecutionCompensated',
      fields: ['prior_outcome_event_id', 'compensation_receipt_ref'],
      strings: ['prior_outcome_event_id', 'compensation_receipt_ref'],
    },
    {
      event_type: 'ExecutionCompensationFailed',
      fields: ['prior_outcome_event_id', 'error', 'compensation_receipt_ref'],
      required: ['prior_outcome_event_id', 'error'],
      strings: ['prior_outcome_event_id'],
      validate: combineValidators(validateError, requireOptionalStrings(['compensation_receipt_ref'])),
    },
  ];
  return new ExecutionEventRegistry(
    lifecycle.map((item) => ({
      event_type: item.event_type,
      current_version: 1,
      versions: {
        1: schema(
          item.fields,
          item.required || item.fields,
          combineValidators(requireStringFields(item.strings), item.validate),
        ),
      },
    })),
  ).seal();
}

module.exports = {
  createExecutionEventRegistry,
  EventSchemaError,
  ExecutionEventRegistry,
};

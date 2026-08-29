'use strict';

const PROJECTION_NAME = 'execution-runs';
const PROJECTION_SCHEMA_VERSION = 1;

const STATUS_BY_EVENT = new Map([
  ['ExecutionAuthorized', 'authorized'],
  ['ExecutionStarted', 'running'],
  ['ExecutionSucceeded', 'succeeded'],
  ['ExecutionFailed', 'failed'],
  ['ExecutionCancelled', 'cancelled'],
  ['ExecutionOutcomeUncertain', 'in_doubt'],
  ['ExecutionCompensated', 'compensated'],
  ['ExecutionCompensationFailed', 'compensation_failed'],
]);

class ProjectionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

class UnsupportedProjectionEventError extends ProjectionError {
  constructor(eventType) {
    super(`Unsupported execution projection event: ${eventType}`, 'EXECUTION_PROJECTION_EVENT_UNSUPPORTED', {
      event_type: eventType,
    });
  }
}

class ProjectionIntegrityError extends ProjectionError {
  constructor(details) {
    super('Projection cannot activate because its integrity comparison failed', 'EXECUTION_PROJECTION_INTEGRITY_FAILED', details);
  }
}

class ProjectionCheckpointConflictError extends ProjectionError {
  constructor(details) {
    super('Projection checkpoint changed before the batch could commit', 'EXECUTION_PROJECTION_CHECKPOINT_CONFLICT', details);
  }
}

function applyExecutionRun(state, event) {
  if (event.aggregate_type !== 'execution') return state;
  const status = STATUS_BY_EVENT.get(event.event_type);
  if (!status) throw new UnsupportedProjectionEventError(event.event_type);
  if (state && event.stream_sequence <= state.aggregate_version) return state;
  return {
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    aggregate_version: event.stream_sequence,
    operation_id: event.operation_id,
    status,
    last_event_type: event.event_type,
    last_occurred_at: event.occurred_at,
    last_position: event.position,
  };
}

class ExecutionProjectionStore {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {import('./execution-event-ledger').ExecutionEventLedger} ledger
   */
  constructor(db, ledger, { event_registry = ledger.eventRegistry || null } = {}) {
    this.db = db;
    this.ledger = ledger;
    this.eventRegistry = event_registry;
    this._metrics = {
      events_processed_by_projection: { [PROJECTION_NAME]: 0 },
      projection_failures_by_projection: { [PROJECTION_NAME]: 0 },
      processing_lag_ms_by_projection: { [PROJECTION_NAME]: 0 },
    };
    this._getActive = db.prepare(
      `SELECT * FROM execution_projection_generations
       WHERE projection_name = ? AND status = 'active'`,
    );
    this._getGeneration = db.prepare(`SELECT * FROM execution_projection_generations WHERE projection_name = ? AND generation = ?`);
    this._getCheckpoint = db.prepare(`SELECT * FROM execution_projection_checkpoints WHERE projection_name = ? AND generation = ?`);
    this._getProjectedRun = db.prepare(
      `SELECT * FROM execution_run_projection
       WHERE generation = ? AND aggregate_type = ? AND aggregate_id = ?`,
    );
    this._upsertProjectedRun = db.prepare(
      `INSERT INTO execution_run_projection (
         generation, aggregate_type, aggregate_id, aggregate_version, operation_id,
         status, last_event_type, last_occurred_at, last_position
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(generation, aggregate_type, aggregate_id) DO UPDATE SET
         aggregate_version = excluded.aggregate_version,
         operation_id = excluded.operation_id,
         status = excluded.status,
         last_event_type = excluded.last_event_type,
         last_occurred_at = excluded.last_occurred_at,
         last_position = excluded.last_position
       WHERE excluded.last_position > execution_run_projection.last_position`,
    );
    this._updateCheckpoint = db.prepare(
      `UPDATE execution_projection_checkpoints
       SET last_position = ?, last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE projection_name = ? AND generation = ? AND last_position = ?`,
    );
    this._recordError = db.prepare(
      `UPDATE execution_projection_checkpoints
       SET last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE projection_name = ? AND generation = ?`,
    );
    this._markGenerationFailed = db.prepare(
      `UPDATE execution_projection_generations SET status = 'failed'
       WHERE projection_name = ? AND generation = ? AND status = 'building'`,
    );
    this._applyBatch = db.transaction((generation, expectedCheckpoint, events, faultInjector) => {
      for (const event of events) {
        if (faultInjector) faultInjector('before_event', event);
        // This projection shares the canonical ledger with other aggregate
        // families. Its registry is authoritative only for execution events;
        // unrelated durable events must advance the checkpoint without being
        // interpreted through an incompatible schema registry.
        const projectedEvent = event.aggregate_type === 'execution' && this.eventRegistry ? this.eventRegistry.deserialize(event) : event;
        if (projectedEvent.aggregate_type === 'execution') {
          const current = this._getProjectedRun.get(generation, projectedEvent.aggregate_type, projectedEvent.aggregate_id) || null;
          const next = applyExecutionRun(current, projectedEvent);
          this._upsertProjectedRun.run(
            generation,
            next.aggregate_type,
            next.aggregate_id,
            next.aggregate_version,
            next.operation_id,
            next.status,
            next.last_event_type,
            next.last_occurred_at,
            next.last_position,
          );
        }
        if (faultInjector) faultInjector('after_event', event);
      }
      const lastPosition = events.at(-1).position;
      if (faultInjector) faultInjector('before_checkpoint', events.at(-1));
      const advanced = this._updateCheckpoint.run(lastPosition, PROJECTION_NAME, generation, expectedCheckpoint);
      if (advanced.changes !== 1) {
        throw new ProjectionCheckpointConflictError({
          generation,
          expected_checkpoint: expectedCheckpoint,
          attempted_checkpoint: lastPosition,
        });
      }
      return lastPosition;
    });
    this._activate = db.transaction((generation) => {
      const candidate = this._getGeneration.get(PROJECTION_NAME, generation);
      if (!candidate || candidate.status !== 'building') {
        throw new ProjectionError(`Projection generation is not activatable: ${generation}`, 'EXECUTION_PROJECTION_NOT_ACTIVATABLE', {
          generation,
          status: candidate ? candidate.status : null,
        });
      }
      if (candidate.schema_version !== PROJECTION_SCHEMA_VERSION) {
        throw new ProjectionError(
          `Projection generation schema is incompatible: ${candidate.schema_version}`,
          'EXECUTION_PROJECTION_SCHEMA_MISMATCH',
          { actual: candidate.schema_version, expected: PROJECTION_SCHEMA_VERSION },
        );
      }
      const checkpoint = this._getCheckpoint.get(PROJECTION_NAME, generation);
      const ledgerHighWater = db.prepare(`SELECT COALESCE(MAX(position), 0) AS position FROM execution_events`).get().position;
      if (!checkpoint || checkpoint.last_position !== ledgerHighWater) return { activated: false, ledger_high_water: ledgerHighWater };

      const integrity = this._integrity(generation);
      if (integrity.source_count !== integrity.projected_count || integrity.mismatch_count > 0) {
        throw new ProjectionIntegrityError({ ...integrity, generation });
      }

      db.prepare(
        `UPDATE execution_projection_generations
         SET status = 'retired', retired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE projection_name = ? AND status = 'active' AND generation != ?`,
      ).run(PROJECTION_NAME, generation);
      const promoted = db
        .prepare(
          `UPDATE execution_projection_generations
         SET status = 'active', source_high_water = ?, activated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE projection_name = ? AND generation = ? AND status = 'building'`,
        )
        .run(ledgerHighWater, PROJECTION_NAME, generation);
      if (promoted.changes !== 1) {
        throw new ProjectionError(
          `Projection generation lost activation eligibility: ${generation}`,
          'EXECUTION_PROJECTION_ACTIVATION_CONFLICT',
          { generation, changes: promoted.changes },
        );
      }
      return { activated: true, ledger_high_water: ledgerHighWater };
    });
  }

  _integrity(generation) {
    const sourceCount = this.db
      .prepare(`SELECT COUNT(DISTINCT aggregate_id) AS count FROM execution_events WHERE aggregate_type = 'execution'`)
      .get().count;
    const projectedCount = this.db
      .prepare(`SELECT COUNT(*) AS count FROM execution_run_projection WHERE generation = ? AND aggregate_type = 'execution'`)
      .get(generation).count;
    const mismatchCount = this.db
      .prepare(
        `WITH source_positions AS (
           SELECT aggregate_id, MAX(stream_sequence) AS aggregate_version, MAX(position) AS last_position
           FROM execution_events WHERE aggregate_type = 'execution' GROUP BY aggregate_id
         ), source AS (
           SELECT positions.aggregate_id, positions.aggregate_version, positions.last_position,
                  latest.operation_id, latest.event_type AS last_event_type,
                  latest.occurred_at AS last_occurred_at,
                  CASE latest.event_type
                    WHEN 'ExecutionAuthorized' THEN 'authorized'
                    WHEN 'ExecutionStarted' THEN 'running'
                    WHEN 'ExecutionSucceeded' THEN 'succeeded'
                    WHEN 'ExecutionFailed' THEN 'failed'
                    WHEN 'ExecutionCancelled' THEN 'cancelled'
                    WHEN 'ExecutionOutcomeUncertain' THEN 'in_doubt'
                    WHEN 'ExecutionCompensated' THEN 'compensated'
                    WHEN 'ExecutionCompensationFailed' THEN 'compensation_failed'
                    ELSE NULL
                  END AS status
           FROM source_positions positions
           JOIN execution_events latest ON latest.position = positions.last_position
         )
         SELECT COUNT(*) AS count FROM source
         LEFT JOIN execution_run_projection projected
           ON projected.generation = ?
          AND projected.aggregate_type = 'execution'
          AND projected.aggregate_id = source.aggregate_id
         WHERE projected.aggregate_id IS NULL
            OR projected.aggregate_version != source.aggregate_version
            OR projected.last_position != source.last_position
            OR projected.operation_id != source.operation_id
            OR projected.status != source.status
            OR projected.last_event_type != source.last_event_type
            OR projected.last_occurred_at != source.last_occurred_at
            OR source.status IS NULL`,
      )
      .get(generation).count;
    return { source_count: sourceCount, projected_count: projectedCount, mismatch_count: mismatchCount };
  }

  createGeneration() {
    const transaction = this.db.transaction(() => {
      const generation = this.db
        .prepare(
          `SELECT COALESCE(MAX(generation), 0) + 1 AS generation
             FROM execution_projection_generations WHERE projection_name = ?`,
        )
        .get(PROJECTION_NAME).generation;
      const highWater = this.db.prepare(`SELECT COALESCE(MAX(position), 0) AS position FROM execution_events`).get().position;
      this.db
        .prepare(
          `INSERT INTO execution_projection_generations
             (projection_name, generation, schema_version, status, source_high_water)
           VALUES (?, ?, ?, 'building', ?)`,
        )
        .run(PROJECTION_NAME, generation, PROJECTION_SCHEMA_VERSION, highWater);
      this.db
        .prepare(
          `INSERT INTO execution_projection_checkpoints (projection_name, generation, last_position)
           VALUES (?, ?, 0)`,
        )
        .run(PROJECTION_NAME, generation);
      return generation;
    });
    return transaction.immediate();
  }

  reconcileGeneration(generation, { batch_size = 100, fault_injector = null } = {}) {
    const generationRow = this._getGeneration.get(PROJECTION_NAME, generation);
    if (!generationRow || !['building', 'active'].includes(generationRow.status)) {
      throw new ProjectionError(`Projection generation is not reconcilable: ${generation}`, 'EXECUTION_PROJECTION_NOT_RECONCILABLE');
    }
    if (generationRow.schema_version !== PROJECTION_SCHEMA_VERSION) {
      throw new ProjectionError(
        `Projection generation schema is incompatible: ${generationRow.schema_version}`,
        'EXECUTION_PROJECTION_SCHEMA_MISMATCH',
        { actual: generationRow.schema_version, expected: PROJECTION_SCHEMA_VERSION },
      );
    }
    let processed = 0;
    try {
      for (;;) {
        const checkpoint = this._getCheckpoint.get(PROJECTION_NAME, generation);
        const events = this.ledger.readGlobal({ after_position: checkpoint.last_position, limit: batch_size });
        if (events.length === 0) break;
        try {
          this._applyBatch.immediate(generation, checkpoint.last_position, events, fault_injector);
        } catch (error) {
          if (error.code === 'EXECUTION_PROJECTION_CHECKPOINT_CONFLICT') continue;
          throw error;
        }
        processed += events.length;
        this._metrics.events_processed_by_projection[PROJECTION_NAME] += events.length;
        this._metrics.processing_lag_ms_by_projection[PROJECTION_NAME] = Math.max(0, Date.now() - Date.parse(events.at(-1).occurred_at));
        if (events.length < batch_size) break;
      }
      return { processed, checkpoint: this._getCheckpoint.get(PROJECTION_NAME, generation).last_position };
    } catch (error) {
      this._recordError.run(error.message, PROJECTION_NAME, generation);
      this._metrics.projection_failures_by_projection[PROJECTION_NAME]++;
      if (generationRow.status === 'building') this._markGenerationFailed.run(PROJECTION_NAME, generation);
      throw error;
    }
  }

  rebuild({ batch_size = 100, fault_injector = null, max_rounds = 1000 } = {}) {
    const generation = this.createGeneration();
    for (let round = 0; round < max_rounds; round++) {
      this.reconcileGeneration(generation, { batch_size, fault_injector });
      let activation;
      try {
        activation = this._activate.immediate(generation);
      } catch (error) {
        this._recordError.run(error.message, PROJECTION_NAME, generation);
        this._markGenerationFailed.run(PROJECTION_NAME, generation);
        this._metrics.projection_failures_by_projection[PROJECTION_NAME]++;
        throw error;
      }
      if (activation.activated) return { generation, ...activation };
    }
    const error = new ProjectionError(
      'Projection rebuild could not catch the moving high-water mark',
      'EXECUTION_PROJECTION_CATCHUP_EXHAUSTED',
    );
    this._recordError.run(error.message, PROJECTION_NAME, generation);
    this._markGenerationFailed.run(PROJECTION_NAME, generation);
    this._metrics.projection_failures_by_projection[PROJECTION_NAME]++;
    throw error;
  }

  reconcileActive(options = {}) {
    const active = this._getActive.get(PROJECTION_NAME);
    if (!active) throw new ProjectionError('No active execution projection', 'EXECUTION_PROJECTION_NOT_ACTIVE');
    return this.reconcileGeneration(active.generation, options);
  }

  listRuns({ status = null, limit = 100 } = {}) {
    const active = this._getActive.get(PROJECTION_NAME);
    if (!active) return [];
    if (active.schema_version !== PROJECTION_SCHEMA_VERSION) {
      throw new ProjectionError(
        `Active projection schema is incompatible: ${active.schema_version}`,
        'EXECUTION_PROJECTION_SCHEMA_MISMATCH',
        { actual: active.schema_version, expected: PROJECTION_SCHEMA_VERSION },
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ProjectionError('Invalid projection query limit', 'INVALID_LIMIT');
    const rows = status
      ? this.db
          .prepare(`SELECT * FROM execution_run_projection WHERE generation = ? AND status = ? ORDER BY last_position DESC LIMIT ?`)
          .all(active.generation, status, limit)
      : this.db
          .prepare(`SELECT * FROM execution_run_projection WHERE generation = ? ORDER BY last_position DESC LIMIT ?`)
          .all(active.generation, limit);
    return rows;
  }

  health() {
    const active = this._getActive.get(PROJECTION_NAME);
    const ledgerHighWater = this.db.prepare(`SELECT COALESCE(MAX(position), 0) AS position FROM execution_events`).get().position;
    const sourceCount = this.db
      .prepare(`SELECT COUNT(DISTINCT aggregate_id) AS count FROM execution_events WHERE aggregate_type = 'execution'`)
      .get().count;
    if (!active) {
      return {
        healthy: false,
        reason: 'no_active_generation',
        ledger_high_water: ledgerHighWater,
        checkpoint: 0,
        lag: ledgerHighWater,
        source_count: sourceCount,
        projected_count: 0,
        coverage_ratio: sourceCount === 0 ? 1 : 0,
        mismatch_count: sourceCount,
        last_error: null,
        schema_version: null,
        expected_schema_version: PROJECTION_SCHEMA_VERSION,
      };
    }
    const checkpoint = this._getCheckpoint.get(PROJECTION_NAME, active.generation);
    const integrity = this._integrity(active.generation);
    const projectedCount = integrity.projected_count;
    const coverageRatio = sourceCount === 0 ? 1 : projectedCount / sourceCount;
    const lag = ledgerHighWater - checkpoint.last_position;
    let reason = 'ok';
    if (integrity.mismatch_count > 0) reason = 'integrity_gap';
    if (coverageRatio < 1 || coverageRatio > 1) reason = 'coverage_gap';
    if (lag < 0) reason = 'checkpoint_ahead';
    if (lag > 0) reason = 'projection_lag';
    if (active.schema_version !== PROJECTION_SCHEMA_VERSION) reason = 'schema_version_mismatch';
    if (checkpoint.last_error) reason = 'projection_error';
    return {
      healthy:
        active.schema_version === PROJECTION_SCHEMA_VERSION &&
        lag === 0 &&
        coverageRatio === 1 &&
        integrity.mismatch_count === 0 &&
        checkpoint.last_error === null,
      reason,
      generation: active.generation,
      ledger_high_water: ledgerHighWater,
      checkpoint: checkpoint.last_position,
      lag,
      source_count: sourceCount,
      projected_count: projectedCount,
      coverage_ratio: coverageRatio,
      mismatch_count: integrity.mismatch_count,
      last_error: checkpoint.last_error,
      schema_version: active.schema_version,
      expected_schema_version: PROJECTION_SCHEMA_VERSION,
    };
  }

  metrics() {
    const active = this._getActive.get(PROJECTION_NAME);
    const checkpoint = active ? this._getCheckpoint.get(PROJECTION_NAME, active.generation) : null;
    return {
      events_processed_by_projection: { ...this._metrics.events_processed_by_projection },
      projection_failures_by_projection: { ...this._metrics.projection_failures_by_projection },
      processing_lag_ms_by_projection: { ...this._metrics.processing_lag_ms_by_projection },
      checkpoint_position_by_projection: { [PROJECTION_NAME]: checkpoint ? checkpoint.last_position : 0 },
    };
  }
}

module.exports = {
  applyExecutionRun,
  ExecutionProjectionStore,
  PROJECTION_NAME,
  PROJECTION_SCHEMA_VERSION,
  ProjectionError,
  ProjectionCheckpointConflictError,
  ProjectionIntegrityError,
  UnsupportedProjectionEventError,
};

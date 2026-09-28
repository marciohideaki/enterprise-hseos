-- Additive execution receipts; operational activation remains separate.
DROP TRIGGER execution_event_schemas_no_insert;
INSERT INTO execution_event_schemas (event_type, schema_version) VALUES ('JobExecutionRecorded', 1);
CREATE TRIGGER execution_event_schemas_no_insert
BEFORE INSERT ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;

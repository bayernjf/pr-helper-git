-- Local-only migration 049 (2026-11-15): allow the stage-advanced audit action.
--
-- Fixes a legacy pr-helper schema gap carried over by the faithful replay:
-- the TypeScript OperationAuditAction union includes 'stage-advanced', but
-- migration 020's workflow_operation_audit_logs_action_check does not.
-- A real advance-stage dispatch therefore fails to write its audit row.
--
-- Registry impact: none (same table, only widens the CHECK whitelist).

ALTER TABLE workflow_operation_audit_logs
  DROP CONSTRAINT IF EXISTS workflow_operation_audit_logs_action_check;

ALTER TABLE workflow_operation_audit_logs
  ADD CONSTRAINT workflow_operation_audit_logs_action_check CHECK (
    action = ANY (ARRAY[
      'workflow-created',
      'workflow-updated',
      'workflow-deleted',
      'pull-created',
      'pull-merged',
      'stage-advanced',
      'actions-rerun',
      'deployment-rerun',
      'deployment-rollback'
    ]::text[])
  );

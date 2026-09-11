-- Append-only audit log: block UPDATE and DELETE on audit_logs so history is
-- tamper-evident at the storage layer. Admin correction is only possible via a
-- direct, privileged DDL operation, which itself would be traceable.

CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are not permitted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only ON "audit_logs";
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_mutation();
-- 030: Keep the reconciliation clock in the database instead of on GitHub's scheduler.
-- [local-migration adaptation] The original creates pg_cron/pg_net schedules that ping the
-- Vercel cron endpoints via a Vault secret. The local deployment runs the scheduler inside
-- the app server (drain every 2 min, reconcile every 5 min), so pg_cron/pg_net/vault are
-- intentionally NOT created here. Kept as a documented no-op for migration-order integrity.

CREATE OR REPLACE FUNCTION public.pr_helper_cron_ping(endpoint text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  -- local mode: the app server owns scheduling; nothing to ping.
  RETURN 'local mode: ' || endpoint || ' scheduler runs in the app server';
END;
$$;

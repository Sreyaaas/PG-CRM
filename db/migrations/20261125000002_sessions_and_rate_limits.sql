-- migrate:up

-- ---------------------------------------------------------------------------
-- Sessions (BE-51): short access JWT + long refresh token.
--   * The refresh token is random and only its SHA-256 hash is stored.
--   * Every refresh rotates it: the old row gets used_at, a new row joins the same family.
--   * Presenting a used or revoked token again = theft: the whole family is revoked.
-- Sessions belong to a user (like `users`), not to an organization, so there is no org_id.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL DEFAULT gen_random_uuid(),   -- one login = one family
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,     -- exchanged for a newer token
  revoked_at  timestamptz      -- logout, logout-all, password change, reuse detected, user deactivated
);
CREATE INDEX idx_sessions_user   ON sessions (user_id);
CREATE INDEX idx_sessions_family ON sessions (family_id);

-- Only used_at / revoked_at may change, and a revoked or used session can never be brought back.
CREATE FUNCTION app.sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['used_at', 'revoked_at']) THEN
    RAISE EXCEPTION 'Only used_at and revoked_at can change on a session' USING ERRCODE = 'PC001';
  END IF;
  IF (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
     OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at) THEN
    RAISE EXCEPTION 'A revoked or used session cannot be changed' USING ERRCODE = 'PC001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_sessions_guard BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION app.sessions_guard();
CREATE TRIGGER trg_sessions_no_delete BEFORE DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION app.forbid_delete();
CREATE TRIGGER trg_sessions_no_truncate BEFORE TRUNCATE ON sessions FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_delete();

-- The API role sees and creates only the caller's own sessions, and may only revoke them.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON sessions TO pgcrm_app;
GRANT UPDATE (revoked_at) ON sessions TO pgcrm_app;
CREATE POLICY sessions_select ON sessions FOR SELECT TO pgcrm_app
  USING (user_id = (SELECT app.current_user_id()));
CREATE POLICY sessions_insert ON sessions FOR INSERT TO pgcrm_app
  WITH CHECK (user_id = (SELECT app.current_user_id()));
CREATE POLICY sessions_update ON sessions FOR UPDATE TO pgcrm_app
  USING (user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_id = (SELECT app.current_user_id()));

-- Refresh runs without a valid access token, so it can't rely on RLS: knowing the refresh token is the proof.
-- Returns no row when the token can't be used (unknown, expired, reused, revoked, user deactivated).
CREATE FUNCTION api.rotate_session(p_old_hash text, p_new_hash text, p_ttl interval)
RETURNS TABLE (user_id uuid, family_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM sessions WHERE token_hash = p_old_hash FOR UPDATE;
  IF NOT FOUND OR s.expires_at <= now() THEN
    RETURN;
  END IF;
  -- Reuse of a rotated or revoked token: someone else may hold the family. Revoke all of it.
  -- Same for a deactivated account.
  IF s.used_at IS NOT NULL OR s.revoked_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.is_active) THEN
    UPDATE sessions SET revoked_at = now() WHERE sessions.family_id = s.family_id AND revoked_at IS NULL;
    RETURN;
  END IF;
  UPDATE sessions SET used_at = now() WHERE id = s.id;
  INSERT INTO sessions (family_id, user_id, token_hash, expires_at)
  VALUES (s.family_id, s.user_id, p_new_hash, now() + p_ttl);
  RETURN QUERY SELECT s.user_id, s.family_id, now() + p_ttl;
END
$$;

-- Logout with the refresh token alone (the access token may already have expired).
CREATE FUNCTION api.revoke_session(p_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET revoked_at = now()
   WHERE family_id = (SELECT family_id FROM sessions WHERE token_hash = p_hash) AND revoked_at IS NULL
$$;

-- ---------------------------------------------------------------------------
-- Rate limits (BE-51). Shared by every API process, so not in memory.
-- `bucket` is a SHA-256 of e.g. "login:phone:<phone>", so no phone number or IP is stored.
-- Operational data, not business data: old rows are pruned by the function below.
-- ---------------------------------------------------------------------------
CREATE TABLE rate_limit_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket      text NOT NULL CHECK (bucket ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_limit_bucket ON rate_limit_events (bucket, created_at);
CREATE INDEX idx_rate_limit_created ON rate_limit_events (created_at);
-- RLS on, no policies, no grants: the API role reaches it only through the functions below.
ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION api.rate_limit_count(p_bucket text, p_window interval) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer FROM rate_limit_events WHERE bucket = p_bucket AND created_at > now() - p_window
$$;

CREATE FUNCTION api.rate_limit_record(p_bucket text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO rate_limit_events (bucket) VALUES (p_bucket);
  -- No limit window is longer than an hour; prune now and then.
  IF random() < 0.01 THEN
    DELETE FROM rate_limit_events WHERE created_at < now() - interval '1 day';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION api.rotate_session(text, text, interval), api.revoke_session(text),
  api.rate_limit_count(text, interval), api.rate_limit_record(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.rotate_session(text, text, interval), api.revoke_session(text),
  api.rate_limit_count(text, interval), api.rate_limit_record(text) TO pgcrm_app;

-- migrate:down
DROP FUNCTION IF EXISTS api.rate_limit_record(text);
DROP FUNCTION IF EXISTS api.rate_limit_count(text, interval);
DROP TABLE IF EXISTS rate_limit_events;
DROP FUNCTION IF EXISTS api.revoke_session(text);
DROP FUNCTION IF EXISTS api.rotate_session(text, text, interval);
DROP TABLE IF EXISTS sessions;
DROP FUNCTION IF EXISTS app.sessions_guard();

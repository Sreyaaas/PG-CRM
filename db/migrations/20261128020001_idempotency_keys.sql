-- migrate:up

-- BE-32: Idempotency-Key for POST /payments, POST /expenses and POST /cash/handovers. Caretakers on flaky Wi-Fi tap
-- "Log payment" again after a timeout; the retry must not record the cash twice (threat #1 bookkeeping).
-- The API stores the response in the same transaction as the insert, so a key exists only if its payment / expense /
-- handover was committed. Keys are private to the user who sent them (in that organization). Nothing here is
-- business data: rows hold a copy of a response, so there is no audit trigger, and a cleanup job may delete keys
-- older than 7 days later (the API already ignores them). The API role still gets no DELETE.
CREATE TABLE idempotency_keys (
  org_id        uuid NOT NULL REFERENCES organizations(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  key           text NOT NULL CHECK (length(key) BETWEEN 1 AND 100),
  request_hash  text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the canonical JSON body
  status_code   int NOT NULL CHECK (status_code BETWEEN 200 AND 299),
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, key)
);
CREATE INDEX idx_idempotency_keys_created ON idempotency_keys (created_at);
CREATE INDEX idx_idempotency_keys_user    ON idempotency_keys (user_id);

-- created_at is the clock that decides the 7-day window: the client can't set it.
CREATE FUNCTION app.idempotency_keys_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_idempotency_keys_guard BEFORE INSERT ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION app.idempotency_keys_guard();

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON idempotency_keys TO pgcrm_app;
CREATE POLICY idempotency_keys_own ON idempotency_keys FOR ALL TO pgcrm_app
  USING (user_id = (SELECT app.current_user_id()) AND org_id = (SELECT app.current_org_id()))
  WITH CHECK (user_id = (SELECT app.current_user_id()) AND org_id = (SELECT app.current_org_id()));

-- migrate:down
DROP TABLE IF EXISTS idempotency_keys;
DROP FUNCTION IF EXISTS app.idempotency_keys_guard();

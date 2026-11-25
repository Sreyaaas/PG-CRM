-- migrate:up

-- BE-26: resident complaints / maintenance tickets (the caretaker's work queue).
CREATE TYPE complaint_category AS ENUM (
  'wifi', 'water', 'electricity', 'plumbing', 'ac', 'cleaning', 'food', 'security', 'other'
);
CREATE TYPE complaint_priority AS ENUM ('low', 'normal', 'urgent');
CREATE TYPE complaint_status   AS ENUM ('open', 'in_progress', 'resolved');

CREATE TABLE complaints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  property_id      uuid NOT NULL,
  room_id          uuid,
  bed_id           uuid,
  resident_id      uuid,
  category         complaint_category NOT NULL,
  title            text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  note             text,
  priority         complaint_priority NOT NULL DEFAULT 'normal',
  status           complaint_status NOT NULL DEFAULT 'open',
  photo_path       text,                 -- private object storage key (BE-20, kind complaint_photo)
  assigned_to      uuid REFERENCES users(id),
  created_by       uuid NOT NULL REFERENCES users(id),   -- forced to the caller
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_by      uuid REFERENCES users(id),
  resolved_at      timestamptz,
  resolution_note  text,
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  -- Room, bed and resident (when given) must be in the same building.
  CONSTRAINT fk_complaints_room     FOREIGN KEY (room_id, property_id)     REFERENCES rooms (id, property_id),
  CONSTRAINT fk_complaints_bed      FOREIGN KEY (bed_id, property_id)      REFERENCES beds (id, property_id),
  CONSTRAINT fk_complaints_resident FOREIGN KEY (resident_id, property_id) REFERENCES residents (id, property_id),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
CREATE INDEX idx_complaints_org      ON complaints (org_id);
CREATE INDEX idx_complaints_property ON complaints (property_id, status);
CREATE INDEX idx_complaints_room     ON complaints (room_id);
CREATE INDEX idx_complaints_bed      ON complaints (bed_id);
CREATE INDEX idx_complaints_resident ON complaints (resident_id);
CREATE INDEX idx_complaints_assigned ON complaints (assigned_to);

CREATE FUNCTION app.complaints_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := app.require_user();
    NEW.created_at := now();
    NEW.status := 'open';
    NEW.resolved_by := NULL; NEW.resolved_at := NULL; NEW.resolution_note := NULL;
  ELSE
    IF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY[
         'status', 'priority', 'category', 'title', 'note', 'assigned_to',
         'resolution_note', 'resolved_by', 'resolved_at', 'updated_at']) THEN
      RAISE EXCEPTION 'Only status, priority, category, title, note and assignee can change on a complaint'
        USING ERRCODE = 'PC001';
    END IF;
    IF NEW.status = 'resolved' AND OLD.status <> 'resolved' THEN
      IF coalesce(length(trim(NEW.resolution_note)), 0) < 3 THEN
        RAISE EXCEPTION 'Say how the complaint was resolved' USING ERRCODE = 'PC003';
      END IF;
      NEW.resolved_by := app.current_user_id();
      NEW.resolved_at := now();
    ELSIF NEW.status = 'resolved' THEN
      NEW.resolved_by := OLD.resolved_by;   -- who resolved it, and when, never changes
      NEW.resolved_at := OLD.resolved_at;
    ELSE                                     -- open / in_progress, including a reopen
      NEW.resolved_by := NULL; NEW.resolved_at := NULL; NEW.resolution_note := NULL;
    END IF;
  END IF;

  IF NEW.assigned_to IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
     AND NOT EXISTS (
       SELECT 1 FROM organization_members m JOIN users u ON u.id = m.user_id AND u.is_active
        WHERE m.org_id = NEW.org_id AND m.user_id = NEW.assigned_to AND m.is_active
     ) THEN
    RAISE EXCEPTION 'Assignee must be an active member of this organization' USING ERRCODE = 'PC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_complaints_guard BEFORE INSERT OR UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION app.complaints_guard();
CREATE TRIGGER trg_complaints_touch BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_complaints_no_delete BEFORE DELETE ON complaints
  FOR EACH ROW EXECUTE FUNCTION app.forbid_delete();
CREATE TRIGGER trg_complaints_no_truncate BEFORE TRUNCATE ON complaints
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_delete();
CREATE TRIGGER trg_complaints_audit AFTER INSERT OR UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();

-- Same rule as other building data: anyone with access to the building reads and writes; no DELETE grant.
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON complaints TO pgcrm_app;
CREATE POLICY complaints_select ON complaints FOR SELECT TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]));
CREATE POLICY complaints_insert ON complaints FOR INSERT TO pgcrm_app
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]));
CREATE POLICY complaints_update ON complaints FOR UPDATE TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]));

-- migrate:down
DROP TABLE IF EXISTS complaints;
DROP FUNCTION IF EXISTS app.complaints_guard();
DROP TYPE IF EXISTS complaint_status;
DROP TYPE IF EXISTS complaint_priority;
DROP TYPE IF EXISTS complaint_category;

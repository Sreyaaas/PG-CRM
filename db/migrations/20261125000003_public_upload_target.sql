-- migrate:up

-- BE-20: the public onboarding form uploads its ID photo and selfie before submitting, under
-- onboarding/{property_id}/... The public route has no user, so RLS hides `properties`; this returns only the id
-- of an *active* property for a QR slug (NULL otherwise) and nothing else about it.
CREATE FUNCTION api.public_upload_property(p_qr_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM properties WHERE qr_slug = p_qr_slug AND is_active
$$;
REVOKE ALL ON FUNCTION api.public_upload_property(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.public_upload_property(text) TO pgcrm_app;

-- migrate:down
DROP FUNCTION IF EXISTS api.public_upload_property(text);

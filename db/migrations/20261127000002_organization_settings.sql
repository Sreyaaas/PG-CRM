-- migrate:up

-- BE-14: organization settings shown on receipts and the Reception poster, and used by message templates (BE-35).
-- The business name is the existing organizations.name.
ALTER TABLE organizations
  ADD COLUMN gstin text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  ADD COLUMN whatsapp_language text NOT NULL DEFAULT 'en' CHECK (whatsapp_language IN ('en', 'kn', 'hi', 'ta', 'te')),
  ADD COLUMN receipt_footer text CHECK (length(receipt_footer) <= 300);

-- Owners only: the existing org_update policy requires app.is_owner().
GRANT UPDATE (gstin, whatsapp_language, receipt_footer) ON organizations TO pgcrm_app;

-- migrate:down
REVOKE UPDATE (gstin, whatsapp_language, receipt_footer) ON organizations FROM pgcrm_app;
ALTER TABLE organizations DROP COLUMN receipt_footer, DROP COLUMN whatsapp_language, DROP COLUMN gstin;

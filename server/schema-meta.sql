-- Meta (Facebook / Instagram) Lead Ads integration. Safe to re-run.

-- Where the lead came from inside Meta, kept alongside the lead itself so the
-- admin can see which ad and campaign produced it.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_leadgen_id    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_form_id       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_form_name     TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_ad_name       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_campaign_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_platform      TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_raw           JSONB;

-- One row per Meta lead: the webhook and the manual sync can both deliver the
-- same lead, and Meta itself retries webhooks, so this is what makes the
-- import idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS leads_meta_leadgen_uniq
  ON leads (meta_leadgen_id) WHERE meta_leadgen_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_meta_campaign_idx ON leads (meta_campaign_name);

-- Integration credentials and state. Values fall back to environment
-- variables when a key is absent.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Diagnostics: webhook deliveries, syncs, imports and failures.
CREATE TABLE IF NOT EXISTS integration_log (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'meta',
  event TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_log_created_idx ON integration_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- Incoming WhatsApp Cloud API messages.
--
-- One row per message id. Meta retries any delivery it does not get a fast 200
-- for, so the id is the guard against the same message becoming two leads.
-- lead_id is the lead it was recorded against, and stays NULL only while a
-- delivery is still being processed.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  wamid TEXT PRIMARY KEY,
  lead_id INT REFERENCES leads (id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_lead_idx ON whatsapp_messages (lead_id);

-- Finding the open lead for a WhatsApp number: the last ten digits, so
-- +91 98765 43210 and 919876543210 are one person.
CREATE INDEX IF NOT EXISTS leads_phone_tail_idx
  ON leads (right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10));

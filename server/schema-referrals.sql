-- People who send business our way, and what a referral is worth to them.
--
-- The person who referred a lead lives in their own table rather than in a text
-- column on the lead, so the same referrer is recognised across every lead they
-- send and can be listed with all of it in one place.

CREATE TABLE IF NOT EXISTS referrers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One person on one number is one referrer, however the number was typed:
-- +91 98765 43210, 098765 43210 and 9876543210 all match on the last ten
-- digits. Referrers entered without a number are matched on the name instead,
-- so the two indexes never cover the same row.
CREATE UNIQUE INDEX IF NOT EXISTS referrers_phone_key
  ON referrers (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10))
  WHERE coalesce(phone, '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS referrers_name_key
  ON referrers (lower(btrim(name)))
  WHERE coalesce(phone, '') = '';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS referrer_id INT
  REFERENCES referrers(id) ON DELETE SET NULL;

-- What the referral earns: a 'percent' of the order, or a 'flat' rupee amount.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_kind  TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_value NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS leads_referrer_idx ON leads (referrer_id);

-- The panel validates both of these before saving. They are repeated here so
-- that anything else reaching the table — a script, a migration, psql by hand —
-- cannot leave a commission the panel is unable to read back.
-- ADD CONSTRAINT has no IF NOT EXISTS, so a second run is caught instead.
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_referral_kind_chk
    CHECK (referral_kind IS NULL OR referral_kind IN ('percent', 'flat'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_referral_value_chk
    CHECK (referral_value IS NULL
           OR (referral_value >= 0
               AND (referral_kind <> 'percent' OR referral_value <= 100)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

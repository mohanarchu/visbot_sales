-- States and union territories, and which of them each sales person covers.
-- Safe to re-run. Applied AFTER schema-users.sql, because it points users at
-- states and leads at states.
--
-- Why a table rather than a list in the code: a lead's state arrives as free
-- text from six different places (the website form, the mobile app, both admin
-- panels, the public API and the Meta lead-ads import), typed any number of
-- ways — "Tamil Nadu", "tamilnadu", "TN". Each lead is resolved to one row here
-- once, on the way in, by the trigger at the bottom of this file. Nothing has
-- to remember to do it.

CREATE TABLE IF NOT EXISTS states (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,            -- ISO 3166-2:IN, e.g. TN
  kind TEXT NOT NULL DEFAULT 'state',   -- state | union territory
  aliases TEXT[] NOT NULL DEFAULT '{}', -- other spellings seen in real leads
  sort_order INT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- matching
-- "Tamil Nadu", "tamil nadu", "TAMILNADU" and "Tamil-Nadu" are one key.
CREATE OR REPLACE FUNCTION state_key(txt TEXT) RETURNS TEXT AS $$
  SELECT lower(regexp_replace(coalesce(txt, ''), '[^a-zA-Z0-9]', '', 'g'));
$$ LANGUAGE sql IMMUTABLE;

-- The row a piece of free text means, or NULL when it means nothing we know.
CREATE OR REPLACE FUNCTION state_id_for(txt TEXT) RETURNS INT AS $$
  SELECT s.id FROM states s
   WHERE state_key(txt) <> ''
     AND (state_key(s.name) = state_key(txt)
          OR state_key(s.code) = state_key(txt)
          OR EXISTS (SELECT 1 FROM unnest(s.aliases) a WHERE state_key(a) = state_key(txt)))
   ORDER BY s.sort_order, s.id
   LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------- the list
-- All 28 states and 8 union territories. Re-running refreshes the names and
-- the spellings without disturbing anything already pointed at a row.
INSERT INTO states (name, code, kind, aliases, sort_order) VALUES
  ('Andhra Pradesh',              'AP', 'state', ARRAY['andhrapradesh','andhra'],            1),
  ('Arunachal Pradesh',           'AR', 'state', ARRAY['arunachal'],                         2),
  ('Assam',                       'AS', 'state', ARRAY[]::text[],                            3),
  ('Bihar',                       'BR', 'state', ARRAY[]::text[],                            4),
  ('Chhattisgarh',                'CG', 'state', ARRAY['chattisgarh','chhatisgarh','CT'],    5),
  ('Goa',                         'GA', 'state', ARRAY[]::text[],                            6),
  ('Gujarat',                     'GJ', 'state', ARRAY['gujrat'],                            7),
  ('Haryana',                     'HR', 'state', ARRAY['hariyana'],                          8),
  ('Himachal Pradesh',            'HP', 'state', ARRAY['himachal'],                           9),
  ('Jharkhand',                   'JH', 'state', ARRAY['jharkand'],                          10),
  ('Karnataka',                   'KA', 'state', ARRAY['karnatak','karnataka state'],        11),
  ('Kerala',                      'KL', 'state', ARRAY['kerela','keral'],                    12),
  ('Madhya Pradesh',              'MP', 'state', ARRAY['madhyapradesh'],                     13),
  ('Maharashtra',                 'MH', 'state', ARRAY['maharastra','maharashtra state'],    14),
  ('Manipur',                     'MN', 'state', ARRAY[]::text[],                            15),
  ('Meghalaya',                   'ML', 'state', ARRAY['meghalya'],                          16),
  ('Mizoram',                     'MZ', 'state', ARRAY[]::text[],                            17),
  ('Nagaland',                    'NL', 'state', ARRAY[]::text[],                            18),
  ('Odisha',                      'OD', 'state', ARRAY['orissa','OR'],                       19),
  ('Punjab',                      'PB', 'state', ARRAY['panjab'],                            20),
  ('Rajasthan',                   'RJ', 'state', ARRAY['rajastan'],                          21),
  ('Sikkim',                      'SK', 'state', ARRAY[]::text[],                            22),
  ('Tamil Nadu',                  'TN', 'state', ARRAY['tamilnadu','tamilnad','tamil naadu'], 23),
  ('Telangana',                   'TS', 'state', ARRAY['telengana','telangana state','TG'],  24),
  ('Tripura',                     'TR', 'state', ARRAY[]::text[],                            25),
  ('Uttar Pradesh',               'UP', 'state', ARRAY['uttarpradesh'],                      26),
  ('Uttarakhand',                 'UK', 'state', ARRAY['uttaranchal','uttarakand','UT'],     27),
  ('West Bengal',                 'WB', 'state', ARRAY['westbengal','bengal'],               28),
  ('Andaman and Nicobar Islands', 'AN', 'union territory', ARRAY['andaman','andaman nicobar'], 29),
  ('Chandigarh',                  'CH', 'union territory', ARRAY[]::text[],                  30),
  ('Dadra and Nagar Haveli and Daman and Diu', 'DH', 'union territory',
     ARRAY['dadra and nagar haveli','daman and diu','daman','diu','DD','DN'],                31),
  ('Delhi',                       'DL', 'union territory', ARRAY['new delhi','nct of delhi','delhi ncr'], 32),
  ('Jammu and Kashmir',           'JK', 'union territory', ARRAY['jammu kashmir','jammu'],   33),
  ('Ladakh',                      'LA', 'union territory', ARRAY[]::text[],                  34),
  ('Lakshadweep',                 'LD', 'union territory', ARRAY['laccadive'],               35),
  ('Puducherry',                  'PY', 'union territory', ARRAY['pondicherry','pondy','PD'], 36)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      aliases = EXCLUDED.aliases,
      sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------- who covers what
-- A sales person can cover any number of states, and a state any number of
-- people. Removing either side removes the pairing, never the leads.
CREATE TABLE IF NOT EXISTS user_states (
  user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  state_id INT NOT NULL REFERENCES states (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, state_id)
);

CREATE INDEX IF NOT EXISTS user_states_state_idx ON user_states (state_id);

-- ---------------------------------------------------------------- leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state_id INT
  REFERENCES states (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS leads_state_id_idx ON leads (state_id);

-- The free-text `state` column stays as the customer or the rep typed it; this
-- only keeps the pointer beside it in step, whichever code did the writing.
CREATE OR REPLACE FUNCTION leads_resolve_state() RETURNS trigger AS $$
BEGIN
  NEW.state_id := state_id_for(NEW.state);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_resolve_state_trg ON leads;
CREATE TRIGGER leads_resolve_state_trg
  BEFORE INSERT OR UPDATE OF state ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_resolve_state();

-- Leads already in the table, and any whose spelling this file has just taught
-- the database to recognise.
UPDATE leads SET state_id = state_id_for(state)
 WHERE state_id IS DISTINCT FROM state_id_for(state);

-- Service requests carry a state too, so the same list can be used there later.
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS state_id INT
  REFERENCES states (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION service_requests_resolve_state() RETURNS trigger AS $$
BEGIN
  NEW.state_id := state_id_for(NEW.state);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_requests_resolve_state_trg ON service_requests;
CREATE TRIGGER service_requests_resolve_state_trg
  BEFORE INSERT OR UPDATE OF state ON service_requests
  FOR EACH ROW EXECUTE FUNCTION service_requests_resolve_state();

UPDATE service_requests SET state_id = state_id_for(state)
 WHERE state_id IS DISTINCT FROM state_id_for(state);

-- Service requests from existing customers. Safe to re-run.
--
-- Kept separate from `leads` on purpose: these are warranty and breakdown calls
-- from people who already own a machine, not sales enquiries, so mixing them
-- would distort the pipeline figures.
--
-- This is an inbox, not a pipeline: the website's Service page is the only
-- thing that writes here, and the admin panel only reads and deletes. A
-- database created before 2026-11-19 also carries unused `status`, `priority`
-- and `owner` columns and a `service_notes` table from the first version; both
-- are harmless and left in place rather than dropped.

CREATE TABLE IF NOT EXISTS service_requests (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  city TEXT,
  state TEXT,
  reference TEXT,            -- invoice or purchase order number
  machine TEXT,
  issue TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_created_idx ON service_requests (created_at DESC);


-- ---------------------------------------------------------------------------
-- Service type master. The list of kinds of service work, chosen when a
-- service is logged. A type is just a name and a note on when to choose it;
-- the list is edited from the admin panel, so it is only seeded here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO service_types (name, description) VALUES
  ('AMC visit',                    'Visit under an annual maintenance contract'),
  ('Breakdown repair',             'Machine stopped or producing out of spec'),
  ('Inspection',                   'Checked and reported, no work carried out'),
  ('Installation & commissioning', 'New machine set up and handed over'),
  ('Operator training',            'Training the customer''s operators'),
  ('Preventive maintenance',       'Scheduled service to keep a line healthy'),
  ('Spare replacement',            'A part replaced, with or without a visit'),
  ('Warranty repair',              'Covered by the machine warranty')
ON CONFLICT (name) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Service history. One row per service carried out, whether it started from a
-- website request, a phone call or a planned maintenance visit.
--
-- The customer details are copied in rather than referenced: a service record
-- must still read correctly years later, even if the request it came from has
-- been deleted or the machine has changed hands.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_visits (
  id SERIAL PRIMARY KEY,
  request_id INT REFERENCES service_requests (id) ON DELETE SET NULL,
  type_id INT REFERENCES service_types (id) ON DELETE SET NULL,
  customer TEXT NOT NULL,
  phone TEXT,
  reference TEXT,            -- invoice or purchase order number
  machine TEXT,
  city TEXT,
  state TEXT,
  service_date DATE NOT NULL DEFAULT current_date,
  engineer TEXT,
  work_done TEXT,
  parts_used TEXT,
  charges NUMERIC(12,2),
  next_due DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_visits_date_idx ON service_visits (service_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS service_visits_ref_idx ON service_visits (reference);
CREATE INDEX IF NOT EXISTS service_visits_request_idx ON service_visits (request_id);


-- ---------------------------------------------------------------------------
-- Customer reviews of the service, entered in the admin panel after a call or
-- a visit. The website has no review form: the Service page only shows the
-- rows published here, so nothing reaches the site unreviewed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_reviews (
  id SERIAL PRIMARY KEY,
  visit_id INT REFERENCES service_visits (id) ON DELETE SET NULL,
  customer TEXT NOT NULL,
  company TEXT,
  city TEXT,
  state TEXT,
  machine TEXT,
  rating INT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  published BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'admin',   -- website | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_reviews_pub_idx ON service_reviews (published, created_at DESC);

-- Panel users, their roles, and the tokens the sales mobile app signs in with.
-- Safe to re-run. Applied AFTER schema-leads.sql and schema-service.sql, because
-- it adds the columns that point leads, notes and reviews at a user.
--
-- Roles (see server/users.js for what each one may do):
--   admin    everything, including creating and removing users
--   manager  everything except user management
--   sales    leads assigned to them, and customer reviews — mobile app only
--
-- People sign in with their mobile number or their email address. There is no
-- username: one less thing to remember, and the office already knows both.
--   phone      as it was typed, for showing and dialling
--   phone_key  the last ten digits, which is what a sign-in is matched on, so
--              "+91 98765 43210", "098765 43210" and "9876543210" are one person
--
-- Passwords are never stored. password_hash holds a salted scrypt digest in the
-- form  scrypt$<N>$<r>$<p>$<salt base64>$<key base64>  so the work factor can be
-- raised later without invalidating the hashes already saved.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  phone_key TEXT,
  role TEXT NOT NULL DEFAULT 'sales',
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  last_app_login_at TIMESTAMPTZ
);

-- An earlier draft of this file had a username column. It was never deployed,
-- so this only tidies up a developer machine that ran it.
DROP INDEX IF EXISTS users_username_uniq;
ALTER TABLE users DROP COLUMN IF EXISTS username;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_key TEXT;

-- Either way of signing in belongs to one person only. Email is compared
-- without case; a phone number by its last ten digits.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uniq
  ON users (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uniq
  ON users (phone_key) WHERE phone_key IS NOT NULL AND phone_key <> '';
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role, active);

-- Nobody can be left with no way to sign in.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_reachable') THEN
    ALTER TABLE users ADD CONSTRAINT users_reachable
      CHECK (coalesce(email, '') <> '' OR coalesce(phone_key, '') <> '');
  END IF;
END
$$;

-- ---------------------------------------------------------------- lead owners
-- The older free-text `owner` column stays and is kept in step with the name of
-- whoever is assigned, so the existing pages and exports keep reading.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_user_id INT
  REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS leads_owner_user_idx ON leads (owner_user_id);

-- Who wrote a note, and from where.
ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS user_id INT
  REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS author TEXT;

-- Who collected a review. The review itself still carries the customer's words;
-- this only records the rep, so the admin can see who brought it in.
ALTER TABLE service_reviews ADD COLUMN IF NOT EXISTS user_id INT
  REFERENCES users (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- app tokens
-- The mobile app holds a bearer token instead of a cookie. Only the SHA-256 of
-- the token is stored, so a leaked database row cannot be used to sign in.
CREATE TABLE IF NOT EXISTS user_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_tokens_user_idx ON user_tokens (user_id);
CREATE INDEX IF NOT EXISTS user_tokens_expiry_idx ON user_tokens (expires_at);

-- Expired tokens are cleared out whenever anyone signs in; this keeps the table
-- small on a database that has been running for a while without a login.
DELETE FROM user_tokens WHERE expires_at < now() - interval '30 days';

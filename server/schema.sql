CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  count_label TEXT NOT NULL DEFAULT 'machines',
  cols INT NOT NULL DEFAULT 3,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price TEXT NOT NULL DEFAULT 'Price on request',
  price_note TEXT,
  image TEXT,
  card_desc TEXT,
  tag TEXT,
  intro TEXT,
  spec_title TEXT,
  note TEXT,
  features JSONB NOT NULL DEFAULT '[]',
  specs JSONB NOT NULL DEFAULT '[]',
  show_in_grid BOOLEAN NOT NULL DEFAULT TRUE,
  detail_slug TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS spare_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS spares (
  id SERIAL PRIMARY KEY,
  group_id INT REFERENCES spare_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  address TEXT,
  phones JSONB NOT NULL DEFAULT '[]',
  map_url TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS regional_contacts (
  id SERIAL PRIMARY KEY,
  region TEXT NOT NULL,
  phone TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

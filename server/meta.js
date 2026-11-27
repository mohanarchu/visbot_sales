// Meta (Facebook / Instagram) Lead Ads integration.
//
// Leads reach us three ways, all funnelling through importLead() so they are
// de-duplicated on the Meta leadgen id:
//   1. Webhook   — Meta POSTs a leadgen id the moment someone submits the form.
//   2. Sync      — we poll the Graph API for each lead form (works without a
//                  public URL, and backfills anything a missed webhook dropped).
//   3. CSV       — the export from Ads Manager / Meta Business Suite.
const crypto = require("crypto");
const db = require("./db");

const DEFAULT_API_VERSION = "v22.0";
const GRAPH = "https://graph.facebook.com";

// ---------- settings ----------
// DB values win; environment variables are the fallback so the integration can
// also be configured entirely from .env in a deployment.
const ENV_FALLBACK = {
  meta_app_id: "META_APP_ID",
  meta_app_secret: "META_APP_SECRET",
  meta_page_id: "META_PAGE_ID",
  meta_page_token: "META_PAGE_TOKEN",
  meta_verify_token: "META_VERIFY_TOKEN",
  meta_form_ids: "META_FORM_IDS",
  meta_api_version: "META_API_VERSION",
};

const KEYS = Object.keys(ENV_FALLBACK).concat(["meta_last_sync", "meta_last_webhook"]);

async function getConfig() {
  const rows = (await db.query("SELECT key, value FROM settings WHERE key = ANY($1)", [KEYS])).rows;
  const cfg = {};
  for (const k of KEYS) cfg[k] = null;
  for (const r of rows) cfg[r.key] = r.value || null;
  for (const [k, envName] of Object.entries(ENV_FALLBACK)) {
    if (!cfg[k] && process.env[envName]) cfg[k] = process.env[envName];
  }
  if (!cfg.meta_api_version) cfg.meta_api_version = DEFAULT_API_VERSION;
  return cfg;
}

async function setConfig(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!KEYS.includes(key)) continue;
    const v = typeof value === "string" && value.trim() ? value.trim() : null;
    if (v === null) {
      await db.query("DELETE FROM settings WHERE key=$1", [key]);
    } else {
      await db.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, v]);
    }
  }
}

async function log(event, status, detail) {
  try {
    await db.query(
      "INSERT INTO integration_log (channel, event, status, detail) VALUES ('meta',$1,$2,$3)",
      [event, status, detail ? String(detail).slice(0, 2000) : null]);
  } catch { /* logging must never break the import */ }
}

// Never render a token in full.
function mask(v) {
  if (!v) return "";
  const s = String(v);
  return s.length <= 8 ? "••••" : "••••••••" + s.slice(-6);
}

// ---------- webhook signature ----------
// Meta signs every POST with HMAC-SHA256 of the raw body, keyed by the app
// secret. Without this check anyone could POST fabricated leads to the endpoint.
function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Graph API ----------
async function graph(path, params, cfg, token) {
  const url = new URL(`${GRAPH}/${cfg.meta_api_version}/${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", token || cfg.meta_page_token);

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body && body.error && body.error.message) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.graph = body && body.error;
    throw err;
  }
  return body;
}

// Meta accepts two kinds of token here and they are not interchangeable.
// A *system user* token can read the Page itself, but the page-scoped edges —
// the lead forms, and reading a lead back — are refused with
// "(#190) This method must be called with a Page Access Token".
//
// Rather than make somebody find and paste a second token, ask Meta for the
// Page's own token using the one that is already saved. A Page token derived
// from a system user token that never expires does not expire either, so this
// is the permanent arrangement, not a workaround.
//
// Cached against the saved token, so replacing the token in the panel discards
// the derived one automatically.
let derived = { from: null, token: null };

async function pageToken(cfg) {
  const saved = cfg.meta_page_token;
  if (!saved || !cfg.meta_page_id) return saved;
  if (derived.from === saved && derived.token) return derived.token;
  try {
    const r = await graph(cfg.meta_page_id, { fields: "access_token" }, cfg, saved);
    if (r && r.access_token) {
      derived = { from: saved, token: r.access_token };
      return r.access_token;
    }
  } catch {
    // Already a Page token, or the Page is unreachable — either way the saved
    // token is the best we have, and the caller reports the real error.
  }
  derived = { from: saved, token: saved };
  return saved;
}

const LEAD_FIELDS = [
  "id", "created_time", "field_data", "ad_id", "ad_name",
  "campaign_id", "campaign_name", "form_id", "platform", "is_organic",
].join(",");

async function testConnection(cfg) {
  if (!cfg.meta_page_token) throw new Error("No Page access token saved yet.");
  if (!cfg.meta_page_id) throw new Error("No Page ID saved yet.");
  const page = await graph(cfg.meta_page_id, { fields: "id,name" }, cfg);
  const forms = await listForms(cfg).catch((e) => ({ error: e.message, data: [] }));
  return { page, forms: forms.data || [], formsError: forms.error || null };
}

async function listForms(cfg) {
  return graph(`${cfg.meta_page_id}/leadgen_forms`,
    { fields: "id,name,status,leads_count", limit: 100 }, cfg, await pageToken(cfg));
}

async function fetchLead(leadgenId, cfg) {
  return graph(leadgenId, { fields: LEAD_FIELDS }, cfg, await pageToken(cfg));
}

// ---------- field mapping ----------
// Lead-ad questions arrive as [{name, values:[...]}]. Standard questions have
// predictable names; custom questions can be named anything, so anything we
// cannot place becomes part of the lead's message instead of being dropped.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function mapFieldData(fieldData) {
  const get = {};
  const extras = [];

  for (const f of fieldData || []) {
    const key = norm(f.name);
    const value = Array.isArray(f.values) ? f.values.filter(Boolean).join(", ") : String(f.values || "");
    if (!value) continue;
    if (get[key] === undefined) get[key] = value;
    else extras.push([f.name, value]);
  }

  const pick = (...keys) => {
    for (const k of keys) if (get[k]) return get[k];
    return null;
  };

  const first = pick("first_name", "fname");
  const last = pick("last_name", "lname");
  const name = pick("full_name", "name", "your_name")
    || [first, last].filter(Boolean).join(" ").trim()
    || null;

  const mapped = {
    name: name,
    email: pick("email", "email_address", "work_email"),
    phone: pick("phone_number", "phone", "mobile", "mobile_number", "whatsapp_number", "work_phone"),
    city: pick("city", "town"),
    state: pick("state", "province", "region"),
    company: pick("company_name", "company", "business_name", "organisation", "organization"),
  };

  // A custom question about what they want becomes the lead's "interested in".
  const interestKey = Object.keys(get).find((k) =>
    /machine|product|interest|requirement|looking|need|enquir|inquir|service/.test(k)
  );
  mapped.interest = interestKey ? get[interestKey] : null;

  // Everything we did not map goes into the message, labelled with its question.
  const used = new Set([
    "full_name", "name", "your_name", "first_name", "fname", "last_name", "lname",
    "email", "email_address", "work_email",
    "phone_number", "phone", "mobile", "mobile_number", "whatsapp_number", "work_phone",
    "city", "town", "state", "province", "region",
    "company_name", "company", "business_name", "organisation", "organization",
    interestKey,
  ].filter(Boolean));

  const lines = [];
  for (const f of fieldData || []) {
    const key = norm(f.name);
    if (used.has(key)) continue;
    const value = Array.isArray(f.values) ? f.values.filter(Boolean).join(", ") : String(f.values || "");
    if (value) lines.push(`${f.name}: ${value}`);
  }
  for (const [q, v] of extras) lines.push(`${q}: ${v}`);
  mapped.message = lines.length ? lines.join("\n") : null;

  return mapped;
}

function platformSource(platform) {
  const p = String(platform || "").toLowerCase();
  if (p.includes("instagram") || p === "ig") return "instagram";
  if (p.includes("facebook") || p === "fb") return "facebook";
  return "meta";
}

// ---------- import ----------
// Returns { created: boolean, id } — created:false means we already had it.
async function importLead(graphLead, origin) {
  const f = mapFieldData(graphLead.field_data);
  const leadgenId = String(graphLead.id);
  const source = platformSource(graphLead.platform);

  const existing = await db.query("SELECT id FROM leads WHERE meta_leadgen_id=$1", [leadgenId]);
  if (existing.rows.length) return { created: false, id: existing.rows[0].id };

  const name = f.name || f.company || (f.phone ? "Meta lead " + f.phone : "Meta lead " + leadgenId.slice(-6));

  const ins = await db.query(
    `INSERT INTO leads
       (name, phone, email, company, city, state, interest, message,
        source, status, priority, created_at,
        meta_leadgen_id, meta_form_id, meta_form_name, meta_ad_name,
        meta_campaign_name, meta_platform, meta_raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new','medium',$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (meta_leadgen_id) WHERE meta_leadgen_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      name, f.phone, f.email, f.company, f.city, f.state, f.interest, f.message,
      source, graphLead.created_time ? new Date(graphLead.created_time) : new Date(),
      leadgenId, graphLead.form_id || null, graphLead.form_name || null,
      graphLead.ad_name || null, graphLead.campaign_name || null,
      graphLead.platform || null, JSON.stringify(graphLead),
    ]
  );

  // A concurrent webhook retry can win the race; treat that as "already had it".
  if (!ins.rows.length) {
    const again = await db.query("SELECT id FROM leads WHERE meta_leadgen_id=$1", [leadgenId]);
    return { created: false, id: again.rows.length ? again.rows[0].id : null };
  }

  const id = ins.rows[0].id;
  const where = [
    graphLead.campaign_name && `campaign “${graphLead.campaign_name}”`,
    graphLead.ad_name && `ad “${graphLead.ad_name}”`,
  ].filter(Boolean).join(", ");
  await db.query(
    "INSERT INTO lead_notes (lead_id, note, kind) VALUES ($1,$2,'created')",
    [id, `Came from a Meta lead form on ${source === "instagram" ? "Instagram" : source === "facebook" ? "Facebook" : "Meta"}` +
         (where ? ` — ${where}` : "") + `. Imported via ${origin}.`]
  );
  return { created: true, id };
}

// Pull recent leads for every configured form. `sinceDays` bounds how far back
// we walk, so a long-running page does not page through its whole history.
async function syncLeads(cfg, sinceDays = 30) {
  if (!cfg.meta_page_token) throw new Error("No Page access token saved yet.");

  let formIds = (cfg.meta_form_ids || "").split(/[\s,]+/).filter(Boolean);
  if (!formIds.length) {
    if (!cfg.meta_page_id) throw new Error("Add a Page ID or at least one form ID first.");
    const forms = await listForms(cfg);
    formIds = (forms.data || []).map((f) => f.id);
  }
  if (!formIds.length) return { created: 0, seen: 0, forms: 0, skipped: 0 };

  const cutoff = Date.now() - sinceDays * 86400000;
  let created = 0, seen = 0, skipped = 0;

  for (const formId of formIds) {
    let next = null, pages = 0;
    do {
      const body = next
        ? await (await fetch(next, { signal: AbortSignal.timeout(15000) })).json()
        : await graph(`${formId}/leads`, { fields: LEAD_FIELDS, limit: 100 }, cfg, await pageToken(cfg));

      const rows = body.data || [];
      let tooOld = false;
      for (const row of rows) {
        const t = row.created_time ? new Date(row.created_time).getTime() : Date.now();
        if (t < cutoff) { tooOld = true; continue; }
        seen++;
        const r = await importLead(row, "manual sync");
        if (r.created) created++; else skipped++;
      }
      next = !tooOld && body.paging && body.paging.next ? body.paging.next : null;
      pages++;
    } while (next && pages < 10);
  }

  await setConfig({ meta_last_sync: new Date().toISOString() });
  await log("sync", "ok", `${formIds.length} form(s): ${created} new, ${skipped} already present, ${seen} within ${sinceDays} days`);
  return { created, seen, skipped, forms: formIds.length };
}

// ---------- CSV import (Meta lead export) ----------
// Handles comma- and tab-separated exports, BOMs and quoted fields.
function parseDelimited(text) {
  let s = String(text).replace(/^﻿/, "");
  const firstLine = s.slice(0, s.indexOf("\n") === -1 ? s.length : s.indexOf("\n"));
  const delim = firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";

  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delim) { row.push(cell); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

async function importCsv(text) {
  const rows = parseDelimited(text);
  if (rows.length < 2) throw new Error("That file has no data rows.");

  const header = rows[0].map((h) => norm(h));
  const idx = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  // Meta prefixes some export columns, e.g. "custom_question_..." or "lead_id".
  const loose = (re) => header.findIndex((h) => re.test(h));

  const col = {
    id: idx("id", "lead_id", "leadgen_id"),
    created: idx("created_time", "created", "date_created"),
    form_id: idx("form_id"),
    form_name: idx("form_name"),
    ad_name: idx("ad_name"),
    campaign_name: idx("campaign_name"),
    platform: idx("platform"),
  };

  let created = 0, skipped = 0, failed = 0;

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const val = (i) => (i >= 0 && cells[i] !== undefined ? String(cells[i]).trim() : "");

    // Rebuild field_data from every column that is not integration metadata,
    // so the normal mapper handles standard and custom questions alike.
    const metaCols = new Set(Object.values(col).filter((i) => i >= 0));
    const fieldData = [];
    for (let c = 0; c < header.length; c++) {
      if (metaCols.has(c)) continue;
      const key = header[c];
      if (!key || /^(ad_id|adset_id|adset_name|campaign_id|is_organic|retailer_item_id|partner_name|post_id|vehicle|home_listing|destination|flight|organic)$/.test(key)) continue;
      const v = val(c);
      if (v) fieldData.push({ name: rows[0][c], values: [v] });
    }

    const leadId = val(col.id);
    if (!leadId) { failed++; continue; }

    const graphLead = {
      id: leadId,
      created_time: val(col.created) || null,
      field_data: fieldData,
      form_id: val(col.form_id) || null,
      form_name: val(col.form_name) || null,
      ad_name: val(col.ad_name) || null,
      campaign_name: val(col.campaign_name) || null,
      platform: val(col.platform) || null,
    };

    try {
      const res = await importLead(graphLead, "CSV import");
      if (res.created) created++; else skipped++;
    } catch (e) {
      failed++;
      await log("csv-row", "error", e.message);
    }
  }

  await log("csv", failed ? "warn" : "ok",
    `${created} new, ${skipped} already present, ${failed} row(s) could not be read`);
  return { created, skipped, failed, total: rows.length - 1 };
}

module.exports = {
  DEFAULT_API_VERSION,
  getConfig, setConfig, log, mask,
  verifySignature, graph, testConnection, listForms, fetchLead,
  mapFieldData, platformSource, importLead, syncLeads, importCsv, parseDelimited,
};

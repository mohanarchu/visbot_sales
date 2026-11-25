// Incoming WhatsApp Cloud API messages → leads.
//
// Meta delivers these to the same webhook as the lead ads, because both belong
// to the same app and are signed with the same App Secret. The two are told
// apart by the change's `field`: "leadgen" for a lead form, "messages" here.
//
// The shape that matters, from a click-to-WhatsApp ad:
//
//   { "field": "messages", "value": {
//       "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
//       "contacts": [ { "wa_id": "919876543210", "profile": { "name": "Ramesh" } } ],
//       "messages": [ { "id": "wamid...", "from": "919876543210", "type": "text",
//                       "text": { "body": "I want the welding machine price" },
//                       "referral": { "source_type": "ad", "source_id": "...",
//                                     "headline": "...", "body": "...",
//                                     "source_url": "...", "ctwa_clid": "..." } } ] } }
//
// `value.statuses` arrives far more often than `value.messages` — those are
// delivery and read receipts for messages *we* sent. They are not enquiries and
// are ignored; acting on them would create a lead for every tick mark.
const db = require("./db");

// Only the last ten digits are compared, so +91 98765 43210, 098765 43210 and
// 919876543210 are recognised as one person. Same rule as the panel's users.
function phoneKey(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

// A WhatsApp id is country code + number; keep it readable in the panel.
function prettyPhone(waId) {
  const d = String(waId || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return "+91 " + d.slice(2, 7) + " " + d.slice(7);
  return d ? "+" + d : null;
}

// What the message actually said, for the activity log. Anything that is not
// text is named rather than dropped, so the rep knows to open WhatsApp.
function describe(msg) {
  const type = msg.type || "unknown";
  const caption = (v) => (v && v.caption ? ": " + v.caption : "");
  switch (type) {
    case "text":        return (msg.text && msg.text.body) || "";
    case "button":      return (msg.button && msg.button.text) || "[button]";
    case "interactive": {
      const i = msg.interactive || {};
      const r = i.button_reply || i.list_reply || {};
      return r.title || "[menu reply]";
    }
    case "image":    return "[photo]" + caption(msg.image);
    case "video":    return "[video]" + caption(msg.video);
    case "document": return "[document" + (msg.document && msg.document.filename ? " " + msg.document.filename : "") + "]" + caption(msg.document);
    case "audio":    return "[voice message]";
    case "sticker":  return "[sticker]";
    case "location": {
      const l = msg.location || {};
      return "[location" + (l.name ? " " + l.name : "") + "]";
    }
    case "contacts": return "[shared a contact]";
    case "order":    return "[catalogue order]";
    case "reaction": return "[reacted " + ((msg.reaction && msg.reaction.emoji) || "") + "]";
    default:         return "[" + type + " message]";
  }
}

// Where the conversation came from. Only ad-driven chats carry a referral, and
// that is the whole point of this endpoint: it is the ad enquiry.
function adLine(ref) {
  if (!ref) return null;
  const bits = [];
  if (ref.headline) bits.push("“" + String(ref.headline).slice(0, 200) + "”");
  if (ref.source_id) bits.push("ad " + ref.source_id);
  const where = bits.join(", ");
  return "Started this chat from a WhatsApp ad" + (where ? " — " + where : "") + ".";
}

// An open lead for this number, if we already have one. A won or lost lead is
// left alone: a new message months later is new business, not the old deal.
async function findOpenLead(key) {
  if (!key) return null;
  const { rows } = await db.query(
    `SELECT id, name FROM leads
      WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = $1
        AND status NOT IN ('won','lost')
      ORDER BY created_at DESC
      LIMIT 1`,
    [key]
  );
  return rows.length ? rows[0] : null;
}

// Handles one "messages" change. Returns a tally for the integration log.
// Every message is remembered by its id, so Meta's retries are harmless.
async function handleChange(value, origin = "webhook") {
  const out = { created: 0, appended: 0, duplicates: 0, receipts: 0, failed: 0 };

  const statuses = Array.isArray(value && value.statuses) ? value.statuses : [];
  out.receipts = statuses.length;

  const messages = Array.isArray(value && value.messages) ? value.messages : [];
  if (!messages.length) return out;

  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const nameFor = (waId) => {
    const c = contacts.find((x) => String(x.wa_id) === String(waId));
    const n = c && c.profile && c.profile.name ? String(c.profile.name).trim() : "";
    return n.slice(0, 120);
  };

  for (const msg of messages) {
    const wamid = msg && msg.id ? String(msg.id) : null;
    if (!wamid) { out.failed++; continue; }

    try {
      // Claim the message id first. A unique insert is the lock: a retry
      // arriving while the first is still running loses the race and stops.
      const claim = await db.query(
        "INSERT INTO whatsapp_messages (wamid) VALUES ($1) ON CONFLICT (wamid) DO NOTHING RETURNING wamid",
        [wamid]
      );
      if (!claim.rows.length) { out.duplicates++; continue; }

      const waId = msg.from || (contacts[0] && contacts[0].wa_id) || null;
      const key = phoneKey(waId);
      const text = describe(msg).slice(0, 4000);
      const ad = adLine(msg.referral);
      const when = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

      const existing = await findOpenLead(key);

      if (existing) {
        await db.query(
          "INSERT INTO lead_notes (lead_id, note, kind, created_at) VALUES ($1,$2,'whatsapp',$3)",
          [existing.id, (ad ? ad + " " : "") + "WhatsApp message: " + (text || "(no text)"), when]
        );
        await db.query("UPDATE leads SET updated_at = now() WHERE id=$1", [existing.id]);
        await db.query("UPDATE whatsapp_messages SET lead_id=$1 WHERE wamid=$2", [existing.id, wamid]);
        out.appended++;
        continue;
      }

      const profile = nameFor(waId);
      const phone = prettyPhone(waId);
      const name = profile || (phone ? "WhatsApp " + phone : "WhatsApp enquiry");

      const ins = await db.query(
        `INSERT INTO leads (name, phone, interest, message, source, status, priority, created_at)
         VALUES ($1,$2,$3,$4,'whatsapp','new','medium',$5) RETURNING id`,
        [
          name,
          phone,
          msg.referral && msg.referral.headline ? String(msg.referral.headline).slice(0, 160) : null,
          text || null,
          when,
        ]
      );
      const id = ins.rows[0].id;

      await db.query(
        "INSERT INTO lead_notes (lead_id, note, kind, created_at) VALUES ($1,$2,'created',$3)",
        [
          id,
          (ad || "Sent a message on WhatsApp.") +
            " Arrived through the Cloud API webhook" + (origin === "webhook" ? "" : " (" + origin + ")") +
            ". No state yet, so assign it to a sales person.",
          when,
        ]
      );
      if (text) {
        await db.query(
          "INSERT INTO lead_notes (lead_id, note, kind, created_at) VALUES ($1,$2,'whatsapp',$3)",
          [id, "WhatsApp message: " + text, when]
        );
      }
      await db.query("UPDATE whatsapp_messages SET lead_id=$1 WHERE wamid=$2", [id, wamid]);
      out.created++;
    } catch (e) {
      out.failed++;
      // Let a retry try again rather than swallowing the message for good.
      await db.query("DELETE FROM whatsapp_messages WHERE wamid=$1 AND lead_id IS NULL", [wamid])
        .catch(() => {});
      throw Object.assign(new Error("message " + wamid + ": " + e.message), { tally: out });
    }
  }

  return out;
}

function summarise(t) {
  const bits = [];
  if (t.created) bits.push(t.created + " new lead(s)");
  if (t.appended) bits.push(t.appended + " message(s) added to an open lead");
  if (t.duplicates) bits.push(t.duplicates + " already seen");
  if (t.failed) bits.push(t.failed + " failed");
  if (!bits.length && t.receipts) return t.receipts + " delivery receipt(s), nothing to record.";
  return bits.length ? bits.join(", ") + "." : "Nothing to record.";
}

module.exports = { handleChange, summarise, phoneKey, prettyPhone, describe, adLine };

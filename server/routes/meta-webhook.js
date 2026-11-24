// Public Meta webhook endpoint. Mounted at /api/meta BEFORE the body parsers,
// because the signature has to be checked against the exact raw bytes Meta sent.
const express = require("express");
const router = express.Router();
const meta = require("../meta");

// Verification handshake: Meta calls this once when you subscribe the webhook.
router.get("/webhook", async (req, res) => {
  try {
    const cfg = await meta.getConfig();
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && cfg.meta_verify_token && token === cfg.meta_verify_token) {
      await meta.setConfig({ meta_last_webhook: new Date().toISOString() });
      await meta.log("webhook-verify", "ok", "Verification handshake accepted by Meta.");
      return res.status(200).send(String(challenge || ""));
    }
    await meta.log("webhook-verify", "error",
      "Handshake rejected: the verify token Meta sent does not match the saved one.");
    res.sendStatus(403);
  } catch (e) {
    await meta.log("webhook-verify", "error", e.message);
    res.sendStatus(500);
  }
});

// Lead delivery. The payload carries only ids, so each lead is then read back
// from the Graph API with the Page token.
router.post("/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  let cfg;
  try {
    cfg = await meta.getConfig();
  } catch (e) {
    return res.sendStatus(500);
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const sig = req.get("x-hub-signature-256");

  if (!cfg.meta_app_secret) {
    await meta.log("webhook", "error",
      "Delivery refused: no App Secret saved, so the signature cannot be verified.");
    return res.sendStatus(403);
  }
  if (!meta.verifySignature(raw, sig, cfg.meta_app_secret)) {
    await meta.log("webhook", "error", "Delivery refused: missing or invalid X-Hub-Signature-256.");
    return res.sendStatus(403);
  }

  // Acknowledge straight away — Meta retries anything that is not a fast 200 —
  // then fetch and store the leads.
  res.sendStatus(200);

  (async () => {
    await meta.setConfig({ meta_last_webhook: new Date().toISOString() });
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return meta.log("webhook", "error", "Delivery body was not valid JSON.");
    }

    const ids = [];
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;
        const v = change.value || {};
        if (v.leadgen_id) ids.push(String(v.leadgen_id));
      }
    }
    if (!ids.length) return meta.log("webhook", "ok", "Delivery contained no leadgen entries.");

    if (!cfg.meta_page_token) {
      return meta.log("webhook", "error",
        `Received ${ids.length} lead(s) but no Page access token is saved, so the details could not be fetched.`);
    }

    let created = 0, dupes = 0, failed = 0;
    for (const id of ids) {
      try {
        const lead = await meta.fetchLead(id, cfg);
        const r = await meta.importLead(lead, "webhook");
        if (r.created) created++; else dupes++;
      } catch (e) {
        failed++;
        await meta.log("webhook-lead", "error", `Lead ${id}: ${e.message}`);
      }
    }
    await meta.log("webhook", failed ? "warn" : "ok",
      `${created} new lead(s), ${dupes} already present, ${failed} failed.`);
  })().catch((e) => meta.log("webhook", "error", e.message));
});

module.exports = router;

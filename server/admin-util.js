// Shared helpers for the admin routers.
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const PRODUCTS_DIR = path.join(__dirname, "..", "assets", "products");

const upload = multer({
  storage: multer.diskStorage({
    destination: PRODUCTS_DIR,
    filename: (req, file, cb) => {
      const safe = file.originalname.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
      cb(null, safe);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function listImages() {
  try {
    return fs.readdirSync(PRODUCTS_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  } catch { return []; }
}

function linesToFeatures(text) {
  return (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

// "Label | Value" per line -> [[label, value], ...]
function linesToSpecs(text) {
  return (text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    return i === -1 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  });
}

// "Number | Label" per line -> [{number, label}, ...]
function linesToPhones(text) {
  return (text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    return i === -1
      ? { number: l, label: "" }
      : { number: l.slice(0, i).trim(), label: l.slice(i + 1).trim() };
  });
}

function pickImage(req) {
  if (req.file) return req.file.filename;
  return req.body.image || null;
}

const intOr0 = (v) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 0);

function flash(req, text, type = "ok") {
  req.session.flash = { type, text };
}

const trim = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

module.exports = {
  PRODUCTS_DIR, upload, listImages,
  linesToFeatures, linesToSpecs, linesToPhones,
  pickImage, intOr0, flash, trim,
};

// Richer inputs shared by the content forms.
import { h, icon, field, select, textarea } from "./ui.js";

// Photo chooser with a live preview: pick from the library or upload a file.
export function imagePicker(current, images) {
  const img = h("img", { alt: "", hidden: !current });
  if (current) img.src = "/assets/products/" + current;
  const ph = h("span.ph", { hidden: !!current }, icon("image"), "No photo");

  const sel = select("image",
    [{ value: "", label: "— no photo —" }, ...images.map((f) => ({ value: f, label: f }))],
    current || "");
  const file = h("input", { type: "file", name: "image_file", accept: "image/*" });

  const show = (src) => {
    if (src) { img.src = src; img.hidden = false; ph.hidden = true; }
    else { img.removeAttribute("src"); img.hidden = true; ph.hidden = false; }
  };
  sel.addEventListener("change", () => show(sel.value ? "/assets/products/" + sel.value : ""));
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    if (f) show(URL.createObjectURL(f));
  });

  return h("div.img-pick",
    h("div.img-prev-box", img, ph),
    h("div.stack",
      field({ label: "Photo library", input: sel }),
      field({ label: "Upload a new photo", hint: "JPG, PNG or WebP · max 8 MB", input: file })));
}

// Row editor over a hidden "label | value" textarea, which is what the API takes.
export function pairsEditor(name, pairs, keyPh, valPh) {
  const store = textarea(name, "", { rows: 4, class: "pairs-raw" });
  const rows = h("div.pairs");

  const sync = () => {
    const lines = [];
    rows.querySelectorAll(".pair").forEach((row) => {
      const [a, b] = row.querySelectorAll("input");
      const k = a.value.trim().replace(/\|/g, "/");
      const v = b.value.trim();
      if (k || v) lines.push(v ? k + " | " + v : k);
    });
    store.value = lines.join("\n");
  };

  const addRow = (k = "", v = "") => {
    const a = h("input", { type: "text", value: k, placeholder: keyPh, oninput: sync });
    const b = h("input", { type: "text", value: v, placeholder: valPh, oninput: sync });
    const del = h("button.btn.btn--ghost.btn--icon",
      { type: "button", title: "Remove row", "aria-label": "Remove row" }, icon("trash"));
    const row = h("div.pair", a, b, del);
    del.addEventListener("click", () => {
      row.remove();
      if (!rows.children.length) addRow();
      sync();
    });
    rows.append(row);
    return row;
  };

  (pairs && pairs.length ? pairs : [["", ""]]).forEach(([k, v]) => addRow(k, v));
  sync();

  const add = h("button.btn.btn--ghost.btn--sm", { type: "button" }, icon("plus"), "Add row");
  add.addEventListener("click", () => {
    addRow().querySelector("input").focus();
    sync();
  });

  const raw = h("button.btn.btn--ghost.btn--sm", { type: "button", text: "Edit as text" });
  raw.addEventListener("click", () => {
    const showing = store.classList.toggle("is-shown");
    raw.textContent = showing ? "Back to row editor" : "Edit as text";
    rows.hidden = showing;
    add.hidden = showing;
    if (showing) { store.focus(); return; }
    rows.replaceChildren();
    store.value.split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => {
      const i = l.indexOf("|");
      addRow(i === -1 ? l : l.slice(0, i).trim(), i === -1 ? "" : l.slice(i + 1).trim());
    });
    if (!rows.children.length) addRow();
    sync();
  });

  return h("div", rows, h("div.pairs-foot", add, raw), store);
}

// Textarea with a live "N features" counter.
export function countedTextarea(name, value, noun, props = {}) {
  const ta = textarea(name, value, Object.assign({ rows: 9 }, props));
  const out = h("span.counter");
  const run = () => {
    const n = ta.value.split("\n").filter((l) => l.trim()).length;
    out.textContent = `${n} ${n === 1 ? noun : noun + "s"}`;
  };
  ta.addEventListener("input", run);
  run();
  return h("div", ta, out);
}

// Fill a slug field from a name field until the user edits the slug themselves.
export function linkSlug(nameInput, slugInput) {
  let touched = false;
  slugInput.addEventListener("input", () => { touched = true; });
  nameInput.addEventListener("input", () => {
    if (touched) return;
    slugInput.value = nameInput.value.toLowerCase()
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  });
}

// Offer the referrers already on file while a name is being typed, and fill in
// that person's mobile number once the name matches one of them.
//
// A native <datalist>, as the machine field on a service record uses: the
// browser draws and filters the list, so there is no dropdown of our own to
// get wrong, and typing a name nobody has used before is still just typing.
//
// Returns the <datalist> to put in the form.
export function referrerPicker(nameInput, phoneInput, referrers) {
  const id = "referrer-names";
  nameInput.setAttribute("list", id);

  const byName = new Map();
  referrers.forEach((r) => {
    const key = String(r.name || "").trim().toLowerCase();
    // First one wins, so a repeated name resolves the same way the server does.
    if (key && !byName.has(key)) byName.set(key, r);
  });

  // A number the office typed by hand is never overwritten, the same rule the
  // slug field follows.
  let touched = String(phoneInput.value || "").trim() !== "";
  phoneInput.addEventListener("input", () => { touched = true; });

  nameInput.addEventListener("input", () => {
    if (touched) return;
    const hit = byName.get(nameInput.value.trim().toLowerCase());
    // Only fills; never clears, so backspacing through a name does not empty a
    // number that was just filled in.
    if (hit && hit.phone) phoneInput.value = hit.phone;
  });

  return h("datalist", { id },
    referrers.map((r) => h("option", { value: r.name, label: r.phone || "" })));
}

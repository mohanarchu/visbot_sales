// Seeds the visbot database with the content currently on the static site.
// Safe to re-run: it wipes and refills the five managed tables.
const db = require("./db");
const P = require("./data/products-data.js");

// Decode the HTML entities used in the source data into real characters,
// so content is human-editable in the admin panel.
const ENT = {
  "&#8377;": "₹", "&ndash;": "–", "&mdash;": "—", "&deg;": "°",
  "&times;": "×", "&plusmn;": "±", "&Oslash;": "Ø", "&oslash;": "ø",
  "&nbsp;": " ", "&middot;": "·", "&ldquo;": "“", "&rdquo;": "”",
  "&rarr;": "→", "&larr;": "←", "&amp;": "&",
};
function dec(s) {
  if (s == null) return s;
  return Object.entries(ENT).reduce((a, [k, v]) => a.split(k).join(v), s);
}

const CATEGORIES = [
  { slug: "welding", name: "Welding Machines", count_label: "machines", cols: 3, sort: 1 },
  { slug: "cutting", name: "Cutting Machines", count_label: "machines", cols: 3, sort: 2 },
  { slug: "routers", name: "Copy Router Machines", count_label: "machines", cols: 3, sort: 3 },
  { slug: "finishing", name: "Finishing & Milling", count_label: "machines", cols: 3, sort: 4 },
  { slug: "compressors", name: "Air Compressors", count_label: "models", cols: 4, sort: 5 },
];

// slug -> [category, card_desc]
const CARD = {
  "portable-upvc-welding-machine": ["welding", "Compact 21–30 kg corner welder for on-site fabrication and repairs."],
  "portable-v-welding-machine": ["welding", "Portable V-joint welder for mullion and transom joints in small workshops."],
  "single-head-welding-machine": ["welding", "Pneumatic single head welder with PLC control; also available with digital display."],
  "double-head-welding-machine": ["welding", "Welds two corners simultaneously or independently — double the output per cycle."],
  "seamless-single-head-welding-machine": ["welding", "Near-invisible 0.2 mm weld seam for coloured and laminated profiles."],
  "seamless-double-head-welding-machine": ["welding", "Flagship welder — seamless finish with double head productivity."],
  "single-head-cutting-machine": ["cutting", "Semi-automatic profile cutting with -45° / 90° / 45° turntable angles."],
  "double-head-cutting-machine": ["cutting", "Cuts both profile ends in one pass; also available with digital display."],
  "v-cutting-machine": ["cutting", "Dual-blade 90° V-grooves in a single cycle for mullion joints."],
  "glazed-bead-cutting-machine": ["cutting", "45° miter cuts with trailing-edge trimming for a seamless glazing fit."],
  "aluminium-cutting-machine": ["cutting", "One machine for both aluminium and uPVC profiles — 90° and 45° cuts."],
  "copy-router-lock-hole-machine": ["routers", "Vertical copy milling plus three-hole horizontal drilling in one station."],
  "copy-router-machine-mini": ["routers", "Compact template-copying router for lock slots, water slots and hinge recesses."],
  "portable-copy-router": ["routers", "35–42 kg lock hole maker for site work and mobile crews."],
  "water-slot-machine-tools": ["finishing", "Hand-held drainage slot milling at 90° or 45° for door and window profiles."],
  "end-milling-machine": ["finishing", "Mills mullion ends for a perfect fit, with ±55° angle positioning."],
  "top-bottom-cleaning-machine": ["finishing", "Automatic corner weld-seam cleaning — runs on air alone, no power needed."],
  // air-compressors detail page is hidden from the grid; the 4 model cards below link to it
  "air-compressors": ["compressors", null],
};

const COMPRESSOR_CARDS = [
  { slug: "industrial-air-compressor", name: "Industrial Air Compressor", price: "₹83,000", image: "air-compressor.jpg" },
  { slug: "2hp-air-compressor", name: "2 HP Air Compressor", price: "₹42,000", image: null },
  { slug: "1hp-air-compressor", name: "1 HP Air Compressor", price: "₹23,000", image: null },
  { slug: "single-phase-air-compressor", name: "Single Phase Air Compressor", price: "₹23,000", image: null },
];

const SPARE_GROUPS = [
  { name: "Heating & Welding Spares", sort: 1, items: [
    { name: "Teflon Sheet for Heater Plate", desc: "Non-stick sheet for clean weld release.", image: null },
    { name: "uPVC Heating Plate", desc: "Cast aluminium plate, stable up to 350 °C, 10-inch standard sizing.", image: "heater-plate.jpg" },
    { name: "Portable Heater Plate", desc: "Heater plate for portable welding machines.", image: null },
  ]},
  { name: "Router & Punching Spares", sort: 2, items: [
    { name: "Copy Router Bits", desc: "Ø5 / Ø8 mm upcut spiral bits for lock holes and slots.", image: "router-bit.jpg" },
    { name: "Copy Router Template — uPVC", desc: "Templates for standard uPVC lock preparations.", image: null },
    { name: "Copy Router Template — Aluminium", desc: "Templates for aluminium profile preparations.", image: null },
    { name: "uPVC Interlock Punching Tool", desc: "Heavy lever press for interlock tracks; punches 1–5 mm uPVC cleanly.", image: "interlock-punching-tool.jpg" },
  ]},
  { name: "Corner Cleaning Tools", sort: 3, items: [
    { name: "Pneumatic Cleaning Tool Set", desc: "Air-driven corner seam cleaners, 0.5–0.8 MPa workshop supply.", image: "pneumatic-cleaning-tools.jpg" },
    { name: "Pneumatic Top & Bottom Cleaning Tool", desc: "Cleans both weld faces in one pass with even cylinder pressure.", image: "corner-cleaning-machine.jpg" },
    { name: "Pneumatic Inner & Outer Cleaning Tools", desc: "Inner-corner and 90° outer-corner seam removal tools.", image: "corner-cleaning-tools.jpg" },
    { name: "Electric Top & Bottom Cleaning Tool", desc: "~18,000 rpm electric cleaner for 25–90 mm profiles, 4–6.5 kg.", image: "top-bottom-cleaning-tool.jpg" },
    { name: "uPVC Corner Cleaning Hand Tools", desc: "Electric and manual finishing tools for small workshops — no air line needed.", image: "cleaning-tool-set.jpg" },
    { name: "Cleaning Tool Holder", desc: "Holder for corner cleaning tool bits.", image: null },
  ]},
];

const LOCATIONS = [
  { title: "Factory — Coimbatore",
    address: "SF.No. 647 & 648, Pollachi Main Road,\nopposite Hemambigai Mahal, Eachanari,\nCoimbatore, Tamil Nadu 641021",
    phones: [{ number: "+91 80723 98966", label: "sales & enquiries" }, { number: "+91 99405 89366", label: "technical support" }],
    map_url: "https://maps.google.com/?q=Visbot+Industries+Eachanari+Coimbatore", sort: 1 },
  { title: "Experience Center — Bengaluru",
    address: "No. 552, “Shivasakthi”, 4th Main Road,\n11th Block, Anjanapura,\nBengaluru, Karnataka 560083",
    phones: [{ number: "+91 93848 18404", label: "Karnataka sales" }],
    map_url: null, sort: 2 },
  { title: "Proprietor",
    address: "Mr. Ganesh Srinivasan",
    phones: [{ number: "+91 80723 98966", label: "" }, { number: "+91 99405 89366", label: "" }],
    map_url: null, sort: 3 },
];

const REGIONS = [
  ["Tamil Nadu (Head Office)", "+91 80723 98966"],
  ["Andhra Pradesh & Telangana", "+91 99405 89365"],
  ["Karnataka", "+91 93848 18404"],
  ["Kerala", "+91 93848 18403"],
  ["Maharashtra", "+91 89258 03466"],
  ["Madhya Pradesh", "+91 93848 18401"],
  ["Odisha & West Bengal", "+91 93848 18402"],
  ["Uttar Pradesh", "+91 89258 03467"],
];

async function run() {
  await db.query("TRUNCATE spares, spare_groups, products, categories, locations, regional_contacts RESTART IDENTITY CASCADE");

  const catId = {};
  for (const c of CATEGORIES) {
    const r = await db.query(
      "INSERT INTO categories (name, slug, count_label, cols, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [c.name, c.slug, c.count_label, c.cols, c.sort]
    );
    catId[c.slug] = r.rows[0].id;
  }

  let sort = 0;
  for (const p of P) {
    const [cat, cardDesc] = CARD[p.slug];
    sort += 1;
    await db.query(
      `INSERT INTO products (category_id, slug, name, price, price_note, image, card_desc, tag, intro, spec_title, note, features, specs, show_in_grid, detail_slug, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        catId[cat], p.slug, dec(p.name), dec(p.price), p.priceNote || null, p.img,
        dec(cardDesc), dec(p.tag), dec(p.intro), dec(p.specTitle) || null, dec(p.note) || null,
        JSON.stringify(p.features.map(dec)),
        JSON.stringify(p.specs.map((r) => [dec(r[0]), dec(r[1])])),
        p.slug !== "air-compressors", // the detail page exists but the grid shows the 4 model cards
        null, sort,
      ]
    );
  }

  for (const c of COMPRESSOR_CARDS) {
    sort += 1;
    await db.query(
      `INSERT INTO products (category_id, slug, name, price, price_note, show_in_grid, detail_slug, image, sort_order)
       VALUES ($1,$2,$3,$4,'onwards',TRUE,'air-compressors',$5,$6)`,
      [catId["compressors"], c.slug, c.name, c.price, c.image, sort]
    );
  }

  for (const g of SPARE_GROUPS) {
    const r = await db.query("INSERT INTO spare_groups (name, sort_order) VALUES ($1,$2) RETURNING id", [g.name, g.sort]);
    let s = 0;
    for (const it of g.items) {
      s += 1;
      await db.query(
        "INSERT INTO spares (group_id, name, description, image, sort_order) VALUES ($1,$2,$3,$4,$5)",
        [r.rows[0].id, it.name, it.desc, it.image, s]
      );
    }
  }

  for (const l of LOCATIONS) {
    await db.query(
      "INSERT INTO locations (title, address, phones, map_url, sort_order) VALUES ($1,$2,$3,$4,$5)",
      [l.title, l.address, JSON.stringify(l.phones), l.map_url, l.sort]
    );
  }

  let rs = 0;
  for (const [region, phone] of REGIONS) {
    rs += 1;
    await db.query("INSERT INTO regional_contacts (region, phone, sort_order) VALUES ($1,$2,$3)", [region, phone, rs]);
  }

  const counts = await db.query(
    `SELECT (SELECT count(*) FROM categories) cats, (SELECT count(*) FROM products) products,
            (SELECT count(*) FROM spare_groups) groups, (SELECT count(*) FROM spares) spares,
            (SELECT count(*) FROM locations) locations, (SELECT count(*) FROM regional_contacts) regions`
  );
  console.log("Seeded:", counts.rows[0]);
  await db.pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });

// The referral screens: the questions on the lead form, and the referrals pages.
//
//   node tests/referrals-ui.mjs
//
// Runs the real render functions against a DOM stand-in. Two bugs this guards
// against: a required field left switched on inside a hidden section, which
// blocks the form with nothing on screen to explain why; and a class name that
// no stylesheet defines, which renders as an unstyled heap rather than failing.
import { readFileSync } from "node:fs";
import { install } from "./dom-shim.mjs";
install();

const io_read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

let pass = 0;
const fails = [];
const ok = (m) => { pass++; console.log("  PASS  " + m); };
const bad = (m, d) => { fails.push(m); console.log("  FAIL  " + m + "\n     " + (d || "")); };
const say = (m) => console.log("\n== " + m);
const is = (got, want, m) => (String(got) === String(want)
  ? ok(m) : bad(m, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`));

// The lists normally fetched from /vocab at boot.
const vocab = await import("../admin-app/js/vocab.js");
vocab.SOURCES.push(
  { key: "phone", label: "Phone call" },
  { key: "referral", label: "Referral" },
  { key: "website", label: "Website form" });
vocab.STATUSES.push({ key: "new", label: "New", chip: "info" }, { key: "won", label: "Won", chip: "ok" });
vocab.PRIORITIES.push({ key: "medium", label: "Medium" }, { key: "high", label: "High" });

const { leadForm } = await import("../admin-app/js/views/leads.js");

// --------------------------------------------------------------- helpers ---
const named = (root, name) => {
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (n.attrs && n.attrs.name === name) { hit = n; return; }
    (n.children || []).forEach(walk);
  };
  walk(root);
  return hit;
};
// The section whose heading is this text.
const sectionTitled = (root, title) => {
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (n.tagName === "SECTION" && n.textContent.includes(title)) hit = n;
    (n.children || []).forEach(walk);
  };
  walk(root);
  return hit;
};
const hidden = (el) => !!el && el.classList.contains("is-hidden");
// The <label> wrapping an input, which is what carries .is-hidden.
const fieldOf = (root, name) => {
  const input = named(root, name);
  let hit = null;
  const walk = (n) => {
    if ((n.children || []).includes(input)) hit = n;
    (n.children || []).forEach(walk);
  };
  walk(root);
  return hit;
};

const ON_FILE = [
  { id: 1, name: "Ramesh Kumar", phone: "+91 98765 43210" },
  { id: 2, name: "Priya S", phone: "+91 90000 11111" },
  { id: 3, name: "No Number", phone: null },
];

const build = (lead, referrers = ON_FILE) => {
  const form = leadForm.render(
    { lead: lead ? { data: { lead } } : null, team: [], states: [], referrers },
    { params: lead ? { id: String(lead.id) } : {}, query: {}, navigate() {} });
  return {
    form,
    section: sectionTitled(form, "Who referred this lead?"),
    source: named(form, "source"),
    refName: named(form, "referrer_name"),
    refPhone: named(form, "referrer_phone"),
    kind: named(form, "referral_kind"),
    value: named(form, "referral_value"),
    list: (() => {
      let hit = null;
      const walk = (n) => { if (n.tagName === "DATALIST") hit = n; (n.children || []).forEach(walk); };
      walk(form);
      return hit;
    })(),
  };
};

// ------------------------------------------------------- a new phone lead ---
say("a new lead is not a referral, so nothing is asked");
{
  const f = build(null);
  f.section ? ok("the referral section exists in the form") : bad("the referral section exists", "not found");
  is(hidden(f.section), true, "but it is hidden");
  is(f.refName.attrs.required === undefined && !f.refName.required, true,
     "and the referrer name is not required while hidden");
  is(f.source.selectedValue, "phone", "the source starts as a phone call");
}

// ----------------------------------------------------- switching to referral ---
say("choosing Referral asks who referred it");
{
  const f = build(null);
  f.source.value = "referral";
  f.source.dispatch("change");
  is(hidden(f.section), false, "the section appears");
  is(f.refName.required, true, "the referrer name becomes required");
  is(hidden(fieldOf(f.form, "referral_value")), true,
     "but the fee amount stays hidden until a kind is chosen");
  is(f.value.required, false, "so the amount is not required yet");

  // ...and back again
  f.source.value = "phone";
  f.source.dispatch("change");
  is(hidden(f.section), true, "switching back hides it again");
  is(f.refName.required, false, "and drops the required flag with it");
}

// ------------------------------------------------------------- the fee ------
say("the fee amount describes itself");
{
  const f = build(null);
  f.source.value = "referral";
  f.source.dispatch("change");

  f.kind.value = "percent";
  f.kind.dispatch("change");
  const pctField = fieldOf(f.form, "referral_value");
  is(hidden(pctField), false, "a percentage fee shows the amount box");
  is(pctField.textContent.includes("Percentage of the order"), true, "labelled as a percentage");
  is(pctField.textContent.includes("0 to 100"), true, "with the range as a hint");
  is(f.value.required, true, "and the amount is now required");

  f.kind.value = "flat";
  f.kind.dispatch("change");
  is(pctField.textContent.includes("Flat amount"), true, "a flat fee relabels the same box");
  is(pctField.textContent.includes("in rupees"), true, "and says rupees");

  // A number left behind under "Not agreed yet" would be refused by the
  // server, so the box is cleared with it.
  f.value.value = "2500";
  f.kind.value = "";
  f.kind.dispatch("change");
  is(hidden(pctField), true, "setting the fee back to none hides the box");
  is(f.value.value, "", "and clears the number that was in it");
  is(f.value.required, false, "and stops requiring it");
}

// ------------------------------------------------- editing an existing lead ---
say("editing a referral lead opens with its answers filled in");
{
  const f = build({
    id: 7, name: "Suresh", source: "referral", status: "new", priority: "medium",
    referrer_id: 3, referrer_name: "Ramesh Kumar", referrer_phone: "+91 98765 43210",
    referral_kind: "percent", referral_value: "5.00",
  });
  is(hidden(f.section), false, "the section is open straight away");
  is(f.refName.attrs.value, "Ramesh Kumar", "the referrer's name is filled in");
  is(f.refPhone.attrs.value, "+91 98765 43210", "and their mobile");
  is(f.kind.selectedValue, "percent", "the fee kind is selected");
  is(f.value.attrs.value, "5.00", "and the rate is filled in");
  is(hidden(fieldOf(f.form, "referral_value")), false, "with the amount box showing");
  is(f.refName.required, true, "the name is required, as the section is open");
}

say("editing a non-referral lead leaves the section shut");
{
  const f = build({
    id: 8, name: "Anita", source: "phone", status: "new", priority: "medium",
    referrer_id: null, referral_kind: null, referral_value: null,
  });
  is(hidden(f.section), true, "the section is hidden");
  is(f.refName.required, false, "and asks nothing");
}

// ------------------------------------------- picking a known referrer ------
say("the referrers already on file are offered while typing");
{
  const f = build(null);
  f.list ? ok("the form carries a datalist of referrers") : bad("the form carries a datalist", "none found");
  is(f.list.findAll("option").length, 3, "with one option each");
  is(f.refName.getAttribute("list"), f.list.getAttribute("id"),
     "and the name box is wired to it");
  const opts = f.list.findAll("option").map((o) => o.getAttribute("value"));
  is(opts.join(" | "), "Ramesh Kumar | Priya S | No Number", "the names are the options");
  is(f.list.findAll("option")[0].getAttribute("label"), "+91 98765 43210",
     "with the mobile offered alongside, to tell two same-named people apart");
}

say("picking one fills in their mobile");
{
  const f = build(null);
  f.refName.value = "Ramesh Kumar";
  f.refName.dispatch("input");
  is(f.refPhone.value, "+91 98765 43210", "the mobile is filled in");

  // Typed, not picked: same effect, since it is the same person.
  const g = build(null);
  g.refName.value = "  priya s  ";
  g.refName.dispatch("input");
  is(g.refPhone.value, "+91 90000 11111", "spacing and case do not matter");
}

say("a name nobody has used is just typed");
{
  const f = build(null);
  f.refName.value = "Brand New Person";
  f.refName.dispatch("input");
  is(f.refPhone.value, "", "no mobile is invented for them");
  is(f.refName.required, false, "and nothing blocks the form yet (source is still a phone call)");
}

say("a referrer on file with no mobile fills nothing");
{
  const f = build(null);
  f.refName.value = "No Number";
  f.refName.dispatch("input");
  is(f.refPhone.value, "", "the empty mobile is not copied over");
}

say("a mobile typed by hand is never overwritten");
{
  const f = build(null);
  f.refPhone.value = "+91 99999 00000";
  f.refPhone.dispatch("input");
  f.refName.value = "Ramesh Kumar";
  f.refName.dispatch("input");
  is(f.refPhone.value, "+91 99999 00000", "the number the office typed stands");
}

say("editing a lead does not re-fill a mobile already saved on it");
{
  const f = build({
    id: 11, name: "Vijay", source: "referral", status: "new", priority: "medium",
    referrer_id: 1, referrer_name: "Ramesh Kumar", referrer_phone: "+91 11111 22222",
    referral_kind: null, referral_value: null,
  });
  // The saved number differs from the one on file; retyping the name must not
  // quietly change what this lead has always said.
  f.refName.dispatch("input");
  is(f.refPhone.value, "+91 11111 22222", "the saved number is left alone");
}

say("backspacing through a name does not clear the mobile");
{
  const f = build(null);
  f.refName.value = "Ramesh Kumar";
  f.refName.dispatch("input");
  f.refName.value = "Ramesh Kuma";
  f.refName.dispatch("input");
  is(f.refPhone.value, "+91 98765 43210", "the filled number stays");
}

say("the form still works when no referrers could be loaded");
{
  const f = build(null, []);
  is(f.list.findAll("option").length, 0, "an empty datalist, not a crash");
  f.refName.value = "Anyone";
  f.refName.dispatch("input");
  is(f.refPhone.value, "", "and typing a name is harmless");
}

// ------------------------------------------------- the referrals pages ------
// Class names are checked against the real stylesheets: a view that emits a
// class nothing defines does not throw, it just renders unstyled.
const CSS = io_read("css/admin.css") + io_read("admin-app/css/app.css");
const classesIn = (n, out = new Set()) => {
  (n.classList ? [...n.classList.set] : []).forEach((c) => out.add(c));
  (n.children || []).forEach((c) => classesIn(c, out));
  return out;
};
const undefinedClasses = (node) => [...classesIn(node)].filter((c) =>
  !new RegExp("\\." + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-zA-Z0-9_-])").test(CSS));

const V = await import("../admin-app/js/views/referrers.js");
const pageCtx = { params: { id: "3" }, query: {}, navigate() {}, reload() {} };

const RF = { id: 3, name: "Ramesh Kumar", phone: "+91 98765 43210", active: true, notes: "Met at the expo.",
  lead_count: 4, won_count: 1, open_count: 2, flat_won_total: 2500, flat_all_total: 5000, percent_count: 1 };

say("the referrals list");
{
  const el = V.referrersList.render({
    data: [RF, { id: 4, name: "Off Person", phone: null, active: false, lead_count: 0,
                 won_count: 0, open_count: 0, flat_won_total: 0, flat_all_total: 0, percent_count: 0 }],
    meta: { total: 2, page: 1, pages: 1, per_page: 25 },
    totals: { referrers: 2, referred_leads: 4, won_leads: 1, flat_won_total: 2500 },
  }, pageCtx);
  is([...classesIn(el)].includes("stats"), true, "the stat cards use the .stats grid");
  is(undefinedClasses(el).join(" "), "", "every class it emits is defined in the stylesheets");
  is(el.textContent.includes("\u20b92,500"), true, "flat fees show as rupees");
  is([...classesIn(el)].includes("is-dim"), true, "a switched-off referrer is dimmed");

  // Only `.search input` is styled; a bare input in the toolbar renders as an
  // unstyled box with no border and no magnifier.
  const search = (() => {
    let hit = null;
    const walk = (n) => {
      if (n.classList && n.classList.contains("search")) hit = n;
      (n.children || []).forEach(walk);
    };
    walk(el);
    return hit;
  })();
  is(!!search, true, "the search box has its .search wrapper");
  is(search && search.findAll("input").length, 1, "with the input inside it");
  is(el.findAll("form").length, 1, "and the toolbar is a form, so Enter searches");
}

say("one referrer's page");
{
  const el = V.referrerDetail.render({
    data: { referrer: RF, leads: [{ id: 9, name: "Suresh", phone: "98765 00000", company: "ABC",
      status: "won", referral_kind: "flat", referral_value: "2500.00", owner: "Ravi",
      created_at: "2026-11-20T10:00:00Z" }] },
  }, pageCtx);
  is(undefinedClasses(el).join(" "), "", "every class it emits is defined");
  is(el.textContent.includes("Remove"), true, "removing them lives on their own page");
  is(el.textContent.includes("named on 4 leads"), true,
     "and explains why a referrer with leads cannot be removed");
  is(el.textContent.includes("cannot work out the rupees"), true,
     "a percentage referral says why it has no rupee figure");
}

say("the referrer form");
{
  const el = V.referrerForm.render(
    { data: { referrer: Object.assign({}, RF, { lead_count: 0 }) } }, pageCtx);
  is(undefinedClasses(el).join(" "), "", "every class it emits is defined");
  const feet = [...classesIn(el)].filter((c) => c.startsWith("form-foot"));
  is(feet.join(","), "form-foot", "one sticky footer, not two");
}

console.log("");
if (fails.length) {
  console.log(`${pass} passed, ${fails.length} failed:`);
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log(`all ${pass} checks passed`);

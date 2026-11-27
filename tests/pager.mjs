// The pager component: what it renders, and the links it points at.
//
//   node tests/pager.mjs
//
// Runs the real ui.js against a small DOM stand-in, because the bug this
// guards against is a pager that quietly renders nothing.

let pass = 0;
const fails = [];
const ok = (m) => { pass++; console.log("  PASS  " + m); };
const bad = (m, d) => { fails.push(m); console.log("  FAIL  " + m + "\n     " + (d || "")); };
const say = (m) => console.log("\n== " + m);
const is = (got, want, m) => (String(got) === String(want) ? ok(m) : bad(m, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`));

// ---------------------------------------------------------------- DOM shim ---
import { install } from "./dom-shim.mjs";
install();

// Everything in the tree carrying this class, in document order.
const withClass = (node, cls, out = []) => {
  if (node.classList && node.classList.contains(cls)) out.push(node);
  (node.children || []).forEach((c) => withClass(c, cls, out));
  return out;
};
const anchors = (node) => node.findAll("a");

const { pager, pageHref, pagedQuery, PER_PAGE_CHOICES } = await import("../admin-app/js/ui.js");

const href = pageHref("/leads", {});
const labels = (el) => anchors(el).map((a) => a.textContent.trim());

// ------------------------------------------------------- one page of rows ---
say("a single page still shows the count and the row sizes");
{
  // 21 leads, 25 to a page: this is exactly what the live panel looks like.
  const p = pager({ total: 21, page: 1, pages: 1, per_page: 25 }, href);
  if (!p) { bad("a one-page list renders a pager", "got null"); }
  else {
    ok("a one-page list renders a pager");
    const txt = p.textContent;
    txt.includes("Showing 1–21 of 21")
      ? ok("it states the range") : bad("it states the range", txt);
    txt.includes("Page 1 of 1")
      ? bad("no dead 'Page 1 of 1'", txt) : ok("no dead 'Page 1 of 1'");
    is(withClass(p, "btn").length, 0, "and no dead step buttons");
    is(labels(p).join(" "), "10", "offers the one smaller size, 10");
    is(withClass(p, "per-page-on")[0] && withClass(p, "per-page-on")[0].textContent, "25",
       "and marks 25 as the size in use");
    is(anchors(p)[0].getAttribute("href"), "/leads?per_page=10",
       "the 10 link asks for ten rows");
  }
}

say("a list too short to page at all has nothing to choose");
{
  const p = pager({ total: 3, page: 1, pages: 1, per_page: 25 }, href);
  p ? ok("3 rows still shows the count") : bad("3 rows still shows the count", "null");
  is(withClass(p, "per-page").length, 0, "but no row sizes, since none would page it");
  is(p.textContent.includes("Showing 1–3 of 3"), true, "the range reads 1–3 of 3");
}

say("an empty list has no pager");
is(pager({ total: 0, page: 1, pages: 1, per_page: 25 }, href), null, "0 rows renders nothing");
is(pager(null, href), null, "a missing meta block renders nothing");

// --------------------------------------------------------- several pages ----
say("the middle of a long list");
{
  const p = pager({ total: 120, page: 3, pages: 5, per_page: 25 }, href);
  const txt = p.textContent;
  txt.includes("Showing 51–75 of 120") ? ok("the range is this page's slice") : bad("the range", txt);
  txt.includes("Page 3 of 5") ? ok("it says which page") : bad("it says which page", txt);
  is(withClass(p, "is-off").length, 0, "every step is live in the middle");
  const ls = labels(p);
  is(ls.includes("« First") && ls.includes("Last »"), true, "First and Last are links");
  is(PER_PAGE_CHOICES.every((n) => ls.includes(String(n)) || n === 25), true,
     "and every row size is offered");
}

say("the ends of a long list");
{
  const first = pager({ total: 120, page: 1, pages: 5, per_page: 25 }, href);
  is(withClass(first, "is-off").length, 2, "on page 1, First and Previous are dead");
  is(withClass(first, "is-off").map((s) => s.textContent).join("|"), "« First|Previous",
     "and it is those two, not Next");
  const last = pager({ total: 120, page: 5, pages: 5, per_page: 25 }, href);
  is(withClass(last, "is-off").map((s) => s.textContent).join("|"), "Next|Last »",
     "on the last page it is Next and Last");
  is(last.textContent.includes("Showing 101–120 of 120"), true,
     "a short last page reports the real end, not 125");
}

// ------------------------------------------------------------- the links ----
say("the links keep the filters");
{
  const q = { status: "new", period: "today", page: "2" };
  const hf = pageHref("/leads", q);
  is(hf(3), "/leads?status=new&period=today&page=3", "a page link keeps status and period");
  is(hf(1), "/leads?status=new&period=today", "page 1 is left out of the URL");
  is(hf(1, 10), "/leads?status=new&period=today&per_page=10", "a size link resets to page 1");
  is(hf(1, 25), "/leads?status=new&period=today", "the default size is left out too");
}

say("a size already in the URL is replaced, not repeated");
{
  const hf = pageHref("/products", { per_page: "10", page: "4" });
  is(hf(1, 50), "/products?per_page=50", "10 becomes 50");
  is(hf(2), "/products?per_page=10&page=2", "and a plain page link keeps the 10");
}

say("pagedQuery agrees with pageHref");
{
  const q = { status: "new", per_page: "10" };
  is(JSON.stringify(pagedQuery(q, 2)), JSON.stringify({ status: "new", per_page: "10", page: 2 }),
     "a page link keeps the chosen size");
  is(JSON.stringify(pagedQuery(q, 1, 50)), JSON.stringify({ status: "new", per_page: 50, page: "" }),
     "a size link swaps it and clears the page");
  is(JSON.stringify(pagedQuery(q, 1, 25)), JSON.stringify({ status: "new", per_page: "", page: "" }),
     "and the default clears it");
}

console.log("");
if (fails.length) {
  console.log(`${pass} passed, ${fails.length} failed:`);
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log(`all ${pass} checks passed`);

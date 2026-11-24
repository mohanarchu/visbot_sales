// The website's enquiry form, run in node against a hand-built DOM.
//
// What matters here is that submitting the form IS the submission: it posts to
// /api/enquiry, waits for the answer, confirms on the page, and never hands the
// visitor off to WhatsApp — an enquiry that only became a WhatsApp draft never
// reached the admin panel.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "js", "main.js"), "utf8");

let pass = 0;
const fails = [];
function check(what, fn) {
  try { fn(); pass++; console.log("  ok   " + what); }
  catch (e) { fails.push(what); console.log("  FAIL " + what + "\n       " + e.message); }
}

// ---------------------------------------------------------------- tiny DOM --
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
    this.listeners = {};
    this.value = "";
    this.disabled = false;
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.options = [];
    this.selectedIndex = -1;
    this.classList = {
      add: () => {}, remove: () => {}, contains: () => false, toggle: () => false,
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(k) { k.parentNode = this; this.children.push(k); return k; }
  append(...k) { k.forEach((x) => this.appendChild(x)); }
  insertBefore(node, ref) {
    node.parentNode = this;
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  removeChild(k) {
    const i = this.children.indexOf(k);
    if (i >= 0) this.children.splice(i, 1);
    k.parentNode = null;
    return k;
  }
  add(opt, at) { this.options.splice(at === undefined ? this.options.length : at, 0, opt); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    const l = this.listeners[type] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatch(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
  scrollIntoView() { this.scrolled = true; }
  reset() {
    this.wasReset = true;
    const clear = (el) => {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = '';
      el.children.forEach(clear);
    };
    this.children.forEach(clear);
  }
  // Only the selectors main.js actually uses.
  querySelector(sel) {
    if (sel.startsWith("#")) return this.byId(sel.slice(1));
    if (sel === 'button[type="submit"]') return this.find((e) => e.tagName === "BUTTON");
    if (sel === ".form-done") return this.find((e) => /form-done/.test(e.className));
    return null;
  }
  querySelectorAll() { return []; }
  byId(id) { return this.find((e) => e.attrs.id === id); }
  find(pred) {
    for (const c of this.children) {
      if (pred(c)) return c;
      const hit = c.find(pred);
      if (hit) return hit;
    }
    return null;
  }
}

function field(id, value) {
  const el = new El("input");
  el.setAttribute("id", id);
  el.value = value;
  return el;
}

// Builds a page with the enquiry form on it and runs main.js against it.
function load({ search = "", fetchImpl } = {}) {
  const body = new El("body");
  const form = new El("form");
  form.className = "enquiry";
  const holder = new El("div");
  holder.appendChild(form);
  body.appendChild(holder);

  form.append(
    field("f-name", "Ramesh Kumar"),
    field("f-phone", "98765 43210"),
    field("f-email", "ramesh@example.com"),
    field("f-msg", "Need a quote for 2 units."),
  );

  const machine = new El("select");
  machine.setAttribute("id", "f-machine");
  ["Welding Machine", "Cutting Machine"].forEach((t) => {
    const o = new El("option");
    o.text = t;
    machine.options.push(o);
  });
  machine.selectedIndex = 0;
  Object.defineProperty(machine, "value", {
    get() { return this.selectedIndex >= 0 ? this.options[this.selectedIndex].text : ""; },
    set() {},
  });
  form.appendChild(machine);

  const state = new El("select");
  state.setAttribute("id", "f-state");
  state.value = "Tamil Nadu";
  form.appendChild(state);

  const button = new El("button");
  button.setAttribute("type", "submit");
  button.textContent = "Send enquiry";
  form.appendChild(button);

  const calls = [];
  const opened = [];

  const document = {
    documentElement: { classList: { add() {} }, scrollTop: 0, scrollHeight: 1000, clientHeight: 500 },
    body,
    createElement: (tag) => new El(tag),
    querySelector: (sel) => (sel === "form.enquiry" ? form : body.querySelector(sel)),
    querySelectorAll: () => [],
    getElementById: (id) => body.byId(id),
    addEventListener() {},
  };

  const sandbox = {
    document,
    console,
    URLSearchParams,
    setTimeout,
    fetch: fetchImpl || ((url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, id: 42 }) });
    }),
    window: {
      location: { search, href: "http://visbot.in/contact.html" + search },
      matchMedia: () => ({ matches: true }),
      open: (u) => { opened.push(u); return {}; },
      addEventListener() {},
      scrollTo() {},
      requestAnimationFrame: (fn) => fn(),
      innerHeight: 800,
    },
    IntersectionObserver: class { observe() {} unobserve() {} },
    Element: El,
  };
  sandbox.window.document = document;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "main.js" });

  return { form, button, holder, calls, opened, machine };
}

const submitted = () => ({ preventDefault() {} });
const settle = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ checks --
console.log("the enquiry form posts to the server");
{
  const page = load();
  page.form.dispatch("submit", submitted());
  await settle();

  check("it posts to /api/enquiry", () => {
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].url, "/api/enquiry");
    assert.equal(page.calls[0].opts.method, "POST");
  });

  check("it sends every field the lead needs", () => {
    const sent = new URLSearchParams(page.calls[0].opts.body.toString());
    assert.equal(sent.get("name"), "Ramesh Kumar");
    assert.equal(sent.get("phone"), "98765 43210");
    assert.equal(sent.get("email"), "ramesh@example.com");
    assert.equal(sent.get("state"), "Tamil Nadu");
    assert.equal(sent.get("interest"), "Welding Machine");
    assert.equal(sent.get("message"), "Need a quote for 2 units.");
  });

  check("it never hands the visitor off to WhatsApp", () => {
    assert.deepEqual(page.opened, []);
  });

  check("it confirms on the page, with the reference number", () => {
    const box = page.holder.children.find((c) => /form-done/.test(c.className));
    assert.ok(box, "no confirmation was shown");
    assert.ok(!/form-done--warn/.test(box.className), "shown as a failure");
    assert.match(box.innerHTML, /reference #42/);
    assert.match(box.innerHTML, /98765 43210/);
    assert.ok(box.scrolled, "the confirmation was not scrolled into view");
  });

  check("the button says so and cannot be pressed twice", () => {
    assert.equal(page.button.textContent, "Enquiry sent");
    assert.equal(page.button.disabled, true);
  });

  check("the form is cleared", () => {
    assert.equal(page.form.wasReset, true);
  });

  check("but a second enquiry is possible once they type again", () => {
    page.form.dispatch("input", {});
    assert.equal(page.button.disabled, false);
    assert.equal(page.button.textContent, "Send enquiry");
    page.form.dispatch("input", {});
    assert.equal(page.button.disabled, false, "the listener should fire only once");
  });
}

console.log("when the server cannot be reached");
{
  const page = load({ fetchImpl: () => Promise.reject(new Error("offline")) });
  page.form.dispatch("submit", submitted());
  await settle();

  check("it says so instead of pretending the enquiry was sent", () => {
    const box = page.holder.children.find((c) => /form-done/.test(c.className));
    assert.ok(box, "nothing was shown");
    assert.match(box.className, /form-done--warn/);
    assert.match(box.innerHTML, /could not record/i);
  });

  check("it offers the phone number and the email address", () => {
    const box = page.holder.children.find((c) => /form-done/.test(c.className));
    assert.match(box.innerHTML, /80723 98966/);
    assert.match(box.innerHTML, /visbotindustries@gmail\.com/);
  });

  check("the button can be pressed again", () => {
    assert.equal(page.button.disabled, false);
    assert.equal(page.button.textContent, "Send enquiry");
  });
}

console.log("when the server answers with a failure");
{
  const page = load({
    fetchImpl: () => Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) }),
  });
  page.form.dispatch("submit", submitted());
  await settle();

  check("a rejected enquiry is not reported as received", () => {
    const box = page.holder.children.find((c) => /form-done/.test(c.className));
    assert.match(box.className, /form-done--warn/);
  });
}

console.log("an Enquire button elsewhere on the site");
{
  const page = load({ search: "?interest=Double%20Head%20Welding%20Machine" });
  check("the machine arrives selected, even though it is not in the list", () => {
    assert.equal(page.machine.options[0].text, "Double Head Welding Machine");
    assert.equal(page.machine.selectedIndex, 0);
  });

  page.form.dispatch("submit", submitted());
  await settle();
  check("and it reaches the lead", () => {
    const sent = new URLSearchParams(page.calls[0].opts.body.toString());
    assert.equal(sent.get("interest"), "Double Head Welding Machine");
  });
}
{
  const page = load({ search: "?interest=welding%20machine" });
  check("one that matches an option just selects it, without duplicating", () => {
    assert.equal(page.machine.options.length, 2);
    assert.equal(page.machine.selectedIndex, 0);
  });
}
{
  const page = load({ search: "?interest=Cutting%20Machine" });
  check("a later option is selected rather than the first", () => {
    assert.equal(page.machine.options.length, 2);
    assert.equal(page.machine.selectedIndex, 1);
  });
}

console.log("");
if (fails.length) {
  console.log(pass + " passed, " + fails.length + " failed:");
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("all " + pass + " checks passed");

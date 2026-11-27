// DOM building blocks. Text always goes through textContent, so database
// content can never be interpreted as markup.
import { icon } from "./icons.js";

export { icon };

// h("div.panel", { onclick }, child, "text")
export function h(spec, props, ...children) {
  const [tag, ...classes] = String(spec).split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");

  if (props && (props.nodeType || typeof props === "string" || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = el.className ? el.className + " " + v : v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  add(el, children);
  return el;
}

function add(el, children) {
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false || c === "") continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  add(f, children);
  return f;
};

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------- small components ----------
export const chip = (text, variant) =>
  h("span.chip" + (variant ? ".chip--" + variant : ""), { text });

export function panel({ title, hint, actions, body, chipText, chipVariant }) {
  const head = (title || actions)
    ? h("div.panel-head",
        title ? h("h2", { text: title }) : null,
        chipText ? chip(chipText, chipVariant || "muted") : null,
        hint ? h("span.hint", { text: hint }) : null,
        actions ? h("div.right", actions) : null)
    : null;
  return h("section.panel", head, body);
}

export const panelBody = (...children) => h("div.panel-body", children);

export function statCard({ value, caption, iconName, href, variant }) {
  const inner = [
    h("span.ico-box", icon(iconName)),
    h("span.txt", h("b", { text: String(value) }), h("span.cap", { text: caption })),
  ];
  return href
    ? h("a.stat" + (variant ? ".stat--" + variant : ""), { href, "data-link": "" }, inner)
    : h("div.stat" + (variant ? ".stat--" + variant : ""), inner);
}

export function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return h("div.bars", rows.map((r) =>
    h("div.bar-row",
      r.href ? h("a", { href: r.href, "data-link": "", text: r.label }) : h("span", { text: r.label }),
      h("span.bar", h("i", { style: { width: Math.round((r.n / max) * 100) + "%" } })),
      h("span.n", { text: String(r.n) }))));
}

// A column chart, built from ordinary elements rather than SVG because h()
// creates HTML nodes and an SVG child needs its own namespace.
//
// rows: [{ label, n, sub, href, title }] — label goes under the column, sub is
// the smaller second line (a month, a weekday), title is the hover text.
// Empty buckets are kept and drawn as a baseline tick: a quiet day is a fact,
// and dropping it would make a slow week look busy.
export function columns(rows, { height = 120, highlightLast = true } = {}) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.n));

  const col = (r, i) => {
    const pct = Math.round((r.n / max) * 100);
    const bar = h("span.col-bar" + (r.n === 0 ? ".is-zero" : ""), {
      style: { height: Math.max(pct, r.n === 0 ? 0 : 4) + "%" },
    });
    const body = h("span.col-stack",
      h("span.col-n", { text: r.n ? String(r.n) : "" }),
      bar);
    const label = h("span.col-label", { text: r.label },
      r.sub ? h("em", { text: r.sub }) : null);
    const cls = ".col" + (highlightLast && i === rows.length - 1 ? ".is-now" : "");
    const title = r.title || `${r.label}: ${r.n}`;
    return r.href
      ? h("a" + cls, { href: r.href, title }, body, label)
      : h("div" + cls, { title }, body, label);
  };

  return h("div.chart",
    h("div.chart-plot", { style: { height: height + "px" } }, rows.map(col)),
    h("div.chart-foot",
      h("span", { text: "0" }),
      h("span", { text: "peak " + max })));
}

// The row counts a list can be set to. Must match PER_PAGE_CHOICES on the
// server, which refuses anything else.
export const PER_PAGE_CHOICES = [10, 25, 50, 100];
const DEFAULT_PER_PAGE = 25;

// Builds `hrefFor` for pager(): keeps the filters already in the URL and
// swaps the page number, leaving page 1 off so the first page has a clean URL.
//
// Called as hrefFor(page) for a page link, or hrefFor(1, rows) to change the
// page size. The default size is left out of the URL for the same reason.
export const pageHref = (path, query) => (n, per) => {
  const sp = new URLSearchParams();
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v && k !== "page" && !(per && k === "per_page")) sp.set(k, v);
  });
  if (per && per !== DEFAULT_PER_PAGE) sp.set("per_page", per);
  if (n > 1) sp.set("page", n);
  const s = sp.toString();
  return path + (s ? "?" + s : "");
};

// The same merge as pageHref, for the lists that build their own query string:
//
//   pager(meta, (n, per) => qs(pagedQuery(q, n, per)))
//
export const pagedQuery = (q, n, per) => Object.assign({}, q, {
  per_page: per ? (per === DEFAULT_PER_PAGE ? "" : per) : (q.per_page || ""),
  page: n > 1 ? n : "",
});

// The pager under a list. `hrefFor(page)` builds the link for a page number,
// so each list keeps its own filters in the URL.
//
// It shows on a single page too, where it is a row count and a way to change
// the page size \u2014 a control you cannot reach is the same as one that is not
// there. Only the step buttons, which would all be dead, are left off.
export function pager(meta, hrefFor) {
  if (!meta || !meta.total) return null;
  const per = meta.per_page || DEFAULT_PER_PAGE;
  const pages = meta.pages || 1;
  const from = (meta.page - 1) * per + 1;
  const to = Math.min(meta.page * per, meta.total);

  const step = (n, label, enabled) =>
    enabled ? h("a.btn.btn--ghost.btn--sm", { href: hrefFor(n) }, label)
            : h("span.btn.btn--ghost.btn--sm.is-off", { "aria-disabled": "true", text: label });

  // A size bigger than the list itself would page nothing, so it is not
  // offered; the current one always is, so you can get back off it.
  const sizes = PER_PAGE_CHOICES.filter((n) => n < meta.total || n === per);
  const rowsPicker = sizes.length > 1
    ? h("span.per-page",
        h("span.muted", { text: "Rows" }),
        ...sizes.map((n) => n === per
          ? h("span.per-page-on", { text: String(n) })
          : h("a", { href: hrefFor(1, n), text: String(n) })))
    : null;

  return h("div.pager",
    h("span.muted", { text: `Showing ${from}\u2013${to} of ${meta.total}` }),
    rowsPicker,
    h("span.spacer"),
    pages > 1 ? step(1, "\u00ab First", meta.page > 1) : null,
    pages > 1 ? step(meta.page - 1, "Previous", meta.page > 1) : null,
    pages > 1 ? h("span.muted.nowrap", { text: `Page ${meta.page} of ${pages}` }) : null,
    pages > 1 ? step(meta.page + 1, "Next", meta.page < pages) : null,
    pages > 1 ? step(pages, "Last \u00bb", meta.page < pages) : null);
}

export function table({ head, rows, empty }) {
  if (!rows.length && empty) return empty;
  return h("div.table-wrap",
    h("table.data",
      h("thead", h("tr", head.map((c) =>
        h("th" + (c && c.right ? ".col-actions" : ""), { text: typeof c === "string" ? c : c.label })))),
      h("tbody", rows)));
}

export const rowActions = (...children) => h("div.row-actions", children);

export function emptyState({ iconName, title, text, action }) {
  return h("div.empty", icon(iconName), h("h3", { text: title }),
    text ? h("p", { text }) : null, action);
}

export function thumb(src, alt) {
  return src
    ? h("img.thumb", { src, alt: alt || "", loading: "lazy" })
    : h("span.thumb.thumb--empty", { title: "No photo" }, icon("image"));
}

// ---------- form helpers ----------
export function field({ label, hint, input, mono, style }) {
  return h("label.field" + (mono ? ".field--mono" : ""), { style },
    label ? h("span.lbl", { text: label }, hint ? h("span.hint", { text: " " + hint }) : null) : null,
    input);
}

export function input(name, value, props = {}) {
  return h("input", Object.assign({ type: "text", name, value: value == null ? "" : value }, props));
}

export function textarea(name, value, props = {}) {
  const el = h("textarea", Object.assign({ name, rows: 4 }, props));
  el.value = value == null ? "" : value;
  return el;
}

export function select(name, options, selected, props = {}) {
  return h("select", Object.assign({ name }, props),
    options.map((o) => {
      const opt = h("option", { value: o.value, text: o.label });
      if (String(o.value) === String(selected == null ? "" : selected)) opt.selected = true;
      return opt;
    }));
}

export function checkbox(name, checked, labelText) {
  const box = h("input", { type: "checkbox", name });
  box.checked = !!checked;
  return h("label.switch", box, labelText);
}

export const formSection = ({ title, text, body }) =>
  h("section.form-section",
    title ? h("header", h("h3", { text: title }), text ? h("p", { text }) : null) : null,
    body);

export const formFoot = (...children) => h("div.form-foot", children);

export const grid2 = (...c) => h("div.grid-2", c);
export const grid3 = (...c) => h("div.grid-3", c);
export const stack = (...c) => h("div.stack", c);

// Collect a form into a plain object (checkboxes become "on"/absent).
export function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => {
    if (v instanceof File) return;
    out[k] = v;
  });
  form.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    out[cb.name] = cb.checked ? "on" : "";
  });
  return out;
}

// ---------- toasts ----------
export function toast(message, type = "ok") {
  const host = document.getElementById("toasts");
  const close = h("button", { type: "button", "aria-label": "Dismiss" }, icon("close"));
  const el = h("div.toast" + (type === "err" ? ".toast--err" : ""), { role: "status" },
    icon(type === "err" ? "alert" : "check"), h("span", { text: message }), close);
  const remove = () => el.remove();
  close.addEventListener("click", remove);
  host.append(el);
  setTimeout(remove, type === "err" ? 7000 : 4000);
}

// ---------- busy buttons ----------
export async function withBusy(btn, fn) {
  const label = btn.textContent;
  btn.setAttribute("aria-busy", "true");
  try {
    return await fn();
  } finally {
    btn.removeAttribute("aria-busy");
    btn.textContent = label;
  }
}

// ---------- skeletons ----------
export const skelLine = (w) => h("div.skel.skel-line", { style: w ? { width: w } : null });

export const skelCards = (n = 5) =>
  h("div.skel-cards", Array.from({ length: n }, () => h("div.skel.skel-card")));

export const skelTable = (n = 6) =>
  h("section.panel", Array.from({ length: n }, () =>
    h("div.skel-row", h("div.skel"), h("div.skel"), h("div.skel"), h("div.skel"), h("div.skel"))));

export const skelPanel = () => h("section.panel", h("div.panel-body", h("div.skel.skel-panel")));

export const skelForm = () =>
  h("section.panel", h("div.form-section",
    skelLine("30%"), skelLine("100%"), skelLine("100%"), skelLine("60%"), skelLine("100%")));

export function loadError(message, retry) {
  return h("section.panel",
    h("div.load-error", icon("alert"),
      h("h3", { text: "Could not load this page" }),
      h("p", { text: message }),
      retry ? h("button.btn.btn--ghost", { type: "button", onclick: retry }, icon("refresh"), "Try again") : null));
}

// ---------- confirm dialog ----------
// An overlay rather than window.confirm: the browser dialog cannot be styled,
// shows the host name, and in some embedded views is suppressed entirely — in
// which case a native confirm returns false and the action silently does
// nothing. Returns a promise, so every caller must await it.
export function confirmAction(message, opts = {}) {
  const {
    title = "Are you sure?",
    confirmText = "Delete",
    cancelText = "Cancel",
    danger = true,
  } = opts;

  return new Promise((resolve) => {
    const cancel = h("button.btn.btn--ghost", { type: "button", text: cancelText });
    const go = h("button.btn" + (danger ? ".btn--danger" : ""), { type: "button" },
      icon(danger ? "trash" : "check"), confirmText);

    const box = h("div.modal", {
      role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title",
    },
      h("h2", { id: "modal-title", text: title }),
      h("p", { text: message }),
      h("div.modal-foot", cancel, go));

    const scrim = h("div.modal-scrim", box);
    const previous = document.activeElement;

    let done = false;
    const close = (answer) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      scrim.classList.remove("is-open");
      // Let the fade finish before the node goes, but never leave it behind.
      setTimeout(() => scrim.remove(), 150);
      if (previous && previous.isConnected) previous.focus();
      resolve(answer);
    };

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(false); return; }
      if (e.key === "Enter" && document.activeElement !== cancel) { e.preventDefault(); close(true); return; }
      // Keep tabbing inside the dialog.
      if (e.key === "Tab") {
        const stops = [cancel, go];
        const i = stops.indexOf(document.activeElement);
        e.preventDefault();
        stops[(i + (e.shiftKey ? stops.length - 1 : 1) + stops.length) % stops.length].focus();
      }
    }

    cancel.addEventListener("click", () => close(false));
    go.addEventListener("click", () => close(true));
    // Clicking the backdrop cancels; clicking inside the card must not.
    scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) close(false); });
    document.addEventListener("keydown", onKey, true);

    document.body.append(scrim);
    requestAnimationFrame(() => scrim.classList.add("is-open"));
    go.focus();
  });
}

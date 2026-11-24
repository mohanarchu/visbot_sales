// Client-side router. The shell stays on screen; only the view area is
// replaced, and a skeleton is shown while the view's API call is in flight.
import { clear, frag, loadError } from "./ui.js";

const routes = [];
let outlet = null;
let onViewChange = () => {};
let progressEl = null;
let token = 0;

export function define(pattern, view) {
  // "/leads/:id/edit" -> regex plus param names
  const names = [];
  const rx = new RegExp("^" + pattern.replace(/:[A-Za-z_]+/g, (m) => {
    names.push(m.slice(1));
    return "([^/]+)";
  }).replace(/\//g, "\\/") + "$");
  routes.push({ rx, names, view, pattern });
}

let initialized = false;

export function init({ mount, onChange }) {
  // The mount node is replaced when the shell is rebuilt (after a re-login),
  // but the listeners below must only ever be attached once.
  outlet = mount;
  if (onChange) onViewChange = onChange;
  if (initialized) return;
  initialized = true;

  progressEl = document.createElement("div");
  progressEl.className = "nav-progress";
  document.body.append(progressEl);

  // Intercept internal links anywhere in the shell.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || a.target === "_blank" || a.hasAttribute("download")) return;
    if (!href.startsWith("/") || href.startsWith("/admin") || href.startsWith("/assets")
        || href.startsWith("/api") || href.startsWith("/ui")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  });

  window.addEventListener("popstate", () => render());
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  render();
}

export const currentPath = () => location.pathname;
export const currentQuery = () => Object.fromEntries(new URLSearchParams(location.search));

function progress(on) {
  if (!progressEl) return;
  if (on) {
    progressEl.classList.add("on");
    progressEl.style.width = "40%";
    setTimeout(() => { if (progressEl.classList.contains("on")) progressEl.style.width = "75%"; }, 220);
  } else {
    progressEl.style.width = "100%";
    setTimeout(() => {
      progressEl.classList.remove("on");
      progressEl.style.width = "0";
    }, 180);
  }
}

export async function render() {
  const path = location.pathname;
  const query = currentQuery();

  let found = null;
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      found = { view: r.view, params };
      break;
    }
  }

  if (!found) {
    onViewChange({ title: "Not found", subtitle: path, nav: null, back: null });
    clear(outlet).append(loadError("There is no page at " + path, () => navigate("/")));
    return;
  }

  const { view, params } = found;
  const ctx = { params, query, navigate, reload: () => render() };
  const mine = ++token;

  // 1. Shell updates immediately — the panel never looks frozen.
  onViewChange({
    title: typeof view.title === "function" ? view.title(ctx) : view.title,
    subtitle: typeof view.subtitle === "function" ? view.subtitle(ctx) : view.subtitle,
    nav: view.nav,
    back: typeof view.back === "function" ? view.back(ctx) : view.back,
  });

  // 2. Skeleton while the API answers.
  clear(outlet);
  if (view.load) {
    outlet.append(view.skeleton ? view.skeleton(ctx) : frag());
    progress(true);
  }

  try {
    const data = view.load ? await view.load(ctx) : null;
    if (mine !== token) return; // a newer navigation won
    const node = await view.render(data, ctx);
    if (mine !== token) return;
    clear(outlet);
    const wrap = document.createElement("div");
    wrap.className = "view-enter";
    wrap.append(node);
    outlet.append(wrap);

    // Refresh the title once data is in, for views that name a record.
    if (view.titleFrom) {
      onViewChange({
        title: view.titleFrom(data, ctx),
        subtitle: view.subtitleFrom ? view.subtitleFrom(data, ctx) : undefined,
        nav: view.nav,
        back: typeof view.back === "function" ? view.back(ctx) : view.back,
      });
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  } catch (err) {
    if (mine !== token) return;
    clear(outlet).append(loadError(err.message || "Unexpected error.", () => render()));
  } finally {
    if (mine === token) progress(false);
  }
}

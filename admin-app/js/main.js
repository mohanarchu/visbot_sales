// Boots the admin panel: checks the session, paints the shell once, then hands
// navigation to the router. Only the view area is ever replaced.
import { api, setUnauthorizedHandler } from "./api.js";
import { h, clear, icon, field, input, toast, withBusy } from "./ui.js";
import { loadVocab } from "./vocab.js";
import * as router from "./router.js";
import { dashboard } from "./views/dashboard.js";
import { leadsList, leadDetail, leadForm } from "./views/leads.js";
import {
  websiteOverview, categoriesList, categoryForm, productsList, productForm,
  sparesList, spareForm, groupForm, locationsList, locationForm,
  regionsList, regionForm,
} from "./views/content.js";
import { metaView } from "./views/meta.js";
import { serviceList, serviceDetail, serviceSettings } from "./views/service.js";
import { serviceTypesList, serviceTypeForm } from "./views/service-types.js";
import { serviceHistoryList, serviceVisitDetail, serviceVisitForm } from "./views/service-history.js";
import { serviceReviewsList, serviceReviewForm } from "./views/service-reviews.js";
import { usersList, userForm, accountView } from "./views/users.js";
import { SERVICE_LOGS } from "./features.js";
import { setUser, currentUser, can } from "./session.js";

const root = document.getElementById("root");

const NAV_ALL = [
  { group: "Leads", items: [
    { key: "dashboard", href: "/", label: "Dashboard", icon: "grid" },
    { key: "leads", href: "/leads", label: "All leads", icon: "users" },
    { key: "lead-new", href: "/leads/new", label: "Add a lead", icon: "plus" },
  ]},
  { group: "Service", items: [
    { key: "service", href: "/service", label: "Service requests", icon: "wrench" },
    { key: "service-history", href: "/service/history", label: "Service history", icon: "clock", when: SERVICE_LOGS },
    { key: "service-types", href: "/service/types", label: "Service types", icon: "layers", when: SERVICE_LOGS },
    { key: "service-reviews", href: "/service/reviews", label: "Customer reviews", icon: "chat" },
    { key: "service-helpline", href: "/service/helpline", label: "Helpline details", icon: "phone" },
  ]},
  { group: "Integrations", items: [
    { key: "meta", href: "/integrations/meta", label: "Meta lead ads", icon: "spark" },
  ]},
  { group: "People", items: [
    { key: "users", href: "/users", label: "Panel users", icon: "users", area: "users" },
  ]},
  { group: "Website", items: [
    { key: "website", href: "/website", label: "Overview", icon: "globe" },
    { key: "categories", href: "/categories", label: "Product categories", icon: "layers" },
    { key: "products", href: "/products", label: "Products", icon: "box" },
    { key: "spares", href: "/spares", label: "Spares", icon: "wrench" },
    { key: "locations", href: "/locations", label: "Addresses & locations", icon: "pin" },
    { key: "regions", href: "/regions", label: "Regional contacts", icon: "phone" },
  ]},
];

// The menu this account gets. An item with `when: false` is switched off in
// features.js, and one with an `area` only appears for a role that may reach it
// — the server checks the same thing on every request. A group left with
// nothing in it disappears rather than showing an empty heading.
const navFor = () => NAV_ALL
  .map((g) => ({ ...g, items: g.items.filter((it) => it.when !== false && (!it.area || can(it.area))) }))
  .filter((g) => g.items.length);

// ---------------------------------------------------------------- login
function renderLogin(message) {
  document.body.className = "login-page";
  const user = input("identifier", "", {
    required: true, autofocus: true, autocomplete: "username",
    placeholder: "98765 43210 or you@company.com",
  });
  const pass = input("password", "", { type: "password", required: true, autocomplete: "current-password" });
  const btn = h("button.btn", { type: "submit", text: "Sign in" });
  const errBox = h("div");

  const form = h("form.login-card",
    h("div.lhead",
      h("img", { src: "/assets/logo-mark.png", alt: "Visbot Industries" }),
      h("h1", "VISBOT ", h("i", { text: "ADMIN" })),
      h("p", { text: "Sign in to manage leads and website content" })),
    errBox,
    field({ label: "Mobile number or email", input: user }),
    field({ label: "Password", input: pass }),
    btn,
    h("p.login-foot", { text: "Visbot Industries · Coimbatore" }));

  if (message) errBox.append(h("div.flash.flash--err", icon("alert"), h("span", { text: message })));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clear(errBox);
    await withBusy(btn, async () => {
      try {
        const { data } = await api.login(user.value, pass.value);
        // Routes are built around a role. If someone else signs in at the same
        // screen, start again from scratch rather than keep the old menu.
        if (routesDefined && routesRole !== (data.user && data.user.role)) {
          return location.reload();
        }
        await start(data.user);
      } catch (err) {
        errBox.append(h("div.flash.flash--err", icon("alert"), h("span", { text: err.message })));
        pass.value = "";
        pass.focus();
      }
    });
  });

  clear(root).append(form);
}

// ---------------------------------------------------------------- shell
function renderShell() {
  document.body.className = "";
  const me = currentUser();

  const navLinks = new Map();
  const sideNav = h("nav.side-nav", navFor().map((section) => [
    h("div.side-label", { text: section.group }),
    section.items.map((it) => {
      const a = h("a", { href: it.href }, icon(it.icon), it.label);
      navLinks.set(it.key, a);
      return a;
    }),
  ]));

  const logout = h("button", { type: "button" }, icon("logout"), "Log out");
  logout.addEventListener("click", async () => {
    try { await api.logout(); } catch { /* sign out locally anyway */ }
    renderLogin();
  });

  const scrim = h("div.scrim", { id: "scrim" });
  const sidebar = h("aside.sidebar", { id: "sidebar" },
    h("a.brand", { href: "/" },
      h("img", { src: "/assets/logo-mark.png", alt: "" }),
      h("span",
        h("span.bn", "VISBOT ", h("i", { text: "ADMIN" })),
        h("span.bs", { text: "Lead management" }))),
    sideNav,
    h("div.side-foot",
      me ? h("a", { href: "/account", title: "Your account" },
        icon("users"), me.name + " · " + me.role_label) : null,
      h("a", { href: "https://visbot.in/", target: "_blank", rel: "noopener" }, icon("external"), "View live site"),
      logout));

  const titleEl = h("h1", { text: "Loading…" });
  const subEl = h("div.sub");
  const backSlot = h("span");
  const burger = h("button.burger", { id: "burger", "aria-label": "Open menu" }, icon("menu"));
  burger.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  scrim.addEventListener("click", () => document.body.classList.remove("nav-open"));

  const topbar = h("header.topbar", burger, backSlot, h("div", titleEl, subEl),
    h("div.right",
      me ? h("a.btn.btn--ghost.btn--sm", { href: "/account", title: "Your account · " + me.role_label },
        icon("users"), me.name) : null,
      h("a.btn.btn--ghost.btn--sm", { href: "https://visbot.in/", target: "_blank", rel: "noopener" },
        icon("external"), "View site")));

  const view = h("div", { id: "view" });
  const main = h("div.main", topbar, h("div.content", view));

  clear(root).append(scrim, sidebar, main);

  const onChange = ({ title, subtitle, nav, back }) => {
    if (title !== undefined) {
      titleEl.textContent = title || "";
      document.title = (title ? title + " — " : "") + "Visbot Admin";
    }
    if (subtitle !== undefined) {
      subEl.textContent = subtitle || "";
      subEl.hidden = !subtitle;
    }
    if (nav !== undefined) {
      navLinks.forEach((a, key) => a.classList.toggle("active", key === nav));
    }
    if (back !== undefined) {
      clear(backSlot);
      if (back) backSlot.append(h("a.back", { href: back }, icon("back"), "Back"));
    }
    document.body.classList.remove("nav-open");
  };

  return { view, onChange };
}

// ---------------------------------------------------------------- routes
let routesDefined = false;
let routesRole = null;
// Stand-in for a page that is switched off: send the browser to the inbox.
const toService = {
  title: "Service requests",
  nav: "service",
  render(_data, ctx) {
    ctx.navigate("/service", { replace: true });
    return h("div");
  },
};

// Shown where a page exists but this role may not open it.
const noAccess = {
  title: "Not available",
  nav: null,
  render: () => h("div.panel", h("div.panel-body",
    h("h2", { style: { margin: "0 0 .4rem", fontSize: "1rem" }, text: "That page is for administrators" }),
    h("p.muted", { style: { margin: 0, fontSize: ".9rem" },
      text: "Managing panel users is limited to an administrator. Everything else in the menu is yours to use." }),
    h("div", { style: { marginTop: "1rem" } },
      h("a.btn.btn--ghost", { href: "/" }, icon("back"), "Back to the dashboard")))),
};

function defineRoutes() {
  if (routesDefined) return;
  routesDefined = true;
  routesRole = currentUser() ? currentUser().role : null;

  router.define("/", dashboard);
  router.define("/leads", leadsList);
  router.define("/leads/new", leadForm);
  router.define("/leads/:id", leadDetail);
  router.define("/leads/:id/edit", leadForm);

  // Every fixed /service/… path is declared before the catch-all /service/:id,
  // or "history", "types" and the rest would be read as a request id.
  router.define("/service", serviceList);
  router.define("/service/helpline", serviceSettings);
  // While the logs are switched off an old bookmark lands on the inbox instead
  // of being read as a request id and failing.
  router.define("/service/types", SERVICE_LOGS ? serviceTypesList : toService);
  router.define("/service/types/new", SERVICE_LOGS ? serviceTypeForm : toService);
  router.define("/service/types/:id/edit", SERVICE_LOGS ? serviceTypeForm : toService);
  router.define("/service/history", SERVICE_LOGS ? serviceHistoryList : toService);
  router.define("/service/history/new", SERVICE_LOGS ? serviceVisitForm : toService);
  router.define("/service/history/:id", SERVICE_LOGS ? serviceVisitDetail : toService);
  router.define("/service/history/:id/edit", SERVICE_LOGS ? serviceVisitForm : toService);
  router.define("/service/reviews", serviceReviewsList);
  router.define("/service/reviews/new", serviceReviewForm);
  router.define("/service/reviews/:id/edit", serviceReviewForm);
  router.define("/service/:id", serviceDetail);

  router.define("/website", websiteOverview);
  router.define("/categories", categoriesList);
  router.define("/categories/new", categoryForm);
  router.define("/categories/:id/edit", categoryForm);
  router.define("/products", productsList);
  router.define("/products/new", productForm);
  router.define("/products/:id/edit", productForm);
  router.define("/spares", sparesList);
  router.define("/spares/new", spareForm);
  router.define("/spares/:id/edit", spareForm);
  router.define("/spare-groups/new", groupForm);
  router.define("/spare-groups/:id/edit", groupForm);
  router.define("/locations", locationsList);
  router.define("/locations/new", locationForm);
  router.define("/locations/:id/edit", locationForm);
  router.define("/regions", regionsList);
  router.define("/regions/new", regionForm);
  router.define("/regions/:id/edit", regionForm);

  router.define("/integrations/meta", metaView);

  router.define("/account", accountView);
  // Only an administrator has these in the menu, and the API refuses anyone
  // else, but a typed URL should say so plainly rather than fail mid-page.
  router.define("/users", can("users") ? usersList : noAccess);
  router.define("/users/new", can("users") ? userForm : noAccess);
  router.define("/users/:id/edit", can("users") ? userForm : noAccess);
}

// ---------------------------------------------------------------- boot
// The menu and the routes depend on who is signed in, so the user is set before
// either is built. Routes are defined once per page load; signing in as someone
// else reloads the panel rather than rewriting them.
async function start(user) {
  setUser(user);
  const { view, onChange } = renderShell();
  defineRoutes();
  await loadVocab();
  router.init({ mount: view, onChange }); // idempotent: only the mount is swapped
  router.render();
}

setUnauthorizedHandler(() => {
  setUser(null);
  renderLogin("Your session has expired. Please sign in again.");
});

(async () => {
  try {
    const { data } = await api.session();
    if (data.authed) await start(data.user);
    else renderLogin();
  } catch {
    renderLogin("Could not reach the server.");
  }
})();

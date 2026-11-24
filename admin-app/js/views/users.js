// Panel users and their roles, plus the page where anyone changes their own
// password. Only an administrator reaches the list; the account page is for
// whoever is signed in.
import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, table, rowActions, emptyState,
  field, input, select, formSection, formFoot, stack, grid2,
  formData, toast, withBusy, confirmAction, skelTable, skelForm,
} from "../ui.js";
import { fmtDateTime, ago } from "../fmt.js";
import { ROLES, roleMeta, roleOptions } from "../vocab.js";
import { currentUser, isEnvAdmin } from "../session.js";

const ROLE_CHIP = { admin: "warn", manager: "info", sales: "muted" };
const roleChip = (key) => chip(roleMeta(key).label, ROLE_CHIP[key] || "muted");

const qs = (o) => {
  const sp = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return "/users" + (s ? "?" + s : "");
};

// ---------------------------------------------------------------- list
export const usersList = {
  title: "Panel users",
  subtitle: "Who can sign in, and what they can reach",
  nav: "users",
  skeleton: () => skelTable(6),
  load: (ctx) => api.get("/users", { q: ctx.query.q, role: ctx.query.role }),

  render(res, ctx) {
    const rows = res.data;
    const me = currentUser();
    const filtered = !!(ctx.query.q || ctx.query.role);

    const search = input("q", ctx.query.q || "", { placeholder: "Search by name, mobile or email" });
    const roleFilter = select("role",
      [{ value: "", label: "Every role" }, ...roleOptions()], ctx.query.role || "");
    const form = h("form.toolbar", { role: "search" },
      h("div.search", icon("search"), search),
      roleFilter,
      h("button.btn.btn--ghost", { type: "submit" }, "Filter"),
      filtered ? h("a.btn.btn--ghost", { href: "/users" }, "Clear") : null,
      h("span.spacer"),
      h("a.btn", { href: "/users/new" }, icon("plus"), "Add a user"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      ctx.navigate(qs({ q: search.value.trim(), role: roleFilter.value }));
    });

    const del = (u) => {
      const btn = h("button.btn.btn--ghost.btn--icon",
        { type: "button", title: "Remove", "aria-label": "Remove " + u.name }, icon("trash"));
      btn.addEventListener("click", async () => {
        if (!await confirmAction(
          `${u.name} will no longer be able to sign in, on the web or in the sales app. `
          + "Leads and reviews they worked on are kept.",
          { title: "Remove this user?", confirmText: "Remove user" })) return;
        await withBusy(btn, async () => {
          try {
            const out = await api.del("/users/" + u.id);
            toast(out.message || "Removed.");
            ctx.reload();
          } catch (e) { toast(e.message, "err"); }
        });
      });
      return btn;
    };

    const body = rows.length
      ? table({
          head: ["Name", "Signs in with", "Role", "States covered", "Last signed in",
            { label: "", right: true }],
          rows: rows.map((u) => h("tr", { class: u.active ? "" : "is-off" },
            h("td",
              h("a.name", { href: "/users/" + u.id + "/edit", text: u.name }),
              u.id === (me && me.id) ? h("span.sub", { text: " · you" }) : null,
              u.active ? null : h("div.sub", { text: "Switched off" })),
            h("td", h("code", { text: u.login_id || "—" })),
            h("td", roleChip(u.role)),
            // Codes, so a rep covering six states still fits on one line.
            h("td.sub", u.role !== "sales" && !(u.states || []).length
              ? h("span.muted", { text: "every state" })
              : (u.states || []).length
                ? h("span", {
                    title: u.states.map((s) => s.name).join(", "),
                    text: u.states.length > 4
                      ? `${u.states.length} states`
                      : u.states.map((s) => s.code).join(" · "),
                  })
                : h("span.muted", { text: "none yet" })),
            h("td.sub", {
              title: u.last_login_at ? fmtDateTime(u.last_login_at) : "",
              text: u.last_login_at ? ago(u.last_login_at) : "never",
            }),
            h("td.col-actions", rowActions(
              h("a.btn.btn--ghost.btn--sm", { href: "/users/" + u.id + "/edit" }, icon("pencil"), "Edit"),
              u.id === (me && me.id) ? null : del(u))))),
        })
      : emptyState({
          iconName: "users",
          title: filtered ? "Nobody matches that" : "No users yet",
          text: filtered
            ? "Try a different name, or clear the filter."
            : "Add an account for each person who needs the panel or the sales app. "
              + "You are signed in with the built-in administrator from the server's configuration, which always works.",
          action: h("a.btn", { href: filtered ? "/users" : "/users/new" },
            icon(filtered ? "refresh" : "plus"), filtered ? "Clear the filter" : "Add the first user"),
        });

    // What each role means, straight from the server's own table.
    const counts = res.role_counts || {};
    const roleCards = panel({
      title: "What each role can do",
      hint: "set per user above",
      body: panelBody(h("dl.kv", ROLES.map((r) => frag(
        h("dt", roleChip(r.key),
          counts[r.key] ? h("span.sub", { text: " " + counts[r.key] }) : null),
        h("dd", { text: r.blurb }))))),
    });

    return frag(form, h("div.panel", body),
      h("div", { style: { marginTop: "1.3rem" } }, roleCards),
      h("p.muted", { style: { fontSize: ".85rem", marginTop: "1rem" },
        text: "Everyone signs in with their mobile number or their email address — there is no username. "
          + "A sales account signs in to the Visbot Sales mobile app only; the web panel turns it away. "
          + `The built-in administrator (“${res.env_admin}”) comes from the server's .env file and is not `
          + "listed here; it stays usable so you can never be locked out." }));
  },
};

// ---------------------------------------------------------------- add / edit
export const userForm = {
  nav: "users",
  back: "/users",
  title: (ctx) => (ctx.params.id ? "Edit user" : "Add a user"),
  skeleton: () => skelForm(),
  load: async (ctx) => {
    const [user, states] = await Promise.all([
      ctx.params.id ? api.get("/users/" + ctx.params.id) : Promise.resolve({ data: null }),
      api.get("/states"),
    ]);
    return { data: user.data, states: states.data };
  },
  titleFrom: (res) => (res.data ? "Edit " + res.data.name : "Add a user"),
  subtitleFrom: (res) => (res.data
    ? "Signs in with " + (res.data.login_id || "—")
    : "A new account for the panel or the sales app"),

  render(res, ctx) {
    const u = res.data;
    const me = currentUser();
    const self = !!(u && me && u.id === me.id);

    const roleSel = select("role", roleOptions(), u ? u.role : "sales", self ? { disabled: true } : {});
    const roleHint = h("p.muted", { style: { margin: ".4rem 0 0", fontSize: ".85rem" },
      text: roleMeta(u ? u.role : "sales").blurb });
    roleSel.addEventListener("change", () => { roleHint.textContent = roleMeta(roleSel.value).blurb; });

    const save = h("button.btn", { type: "submit" }, icon("check"), u ? "Save changes" : "Create user");

    const identity = formSection({
      title: "Who they are",
      text: "They sign in with their mobile number or their email address — whichever they "
        + "find easier. One of the two is enough, and no two people can share either.",
      body: stack(
        field({ label: "Full name",
          input: input("name", u && u.name, { required: true, placeholder: "e.g. Ravi Kumar" }) }),
        grid2(
          field({ label: "Mobile number", hint: "10 digits, with or without +91",
            input: input("phone", u && u.phone, { type: "tel", placeholder: "98765 43210", autocomplete: "off" }) }),
          field({ label: "Email address", hint: "optional if a mobile number is given",
            input: input("email", u && u.email, { type: "email", placeholder: "ravi@visbot.in", autocomplete: "off" }) }))),
    });

    const access = formSection({
      title: "What they can reach",
      text: self
        ? "This is your own account, so the role and the switch are fixed here. Another administrator can change them."
        : "A sales account is for the mobile app. Switching an account off signs it out everywhere at once.",
      body: stack(
        field({ label: "Role", input: roleSel }),
        roleHint,
        u ? field({
          label: "Account",
          input: select("active", [
            { value: "true", label: "Can sign in" },
            { value: "false", label: "Switched off" },
          ], String(u.active), self ? { disabled: true } : {}),
        }) : null),
    });

    // ---- the states this person covers
    // A sales account's lead list is built from these: every lead in one of
    // them that nobody else has been given shows up in their app.
    const allStates = res.states || [];
    const mine = new Set((u && u.states ? u.states : []).map((s) => s.id));
    const boxes = allStates.map((s) => {
      const box = h("input", { type: "checkbox", name: "state_ids", value: s.id });
      box.checked = mine.has(s.id);
      return { s, box, label: h("label.state-pick", box, h("span", { text: s.name })) };
    });
    const countLine = h("span.count");
    const paint = () => {
      const n = boxes.filter((b) => b.box.checked).length;
      countLine.textContent = n === 0
        ? "No states yet"
        : n === allStates.length ? "Every state" : `${n} of ${allStates.length} states`;
    };
    boxes.forEach((b) => b.box.addEventListener("change", paint));
    paint();

    const pickAll = (on) => () => {
      boxes.forEach((b) => { b.box.checked = on; });
      paint();
    };
    const allBtn = h("button.btn.btn--ghost.btn--sm", { type: "button" }, "Select all");
    const noneBtn = h("button.btn.btn--ghost.btn--sm", { type: "button" }, "Clear");
    allBtn.addEventListener("click", pickAll(true));
    noneBtn.addEventListener("click", pickAll(false));

    const group = (kind, heading) => {
      const items = boxes.filter((b) => b.s.kind === kind);
      if (!items.length) return null;
      return frag(
        h("div.state-head", { text: heading }),
        h("div.state-grid", items.map((b) => b.label)));
    };

    const states = formSection({
      title: "States they cover",
      text: (u && u.role === "sales") || !u
        ? "A sales person sees every lead in these states that nobody else has been given, "
          + "as well as anything assigned to them by name."
        : "This matters for sales accounts. An admin or a manager sees every lead anyway, "
          + "so it makes no difference here.",
      body: stack(
        h("div.toolbar.toolbar--tight", countLine, h("span.spacer"), allBtn, noneBtn),
        group("state", "States"),
        group("union territory", "Union territories")),
    });

    // The password is part of this form, so changing it is one edit like any
    // other. Left blank on an existing account, it keeps the one they have.
    const password = formSection({
      title: u ? "Password" : "First password",
      text: u
        ? "Type a new password to change it, or leave this empty to keep the one they have. "
          + "Changing it signs them out of the panel and the sales app."
        : "Tell it to them over the phone. They are asked to choose their own the first time they sign in.",
      body: stack(
        field({
          label: u ? "New password" : "Password",
          hint: u ? "leave empty to keep the current password" : "at least 8 characters",
          input: input("password", "", {
            type: "password",
            required: !u,
            autocomplete: "new-password",
            placeholder: u ? "••••••••" : "",
          }),
        })),
    });

    const form = h("form.panel", identity, access, states, password,
      formFoot(save, h("a.btn.btn--ghost", { href: "/users" }, "Cancel")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = formData(form);
      // A disabled control sends nothing, so fill in what the server needs.
      if (self) { body.role = u.role; body.active = String(u.active); }
      body.active = body.active === undefined ? true : body.active === "true";
      // Thirty-six checkboxes share one name, and formData keeps only the last
      // of those, so the chosen states are gathered here instead.
      body.state_ids = boxes.filter((b) => b.box.checked).map((b) => b.s.id);

      // Changing somebody's password signs their phone out, so it is worth a
      // word before it happens.
      if (u && body.password) {
        const who = self ? "Your phone" : `${u.name}'s phone`;
        if (!await confirmAction(
          `${who} will be signed out of the sales app, and the new password is what they will `
          + "need from now on. Tell them what you have set.",
          { title: "Change the password?", confirmText: "Save and change it" })) return;
      }

      await withBusy(save, async () => {
        try {
          const out = u
            ? await api.put("/users/" + u.id, body)
            : await api.post("/users", body);
          toast(out.message || "Saved.");
          ctx.navigate("/users");
        } catch (err) { toast(err.message, "err"); }
      });
    });

    return form;
  },
};

// ---------------------------------------------------------------- own account
export const accountView = {
  title: "Your account",
  nav: "account",
  load: () => api.get("/me"),
  skeleton: () => skelForm(),
  titleFrom: (res) => res.data.name,
  subtitleFrom: (res) => res.data.role_label + " · signed in with " + (res.data.login_id || "—"),

  render(res) {
    const u = res.data;

    const details = h("dl.kv",
      h("dt", { text: "Name" }), h("dd", { text: u.name }),
      h("dt", { text: "Signs in with" }), h("dd", h("code", { text: u.login_id || "—" })),
      h("dt", { text: "Role" }), h("dd", roleChip(u.role)),
      h("dt", { text: "Mobile" }), h("dd", { text: u.phone || "—" }),
      h("dt", { text: "Email" }), h("dd", { text: u.email || "—" }),
      h("dt", { text: "States covered" }),
      h("dd", (u.states || []).length
        ? h("span", { text: u.states.map((s) => s.name).join(", ") })
        : h("span.muted", { text: u.can && u.can.leads === "all" ? "every state" : "none yet" })),
      h("dt", { text: "Last signed in" }),
      h("dd", { text: u.last_login_at ? fmtDateTime(u.last_login_at) : "—" }));

    const left = panel({
      title: "Your details",
      hint: "an administrator can change these",
      body: panelBody(details),
    });

    if (isEnvAdmin()) {
      return h("div.cols.cols--lead", h("div", left), h("div", panel({
        title: "Password",
        body: panelBody(h("p.muted", { style: { margin: 0, fontSize: ".9rem" },
          text: "You are signed in as the built-in administrator. Its password lives in the server's "
            + ".env file (ADMIN_PASSWORD) and is changed there, not here. For day-to-day work, "
            + "add yourself a named account under Panel users." })),
      })));
    }

    const cur = input("current_password", "", { type: "password", required: true, autocomplete: "current-password" });
    const next = input("password", "", { type: "password", required: true, autocomplete: "new-password" });
    const save = h("button.btn", { type: "submit" }, icon("check"), "Change password");
    const form = h("form",
      stack(
        field({ label: "Current password", input: cur }),
        field({ label: "New password", hint: "at least 8 characters", input: next })),
      h("div.form-foot", { style: { marginTop: ".9rem" } }, save));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        try {
          const out = await api.post("/me/password", {
            current_password: cur.value, password: next.value,
          });
          toast(out.message || "Password changed.");
          cur.value = ""; next.value = "";
        } catch (err) { toast(err.message, "err"); }
      });
    });

    return frag(
      u.must_change_password
        ? h("div.flash.flash--warn", icon("alert"),
            h("span", { text: "Your password was set for you. Please choose your own below." }))
        : null,
      h("div.cols.cols--lead",
        h("div", left),
        h("div", panel({
          title: "Change your password",
          hint: "you stay signed in here; the sales app asks again",
          body: panelBody(form),
        }))));
  },
};

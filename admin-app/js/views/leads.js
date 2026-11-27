import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, table, rowActions, emptyState,
  field, input, textarea, select, formSection, formFoot, grid2, grid3, stack,
  formData, toast, withBusy, confirmAction, pager, pagedQuery, skelCards, skelTable, skelForm, skelPanel,
} from "../ui.js";
import { ago, fmtDate, fmtDateTime, dateInput, daysUntil, dueLabel, initials, waNumber, fmtFee } from "../fmt.js";
import { STATUSES, statusMeta, sourceLabel, priorityMeta, statusOptions, sourceOptions, priorityOptions } from "../vocab.js";
import { FEE_KINDS } from "./referrers.js";
import { referrerPicker } from "../widgets.js";

const qs = (o) => {
  const sp = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return "/leads" + (s ? "?" + s : "");
};

// ---------------------------------------------------------------- list
export const leadsList = {
  title: "All leads",
  nav: "leads",
  skeleton: () => frag(h("div.skel.skel-line", { style: { width: "40%", height: "36px" } }), skelTable(8)),
  load: async (ctx) => {
    const [leads, states] = await Promise.all([
      api.get("/leads", ctx.query),
      api.get("/states"),
    ]);
    return Object.assign(leads, { states: states.data });
  },
  subtitleFrom: (res) => `${res.meta.total} ${res.meta.total === 1 ? "lead" : "leads"} matching the current filter`,

  render(res, ctx) {
    const { data: leads, meta, tab_counts: counts, all_count: allCount } = res;
    const q = ctx.query;

    const tabs = h("nav.tabs",
      h("a.tab" + (!q.status && !q.due && !q.open ? ".active" : ""),
        { href: qs({ q: q.q, source: q.source, priority: q.priority, state: q.state, period: q.period, from: q.from, to: q.to, per_page: q.per_page }) },
        "All ", h("span.tab-n", { text: String(allCount) })),
      STATUSES.map((s) =>
        h("a.tab" + (q.status === s.key ? ".active" : ""),
          { href: qs({ status: s.key, q: q.q, source: q.source, priority: q.priority, state: q.state, period: q.period, from: q.from, to: q.to, per_page: q.per_page }) },
          s.label + " ", h("span.tab-n", { text: String(counts[s.key] || 0) }))),
      h("a.tab" + (q.due ? ".active" : ""),
        { href: qs({ due: "1", q: q.q, source: q.source, priority: q.priority, state: q.state, period: q.period, from: q.from, to: q.to, per_page: q.per_page }) },
        icon("clock"), "Follow-ups due"));

    const searchInput = h("input", {
      type: "search", name: "q", value: q.q || "",
      placeholder: "Search name, phone, company, machine…", "aria-label": "Search leads",
    });
    const sourceSel = select("source",
      [{ value: "", label: "All sources" }, ...sourceOptions()], q.source || "");
    const prioSel = select("priority",
      [{ value: "", label: "Any priority" }, ...priorityOptions().map((p) => ({ ...p, label: p.label + " priority" }))],
      q.priority || "");

    // By state, from the states master: every spelling of a state on a lead
    // resolves to one row, so this catches "Tamilnadu" and "TN" together.
    const stateSel = select("state", [
      { value: "", label: "All states" },
      ...(res.states || []).map((s) => ({
        value: s.id,
        label: s.name + (s.lead_count ? ` (${s.lead_count})` : ""),
      })),
      { value: "none", label: "— no state given —" },
    ], q.state || "");

    // When the lead arrived. The presets cover the everyday questions; the two
    // date boxes are there for "what came in while I was away".
    const custom = !!(q.from || q.to);
    const periodSel = select("period", [
      { value: "", label: "Any time" },
      { value: "today", label: "Today" },
      { value: "yesterday", label: "Yesterday" },
      { value: "7d", label: "Last 7 days" },
      { value: "30d", label: "Last 30 days" },
      { value: "month", label: "This month" },
      { value: "custom", label: "Between two dates…" },
    ], custom ? "custom" : (q.period || ""));

    const fromInput = h("input", {
      type: "date", name: "from", value: q.from || "", "aria-label": "Received from",
    });
    const toInput = h("input", {
      type: "date", name: "to", value: q.to || "", "aria-label": "Received until",
    });
    const dateRange = h("span.date-range" + (custom || periodSel.value === "custom" ? "" : ".is-hidden"),
      fromInput, h("span.date-sep", { text: "to" }), toInput);

    const apply = () => {
      const useCustom = periodSel.value === "custom";
      ctx.navigate(qs({
        status: q.status, due: q.due, open: q.open, per_page: q.per_page,
        q: searchInput.value.trim(), source: sourceSel.value, priority: prioSel.value,
        state: stateSel.value,
        // The two are exclusive: a preset and a pair of dates would contradict
        // each other, and the server would quietly let the dates win.
        period: useCustom ? "" : periodSel.value,
        from: useCustom ? fromInput.value : "",
        to: useCustom ? toInput.value : "",
      }));
    };

    periodSel.addEventListener("change", () => {
      if (periodSel.value === "custom") {
        // Reveal the boxes and wait: navigating now would filter on nothing.
        dateRange.classList.remove("is-hidden");
        fromInput.focus();
        return;
      }
      dateRange.classList.add("is-hidden");
      apply();
    });
    fromInput.addEventListener("change", () => { if (fromInput.value || toInput.value) apply(); });
    toInput.addEventListener("change", () => { if (fromInput.value || toInput.value) apply(); });

    sourceSel.addEventListener("change", apply);
    prioSel.addEventListener("change", apply);
    stateSel.addEventListener("change", apply);

    const toolbar = h("form.toolbar", { onsubmit: (e) => { e.preventDefault(); apply(); } },
      h("div.search", icon("search"), searchInput),
      sourceSel, stateSel, prioSel, periodSel, dateRange,
      h("button.btn.btn--ghost", { type: "submit" }, "Search"),
      (q.q || q.source || q.priority || q.state || q.period || q.from || q.to)
        ? h("a.btn.btn--ghost", { href: qs({ status: q.status, due: q.due, open: q.open }) }, "Clear")
        : null,
      h("span.spacer"),
      h("a.btn.btn--ghost", { href: "/api/admin/leads/export.csv", target: "_blank" }, icon("download"), "Export CSV"),
      h("a.btn", { href: "/leads/new" }, icon("plus"), "Add a lead"));

    const rows = leads.map((l) => {
      const sm = statusMeta(l.status);
      const d = daysUntil(l.next_followup);
      const wa = waNumber(l.phone);
      return h("tr",
        h("td",
          h("a.name", { href: "/leads/" + l.id, text: l.name }),
          l.priority === "high" ? frag(" ", chip("High", "warn")) : null,
          h("div.sub", {
            text: [l.phone, l.company, [l.city, l.state].filter(Boolean).join(", ")]
              .filter(Boolean).join(" · ") || "No contact details",
          })),
        h("td.sub", { style: { maxWidth: "260px" }, text: l.interest || "—" }),
        // A referral says little without the name of who sent it.
        h("td.sub.nowrap", l.referrer_name
          ? frag(sourceLabel(l.source), h("span.muted", { text: " \u00b7 " + l.referrer_name }))
          : sourceLabel(l.source)),
        h("td", chip(sm.label, sm.chip || "plain")),
        // Who is on it, so the office can see at a glance what is unassigned.
        h("td.sub.nowrap", l.owner
          ? h("span", { text: l.owner })
          : h("span.muted", { text: "Nobody" })),
        h("td.nowrap", l.next_followup
          ? chip(dueLabel(l.next_followup), d < 0 ? "warn" : "muted")
          : h("span.sub", { text: "—" })),
        h("td.sub.nowrap", { title: fmtDateTime(l.created_at), text: ago(l.created_at) }),
        h("td.col-actions", rowActions(
          wa ? h("a.btn.btn--ghost.btn--icon", {
            href: "https://wa.me/" + wa, target: "_blank", rel: "noopener",
            title: "WhatsApp " + l.phone, "aria-label": "WhatsApp this lead",
          }, icon("chat")) : null,
          h("a.btn.btn--ghost.btn--sm", { href: "/leads/" + l.id }, "Open", icon("arrow")))));
    });

    const body = leads.length
      ? frag(
          table({
            head: ["Lead", "Interested in", "Source", "Status", "Assigned to", "Follow-up",
              "Received", { label: "", right: true }],
            rows,
          }),
          pager(meta, (n, per) => qs(pagedQuery(q, n, per))))
      : emptyState({
          iconName: "users",
          title: allCount ? "No leads match this filter" : "No leads yet",
          text: allCount
            ? "Try clearing the search or picking a different status tab."
            : "Website and Meta enquiries arrive here automatically. You can also add leads by hand.",
          action: allCount
            ? h("a.btn.btn--ghost", { href: "/leads" }, "Clear all filters")
            : h("a.btn", { href: "/leads/new" }, icon("plus"), "Add a lead"),
        });

    return frag(tabs, toolbar, h("div.panel", body));
  },
};

// ---------------------------------------------------------------- detail
export const leadDetail = {
  title: "Lead",
  nav: "leads",
  back: "/leads",
  skeleton: () => frag(h("div.skel", { style: { height: "86px", borderRadius: "12px", marginBottom: "1.15rem" } }),
    h("div.cols.cols--lead", skelPanel(), skelPanel())),
  load: async (ctx) => {
    const [lead, team] = await Promise.all([
      api.get("/leads/" + ctx.params.id),
      api.get("/users/assignable"),
    ]);
    return { data: lead.data, team: team.data };
  },
  titleFrom: (res) => res.data.lead.name,
  subtitleFrom: (res) => {
    const l = res.data.lead;
    return `Lead #${l.id} · ${sourceLabel(l.source)} · received ${fmtDateTime(l.created_at)}`;
  },

  render(res, ctx) {
    const l = res.data.lead;
    const notes = res.data.notes;
    const sm = statusMeta(l.status);
    const pm = priorityMeta(l.priority);
    const wa = waNumber(l.phone);
    const d = daysUntil(l.next_followup);

    const head = h("div.lead-head",
      h("div.avatar", { text: initials(l.name) }),
      h("div.lead-head-txt",
        h("h2", { text: l.name }),
        h("div.lead-head-meta",
          chip(sm.label, sm.chip || "plain"),
          chip(pm.label + " priority", pm.chip || "plain"),
          l.company ? h("span.muted", { text: l.company }) : null,
          (l.city || l.state)
            ? h("span.muted", icon("pin"), [l.city, l.state].filter(Boolean).join(", "))
            : null)),
      h("div.lead-head-actions",
        wa ? h("a.btn", { href: "https://wa.me/" + wa, target: "_blank", rel: "noopener" },
          icon("chat"), "WhatsApp") : null,
        l.phone ? h("a.btn.btn--ghost", { href: "tel:" + l.phone.replace(/\s+/g, "") },
          icon("phone"), "Call") : null,
        h("a.btn.btn--ghost", { href: "/leads/" + l.id + "/edit" }, icon("pencil"), "Edit")));

    // Status buttons ask first, then post and re-render in place. A status is
    // easy to tap by accident, it goes into the activity log, and "Won" or
    // "Lost" is read as a decision — so it is worth a second look.
    const statusPicker = h("div.status-picker", STATUSES.map((s) => {
      const btn = h("button.status-btn" + (l.status === s.key ? ".is-current" : ""),
        { type: "button", text: s.label, disabled: l.status === s.key });
      btn.addEventListener("click", async () => {
        if (!await confirmAction(
          `${l.name} moves from ${sm.label} to ${s.label}. This is recorded in the activity log`
          + (l.owner ? `, and ${l.owner} sees it in the sales app.` : "."),
          { title: `Move to ${s.label}?`, confirmText: `Move to ${s.label}`, danger: false })) return;
        await withBusy(btn, async () => {
          try {
            const r = await api.post(`/leads/${l.id}/status`, { status: s.key });
            toast(r.message || "Status updated.");
            ctx.reload();
          } catch (e) { toast(e.message, "err"); }
        });
      });
      return btn;
    }));

    const noteBox = textarea("note", "", {
      rows: 3,
      placeholder: "e.g. Called and shared the quotation for the double head welder. Asked for a factory visit next week.",
    });
    const kindSel = select("kind", [{ value: "note", label: "Note" }, { value: "call", label: "Call / WhatsApp" }], "note");
    const dateBox = input("next_followup", "", { type: "date" });
    const saveBtn = h("button.btn", { type: "submit" }, icon("check"), "Save activity");

    const activityForm = h("form.panel-body", {
      onsubmit: async (e) => {
        e.preventDefault();
        await withBusy(saveBtn, async () => {
          try {
            const r = await api.post(`/leads/${l.id}/notes`, {
              note: noteBox.value, kind: kindSel.value, next_followup: dateBox.value,
            });
            toast(r.message || "Activity logged.");
            ctx.reload();
          } catch (err) { toast(err.message, "err"); }
        });
      },
    }, stack(
      field({ label: "What happened?", input: noteBox }),
      grid3(
        field({ label: "Type", input: kindSel }),
        field({ label: "Next follow-up", hint: "optional", input: dateBox }),
        h("div.field", { style: { alignSelf: "end" } }, saveBtn))));

    const timeline = notes.length
      ? h("ol.timeline", notes.map((n) =>
          h("li.tl-item.tl-" + n.kind,
            h("span.tl-dot", icon(
              n.kind === "call" ? "phone" : n.kind === "status" ? "arrow"
              : n.kind === "followup" ? "calendar" : n.kind === "created" ? "spark"
              : n.kind === "assign" ? "users" : "chat")),
            h("div.tl-body",
              h("p", { text: n.note }),
              h("time", { title: fmtDateTime(n.created_at), text: ago(n.created_at) })))))
      : h("p.muted", { style: { margin: 0 }, text: "No activity recorded yet." });

    const kv = (label, value) => frag(h("dt", { text: label }), value);
    const details = h("dl.kv",
      kv("Phone", h("dd", l.phone
        ? h("a", { href: "tel:" + l.phone.replace(/\s+/g, ""), text: l.phone })
        : h("span.muted", { text: "Not given" }))),
      kv("Email", h("dd", l.email
        ? h("a", { href: "mailto:" + l.email, text: l.email })
        : h("span.muted", { text: "Not given" }))),
      kv("Company", h("dd", { text: l.company || "—" })),
      kv("Location", h("dd", { text: [l.city, l.state].filter(Boolean).join(", ") || "—" })),
      kv("Interested in", h("dd", { text: l.interest || "—" })),
      kv("Source", h("dd", { text: sourceLabel(l.source) })),
      l.referrer_id
        ? kv("Referred by", h("dd",
            h("a", { href: "/referrers/" + l.referrer_id, text: l.referrer_name }),
            l.referrer_phone ? h("span.muted", { text: " \u00b7 " + l.referrer_phone }) : null,
            l.referrer_active === false ? chip("switched off", "muted") : null))
        : null,
      l.referral_kind
        ? kv("Referral fee", h("dd", { text: fmtFee(l.referral_kind, l.referral_value) }))
        : (l.referrer_id
            ? kv("Referral fee", h("dd", h("span.muted", { text: "Not agreed yet" })))
            : null),
      l.meta_campaign_name ? kv("Campaign", h("dd", { text: l.meta_campaign_name })) : null,
      l.meta_ad_name ? kv("Ad", h("dd", { text: l.meta_ad_name })) : null,
      (l.meta_form_name || l.meta_form_id)
        ? kv("Lead form", h("dd", { text: l.meta_form_name || l.meta_form_id })) : null,
      l.meta_leadgen_id
        ? kv("Meta lead id", h("dd", { style: { fontSize: ".8rem" }, text: l.meta_leadgen_id })) : null,
      kv("Assigned to", h("dd", { text: l.owner || "Nobody yet" })),
      kv("Next follow-up", h("dd", l.next_followup
        ? frag(fmtDate(l.next_followup), " ", chip(dueLabel(l.next_followup), d < 0 ? "warn" : "muted"))
        : h("span.muted", { text: "Not set" }))),
      kv("Received", h("dd", { text: fmtDateTime(l.created_at) })),
      kv("Last updated", h("dd", { text: ago(l.updated_at) })));

    // ---- handing the lead to somebody
    // This is its own call, so the office can reassign without opening the
    // edit form. Whoever it goes to sees it in the sales app at once.
    const team = res.team || [];
    const assignSel = select("owner_user_id", [
      { value: "", label: "— nobody —" },
      ...team.map((u) => ({ value: u.id, label: u.name + " · " + u.role_label })),
    ], l.owner_user_id ? String(l.owner_user_id) : "");
    const assignBtn = h("button.btn", { type: "button" }, icon("check"), "Assign");
    assignBtn.addEventListener("click", () => withBusy(assignBtn, async () => {
      try {
        const r = await api.post(`/leads/${l.id}/assign`, { owner_user_id: assignSel.value });
        toast(r.message || "Assigned.");
        ctx.reload();
      } catch (e) { toast(e.message, "err"); }
    }));

    const assignBody = team.length
      ? stack(
          h("p.muted", { style: { margin: 0, fontSize: ".86rem" },
            text: l.owner
              ? `Handled by ${l.owner}. Pick somebody else to hand it over — they see it in the sales app straight away.`
              : "Nobody is handling this lead yet. Give it to someone and it appears in their sales app." }),
          field({ label: "Assign to", input: assignSel }),
          h("div", assignBtn))
      : stack(
          h("p.muted", { style: { margin: 0, fontSize: ".86rem" },
            text: l.owner
              ? `This lead says “${l.owner}”, typed in by hand. To assign it to somebody who can open it in the sales app, add them as a user first.`
              : "There is nobody to assign leads to yet. Add your sales team as users, then come back here." }),
          h("div", h("a.btn.btn--ghost", { href: "/users" }, icon("users"), "Go to Panel users")));

    const delBtn = h("button.btn.btn--danger", { type: "button" }, icon("trash"), "Delete this lead");
    delBtn.addEventListener("click", async () => {
      if (!await confirmAction(
        `Deleting "${l.name}" also removes the activity log and every note on this lead. This cannot be undone.`,
        { title: "Delete this lead?", confirmText: "Delete lead" })) return;
      await withBusy(delBtn, async () => {
        try {
          const r = await api.del("/leads/" + l.id);
          toast(r.message || "Lead deleted.");
          ctx.navigate("/leads");
        } catch (e) { toast(e.message, "err"); }
      });
    });

    return frag(head, h("div.cols.cols--lead",
      h("div",
        panel({ title: "Move through the pipeline", hint: "Each change is recorded in the activity log",
                body: panelBody(statusPicker) }),
        panel({ title: "Log activity", body: activityForm }),
        panel({ title: "Activity log", chipText: String(notes.length), body: panelBody(timeline) })),
      h("div",
        panel({
          title: "Who is handling this",
          hint: "shows up in their sales app",
          chipText: l.owner || null,
          chipVariant: l.owner ? "ok" : null,
          body: panelBody(assignBody),
        }),
        panel({ title: "Lead details", body: panelBody(details) }),
        l.message ? panel({ title: "Their message", body: panelBody(h("blockquote.quote", { text: l.message })) }) : null,
        panel({
          title: "Danger zone",
          body: panelBody(
            h("p.muted", { style: { margin: "0 0 .8rem", fontSize: ".86rem" },
              text: "Deleting a lead also removes its activity log. This cannot be undone." }),
            delBtn),
        }))));
  },
};

// The state on a lead, chosen from the master list rather than typed: it is
// what decides which sales person covers the lead, and a misspelling would
// leave it in nobody's territory.
//
// The option values are the state names, because the leads table stores the
// state as text — the database resolves that to a row by itself.
export function stateField(states, current) {
  const all = states || [];
  if (!all.length) {
    // No list to offer (an older server, or the call failed): let it be typed
    // rather than show an empty dropdown.
    return input("state", current, { placeholder: "e.g. Tamil Nadu" });
  }

  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const typed = key(current);
  const known = all.some((s) => key(s.name) === typed || key(s.code) === typed);

  return select("state", [
    { value: "", label: "— not given —" },
    // A lead already carrying something we do not recognise keeps it, so
    // opening the form and saving cannot quietly change the record.
    ...(current && !known ? [{ value: current, label: `${current} — not a state we know` }] : []),
    ...all.map((s) => ({ value: s.name, label: s.name })),
  ], known
    ? (all.find((s) => key(s.name) === typed || key(s.code) === typed) || {}).name
    : (current || ""));
}

// ---------------------------------------------------------------- form
export const leadForm = {
  nav: (ctx) => (ctx && ctx.params && ctx.params.id ? "leads" : "lead-new"),
  title: (ctx) => (ctx.params.id ? "Edit lead" : "Add a lead"),
  subtitle: (ctx) => (ctx.params.id ? null
    : "For phone calls, IndiaMART enquiries, exhibition contacts and factory walk-ins"),
  back: (ctx) => (ctx.params.id ? "/leads/" + ctx.params.id : "/leads"),
  skeleton: () => skelForm(),
  load: async (ctx) => {
    const [lead, team, states, referrers] = await Promise.all([
      ctx.params.id ? api.get("/leads/" + ctx.params.id) : Promise.resolve(null),
      api.get("/users/assignable"),
      api.get("/states"),
      // Who can be offered under "Referred by". A failure here must not stop a
      // lead being entered, so the form falls back to a plain text box.
      api.get("/referrers/suggest").catch(() => ({ data: [] })),
    ]);
    return { lead, team: team.data, states: states.data, referrers: referrers.data };
  },
  titleFrom: (res, ctx) => (ctx.params.id ? "Edit " + res.lead.data.lead.name : "Add a lead"),

  render(res, ctx) {
    const l = res.lead ? res.lead.data.lead : null;
    const team = res.team || [];
    const save = h("button.btn", { type: "submit" }, icon("check"), l ? "Save changes" : "Create lead");

    // ---- who referred this lead
    // The whole section belongs to one answer in the Source dropdown, so it is
    // built here and shown or hidden as that answer changes. Nothing is asked
    // of somebody entering a phone enquiry.
    const sourceSel = select("source", sourceOptions(), l ? l.source : "phone");
    const refName = input("referrer_name", l && l.referrer_name,
      { placeholder: "e.g. Ramesh Kumar", autocomplete: "off" });
    const refPhone = input("referrer_phone", l && l.referrer_phone,
      { placeholder: "+91 98765 43210", autocomplete: "off" });
    // Typing a name already on file offers it and fills in their mobile; a new
    // name is just typed, and the server creates the referrer on save.
    const refList = referrerPicker(refName, refPhone, res.referrers || []);
    const feeKind = select("referral_kind", FEE_KINDS, (l && l.referral_kind) || "");
    const feeValue = input("referral_value",
      l && l.referral_value != null ? l.referral_value : "",
      { type: "number", step: "0.01", min: "0", placeholder: "0" });

    // The amount means a different thing for each kind of fee, so the label
    // says which rather than leaving a bare number box.
    const feeName = h("span", { text: "Flat amount" });
    const feeHint = h("span.hint", { text: " in rupees" });
    const feeValueField = h("label.field", h("span.lbl", feeName, feeHint), feeValue);

    const referralSection = formSection({
      title: "Who referred this lead?",
      text: "Saved against the referrer, so everything one person sends in is counted "
          + "together. The same mobile number is treated as the same person.",
      body: stack(
        grid2(
          field({ label: "Referred by",
            hint: (res.referrers || []).length ? "pick someone, or type a new name" : "optional list builds up as you go",
            input: frag(refName, refList) }),
          field({ label: "Their mobile", hint: "fills in for someone already on file",
            input: refPhone })),
        h("div.grid-2.fee-row",
          field({ label: "Referral fee", input: feeKind }),
          feeValueField)),
    });

    const sync = () => {
      const on = sourceSel.value === "referral";
      const kind = feeKind.value;
      referralSection.classList.toggle("is-hidden", !on);
      feeValueField.classList.toggle("is-hidden", !kind);
      // `required` on a hidden box would block the form with nothing to show
      // the person, so it is only set while the box is on screen.
      refName.required = on;
      feeValue.required = on && !!kind;
      // A number left behind after the fee is set back to "Not agreed yet"
      // would be refused by the server, so it goes with the box.
      if (!kind) feeValue.value = "";
      feeName.textContent = kind === "percent" ? "Percentage of the order" : "Flat amount";
      feeHint.textContent = kind === "percent" ? " 0 to 100" : " in rupees";
    };
    sourceSel.addEventListener("change", sync);
    feeKind.addEventListener("change", sync);

    const form = h("form.panel", {
      onsubmit: async (e) => {
        e.preventDefault();
        await withBusy(save, async () => {
          const body = formData(form);
          try {
            const r = l ? await api.put("/leads/" + l.id, body) : await api.post("/leads", body);
            toast(r.message || "Saved.");
            ctx.navigate("/leads/" + (l ? l.id : r.data.id));
          } catch (err) { toast(err.message, "err"); }
        });
      },
    },
      formSection({
        title: "Who is enquiring?",
        text: "The name is required. A phone number lets you call or WhatsApp them straight from the lead.",
        body: stack(
          grid3(
            field({ label: "Name", input: input("name", l && l.name, { required: true, placeholder: "e.g. Ramesh Kumar" }) }),
            field({ label: "Phone", input: input("phone", l && l.phone, { placeholder: "+91 98765 43210" }) }),
            field({ label: "Email", hint: "optional", input: input("email", l && l.email) })),
          grid3(
            field({ label: "Company", hint: "optional", input: input("company", l && l.company) }),
            field({ label: "City", input: input("city", l && l.city, { placeholder: "e.g. Coimbatore" }) }),
            field({
              label: "State",
              hint: "decides which sales person covers it",
              input: stateField(res.states, l && l.state),
            }))),
      }),
      formSection({
        title: "What do they want?",
        text: "A machine name, a spare, a full factory setup, or a general enquiry.",
        body: stack(
          field({ label: "Interested in", input: input("interest", l && l.interest,
            { placeholder: "e.g. Double Head Welding Machine" }) }),
          field({ label: "Requirement / message",
            input: textarea("message", l && l.message,
              { placeholder: "Budget, timeline, profile type, number of machines…" }) })),
      }),
      formSection({
        title: "Pipeline",
        text: "Where this lead came from, how hot it is, and when to chase it next.",
        body: stack(
          grid3(
            field({ label: "Source", input: sourceSel }),
            field({ label: "Status", input: select("status", statusOptions(), l ? l.status : "new") }),
            field({ label: "Priority", input: select("priority", priorityOptions(), l ? l.priority : "medium") })),
          grid2(
            // Assigning to a user is what the sales app reads: a rep sees the
            // leads given to them and nothing else. The older free-text owner
            // is still accepted for anyone not in the user list.
            field({
              label: "Assigned to",
              hint: team.length ? "they see it in the sales app" : "no users to assign to yet",
              input: frag(
                select("owner_user_id", [
                  { value: "", label: l && l.owner && !l.owner_user_id
                    ? `— keep ${l.owner} (not a panel user) —` : "— nobody yet —" },
                  ...team.map((u) => ({ value: u.id, label: u.name + " · " + u.role_label })),
                ], l && l.owner_user_id ? String(l.owner_user_id) : ""),
                // Carries a name typed in before the user list existed, so
                // choosing nobody does not quietly erase it.
                h("input", { type: "hidden", name: "owner",
                  value: l && !l.owner_user_id && l.owner ? l.owner : "" })),
            }),
            field({ label: "Next follow-up", hint: "optional",
              input: input("next_followup", l ? dateInput(l.next_followup) : "", { type: "date" }) }))),
      }),
      referralSection,
      formFoot(save, h("a.btn.btn--ghost", { href: l ? "/leads/" + l.id : "/leads" }, "Cancel")));

    sync();
    return form;
  },
};

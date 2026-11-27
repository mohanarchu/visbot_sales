// Referrals: the people who send business in, and what each referral is worth.
//
// A referrer is created from the lead form — type a name and mobile against a
// referral lead and the row appears here — so this page is mostly for reading
// back what has come in, and for correcting a name or switching someone off.
import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, statCard, table, rowActions, emptyState,
  field, input, textarea, select, checkbox, formSection, formFoot,
  grid2, grid3, stack, formData, toast, withBusy, confirmAction,
  pager, pageHref, skelCards, skelTable, skelForm,
} from "../ui.js";
import { fmtDate, fmtMoney, fmtFee } from "../fmt.js";
import { statusMeta } from "../vocab.js";

// Mirrors KINDS in server/referrals.js, which is what actually validates.
export const FEE_KINDS = [
  { value: "", label: "Not agreed yet" },
  { value: "percent", label: "Percentage of the order" },
  { value: "flat", label: "Flat amount" },
];

const qs = (o) => {
  const sp = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return "/referrers" + (s ? "?" + s : "");
};

// "3 leads · 1 won" — what a referrer has actually brought in.
const broughtIn = (r) => {
  const bits = [`${r.lead_count} lead${r.lead_count === 1 ? "" : "s"}`];
  if (r.won_count) bits.push(`${r.won_count} won`);
  if (r.open_count) bits.push(`${r.open_count} still open`);
  return bits.join(" · ");
};

// ---------------------------------------------------------------- list
export const referrersList = {
  title: "Referrals",
  subtitle: "Who sends business in, and what each referral is worth",
  nav: "referrers",
  skeleton: () => frag(skelCards(4), skelTable(8)),
  load: (ctx) => api.get("/referrers", ctx.query),

  render({ data, meta, totals }, ctx) {
    const q = ctx.query;

    const searchInput = input("q", q.q, {
      type: "search", placeholder: "Name, mobile or email", "aria-label": "Search referrers",
    });
    const activeSel = select("active", [
      { value: "", label: "Everyone" },
      { value: "1", label: "Only switched on" },
      { value: "0", label: "Only switched off" },
    ], q.active || "");

    const apply = () => ctx.navigate(qs({
      q: searchInput.value.trim(), active: activeSel.value,
      per_page: q.per_page,
    }));
    activeSel.addEventListener("change", apply);

    // A form, as on every other list: Enter searches, and the box only looks
    // like a search box inside .search, which draws the border and the icon.
    const toolbar = h("form.toolbar", { role: "search",
        onsubmit: (e) => { e.preventDefault(); apply(); } },
      h("div.search", icon("search"), searchInput),
      activeSel,
      h("button.btn.btn--ghost", { type: "submit" }, "Search"),
      (q.q || q.active) ? h("a.btn.btn--ghost", { href: "/referrers" }, "Clear") : null,
      h("span.spacer"),
      h("a.btn", { href: "/referrers/new" }, icon("plus"), "Add a referrer"));

    const cards = h("div.stats",
      statCard({ value: String(totals.referrers), caption: "People referring", iconName: "users" }),
      statCard({ value: String(totals.referred_leads), caption: "Leads referred", iconName: "pipeline",
        href: "/leads?source=referral" }),
      statCard({ value: String(totals.won_leads), caption: "Referrals won", iconName: "check" }),
      statCard({ value: fmtMoney(totals.flat_won_total), caption: "Flat fees on won leads",
        iconName: "spark" }));

    const rows = data.map((r) => h("tr" + (r.active ? "" : ".is-dim"),
      h("td",
        h("a.name", { href: "/referrers/" + r.id, text: r.name }),
        r.active ? null : chip("Switched off", "muted")),
      h("td.nowrap", r.phone
        ? h("a", { href: "tel:" + String(r.phone).replace(/\s+/g, ""), text: r.phone })
        : h("span.muted", { text: "No number" })),
      h("td", { text: broughtIn(r) }),
      // Flat fees add up to money owed. A percentage cannot become rupees until
      // the order value is known, so it is shown as a count, not a total.
      h("td.nowrap", r.flat_all_total
        ? frag(h("span", { text: fmtMoney(r.flat_won_total) }),
               r.flat_all_total > r.flat_won_total
                 ? h("span.muted", { text: ` of ${fmtMoney(r.flat_all_total)}` }) : null)
        : h("span.muted", { text: "—" })),
      h("td.nowrap", r.percent_count
        ? h("span.muted", { text: `${r.percent_count} on a %` })
        : h("span.muted", { text: "—" })),
      h("td.col-actions", rowActions(
        h("a.btn.btn--ghost.btn--sm", { href: "/referrers/" + r.id }, "Open"),
        h("a.btn.btn--ghost.btn--sm", { href: "/referrers/" + r.id + "/edit" }, icon("pencil"), "Edit")))));

    return frag(
      cards,
      toolbar,
      h("div.panel", data.length
        ? frag(
            table({
              head: ["Referrer", "Mobile", "Brought in", "Flat fees (won)", "On a %",
                     { label: "Actions", right: true }],
              rows,
            }),
            pager(meta, pageHref("/referrers", ctx.query)))
        : emptyState({
            iconName: "users",
            title: q.q || q.active ? "Nobody matches that" : "No referrers yet",
            text: q.q || q.active
              ? "Try a different name or number."
              : 'Set a lead’s source to "Referral" and type who referred it — they appear here automatically.',
            action: h("a.btn", { href: "/referrers/new" }, icon("plus"), "Add a referrer") })));
  },
};

// The remove button, for a referrer nothing points at.
function removeBtn(r, ctx) {
  const btn = h("button.btn.btn--danger", { type: "button" }, icon("trash"), "Remove this referrer");
  btn.addEventListener("click", async () => {
    if (!await confirmAction(
      `${r.name} has no leads against them, so nothing is lost by removing them.`,
      { title: "Remove this referrer?", confirmText: "Remove" })) return;
    await withBusy(btn, async () => {
      try {
        const out = await api.del("/referrers/" + r.id);
        toast(out.message || "Removed.");
        ctx.navigate("/referrers");
      } catch (err) { toast(err.message, "err"); }
    });
  });
  return btn;
}

// ---------------------------------------------------------------- one referrer
export const referrerDetail = {
  nav: "referrers",
  title: "Referrer",
  back: "/referrers",
  skeleton: () => frag(skelCards(4), skelTable(6)),
  load: (ctx) => api.get("/referrers/" + ctx.params.id),
  titleFrom: (res) => res.data.referrer.name,
  subtitleFrom: (res) => {
    const r = res.data.referrer;
    return [r.phone || "no mobile on file", broughtIn(r)].join(" · ");
  },

  render(res, ctx) {
    const r = res.data.referrer;
    const leads = res.data.leads;

    const cards = h("div.stats",
      statCard({ value: String(r.lead_count), caption: "Leads referred", iconName: "pipeline" }),
      statCard({ value: String(r.won_count), caption: "Won", iconName: "check" }),
      statCard({ value: String(r.open_count), caption: "Still open", iconName: "clock" }),
      statCard({ value: fmtMoney(r.flat_won_total), caption: "Flat fees on won leads",
        iconName: "spark" }));

    const rows = leads.map((l) => {
      const sm = statusMeta(l.status);
      return h("tr",
        h("td", h("a.name", { href: "/leads/" + l.id, text: l.name }),
          l.company ? h("span.muted", { text: " · " + l.company }) : null),
        h("td.nowrap", { text: l.phone || "—" }),
        h("td", chip(sm.label, sm.chip || "plain")),
        h("td.nowrap", { text: fmtFee(l.referral_kind, l.referral_value) || "—" }),
        h("td.nowrap", { text: l.owner || "Nobody yet" }),
        h("td.nowrap", { text: fmtDate(l.created_at) }));
    });

    const notes = r.notes
      ? panel({ title: "Notes",
                body: panelBody(h("p", { style: { margin: 0, whiteSpace: "pre-wrap" }, text: r.notes })) })
      : null;

    // Percentage fees are recorded but cannot be turned into rupees here: a
    // lead carries no order value, so there is nothing to take a percentage of.
    const percentNote = r.percent_count
      ? h("p.muted", { style: { margin: ".6rem 0 0", fontSize: ".86rem" },
          text: `${r.percent_count} of these referrals is on a percentage. The panel records the `
              + `rate but cannot work out the rupees, because a lead does not hold an order value.` })
      : null;

    // Removing a referrer lives here rather than on the edit form, the same way
    // a lead or a service request is deleted from its own page.
    const removeBody = r.lead_count
      ? stack(
          h("p.muted", { style: { margin: 0, fontSize: ".86rem" },
            text: `${r.name} is named on ${r.lead_count} lead${r.lead_count === 1 ? "" : "s"}, so `
                + `removing them would leave those referral fees owed to nobody. Switch them off `
                + `instead and they stop being offered on new leads, without losing any history.` }),
          h("div", h("a.btn.btn--ghost", { href: "/referrers/" + r.id + "/edit" },
            icon("pencil"), "Edit or switch off")))
      : stack(
          h("p.muted", { style: { margin: 0, fontSize: ".86rem" },
            text: "No leads name this referrer, so nothing is lost by removing them." }),
          h("div", removeBtn(r, ctx)));

    return frag(
      cards,
      h("div.toolbar",
        r.active ? null : chip("Switched off", "muted"),
        h("span.spacer"),
        r.phone ? h("a.btn.btn--ghost", { href: "tel:" + String(r.phone).replace(/\s+/g, "") },
          icon("phone"), "Call") : null,
        h("a.btn.btn--ghost", { href: "/referrers/" + r.id + "/edit" }, icon("pencil"), "Edit")),
      notes,
      panel({
        title: "Leads from " + r.name,
        chipText: String(r.lead_count),
        body: leads.length
          ? frag(
              table({ head: ["Lead", "Phone", "Status", "Fee", "Assigned to", "Received"], rows }),
              percentNote ? panelBody(percentNote) : null)
          : panelBody(h("p.muted", { style: { margin: 0 },
              text: "No leads name this referrer yet." })),
      }),
      panel({ title: "Remove", body: panelBody(removeBody) }));
  },
};

// ---------------------------------------------------------------- form
export const referrerForm = {
  nav: "referrers",
  title: (ctx) => (ctx.params.id ? "Edit referrer" : "Add a referrer"),
  back: (ctx) => (ctx.params.id ? "/referrers/" + ctx.params.id : "/referrers"),
  skeleton: () => skelForm(),
  load: (ctx) => (ctx.params.id ? api.get("/referrers/" + ctx.params.id) : Promise.resolve(null)),
  titleFrom: (res, ctx) => (ctx.params.id ? "Edit " + res.data.referrer.name : "Add a referrer"),

  render(res, ctx) {
    const r = res ? res.data.referrer : null;
    const save = h("button.btn", { type: "submit" }, icon("check"), r ? "Save changes" : "Add referrer");

    const form = h("form.panel",
      formSection({
        title: "Who they are",
        text: "The mobile number is what ties their referrals together, so two spellings of "
            + "the same number are treated as the same person.",
        body: stack(
          grid3(
            field({ label: "Name", input: input("name", r && r.name,
              { required: true, placeholder: "e.g. Ramesh Kumar" }) }),
            field({ label: "Mobile", hint: "optional, but recommended",
              input: input("phone", r && r.phone, { placeholder: "+91 98765 43210" }) }),
            field({ label: "Email", hint: "optional", input: input("email", r && r.email) })),
          field({ label: "Notes", hint: "optional",
            input: textarea("notes", r && r.notes,
              { placeholder: "How you know them, what they were promised, anything worth remembering." }) }),
          field({
            label: "Switched on",
            hint: "switch off to stop offering them on new leads, without losing their history",
            input: checkbox("active", r ? r.active : true, "Offer this referrer on new leads"),
          })),
      }),
      formFoot(save, h("a.btn.btn--ghost",
        { href: r ? "/referrers/" + r.id : "/referrers" }, "Cancel")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        try {
          const body = formData(form);
          const out = r ? await api.put("/referrers/" + r.id, body) : await api.post("/referrers", body);
          toast(out.message || "Saved.");
          ctx.navigate("/referrers/" + (r ? r.id : out.data.id));
        } catch (err) { toast(err.message, "err"); }
      });
    });

    return form;
  },
};

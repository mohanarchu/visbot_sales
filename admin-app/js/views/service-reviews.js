// Customer reviews of the service, entered here after a call or a visit.
// Nothing appears on the website's Service page until it is published.
import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, table, rowActions, emptyState, statCard,
  field, input, textarea, select, checkbox, formSection, formFoot, grid2, grid3, stack,
  formData, toast, withBusy, confirmAction, skelTable, skelForm, skelCards,
} from "../ui.js";
import { fmtDate, ago, fmtDateTime } from "../fmt.js";
import { SERVICE_LOGS } from "../features.js";

const stars = (n) => h("span.stars", { title: n + " out of 5" },
  h("b", { text: "★".repeat(n) }), h("span.dim", { text: "★".repeat(5 - n) }));

const qs = (o) => {
  const sp = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return "/service/reviews" + (s ? "?" + s : "");
};

// ---------------------------------------------------------------- list
export const serviceReviewsList = {
  title: "Customer reviews",
  subtitle: "Reviews of your service — publish the ones you want on the website",
  nav: "service-reviews",
  skeleton: () => frag(skelCards(3), skelTable(6)),
  load: (ctx) => api.get("/service/reviews", ctx.query),

  render(res, ctx) {
    const rows = res.data;
    const c = res.counts;
    const q = ctx.query;

    const cards = h("div.stats",
      statCard({
        value: c.pending, caption: "Waiting to be read", iconName: "chat",
        href: qs({ state: "pending" }), variant: c.pending ? "accent" : null,
      }),
      statCard({ value: c.published, caption: "Live on the website", iconName: "globe", href: qs({ state: "published" }) }),
      statCard({ value: c.avg_published || "—", caption: "Average rating shown on the site", iconName: "spark", href: qs({ state: "published" }) }));

    const tabs = h("nav.tabs",
      h("a.tab" + (!q.state ? ".active" : ""), { href: qs({ q: q.q }) },
        "All ", h("span.tab-n", { text: String(c.total) })),
      h("a.tab" + (q.state === "pending" ? ".active" : ""), { href: qs({ state: "pending", q: q.q }) },
        "Not published ", h("span.tab-n", { text: String(c.pending) })),
      h("a.tab" + (q.state === "published" ? ".active" : ""), { href: qs({ state: "published", q: q.q }) },
        "On the website ", h("span.tab-n", { text: String(c.published) })));

    const searchInput = h("input", {
      type: "search", name: "q", value: q.q || "",
      placeholder: "Search name, company, machine, words in the review…",
      "aria-label": "Search reviews",
    });
    const apply = () => ctx.navigate(qs({ state: q.state, q: searchInput.value.trim() }));

    const toolbar = h("form.toolbar", { onsubmit: (e) => { e.preventDefault(); apply(); } },
      h("div.search", icon("search"), searchInput),
      h("button.btn.btn--ghost", { type: "submit" }, "Search"),
      q.q ? h("a.btn.btn--ghost", { href: qs({ state: q.state }) }, "Clear") : null,
      h("span.spacer"),
      h("a.btn", { href: "/service/reviews/new" }, icon("plus"), "Add a review"));

    const toggle = (r) => {
      const btn = h("button.btn" + (r.published ? ".btn--ghost" : "") + ".btn--sm",
        { type: "button" },
        icon(r.published ? "close" : "check"),
        r.published ? "Take off the site" : "Publish");
      btn.addEventListener("click", () => withBusy(btn, async () => {
        try {
          const out = await api.post(`/service/reviews/${r.id}/publish`, { published: !r.published });
          toast(out.message || "Saved.");
          ctx.reload();
        } catch (e) { toast(e.message, "err"); }
      }));
      return btn;
    };

    const del = (r) => {
      const btn = h("button.btn.btn--ghost.btn--icon",
        { type: "button", title: "Delete", "aria-label": "Delete the review from " + r.customer }, icon("trash"));
      btn.addEventListener("click", async () => {
        if (!await confirmAction(
          `The review from "${r.customer}" will be deleted${r.published ? " and removed from the website" : ""}. This cannot be undone.`,
          { title: "Delete this review?", confirmText: "Delete review" })) return;
        await withBusy(btn, async () => {
          try {
            const out = await api.del("/service/reviews/" + r.id);
            toast(out.message || "Deleted.");
            ctx.reload();
          } catch (e) { toast(e.message, "err"); }
        });
      });
      return btn;
    };

    const body = rows.length
      ? table({
          head: ["Rating", "Customer", "Review", "Received", { label: "", right: true }],
          rows: rows.map((r) => h("tr" + (r.published ? "" : ".is-pending"),
            h("td.nowrap", stars(r.rating)),
            h("td",
              h("a.name", { href: "/service/reviews/" + r.id + "/edit", text: r.customer }),
              h("div.sub", {
                text: [r.company, [r.city, r.state].filter(Boolean).join(", "), r.machine]
                  .filter(Boolean).join(" · ") || "No company or location given",
              })),
            h("td.sub", { style: { maxWidth: "340px" }, text: r.comment || "No comment, rating only" }),
            h("td.sub.nowrap", { title: fmtDateTime(r.created_at), text: ago(r.created_at) }),
            h("td.col-actions", rowActions(
              r.published ? chip("Live", "ok") : chip("Not published", "warn"),
              toggle(r),
              h("a.btn.btn--ghost.btn--icon", { href: "/service/reviews/" + r.id + "/edit", title: "Edit" }, icon("pencil")),
              del(r))))),
        })
      : emptyState({
          iconName: "chat",
          title: q.q || q.state ? "No reviews match this filter" : "No reviews yet",
          text: q.q || q.state
            ? "Try clearing the search or looking at another tab."
            : "Add the reviews your customers give you over the phone or after a visit. Each one stays private until you publish it, and published reviews appear on the website's Service page.",
          action: q.q || q.state
            ? h("a.btn.btn--ghost", { href: "/service/reviews" }, "Clear filters")
            : h("a.btn", { href: "/service/reviews/new" }, icon("plus"), "Add a review"),
        });

    return frag(cards, tabs, toolbar, h("div.panel", body),
      h("p.muted", { style: { fontSize: ".85rem", marginTop: "1rem" },
        text: "Nothing a customer writes reaches the website on its own — a review only appears on the Service page once you publish it, and taking it off again is immediate." }));
  },
};

// ---------------------------------------------------------------- form
export const serviceReviewForm = {
  nav: "service-reviews",
  back: "/service/reviews",
  title: (ctx) => (ctx.params.id ? "Edit review" : "Add a review"),
  subtitle: (ctx) => (ctx.params.id ? null : "For a review given over the phone or in person"),
  skeleton: () => skelForm(),
  load: async (ctx) => {
    const [all, visits] = await Promise.all([
      api.get("/service/reviews"),
      // Nothing to link to while the service log is switched off.
      SERVICE_LOGS ? api.get("/service/visits", { q: "" }) : Promise.resolve({ data: [] }),
    ]);
    let r = null;
    if (ctx.params.id) {
      r = all.data.find((x) => String(x.id) === String(ctx.params.id));
      if (!r) throw new Error("Review not found.");
    }
    return { r, visits: visits.data };
  },
  titleFrom: (res) => (res.r ? "Edit the review from " + res.r.customer : "Add a review"),

  render(res, ctx) {
    const r = res.r;
    const visits = res.visits;

    // Adding a review straight from a service record links the two.
    const linkedId = r ? r.visit_id : (/^\d+$/.test(ctx.query.visit || "") ? Number(ctx.query.visit) : "");
    const linked = visits.find((v) => v.id === Number(linkedId));

    const visitOptions = [
      { value: "", label: "— not linked to a logged service —" },
      ...visits.map((v) => ({
        value: v.id,
        label: `${fmtDate(v.service_date)} · ${v.customer}${v.machine ? " · " + v.machine : ""}`,
      })),
    ];

    const save = h("button.btn", { type: "submit" }, icon("check"), r ? "Save changes" : "Add review");

    const form = h("form.panel",
      formSection({
        title: "Who gave the review",
        text: "Only the name, company, location and machine appear on the website — never a phone number or invoice number.",
        body: stack(
          grid3(
            field({ label: "Customer name", input: input("customer", r ? r.customer : (linked ? linked.customer : ""), { required: true }) }),
            field({ label: "Company", hint: "optional", input: input("company", r && r.company) }),
            field({ label: "Machine", hint: "optional", input: input("machine", r ? r.machine : (linked ? linked.machine : "")) })),
          grid3(
            field({ label: "City", hint: "optional", input: input("city", r ? r.city : (linked ? linked.city : "")) }),
            field({ label: "State", hint: "optional", input: input("state", r ? r.state : (linked ? linked.state : "")) }),
            field({ label: "Rating", input: select("rating", [5, 4, 3, 2, 1].map((n) => ({ value: n, label: "★".repeat(n) + " · " + n + " out of 5" })), r ? r.rating : 5) })),
          // With the log hidden there is no list to choose from, so the field
          // goes too — a link made earlier is carried through untouched.
          SERVICE_LOGS
            ? field({ label: "Linked service", hint: "optional, ties the review to a record in the service history",
                input: select("visit_id", visitOptions, linkedId) })
            : h("input", { type: "hidden", name: "visit_id", value: linkedId === null || linkedId === undefined ? "" : String(linkedId) })),
      }),
      formSection({
        title: "What they said",
        body: stack(
          field({
            label: "Review", hint: "in the customer's own words where possible",
            input: textarea("comment", r && r.comment, { rows: 4, placeholder: "Engineer came the same day and the line was running by evening." }),
          }),
          checkbox("published", r ? r.published : false, "Show this review on the website's Service page")),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/service/reviews" }, "Cancel")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        const body = formData(form);
        body.published = body.published === "on";
        try {
          const out = r
            ? await api.put("/service/reviews/" + r.id, body)
            : await api.post("/service/reviews", body);
          toast(out.message || "Saved.");
          ctx.navigate("/service/reviews");
        } catch (err) { toast(err.message, "err"); }
      });
    });
    return form;
  },
};

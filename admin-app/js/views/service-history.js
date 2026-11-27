// Service history: one record per service carried out, whether it came from a
// website request, a phone call or a planned maintenance visit.
import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, table, rowActions, emptyState, statCard,
  field, input, textarea, select, formSection, formFoot, grid2, grid3, stack,
  formData, toast, withBusy, confirmAction, pager, pagedQuery, skelTable, skelForm, skelPanel, skelCards,
} from "../ui.js";
import { fmtDate, dateInput, ago, fmtDateTime, waNumber, dueLabel, daysUntil } from "../fmt.js";

const rupees = (v) =>
  v == null || v === "" ? "—" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const qs = (o) => {
  const sp = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return "/service/history" + (s ? "?" + s : "");
};

// ---------------------------------------------------------------- list
export const serviceHistoryList = {
  title: "Service history",
  nav: "service-history",
  subtitle: "Every service carried out, newest first",
  skeleton: () => frag(skelCards(3), skelTable(8)),
  load: (ctx) => api.get("/service/visits", ctx.query),
  subtitleFrom: (res, ctx) => {
    const n = res.meta.total;
    const count = n + (n === 1 ? " service" : " services");
    if (ctx.query.due === "1") return count + " with the next one due within 30 days";
    if (ctx.query.period === "month") return count + " logged this month";
    if (ctx.query.q || ctx.query.type) return count + " matching the current filter";
    return "Every service carried out, newest first";
  },

  render(res, ctx) {
    const { data: rows, meta, stats, types } = res;
    const q = ctx.query;
    const filtered = !!(q.q || q.type || q.period || q.due);

    // Each card filters to exactly the rows it counted, and the one you are
    // looking at is marked so the list and the cards never disagree.
    const cards = h("div.stats",
      statCard({
        value: stats.total, caption: "Services logged, all time", iconName: "wrench",
        href: "/service/history", variant: !filtered ? "accent" : null,
      }),
      statCard({
        value: stats.this_month, caption: "Logged this month", iconName: "calendar",
        href: qs({ period: "month" }), variant: q.period === "month" ? "accent" : null,
      }),
      statCard({
        value: stats.due_soon, caption: "Next service due within 30 days", iconName: "clock",
        href: qs({ due: "1" }),
        variant: q.due === "1" ? "accent" : (stats.due_soon ? "danger" : null),
      }));

    const searchInput = h("input", {
      type: "search", name: "q", value: q.q || "",
      placeholder: "Search customer, invoice, machine, engineer, work done…",
      "aria-label": "Search service history",
    });
    const typeSel = select("type",
      [{ value: "", label: "All service types" }, ...types.map((t) => ({ value: t.id, label: t.name }))],
      q.type || "");
    // Searching inside a card's view keeps that view.
    const apply = () => ctx.navigate(qs({
      q: searchInput.value.trim(), type: typeSel.value, period: q.period, due: q.due,
    }));
    typeSel.addEventListener("change", apply);

    const activeLabel = q.due === "1" ? "Next service due within 30 days"
      : q.period === "month" ? "Logged this month" : null;

    const toolbar = h("form.toolbar", { onsubmit: (e) => { e.preventDefault(); apply(); } },
      h("div.search", icon("search"), searchInput),
      typeSel,
      h("button.btn.btn--ghost", { type: "submit" }, "Search"),
      activeLabel ? chip(activeLabel, "info") : null,
      filtered ? h("a.btn.btn--ghost", { href: "/service/history" }, "Clear") : null,
      h("span.spacer"),
      h("a.btn", { href: "/service/history/new" }, icon("plus"), "Log a service"));

    const body = rows.length
      ? frag(
          table({
            head: ["Date", "Customer", "Service type", "Machine", "Engineer", "Charges", { label: "", right: true }],
            rows: rows.map((v) => {
              const due = v.next_due ? daysUntil(v.next_due) : null;
              return h("tr",
                h("td.nowrap",
                  h("a.name", { href: "/service/history/" + v.id, text: fmtDate(v.service_date) }),
                  v.next_due
                    ? h("div.sub", { text: "Next: " + dueLabel(v.next_due) })
                    : null),
                h("td",
                  h("span", { text: v.customer }),
                  v.reference ? h("div.sub", { text: v.reference }) : null),
                h("td", v.type_name ? chip(v.type_name, "info") : h("span.sub", { text: "—" })),
                h("td.sub", { style: { maxWidth: "200px" }, text: v.machine || "—" }),
                h("td.sub", { text: v.engineer || "—" }),
                h("td.sub.nowrap", { text: rupees(v.charges) }),
                h("td.col-actions", rowActions(
                  due !== null && due < 0 ? chip("Service due", "warn") : null,
                  h("a.btn.btn--ghost.btn--sm", { href: "/service/history/" + v.id }, "Open", icon("arrow")))));
            }),
          }),
          pager(meta, (n, per) => qs(pagedQuery(q, n, per))))
      : emptyState({
          iconName: "wrench",
          title: q.due === "1" ? "Nothing falls due in the next 30 days"
            : q.period === "month" ? "No services logged this month"
            : filtered ? "Nothing matches this filter"
            : "No services logged yet",
          text: q.due === "1"
            ? "A service shows up here once you set its “next service due” date and that date comes within thirty days."
            : filtered
              ? "Try clearing the filter, or searching for something else."
              : "Log a service after each visit or repair. Over time this becomes the machine's record: what was done, by whom, what it cost and when the next service falls due.",
          action: filtered
            ? h("a.btn.btn--ghost", { href: "/service/history" }, "Show all services")
            : h("a.btn", { href: "/service/history/new" }, icon("plus"), "Log the first service"),
        });

    return frag(cards, toolbar, h("div.panel", body));
  },
};

// ---------------------------------------------------------------- detail
export const serviceVisitDetail = {
  title: "Service record",
  nav: "service-history",
  back: "/service/history",
  skeleton: () => h("div.cols.cols--lead", skelPanel(), skelPanel()),
  load: (ctx) => api.get("/service/visits/" + ctx.params.id),
  titleFrom: (res) => res.data.visit.customer,
  subtitleFrom: (res) => {
    const v = res.data.visit;
    return [v.type_name || "Service", "on " + fmtDate(v.service_date)].join(" ");
  },

  render(res, ctx) {
    const v = res.data.visit;
    const reviews = res.data.reviews;
    const wa = waNumber(v.phone);

    const head = h("div.lead-head",
      h("div.avatar", icon("wrench")),
      h("div.lead-head-txt",
        h("h2", { text: v.customer }),
        h("div.lead-head-meta",
          v.type_name ? chip(v.type_name, "info") : null,
          h("span.muted", { text: fmtDate(v.service_date) }),
          v.reference ? h("span.muted", "Invoice ", h("b", { text: v.reference })) : null)),
      h("div.lead-head-actions",
        wa ? h("a.btn.btn--ghost", { href: "https://wa.me/" + wa, target: "_blank", rel: "noopener" }, icon("chat"), "WhatsApp") : null,
        h("a.btn.btn--ghost", { href: "/service/history/" + v.id + "/edit" }, icon("pencil"), "Edit")));

    const kv = (label, value) => frag(h("dt", { text: label }), value);
    const details = h("dl.kv",
      kv("Service type", h("dd", { text: v.type_name || "—" })),
      kv("Date", h("dd", { text: fmtDate(v.service_date) })),
      kv("Engineer", h("dd", { text: v.engineer || "—" })),
      kv("Machine", h("dd", { text: v.machine || "—" })),
      kv("Invoice / PO", h("dd", v.reference ? h("code", { text: v.reference }) : h("span.muted", { text: "Not recorded" }))),
      kv("Phone", h("dd", v.phone
        ? h("a", { href: "tel:" + v.phone.replace(/\s+/g, ""), text: v.phone })
        : h("span.muted", { text: "Not recorded" }))),
      kv("Location", h("dd", { text: [v.city, v.state].filter(Boolean).join(", ") || "—" })),
      kv("Charges", h("dd", { text: rupees(v.charges) })),
      kv("Next service due", h("dd", v.next_due
        ? h("span", { text: fmtDate(v.next_due) + " · " + dueLabel(v.next_due) })
        : h("span.muted", { text: "Not set" }))),
      kv("From request", h("dd", v.request_id
        ? h("a", { href: "/service/" + v.request_id, text: "Request #" + v.request_id })
        : h("span.muted", { text: "Logged directly" }))),
      kv("Logged", h("dd", { title: fmtDateTime(v.created_at), text: ago(v.created_at) })));

    const delBtn = h("button.btn.btn--danger", { type: "button" }, icon("trash"), "Delete this record");
    delBtn.addEventListener("click", async () => {
      if (!await confirmAction(
        `The service for "${v.customer}" on ${fmtDate(v.service_date)} will be removed from the machine\u2019s history for good. This cannot be undone.`,
        { title: "Delete this service record?", confirmText: "Delete record" })) return;
      await withBusy(delBtn, async () => {
        try {
          const out = await api.del("/service/visits/" + v.id);
          toast(out.message || "Deleted.");
          ctx.navigate("/service/history");
        } catch (e) { toast(e.message, "err"); }
      });
    });

    const reviewList = reviews.length
      ? h("div.list-links", reviews.map((r) => h("a", { href: "/service/reviews" },
          h("span.stars", { text: "★".repeat(r.rating) + "☆".repeat(5 - r.rating) }),
          h("span", { text: r.comment ? r.comment.slice(0, 70) : "No comment" }),
          chip(r.published ? "On the website" : "Not published", r.published ? "ok" : "muted"))))
      : frag(
          h("p.muted", { style: { margin: "0 0 .8rem" },
            text: "No review recorded for this service yet." }),
          h("a.btn.btn--ghost.btn--sm", { href: "/service/reviews/new?visit=" + v.id },
            icon("plus"), "Add the customer's review"));

    return frag(head, h("div.cols.cols--lead",
      h("div",
        panel({
          title: "Work done",
          body: panelBody(v.work_done
            ? h("blockquote.quote", { text: v.work_done })
            : h("p.muted", { style: { margin: 0 }, text: "No description recorded." })),
        }),
        v.parts_used
          ? panel({ title: "Parts and consumables used", body: panelBody(h("blockquote.quote", { text: v.parts_used })) })
          : null,
        panel({ title: "Customer review", body: panelBody(reviewList) })),
      h("div",
        panel({ title: "Service details", body: panelBody(details) }),
        panel({
          title: "Remove",
          body: panelBody(
            h("p.muted", { style: { margin: "0 0 .8rem", fontSize: ".86rem" },
              text: "Deleting a service record removes it from the machine's history for good." }),
            delBtn),
        }))));
  },
};

// ---------------------------------------------------------------- form
export const serviceVisitForm = {
  nav: "service-history",
  title: (ctx) => (ctx.params.id ? "Edit service record" : "Log a service"),
  subtitle: (ctx) => (ctx.params.id ? null : "What was done, by whom, and when the next one falls due"),
  back: (ctx) => (ctx.params.id ? "/service/history/" + ctx.params.id : "/service/history"),
  skeleton: () => skelForm(),
  load: async (ctx) => {
    const [typesRes, products, visitRes, requestRes] = await Promise.all([
      api.get("/service/types"),
      api.get("/products"),
      ctx.params.id ? api.get("/service/visits/" + ctx.params.id) : Promise.resolve(null),
      // Logging straight from a request prefills the customer's details.
      !ctx.params.id && /^\d+$/.test(ctx.query.request || "")
        ? api.get("/service/" + ctx.query.request).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      types: typesRes.data,
      products: products.data,
      v: visitRes ? visitRes.data.visit : null,
      from: requestRes ? requestRes.data.request : null,
    };
  },
  titleFrom: (res, ctx) =>
    ctx.params.id ? "Edit service for " + res.v.customer
      : res.from ? "Log the service for " + res.from.name : "Log a service",

  render(res, ctx) {
    const { types, products, v, from } = res;
    const typeOptions = [
      { value: "", label: "— choose a service type —" },
      ...types.map((t) => ({ value: t.id, label: t.name })),
    ];

    const pre = v || from || {};
    const customerName = v ? v.customer : (from ? from.name : "");
    const save = h("button.btn", { type: "submit" }, icon("check"), v ? "Save changes" : "Log this service");

    const machineList = h("datalist", { id: "visit-machines" },
      products.map((p) => h("option", { value: p.name })));

    const form = h("form.panel",
      from ? h("div.callout",
        icon("spark"),
        h("div", h("b", { text: "Logging the service for request #" + from.id }),
          h("p", { text: "The customer's details have been filled in from the request. The record will stay linked to it." }))) : null,
      formSection({
        title: "Customer and machine",
        body: stack(
          grid3(
            field({ label: "Customer", input: input("customer", customerName, { required: true, placeholder: "Company or person" }) }),
            field({ label: "Phone", input: input("phone", pre.phone) }),
            field({ label: "Invoice / PO number", input: input("reference", pre.reference, { placeholder: "VIS/2025-26/0142" }) })),
          grid3(
            field({ label: "Machine", input: input("machine", pre.machine, { list: "visit-machines", placeholder: "e.g. Double Head Welding Machine" }) }),
            field({ label: "City", input: input("city", pre.city) }),
            field({ label: "State", input: input("state", pre.state) })),
          machineList),
      }),
      formSection({
        title: "The service",
        body: stack(
          grid3(
            field({ label: "Service type", input: select("type_id", typeOptions, v ? v.type_id : "") }),
            field({ label: "Date of service", input: input("service_date", v ? dateInput(v.service_date) : dateInput(new Date()), { type: "date", required: true }) }),
            field({ label: "Engineer", input: input("engineer", v && v.engineer, { placeholder: "Who attended" }) })),
          field({
            label: "Work done",
            input: textarea("work_done", v && v.work_done, { rows: 4, placeholder: "What was found, what was done, and how the machine was left" }),
          }),
          grid2(
            field({
              label: "Parts and consumables used", hint: "one per line, or a short note",
              input: textarea("parts_used", v && v.parts_used, { rows: 3, placeholder: "Teflon sheet ×2\nHeater plate" }),
            }),
            h("div.stack",
              field({ label: "Charges", hint: "leave empty if not charged", input: input("charges", v && v.charges, { placeholder: "e.g. 4500" }) }),
              field({ label: "Next service due", hint: "optional reminder date", input: input("next_due", v && v.next_due ? dateInput(v.next_due) : "", { type: "date" }) }))),
        ),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: v ? "/service/history/" + v.id : "/service/history" }, "Cancel")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        const body = formData(form);
        if (v) body.request_id = v.request_id || "";
        else if (from) body.request_id = from.id;
        try {
          const out = v
            ? await api.put("/service/visits/" + v.id, body)
            : await api.post("/service/visits", body);
          toast(out.message || "Saved.");
          ctx.navigate("/service/history/" + (v ? v.id : out.data.id));
        } catch (err) { toast(err.message, "err"); }
      });
    });
    return form;
  },
};

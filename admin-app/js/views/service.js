// Service requests are an inbox, not a pipeline: the website's Service page is
// the only thing that creates them, so the admin only lists, reads and deletes.
import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, table, rowActions, emptyState,
  field, input, formSection, formFoot, stack, formData,
  toast, withBusy, confirmAction, pager, pagedQuery, skelTable, skelPanel, skelForm,
} from "../ui.js";
import { ago, fmtDate, fmtDateTime, initials, waNumber } from "../fmt.js";
import { SERVICE_LOGS } from "../features.js";

const qs = (o) => {
  const sp = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return "/service" + (s ? "?" + s : "");
};

// ---------------------------------------------------------------- list
export const serviceList = {
  title: "Service requests",
  nav: "service",
  skeleton: () => frag(h("div.skel.skel-line", { style: { width: "40%", height: "36px" } }), skelTable(6)),
  load: (ctx) => api.get("/service", ctx.query),
  subtitleFrom: (res) =>
    res.meta.total === res.all_count
      ? `${res.meta.total} ${res.meta.total === 1 ? "request" : "requests"} from the website's service form`
      : `${res.meta.total} of ${res.all_count} requests match your search`,

  render(res, ctx) {
    const { data: rows, meta, all_count: allCount } = res;
    const q = ctx.query;

    const searchInput = h("input", {
      type: "search", name: "q", value: q.q || "",
      placeholder: "Search name, invoice number, machine, state…",
      "aria-label": "Search service requests",
    });
    const apply = () => ctx.navigate(qs({ q: searchInput.value.trim() }));

    const toolbar = h("form.toolbar", { onsubmit: (e) => { e.preventDefault(); apply(); } },
      h("div.search", icon("search"), searchInput),
      h("button.btn.btn--ghost", { type: "submit" }, "Search"),
      q.q ? h("a.btn.btn--ghost", { href: "/service" }, "Clear") : null);

    const body = rows.length
      ? frag(
          table({
            head: ["Customer", "Invoice / PO", "Machine", "Received", { label: "", right: true }],
            rows: rows.map((r) => {
              const wa = waNumber(r.phone);
              return h("tr",
                h("td",
                  h("a.name", { href: "/service/" + r.id, text: r.name }),
                  h("div.sub", {
                    text: [r.phone, [r.city, r.state].filter(Boolean).join(", ")]
                      .filter(Boolean).join(" · ") || "No contact details",
                  })),
                h("td", r.reference
                  ? h("code", { style: { fontSize: ".8rem" }, text: r.reference })
                  : h("span.sub", { text: "—" })),
                h("td.sub", { style: { maxWidth: "220px" }, text: r.machine || "—" }),
                h("td.sub.nowrap", { title: fmtDateTime(r.created_at), text: ago(r.created_at) }),
                h("td.col-actions", rowActions(
                  wa ? h("a.btn.btn--ghost.btn--icon", {
                    href: "https://wa.me/" + wa, target: "_blank", rel: "noopener",
                    title: "WhatsApp " + r.phone, "aria-label": "WhatsApp this customer",
                  }, icon("chat")) : null,
                  h("a.btn.btn--ghost.btn--sm", { href: "/service/" + r.id }, "Open", icon("arrow")))));
            }),
          }),
          pager(meta, (n, per) => qs(pagedQuery({ q: q.q, per_page: q.per_page }, n, per))))
      : emptyState({
          iconName: "wrench",
          title: allCount ? "No requests match your search" : "No service requests yet",
          text: allCount
            ? "Try a different name, invoice number or machine."
            : "Requests raised on the website's Service page arrive here automatically.",
          action: allCount ? h("a.btn.btn--ghost", { href: "/service" }, "Clear the search") : null,
        });

    return frag(toolbar, h("div.panel", body));
  },
};

// ---------------------------------------------------------------- helpline
export const serviceSettings = {
  title: "Helpline details",
  subtitle: "The numbers and hours shown on the website's Service page",
  nav: "service-helpline",
  skeleton: () => skelForm(),
  load: () => api.get("/service/settings"),

  render(res, ctx) {
    const v = res.data.values;
    const d = res.data.defaults;
    const save = h("button.btn", { type: "submit" }, icon("check"), "Save helpline details");

    const form = h("form.panel",
      formSection({
        title: "Service helpline",
        text: "Shown in the helpline card on the Service page, and in the line above the "
            + "service form telling a customer with a stopped machine to call straight away.",
        body: stack(
          field({
            label: "Service helpline number",
            hint: "leave empty to use " + d.service_helpline,
            input: input("service_helpline", v.service_helpline, { placeholder: d.service_helpline }),
          }),
          field({
            label: "Technical support number",
            hint: "leave empty to use " + d.service_technical,
            input: input("service_technical", v.service_technical, { placeholder: d.service_technical }),
          }),
          field({
            label: "Working hours",
            hint: "the line under the two numbers",
            input: input("service_hours", v.service_hours, { placeholder: d.service_hours }),
          })),
      }),
      formSection({
        body: h("p.muted", { style: { margin: 0, fontSize: ".86rem" },
          text: "Write the numbers exactly as a customer should read them, spaces and all — "
              + "for example “+91 80723 98966”. The Service page picks the change up on its "
              + "next load; no deploy is needed." }),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/service" }, "Back to requests")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        try {
          const out = await api.put("/service/settings", formData(form));
          toast(out.message || "Saved.");
          ctx.reload();
        } catch (err) { toast(err.message, "err"); }
      });
    });
    return form;
  },
};

// ---------------------------------------------------------------- detail
export const serviceDetail = {
  title: "Service request",
  nav: "service",
  back: "/service",
  skeleton: () => frag(h("div.skel", { style: { height: "86px", borderRadius: "12px", marginBottom: "1.15rem" } }),
    h("div.cols.cols--lead", skelPanel(), skelPanel())),
  load: (ctx) => api.get("/service/" + ctx.params.id),
  titleFrom: (res) => res.data.request.name,
  subtitleFrom: (res) => `Request #${res.data.request.id} · received ${fmtDateTime(res.data.request.created_at)}`,

  render(res, ctx) {
    const r = res.data.request;
    const history = res.data.history || [];
    const wa = waNumber(r.phone);

    const head = h("div.lead-head",
      h("div.avatar", { text: initials(r.name) }),
      h("div.lead-head-txt",
        h("h2", { text: r.name }),
        h("div.lead-head-meta",
          r.reference ? h("span.muted", "Invoice ", h("b", { text: r.reference })) : null,
          (r.city || r.state) ? h("span.muted", icon("pin"), [r.city, r.state].filter(Boolean).join(", ")) : null)),
      h("div.lead-head-actions",
        SERVICE_LOGS
          ? h("a.btn", { href: "/service/history/new?request=" + r.id }, icon("check"), "Log the service")
          : null,
        wa ? h("a.btn.btn--ghost", { href: "https://wa.me/" + wa, target: "_blank", rel: "noopener" }, icon("chat"), "WhatsApp") : null,
        r.phone ? h("a.btn.btn--ghost", { href: "tel:" + r.phone.replace(/\s+/g, "") }, icon("phone"), "Call") : null));

    const kv = (label, value) => frag(h("dt", { text: label }), value);
    const details = h("dl.kv",
      kv("Phone", h("dd", r.phone
        ? h("a", { href: "tel:" + r.phone.replace(/\s+/g, ""), text: r.phone })
        : h("span.muted", { text: "Not given" }))),
      kv("Email", h("dd", r.email
        ? h("a", { href: "mailto:" + r.email, text: r.email })
        : h("span.muted", { text: "Not given" }))),
      kv("Invoice / PO", h("dd", r.reference
        ? h("code", { text: r.reference })
        : h("span.muted", { text: "Not given" }))),
      kv("Machine", h("dd", { text: r.machine || "—" })),
      kv("City", h("dd", { text: r.city || "—" })),
      kv("State", h("dd", { text: r.state || "—" })),
      kv("Received", h("dd", { title: fmtDateTime(r.created_at), text: fmtDateTime(r.created_at) })));

    const delBtn = h("button.btn.btn--danger", { type: "button" }, icon("trash"), "Delete this request");
    delBtn.addEventListener("click", async () => {
      if (!await confirmAction(
        `The request from "${r.name}" will be removed from the inbox for good. This cannot be undone.`,
        { title: "Delete this service request?", confirmText: "Delete request" })) return;
      await withBusy(delBtn, async () => {
        try {
          const out = await api.del("/service/" + r.id);
          toast(out.message || "Deleted.");
          ctx.navigate("/service");
        } catch (e) { toast(e.message, "err"); }
      });
    });

    const past = () => history.length
      ? h("div.list-links", history.map((v) => h("a", { href: "/service/history/" + v.id },
          icon("wrench"),
          h("span", { text: fmtDate(v.service_date) + (v.type_name ? " · " + v.type_name : "")
            + (v.engineer ? " · " + v.engineer : "") }),
          chip("Open", "muted"))))
      : h("p.muted", { style: { margin: 0 },
          text: "Nothing has been logged for this invoice or phone number yet. Once you log the service it will appear here." });

    return frag(head, h("div.cols.cols--lead",
      h("div",
        panel({
          title: "Reported problem",
          body: panelBody(r.issue
            ? h("blockquote.quote", { text: r.issue })
            : h("p.muted", { style: { margin: 0 },
                text: "The customer did not describe the problem. Call them on the number shown to find out." })),
        }),
        SERVICE_LOGS ? panel({
          title: "Service history for this machine",
          hint: "matched on the invoice number, or the phone number",
          chipText: history.length ? String(history.length) : null,
          actions: [h("a.btn.btn--ghost.btn--sm", { href: "/service/history/new?request=" + r.id }, icon("plus"), "Log a service")],
          body: panelBody(past()),
        }) : null),
      h("div",
        panel({ title: "Request details", body: panelBody(details) }),
        panel({
          title: "Remove",
          body: panelBody(
            h("p.muted", { style: { margin: "0 0 .8rem", fontSize: ".86rem" },
              text: "Once this request has been attended to, or if it is spam, you can delete it. This cannot be undone." }),
            delBtn),
        }))));
  },
};

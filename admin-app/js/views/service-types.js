// Service type master: the list of kinds of service work, chosen when a
// service is logged. A type is a name and a note — nothing else.
import { api } from "../api.js";
import {
  h, frag, icon, table, rowActions, emptyState,
  field, input, textarea, formSection, formFoot, stack,
  formData, toast, withBusy, confirmAction, pager, pageHref, skelTable, skelForm,
} from "../ui.js";

export const serviceTypesList = {
  title: "Service types",
  subtitle: "The kinds of service work you can log",
  nav: "service-types",
  skeleton: () => skelTable(8),
  load: (ctx) => api.get("/service/types", ctx.query),

  render(res, ctx) {
    const rows = res.data;

    const toolbar = h("div.toolbar",
      h("span.count", { text: rows.length + (rows.length === 1 ? " type" : " types") }),
      h("span.spacer"),
      h("a.btn", { href: "/service/types/new" }, icon("plus"), "Add a service type"));

    const del = (t) => {
      const btn = h("button.btn.btn--ghost.btn--icon",
        { type: "button", title: "Delete", "aria-label": "Delete " + t.name }, icon("trash"));
      btn.addEventListener("click", async () => {
        if (!await confirmAction(
          `"${t.name}" will no longer be offered when logging a service. Nothing already logged is affected.`,
          { title: "Delete this service type?", confirmText: "Delete type" })) return;
        await withBusy(btn, async () => {
          try {
            const out = await api.del("/service/types/" + t.id);
            toast(out.message || "Deleted.");
            ctx.reload();
          } catch (e) { toast(e.message, "err"); }
        });
      });
      return btn;
    };

    const body = rows.length
      ? table({
          head: ["Service type", "Description", { label: "", right: true }],
          rows: rows.map((t) => h("tr",
            h("td", h("a.name", { href: "/service/types/" + t.id + "/edit", text: t.name })),
            h("td.sub", { text: t.description || "—" }),
            h("td.col-actions", rowActions(
              h("a.btn.btn--ghost.btn--sm", { href: "/service/types/" + t.id + "/edit" }, icon("pencil"), "Edit"),
              // A type already used by the history keeps its label: no delete.
              t.used ? null : del(t))))),
        })
      : emptyState({
          iconName: "layers",
          title: "No service types yet",
          text: "A service type is the kind of work carried out — a breakdown repair, a maintenance visit, an installation. You pick one each time you log a service.",
          action: h("a.btn", { href: "/service/types/new" }, icon("plus"), "Add the first one"),
        });

    return frag(toolbar, h("div.panel", body, pager(res.meta, pageHref("/service/types", ctx.query))),
      h("p.muted", { style: { fontSize: ".85rem", marginTop: "1rem" },
        text: "A type that has already been used cannot be deleted, because the service records that point at it would lose their label. Rename it instead — the history follows the new name." }));
  },
};

export const serviceTypeForm = {
  nav: "service-types",
  back: "/service/types",
  title: (ctx) => (ctx.params.id ? "Edit service type" : "Add a service type"),
  skeleton: () => skelForm(),
  load: async (ctx) => {
    if (!ctx.params.id) return { t: null };
    const all = await api.get("/service/types", { all: 1 });
    const t = all.data.find((x) => String(x.id) === String(ctx.params.id));
    if (!t) throw new Error("Service type not found.");
    return { t };
  },
  titleFrom: (res) => (res.t ? "Edit " + res.t.name : "Add a service type"),

  render(res, ctx) {
    const t = res.t;
    const save = h("button.btn", { type: "submit" }, icon("check"), t ? "Save changes" : "Add service type");

    const form = h("form.panel",
      formSection({
        title: "The type of work",
        text: "Keep the name short — it appears in a dropdown when logging a service, and in the history table.",
        body: stack(
          field({
            label: "Service type",
            input: input("name", t && t.name, { required: true, placeholder: "e.g. Preventive maintenance" }),
          }),
          field({
            label: "Description", hint: "optional, a note on when to choose it",
            input: textarea("description", t && t.description, { rows: 3, placeholder: "Scheduled service to keep a line healthy" }),
          })),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/service/types" }, "Cancel")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        try {
          const out = t
            ? await api.put("/service/types/" + t.id, formData(form))
            : await api.post("/service/types", formData(form));
          toast(out.message || "Saved.");
          ctx.navigate("/service/types");
        } catch (err) { toast(err.message, "err"); }
      });
    });
    return form;
  },
};

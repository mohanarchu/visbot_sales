import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, statCard, bars, table, rowActions,
  emptyState, thumb, field, input, textarea, select, checkbox, formSection,
  formFoot, grid2, grid3, stack, formData, toast, withBusy, confirmAction,
  pager, pageHref, skelCards, skelTable, skelForm, skelPanel,
} from "../ui.js";
import { imagePicker, pairsEditor, countedTextarea, linkSlug } from "../widgets.js";

// A delete button that confirms, calls the API and refreshes the list.
function deleteButton(path, label, message, ctx) {
  const btn = h("button.btn.btn--danger.btn--icon",
    { type: "button", title: "Delete " + label, "aria-label": "Delete " + label }, icon("trash"));
  btn.addEventListener("click", async () => {
    if (!await confirmAction(message, { title: "Delete " + label + "?" })) return;
    await withBusy(btn, async () => {
      try {
        const r = await api.del(path);
        toast(r.message || "Deleted.");
        ctx.reload();
      } catch (e) { toast(e.message, "err"); }
    });
  });
  return btn;
}

// Shared save handler for the simple content forms.
function saveForm({ form, button, isNew, path, after, ctx, body }) {
  return async (e) => {
    e.preventDefault();
    await withBusy(button, async () => {
      try {
        const payload = body ? body() : formData(form);
        const r = isNew ? await api.post(path, payload) : await api.put(path, payload);
        toast(r.message || "Saved.");
        ctx.navigate(after);
      } catch (err) { toast(err.message, "err"); }
    });
  };
}

// ---------------------------------------------------------------- overview
export const websiteOverview = {
  title: "Website content",
  subtitle: "What visitors see on visbot.in — changes go live immediately",
  nav: "website",
  skeleton: () => frag(skelCards(5), h("div.cols", skelPanel(), skelPanel())),
  load: () => api.get("/website"),

  render({ data }) {
    const { counts, byCategory, noPhoto, orphans } = data;
    const cards = h("div.stats",
      statCard({ value: counts.cats, caption: "Categories", iconName: "layers", href: "/categories" }),
      statCard({ value: counts.products, caption: "Products", iconName: "box", href: "/products" }),
      statCard({ value: counts.spares, caption: `Spares in ${counts.groups} groups`, iconName: "wrench", href: "/spares" }),
      statCard({ value: counts.locations, caption: "Locations", iconName: "pin", href: "/locations" }),
      statCard({ value: counts.regions, caption: "Regional contacts", iconName: "phone", href: "/regions" }));

    const attention = noPhoto.length + orphans.length;

    return frag(cards,
      h("div.cols",
        panel({
          title: "Catalogue by category", hint: "Products shown on the Products page",
          body: panelBody(byCategory.length
            ? bars(byCategory.map((c) => ({ label: c.name, n: c.n, href: "/products" })))
            : h("p.muted", { text: "No categories yet." })),
        }),
        panel({
          title: "Needs attention",
          chipText: attention ? String(attention) : "All clear",
          chipVariant: attention ? "warn" : "ok",
          body: panelBody(attention
            ? h("div.list-links",
                orphans.map((p) => h("a", { href: "/products/" + p.id + "/edit" },
                  icon("alert"), h("span", { text: p.name }), chip("No category", "warn"))),
                noPhoto.map((r) => h("a", { href: "/" + (r.kind === "spare" ? "spares" : "products") + "/" + r.id + "/edit" },
                  icon("image"), h("span", { text: r.name }), chip("No photo", "muted"))))
            : h("p.muted", { style: { margin: 0 },
                text: "Every product and spare has a photo, and all products are in a category." })),
        })),
      panel({
        title: "Manage content",
        body: panelBody(h("div.actions-grid",
          h("a.action-card", { href: "/categories" }, icon("layers"), "Product categories"),
          h("a.action-card", { href: "/products" }, icon("box"), "Products"),
          h("a.action-card", { href: "/spares" }, icon("wrench"), "Spares"),
          h("a.action-card", { href: "/locations" }, icon("pin"), "Addresses & locations"),
          h("a.action-card", { href: "/regions" }, icon("phone"), "Regional contacts"),
          h("a.action-card", { href: "/index.html", target: "_blank", rel: "noopener" },
            icon("external"), "Open the website"))),
      }));
  },
};

// ---------------------------------------------------------------- categories
export const categoriesList = {
  title: "Product categories",
  subtitle: "Sections on the Products page, in display order",
  nav: "categories",
  skeleton: () => skelTable(5),
  load: (ctx) => api.get("/categories", ctx.query),

  render({ data, meta }, ctx) {
    const rows = data.map((c) => h("tr",
      h("td.num", { text: String(c.sort_order) }),
      h("td", h("span.name", { text: c.name })),
      h("td", h("a.sub", { href: "/products.html#" + c.slug, target: "_blank", rel: "noopener", text: "#" + c.slug })),
      h("td", chip(`${c.product_count} ${c.count_label}`, "info")),
      h("td.sub", { text: c.cols + " columns" }),
      h("td.col-actions", rowActions(
        h("a.btn.btn--ghost.btn--sm", { href: "/categories/" + c.id + "/edit" }, icon("pencil"), "Edit"),
        deleteButton("/categories/" + c.id, "category",
          `Delete the category "${c.name}"? Its ${c.product_count} product(s) will stay but become uncategorised and drop off the Products page.`, ctx)))));

    return frag(
      h("div.toolbar", h("span.spacer"), h("a.btn", { href: "/categories/new" }, icon("plus"), "New category")),
      h("div.panel", data.length
        ? frag(
            table({ head: ["#", "Category", "Section anchor", "Products", "Grid", { label: "Actions", right: true }], rows }),
            pager(meta, pageHref("/categories", ctx.query)))
        : emptyState({ iconName: "layers", title: "No categories",
            text: "Categories group the machines into sections on the Products page.",
            action: h("a.btn", { href: "/categories/new" }, icon("plus"), "New category") })));
  },
};

export const categoryForm = {
  nav: "categories",
  title: (ctx) => (ctx.params.id ? "Edit category" : "New category"),
  back: "/categories",
  skeleton: () => skelForm(),
  load: (ctx) => (ctx.params.id ? api.get("/categories/" + ctx.params.id) : Promise.resolve(null)),
  titleFrom: (res, ctx) => (ctx.params.id ? res.data.name : "New category"),

  render(res, ctx) {
    const c = res ? res.data : null;
    const nameEl = input("name", c && c.name, { required: true, placeholder: "e.g. Welding Machines" });
    const slugEl = input("slug", c && c.slug, { required: true, pattern: "[a-z0-9-]+", placeholder: "welding" });
    if (!c) linkSlug(nameEl, slugEl);
    const save = h("button.btn", { type: "submit" }, icon("check"), c ? "Save changes" : "Create category");

    const form = h("form.panel",
      formSection({
        title: "Category", text: "Each category is one section heading on the Products page.",
        body: stack(
          grid2(
            field({ label: "Name", input: nameEl }),
            field({ label: "Section anchor", hint: "products.html#<slug>", input: slugEl })),
          grid3(
            field({ label: "Count label", hint: 'shown as "6 machines"',
              input: input("count_label", c ? c.count_label : "machines", { placeholder: "machines" }) }),
            field({ label: "Cards per row", hint: "2 to 4",
              input: input("cols", c ? c.cols : 3, { type: "number", min: 2, max: 4 }) }),
            field({ label: "Sort order", hint: "lower numbers first",
              input: input("sort_order", c ? c.sort_order : 0, { type: "number" }) }))),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/categories" }, "Cancel")));

    form.addEventListener("submit", saveForm({
      form, button: save, isNew: !c,
      path: c ? "/categories/" + c.id : "/categories",
      after: "/categories", ctx,
    }));
    return form;
  },
};

// ---------------------------------------------------------------- products
export const productsList = {
  title: "Products",
  subtitle: "Machines shown on the Products page and their detail pages",
  nav: "products",
  skeleton: () => skelTable(8),
  load: (ctx) => api.get("/products", ctx.query),
  subtitleFrom: (res) =>
    `${res.meta ? res.meta.total : res.data.length} products on the website`,

  render({ data, meta }, ctx) {
    const search = h("input", { type: "search", placeholder: "Search by name, price, slug…", "aria-label": "Search products" });
    const catSel = select("cat", [{ value: "", label: "All categories" },
      ...[...new Set(data.map((p) => p.category_name).filter(Boolean))].map((n) => ({ value: n, label: n }))], "");
    const count = h("span.count");

    const rows = data.map((p) => {
      const href = "/product/" + (p.detail_slug || p.slug) + ".html";
      const tr = h("tr",
        h("td", thumb(p.image ? "/assets/products/" + p.image : null, p.name)),
        h("td",
          h("span.name", { text: p.name }), h("br"),
          h("a.sub", { href, target: "_blank", rel: "noopener", text: href + " ↗" })),
        h("td", p.category_name ? h("span", { text: p.category_name }) : chip("Uncategorised", "warn")),
        h("td.nowrap", p.price, p.price_note ? frag(" ", h("span.sub", { text: p.price_note })) : null),
        h("td",
          p.show_in_grid ? chip("On grid", "ok") : chip("Detail page only", "muted"),
          p.detail_slug ? frag(" ", chip("→ " + p.detail_slug, "info")) : null),
        h("td.col-actions", rowActions(
          h("a.btn.btn--ghost.btn--sm", { href: "/products/" + p.id + "/edit" }, icon("pencil"), "Edit"),
          deleteButton("/products/" + p.id, "product",
            `Delete the product "${p.name}"? This also removes its detail page.`, ctx))));
      tr.dataset.cat = p.category_name || "";
      tr.dataset.hay = [p.name, p.slug, p.price, p.card_desc].filter(Boolean).join(" ").toLowerCase();
      return tr;
    });

    const apply = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      rows.forEach((tr) => {
        const okQ = !q || tr.dataset.hay.includes(q);
        const okC = !catSel.value || tr.dataset.cat === catSel.value;
        tr.hidden = !(okQ && okC);
        if (!tr.hidden) shown++;
      });
      count.textContent = shown === rows.length ? `${rows.length} items` : `${shown} of ${rows.length}`;
    };
    search.addEventListener("input", apply);
    catSel.addEventListener("change", apply);
    setTimeout(apply);

    return frag(
      h("div.toolbar",
        h("div.search", icon("search"), search), catSel, count,
        h("a.btn.spacer", { href: "/products/new" }, icon("plus"), "New product")),
      h("div.panel",
        table({
          head: ["Photo", "Product", "Category", "Price", "Status", { label: "Actions", right: true }],
          rows,
        }),
        pager(meta, pageHref("/products", ctx.query))));
  },
};

export const productForm = {
  nav: "products",
  title: (ctx) => (ctx.params.id ? "Edit product" : "New product"),
  subtitle: (ctx) => (ctx.params.id ? null : "Adds a card to the Products page and its own detail page"),
  back: "/products",
  skeleton: () => skelForm(),
  load: async (ctx) => {
    const [cats, images, product] = await Promise.all([
      api.get("/categories", { all: 1 }),
      api.get("/images"),
      ctx.params.id ? api.get("/products/" + ctx.params.id) : Promise.resolve(null),
    ]);
    return { cats: cats.data, images: images.data, p: product ? product.data : null };
  },
  titleFrom: (res, ctx) => (ctx.params.id ? res.p.name : "New product"),

  render(res, ctx) {
    const { cats, images, p } = res;
    const nameEl = input("name", p && p.name, { required: true, placeholder: "e.g. Single Head Welding Machine" });
    const slugEl = input("slug", p && p.slug, { required: true, pattern: "[a-z0-9-]+", placeholder: "single-head-welding-machine" });
    if (!p) linkSlug(nameEl, slugEl);

    const specPairs = (p && p.specs) ? p.specs : [];
    const save = h("button.btn", { type: "submit" }, icon("check"), p ? "Save changes" : "Create product");

    const form = h("form.panel", { enctype: "multipart/form-data" },
      formSection({
        title: "Basics", text: "The name and price shown on the product card and the detail page banner.",
        body: stack(
          grid2(
            field({ label: "Product name", input: nameEl }),
            field({ label: "Page address", hint: "/product/<slug>.html", input: slugEl })),
          grid3(
            field({ label: "Category", input: select("category_id",
              [{ value: "", label: "— none —" }, ...cats.map((c) => ({ value: c.id, label: c.name }))],
              p && p.category_id) }),
            field({ label: "Price", hint: '₹23,000 or "Price on request"',
              input: input("price", p && p.price, { placeholder: "₹1,45,000" }) }),
            field({ label: "Price suffix", hint: "optional",
              input: input("price_note", p && p.price_note, { placeholder: "onwards" }) }))),
      }),
      formSection({
        title: "Photo", text: "Choose a photo already in the library, or upload a new one — an upload replaces the selection.",
        body: imagePicker(p && p.image, images),
      }),
      formSection({
        title: "Descriptions", text: "Short text for the card, and the longer copy used on the detail page.",
        body: stack(
          field({ label: "Card description", hint: "one line under the price on the Products page",
            input: input("card_desc", p && p.card_desc, { placeholder: "Pneumatic single head welder with PLC control." }) }),
          field({ label: "Tagline", hint: "sits under the title in the detail page banner",
            input: input("tag", p && p.tag) }),
          field({ label: "Overview", hint: 'the "About this machine" paragraph',
            input: textarea("intro", p && p.intro, { rows: 5 }) })),
      }),
      formSection({
        title: "Key features",
        text: "One feature per line. Wrap the lead-in in <b>…</b> for a bold label.",
        body: h("div.field.field--mono", countedTextarea("features", (p && p.features || []).join("\n"), "feature")),
      }),
      formSection({
        title: "Technical specifications",
        text: "Each row becomes a line in the specifications table on the detail page.",
        body: stack(
          h("div.field", pairsEditor("specs", specPairs, "Parameter", "Value")),
          grid2(
            field({ label: "Table heading", hint: "default: Technical parameters",
              input: input("spec_title", p && p.spec_title, { placeholder: "Technical parameters" }) }),
            field({ label: "Note below the table", hint: "optional", input: input("note", p && p.note) }))),
      }),
      formSection({
        title: "Placement", text: "Controls where this product appears and in what order.",
        body: grid3(
          checkbox("show_in_grid", p ? p.show_in_grid : true, "Show a card on the Products page"),
          field({ label: "Card links to another page", hint: "slug, e.g. air-compressors",
            input: input("detail_slug", p && p.detail_slug) }),
          field({ label: "Sort order", hint: "lower numbers first",
            input: input("sort_order", p ? p.sort_order : 0, { type: "number" }) })),
      }),
      formFoot(save,
        h("a.btn.btn--ghost", { href: "/products" }, "Cancel"),
        p ? h("a.btn.btn--ghost.spacer", {
          href: "/product/" + (p.detail_slug || p.slug) + ".html", target: "_blank", rel: "noopener",
        }, icon("external"), "View page") : null));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        // Multipart, because this form can carry a file.
        const fd = new FormData(form);
        fd.set("show_in_grid", form.querySelector('[name="show_in_grid"]').checked ? "on" : "");
        if (!fd.get("image_file") || !fd.get("image_file").size) fd.delete("image_file");
        try {
          const r = p ? await api.put("/products/" + p.id, fd) : await api.post("/products", fd);
          toast(r.message || "Saved.");
          ctx.navigate("/products");
        } catch (err) { toast(err.message, "err"); }
      });
    });
    return form;
  },
};

// ---------------------------------------------------------------- spares
export const sparesList = {
  title: "Spares",
  nav: "spares",
  skeleton: () => frag(skelTable(4), skelTable(4)),
  load: (ctx) => api.get("/spares", ctx.query),
  subtitleFrom: (res) =>
    `${res.meta ? res.meta.total : res.data.spares.length} spares in ${res.data.groups.length} groups on the Spares page`,

  render({ data, meta }, ctx) {
    const { groups, spares } = data;
    const byGroup = {};
    spares.forEach((s) => (byGroup[s.group_id] = byGroup[s.group_id] || []).push(s));

    const sections = groups.map((g) => {
      const items = byGroup[g.id] || [];
      const rows = items.map((s) => h("tr",
        h("td", thumb(s.image ? "/assets/products/" + s.image : null, s.name)),
        h("td", h("span.name", { text: s.name })),
        h("td.sub", { text: s.description || "—" }),
        h("td.col-actions", rowActions(
          h("a.btn.btn--ghost.btn--sm", { href: "/spares/" + s.id + "/edit" }, icon("pencil"), "Edit"),
          deleteButton("/spares/" + s.id, "spare", `Delete the spare "${s.name}"?`, ctx)))));

      return panel({
        title: g.name,
        chipText: String(items.length),
        actions: [
          h("a.btn.btn--ghost.btn--sm", { href: "/spares/new?group=" + g.id }, icon("plus"), "Add spare"),
          h("a.btn.btn--ghost.btn--sm", { href: "/spare-groups/" + g.id + "/edit" }, icon("pencil"), "Group"),
          deleteButton("/spare-groups/" + g.id, "group",
            `Delete the group "${g.name}" and all ${items.length} spare(s) inside it?`, ctx),
        ],
        body: items.length
          ? table({ head: ["Photo", "Spare", "Description", { label: "Actions", right: true }], rows })
          : emptyState({ iconName: "wrench", title: "No spares in this group",
              text: "This group is hidden from the Spares page until it has at least one item.",
              action: h("a.btn", { href: "/spares/new?group=" + g.id }, icon("plus"), "Add a spare") }),
      });
    });

    return frag(
      h("div.toolbar",
        h("a.btn.btn--ghost", { href: "/spare-groups/new" }, icon("plus"), "New group"),
        h("a.btn.spacer", { href: "/spares/new" }, icon("plus"), "New spare")),
      groups.length ? frag(sections) : h("div.panel", emptyState({
        iconName: "wrench", title: "No spare groups",
        text: "Groups become the section headings on the Spares page.",
        action: h("a.btn", { href: "/spare-groups/new" }, icon("plus"), "New group"),
      })),
      meta && meta.pages > 1
        ? h("div.panel", pager(meta, pageHref("/spares", ctx.query)))
        : null);
  },
};

export const spareForm = {
  nav: "spares",
  title: (ctx) => (ctx.params.id ? "Edit spare" : "New spare"),
  back: "/spares",
  skeleton: () => skelForm(),
  load: async (ctx) => {
    const [groups, images, spare] = await Promise.all([
      api.get("/spares", { all: 1 }), api.get("/images"),
      ctx.params.id ? api.get("/spares/" + ctx.params.id) : Promise.resolve(null),
    ]);
    return { groups: groups.data.groups, images: images.data, s: spare ? spare.data : null };
  },
  titleFrom: (res, ctx) => (ctx.params.id ? res.s.name : "New spare"),

  render(res, ctx) {
    const { groups, images, s } = res;
    const preset = ctx.query.group;
    const save = h("button.btn", { type: "submit" }, icon("check"), s ? "Save changes" : "Create spare");

    const form = h("form.panel", { enctype: "multipart/form-data" },
      formSection({
        title: "Spare details", text: "The name, group and short description shown on the card.",
        body: stack(
          grid2(
            field({ label: "Name", input: input("name", s && s.name, { required: true, placeholder: "e.g. Copy Router Bits" }) }),
            field({ label: "Group", input: select("group_id",
              groups.map((g) => ({ value: g.id, label: g.name })),
              s ? s.group_id : preset, { required: true }) })),
          field({ label: "Description", hint: "one short line on the card",
            input: input("description", s && s.description) }),
          field({ label: "Sort order", hint: "within the group", style: { maxWidth: "220px" },
            input: input("sort_order", s ? s.sort_order : 0, { type: "number" }) })),
      }),
      formSection({
        title: "Photo", text: 'Cards without a photo show a "Photo on request" placeholder on the website.',
        body: imagePicker(s && s.image, images),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/spares" }, "Cancel")));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(save, async () => {
        const fd = new FormData(form);
        if (!fd.get("image_file") || !fd.get("image_file").size) fd.delete("image_file");
        try {
          const r = s ? await api.put("/spares/" + s.id, fd) : await api.post("/spares", fd);
          toast(r.message || "Saved.");
          ctx.navigate("/spares");
        } catch (err) { toast(err.message, "err"); }
      });
    });
    return form;
  },
};

export const groupForm = {
  nav: "spares",
  title: (ctx) => (ctx.params.id ? "Edit spare group" : "New spare group"),
  back: "/spares",
  skeleton: () => skelForm(),
  load: (ctx) => (ctx.params.id ? api.get("/spare-groups/" + ctx.params.id) : Promise.resolve(null)),
  titleFrom: (res, ctx) => (ctx.params.id ? res.data.name : "New spare group"),

  render(res, ctx) {
    const g = res ? res.data : null;
    const save = h("button.btn", { type: "submit" }, icon("check"), g ? "Save changes" : "Create group");
    const form = h("form.panel",
      formSection({
        title: "Group", text: "Groups are the section headings that spares are listed under.",
        body: grid2(
          field({ label: "Group name", input: input("name", g && g.name, { required: true, placeholder: "e.g. Corner Cleaning Tools" }) }),
          field({ label: "Sort order", hint: "lower numbers first",
            input: input("sort_order", g ? g.sort_order : 0, { type: "number" }) })),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/spares" }, "Cancel")));

    form.addEventListener("submit", saveForm({
      form, button: save, isNew: !g,
      path: g ? "/spare-groups/" + g.id : "/spare-groups",
      after: "/spares", ctx,
    }));
    return form;
  },
};

// ---------------------------------------------------------------- locations
export const locationsList = {
  title: "Addresses & locations",
  subtitle: "The address cards on the Contact page",
  nav: "locations",
  skeleton: () => skelTable(3),
  load: (ctx) => api.get("/locations", ctx.query),

  render({ data, meta }, ctx) {
    const rows = data.map((l) => h("tr",
      h("td.num", { text: String(l.sort_order) }),
      h("td", h("span.name", { text: l.title })),
      h("td.sub", { style: { whiteSpace: "pre-line", minWidth: "220px" }, text: l.address || "—" }),
      h("td.sub", { style: { minWidth: "200px" } },
        (l.phones || []).length
          ? (l.phones || []).map((ph) => h("div",
              h("b", { style: { color: "var(--ink-700)" }, text: ph.number }),
              ph.label ? " · " + ph.label : ""))
          : "—"),
      h("td", l.map_url ? chip("Linked", "ok") : chip("None", "muted")),
      h("td.col-actions", rowActions(
        h("a.btn.btn--ghost.btn--sm", { href: "/locations/" + l.id + "/edit" }, icon("pencil"), "Edit"),
        deleteButton("/locations/" + l.id, "location", `Delete the location "${l.title}"?`, ctx)))));

    return frag(
      h("div.toolbar", h("span.spacer"), h("a.btn", { href: "/locations/new" }, icon("plus"), "New location")),
      h("div.panel", data.length
        ? frag(
            table({ head: ["#", "Title", "Address", "Phone numbers", "Map", { label: "Actions", right: true }], rows }),
            pager(meta, pageHref("/locations", ctx.query)))
        : emptyState({ iconName: "pin", title: "No locations",
            text: "Add the factory, experience centre or proprietor card shown on the Contact page.",
            action: h("a.btn", { href: "/locations/new" }, icon("plus"), "New location") })));
  },
};

export const locationForm = {
  nav: "locations",
  title: (ctx) => (ctx.params.id ? "Edit location" : "New location"),
  back: "/locations",
  skeleton: () => skelForm(),
  load: (ctx) => (ctx.params.id ? api.get("/locations/" + ctx.params.id) : Promise.resolve(null)),
  titleFrom: (res, ctx) => (ctx.params.id ? res.data.title : "New location"),

  render(res, ctx) {
    const l = res ? res.data : null;
    const phonePairs = ((l && l.phones) || []).map((p) => [p.number, p.label || ""]);
    const save = h("button.btn", { type: "submit" }, icon("check"), l ? "Save changes" : "Create location");

    const form = h("form.panel",
      formSection({
        title: "Address card", text: "Each line of the address becomes a separate line on the card.",
        body: stack(
          grid2(
            field({ label: "Title", input: input("title", l && l.title, { required: true, placeholder: "Factory — Coimbatore" }) }),
            field({ label: "Sort order", hint: "lower numbers first",
              input: input("sort_order", l ? l.sort_order : 0, { type: "number" }) })),
          field({ label: "Address", input: textarea("address", l && l.address, { rows: 4 }) }),
          field({ label: "Google Maps link", hint: 'optional — adds an "Open in Google Maps" link',
            input: input("map_url", l && l.map_url, { placeholder: "https://maps.google.com/?q=…" }) })),
      }),
      formSection({
        title: "Phone numbers",
        text: 'One row per number. The label is optional and appears after the number, like "sales & enquiries".',
        body: h("div.field", pairsEditor("phones", phonePairs, "+91 80723 98966", "sales & enquiries")),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/locations" }, "Cancel")));

    form.addEventListener("submit", saveForm({
      form, button: save, isNew: !l,
      path: l ? "/locations/" + l.id : "/locations",
      after: "/locations", ctx,
    }));
    return form;
  },
};

// ---------------------------------------------------------------- regions
export const regionsList = {
  title: "Regional contacts",
  subtitle: "The state-wise phone table on the Contact page",
  nav: "regions",
  skeleton: () => skelTable(8),
  load: (ctx) => api.get("/regions", ctx.query),

  render({ data, meta }, ctx) {
    const rows = data.map((r) => h("tr",
      h("td.num", { text: String(r.sort_order) }),
      h("td", h("span.name", { text: r.region })),
      h("td.nowrap", { text: r.phone }),
      h("td.col-actions", rowActions(
        h("a.btn.btn--ghost.btn--sm", { href: "/regions/" + r.id + "/edit" }, icon("pencil"), "Edit"),
        deleteButton("/regions/" + r.id, "region", `Remove "${r.region}" from the contact table?`, ctx)))));

    return frag(
      h("div.toolbar", h("span.spacer"), h("a.btn", { href: "/regions/new" }, icon("plus"), "New region")),
      h("div.panel", data.length
        ? frag(
            table({ head: ["#", "Region", "Phone", { label: "Actions", right: true }], rows }),
            pager(meta, pageHref("/regions", ctx.query)))
        : emptyState({ iconName: "phone", title: "No regional contacts",
            text: 'These rows become the "Your regional contact" table on the Contact page.',
            action: h("a.btn", { href: "/regions/new" }, icon("plus"), "New region") })));
  },
};

export const regionForm = {
  nav: "regions",
  title: (ctx) => (ctx.params.id ? "Edit regional contact" : "New regional contact"),
  back: "/regions",
  skeleton: () => skelForm(),
  load: (ctx) => (ctx.params.id ? api.get("/regions/" + ctx.params.id) : Promise.resolve(null)),
  titleFrom: (res, ctx) => (ctx.params.id ? res.data.region : "New regional contact"),

  render(res, ctx) {
    const r = res ? res.data : null;
    const save = h("button.btn", { type: "submit" }, icon("check"), r ? "Save changes" : "Add contact");
    const form = h("form.panel",
      formSection({
        title: "Contact row",
        text: 'These rows make up the "Your regional contact" table on the Contact page.',
        body: stack(
          grid2(
            field({ label: "Region", input: input("region", r && r.region, { required: true, placeholder: "e.g. Tamil Nadu (Head Office)" }) }),
            field({ label: "Phone", input: input("phone", r && r.phone, { required: true, placeholder: "+91 80723 98966" }) })),
          field({ label: "Sort order", hint: "lower numbers first", style: { maxWidth: "220px" },
            input: input("sort_order", r ? r.sort_order : 0, { type: "number" }) })),
      }),
      formFoot(save, h("a.btn.btn--ghost", { href: "/regions" }, "Cancel")));

    form.addEventListener("submit", saveForm({
      form, button: save, isNew: !r,
      path: r ? "/regions/" + r.id : "/regions",
      after: "/regions", ctx,
    }));
    return form;
  },
};

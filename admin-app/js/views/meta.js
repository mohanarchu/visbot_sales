import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, statCard, bars, field, input, select,
  formSection, formFoot, grid2, stack, formData, toast, withBusy,
  skelCards, skelPanel,
} from "../ui.js";
import { ago, fmtDateTime } from "../fmt.js";

export const metaView = {
  title: "Meta lead ads",
  subtitle: "Bring Facebook and Instagram lead-form enquiries straight into the pipeline",
  nav: "meta",
  skeleton: () => frag(skelCards(5), h("div.cols", skelPanel(), skelPanel())),
  load: () => api.get("/meta"),

  render({ data }, ctx) {
    const { config: cfg, stats, campaigns, logs, webhook_url: webhookUrl, is_local: isLocal } = data;
    const ready = cfg.has_app_secret && cfg.has_page_token && cfg.meta_page_id;

    const cards = h("div.stats",
      h("div.stat" + (ready ? "" : ".stat--danger"),
        h("span.ico-box", icon(ready ? "check" : "alert")),
        h("span.txt",
          h("b", { style: { fontSize: "1.05rem" }, text: ready ? "Configured" : "Not configured" }),
          h("span.cap", { text: ready ? "Credentials saved" : "Add your credentials below" }))),
      statCard({ value: stats.total, caption: "Leads from Meta", iconName: "users", href: "/leads?source=facebook" }),
      statCard({ value: stats.week, caption: "In the last 7 days", iconName: "calendar" }),
      h("div.stat", h("span.ico-box", icon("clock")),
        h("span.txt", h("b", { style: { fontSize: "1.05rem" }, text: cfg.last_sync ? ago(cfg.last_sync) : "Never" }),
          h("span.cap", { text: "Last sync" }))),
      h("div.stat", h("span.ico-box", icon("chat")),
        h("span.txt", h("b", { style: { fontSize: "1.05rem" }, text: cfg.last_webhook ? ago(cfg.last_webhook) : "Never" }),
          h("span.cap", { text: "Last webhook" }))));

    // ---- credentials ----
    const saveBtn = h("button.btn", { type: "submit" }, icon("check"), "Save credentials");
    const credForm = h("form",
      h("div.form-section", stack(
        grid2(
          field({ label: "App ID", input: input("meta_app_id", cfg.meta_app_id, { placeholder: "1234567890123456" }) }),
          field({ label: "App Secret", hint: "required — signs every webhook",
            input: input("meta_app_secret", cfg.app_secret_masked, { placeholder: "Paste to set", autocomplete: "off" }) })),
        grid2(
          field({ label: "Facebook Page ID", input: input("meta_page_id", cfg.meta_page_id, { placeholder: "Your Visbot Page ID" }) }),
          field({ label: "Page access token", hint: "needs the leads_retrieval permission",
            input: input("meta_page_token", cfg.page_token_masked, { placeholder: "Paste to set", autocomplete: "off" }) })),
        grid2(
          field({ label: "Lead form IDs", hint: "optional — leave empty to sync every form on the Page",
            input: input("meta_form_ids", cfg.meta_form_ids, { placeholder: "comma separated" }) }),
          field({ label: "Graph API version", input: input("meta_api_version", cfg.meta_api_version) })),
        field({ label: "Webhook verify token", hint: "paste this into Meta when subscribing",
          input: input("meta_verify_token", cfg.meta_verify_token) }),
        h("p.muted", { style: { margin: 0, fontSize: ".82rem" },
          text: "The secret and token are stored in your own PostgreSQL database and are never shown in full again — only the last six characters. Leave a masked field untouched to keep the saved value." }))),
      formFoot(saveBtn, h("span.spacer"), (() => {
        const btn = h("button.btn.btn--ghost", { type: "button", text: "New verify token" });
        btn.addEventListener("click", () => withBusy(btn, async () => {
          try {
            const r = await api.post("/meta/verify-token");
            toast(r.message || "New token generated.");
            ctx.reload();
          } catch (e) { toast(e.message, "err"); }
        }));
        return btn;
      })()));

    credForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await withBusy(saveBtn, async () => {
        try {
          const r = await api.put("/meta", formData(credForm));
          toast(r.message || "Saved.");
          ctx.reload();
        } catch (err) { toast(err.message, "err"); }
      });
    });

    // ---- actions ----
    const resultBox = h("div");

    const testBtn = h("button.btn.btn--ghost", { type: "button" }, icon("globe"), "Test connection & list lead forms");
    testBtn.addEventListener("click", () => withBusy(testBtn, async () => {
      resultBox.replaceChildren();
      try {
        const r = await api.post("/meta/test");
        const forms = r.data.forms || [];
        resultBox.append(h("div.flash", { style: { display: "block" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: ".6rem" } },
            icon("check"), h("span", { text: `Connected to “${r.data.page.name}”` })),
          h("ul", { style: { margin: ".6rem 0 0 1.6rem", fontWeight: "500" } },
            forms.length
              ? forms.map((f) => h("li", { text: `${f.name || "(unnamed form)"} — id ${f.id}` +
                  (f.leads_count !== undefined ? `, ${f.leads_count} leads` : "") }))
              : h("li", { text: r.data.forms_error
                  ? "Could not list lead forms: " + r.data.forms_error
                  : "No lead forms found on this Page yet." }))));
      } catch (e) {
        resultBox.append(h("div.flash.flash--err",
          icon("alert"), h("span", { text: e.message })));
      }
    }));

    const daysSel = select("days", [
      { value: "7", label: "7 days" }, { value: "30", label: "30 days" },
      { value: "90", label: "90 days" }, { value: "365", label: "1 year" }], "30");
    const syncBtn = h("button.btn", { type: "button" }, icon("download"), "Sync leads from Meta");
    syncBtn.addEventListener("click", () => withBusy(syncBtn, async () => {
      try {
        const r = await api.post("/meta/sync", { days: daysSel.value });
        toast(r.message || "Sync finished.");
        ctx.reload();
      } catch (e) { toast(e.message, "err"); }
    }));

    const fileInput = h("input", { type: "file", name: "csv", accept: ".csv,text/csv,text/plain,.tsv" });
    const importBtn = h("button.btn.btn--ghost", { type: "button" }, icon("box"), "Import file");
    importBtn.addEventListener("click", () => withBusy(importBtn, async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return toast("Choose a CSV file exported from Meta first.", "err");
      const fd = new FormData();
      fd.append("csv", f);
      try {
        const r = await api.post("/meta/import", fd);
        toast(r.message || "Import finished.");
        ctx.reload();
      } catch (e) { toast(e.message, "err"); }
    }));

    const actions = panel({
      title: "Bring leads in now", hint: "Works without a public URL",
      body: panelBody(stack(
        resultBox,
        testBtn,
        h("div.inline-form", field({ label: "Fetch last", input: daysSel, style: { maxWidth: "150px" } }), syncBtn),
        h("hr.rule"),
        h("div.inline-form",
          field({ label: "Or import a lead export", hint: "CSV from Ads Manager or Business Suite",
            input: fileInput, style: { flex: "1 1 240px" } }),
          importBtn),
        h("p.muted", { style: { margin: 0, fontSize: ".82rem" },
          text: "Every route de-duplicates on Meta's own lead id, so importing the same file twice, or syncing after a webhook already delivered a lead, never creates a duplicate." }))),
    });

    // ---- setup steps ----
    const code = (t) => h("code", { text: t });
    const steps = panel({
      title: "Set up the live webhook", hint: "So leads arrive within seconds",
      body: panelBody(
        isLocal ? h("div.callout.callout--warn", icon("alert"), h("div",
          h("b", { text: "This server is on localhost, which Meta cannot reach. " }),
          "Use Sync leads from Meta above for now, or expose the backend on a public HTTPS address.")) : null,
        h("ol.steps",
          h("li", h("b", { text: "Create a Meta app" }),
            " at developers.facebook.com → My Apps → Create App → type Business. Add the Webhooks product."),
          h("li", h("b", { text: "Get a Page access token" }), " with ",
            code("leads_retrieval"), ", ", code("pages_show_list"), ", ",
            code("pages_read_engagement"), " and ", code("pages_manage_metadata"),
            " for the Visbot Page, then paste it above with the App Secret and Page ID."),
          h("li", h("b", { text: "Subscribe the webhook." }),
            " In your app → Webhooks → Page, use:",
            h("div.kv-code",
              h("span", { text: "Callback URL" }), code(webhookUrl),
              h("span", { text: "Verify token" }), code(cfg.meta_verify_token)),
            "Then subscribe to the ", code("leadgen"), " field."),
          h("li", h("b", { text: "Connect the Page to the app" }),
            " so deliveries actually start — the step people usually miss:",
            h("div.code-block", h("code", { text:
              `POST https://graph.facebook.com/${cfg.meta_api_version}/${cfg.meta_page_id || "{PAGE_ID}"}/subscribed_apps\n  ?subscribed_fields=leadgen\n  &access_token={PAGE_ACCESS_TOKEN}` }))),
          h("li", h("b", { text: "Test it." }),
            " Use Meta's Lead Ads Testing Tool to submit a test lead, then open ",
            h("a", { href: "/leads", text: "All leads" }), ". Every attempt is recorded in the delivery log."))),
    });

    // ---- right column ----
    const status = panel({
      title: "Status",
      body: panelBody(h("dl.kv",
        h("dt", { text: "App Secret" }),
        h("dd", cfg.has_app_secret ? chip("Saved", "ok") : chip("Missing", "warn")),
        h("dt", { text: "Page token" }),
        h("dd", cfg.has_page_token ? chip("Saved", "ok") : chip("Missing", "warn")),
        h("dt", { text: "Page ID" }), h("dd", { text: cfg.meta_page_id || "—" }),
        h("dt", { text: "Forms" }), h("dd", { text: cfg.meta_form_ids || "All forms on the Page" }),
        h("dt", { text: "API version" }), h("dd", { text: cfg.meta_api_version }),
        h("dt", { text: "Webhook URL" }),
        h("dd", { style: { fontSize: ".8rem" }, text: webhookUrl }))),
    });

    const campaignPanel = campaigns.length
      ? panel({ title: "Leads by campaign",
          body: panelBody(bars(campaigns.map((c) => ({
            label: c.name, n: c.n, href: "/leads?q=" + encodeURIComponent(c.name),
          })))) })
      : null;

    const logPanel = panel({
      title: "Delivery log", chipText: String(logs.length),
      body: panelBody(logs.length
        ? h("ol.timeline", logs.map((g) => h("li.tl-item.tl-" +
            (g.status === "error" ? "status" : g.status === "warn" ? "followup" : "call"),
            h("span.tl-dot", icon(g.status === "ok" ? "check" : "alert")),
            h("div.tl-body",
              h("p", h("b", { text: g.event }), g.detail ? " — " + g.detail : ""),
              h("time", { title: fmtDateTime(g.created_at), text: ago(g.created_at) })))))
        : h("p.muted", { style: { margin: 0 },
            text: "Nothing logged yet. Connection tests, syncs, imports and webhook deliveries all appear here." })),
    });

    const mapping = panel({
      title: "How fields are matched",
      body: panelBody(
        h("p.muted", { style: { margin: "0 0 .7rem", fontSize: ".86rem" },
          text: "Standard lead-form questions map automatically:" }),
        h("dl.kv", { style: { fontSize: ".84rem" } },
          h("dt", { text: "Name" }), h("dd", { text: "full_name, or first + last name" }),
          h("dt", { text: "Phone" }), h("dd", { text: "phone_number" }),
          h("dt", { text: "Email" }), h("dd", { text: "email" }),
          h("dt", { text: "City / State" }), h("dd", { text: "city, state or province" }),
          h("dt", { text: "Company" }), h("dd", { text: "company_name" }),
          h("dt", { text: "Interested in" }),
          h("dd", { text: "any custom question mentioning machine, product, requirement or enquiry" })),
        h("p.muted", { style: { margin: ".7rem 0 0", fontSize: ".82rem" },
          text: "Any other answer is kept in the lead's message with its question, so nothing a customer typed is lost." })),
    });

    return frag(cards, h("div.cols",
      h("div", panel({ title: "Credentials", hint: "From your Meta app and Facebook Page", body: credForm }), actions, steps),
      h("div", status, campaignPanel, logPanel, mapping)));
  },
};

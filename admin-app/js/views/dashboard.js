import { api } from "../api.js";
import {
  h, frag, icon, chip, panel, panelBody, statCard, bars, table,
  emptyState, skelCards, skelPanel,
} from "../ui.js";
import { ago, fmtDateTime, daysUntil, dueLabel } from "../fmt.js";
import { statusMeta, sourceLabel, STATUSES } from "../vocab.js";

export const dashboard = {
  title: "Lead dashboard",
  subtitle: "Enquiries from the website, Meta ads, phone and IndiaMART in one pipeline",
  nav: "dashboard",
  skeleton: () => frag(skelCards(5), h("div.cols", skelPanel(), skelPanel())),
  load: () => api.get("/dashboard"),

  render({ data }) {
    const { stats, byStatus, bySource, topInterest, recent, dueSoon, service } = data;

    const cards = h("div.stats",
      statCard({ value: stats.new_count, caption: "New, not yet contacted", iconName: "spark",
                 href: "/leads?status=new", variant: stats.new_count ? "accent" : null }),
      statCard({ value: stats.open_count, caption: "Open in pipeline", iconName: "pipeline", href: "/leads?open=1" }),
      statCard({ value: stats.due_count, caption: "Follow-ups due", iconName: "clock",
                 href: "/leads?due=1", variant: stats.due_count ? "danger" : null }),
      statCard({ value: stats.week_count, caption: "New in last 7 days", iconName: "calendar", href: "/leads" }),
      statCard({ value: stats.won_count, caption: "Won, all time", iconName: "check", href: "/leads?status=won" }),
      statCard({ value: service ? service.total : 0, caption: "Service requests",
                 iconName: "wrench", href: "/service" }));

    if (!stats.total) {
      return frag(cards, panel({
        body: emptyState({
          iconName: "users",
          title: "No leads yet",
          text: "Website enquiries and Meta lead-ad submissions arrive here automatically. You can also add leads by hand for phone calls, IndiaMART enquiries and factory walk-ins.",
          action: h("div.actions-grid", { style: { maxWidth: "520px", margin: "1.2rem auto 0" } },
            h("a.action-card", { href: "/leads/new" }, icon("plus"), "Add a lead manually"),
            h("a.action-card", { href: "/integrations/meta" }, icon("spark"), "Connect Meta lead ads")),
        }),
      }));
    }

    const closed = stats.won_count + stats.lost_count;

    const pipeline = panel({
      title: "Pipeline",
      hint: stats.total + " leads in total",
      actions: [h("a.btn.btn--ghost.btn--sm", { href: "/leads" }, "All leads", icon("arrow"))],
      body: panelBody(
        bars(STATUSES.map((s) => ({
          label: s.label, n: byStatus[s.key] || 0, href: "/leads?status=" + s.key,
        }))),
        closed ? h("p.muted", { style: { margin: "1.1rem 0 0", fontSize: ".85rem" } },
          `Closed ${closed} leads so far — `,
          h("b", { style: { color: "var(--ok)" }, text: Math.round((stats.won_count / closed) * 100) + "% won" }),
          ".") : null),
    });

    const followups = panel({
      title: "Follow-ups",
      chipText: stats.due_count ? stats.due_count + " due" : null,
      chipVariant: "warn",
      body: panelBody(
        dueSoon.length
          ? h("div.list-links", dueSoon.map((l) => {
              const d = daysUntil(l.next_followup);
              return h("a", { href: "/leads/" + l.id },
                icon(d < 0 ? "alert" : "clock"),
                h("span", { text: l.name + (l.interest ? " · " + l.interest : "") }),
                chip(dueLabel(l.next_followup), d < 0 ? "warn" : "muted"));
            }))
          : h("p.muted", { style: { margin: 0 },
              text: "Nothing due in the next three days. Set a follow-up date on a lead to see it here." })),
    });

    const latest = panel({
      title: "Latest enquiries",
      actions: [h("a.btn.btn--ghost.btn--sm", { href: "/leads" }, "View all", icon("arrow"))],
      body: table({
        head: ["Lead", "Interested in", "Status", "Received"],
        rows: recent.map((l) => {
          const sm = statusMeta(l.status);
          return h("tr",
            h("td",
              h("a.name", { href: "/leads/" + l.id, text: l.name }),
              (l.city || l.state)
                ? h("div.sub", { text: [l.city, l.state].filter(Boolean).join(", ") })
                : null),
            h("td.sub", { text: l.interest || "—" }),
            h("td", chip(sm.label, sm.chip || "plain")),
            h("td.sub.nowrap", { title: fmtDateTime(l.created_at), text: ago(l.created_at) }));
        }),
      }),
    });

    const sources = panel({
      title: "Where leads come from",
      body: panelBody(
        bars(bySource.map((s) => ({
          label: sourceLabel(s.source), n: s.n, href: "/leads?source=" + s.source,
        }))),
        topInterest.length ? frag(
          h("h3", { style: { fontSize: ".82rem", textTransform: "uppercase", letterSpacing: ".09em",
                             color: "var(--muted)", margin: "1.4rem 0 .7rem" }, text: "Most asked about" }),
          bars(topInterest.map((t) => ({
            label: t.interest, n: t.n, href: "/leads?q=" + encodeURIComponent(t.interest),
          })))) : null),
    });

    const quick = panel({
      title: "Quick actions",
      body: panelBody(h("div.actions-grid",
        h("a.action-card", { href: "/leads/new" }, icon("plus"), "Add a lead"),
        h("a.action-card", { href: "/leads?due=1" }, icon("clock"), "Today's follow-ups"),
        h("a.action-card", { href: "/api/admin/leads/export.csv", target: "_blank" }, icon("download"), "Export leads to CSV"),
        h("a.action-card", { href: "/website" }, icon("globe"), "Manage website content"))),
    });

    return frag(cards, h("div.cols", pipeline, followups), h("div.cols", latest, sources), quick);
  },
};

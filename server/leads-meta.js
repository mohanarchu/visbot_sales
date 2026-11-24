// Shared vocabulary for lead management, used by routes and views.

const STATUSES = [
  { key: "new",         label: "New",         chip: "info",  icon: "spark" },
  { key: "contacted",   label: "Contacted",   chip: "",      icon: "phone" },
  { key: "quoted",      label: "Quoted",      chip: "warn",  icon: "tag" },
  { key: "negotiating", label: "Negotiating", chip: "warn",  icon: "chat" },
  { key: "won",         label: "Won",         chip: "ok",    icon: "check" },
  { key: "lost",        label: "Lost",        chip: "muted", icon: "close" },
];

// Statuses that still count as live pipeline.
const OPEN_STATUSES = ["new", "contacted", "quoted", "negotiating"];

const SOURCES = [
  { key: "facebook",   label: "Facebook lead ad" },
  { key: "instagram",  label: "Instagram lead ad" },
  { key: "meta",       label: "Meta lead ad" },
  { key: "website",    label: "Website form" },
  { key: "app",        label: "Mobile app" },
  { key: "whatsapp",   label: "WhatsApp" },
  { key: "phone",      label: "Phone call" },
  { key: "indiamart",  label: "IndiaMART" },
  { key: "referral",   label: "Referral" },
  { key: "exhibition", label: "Exhibition" },
  { key: "walk-in",    label: "Factory walk-in" },
  { key: "other",      label: "Other" },
];

const PRIORITIES = [
  { key: "high",   label: "High",   chip: "warn" },
  { key: "medium", label: "Medium", chip: "muted" },
  { key: "low",    label: "Low",    chip: "muted" },
];

const statusMeta = (key) => STATUSES.find((s) => s.key === key) || { key, label: key, chip: "muted" };
const sourceLabel = (key) => (SOURCES.find((s) => s.key === key) || { label: key }).label;
const priorityMeta = (key) => PRIORITIES.find((p) => p.key === key) || { key, label: key, chip: "muted" };

const isStatus = (key) => STATUSES.some((s) => s.key === key);
const isSource = (key) => SOURCES.some((s) => s.key === key);
const isPriority = (key) => PRIORITIES.some((p) => p.key === key);

module.exports = {
  STATUSES, OPEN_STATUSES, SOURCES, PRIORITIES,
  statusMeta, sourceLabel, priorityMeta,
  isStatus, isSource, isPriority,
};

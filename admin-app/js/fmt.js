// Client-side copies of the server's formatters, so dates read the same.

// A bare "YYYY-MM-DD" is a calendar day: parse it in local time, because
// new Date("2026-11-25") is UTC midnight and can land on the previous day.
export function parseDate(v) {
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(v);
}

export function fmtDate(d) {
  if (!d) return "";
  return parseDate(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    ", " + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function ago(d) {
  if (!d) return "";
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hrs / 24);
  if (days < 31) return days + (days === 1 ? " day ago" : " days ago");
  const months = Math.floor(days / 30);
  if (months < 12) return months + (months === 1 ? " month ago" : " months ago");
  const years = Math.floor(days / 365);
  return years + (years === 1 ? " year ago" : " years ago");
}

export function daysUntil(d) {
  if (!d) return null;
  const target = parseDate(d); target.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function dueLabel(d) {
  const n = daysUntil(d);
  if (n === null) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "1 day overdue";
  if (n < 0) return Math.abs(n) + " days overdue";
  return "In " + n + " days";
}

export function dateInput(d) {
  if (!d) return "";
  const dt = parseDate(d);
  const p = (n) => String(n).padStart(2, "0");
  return dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate());
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0] || "").join("").toUpperCase() || "?";
}

export function waNumber(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 13 && d.startsWith("091")) return d.slice(1);
  return d.length >= 10 ? d : "";
}

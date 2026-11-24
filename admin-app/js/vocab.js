// Lead statuses, sources and priorities come from the server once at boot, so
// the client never keeps its own copy of the list out of step.
import { api } from "./api.js";

export const STATUSES = [];
export const SOURCES = [];
export const PRIORITIES = [];
export const ROLES = [];

export async function loadVocab() {
  const { data } = await api.get("/vocab");
  STATUSES.length = 0; STATUSES.push(...data.statuses);
  SOURCES.length = 0; SOURCES.push(...data.sources);
  PRIORITIES.length = 0; PRIORITIES.push(...data.priorities);
  ROLES.length = 0; ROLES.push(...(data.roles || []));
}

export const roleMeta = (key) =>
  ROLES.find((r) => r.key === key) || { key, label: key, blurb: "" };

export const roleOptions = () => ROLES.map((r) => ({ value: r.key, label: r.label }));

export const statusMeta = (key) =>
  STATUSES.find((s) => s.key === key) || { key, label: key, chip: "muted" };

export const sourceLabel = (key) =>
  (SOURCES.find((s) => s.key === key) || { label: key }).label;

export const priorityMeta = (key) =>
  PRIORITIES.find((p) => p.key === key) || { key, label: key, chip: "muted" };

export const statusOptions = () => STATUSES.map((s) => ({ value: s.key, label: s.label }));
export const sourceOptions = () => SOURCES.map((s) => ({ value: s.key, label: s.label }));
export const priorityOptions = () => PRIORITIES.map((p) => ({ value: p.key, label: p.label }));

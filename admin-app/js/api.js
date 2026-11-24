// Thin REST client for /api/admin. Throws ApiError so views can show the
// server's own message rather than a generic failure.
const BASE = "/api/admin";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, body, opts = {}) {
  const init = {
    method,
    headers: {},
    credentials: "same-origin",
  };
  if (method !== "GET") init.headers["X-Requested-With"] = "visbot-admin";

  if (body instanceof FormData) {
    init.body = body; // the browser sets the multipart boundary
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }

  if (res.status === 401 && !opts.allow401) {
    onUnauthorized();
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    const msg = payload && payload.error && payload.error.message;
    throw new ApiError(msg || `Request failed (${res.status}).`, res.status);
  }
  return payload || {};
}

const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined && v !== false) sp.set(k, v);
  });
  const s = sp.toString();
  return s ? "?" + s : "";
};

export const api = {
  get: (path, params) => request("GET", path + qs(params)),
  post: (path, body) => request("POST", path, body === undefined ? {} : body),
  put: (path, body) => request("PUT", path, body),
  del: (path) => request("DELETE", path),

  session: () => request("GET", "/session", undefined, { allow401: true }),
  // `identifier` is a mobile number or an email address.
  login: (identifier, password) =>
    request("POST", "/login", { identifier, password }, { allow401: true }),
  logout: () => request("POST", "/logout"),
};

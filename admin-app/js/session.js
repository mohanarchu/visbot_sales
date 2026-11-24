// Who is signed in, and what they are allowed to reach.
//
// The server decides this on every request; what is held here only shapes the
// menu and hides controls that would be refused anyway. Nothing is trusted
// because it is in this file.
let user = null;

export function setUser(u) { user = u || null; }
export function currentUser() { return user; }

// `can` mirrors the role table in server/users.js, which the server sends with
// the session so the two can never drift apart.
export function can(area) {
  return !!(user && user.can && user.can[area] === true);
}

export const isEnvAdmin = () => !!(user && user.env);
export const myId = () => (user ? user.id : null);

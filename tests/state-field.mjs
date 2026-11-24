// The state control on the admin's lead form: it has to be a dropdown of the
// real list, with the right one already chosen, and it must never quietly
// change a state already on the lead.
//
//   node tests/state-field.mjs
import { install } from "./dom-shim.mjs";
install();

const { stateField } = await import("../admin-app/js/views/leads.js");

const STATES = [
  { id: 23, name: "Tamil Nadu", code: "TN", kind: "state" },
  { id: 12, name: "Kerala", code: "KL", kind: "state" },
  { id: 11, name: "Karnataka", code: "KA", kind: "state" },
  { id: 36, name: "Puducherry", code: "PY", kind: "union territory" },
];

let fails = 0;
const check = (name, cond, extra = "") => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (cond ? "" : "   " + extra));
  if (!cond) fails++;
};
const options = (el) => el.findAll("option").map((o) => o.getAttribute("value"));
const labels = (el) => el.findAll("option").map((o) => o.textContent);

console.log("\nadding a lead");
{
  const el = stateField(STATES, null);
  check("it is a dropdown, not a text box", el.tagName === "SELECT", el.tagName);
  check("it is still named state, so the form posts the same field",
    el.getAttribute("name") === "state");
  check("every state is offered", options(el).length === STATES.length + 1, String(options(el).length));
  check("the first choice is leaving it blank", options(el)[0] === "");
  check("nothing is chosen to begin with", el.selectedValue === "" || el.selectedValue === null);
  check("union territories are in the list too", options(el).includes("Puducherry"));
}

console.log("\nediting a lead");
{
  const el = stateField(STATES, "Tamil Nadu");
  check("the lead's state is the one chosen", el.selectedValue === "Tamil Nadu", String(el.selectedValue));
}
{
  // What the website form and the Meta import actually put in the column.
  const el = stateField(STATES, "tamilnadu");
  check("a jammed-together spelling still lands on Tamil Nadu",
    el.selectedValue === "Tamil Nadu", String(el.selectedValue));
}
{
  const el = stateField(STATES, "TN");
  check("a code lands on it as well", el.selectedValue === "Tamil Nadu", String(el.selectedValue));
}
{
  const el = stateField(STATES, "  KERALA ");
  check("case and spaces do not matter", el.selectedValue === "Kerala", String(el.selectedValue));
}

console.log("\na state nobody recognises");
{
  const el = stateField(STATES, "Atlantis");
  check("it is kept rather than dropped", options(el).includes("Atlantis"));
  check("and it is the one chosen", el.selectedValue === "Atlantis", String(el.selectedValue));
  check("it says plainly that it is not a known state",
    labels(el).some((t) => t.includes("not a state we know")), labels(el).join(" | "));
  check("the real states are still there as well", options(el).includes("Kerala"));
}

console.log("\nwhen the list could not be loaded");
{
  const el = stateField([], "Tamil Nadu");
  check("it falls back to a text box rather than an empty dropdown",
    el.tagName === "INPUT", el.tagName);
  check("still named state", el.getAttribute("name") === "state");
  check("and keeps what was there", el.getAttribute("value") === "Tamil Nadu");
  const empty = stateField(null, null);
  check("a missing list does not throw", empty.tagName === "INPUT");
}

console.log("\n" + (fails ? fails + " FAILURE(S)" : "all checks passed"));
process.exit(fails ? 1 : 0);

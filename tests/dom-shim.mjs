// Just enough DOM to build and inspect the admin panel's form controls in node.
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); this.sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this.sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    this.sync();
    return on;
  }
  sync() { this.el._class = [...this.set].join(" "); }
}

class Node {
  constructor(tag) {
    this.tagName = (tag || "").toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this._text = "";
    this._class = "";
    this.classList = new ClassList(this);
  }
  get className() { return this._class; }
  set className(v) {
    this._class = v;
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() { return this._text || this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this._text = String(v); this.children = []; }
  set innerHTML(v) { this._text = String(v).replace(/<[^>]*>/g, ""); }
  get firstChild() { return this.children[0] || null; }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === "SELECT") {
      const opt = this.findAll("option").find((o) => o.selected);
      return opt ? (opt.getAttribute("value") || "") : "";
    }
    const v = this.getAttribute("value");
    return v === null ? "" : v;
  }
  set value(v) {
    this._value = v == null ? "" : String(v);
    if (this.tagName === "SELECT") {
      this.findAll("option").forEach((o) => {
        o.selected = String(o.getAttribute("value")) === this._value;
      });
    }
  }
  append(...kids) {
    for (const k of kids.flat()) {
      if (k === null || k === undefined || k === false) continue;
      if (typeof k === "string") { this._text += k; continue; }
      if (k.nodeType === 11) { this.append(...k.children); continue; }
      k.parentNode = this;
      this.children.push(k);
    }
  }
  appendChild(k) { this.append(k); return k; }
  removeChild(k) { this.children = this.children.filter((c) => c !== k); k.parentNode = null; return k; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatch(type, ev = {}) {
    const e = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...ev };
    (this.listeners[type] || []).forEach((fn) => fn.call(this, e));
    return e;
  }
  focus() { document.activeElement = this; }
  querySelectorAll() { return []; }
  find(cls) {
    if (this.classList.contains(cls)) return this;
    for (const c of this.children) {
      const hit = c.find && c.find(cls);
      if (hit) return hit;
    }
    return null;
  }
  findAll(tag, out = []) {
    if (this.tagName === tag.toUpperCase()) out.push(this);
    this.children.forEach((c) => c.findAll && c.findAll(tag, out));
    return out;
  }
  // For a <select>: the option marked selected, as a value.
  get selectedValue() {
    const opt = this.findAll("option").find((o) => o.selected);
    return opt ? opt.getAttribute("value") : null;
  }
}

class Fragment extends Node {
  constructor() { super("#fragment"); this.nodeType = 11; }
}

const docListeners = {};

export const document = {
  activeElement: null,
  createElement: (tag) => new Node(tag),
  createElementNS: (ns, tag) => new Node(tag),
  createDocumentFragment: () => new Fragment(),
  createTextNode: (t) => { const n = new Node("#text"); n.nodeType = 3; n._text = t; return n; },
  addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
  removeEventListener: (type, fn) => {
    docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn);
  },
  dispatch: (type, ev = {}) => {
    const e = { type, preventDefault() { this.defaultPrevented = true; }, ...ev };
    [...(docListeners[type] || [])].forEach((fn) => fn(e));
    return e;
  },
  listenerCount: (type) => (docListeners[type] || []).length,
  getElementById: () => null,
  body: null,
};

document.body = new Node("body");

export function install() {
  globalThis.document = document;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.window = { confirm: () => { throw new Error("window.confirm must not be used"); } };
}

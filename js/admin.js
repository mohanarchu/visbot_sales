/* Visbot admin panel — progressive enhancements (no dependencies). */
(function () {
  "use strict";

  var SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  var ICO_TRASH = '<svg class="ico" ' + SVG + '><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  var ICO_PLUS = '<svg class="ico" ' + SVG + '><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

  /* ---------- sidebar (mobile) ------------------------------------------ */
  var burger = document.getElementById("burger");
  var scrim = document.getElementById("scrim");
  function closeNav() { document.body.classList.remove("nav-open"); }
  if (burger) burger.addEventListener("click", function () { document.body.classList.toggle("nav-open"); });
  if (scrim) scrim.addEventListener("click", closeNav);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeNav(); });

  /* ---------- flash messages ------------------------------------------- */
  document.querySelectorAll(".flash").forEach(function (el) {
    var x = el.querySelector("button");
    function hide() { el.style.opacity = "0"; setTimeout(function () { el.remove(); }, 320); }
    if (x) x.addEventListener("click", hide);
    setTimeout(hide, 5000);
  });

  /* ---------- confirmations -------------------------------------------- */
  /* An overlay, matching the single-page panel, instead of window.confirm.
     Used for deletions and for anything else worth a second look, such as
     moving a lead to another status. */
  function confirmOverlay(message, onYes, opts) {
    opts = opts || {};
    var danger = opts.danger !== false;

    var scrim = document.createElement("div");
    scrim.className = "modal-scrim";

    var box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    var title = document.createElement("h2");
    title.textContent = opts.title || "Are you sure?";
    var text = document.createElement("p");
    text.textContent = message;

    var foot = document.createElement("div");
    foot.className = "modal-foot";
    var cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn btn--ghost"; cancel.textContent = "Cancel";
    var go = document.createElement("button");
    go.type = "button"; go.className = "btn" + (danger ? " btn--danger" : "");
    if (danger) {
      go.innerHTML = ICO_TRASH + " " + (opts.confirmText || "Delete");
    } else {
      go.textContent = opts.confirmText || "Yes, go ahead";
    }
    foot.appendChild(cancel); foot.appendChild(go);

    box.appendChild(title); box.appendChild(text); box.appendChild(foot);
    scrim.appendChild(box);

    var previous = document.activeElement;
    function close() {
      document.removeEventListener("keydown", onKey, true);
      scrim.classList.remove("is-open");
      setTimeout(function () { scrim.remove(); }, 150);
      if (previous && previous.focus) previous.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Enter" && document.activeElement !== cancel) { e.preventDefault(); close(); onYes(); }
    }
    cancel.addEventListener("click", close);
    go.addEventListener("click", function () { close(); onYes(); });
    scrim.addEventListener("mousedown", function (e) { if (e.target === scrim) close(); });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(scrim);
    requestAnimationFrame(function () { scrim.classList.add("is-open"); });
    go.focus();
  }

  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    var confirmed = false;
    form.addEventListener("submit", function (e) {
      if (confirmed) return;
      e.preventDefault();
      // A form carrying its own title and button label is not a deletion.
      var title = form.getAttribute("data-confirm-title");
      var okText = form.getAttribute("data-confirm-ok");
      confirmOverlay(form.getAttribute("data-confirm"), function () {
        confirmed = true;
        form.submit();
      }, { title: title, confirmText: okText, danger: !okText });
    });
  });

  /* ---------- table search / filter ------------------------------------ */
  document.querySelectorAll("table[data-filterable]").forEach(function (table) {
    if (!table.id || !table.tBodies.length) return;
    var controls = Array.prototype.slice.call(document.querySelectorAll('[data-table="#' + table.id + '"]'));
    var rows = Array.prototype.slice.call(table.tBodies[0].rows);
    var countEl = table.dataset.countInto ? document.querySelector(table.dataset.countInto) : null;
    var emptyEl = table.dataset.emptyInto ? document.querySelector(table.dataset.emptyInto) : null;

    function run() {
      var shown = 0;
      rows.forEach(function (row) {
        var ok = true;
        controls.forEach(function (c) {
          var v = (c.value || "").trim().toLowerCase();
          if (!v) return;
          if (c.dataset.mode === "key") {
            ok = ok && (row.dataset[c.dataset.key] || "").toLowerCase() === v;
          } else {
            ok = ok && row.textContent.toLowerCase().indexOf(v) !== -1;
          }
        });
        row.hidden = !ok;
        if (ok) shown++;
      });
      if (countEl) countEl.textContent = shown === rows.length ? rows.length + " items" : shown + " of " + rows.length;
      if (emptyEl) emptyEl.hidden = shown > 0;
    }

    controls.forEach(function (c) { c.addEventListener("input", run); c.addEventListener("change", run); });
    run();
  });

  /* ---------- image preview -------------------------------------------- */
  document.querySelectorAll("[data-img-pick]").forEach(function (box) {
    var select = box.querySelector("select");
    var file = box.querySelector('input[type="file"]');
    var img = box.querySelector(".img-prev-box img");
    var ph = box.querySelector(".img-prev-box .ph");
    if (!img) return;

    function show(src) {
      if (src) { img.src = src; img.hidden = false; if (ph) ph.hidden = true; }
      else { img.removeAttribute("src"); img.hidden = true; if (ph) ph.hidden = false; }
    }
    if (select) {
      select.addEventListener("change", function () {
        show(select.value ? "/assets/products/" + select.value : "");
      });
    }
    if (file) {
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (f) show(URL.createObjectURL(f));
      });
    }
  });

  /* ---------- "Label | Value" row editor ------------------------------- */
  document.querySelectorAll("textarea[data-pairs]").forEach(function (ta) {
    var keyPh = ta.dataset.keyPlaceholder || "Label";
    var valPh = ta.dataset.valuePlaceholder || "Value";

    var wrap = document.createElement("div");
    var rows = document.createElement("div");
    rows.className = "pairs";
    wrap.appendChild(rows);

    function parse(text) {
      return (text || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
        var i = l.indexOf("|");
        return i === -1 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      });
    }

    function sync() {
      var lines = [];
      rows.querySelectorAll(".pair").forEach(function (row) {
        var inputs = row.querySelectorAll("input");
        var k = inputs[0].value.trim().replace(/\|/g, "/");
        var v = inputs[1].value.trim();
        if (k || v) lines.push(v ? k + " | " + v : k);
      });
      ta.value = lines.join("\n");
    }

    function addRow(k, v) {
      var row = document.createElement("div");
      row.className = "pair";
      var a = document.createElement("input");
      a.type = "text"; a.value = k || ""; a.placeholder = keyPh;
      var b = document.createElement("input");
      b.type = "text"; b.value = v || ""; b.placeholder = valPh;
      var del = document.createElement("button");
      del.type = "button"; del.className = "btn btn--ghost btn--icon";
      del.title = "Remove row"; del.setAttribute("aria-label", "Remove row");
      del.innerHTML = ICO_TRASH;
      del.addEventListener("click", function () {
        row.remove();
        if (!rows.children.length) addRow("", "");
        sync();
      });
      a.addEventListener("input", sync);
      b.addEventListener("input", sync);
      row.appendChild(a); row.appendChild(b); row.appendChild(del);
      rows.appendChild(row);
      return row;
    }

    function rebuild() {
      rows.innerHTML = "";
      parse(ta.value).forEach(function (p) { addRow(p[0], p[1]); });
      if (!rows.children.length) addRow("", "");
    }

    var foot = document.createElement("div");
    foot.className = "pairs-foot";
    var add = document.createElement("button");
    add.type = "button"; add.className = "btn btn--ghost btn--sm";
    add.innerHTML = ICO_PLUS + " Add row";
    add.addEventListener("click", function () {
      var row = addRow("", "");
      row.querySelector("input").focus();
      sync();
    });
    var raw = document.createElement("button");
    raw.type = "button"; raw.className = "btn btn--ghost btn--sm";
    raw.textContent = "Edit as text";
    raw.addEventListener("click", function () {
      var showing = ta.classList.toggle("is-shown");
      raw.textContent = showing ? "Back to row editor" : "Edit as text";
      rows.hidden = showing;
      add.hidden = showing;
      if (showing) ta.focus();
      else rebuild();
    });
    foot.appendChild(add); foot.appendChild(raw);
    wrap.appendChild(foot);

    ta.classList.add("pairs-raw");
    ta.parentNode.insertBefore(wrap, ta);
    wrap.appendChild(ta);
    rebuild();
  });

  /* ---------- line counters -------------------------------------------- */
  document.querySelectorAll("textarea[data-count]").forEach(function (ta) {
    var out = document.createElement("span");
    out.className = "counter";
    ta.parentNode.appendChild(out);
    function run() {
      var n = ta.value.split("\n").filter(function (l) { return l.trim(); }).length;
      out.textContent = n + " " + (n === 1 ? ta.dataset.count : ta.dataset.count + "s");
    }
    ta.addEventListener("input", run);
    run();
  });

  /* ---------- slug suggestion for new records -------------------------- */
  document.querySelectorAll("form[data-new]").forEach(function (form) {
    var name = form.querySelector('input[name="name"]');
    var slug = form.querySelector('input[name="slug"]');
    if (!name || !slug) return;
    var touched = false;
    slug.addEventListener("input", function () { touched = true; });
    name.addEventListener("input", function () {
      if (touched) return;
      slug.value = name.value.toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    });
  });
})();

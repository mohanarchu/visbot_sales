// Visbot Industries — shared behaviour
(function () {
  var WA_NUMBER = "918072398966"; // Visbot sales & technical support
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.documentElement.classList.add("js");

  // Mobile navigation
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // Enquiry form. The enquiry is recorded as a lead in the admin panel and the
  // visitor stays on the page with a confirmation and a reference number. There
  // is no WhatsApp hand-over: the submission itself is what reaches the office,
  // so an enquiry can no longer be lost because a message was never sent.
  var form = document.querySelector("form.enquiry");
  if (form) {
    // An "Enquire" button elsewhere on the site arrives as ?interest=<machine>.
    // The machine list is fixed, so anything that is not already an option is
    // added as one and selected: the visitor sees what they are enquiring
    // about, and it reaches the lead as its "interested in" value.
    var wanted = "";
    try {
      wanted = (new URLSearchParams(window.location.search).get("interest") || "").trim();
    } catch (err) { wanted = ""; }
    var machineSel = form.querySelector("#f-machine");
    if (wanted && machineSel && machineSel.options) {
      var found = false;
      for (var i = 0; i < machineSel.options.length; i++) {
        if (machineSel.options[i].text.toLowerCase() === wanted.toLowerCase()) {
          machineSel.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found) {
        var opt = document.createElement("option");
        opt.text = wanted.slice(0, 160);
        machineSel.add(opt, 0);
        machineSel.selectedIndex = 0;
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var get = function (id) {
        var el = form.querySelector("#" + id);
        return el ? el.value.trim() : "";
      };
      var name = get("f-name");
      var phone = get("f-phone");
      var email = get("f-email");
      var state = get("f-state");
      var machine = get("f-machine");
      var msg = get("f-msg");

      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Sending\u2026"; }

      var esc = function (s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      };

      var prev = form.parentNode.querySelector(".form-done");
      if (prev) prev.parentNode.removeChild(prev);

      var done = function (ok, ref) {
        var box = document.createElement("div");
        box.className = "form-done" + (ok ? "" : " form-done--warn");
        box.setAttribute("role", "status");
        box.innerHTML = ok
          ? "<b>Enquiry received" + (ref ? " \u2014 reference #" + esc(ref) : "") + ".</b> " +
            "Our sales team will call you on <b>" + esc(phone) + "</b>. " +
            "You do not need to send anything else."
          : "<b>We could not record your enquiry just now.</b> " +
            "Please call <b>+91 80723 98966</b> or write to " +
            "<b>visbotindustries@gmail.com</b> and we will pick it up straight away.";
        form.parentNode.insertBefore(box, form);
        if (ok) {
          form.reset();
          // Held until they start filling it in again, so the confirmation is
          // not immediately undone by a double click, but a second enquiry
          // about a different machine is still possible.
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Enquiry sent";
            var revive = function () {
              form.removeEventListener("input", revive);
              btn.disabled = false;
              btn.textContent = label;
            };
            form.addEventListener("input", revive);
          }
        } else if (btn) {
          btn.disabled = false;
          btn.textContent = label;
        }
        box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      };

      var body = new URLSearchParams({
        name: name, phone: phone, email: email, state: state,
        interest: machine, message: msg
      });

      try {
        fetch("/api/enquiry", { method: "POST", keepalive: true, body: body })
          .then(function (r) {
            return r.json().catch(function () { return { ok: r.ok }; });
          })
          .then(function (d) { done(!!(d && d.ok), d && d.id); })
          .catch(function () { done(false); });
      } catch (err) {
        done(false);
      }
    });
  }

  // Service request form. The request is recorded in the service inbox, so the
  // customer stays on the page: no WhatsApp hand-over, just a confirmation with
  // an optional WhatsApp link for sending photos of the fault.
  var svc = document.querySelector("form.service");
  if (svc) {
    svc.addEventListener("submit", function (e) {
      e.preventDefault();
      var get = function (id) {
        var el = svc.querySelector("#" + id);
        return el ? el.value.trim() : "";
      };
      var name = get("s-name");
      var phone = get("s-phone");
      var state = get("s-state");
      var ref = get("s-ref");
      var machine = get("s-machine");
      var issue = get("s-issue");

      var lines = [
        "Hello Visbot Industries, I need service support.",
        "Name: " + name,
        "Phone: " + phone,
        "State: " + state,
        "Invoice / PO number: " + ref
      ];
      if (machine) lines.push("Machine: " + machine);
      if (issue) lines.push("Problem: " + issue);
      var waUrl = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(lines.join("\n"));

      var btn = svc.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

      var esc = function (s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      };

      var done = function (ok) {
        var box = document.createElement("div");
        box.className = "form-done" + (ok ? "" : " form-done--warn");
        box.setAttribute("role", "status");
        box.innerHTML = ok
          ? "<b>Service request received.</b> Our service team will call you back on " +
            esc(phone) + ". Keep invoice <b>" + esc(ref) + "</b> handy for the call." +
            '<a class="form-done-wa" href="' + waUrl + '" target="_blank" rel="noopener">' +
            "Send photos of the fault on WhatsApp</a>"
          : "<b>We could not record the request just now.</b> Please call " +
            "<b>" + esc(svc.getAttribute("data-helpline") || "+91 80723 98966") +
            "</b>, or send us the details on WhatsApp." +
            '<a class="form-done-wa" href="' + waUrl + '" target="_blank" rel="noopener">' +
            "Send the request on WhatsApp</a>";
        svc.parentNode.insertBefore(box, svc);
        if (ok) svc.reset();
        if (btn) { btn.disabled = false; btn.textContent = "Submit service request"; }
        box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      };

      var body = new URLSearchParams({
        name: name, phone: phone, state: state,
        reference: ref, machine: machine, issue: issue
      });

      try {
        fetch("/api/service", { method: "POST", keepalive: true, body: body })
          .then(function (r) { done(r.ok); })
          .catch(function () { done(false); });
      } catch (err) {
        done(false);
      }
    });
  }

  // Scroll progress bar, header shadow, back-to-top
  var prog = document.createElement("div");
  prog.className = "scroll-progress";
  document.body.appendChild(prog);

  var toTop = document.createElement("button");
  toTop.className = "to-top";
  toTop.setAttribute("aria-label", "Back to top");
  toTop.innerHTML = "&uarr;";
  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
  document.body.appendChild(toTop);

  var head = document.querySelector(".site-head");
  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    var y = doc.scrollTop || window.pageYOffset || 0;
    prog.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
    if (head) head.classList.toggle("scrolled", y > 10);
    toTop.classList.toggle("show", y > 600);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Photo lightbox for product images (skip images that are wrapped in links)
  var productImgs = Array.prototype.filter.call(
    document.querySelectorAll(".product .photo img, .detail-photo img"),
    function (img) { return !img.closest("a"); }
  );
  if (productImgs.length) {
    var lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML = '<button class="lb-close" aria-label="Close">&times;</button><img alt="">';
    document.body.appendChild(lb);
    var lbImg = lb.querySelector("img");
    function closeLb() {
      lb.classList.remove("open");
      document.body.style.overflow = "";
    }
    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.classList.contains("lb-close")) closeLb();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLb();
    });
    productImgs.forEach(function (img) {
      img.addEventListener("click", function () {
        lbImg.src = img.src;
        lbImg.alt = img.alt || "";
        lb.classList.add("open");
        document.body.style.overflow = "hidden";
      });
    });
  }

  // Hero image slider: crossfade with dots, autoplay, pause on hover
  var slider = document.querySelector(".hero-slider");
  if (slider) {
    var slides = slider.querySelectorAll(".slide");
    if (slides.length > 1) {
      var current = 0;
      var timer = null;
      var dots = document.createElement("div");
      dots.className = "slider-dots";
      slides.forEach(function (_, i) {
        var b = document.createElement("button");
        b.setAttribute("aria-label", "Show image " + (i + 1));
        if (i === 0) b.classList.add("on");
        b.addEventListener("click", function () {
          show(i);
          restart();
        });
        dots.appendChild(b);
      });
      slider.appendChild(dots);
      var dotBtns = dots.querySelectorAll("button");

      function show(i) {
        slides[current].classList.remove("active");
        dotBtns[current].classList.remove("on");
        current = i;
        slides[current].classList.add("active");
        dotBtns[current].classList.add("on");
      }
      function next() { show((current + 1) % slides.length); }
      function restart() {
        if (reduceMotion) return;
        clearInterval(timer);
        timer = setInterval(next, 4500);
      }
      slider.addEventListener("mouseenter", function () { clearInterval(timer); });
      slider.addEventListener("mouseleave", restart);
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) clearInterval(timer); else restart();
      });
      restart();
    }
  }

  // Hero rotating word
  var rot = document.getElementById("rotator");
  if (rot && !reduceMotion) {
    var words = ["uPVC window machinery", "cutting machines", "welding machines", "copy routers", "finishing tools"];
    var wi = 0;
    setInterval(function () {
      rot.classList.add("swap");
      setTimeout(function () {
        wi = (wi + 1) % words.length;
        rot.textContent = words[wi];
        rot.classList.remove("swap");
      }, 300);
    }, 3200);
  }

  if (reduceMotion || !("IntersectionObserver" in window)) return;

  // Scroll reveal with per-row stagger
  var revealTargets = document.querySelectorAll(
    ".section .grid > *, .setup-banner, .addr-card, .cat-head, .section .eyebrow, " +
    ".section .wrap > h2, .lede, .table-scroll, .marquee, .clients:not(.marquee .clients), form.enquiry, .faq"
  );
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });

  revealTargets.forEach(function (el) {
    el.classList.add("reveal");
    var siblings = Array.prototype.filter.call(el.parentElement.children, function (c) {
      return c.classList.contains("reveal");
    });
    var i = siblings.indexOf(el);
    el.style.transitionDelay = Math.min(Math.max(i, 0) * 70, 420) + "ms";
    io.observe(el);
  });

  // Animated stat counters (e.g. 2016, 20+, 8+, 100%)
  var statIo = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      statIo.unobserve(entry.target);
      var el = entry.target;
      var match = el.textContent.trim().match(/^(\d+)(.*)$/);
      if (!match) return;
      var end = parseInt(match[1], 10);
      var suffix = match[2] || "";
      var duration = 1200;
      var start = null;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(end * eased) + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });

  document.querySelectorAll(".stat b").forEach(function (el) { statIo.observe(el); });
})();

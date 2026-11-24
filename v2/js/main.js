// Visbot Industries — shared behaviour
(function () {
  var WA_NUMBER = "918072398966"; // Visbot sales & technical support

  // Mobile navigation
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // Enquiry form: compose a WhatsApp message from the form fields
  var form = document.querySelector("form.enquiry");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var get = function (id) {
        var el = form.querySelector("#" + id);
        return el ? el.value.trim() : "";
      };
      var lines = [
        "Hello Visbot Industries, I have an enquiry.",
        "Name: " + get("f-name"),
        "Phone: " + get("f-phone"),
        "State: " + get("f-state"),
        "Interested in: " + get("f-machine")
      ];
      var msg = get("f-msg");
      if (msg) lines.push("Message: " + msg);
      var url = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(lines.join("\n"));
      window.open(url, "_blank") || (window.location.href = url);
    });
  }
})();

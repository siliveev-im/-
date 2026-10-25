(function () {
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  if (toggle && header) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.querySelectorAll(".site-nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        header.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Согласие на cookie: Метрика загружается только после «Принять». «Отказаться» ничего не включает.
  var cookie = document.getElementById("cookie");
  if (cookie) {
    var choice = null;
    try { choice = localStorage.getItem("cookie-choice"); } catch (e) {}
    function startMetrika() { if (typeof window.__loadMetrika === "function") window.__loadMetrika(); }
    function saveChoice(value) {
      try { localStorage.setItem("cookie-choice", value); } catch (e) {}
      cookie.hidden = true;
    }
    if (choice === "yes") startMetrika();
    else if (choice !== "no") cookie.hidden = false;
    var ok = document.getElementById("cookie-ok");
    var no = document.getElementById("cookie-no");
    if (ok) ok.addEventListener("click", function () { saveChoice("yes"); startMetrika(); });
    if (no) no.addEventListener("click", function () { saveChoice("no"); });
    var settings = document.getElementById("cookie-settings");
    if (settings) settings.addEventListener("click", function (e) {
      e.preventDefault();
      cookie.hidden = false;
    });
  }

  function goal(name) {
    if (typeof window.ym === "function" && window.__metrikaId) window.ym(window.__metrikaId, "reachGoal", name);
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (href.indexOf("tel:") === 0) goal("phone");
    else if (href.indexOf("mailto:") === 0) goal("email");
    else if (href.indexOf("t.me/") !== -1) goal("telegram");
  });

  var isPreview = !!window.__sitePreview;
  var isLocal = isPreview || location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:";

  if (/[?&]error=1/.test(location.search)) {
    var firstError = document.querySelector(".lead-form .form-error");
    if (firstError) {
      firstError.textContent = "Не удалось отправить заявку. Попробуйте ещё раз или свяжитесь со мной напрямую — контакты рядом с формой.";
      firstError.hidden = false;
    }
  }

  document.querySelectorAll(".lead-form").forEach(function (form) {
    var error = form.querySelector(".form-error");
    function showError(msg) { error.textContent = msg; error.hidden = false; }
    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field");
      if (field) field.classList.remove("invalid");
      error.hidden = true;
    });
    form.addEventListener("submit", function (e) {
      var name = form.elements.name, contact = form.elements.contact, consent = form.elements.consent;
      var problems = [];
      if (!name.value.trim()) { name.closest(".field").classList.add("invalid"); problems.push("укажите, как к вам обращаться"); }
      if (contact.value.trim().length < 5) { contact.closest(".field").classList.add("invalid"); problems.push("оставьте телефон или ник в мессенджере"); }
      if (!consent.checked) { problems.push("отметьте согласие на обработку персональных данных"); }
      if (problems.length) {
        e.preventDefault();
        showError("Чтобы отправить заявку, " + problems.join(", ") + ".");
        return;
      }
      if (isLocal) {
        e.preventDefault();
        location.href = isPreview ? (window.__siteRoot || "") + "spasibo/index.html" : "/spasibo/";
      }
    });
  });
})();

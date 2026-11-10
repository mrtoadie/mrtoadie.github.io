// assets/js/lightbox.js
// Simple LightBox Script

(function () {
  "use strict";

  // Create the overlay once, hidden by default
  var box = document.createElement("div");
  box.id = "lightbox";
  box.innerHTML = '<img alt=""><button type="button">&times;</button>';
  document.body.appendChild(box);

  var img = box.querySelector("img");

  function open(src, alt) {
    img.src = src;
    img.alt = alt || "";
    box.classList.add("open");
  }

  function close() {
    box.classList.remove("open");
    img.src = ""; // free the memory while hidden
  }

  // Every figure.photo opens the lightbox on click
  document.querySelectorAll(".photo img").forEach(function (el) {
    el.closest(".photo").addEventListener("click", function () {
      open(el.src, el.alt);
    });
  });

  box.addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
})();

// assets/js/easter-eggs.js

(function () {
  // Styles
  const styleTitle = "font-size:24px; font-weight:bold; color:#1793D1;";
  const styleItalic = "color:#434C5E; font-style:italic;";
  const styleDim = "font-size:14px; color:#434C5E;";
  const stylePenguin = "font-size:14px; line-height:1.1; color:#1793D1;";
  const styleGreen = "color:#7ee787;";

  // Easter egg 1: Greeting curious visitors (DevTools)
  console.log(
    "%c~/mrtoadie%c curious mind detected 👀\n" +
      "%cYou inspect things. I like that.\n" +
      "The cluster is real — 4x Raspberry Pi k3s + 1 watcher.\n" +
      "→ https://github.com/mrtoadie",
    styleTitle,
    styleItalic,
    styleDim,
  );
  console.log(
    "%c" +
      "        .--.\n" +
      "       |o_o |\n" +
      "       |:_/ |\n" +
      "      //   \\ \\\n" +
      "     (|     | )\n" +
      "    /'_   _/'\n" +
      "    \\___)=(___/",
    stylePenguin,
  );
  console.log("%cmr.toad says hi", styleItalic);
})();

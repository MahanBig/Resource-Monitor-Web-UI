// Applies the saved/URL-selected theme before first paint to avoid a flash.
// Loaded as a classic (blocking) script so the CSP can forbid inline scripts.
(function () {
  var params = new URLSearchParams(location.search);
  var theme = null;
  try { theme = localStorage.getItem("rm_theme"); } catch (e) { /* storage disabled */ }
  var on = function (v) { return v === "1" || v === "true"; };
  if (on(params.get("darkmode"))) theme = "dark";
  else if (on(params.get("darkseason"))) theme = [10, 11, 0].indexOf(new Date().getMonth()) >= 0 ? "dark" : "light";
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
})();

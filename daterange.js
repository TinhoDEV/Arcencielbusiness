/* =================================================================
   Arc en Ciel Business — Calendrier de plage de dates (daterange.js)
   Remplace le sélecteur de période par un calendrier popover.
   Pilote les champs cachés #statsFrom / #statsTo puis appelle
   refreshDashboard() (logique de calcul inchangée).
   ================================================================= */
(function () {
  "use strict";

  const MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  const WD = ["dim","lun","mar","mer","jeu","ven","sam"];

  const trigger = document.getElementById("drTrigger");
  const pop = document.getElementById("drPop");
  const labelEl = document.getElementById("drLabel");
  const fromEl = document.getElementById("statsFrom");
  const toEl = document.getElementById("statsTo");
  if (!trigger || !pop) return;

  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parse(s) {
    if (!s) return null;
    const [y, m, d] = String(s).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function fmt(d) { return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let selStart = parse(fromEl.value);
  let selEnd = parse(toEl.value);
  let view = new Date((selEnd || selStart || today).getFullYear(), (selEnd || selStart || today).getMonth(), 1);

  function updateLabel() {
    if (!selStart && !selEnd) { labelEl.textContent = "Depuis le début"; return; }
    const a = selStart ? fmt(selStart) : "…";
    const b = selEnd ? fmt(selEnd) : (selStart ? fmt(selStart) : "…");
    labelEl.textContent = sameDay(selStart, selEnd) || (selStart && !selEnd) ? a : a + " – " + b;
  }

  function applyToDashboard() {
    fromEl.value = selStart ? iso(selStart) : "";
    toEl.value = selEnd ? iso(selEnd) : (selStart ? iso(selStart) : "");
    updateLabel();
    if (typeof window.refreshDashboard === "function") window.refreshDashboard();
  }

  function setPreset(kind) {
    const n = new Date(); n.setHours(0, 0, 0, 0);
    const first = (y, m, d) => new Date(y, m, d);
    if (kind === "day")   { selStart = new Date(n); selEnd = new Date(n); }
    else if (kind === "week") {
      const day = (n.getDay() + 6) % 7; const s = new Date(n); s.setDate(n.getDate() - day);
      selStart = s; selEnd = new Date(n);
    }
    else if (kind === "month") { selStart = first(n.getFullYear(), n.getMonth(), 1); selEnd = new Date(n); }
    else if (kind === "year")  { selStart = first(n.getFullYear(), 0, 1); selEnd = new Date(n); }
    else if (kind === "all")   { selStart = null; selEnd = null; }
    view = new Date((selEnd || n).getFullYear(), (selEnd || n).getMonth(), 1);
    render(); applyToDashboard();
  }

  function pickDay(d) {
    if (!selStart || (selStart && selEnd)) { selStart = d; selEnd = null; }
    else if (d < selStart) { selEnd = selStart; selStart = d; }
    else { selEnd = d; }
    render(); applyToDashboard();
  }

  function render() {
    const y = view.getFullYear(), m = view.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();

    let html = "";
    // En-tête : navigation
    html += '<div class="dr-head">';
    html += '<button type="button" class="dr-nav" data-nav="-12">«</button>';
    html += '<button type="button" class="dr-nav" data-nav="-1">‹</button>';
    html += '<span class="dr-title">' + MONTHS[m].charAt(0).toUpperCase() + MONTHS[m].slice(1) + " " + y + "</span>";
    html += '<button type="button" class="dr-nav" data-nav="1">›</button>';
    html += '<button type="button" class="dr-nav" data-nav="12">»</button>';
    html += "</div>";
    // Jours de la semaine
    html += '<div class="dr-grid dr-wd">';
    WD.forEach((w) => { html += '<span class="dr-wdc">' + w + "</span>"; });
    html += "</div>";
    // Grille des jours
    html += '<div class="dr-grid dr-days">';
    for (let i = 0; i < firstDow; i++) html += '<span class="dr-empty"></span>';
    for (let dnum = 1; dnum <= days; dnum++) {
      const cur = new Date(y, m, dnum);
      let cls = "dr-day";
      const isStart = sameDay(cur, selStart), isEnd = sameDay(cur, selEnd);
      if (isStart || isEnd) cls += " dr-end";
      else if (selStart && selEnd && cur > selStart && cur < selEnd) cls += " dr-in";
      if (sameDay(cur, today)) cls += " dr-today";
      html += '<button type="button" class="' + cls + '" data-day="' + dnum + '">' + dnum + "</button>";
    }
    html += "</div>";
    // Raccourcis
    html += '<div class="dr-presets">';
    html += '<button type="button" class="dr-chip" data-preset="day">Aujourd\'hui</button>';
    html += '<button type="button" class="dr-chip" data-preset="week">Cette semaine</button>';
    html += '<button type="button" class="dr-chip" data-preset="month">Ce mois</button>';
    html += '<button type="button" class="dr-chip" data-preset="year">Cette année</button>';
    html += '<button type="button" class="dr-chip" data-preset="all">Depuis le début</button>';
    html += "</div>";

    pop.innerHTML = html;
  }

  // Délégation des clics dans le popover
  pop.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { view.setMonth(view.getMonth() + Number(nav.dataset.nav)); render(); return; }
    const day = e.target.closest("[data-day]");
    if (day) { pickDay(new Date(view.getFullYear(), view.getMonth(), Number(day.dataset.day))); return; }
    const preset = e.target.closest("[data-preset]");
    if (preset) { setPreset(preset.dataset.preset); return; }
  });

  function openPop() { render(); pop.classList.add("open"); trigger.classList.add("active"); }
  function closePop() { pop.classList.remove("open"); trigger.classList.remove("active"); }
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.contains("open") ? closePop() : openPop();
  });
  document.addEventListener("click", (e) => {
    if (pop.classList.contains("open") && !pop.contains(e.target) && e.target !== trigger) closePop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

  // Initialisation : "Ce mois" par défaut
  if (!selStart && !selEnd) setPreset("month");
  else { updateLabel(); }
})();

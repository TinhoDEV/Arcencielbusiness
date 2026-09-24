/* =================================================================
   Arc en Ciel Business — JOURNAL des enregistrements (journal.js)
   Consultation du journal permanent « clients_jour » (append-only).
   Réservé à l'administrateur connecté.
   ================================================================= */

const LS_ADMIN_SESSION = "acb_admin_session";
const LS_JOURNAL = "acb_clients_jour";

/* Garde d'accès : admin OU staff */
if (!Auth.check("admin") && !Auth.check("staff")) {
  window.location.replace("staff.html");
}
/* Bouton retour vers le bon panneau selon la session */
(function setBackLink() {
  const back = document.getElementById("backBtn");
  if (back) back.href = Auth.check("admin")
    ? "panneau-admin.html" : "panneau-staff.html";
})();

/* -------------------------------------------------------------
   Helpers
   ------------------------------------------------------------- */
function getJournal() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_JOURNAL) || "[]");
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function formatNumber(n) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0));
}
function formatMoney(n) {
  return formatNumber(n) + " FCFA";
}
function formatDate(value) {
  if (!value) return "—";
  const part = String(value).split("T")[0];
  const [y, m, d] = part.split("-");
  if (!y || !m || !d) return "—";
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function toast(message, type = "info") {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast " + (type === "success" ? "success" : type === "error" ? "error" : "");
  el.innerHTML = `<span>${message}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add("is-out"); setTimeout(() => el.remove(), 300); }, 3000);
}

/* Affiche la photo de la carte dans une fenêtre */
async function showCardImage(e) {
  if (!e || !e.cardImage) return;
  const modal = document.getElementById("cardModal");
  const img = document.getElementById("cardModalImg");
  const cap = document.getElementById("cardModalCaption");
  if (!modal || !img) return;
  if (cap) cap.textContent = `Carte ${e.numeroCarte || "—"} · ${e.username || ""}`;
  modal.classList.add("open");
  if (e.cardImage === "__LAZY__") {
    img.removeAttribute("src");
    img.alt = "Chargement de l'image…";
    const url = window.acbSync && window.acbSync.fetchImage ? await window.acbSync.fetchImage("acb_clients_jour", e.id) : null;
    if (!modal.classList.contains("open")) return;
    if (url) { img.src = url; img.alt = ""; e.cardImage = url; }
    else img.alt = "Image indisponible.";
    return;
  }
  img.src = e.cardImage;
  if (cap) cap.textContent = `Carte ${e.numeroCarte || "—"} · ${e.username || ""}`;
  modal.classList.add("open");
}
function closeCardModal() {
  const modal = document.getElementById("cardModal");
  if (modal) modal.classList.remove("open");
}
document.addEventListener("click", (ev) => {
  const modal = document.getElementById("cardModal");
  if (!modal) return;
  if (ev.target === modal || ev.target.closest("#cardModalClose")) closeCardModal();
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeCardModal(); });

/* -------------------------------------------------------------
   Filtrage + rendu
   ------------------------------------------------------------- */
function filteredEntries() {
  const from = document.getElementById("filterFrom").value;
  const to = document.getElementById("filterTo").value;
  const q = document.getElementById("filterSearch").value.trim().toLowerCase();

  return getJournal()
    .filter((e) => {
      const d = String(e.date).split("T")[0];
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (q) {
        const hay = (String(e.numeroCarte || "") + " " + String(e.username || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    // Les plus récents en haut (id contient l'horodatage)
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

function render() {
  const list = filteredEntries();
  const body = document.getElementById("journalBody");
  body.innerHTML = "";

  let totCarres = 0, totMontant = 0;
  let currentDay = null;

  // Total reçu par jour (pour l'afficher en gras à côté de la date).
  const dayTotals = {};
  list.forEach((e) => {
    const d = String(e.date).split("T")[0];
    dayTotals[d] = (dayTotals[d] || 0) + (Number(e.montantTotal) || 0);
  });

  // Total carrés signés PAR CARTE : cumul de tout l'historique du journal,
  // calculé en ordre chronologique (indépendant du filtre affiché).
  const totalByEntry = {};
  const runByCard = {};
  getJournal()
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)))
    .forEach((e) => {
      const card = String(e.numeroCarte || "").trim().toLowerCase();
      // Un « Nouvel enreg. » redémarre le cycle de la carte
      if (e.type === "nouveau" || e.type === "nouvel" || e.type === "new") runByCard[card] = 0;
      runByCard[card] = (runByCard[card] || 0) + (Number(e.nbCarres) || 0);
      totalByEntry[e.id] = runByCard[card];
    });

  list.forEach((e) => {
    totCarres += Number(e.nbCarres) || 0;
    totMontant += Number(e.montantTotal) || 0;

    // Séparateur entre les jours : une ligne-titre à chaque changement de date
    const day = String(e.date).split("T")[0];
    if (day !== currentDay) {
      currentDay = day;
      const sep = document.createElement("tr");
      sep.className = "day-sep-row";
      sep.innerHTML = `<td colspan="10" style="background:var(--bg); border-top:2px solid var(--navy); padding:10px 14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <span style="font-weight:700; color:var(--navy); letter-spacing:.3px;">${formatDate(e.date)}</span>
          <span style="font-weight:800; color:var(--navy);">Total reçu : <span class="day-total money-cell" data-real="${formatMoney(dayTotals[day])}">${formatMoney(dayTotals[day])}</span></span>
        </div>
      </td>`;
      body.appendChild(sep);
    }

    const isNew = e.type !== "mise à jour";
    const tr = document.createElement("tr");
    if (isNew) tr.classList.add("new-entry-row");
    tr.innerHTML = `
      <td class="muted">${formatDate(e.date)}</td>
      <td><span class="code-pill">${escapeHtml(e.numeroCarte || "—")}</span></td>
      <td><strong style="color:var(--navy)">${escapeHtml(e.username || "—")}</strong></td>
      <td style="text-align:right" class="num-cell">${e.montantCarreau ? formatMoney(e.montantCarreau) : "—"}</td>
      <td style="text-align:center"><span class="pill">${Number(e.nbCarres) || 0}</span></td>
      <td style="text-align:center"><span class="pill">${totalByEntry[e.id] != null ? totalByEntry[e.id] : (Number(e.nbCarres) || 0)}</span></td>
      <td style="text-align:right" class="num-cell money-cell">${formatMoney(e.montantTotal)}</td>
      <td><span class="tx ${isNew ? "depot" : "retrait"}" style="font-size:12px;">${isNew ? "Nouvel enreg." : "Mise à jour"}</span></td>
      <td class="muted">${escapeHtml(e.registeredBy || "—")}</td>
      <td style="text-align:right">
        ${e.cardImage
          ? `<button class="btn btn-ghost btn-sm view-card-btn" data-id="${escapeHtml(e.id)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir</button>`
          : `<button class="btn btn-ghost btn-sm" disabled title="Aucune photo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir</button>`}
      </td>
    `;
    body.appendChild(tr);
  });

  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="10">Aucun enregistrement pour ces critères.</td></tr>`;
  }

  // Boutons "Voir" la photo de la carte
  body.querySelectorAll(".view-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const e = list.find((x) => String(x.id) === btn.dataset.id);
      if (e && e.cardImage) showCardImage(e);
    });
  });

  document.getElementById("sumEntries").textContent = list.length;
  document.getElementById("sumCarres").textContent = totCarres;
  const sumEl = document.getElementById("sumMontant");
  sumEl.dataset.real = formatMoney(totMontant);
  applyMontantMask();
  document.getElementById("journalCount").textContent =
    list.length + (list.length <= 1 ? " entrée" : " entrées");
}

/* -------------------------------------------------------------
   Export CSV
   ------------------------------------------------------------- */
function toCsvValue(v) {
  const s = String(v == null ? "" : v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
document.getElementById("exportJournal").addEventListener("click", () => {
  const list = filteredEntries();
  if (!list.length) { toast("Aucune entrée à exporter", "error"); return; }
  const rows = [["Date", "N° de carte", "Nom du client", "Montant d'un carré", "Carrés signés", "Total carrés signés", "Montant total", "Type", "Enregistré par"]];
  const totExp = {}, runExp = {};
  getJournal()
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)))
    .forEach((e) => {
      const card = String(e.numeroCarte || "").trim().toLowerCase();
      if (e.type === "nouveau" || e.type === "nouvel" || e.type === "new") runExp[card] = 0;
      runExp[card] = (runExp[card] || 0) + (Number(e.nbCarres) || 0);
      totExp[e.id] = runExp[card];
    });
  list.forEach((e) => {
    rows.push([
      formatDate(e.date), e.numeroCarte || "", e.username || "",
      e.montantCarreau || 0, e.nbCarres || 0, totExp[e.id] || 0, e.montantTotal || 0,
      e.type || "", e.registeredBy || "",
    ]);
  });
  const csv = "\uFEFF" + rows.map((r) => r.map(toCsvValue).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "journal-clients-du-jour.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Journal exporté", "success");
});

/* Suppression de toutes les entrées de la période sélectionnée */
document.getElementById("deletePeriod").addEventListener("click", () => {
  const from = document.getElementById("filterFrom").value;
  const to = document.getElementById("filterTo").value;
  if (!from && !to) {
    toast("Sélectionnez d'abord une période (Du / Au)", "error");
    return;
  }
  const inPeriod = getJournal().filter((e) => {
    const d = String(e.date).split("T")[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  if (!inPeriod.length) { toast("Aucune entrée sur cette période", "error"); return; }
  const libelle = from && to ? `du ${formatDate(from)} au ${formatDate(to)}`
    : from ? `à partir du ${formatDate(from)}` : `jusqu'au ${formatDate(to)}`;
  const ok = window.confirm(`Supprimer définitivement ${inPeriod.length} entrée(s) ${libelle} ?\nCette action est irréversible.`);
  if (!ok) return;
  inPeriod.forEach((e) => { if (window.acbJournal) window.acbJournal.remove(e.id); });
  render();
  toast(`${inPeriod.length} entrée(s) supprimée(s)`, "success");
});

/* -------------------------------------------------------------
   Init + synchro temps réel
   ------------------------------------------------------------- */
["filterFrom", "filterTo", "filterSearch"].forEach((id) => {
  document.getElementById(id).addEventListener("input", render);
});
// Rafraîchit quand le journal est synchronisé depuis Supabase
window.renderJournal = render;
// État « montants masqués » (persistant) : masque la colonne « Montant total »
// du tableau ET le total en bas.
let montantHidden = localStorage.getItem("acb_journal_hide_montant") === "1";
function applyMontantMask() {
  const sum = document.getElementById("sumMontant");
  if (sum) sum.textContent = montantHidden ? "••••••" : (sum.dataset.real || sum.textContent);
  document.querySelectorAll(".money-cell").forEach((td) => {
    if (montantHidden) {
      if (!td.dataset.real) td.dataset.real = td.textContent;
      td.textContent = "••••••";
    } else if (td.dataset.real) {
      td.textContent = td.dataset.real;
    }
  });
  const eo = document.getElementById("eyeOpen");
  const ef = document.getElementById("eyeOff");
  if (eo && ef) { eo.style.display = montantHidden ? "none" : ""; ef.style.display = montantHidden ? "" : "none"; }
}
(function initMontantToggle() {
  const btn = document.getElementById("toggleMontant");
  if (btn) btn.addEventListener("click", () => {
    montantHidden = !montantHidden;
    localStorage.setItem("acb_journal_hide_montant", montantHidden ? "1" : "0");
    applyMontantMask();
  });
})();
(function init() {
  // Par défaut : filtre sur la DATE DU JOUR (Journal des enregistrements du jour).
  const _d = new Date();
  const today = _d.getFullYear() + "-" + String(_d.getMonth() + 1).padStart(2, "0") + "-" + String(_d.getDate()).padStart(2, "0");
  const f = document.getElementById("filterFrom");
  const t = document.getElementById("filterTo");
  if (f && !f.value) f.value = today;
  if (t && !t.value) t.value = today;
  if (window.acbJournal && window.acbJournal.pull) window.acbJournal.pull().then(render);
  render();
  setInterval(() => { if (window.acbJournal && window.acbJournal.pull) window.acbJournal.pull().then(render); }, 30000);
})();

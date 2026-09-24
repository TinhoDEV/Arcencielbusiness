/* =================================================================
   Arc en Ciel Business — BASE DE DONNÉES (base-de-donnees.js)
   Vue consolidée des enregistrements clients + staff, avec export CSV.
   Réservé à l'administrateur connecté.
   ================================================================= */

const LS_CLIENTS = "acb_clients";
const LS_STAFF = "acb_staff";
const LS_ADMIN_SESSION = "acb_admin_session";

/* Garde d'accès */
Auth.requireRole("admin");

/* -------------------------------------------------------------
   Stockage
   ------------------------------------------------------------- */
function getClients() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_CLIENTS));
    return Array.isArray(arr) ? arr.filter((x) => !x.deleted) : [];
  } catch (e) { return []; }
}
// Lecture brute (inclut les éléments déjà marqués deleted) — pour les écritures.
function getClientsRaw() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_CLIENTS));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function getStaff() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_STAFF));
    return Array.isArray(arr) ? arr.filter((x) => !x.deleted) : [];
  } catch (e) { return []; }
}
// Lecture brute (inclut les éléments déjà marqués deleted) — pour les écritures.
function getStaffRaw() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_STAFF));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveClients(list) {
  localStorage.setItem(LS_CLIENTS, JSON.stringify(list));
}
function saveStaff(list) {
  localStorage.setItem(LS_STAFF, JSON.stringify(list));
}

/* -------------------------------------------------------------
   Formatage
   ------------------------------------------------------------- */
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
function countCarreaux(c) {
  return (c.transactions || []).filter((t) => t.type === "depot").length;
}

/* -------------------------------------------------------------
   Toast
   ------------------------------------------------------------- */
function toast(message, type = "info") {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast " + (type === "success" ? "success" : type === "error" ? "error" : "");
  el.innerHTML = `<span>${message}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-out");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

/* -------------------------------------------------------------
   Rendu : tableau clients
   ------------------------------------------------------------- */
/* Helpers alignés sur l'espace admin (même définition d'une carte retirée). */
function bddMontantTotalClient(c) {
  const carreauxSignes = (c.transactions || []).filter((t) => t.type === "depot").length;
  const montantCarreau = Number(c.montantCarreau) || 0;
  const avance = (c.transactions || [])
    .filter((t) => t.type === "retrait" && t.note === "Avance sur carte")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  return montantCarreau * Math.max(0, carreauxSignes - 1) - avance;
}
function bddIsCardWithdrawn(c) {
  const hasRetraitTotal = (c.transactions || []).some((t) => t.type === "retrait" && t.note === "Retrait total");
  if (hasRetraitTotal) return true;
  const hasAvance = (c.transactions || []).some((t) => t.type === "retrait" && t.note === "Avance sur carte");
  return hasAvance && bddMontantTotalClient(c) <= 0;
}

async function renderClients() {
  // Mêmes données que « Liste de tous les clients » (espace admin) :
  // récupérées DIRECTEMENT depuis la base Supabase (repli cache si hors-ligne).
  let all = null;
  if (window.acbSync && window.acbSync.fetchTable) {
    all = await window.acbSync.fetchTable("acb_clients");
  }
  if (!all) all = getClients();
  // Les cartes retirées (retrait total OU montant total ≤ 0 après avance) ne
  // s'affichent plus ici — exactement comme dans l'espace admin.
  const clients = all.filter((c) => !bddIsCardWithdrawn(c));

  // Filtre de recherche (n° de carte ou nom du client)
  const q = (document.getElementById("clientDbSearch")?.value || "").trim().toLowerCase();
  const shown = q
    ? clients.filter((c) =>
        String(c.numeroCarte || "").toLowerCase().includes(q) ||
        String(c.username || "").toLowerCase().includes(q))
    : clients;

  document.getElementById("clientCount").textContent =
    shown.length + (shown.length <= 1 ? " enregistrement" : " enregistrements");

  const body = document.getElementById("clientsDb");
  body.innerHTML = "";
  if (!shown.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">${q ? "Aucun client trouvé pour cette recherche." : "Aucun client enregistré."}</td></tr>`;
    return;
  }

  shown.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="code-pill">${escapeHtml(c.numeroCarte || "—")}</span></td>
      <td><strong style="color:var(--navy)">${escapeHtml(c.username || "—")}</strong></td>
      <td class="muted">${formatDate(c.createdAt)}</td>
      <td style="text-align:right" class="num-cell">${c.montantCarreau ? formatMoney(c.montantCarreau) : "—"}</td>
      <td style="text-align:center"><span class="pill">${countCarreaux(c)}</span></td>
      <td style="text-align:center"><span class="pill">${c.cumulCarresSignes != null ? c.cumulCarresSignes : countCarreaux(c)}</span></td>
      <td style="text-align:right" class="num-cell">${formatMoney(c.balance)}</td>
      <td style="text-align:right">
        ${c.cardImage
          ? `<button class="btn btn-ghost btn-sm view-ccard-btn" data-id="${escapeHtml(String(c.id))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir la carte</button>`
          : `<button class="btn btn-ghost btn-sm" disabled title="Aucune photo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir la carte</button>`}
      </td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm del-client-btn" data-id="${c.id}" style="color:var(--red); border-color:var(--red-050);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Supprimer
        </button>
      </td>
    `;
    body.appendChild(tr);
  });

  wirePwEyes(body);

  // Suppression d'un client (admin uniquement — page protégée)
  body.querySelectorAll(".del-client-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      // On cherche dans les données AFFICHÉES (lues depuis Supabase), pas le cache local.
      const c = all.find((x) => String(x.id) === String(btn.dataset.id));
      if (!c) return;
      const ok = window.confirm(`Supprimer le client « ${c.username} » (carte ${c.numeroCarte || "—"}) ?\n\nCette action est irréversible : le compte et tout son historique seront définitivement supprimés.`);
      if (!ok) return;
      // Suppression DÉFINITIVE : retrait local immédiat + DELETE Supabase.
      const id = btn.dataset.id;
      const card = c.numeroCarte;
      let img = c.cardImage;
      if (img === "__LAZY__" && window.acbSync && window.acbSync.fetchImage) {
        img = await window.acbSync.fetchImage("acb_clients", id);
      }
      saveClients(getClientsRaw().filter((x) => String(x.id) !== String(id)));
      if (window.acbSync && window.acbSync.deleteRow) window.acbSync.deleteRow("acb_clients", id);
      // Supprime aussi sa photo du bucket (si lien) et ses entrées de journal
      if (window.acbStorage && window.acbStorage.remove) window.acbStorage.remove(img);
      if (window.acbJournal && window.acbJournal.removeByCard) window.acbJournal.removeByCard(card);
      renderClients();
      toast("Client supprimé", "success");
    });
  });

  // Voir la photo de la carte d'un client
  body.querySelectorAll(".view-ccard-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = all.find((x) => String(x.id) === String(btn.dataset.id));
      if (c && c.cardImage) showCardImage(c);
    });
  });
}
function renderStaff() {
  const list = getStaff();
  document.getElementById("staffCount").textContent =
    list.length + (list.length <= 1 ? " enregistrement" : " enregistrements");

  const body = document.getElementById("staffDb");
  body.innerHTML = "";
  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">Aucun membre du personnel enregistré.</td></tr>`;
    return;
  }

  list.forEach((s) => {
    const display = s.displayName || s.username;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:11px;">
          <span class="avatar" style="width:30px; height:30px; font-size:12px;">${escapeHtml(display.slice(0,2).toUpperCase())}</span>
          <strong style="color:var(--navy)">${escapeHtml(display)}</strong>
        </div>
      </td>
      <td class="muted"><span class="code-pill">${escapeHtml(s.username)}</span></td>
      <td>
        <span class="pw-cell">
          <span class="pw-dots" data-pw="${escapeHtml(s.password || "")}">••••••••</span>
          <button type="button" class="pw-eye" aria-label="Afficher / masquer">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </span>
      </td>
      <td class="muted">${formatDate(s.createdAt)}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm del-staff-btn" data-id="${s.id}" style="color:var(--red); border-color:var(--red-050);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Supprimer
        </button>
      </td>
    `;
    body.appendChild(tr);
  });

  wirePwEyes(body);

  // Suppression d'un membre du staff (admin uniquement — page protégée)
  body.querySelectorAll(".del-staff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = getStaff().find((x) => x.id === btn.dataset.id);
      if (!s) return;
      const ok = window.confirm(`Supprimer le compte staff « ${s.username} » ?\n\nCette personne ne pourra plus se connecter à l'espace staff.`);
      if (!ok) return;
      // Suppression DÉFINITIVE : retrait local immédiat + DELETE Supabase.
      const id = btn.dataset.id;
      saveStaff(getStaffRaw().filter((x) => String(x.id) !== String(id)));
      if (window.acbSync && window.acbSync.deleteRow) window.acbSync.deleteRow("acb_staff", id);
      renderStaff();
      toast("Compte staff supprimé", "success");
    });
  });
}
function wirePwEyes(scope) {
  scope.querySelectorAll(".pw-eye").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dots = btn.parentElement.querySelector(".pw-dots");
      const shown = dots.classList.toggle("revealed");
      dots.textContent = shown ? dots.dataset.pw : "••••••••";
      btn.classList.toggle("on", shown);
    });
  });
}

/* -------------------------------------------------------------
   Export CSV
   ------------------------------------------------------------- */
function toCsvValue(v) {
  const s = String(v == null ? "" : v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(filename, rows) {
  // BOM UTF-8 pour qu'Excel lise correctement les accents
  const csv = "\uFEFF" + rows.map((r) => r.map(toCsvValue).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("exportClients").addEventListener("click", () => {
  const clients = getClients();
  if (!clients.length) { toast("Aucun client à exporter", "error"); return; }
  const rows = [["N° de carte", "Nom du client", "Date d'enregistrement", "Montant d'un carré", "Carrés signés", "Cumul carrés signés", "Solde"]];
  clients.forEach((c) => {
    rows.push([
      c.numeroCarte || "",
      c.username || "",
      formatDate(c.createdAt),
      c.montantCarreau || 0,
      countCarreaux(c),
      c.cumulCarresSignes != null ? c.cumulCarresSignes : countCarreaux(c),
      c.balance || 0,
    ]);
  });
  downloadCsv("enregistrement-clients.csv", rows);
  toast("Export clients téléchargé", "success");
});

document.getElementById("exportStaff").addEventListener("click", () => {
  const list = getStaff();
  if (!list.length) { toast("Aucun staff à exporter", "error"); return; }
  const rows = [["Nom affiché", "Nom d'utilisateur", "Mot de passe", "Date de création"]];
  list.forEach((s) => {
    rows.push([
      s.displayName || s.username,
      s.username || "",
      s.password || "",
      formatDate(s.createdAt),
    ]);
  });
  downloadCsv("enregistrement-staff.csv", rows);
  toast("Export staff téléchargé", "success");
});

/* -------------------------------------------------------------
   DÉTAIL DU JOURNAL (entrées du journal permanent)
   ------------------------------------------------------------- */
function getJournalDb() {
  try {
    const a = JSON.parse(localStorage.getItem("acb_clients_jour") || "[]");
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
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
    const url = window.acbSync && window.acbSync.fetchImage ? await window.acbSync.fetchImage("acb_clients", e.id) : null;
    if (!modal.classList.contains("open")) return; // fermé entre-temps
    if (url) { img.src = url; img.alt = ""; e.cardImage = url; }
    else { img.alt = "Image indisponible."; }
    return;
  }
  img.src = e.cardImage;
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

function renderJournalDb() {
  // Toutes les entrées du journal, les plus récentes en haut
  const list = getJournalDb().slice().sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const body = document.getElementById("journalDb");
  if (!body) return;
  document.getElementById("journalCount").textContent =
    list.length + (list.length <= 1 ? " entrée" : " entrées");
  body.innerHTML = "";

  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">Aucune entrée de journal.</td></tr>`;
    return;
  }

  list.forEach((e) => {
    const isNew = e.type !== "mise à jour";
    const tr = document.createElement("tr");
    if (isNew) tr.classList.add("new-entry-row");
    tr.innerHTML = `
      <td class="muted">${formatDate(e.date)}</td>
      <td><span class="code-pill">${escapeHtml(e.numeroCarte || "—")}</span></td>
      <td><strong style="color:var(--navy)">${escapeHtml(e.username || "—")}</strong></td>
      <td class="muted">${escapeHtml(e.registeredBy || "—")}</td>
      <td style="text-align:right" class="num-cell">${e.montantCarreau ? formatMoney(e.montantCarreau) : "—"}</td>
      <td style="text-align:center"><span class="pill">${Number(e.nbCarres) || 0}</span></td>
      <td style="text-align:right" class="num-cell">${formatMoney(e.montantTotal)}</td>
      <td><span class="tx ${isNew ? "depot" : "retrait"}" style="font-size:12px;">${isNew ? "Nouvel enreg." : "Mise à jour"}</span></td>
      <td style="text-align:right">
        <div class="row-actions" style="justify-content:flex-end;">
        ${e.cardImage
          ? `<button class="btn btn-ghost btn-sm view-jcard-btn" data-id="${escapeHtml(e.id)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir</button>`
          : `<button class="btn btn-ghost btn-sm" disabled title="Aucune photo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir</button>`}
        <button class="btn btn-ghost btn-sm del-jentry-btn" data-id="${escapeHtml(e.id)}" style="color:var(--red); border-color:var(--red-050);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Supprimer
        </button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll(".view-jcard-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const e = list.find((x) => String(x.id) === btn.dataset.id);
      if (e && e.cardImage) showCardImage(e);
    });
  });

  // Suppression d'une entrée du journal (admin uniquement — page protégée)
  body.querySelectorAll(".del-jentry-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const e = list.find((x) => String(x.id) === btn.dataset.id);
      if (!e) return;
      const ok = window.confirm(`Supprimer cette entrée du journal ?\n\nCarte ${e.numeroCarte || "—"} · ${e.username || "—"} · ${formatDate(e.date)}\n\nCette action est irréversible.`);
      if (!ok) return;
      if (window.acbJournal && window.acbJournal.remove) {
        window.acbJournal.remove(e.id);
      } else {
        const arr = getJournalDb().filter((x) => String(x.id) !== String(e.id));
        localStorage.setItem("acb_clients_jour", JSON.stringify(arr));
      }
      renderJournalDb();
      toast("Entrée du journal supprimée", "success");
    });
  });
}

document.getElementById("exportJournalDb").addEventListener("click", () => {
  const list = getJournalDb();
  if (!list.length) { toast("Aucune entrée à exporter", "error"); return; }
  const rows = [["Date", "N° de carte", "Nom du client", "Enregistré par", "Montant d'un carré", "Carrés signés", "Montant total", "Type"]];
  list.forEach((e) => {
    rows.push([
      formatDate(e.date), e.numeroCarte || "", e.username || "", e.registeredBy || "",
      e.montantCarreau || 0, e.nbCarres || 0, e.montantTotal || 0, e.type || "",
    ]);
  });
  downloadCsv("detail-du-journal.csv", rows);
  toast("Journal exporté", "success");
});

/* -------------------------------------------------------------
   Init
   ------------------------------------------------------------- */
(function init() {
  renderClients();
  renderStaff();
  renderJournalDb();
  const dbSearch = document.getElementById("clientDbSearch");
  if (dbSearch) dbSearch.addEventListener("input", renderClients);
  // Rafraîchit le journal quand la synchro Supabase arrive
  setInterval(renderJournalDb, 30000);
})();

/* =================================================================
   Arc en Ciel Business — Panneau ADMIN (panneau-admin.js)
   Logique du tableau de bord (page accessible APRÈS connexion).
   Pas de framework. Données dans localStorage.
   ================================================================= */

const LS_CLIENTS = "acb_clients";
const LS_CARTES_RETIREES = "acb_cartes_retirees";
const LS_ADMIN_SESSION = "acb_admin_session";

/* Stockage « Cartes retirées » (synchronisé vers Supabase « cartes_retirees » via db.js) */
function getCartesRetirees() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_CARTES_RETIREES) || "[]");
    return Array.isArray(a) ? a.filter((x) => !x.deleted) : [];
  } catch (e) { return []; }
}
function saveCartesRetirees(arr) {
  localStorage.setItem(LS_CARTES_RETIREES, JSON.stringify(arr));
}

/* Migration : déplace les cartes déjà marquées « Retrait total » encore
   présentes dans la base clients vers le magasin « Cartes retirées ». */
function migrateRetiredCards() {
  const clients = getClients();
  const retired = clients.filter((c) => isCardWithdrawn(c));
  if (!retired.length) return;
  const cr = getCartesRetirees();
  retired.forEach((c) => {
    if (cr.some((x) => String(x.id) === String(c.id))) return;
    // Montant retiré = somme des retraits (retrait total + avances ayant vidé la carte)
    const retraits = (c.transactions || []).filter((t) => t.type === "retrait");
    const montantRetire = retraits.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const last = retraits.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    cr.push(Object.assign({}, c, { retraitDate: last?.date || todayISO(), montantRetire }));
  });
  saveCartesRetirees(cr);
  // Suppression DÉFINITIVE : la carte quitte la base clients (le simple
  // marqueur « deleted » pouvait être annulé par une synchronisation).
  const retiredIds = new Set(retired.map((c) => String(c.id)));
  saveClients(clients.filter((c) => !retiredIds.has(String(c.id))));
  if (window.acbSync && window.acbSync.deleteRow) {
    retiredIds.forEach((id) => window.acbSync.deleteRow("acb_clients", id));
  }
}

/* Nettoyage : toute carte présente dans « Cartes retirées » ne doit plus
   figurer parmi les clients actifs (résidus d'anciens retraits). */
function purgeRetiredFromClients() {
  const retSet = new Set(getCartesRetirees().filter((c) => !c.deleted)
    .map((c) => String(c.numeroCarte || "").trim().toLowerCase()));
  if (!retSet.size) return;
  const clients = getClients();
  const strays = clients.filter((c) => !c.deleted && retSet.has(String(c.numeroCarte || "").trim().toLowerCase()));
  if (!strays.length) return;
  const strayIds = new Set(strays.map((c) => String(c.id)));
  saveClients(clients.filter((c) => !strayIds.has(String(c.id))));
  if (window.acbSync && window.acbSync.deleteRow) {
    strayIds.forEach((id) => window.acbSync.deleteRow("acb_clients", id));
  }
  console.info("[ACB] " + strays.length + " carte(s) retirée(s) purgée(s) de la liste clients.");
}

/* -------------------------------------------------------------
   GARDE D'ACCÈS : sans session admin valide, retour à la connexion.
   ------------------------------------------------------------- */
Auth.requireRole("admin");

/* -------------------------------------------------------------
   1) STOCKAGE
   ------------------------------------------------------------- */
function getClients() {
  try {
    const raw = localStorage.getItem(LS_CLIENTS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => !x.deleted) : [];
  } catch (e) {
    return [];
  }
}
function saveClients(clients) {
  localStorage.setItem(LS_CLIENTS, JSON.stringify(clients));
}

/* Identifiants admin (modifiables via la modale Paramètres). */
const LS_ADMIN_CREDS = "acb_admin_creds";
function getAdminCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_ADMIN_CREDS));
    if (c && c.username && (c.password || c.passwordHash)) {
      return { displayName: "Administrateur", ...c };
    }
  } catch (e) {}
  return { username: "admin", password: "arcenciel2024", displayName: "Administrateur" };
}
function saveAdminCreds(creds) {
  localStorage.setItem(LS_ADMIN_CREDS, JSON.stringify(creds));
  // Synchronise vers Supabase (table « config ») pour que la modification
  // soit effective sur TOUS les appareils, pas seulement ce navigateur.
  if (window.acbConfig && typeof window.acbConfig.set === "function") {
    window.acbConfig.set("admin_creds", creds);
  }
}

/* Comptes staff (créés par l'admin, utilisés par l'espace staff). */
const LS_STAFF = "acb_staff";
function getStaff() {
  try {
    const raw = localStorage.getItem(LS_STAFF);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => !x.deleted) : [];
  } catch (e) {
    return [];
  }
}
function saveStaff(list) {
  localStorage.setItem(LS_STAFF, JSON.stringify(list));
}

/* -------------------------------------------------------------
   2) FORMATAGE (FCFA, dates DD/MM/YYYY)
   ------------------------------------------------------------- */
function formatNumber(n) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0));
}
function formatMoney(n) {
  return formatNumber(n) + " FCFA";
}
function formatDate(value) {
  let d;
  if (value instanceof Date) d = value;
  else if (typeof value === "string" && value.includes("-")) {
    const [y, m, day] = value.split("T")[0].split("-");
    d = new Date(Number(y), Number(m) - 1, Number(day));
  } else {
    d = new Date(value);
  }
  if (isNaN(d)) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function parseISO(value) {
  if (!value) return null;
  const part = String(value).split("T")[0];
  const [y, m, d] = part.split("-").map(Number);
  if (!y || !m || !d) {
    const fb = new Date(value);
    return isNaN(fb) ? null : fb;
  }
  return new Date(y, m - 1, d);
}

/* Renvoie les bornes { start, end } correspondant à la période choisie.
   start/end = null signifie "pas de borne" de ce côté. */
function periodRange(period) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "day":   return { start: d, end: null };
    case "week": {
      const day = (d.getDay() + 6) % 7; // lundi = 0
      const s = new Date(d); s.setDate(d.getDate() - day);
      return { start: s, end: null };
    }
    case "month": return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
    case "year":  return { start: new Date(now.getFullYear(), 0, 1), end: null };
    case "all":   return { start: null, end: null };
    case "custom": {
      const fromEl = document.getElementById("statsFrom");
      const toEl = document.getElementById("statsTo");
      const start = fromEl && fromEl.value ? parseISO(fromEl.value) : null;
      let end = toEl && toEl.value ? parseISO(toEl.value) : null;
      if (end) end = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59); // jour inclus
      return { start, end };
    }
    default: return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
  }
}
/* Vrai si la date d'une transaction tombe dans l'intervalle [start, end]. */
function inRange(d, startDate, endDate) {
  if (!d) return false;
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

/* Masquage des montants des 5 cartes (œil afficher/cacher) */
const STAT_IDS = ["statDailyAmount", "statDailyCards", "statDailyDisbursed", "statProfit"];
function statsHidden() {
  // Masqué par défaut : visible uniquement si l'admin a explicitement choisi d'afficher
  return localStorage.getItem("acb_stats_hidden") !== "0";
}
function applyStatsMask() {
  if (!statsHidden()) return; // les valeurs réelles sont déjà en place
  STAT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "••••••";
  });
}
function updateStatsEye() {
  const btn = document.getElementById("statsEye");
  if (!btn) return;
  const hidden = statsHidden();
  btn.classList.toggle("on", hidden);
  btn.setAttribute("title", hidden ? "Afficher les montants" : "Masquer les montants");
  btn.innerHTML = hidden
    ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Afficher`
    : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> Masquer`;
}
function toggleStatsHidden() {
  const next = statsHidden() ? "0" : "1";
  localStorage.setItem("acb_stats_hidden", next);
  // Synchronise la préférence vers Supabase (visible sur tous les appareils)
  if (window.acbConfig && typeof window.acbConfig.setRaw === "function") {
    window.acbConfig.setRaw("pref_stats_hidden", next);
  }
  updateStatsEye();
  refreshDashboard();
}

/* -------------------------------------------------------------
   3) TOASTS
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
   4) DÉCONNEXION (retour à la page de connexion)
   ------------------------------------------------------------- */
document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  Auth.endSession("admin");
  window.location.href = "staff.html";
});

/* -------------------------------------------------------------
   5) STATISTIQUES + LISTE DES CLIENTS
   ------------------------------------------------------------- */
async function refreshDashboard() {
  // Récupère les clients DIRECTEMENT depuis la base de données Supabase
  // (repli sur le cache local uniquement si la lecture distante échoue / hors-ligne).
  let clients = null;
  if (window.acbSync && window.acbSync.fetchTable) {
    clients = await window.acbSync.fetchTable("acb_clients");
  }
  if (!clients) clients = getClients();

  // Cartes RETIRÉES (déplacées hors de la table clients lors d'un retrait total) :
  // leurs retraits doivent aussi compter dans le « Montant décaissé » de la période.
  let cartesRetirees = null;
  if (window.acbSync && window.acbSync.fetchTable) {
    cartesRetirees = await window.acbSync.fetchTable("acb_cartes_retirees");
  }
  if (!cartesRetirees) cartesRetirees = [];

  // --- Statistiques globales ---
  const totalClients = clients.length;

  // Période choisie (sélecteur) -> bornes début/fin
  const periodEl = document.getElementById("statsPeriod");
  const period = periodEl ? periodEl.value : "month";
  const range = periodRange(period); // { start, end } ; null = pas de borne
  const startDate = range.start;
  const endDate = range.end;

  let periodDisbursed = 0;   // total des retraits effectués DANS la période (par date de transaction)
  const profitClients = {};  // clients dont l'enregistrement tombe dans la période (bénéfice)

  // Helpers : carrés signés, avance et montant total d'un client
  const carresSignes = (c) => (c.transactions || []).filter((t) => t.type === "depot").length;
  const avanceClient = (c) => (c.transactions || [])
    .filter((t) => t.type === "retrait" && t.note === "Avance sur carte")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const montantTotalClient = (c) =>
    (Number(c.montantCarreau) || 0) * Math.max(0, carresSignes(c) - 1) - avanceClient(c);
  const isRetraitTotal = (c) => isCardWithdrawn(c);

  clients.forEach((c) => {
    const montantCarreau = Number(c.montantCarreau) || 0;

    // Bénéfice : 1 carré de commission par client enregistré sur la période
    if (inRange(parseISO(c.createdAt), startDate, endDate)) {
      profitClients[c.id] = montantCarreau;
    }

    // Montant décaissé = retraits dont la DATE tombe dans la période sélectionnée
    (c.transactions || []).forEach((t) => {
      if (t.type === "retrait" && inRange(parseISO(t.date), startDate, endDate)) {
        periodDisbursed += Number(t.amount) || 0;
      }
    });
  });

  const profit = Object.values(profitClients).reduce((s, v) => s + v, 0); // 1 carré / 1er enregistrement

  // Montant décaissé : on ajoute aussi les retraits des cartes RETIRÉES
  // (retrait total) dont la date tombe dans la période sélectionnée.
  const seenIds = new Set(clients.map((c) => String(c.id)));
  cartesRetirees.forEach((c) => {
    if (seenIds.has(String(c.id))) return; // déjà compté via la table clients
    (c.transactions || []).forEach((t) => {
      if (t.type === "retrait" && inRange(parseISO(t.date), startDate, endDate)) {
        periodDisbursed += Number(t.amount) || 0;
      }
    });
  });

  // Clients affichés dans « Liste de tous les clients » = même filtre que la liste
  // (exclut les retraits totaux ET les cartes dont le Montant total est tombé à 0).
  const activeClients = clients.filter((c) => !isCardWithdrawn(c));
  // Solde des comptes clients total = somme des Montant total de la liste
  const clientBalance = activeClients.reduce((s, c) => s + montantTotalClient(c), 0);
  // Cartes signées = nombre de clients dans la liste
  const signedCards = activeClients.length;

  document.getElementById("statDailyAmount").textContent = formatMoney(clientBalance);
  document.getElementById("statDailyCards").textContent = signedCards;
  document.getElementById("statDailyDisbursed").textContent = formatMoney(periodDisbursed);
  document.getElementById("statProfit").textContent = formatMoney(profit);

  applyStatsMask(); // masque les montants si l'option « cacher » est active

  // --- Liste « Carte rempli non encaissé » (carrés signés = 31) ---
  renderFullCards();

  // --- Notifications (cloche) ---
  if (typeof refreshNotifications === "function") refreshNotifications();

  // --- Liste de TOUS les clients (avec recherche) ---
  renderAllClients();
}

/* Construit le HTML d'une ligne client */
/* Affiche l'image de la carte scannée dans une fenêtre */
async function showCardImage(c) {
  if (!c || !c.cardImage) return;
  const modal = document.getElementById("cardModal");
  const img = document.getElementById("cardModalImg");
  const cap = document.getElementById("cardModalCaption");
  if (!modal || !img) return;
  if (cap) cap.textContent = `Carte ${c.numeroCarte || "—"} · ${c.username || ""}`;
  modal.classList.add("open");
  if (c.cardImage === "__LAZY__") {
    img.removeAttribute("src");
    img.alt = "Chargement de l'image…";
    const url = window.acbSync && window.acbSync.fetchImage ? await window.acbSync.fetchImage("acb_clients", c.id) : null;
    if (!modal.classList.contains("open")) return; // fermé entre-temps
    if (url) { img.src = url; img.alt = ""; c.cardImage = url; }
    else { img.alt = "Image indisponible."; }
    return;
  }
  img.src = c.cardImage;
}
function closeCardModal() {
  const modal = document.getElementById("cardModal");
  if (modal) modal.classList.remove("open");
}
document.addEventListener("click", (e) => {
  const modal = document.getElementById("cardModal");
  if (!modal) return;
  if (e.target === modal || e.target.closest("#cardModalClose")) closeCardModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCardModal();
});

/* Montant total d'un client = montant d'un carré × (carrés signés − 1) − avances */
function montantTotalClient(c) {
  const carreauxSignes = (c.transactions || []).filter((t) => t.type === "depot").length;
  const montantCarreau = Number(c.montantCarreau) || 0;
  const avance = (c.transactions || [])
    .filter((t) => t.type === "retrait" && t.note === "Avance sur carte")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  return montantCarreau * Math.max(0, carreauxSignes - 1) - avance;
}

/* Une carte est considérée RETIRÉE TOTALE si :
   - elle porte une transaction « Retrait total », OU
   - son Montant total est à 0 (ou moins) APRÈS avoir reçu au moins une avance
     (toute la valeur a été retirée). On exige une avance pour ne pas retirer
     une carte neuve à 1 carré dont le montant total vaut naturellement 0. */
function hasRetraitTotalNote(c) {
  return (c.transactions || []).some((t) => t.type === "retrait" && t.note === "Retrait total");
}
function hasAvance(c) {
  return (c.transactions || []).some((t) => t.type === "retrait" && t.note === "Avance sur carte");
}
function isCardWithdrawn(c) {
  if (hasRetraitTotalNote(c)) return true;
  return hasAvance(c) && montantTotalClient(c) <= 0;
}

function clientRowHtml(c, withEdit) {
  const carreauxSignes = (c.transactions || []).filter((t) => t.type === "depot").length;
  const montantCarreau = Number(c.montantCarreau) || 0;
  // Montant brut = carrés signés × montant d'un carré
  const brut = montantCarreau * carreauxSignes;
  // Avance = somme des avances enregistrées sur la carte
  const avance = (c.transactions || [])
    .filter((t) => t.type === "retrait" && t.note === "Avance sur carte")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  // Montant total = montant d'un carré × (carrés signés − 1), moins les avances
  const total = montantCarreau * Math.max(0, carreauxSignes - 1) - avance;
  return `
    <td><span class="code-pill">${escapeHtml(c.numeroCarte || "—")}</span></td>
    <td>
      <div style="display:flex; align-items:center; gap:11px;">
        <span class="avatar" style="width:30px; height:30px; font-size:12px;">${escapeHtml(c.username.slice(0,2).toUpperCase())}</span>
        <strong style="color:var(--navy)">${escapeHtml(c.username)}</strong>
      </div>
    </td>
    <td class="muted">${formatDate(c.createdAt)}</td>
    <td style="text-align:right" class="num-cell">${montantCarreau ? formatMoney(montantCarreau) : "—"}</td>
    <td style="text-align:center"><span class="pill">${carreauxSignes}</span></td>
    <td style="text-align:right" class="num-cell">${formatMoney(brut)}</td>
    <td style="text-align:right" class="num-cell ${avance > 0 ? "amt-neg" : ""}">${avance > 0 ? "− " + formatMoney(avance) : "—"}</td>
    <td style="text-align:right" class="num-cell">${formatMoney(total)}</td>
    <td style="text-align:right">
      <div class="row-end">
        ${c.cardImage
          ? `<button class="btn btn-ghost btn-sm view-card-btn" data-id="${c.id}">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg>
               Voir la carte
             </button>`
          : `<button class="btn btn-ghost btn-sm" disabled title="Aucune image de carte enregistrée">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg>
               Voir la carte
             </button>`}
      </div>
    </td>${withEdit ? `
    <td style="text-align:right">
      <div class="row-end">
        <button class="btn btn-ghost btn-sm edit-client-btn" data-id="${c.id}" title="Modifier ce client">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
          Modifier
        </button>
      </div>
    </td>` : ""}
  `;
}

/* Renvoie un timestamp (ms) représentatif de la date de création d'un client/entrée.
   Priorité : 1er bloc de 13 chiffres de l'id (timestamp), sinon date createdAt. */
function recordTime(rec) {
  if (!rec) return 0;
  const m = String(rec.id || "").match(/(\d{13})/);
  if (m) return Number(m[1]);
  const d = rec.createdAt || rec.date;
  const t = d ? new Date(d).getTime() : 0;
  return isNaN(t) ? 0 : t;
}
/* Tri du plus récent (haut) au plus ancien (bas). */
function sortNewestFirst(list) {
  return list.slice().sort((a, b) => recordTime(b) - recordTime(a));
}

/* Remplit un tbody avec une liste de clients + branche les boutons */
function renderClientRows(body, list, emptyMsg, opts) {
  const withEdit = !!(opts && opts.withEdit);
  body.innerHTML = "";
  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="${withEdit ? 10 : 9}">${emptyMsg}</td></tr>`;
    return;
  }
  list.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = clientRowHtml(c, withEdit);
    body.appendChild(tr);
  });
  // Bouton "Modifier" (édition d'un client)
  body.querySelectorAll(".edit-client-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDrawer(btn.dataset.id));
  });
  // Boutons "Voir / Gérer"
  body.querySelectorAll(".manage-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDrawer(btn.dataset.id));
  });
  // Boutons "Voir la carte"
  body.querySelectorAll(".view-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = getClients().find((x) => x.id === btn.dataset.id);
      if (c) showCardImage(c);
    });
  });
}

/* Liste de tous les clients, filtrée par la recherche (n° de carte ou nom) */
async function renderAllClients() {
  const q = (document.getElementById("clientSearch")?.value || "").trim().toLowerCase();
  // Récupère les clients DIRECTEMENT depuis la base de données Supabase
  // (repli sur le cache local uniquement si la lecture distante échoue / hors-ligne).
  let allClients = null;
  if (window.acbSync && window.acbSync.fetchTable) {
    allClients = await window.acbSync.fetchTable("acb_clients");
  }
  if (!allClients) allClients = getClients();
  let list = allClients;
  // Les cartes ayant fait l'objet d'un RETRAIT TOTAL (ou dont le Montant total est
  // tombé à 0 après avances) ne s'affichent plus ici (page « Cartes retirées »).
  list = list.filter((c) => !isCardWithdrawn(c));
  if (q) {
    list = list.filter((c) =>
      String(c.numeroCarte || "").toLowerCase().includes(q) ||
      String(c.username || "").toLowerCase().includes(q)
    );
  }
  const lbl = list.length <= 1 ? list.length + " client" : list.length + " clients";
  document.getElementById("allClientCountLabel").textContent = lbl;
  renderClientRows(
    document.getElementById("allClientsBody"),
    sortNewestFirst(list),
    q ? "Aucun client trouvé pour cette recherche." : "Aucun client enregistré.",
    { withEdit: true }
  );
}

/* Reconstruit, à partir du JOURNAL des enregistrements, les clients qui
   manquent dans la table « clients » (ex. enregistrement synchronisé au
   journal mais non écrit côté clients). Appelée par le bouton « Rafraîchir ».
   Renvoie le nombre de clients ajoutés. */
// Extrait l'horodatage (Date.now) contenu dans un id "j_1780..._3"
function tsFromId(id) {
  const m = String(id || "").match(/(\d{10,})/);
  return m ? Number(m[1]) : 0;
}
let lastReconcileReport = null;
async function reconcileFromJournal() {
  // Journal + clients, directement depuis Supabase
  let journal = null, clients = null;
  if (window.acbJournal && window.acbJournal.fetchRemote) journal = await window.acbJournal.fetchRemote();
  if (window.acbSync && window.acbSync.fetchTable) clients = await window.acbSync.fetchTable("acb_clients");
  // Repli hors-ligne / Supabase lent : on analyse le cache local plutôt que
  // de ne rien faire (le bouton semblerait alors inopérant).
  if (!Array.isArray(journal) && window.acbJournal && window.acbJournal.list) {
    try { journal = window.acbJournal.list(); } catch (e) {}
  }
  if (!Array.isArray(journal)) {
    try { journal = JSON.parse(localStorage.getItem("acb_clients_jour") || "[]"); } catch (e) { journal = null; }
  }
  if (!Array.isArray(journal)) return 0;
  if (!Array.isArray(clients)) clients = getClients();

  // N° de carte déjà présents (clients ACTIFS), retirés, ou remplacés → on ne recrée pas.
  // Les fiches marquées « deleted » ne comptent PAS comme présentes : sinon elles
  // partaient dans la branche « mise à jour » et restaient invisibles dans la liste.
  const known = new Set(clients.filter((c) => !c.deleted).map((c) => String(c.numeroCarte || "").trim().toLowerCase()));
  // Listes FRAÎCHES depuis la base (un retrait / remplacement fait sur un autre
  // appareil doit bloquer la mise à jour, même si le cache local l'ignore).
  const retired = new Set(getCartesRetirees().map((c) => String(c.numeroCarte || "").trim().toLowerCase()));
  const replacedSet = new Set(((window.acbReplaced && window.acbReplaced.list()) || []).map((x) => String(x).trim().toLowerCase()));
  try {
    const SB0 = "https://xlxnetjrftnnwmmfqswl.supabase.co/rest/v1/";
    const K0 = "sb_publishable_o1GHKowDY3MDT_xZnG3tiQ_xk_ThxxV";
    const h0 = { apikey: K0, Authorization: "Bearer " + K0 };
    let from = 0;
    for (;;) {
      const r = await fetch(SB0 + "cartes_retirees?select=n:doc->>numeroCarte&order=id.asc",
        { headers: Object.assign({ Range: from + "-" + (from + 999), "Range-Unit": "items" }, h0), cache: "no-store" });
      if (!r.ok) break;
      const rows = await r.json();
      rows.forEach((x) => { if (x.n) retired.add(String(x.n).trim().toLowerCase()); });
      if (rows.length < 1000) break;
      from += 1000;
    }
    const rc = await fetch(SB0 + "config?id=eq.replaced_cards&select=doc", { headers: h0, cache: "no-store" });
    if (rc.ok) {
      const d = (await rc.json())[0];
      const v = d && d.doc && Array.isArray(d.doc.value) ? d.doc.value : [];
      v.forEach((x) => replacedSet.add(String(x).trim().toLowerCase()));
    }
  } catch (e) { console.warn("[ACB] Vérification retraits/remplacements distante échouée :", e.message); }
  const isReplaced = (n) => replacedSet.has(String(n).trim().toLowerCase());

  // Regroupe les entrées de journal par n° de carte
  const byCard = {};
  journal.forEach((e) => {
    const card = String(e.numeroCarte || "").trim();
    if (!card) return;
    (byCard[card] = byCard[card] || []).push(e);
  });

  // On ne traite QUE les cartes présentes dans le JOURNAL DU JOUR.
  // (le cumul de carrés reste calculé sur tout l'historique de la carte,
  //  sinon les cartes déjà entamées seraient sous-évaluées)
  // Le bouton « Rafraîchir » analyse TOUT le journal : si aucune entrée n'existe
  // pour aujourd'hui, se limiter au jour ne ferait rien du tout.
  const RECONCILE_ALL = true;
  const today = todayISO();
  const sameDay = (d) => String(d || "").slice(0, 10) === today;
  const cardsToday = new Set(
    journal.filter((e) => sameDay(e.date)).map((e) => String(e.numeroCarte || "").trim()).filter(Boolean)
  );

  // Carrés signés du CYCLE EN COURS = somme des nbCarres depuis le dernier
  // « nouvel enregistrement » (une ré-émission de carte réinitialise le cycle).
  // Plafonné à 31 (capacité maximale d'une carte).
  function cycleInfo(entries) {
    const s = entries.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let lastNew = 0;
    for (let i = 0; i < s.length; i++) { if (s[i].type === "nouvel enregistrement") lastNew = i; }
    const cycle = s.slice(lastNew);
    const total = Math.min(31, cycle.reduce((sum, e) => sum + (Number(e.nbCarres) || 0), 0));
    // Image la plus RÉCENTE du cycle qui en possède une (on parcourt depuis la fin) —
    // pas simplement la dernière entrée, qui peut ne pas avoir de photo jointe.
    let latestImage = null, latestImageId = null;
    for (let i = cycle.length - 1; i >= 0; i--) {
      if (cycle[i].cardImage) { latestImage = cycle[i].cardImage; latestImageId = cycle[i].id; break; }
    }
    return { total: total, first: cycle[0], last: cycle[cycle.length - 1], latestImage: latestImage, latestImageId: latestImageId };
  }

  const toAdd = [];
  const toUpdate = [];
  const skipped = [];
  // Précharge TOUTES les URL d'images en 2 requêtes groupées (au lieu d'une par
  // carte, ce qui rendait le bouton interminable).
  const imgJournal = {}, imgClient = {};
  try {
    const SB = "https://xlxnetjrftnnwmmfqswl.supabase.co/rest/v1/";
    const KEY = "sb_publishable_o1GHKowDY3MDT_xZnG3tiQ_xk_ThxxV";
    const hh = { apikey: KEY, Authorization: "Bearer " + KEY };
    // Pagination obligatoire : Supabase plafonne chaque réponse à 1000 lignes.
    const pageAll = async (table) => {
      let out = [], from = 0;
      for (;;) {
        const r = await fetch(SB + table + "?select=id,img:doc->>cardImage&order=id.asc",
          { headers: Object.assign({ Range: from + "-" + (from + 999), "Range-Unit": "items" }, hh), cache: "no-store" });
        if (!r.ok) break;
        const rows = await r.json();
        out = out.concat(rows);
        if (rows.length < 1000) break;
        from += 1000;
        if (from > 100000) break;
      }
      return out;
    };
    const [rj, rc] = await Promise.all([pageAll("clients_jour"), pageAll("clients")]);
    rj.forEach((r) => { if (r.img) imgJournal[r.id] = r.img; });
    rc.forEach((r) => { if (r.img) imgClient[r.id] = r.img; });
  } catch (e) { console.warn("[ACB] Préchargement images échoué :", e.message); }

  for (const card of Object.keys(byCard)) {
    const key = card.toLowerCase();
    if (!cardsToday.has(card) && !RECONCILE_ALL) continue; // hors périmètre
    if (retired.has(key)) { skipped.push(card + " (retirée)"); continue; }
    if (isReplaced(card)) { skipped.push(card + " (remplacée)"); continue; }

    const ci = cycleInfo(byCard[card]);
    const first = ci.first, last = ci.last, totalCarres = ci.total;
    if (totalCarres <= 0) { skipped.push(card + " (0 carré)"); continue; }

    if (known.has(key)) {
      // CLIENT EXISTANT : on met à jour si le nb de carrés diffère du cumul du journal —
      // SAUF si une modification manuelle (admin) plus récente que le journal a eu lieu :
      // dans ce cas on préserve la modification manuelle (pas d'écrasement).
      const existing = clients.find((c) => !c.deleted && String(c.numeroCarte || "").trim().toLowerCase() === key);
      if (!existing) continue;
      const lastJournalTs = tsFromId(last.id) || (last.date ? new Date(last.date).getTime() : 0);
      // Modification plus récente sur la carte (Modifier, carrés, avance) → on garde
      const lastTxTs = Math.max(0, ...(existing.transactions || []).map((t) => tsFromId(t.id) || 0));
      const lastChangeTs = Math.max(existing.lastManualEditAt || 0, lastTxTs);
      if (lastChangeTs > lastJournalTs) { skipped.push(card + " (modifiée après le journal)"); continue; }
      const currentSignes = (existing.transactions || []).filter((t) => t.type === "depot").length;
      const mc = Number(last.montantCarreau) || Number(existing.montantCarreau) || 0;
      const sameName = String(existing.username || "") === String(last.username || existing.username || "");
      // Image : on compare les VRAIES URL (le jeton « __LAZY__ » ne dit rien).
      let journalImg = ci.latestImage;
      if (journalImg === "__LAZY__") journalImg = imgJournal[ci.latestImageId] || null;
      let clientImg = existing.cardImage;
      if (clientImg === "__LAZY__") clientImg = imgClient[existing.id] || null;
      const sameImage = !journalImg || journalImg === clientImg;
      if (currentSignes === totalCarres && sameName && sameImage) continue; // déjà à jour

      // Conserve les transactions non-dépôt (retraits, avances, remplacements)
      const keep = (existing.transactions || []).filter((t) => t.type !== "depot");
      const deposits = [];
      for (let i = 0; i < totalCarres; i++) {
        deposits.push({ id: "t_rec_" + card + "_" + i, type: "depot", amount: mc, date: first.date, note: "Synchronisé depuis le journal" });
      }
      existing.transactions = deposits.concat(keep);
      existing.username = last.username || existing.username;
      existing.montantCarreau = mc;
      existing.cumulCarresSignes = totalCarres;
      if (journalImg) {
        existing.cardImage = journalImg;
        if (window.acbSync && window.acbSync.imageCacheSet) window.acbSync.imageCacheSet(existing.id, journalImg);
      } else if (clientImg) {
        existing.cardImage = clientImg; // garde l'existante plutôt que de l'effacer
      }
      toUpdate.push(existing);
      continue;
    }

    // CLIENT MANQUANT : on le reconstruit entièrement.
    // Si une ancienne fiche « deleted » existe pour ce numéro, on la réactive
    // (même id) au lieu d'en créer une seconde en doublon.
    const revive = clients.find((c) => c.deleted && String(c.numeroCarte || "").trim().toLowerCase() === key);
    // Transactions = un « dépôt » par carré signé (pour recomputer carrés/montant)
    const transactions = [];
    const mcNew = Number(last.montantCarreau) || Number(first.montantCarreau) || 0;
    for (let i = 0; i < totalCarres; i++) {
      transactions.push({ id: "t_rec_" + card + "_" + i, type: "depot", amount: mcNew, date: first.date, note: "Reconstruit depuis le journal" });
    }

    toAdd.push({
      id: (revive && revive.id) || ("c_rec_" + card + "_" + Date.now()),
      deleted: false,
      username: last.username || first.username || "—",
      numeroCarte: card,
      montantCarreau: Number(last.montantCarreau) || Number(first.montantCarreau) || 0,
      balance: 0,
      createdAt: first.date || todayISO(),
      registeredBy: first.registeredBy || "",
      registeredById: first.registeredById || "",
      cardImage: (ci.latestImage === "__LAZY__" ? (imgJournal[ci.latestImageId] || null) : (ci.latestImage || null)),
      cumulCarresSignes: totalCarres,
      transactions: transactions,
    });
  }

  const changed = toAdd.concat(toUpdate);
  // Les images du journal sont en mode « à la demande » (jeton __LAZY__) : on
  // résout la vraie URL AVANT l'écriture, sinon l'enregistrement serait rejeté.
  for (const c of changed) {
    if (c.cardImage === "__LAZY__") c.cardImage = imgJournal[c._imgSrcId] || imgClient[c.id] || null;
    delete c._imgSrcId;
  }
  if (skipped.length) console.info("[ACB] Cartes du journal ignorées :", skipped.join(", "));
  console.info("[ACB] Rafraîchir : " + toAdd.length + " ajout(s), " + toUpdate.length + " mise(s) à jour, " + skipped.length + " ignorée(s) sur " + (RECONCILE_ALL ? Object.keys(byCard).length : cardsToday.size) + " carte(s) du journal.");
  lastReconcileReport = { added: toAdd.length, updated: toUpdate.length, skipped: skipped };
  if (!changed.length) return 0;

  // Écrit dans Supabase (upsert ciblé) + cache local
  if (window.acbSync && window.acbSync.upsertRows) await window.acbSync.upsertRows("acb_clients", changed);
  // Fusionne dans le cache local : remplace les existants, ajoute les nouveaux
  const byId = {};
  getClients().forEach((c) => { byId[String(c.id)] = c; });
  changed.forEach((c) => { byId[String(c.id)] = c; });
  saveClients(Object.keys(byId).map((k) => byId[k]));
  return changed.length;
}

/* Liste « Carte rempli non encaissé » : clients dont les carrés signés = 31
   (carte pleine, pas encore encaissée par un retrait total). */
function renderFullCards() {
  const body = document.getElementById("fullCardsBody");
  if (!body) return;
  const list = getClients().filter((c) => {
    const signes = (c.transactions || []).filter((t) => t.type === "depot").length;
    const retraitTotal = (c.transactions || []).some((t) => t.type === "retrait" && t.note === "Retrait total");
    return signes === 31 && !retraitTotal;
  });
  const lbl = list.length <= 1 ? list.length + " carte" : list.length + " cartes";
  const lblEl = document.getElementById("fullCardsCountLabel");
  if (lblEl) lblEl.textContent = lbl;
  renderClientRows(body, sortNewestFirst(list), "Aucune carte remplie non encaissée.");
  // Teinte rouge légère sur les lignes de cartes remplies
  body.querySelectorAll("tr").forEach((tr) => {
    if (!tr.classList.contains("empty-row")) tr.classList.add("full-card-row");
  });
}

/* -------------------------------------------------------------
   PHOTO CLIENT : capture + compression + enregistrement
   ------------------------------------------------------------- */
let pendingPhotoClientId = null;

document.getElementById("photoInput").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !pendingPhotoClientId) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const max = 240;
      let { width, height } = img;
      if (width > height && width > max) { height = Math.round(height * max / width); width = max; }
      else if (height > max) { width = Math.round(width * max / height); height = max; }

      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

      const clients = getClients();
      const idx = clients.findIndex((c) => c.id === pendingPhotoClientId);
      if (idx !== -1) {
        clients[idx].photo = dataUrl;
        try {
          saveClients(clients);
          toast("Photo enregistrée", "success");
        } catch (err) {
          toast("Stockage plein : photo non enregistrée", "error");
        }
        refreshDashboard();
      }
      pendingPhotoClientId = null;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

/* -------------------------------------------------------------
   6) ENREGISTREMENT D'UN CLIENT
   (déplacé vers l'espace staff — plus de formulaire ici)
   ------------------------------------------------------------- */
// Génère un mot de passe aléatoire de 8 caractères (lettres + chiffres)
// Conservé car réutilisé par la création de comptes staff.
function generatePassword(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const rnd = window.crypto && window.crypto.getRandomValues
    ? Array.from(window.crypto.getRandomValues(new Uint32Array(len)))
    : Array.from({ length: len }, () => Math.floor(Math.random() * 1e9));
  for (let i = 0; i < len; i++) out += chars[rnd[i] % chars.length];
  return out;
}

/* -------------------------------------------------------------
   7) PANNEAU DE GESTION (drawer) : dépôt / retrait / suppression
   ------------------------------------------------------------- */
const drawer = document.getElementById("drawer");
const drawerScrim = document.getElementById("drawerScrim");
let activeClientId = null;

function openDrawer(clientId) {
  activeClientId = clientId;
  renderDrawer();
  drawer.classList.add("open");
  drawerScrim.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  drawer.classList.remove("open");
  drawerScrim.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  activeClientId = null;
}
document.getElementById("drawerClose").addEventListener("click", closeDrawer);
drawerScrim.addEventListener("click", closeDrawer);

function renderDrawer() {
  const client = getClients().find((c) => c.id === activeClientId);
  if (!client) { closeDrawer(); return; }

  document.getElementById("drawerName").textContent = client.username;
  document.getElementById("drawerBalance").textContent = formatNumber(montantTotalClient(client));

  // Pré-remplit le formulaire d'édition
  const eN = document.getElementById("editName");
  const eC = document.getElementById("editCard");
  const eM = document.getElementById("editMontant");
  if (eN) eN.value = client.username || "";
  if (eC) eC.value = client.numeroCarte || "";
  if (eM) eM.value = client.montantCarreau || "";
  const eMsg = document.getElementById("editMsg");
  if (eMsg) { eMsg.textContent = ""; eMsg.className = "form-msg"; }

  const txs = client.transactions || [];
  const cnt = txs.length;
  document.getElementById("drawerTxCount").textContent = (cnt <= 1 ? cnt + " opération" : cnt + " opérations");

  // Carrés signés actuels + réinitialise les compteurs ajouter/enlever
  const carresEl = document.getElementById("drawerCarres");
  if (carresEl) carresEl.textContent = carresSignes(client);
  if (document.getElementById("addCarresNb")) document.getElementById("addCarresNb").value = "1";
  if (document.getElementById("delCarresNb")) document.getElementById("delCarresNb").value = "1";
  if (document.getElementById("carresMsg")) document.getElementById("carresMsg").textContent = "";

  const list = document.getElementById("drawerTx");
  list.innerHTML = "";
  if (!txs.length) {
    list.innerHTML = `<p class="muted" style="font-size:13.5px; padding:14px 0;">Aucune opération enregistrée.</p>`;
    return;
  }
  [...txs].reverse().forEach((t) => {
    const isDep = t.type === "depot";
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:11px;">
        <span class="tx ${isDep ? "depot" : "retrait"}"><span class="pip">
          ${isDep
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`}
        </span></span>
        <div class="meta">
          <div class="t">${isDep ? "Dépôt" : "Retrait"}${t.note ? ` · <span class="muted" style="font-weight:500">${escapeHtml(t.note)}</span>` : ""}</div>
          <div class="d">${formatDate(t.date)} · Solde : ${formatMoney(t.balanceAfter)}</div>
        </div>
      </div>
      <div class="val ${isDep ? "amt-pos" : "amt-neg"}">${isDep ? "+ " : "− "}${formatMoney(t.amount)}</div>
    `;
    list.appendChild(row);
  });
}

/* Écrit UN client directement en base (contourne le lot différé qui est rejeté
   quand l'image est en mode « à la demande »). */
async function pushClientNow(client) {
  if (!window.acbSync || !window.acbSync.upsertRows) return;
  const c2 = Object.assign({}, client);
  if (c2.cardImage === "__LAZY__") {
    let real = window.acbSync.imageCacheGet ? window.acbSync.imageCacheGet(c2.id) : null;
    if (!real && window.acbSync.fetchImage) {
      try { real = await window.acbSync.fetchImage("acb_clients", c2.id); } catch (e) {}
    }
    if (real) c2.cardImage = real;
    else delete c2.cardImage; // pas d'image connue : on n'envoie pas ce champ
  }
  await window.acbSync.upsertRows("acb_clients", [c2]);
}

// Ajouter des carrés signés (chaque carré = un dépôt du montant d'un carré)
document.getElementById("addCarresBtn").addEventListener("click", async () => {
  const msg = document.getElementById("carresMsg");
  msg.className = "form-msg";
  const n = Math.max(1, Math.round(Number(document.getElementById("addCarresNb").value) || 0));
  const clients = getClients();
  const client = clients.find((c) => c.id === activeClientId);
  if (!client) return;
  const mc = Number(client.montantCarreau) || 0;
  if (mc <= 0) { msg.className = "form-msg error"; msg.textContent = "Renseignez d'abord le montant d'un carré (Modifier les informations)."; return; }
  const current = carresSignes(client);
  if (current + n > 31) { msg.className = "form-msg error"; msg.textContent = `Maximum 31 carrés (actuellement ${current}).`; return; }

  client.transactions = client.transactions || [];
  for (let i = 0; i < n; i++) {
    client.balance = (client.balance || 0) + mc;
    client.transactions.push({
      id: "t_" + Date.now() + "_" + i + "_" + Math.random().toString(36).slice(2, 5),
      type: "depot", amount: mc, note: "Carré signé",
      date: todayISO(), balanceAfter: client.balance,
    });
  }
  client.lastManualEditAt = Date.now();
  saveClients(clients);
  await pushClientNow(client);
  renderDrawer();
  refreshDashboard();
  toast(`${n} carré(s) ajouté(s)`, "success");
});

// Enlever des carrés signés (retire les derniers dépôts « carré »)
document.getElementById("delCarresBtn").addEventListener("click", async () => {
  const msg = document.getElementById("carresMsg");
  msg.className = "form-msg";
  const n = Math.max(1, Math.round(Number(document.getElementById("delCarresNb").value) || 0));
  const clients = getClients();
  const client = clients.find((c) => c.id === activeClientId);
  if (!client) return;
  const deposits = (client.transactions || []).filter((t) => t.type === "depot");
  if (n > deposits.length) { msg.className = "form-msg error"; msg.textContent = `Seulement ${deposits.length} carré(s) signé(s).`; return; }

  // Retire les n derniers dépôts et recalcule le solde
  let removed = 0;
  for (let i = client.transactions.length - 1; i >= 0 && removed < n; i--) {
    if (client.transactions[i].type === "depot") { client.transactions.splice(i, 1); removed++; }
  }
  client.balance = (client.transactions || []).reduce((s, t) => s + (t.type === "depot" ? (t.amount || 0) : -(t.amount || 0)), 0);
  client.lastManualEditAt = Date.now();
  saveClients(clients);
  await pushClientNow(client);
  renderDrawer();
  refreshDashboard();
  toast(`${n} carré(s) enlevé(s)`, "success");
});

function applyTransaction(type, amount, note) {
  const clients = getClients();
  const idx = clients.findIndex((c) => c.id === activeClientId);
  if (idx === -1) return;

  const client = clients[idx];
  const newBalance = type === "depot" ? client.balance + amount : client.balance - amount;
  client.balance = newBalance;

  client.transactions = client.transactions || [];
  client.transactions.push({
    id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    type,
    amount,
    note: note || "",
    date: todayISO(),
    balanceAfter: newBalance,
  });

  saveClients(clients);
  renderDrawer();
  refreshDashboard();
  toast(type === "depot" ? "Dépôt enregistré" : "Retrait enregistré", "success");
}

// Enregistre les modifications du client (nom, n° de carte, montant d'un carré)
document.getElementById("editSaveBtn").addEventListener("click", () => {
  const clients = getClients();
  const client = clients.find((c) => c.id === activeClientId);
  const msg = document.getElementById("editMsg");
  if (!client) { closeDrawer(); return; }

  const name = document.getElementById("editName").value.trim();
  const card = document.getElementById("editCard").value.trim();
  const montant = Number(document.getElementById("editMontant").value) || 0;

  if (!name) { msg.className = "form-msg error"; msg.textContent = "Le nom du client est obligatoire."; return; }
  if (!/^\d{4}$/.test(card)) { msg.className = "form-msg error"; msg.textContent = "Le n° de carte doit comporter 4 chiffres."; return; }

  // Le n° de carte ne peut pas être déjà attribué à un AUTRE client.
  const clash = clients.find((c) => c.id !== client.id && String(c.numeroCarte || "").toLowerCase() === card.toLowerCase());
  if (clash) { msg.className = "form-msg error"; msg.textContent = `Ce n° de carte est déjà attribué à « ${clash.username} ».`; return; }

  client.username = name;
  client.numeroCarte = card;
  client.montantCarreau = montant;
  client.lastManualEditAt = Date.now();
  saveClients(clients);
  renderDrawer();
  refreshDashboard();
  toast("Modifications enregistrées", "success");
});

// Suppression du compte (avec confirmation)
document.getElementById("deleteBtn").addEventListener("click", async () => {
  const client = getClients().find((c) => c.id === activeClientId);
  if (!client) return;
  const ok = window.confirm(`Êtes-vous sûr ? Cette action est irréversible.\n\nLe compte « ${client.username} » et tout son historique seront définitivement supprimés.`);
  if (!ok) return;

  const id = activeClientId;
  const card = client.numeroCarte;
  let img = client.cardImage;
  if (img === "__LAZY__" && window.acbSync && window.acbSync.fetchImage) {
    img = await window.acbSync.fetchImage("acb_clients", id);
  }
  // Suppression DÉFINITIVE : retrait local immédiat + DELETE Supabase.
  saveClients(getClients().filter((c) => String(c.id) !== String(id)));
  if (window.acbSync && window.acbSync.deleteRow) window.acbSync.deleteRow("acb_clients", id);
  // Supprime aussi sa photo du bucket (si stockée en lien) et ses entrées de journal
  if (window.acbStorage && window.acbStorage.remove) window.acbStorage.remove(img);
  if (window.acbJournal && window.acbJournal.removeByCard) window.acbJournal.removeByCard(card);
  closeDrawer();
  refreshDashboard();
  toast("Compte supprimé", "success");
});

// Ferme le drawer avec la touche Échap
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
});

/* -------------------------------------------------------------
   8) PARAMÈTRES ADMINISTRATEUR (modale)
   ------------------------------------------------------------- */
const settingsScrim = document.getElementById("settingsScrim");
const settingsForm = document.getElementById("settingsForm");
const settingsMsg = document.getElementById("settingsMsg");
const adminBadge = document.getElementById("adminBadge");

// Met à jour le badge avec le nom affiché enregistré
function applyAdminDisplayName() {
  const creds = getAdminCreds();
  adminBadge.textContent = creds.displayName || "Administrateur";
}

function openSettings() {
  const creds = getAdminCreds();
  document.getElementById("setDisplayName").value = creds.displayName || "Administrateur";
  document.getElementById("setUsername").value = creds.username;
  document.getElementById("setNewPw").value = "";
  document.getElementById("setNewPw2").value = "";
  document.getElementById("setCurrentPw").value = "";
  settingsMsg.textContent = "";
  settingsScrim.classList.add("open");
}
function closeSettings() {
  settingsScrim.classList.remove("open");
}

document.getElementById("settingsBtn").addEventListener("click", openSettings);
document.getElementById("settingsClose").addEventListener("click", closeSettings);
document.getElementById("settingsCancel").addEventListener("click", closeSettings);
settingsScrim.addEventListener("click", (e) => { if (e.target === settingsScrim) closeSettings(); });

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  settingsMsg.className = "form-msg error";

  const creds = getAdminCreds();
  const displayName = document.getElementById("setDisplayName").value.trim();
  const username = document.getElementById("setUsername").value.trim();
  const newPw = document.getElementById("setNewPw").value;
  const newPw2 = document.getElementById("setNewPw2").value;
  const currentPw = document.getElementById("setCurrentPw").value;

  // 1) Mot de passe actuel obligatoire et correct (hash si dispo, sinon ancien clair)
  if (!currentPw) { settingsMsg.textContent = "Saisissez votre mot de passe actuel pour valider."; return; }
  const curOk = creds.passwordHash
    ? (await Auth.sha256(currentPw)) === creds.passwordHash
    : currentPw === creds.password;
  if (!curOk) { settingsMsg.textContent = "Mot de passe actuel incorrect."; return; }

  // 2) Identifiant requis
  if (!username) { settingsMsg.textContent = "L'identifiant de connexion ne peut pas être vide."; return; }

  // 3) Nouveau mot de passe (optionnel)
  let finalHash = creds.passwordHash || (await Auth.sha256(creds.password));
  if (newPw || newPw2) {
    if (newPw.length < 6) { settingsMsg.textContent = "Le nouveau mot de passe doit faire au moins 6 caractères."; return; }
    if (newPw !== newPw2) { settingsMsg.textContent = "Les deux mots de passe ne correspondent pas."; return; }
    finalHash = await Auth.sha256(newPw);
  }

  // Enregistre (mot de passe HACHÉ — jamais en clair)
  saveAdminCreds({
    username,
    passwordHash: finalHash,
    displayName: displayName || "Administrateur",
  });
  applyAdminDisplayName();
  closeSettings();
  toast("Paramètres mis à jour avec succès", "success");
});

// Ferme la modale avec Échap
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsScrim.classList.contains("open")) closeSettings();
});

/* -------------------------------------------------------------
   9) GESTION DU PERSONNEL (STAFF)
   ------------------------------------------------------------- */
const staffPwInput = document.getElementById("newStaffPassword");
const copyStaffPwBtn = document.getElementById("copyStaffPwBtn");

// Génère un mot de passe staff
document.getElementById("genStaffPwBtn").addEventListener("click", () => {
  staffPwInput.value = generatePassword(8);
  copyStaffPwBtn.disabled = false;
});

// Active le bouton « Copier » dès qu'un mot de passe staff est saisi à la main
staffPwInput.addEventListener("input", () => {
  copyStaffPwBtn.disabled = staffPwInput.value.trim() === "";
});

copyStaffPwBtn.addEventListener("click", async () => {
  const val = staffPwInput.value;
  if (!val) return;
  try {
    await navigator.clipboard.writeText(val);
    toast("Mot de passe copié dans le presse-papier", "success");
  } catch (e) {
    staffPwInput.select();
    document.execCommand("copy");
    toast("Mot de passe copié", "success");
  }
});

// Affiche la liste du personnel
function refreshStaffList() {
  const list = getStaff();
  const label = list.length <= 1 ? list.length + " membre" : list.length + " membres";
  document.getElementById("staffCountLabel").textContent = label;

  const body = document.getElementById("staffBody");
  body.innerHTML = "";

  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">Aucun membre du personnel. Créez le premier compte staff ci-dessus.</td></tr>`;
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
          <span class="pw-dots" data-pw="${escapeHtml(s.password)}">••••••••</span>
          <button type="button" class="pw-eye" aria-label="Afficher / masquer le mot de passe">
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

  body.querySelectorAll(".del-staff-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteStaff(btn.dataset.id));
  });

  // Afficher / masquer chaque mot de passe staff
  body.querySelectorAll(".pw-eye").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dots = btn.parentElement.querySelector(".pw-dots");
      const shown = dots.classList.toggle("revealed");
      dots.textContent = shown ? dots.dataset.pw : "••••••••";
      btn.classList.toggle("on", shown);
    });
  });
}

// Création d'un compte staff
document.getElementById("staffCreateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("staffCreateMsg");
  msg.className = "form-msg error";

  const displayName = document.getElementById("newStaffDisplay").value.trim();
  const username = document.getElementById("newStaffUsername").value.trim();
  const password = staffPwInput.value;

  if (!username) { msg.textContent = "Renseignez un nom d'utilisateur."; return; }
  if (!password) { msg.textContent = "Générez d'abord un mot de passe."; return; }

  const list = getStaff();
  if (list.some((s) => s.username.toLowerCase() === username.toLowerCase())) {
    msg.textContent = "Ce nom d'utilisateur staff existe déjà.";
    return;
  }

  list.push({
    id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    username,
    password,
    displayName: displayName || username,
    createdAt: todayISO(),
  });
  saveStaff(list);

  msg.className = "form-msg success";
  msg.textContent = `Compte staff « ${username} » créé. Mot de passe : ${password}`;
  toast("Compte staff créé avec succès", "success");

  document.getElementById("newStaffDisplay").value = "";
  document.getElementById("newStaffUsername").value = "";
  staffPwInput.value = "";
  copyStaffPwBtn.disabled = true;

  refreshStaffList();
});

// Suppression d'un compte staff (avec confirmation)
function deleteStaff(id) {
  const member = getStaff().find((s) => s.id === id);
  if (!member) return;
  const ok = window.confirm(`Supprimer le compte staff « ${member.username} » ?\n\nCette personne ne pourra plus se connecter à l'espace staff.`);
  if (!ok) return;

  saveStaff(getStaff().filter((s) => String(s.id) !== String(id)));
  if (window.acbSync && window.acbSync.deleteRow) window.acbSync.deleteRow("acb_staff", id);
  refreshStaffList();
  toast("Compte staff supprimé", "success");
}

/* -------------------------------------------------------------
   10) INITIALISATION
   ------------------------------------------------------------- */
(function init() {
  if (!localStorage.getItem(LS_CLIENTS)) {
    localStorage.setItem(LS_CLIENTS, JSON.stringify([]));
  }
  applyAdminDisplayName();
  // Période par défaut = AUJOURD'HUI (Bénéfices et Montant décaissé du jour)
  // — défini AVANT le premier rendu pour que les montants soient ceux du jour.
  (function () {
    const f = document.getElementById("statsFrom");
    const t = document.getElementById("statsTo");
    const today = todayISO();
    if (f && !f.value) f.value = today;
    if (t && !t.value) t.value = today;
  })();
  migrateRetiredCards();
  purgeRetiredFromClients();
  // Rejoue la migration une fois la synchro Supabase prête (push de suppression garanti)
  window.acbOnReady = function () {
    migrateRetiredCards();
    purgeRetiredFromClients();
    refreshDashboard();
  };
  refreshDashboard();
  refreshStaffList();

  // Recherche dans la liste de tous les clients
  const searchEl = document.getElementById("clientSearch");
  if (searchEl) searchEl.addEventListener("input", renderAllClients);

  // Bouton « Rafraîchir » : recharge la liste depuis la base de données
  const refreshBtn = document.getElementById("refreshClientsBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    const svg = refreshBtn.querySelector("svg");
    if (svg) { svg.style.transition = "transform .6s"; svg.style.transform = "rotate(360deg)"; }
    try {
      const changed = await reconcileFromJournal();
      await renderAllClients();
      const r = lastReconcileReport;
      if (r && (r.added || r.updated)) {
        toast(`${r.added} ajout(s), ${r.updated} mise(s) à jour` + (r.skipped.length ? ` — ${r.skipped.length} carte(s) ignorée(s)` : ""), "success");
      } else if (r && r.skipped.length) {
        toast(`Aucun changement — ${r.skipped.length} carte(s) ignorée(s) (retirées/remplacées)`, "info");
      } else {
        toast("Liste à jour — aucun changement", "success");
      }
    }
    finally {
      refreshBtn.disabled = false;
      if (svg) setTimeout(() => { svg.style.transition = "none"; svg.style.transform = "none"; }, 600);
    }
  });

  // Le sélecteur de période recalcule les montants des cartes
  const periodEl = document.getElementById("statsPeriod");
  const customRange = document.getElementById("customRange");
  const fromEl = document.getElementById("statsFrom");
  const toEl = document.getElementById("statsTo");
  // Par défaut : période = AUJOURD'HUI (Bénéfices et Montant décaissé du jour).
  const todayStr = todayISO();
  if (fromEl && !fromEl.value) fromEl.value = todayStr;
  if (toEl && !toEl.value) toEl.value = todayStr;
  function syncCustomVisibility() {
    if (customRange) customRange.style.display = (periodEl && periodEl.value === "custom") ? "flex" : "none";
  }
  if (periodEl) {
    periodEl.addEventListener("change", () => { syncCustomVisibility(); refreshDashboard(); });
    syncCustomVisibility();
  }
  if (fromEl) fromEl.addEventListener("change", refreshDashboard);
  if (toEl) toEl.addEventListener("change", refreshDashboard);

  // Bouton œil : masquer / afficher les montants
  updateStatsEye();
  const eyeBtn = document.getElementById("statsEye");
  if (eyeBtn) eyeBtn.addEventListener("click", toggleStatsHidden);

  // Déconnexion automatique par inactivité
  setupAutoLogout({
    minutes: AUTO_LOGOUT_ADMIN_MINUTES,
    onLogout: () => {
      Auth.endSession("admin");
      window.location.href = "admin.html?timeout=1";
    },
    onWarn: () => toast("Déconnexion dans 1 minute pour inactivité", "error"),
  });
})();

/* -------------------------------------------------------------
   RETRAIT DE CARTE (modale)
   ------------------------------------------------------------- */
const retraitScrim = document.getElementById("retraitScrim");
let retraitClientId = null;

function openRetrait() {
  retraitClientId = null;
  document.getElementById("retraitSearch").value = "";
  document.getElementById("retraitSuggest").innerHTML = "";
  document.getElementById("retraitSuggest").classList.remove("open");
  document.getElementById("retraitClientBox").style.display = "none";
  document.getElementById("retraitTypeBox").style.display = "none";
  document.getElementById("retraitAvanceBox").style.display = "none";
  document.getElementById("retraitMontant").value = "";
  document.querySelector('input[name="retraitType"][value="total"]').checked = true;
  document.getElementById("retraitMsg").textContent = "";
  document.getElementById("retraitSave").disabled = true;
  retraitScrim.classList.add("open");
  setTimeout(() => document.getElementById("retraitSearch").focus(), 100);
}
function closeRetrait() { retraitScrim.classList.remove("open"); }

if (document.getElementById("viewRetiresBtn")) {
  document.getElementById("viewRetiresBtn").addEventListener("click", () => {
    location.href = "cartes-retirees.html";
  });
}

document.getElementById("retraitCarteBtn").addEventListener("click", openRetrait);
document.getElementById("retraitClose").addEventListener("click", closeRetrait);
document.getElementById("retraitCancel").addEventListener("click", closeRetrait);
retraitScrim.addEventListener("click", (e) => { if (e.target === retraitScrim) closeRetrait(); });

/* Sélection d'une carte trouvée */
function selectRetraitClient(c) {
  retraitClientId = c.id;
  document.getElementById("retraitSearch").value = `${c.numeroCarte || "—"} · ${c.username || ""}`;
  document.getElementById("retraitSuggest").classList.remove("open");
  document.getElementById("retraitSuggest").innerHTML = "";
  document.getElementById("retraitCardNum").textContent = c.numeroCarte || "—";
  document.getElementById("retraitClientName").textContent = c.username || "—";
  document.getElementById("retraitSolde").textContent = formatMoney(montantTotalClient(c));
  document.getElementById("retraitClientBox").style.display = "block";
  document.getElementById("retraitTypeBox").style.display = "block";
  document.getElementById("retraitMsg").textContent = "";
  document.getElementById("retraitSave").disabled = false;
}

/* Recherche par n° de carte ou nom du client */
document.getElementById("retraitSearch").addEventListener("input", function () {
  retraitClientId = null;
  document.getElementById("retraitSave").disabled = true;
  document.getElementById("retraitClientBox").style.display = "none";
  document.getElementById("retraitTypeBox").style.display = "none";
  const q = this.value.trim().toLowerCase();
  const box = document.getElementById("retraitSuggest");
  box.innerHTML = "";
  if (!q) { box.classList.remove("open"); return; }
  const retSet = new Set(getCartesRetirees().filter((c) => !c.deleted).map((c) => String(c.numeroCarte || "").trim().toLowerCase()));
  const matches = getClients().filter((c) =>
    !c.deleted &&
    !retSet.has(String(c.numeroCarte || "").trim().toLowerCase()) &&
    (String(c.numeroCarte || "").toLowerCase().includes(q) ||
     String(c.username || "").toLowerCase().includes(q))
  ).slice(0, 6);
  if (!matches.length) { box.classList.remove("open"); return; }
  matches.forEach((c) => {
    const item = document.createElement("div");
    item.className = "cs-item";
    item.innerHTML = `
      <span class="cs-num">${escapeHtml(c.numeroCarte || "—")}</span>
      <span class="cs-name">${escapeHtml(c.username || "—")}</span>
      <span class="cs-amount">${formatMoney(c.balance)}</span>
    `;
    item.addEventListener("mousedown", (e) => { e.preventDefault(); selectRetraitClient(c); });
    item.addEventListener("click", (e) => { e.preventDefault(); selectRetraitClient(c); });
    box.appendChild(item);
  });
  box.classList.add("open");
});

/* Champ montant visible uniquement pour l'avance */
document.querySelectorAll('input[name="retraitType"]').forEach((r) => {
  r.addEventListener("change", () => {
    const avance = document.querySelector('input[name="retraitType"]:checked').value === "avance";
    document.getElementById("retraitAvanceBox").style.display = avance ? "block" : "none";
  });
});

/* Enregistre le retrait (total ou avance) */
document.getElementById("retraitSave").addEventListener("click", () => {
  const msg = document.getElementById("retraitMsg");
  msg.className = "form-msg error";
  const clients = getClients();
  const idx = clients.findIndex((c) => c.id === retraitClientId);
  if (idx === -1) { msg.textContent = "Sélectionnez d'abord une carte."; return; }
  const client = clients[idx];
  const type = document.querySelector('input[name="retraitType"]:checked').value;
  const solde = Math.max(0, montantTotalClient(client));

  let amount, note;
  if (type === "total") {
    if (solde <= 0) { msg.textContent = "Le solde de cette carte est déjà à 0."; return; }
    amount = solde;
    note = "Retrait total";
  } else {
    amount = Math.round(Number(document.getElementById("retraitMontant").value) || 0);
    if (amount <= 0) { msg.textContent = "Saisissez le montant de l'avance."; return; }
    if (amount > solde) { msg.textContent = `Solde insuffisant : le solde est de ${formatMoney(solde)}.`; return; }
    note = "Avance sur carte";
  }

  const ok = window.confirm(`Confirmer le ${type === "total" ? "retrait total" : "retrait (avance)"} de ${formatMoney(amount)} sur la carte ${client.numeroCarte || "—"} (${client.username}) ?`);
  if (!ok) return;

  const newBalance = solde - amount;
  client.balance = newBalance;
  client.transactions = client.transactions || [];
  client.transactions.push({
    id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    type: "retrait",
    amount,
    note,
    date: todayISO(),
    balanceAfter: newBalance,
  });

  if (type === "total") {
    // RETRAIT TOTAL : on retire la carte de la base clients (Supabase « clients »)
    // et on la déplace vers « Cartes retirées » (Supabase « cartes_retirees »).
    const retired = Object.assign({}, client, {
      retraitDate: todayISO(),
      montantRetire: amount,
    });
    const cr = getCartesRetirees();
    if (!cr.some((x) => String(x.id) === String(client.id))) cr.push(retired);
    saveCartesRetirees(cr);
    // Écriture CIBLÉE dans « cartes_retirees » (ne dépend pas du lot différé)
    if (window.acbSync && window.acbSync.upsertRows) {
      window.acbSync.upsertRows("acb_cartes_retirees", [retired]);
    }
    // Suppression DÉFINITIVE côté clients : retrait local immédiat + DELETE
    // Supabase (le marqueur « deleted » seul pouvait être restauré par une
    // synchronisation ultérieure, la carte réapparaissait alors dans la liste).
    saveClients(clients.filter((c) => String(c.id) !== String(client.id)));
    if (window.acbSync && window.acbSync.deleteRow) {
      window.acbSync.deleteRow("acb_clients", client.id);
    }
  } else {
    saveClients(clients);
    // Écriture ciblée pour que l'avance parte immédiatement en base
    if (window.acbSync && window.acbSync.upsertRows) {
      const c2 = Object.assign({}, client);
      if (c2.cardImage === "__LAZY__") {
        const real = window.acbSync.imageCacheGet ? window.acbSync.imageCacheGet(c2.id) : null;
        // Sans l'image réelle on n'écrit PAS (sinon on l'effacerait en base) :
        // le mécanisme d'envoi normal s'en chargera.
        if (real) { c2.cardImage = real; window.acbSync.upsertRows("acb_clients", [c2]); }
      } else {
        window.acbSync.upsertRows("acb_clients", [c2]);
      }
    }
  }
  closeRetrait();
  refreshDashboard();
  toast(`${note} enregistré — ${formatMoney(amount)}`, "success");
});

/* =============================================================
   REMPLACEMENT DE CARTE
   Recherche la carte à remplacer, recopie ses infos (nom, montant
   d'un carré, carrés signés) sur un NOUVEAU n° de carte saisi.
   ------------------------------------------------------------- */
const remplacementScrim = document.getElementById("remplacementScrim");
let remplClientId = null;
let remplNewImage = null; // image scannée de la nouvelle carte (conservée même si illisible)

function carresSignes(c) {
  return (c.transactions || []).filter((t) => t.type === "depot").length;
}

function openRemplacement() {
  remplClientId = null;
  document.getElementById("remplacementSearch").value = "";
  document.getElementById("remplacementSuggest").innerHTML = "";
  document.getElementById("remplacementSuggest").classList.remove("open");
  document.getElementById("remplacementClientBox").style.display = "none";
  document.getElementById("remplNewCard").value = "";
  document.getElementById("remplacementMsg").textContent = "";
  document.getElementById("remplacementSave").disabled = true;
  remplNewImage = null;
  remplacementScrim.classList.add("open");
  setTimeout(() => document.getElementById("remplacementSearch").focus(), 100);
}
function closeRemplacement() { remplacementScrim.classList.remove("open"); }

document.getElementById("remplacementCarteBtn").addEventListener("click", openRemplacement);
document.getElementById("remplacementClose").addEventListener("click", closeRemplacement);
document.getElementById("remplacementCancel").addEventListener("click", closeRemplacement);
remplacementScrim.addEventListener("click", (e) => { if (e.target === remplacementScrim) closeRemplacement(); });

/* Sélection de la carte à remplacer → recopie ses infos */
function selectRemplClient(c) {
  remplClientId = c.id;
  document.getElementById("remplacementSearch").value = `${c.numeroCarte || "—"} · ${c.username || ""}`;
  document.getElementById("remplacementSuggest").classList.remove("open");
  document.getElementById("remplacementSuggest").innerHTML = "";
  document.getElementById("remplOldCard").value = c.numeroCarte || "—";
  document.getElementById("remplOldName").value = c.username || "—";
  document.getElementById("remplOldMontant").value = formatMoney(c.montantCarreau || 0);
  document.getElementById("remplOldCarres").value = carresSignes(c);
  document.getElementById("remplacementClientBox").style.display = "block";
  document.getElementById("remplacementMsg").textContent = "";
  document.getElementById("remplacementSave").disabled = false;
}

/* Recherche par n° de carte ou nom du client */
document.getElementById("remplacementSearch").addEventListener("input", function () {
  remplClientId = null;
  document.getElementById("remplacementSave").disabled = true;
  document.getElementById("remplacementClientBox").style.display = "none";
  const q = this.value.trim().toLowerCase();
  const box = document.getElementById("remplacementSuggest");
  box.innerHTML = "";
  if (!q) { box.classList.remove("open"); return; }
  const retiredSet = new Set(getCartesRetirees().filter((c) => !c.deleted).map((c) => String(c.numeroCarte || "").trim().toLowerCase()));
  const matches = getClients().filter((c) =>
    !c.deleted &&
    !retiredSet.has(String(c.numeroCarte || "").trim().toLowerCase()) &&
    !(window.acbReplaced && window.acbReplaced.has(c.numeroCarte)) &&
    (String(c.numeroCarte || "").toLowerCase().includes(q) ||
     String(c.username || "").toLowerCase().includes(q))
  ).slice(0, 6);
  if (!matches.length) { box.classList.remove("open"); return; }
  matches.forEach((c) => {
    const item = document.createElement("div");
    item.className = "cs-item";
    item.innerHTML = `
      <span class="cs-num">${escapeHtml(c.numeroCarte || "—")}</span>
      <span class="cs-name">${escapeHtml(c.username || "—")}</span>
      <span class="cs-amount">${formatMoney(montantTotalClient(c))}</span>
    `;
    item.addEventListener("mousedown", (e) => { e.preventDefault(); selectRemplClient(c); });
    item.addEventListener("click", (e) => { e.preventDefault(); selectRemplClient(c); });
    box.appendChild(item);
  });
  box.classList.add("open");
});

/* N° de la nouvelle carte : chiffres uniquement, max 4 */
document.getElementById("remplNewCard").addEventListener("input", function () {
  this.value = this.value.replace(/\D/g, "").slice(0, 4);
});

/* Scanner la nouvelle carte : ouvre l'appareil photo / la galerie puis lit le n° */
document.getElementById("remplScanBtn").addEventListener("click", () => {
  document.getElementById("remplScanInput").click();
});
document.getElementById("remplScanInput").addEventListener("change", async function () {
  const file = this.files && this.files[0];
  this.value = "";
  if (!file) return;
  const msg = document.getElementById("remplacementMsg");
  const btn = document.getElementById("remplScanBtn");

  // Compresse l'image pour l'analyse (réduit à 820px de large)
  function shrink(f) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = function () {
        const max = 820, scale = Math.min(1, max / img.width);
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL("image/jpeg", 0.7).split(",")[1]); }
        catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(f);
    });
  }
  // Compresse l'image pour le STOCKAGE (1100px, conservée même si illisible)
  function shrinkStore(f) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = function () {
        const max = 1100, scale = Math.min(1, max / img.width);
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL("image/jpeg", 0.72)); }
        catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(f);
    });
  }

  // On CONSERVE TOUJOURS l'image (même illisible ou n° différent)
  remplNewImage = await shrinkStore(file);

  // Saisie manuelle du n° (aucune dépendance externe) : l'image est conservée.
  msg.className = "form-msg success";
  msg.textContent = "Image enregistrée. Saisissez le n° de la nouvelle carte.";
});

/* Confirme le remplacement : recopie les infos sur le nouveau n° */
document.getElementById("remplacementSave").addEventListener("click", async () => {
  const msg = document.getElementById("remplacementMsg");
  msg.className = "form-msg error";
  const clients = getClients();
  const client = clients.find((c) => c.id === remplClientId);
  if (!client) { msg.textContent = "Sélectionnez d'abord la carte à remplacer."; return; }

  // Une carte RETIRÉE (retrait total) ne peut plus être remplacée.
  const oldNum = String(client.numeroCarte || "").trim().toLowerCase();
  if (getCartesRetirees().some((c) => !c.deleted && String(c.numeroCarte || "").trim().toLowerCase() === oldNum)) {
    msg.textContent = `Cette carte (n° ${client.numeroCarte}) a été retirée : elle ne peut plus être remplacée.`; return;
  }
  if (window.acbReplaced && window.acbReplaced.has(client.numeroCarte)) {
    msg.textContent = `Cette carte (n° ${client.numeroCarte}) a déjà été remplacée.`; return;
  }

  const newCard = document.getElementById("remplNewCard").value.trim();
  if (!/^\d{4}$/.test(newCard)) { msg.textContent = "Le nouveau n° de carte doit comporter 4 chiffres."; return; }
  if (String(newCard) === String(client.numeroCarte)) { msg.textContent = "Le nouveau n° est identique à l'ancien."; return; }

  // Le nouveau n° ne doit pas déjà être utilisé par un autre client actif…
  const clash = clients.find((c) => c.id !== client.id && String(c.numeroCarte || "").toLowerCase() === newCard.toLowerCase());
  if (clash) { msg.textContent = `Ce n° de carte est déjà attribué à « ${clash.username} ».`; return; }
  // …ni figurer parmi les cartes retirées.
  if (getCartesRetirees().some((c) => String(c.numeroCarte || "").toLowerCase() === newCard.toLowerCase())) {
    msg.textContent = `Ce n° de carte (${newCard}) a déjà été retiré.`; return;
  }
  // …ni parmi les cartes déjà remplacées (ancien n° définitivement bloqué).
  if (window.acbReplaced && window.acbReplaced.has(newCard)) {
    msg.textContent = `Ce n° de carte (${newCard}) a déjà été remplacé et ne peut plus être réutilisé.`; return;
  }

  const oldCard = client.numeroCarte;
  const ok = window.confirm(`Remplacer la carte n° ${oldCard} (${client.username}) par la carte n° ${newCard} ?\nLe nom, le montant d'un carré et les ${carresSignes(client)} carré(s) signé(s) seront conservés.`);
  if (!ok) return;

  // Remplacement : on change le n° sur la MÊME fiche (transactions/carrés/solde conservés)
  client.numeroCarte = newCard;

  // Enregistre l'image scannée de la nouvelle carte (conservée même si illisible).
  if (remplNewImage) {
    let toStore = remplNewImage;
    if (remplNewImage.indexOf("data:") === 0 && window.acbStorage && window.acbStorage.upload) {
      try { const url = await window.acbStorage.upload(remplNewImage, newCard); if (url) toStore = url; }
      catch (e) { /* on garde le base64 */ }
    }
    client.cardImage = toStore;
  }

  // L'ancien n° est définitivement bloqué (plus d'enregistrement/MAJ/retrait possible).
  if (window.acbReplaced && window.acbReplaced.add) window.acbReplaced.add(oldCard);

  client.transactions = client.transactions || [];
  client.transactions.push({
    id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    type: "remplacement",
    note: `Remplacement carte n° ${oldCard} → ${newCard}`,
    date: todayISO(),
    balanceAfter: client.balance,
  });
  saveClients(clients);

  closeRemplacement();
  refreshDashboard();
  toast(`Carte n° ${oldCard} remplacée par n° ${newCard}`, "success");
});

/* =============================================================
   NOTIFICATIONS (cloche admin)
   Sources : enregistrements du jour, cartes remplies non encaissées
   (31 carrés), cartes retirées du jour. État « lu » en localStorage.
   ------------------------------------------------------------- */
const LS_NOTIF_READ = "acb_notif_read";
const LS_JOURNAL = "acb_clients_jour";

// Cache du journal pour les notifications, rafraîchi DIRECTEMENT depuis Supabase
// (l'appareil admin n'a pas toujours le cache local du journal à jour).
let notifJournalCache = null;
function getJournalEntries() {
  // Si la lecture distante a déjà rempli le cache, on l'utilise ; sinon repli local.
  if (Array.isArray(notifJournalCache)) return notifJournalCache;
  try {
    const a = JSON.parse(localStorage.getItem(LS_JOURNAL) || "[]");
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function getNotifRead() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_NOTIF_READ) || "[]");
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function setNotifRead(ids) {
  // On borne la liste pour éviter qu'elle ne grossisse indéfiniment
  localStorage.setItem(LS_NOTIF_READ, JSON.stringify(ids.slice(-500)));
}

/* Construit la liste des notifications (les plus récentes en premier) */
function buildNotifications() {
  const items = [];
  const today = todayISO();

  // 1) Enregistrements du jour (nouvelle carte / mise à jour)
  getJournalEntries()
    .filter((e) => String(e.date).split("T")[0] === today)
    .forEach((e) => {
      const isNew = e.type !== "mise à jour";
      items.push({
        id: "j_" + (e.id || (e.numeroCarte + "_" + e.date)),
        sort: recordTime(e),
        kind: isNew ? "new" : "update",
        icon: "gold",
        title: `${isNew ? "Nouvelle carte" : "Mise à jour"} · ${escapeHtml(e.username || "—")}`,
        meta: `N° ${escapeHtml(e.numeroCarte || "—")} · ${e.registeredBy ? "par " + escapeHtml(e.registeredBy) + " · " : ""}${formatMoney(e.montantTotal)}`,
        href: "journal.html",
      });
    });

  // 2) Cartes remplies non encaissées (31 carrés signés)
  getClients().forEach((c) => {
    const signes = (c.transactions || []).filter((t) => t.type === "depot").length;
    const retraitTotal = (c.transactions || []).some((t) => t.type === "retrait" && t.note === "Retrait total");
    if (signes === 31 && !retraitTotal) {
      items.push({
        id: "full_" + c.id,
        sort: recordTime(c),
        kind: "full",
        icon: "red",
        title: `Carte remplie · ${escapeHtml(c.username || "—")}`,
        meta: `N° ${escapeHtml(c.numeroCarte || "—")} · 31 carrés — à encaisser`,
        href: "#",
      });
    }
  });

  // 3) Cartes retirées aujourd'hui
  getCartesRetirees()
    .filter((c) => String(c.retraitDate || "").split("T")[0] === today)
    .forEach((c) => {
      items.push({
        id: "ret_" + c.id,
        sort: new Date(c.retraitDate || c.createdAt || 0).getTime() || recordTime(c),
        kind: "retrait",
        icon: "",
        title: `Carte retirée · ${escapeHtml(c.username || "—")}`,
        meta: `N° ${escapeHtml(c.numeroCarte || "—")} · ${formatMoney(c.montantRetire)}`,
        href: "cartes-retirees.html",
      });
    });

  return items.sort((a, b) => b.sort - a.sort);
}

async function refreshNotifications() {
  const list = document.getElementById("notifList");
  const badge = document.getElementById("notifBadge");
  const bell = document.getElementById("notifBell");
  if (!list || !badge || !bell) return;

  // Récupère le journal DIRECTEMENT depuis Supabase pour que les notifications
  // d'enregistrement apparaissent sur tous les appareils (pas seulement celui
  // qui a saisi). Repli silencieux sur le cache local si la lecture échoue.
  try {
    if (window.acbJournal && window.acbJournal.fetchRemote) {
      const remote = await window.acbJournal.fetchRemote();
      if (Array.isArray(remote)) notifJournalCache = remote;
    }
  } catch (e) {}

  const items = buildNotifications();
  const read = new Set(getNotifRead());
  const unread = items.filter((it) => !read.has(it.id)).length;

  badge.textContent = unread > 99 ? "99+" : String(unread);
  badge.hidden = unread === 0;
  bell.classList.toggle("has-unread", unread > 0);

  if (!items.length) {
    list.innerHTML = `<div class="notif-empty">Aucune notification.</div>`;
    return;
  }

  const icons = {
    gold: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    red: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    "": `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  };

  list.innerHTML = items.slice(0, 10).map((it) => `
    <a class="notif-item ${read.has(it.id) ? "" : "unread"}" href="${it.href}">
      <span class="notif-ic ${it.icon}">${icons[it.icon] || icons[""]}</span>
      <span class="notif-body">
        <span class="notif-title">${it.title}</span>
        <span class="notif-meta">${it.meta}</span>
      </span>
    </a>`).join("");
}

/* Ouverture / fermeture du panneau */
(function initNotif() {
  const bell = document.getElementById("notifBell");
  const pop = document.getElementById("notifPop");
  const clearBtn = document.getElementById("notifClear");
  if (!bell || !pop) return;

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    if (open) {
      refreshNotifications();
      // À l'ouverture, on marque tout comme lu
      const ids = buildNotifications().map((it) => it.id);
      const merged = Array.from(new Set([...getNotifRead(), ...ids]));
      setNotifRead(merged);
      // Met à jour le badge sans recharger la liste (garde le surlignage "unread")
      const badge = document.getElementById("notifBadge");
      if (badge) { badge.hidden = true; }
      bell.classList.remove("has-unread");
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ids = buildNotifications().map((it) => it.id);
      setNotifRead(Array.from(new Set([...getNotifRead(), ...ids])));
      refreshNotifications();
    });
  }

  // Fermeture au clic extérieur
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !bell.contains(e.target)) pop.hidden = true;
  });

  // Rafraîchissement périodique (capte les nouveautés synchronisées via Supabase)
  setInterval(refreshNotifications, 20000);
  refreshNotifications();
})();

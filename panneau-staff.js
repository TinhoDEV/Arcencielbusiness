/* =================================================================
   Arc en Ciel Business — Panneau STAFF (panneau-staff.js)
   Tableau de bord du personnel (accès après connexion staff).
   Mêmes fonctions de gestion des clients que l'admin, sans les
   réglages admin ni la gestion du personnel.
   ================================================================= */

const LS_CLIENTS = "acb_clients";
const LS_STAFF = "acb_staff";
const LS_STAFF_SESSION = "acb_staff_session";

/* -------------------------------------------------------------
   GARDE D'ACCÈS : sans session staff valide, retour à la connexion.
   ------------------------------------------------------------- */
const staffSessionId = Auth.requireRole("staff");

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
/* Vrai si le n° de carte figure dans les cartes RETIRÉES (retrait total)
   OU dans les cartes REMPLACÉES (ancien n°) : plus aucun enregistrement
   ni mise à jour n'est alors autorisé. */
const LS_CARTES_RETIREES = "acb_cartes_retirees";
function isCardRetired(numeroCarte) {
  const n = String(numeroCarte).trim().toLowerCase();
  // Carte remplacée (ancien n° définitivement bloqué, synchronisé via config)
  try {
    if (window.acbReplaced && window.acbReplaced.has(numeroCarte)) return true;
  } catch (e) {}
  try {
    const a = JSON.parse(localStorage.getItem(LS_CARTES_RETIREES) || "[]");
    if (!Array.isArray(a)) return false;
    return a.some((c) => !c.deleted && String(c.numeroCarte || "").trim().toLowerCase() === n);
  } catch (e) { return false; }
}
/* Vérification DISTANTE (base) : la carte est-elle retirée ou remplacée ?
   Le cache local peut être obsolète (retrait fait depuis un autre appareil),
   on interroge donc Supabase directement. Résultat mis en cache 60 s. */
const __retChk = {};
async function isCardRetiredRemote(numeroCarte) {
  const n = String(numeroCarte).trim().toLowerCase();
  if (!n) return false;
  const hit = __retChk[n];
  if (hit && Date.now() - hit.t < 60000) return hit.v;
  try {
    const SB = "https://xlxnetjrftnnwmmfqswl.supabase.co/rest/v1/";
    const KEY = "sb_publishable_o1GHKowDY3MDT_xZnG3tiQ_xk_ThxxV";
    const hh = { apikey: KEY, Authorization: "Bearer " + KEY };
    const r = await fetch(SB + "cartes_retirees?select=id&doc->>numeroCarte=eq." + encodeURIComponent(String(numeroCarte).trim()) + "&limit=1", { headers: hh, cache: "no-store" });
    if (!r.ok) return false;
    const v = (await r.json()).length > 0;
    __retChk[n] = { v: v, t: Date.now() };
    return v;
  } catch (e) { return false; }
}
function saveClients(clients) {
  try {
    localStorage.setItem(LS_CLIENTS, JSON.stringify(clients));
    return true;
  } catch (e) {    // Stockage local plein : on réessaie en allégeant (sans les images de cartes)
    // pour ne JAMAIS perdre les données du client.
    try {
      const slim = clients.map((c) => Object.assign({}, c, { cardImage: c.cardImage ? "__TOO_BIG__" : c.cardImage }));
      localStorage.setItem(LS_CLIENTS, JSON.stringify(slim));
      if (typeof toast === "function") toast("Stockage plein : client enregistré, mais image trop lourde non conservée", "error");
      return true;
    } catch (e2) {
      if (typeof toast === "function") toast("Stockage plein : impossible d'enregistrer", "error");
      return false;
    }
  }
}
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
   4) IDENTITÉ DU STAFF CONNECTÉ + DÉCONNEXION
   ------------------------------------------------------------- */
function loadStaffIdentity() {
  const member = getStaff().find((s) => s.id === staffSessionId);
  if (!member) {
    // Le compte a peut-être été supprimé par l'admin -> on déconnecte
    Auth.endSession("staff");
    window.location.replace("staff.html");
    return;
  }
  const name = member.displayName || member.username;
  document.getElementById("staffNameTop").textContent = name;
  document.getElementById("staffAvatar").textContent = name.slice(0, 2).toUpperCase();
}

document.getElementById("staffLogoutBtn").addEventListener("click", () => {
  Auth.endSession("staff");
  window.location.href = "staff.html";
});

/* -------------------------------------------------------------
   5) STATISTIQUES + LISTE DES CLIENTS
   ------------------------------------------------------------- */
// Extrait l'horodatage (Date.now) contenu dans un id "t_1780..._3"
function tsFromId(id) {
  const m = String(id || "").match(/(\d{10,})/);
  return m ? Number(m[1]) : 0;
}
// Un client est "actif aujourd'hui" s'il a été enregistré OU mis à jour aujourd'hui
function isActiveToday(c, today) {
  if (String(c.createdAt).split("T")[0] === today) return true;
  return (c.transactions || []).some((t) => String(t.date).split("T")[0] === today);
}
// Horodatage de la dernière activité du jour (pour trier : plus récent en haut)
function todayActivityTs(c, today) {
  let ts = 0;
  (c.transactions || []).forEach((t) => {
    if (String(t.date).split("T")[0] === today) ts = Math.max(ts, tsFromId(t.id));
  });
  if (!ts && String(c.createdAt).split("T")[0] === today) ts = tsFromId(c.id);
  return ts;
}

async function refreshDashboard(dataOverride) {
  // AFFICHAGE IMMÉDIAT depuis le cache local, puis rafraîchissement dès que
  // les données Supabase arrivent (plus d'attente réseau avant tout affichage).
  let allClients, jentries;
  if (dataOverride) {
    allClients = dataOverride.clients;
    jentries = dataOverride.journal;
  } else {
    allClients = getClients();
    jentries = getJournalEntries();
    Promise.all([
      window.acbSync && window.acbSync.fetchTable ? window.acbSync.fetchTable("acb_clients") : null,
      window.acbJournal && window.acbJournal.fetchRemote ? window.acbJournal.fetchRemote() : null,
    ]).then(function (r) {
      if (r[0] || r[1]) refreshDashboard({ clients: r[0] || allClients, journal: r[1] || jentries });
    });
  }
  const clients = allClients.filter(isMine);

  const totalClients = clients.length;

  const today = todayISO();
  const myToday = jentries.filter(
    (e) => String(e.date).split("T")[0] === today && isMine(e)
  );
  // Montant journalier reçu = somme des montants totaux enregistrés par l'agent aujourd'hui
  const dailyAmount = myToday.reduce((s, e) => s + (Number(e.montantTotal) || 0), 0);
  // Cartes journalières signées = nombre de clients (cartes distinctes) enregistrés aujourd'hui
  const dailyCards = new Set(myToday.map((e) => e.numeroCarte)).size;

  // Montant journalier reçu (masquable via le bouton œil)
  const dailyAmountEl = document.getElementById("statDailyAmount");
  dailyAmountEl.dataset.value = formatMoney(dailyAmount);
  dailyAmountEl.textContent = localStorage.getItem("acb_hide_daily_amount") !== "0"
    ? "••••••"
    : formatMoney(dailyAmount);
  document.getElementById("statDailyCards").textContent = dailyCards;

  // --- DÉTAIL DU JOURNAL (entrées du jour) ---
  renderJournalToday();

  // --- Liste de TOUS les clients (avec recherche) ---
  renderAllClients();
}

/* Lit le journal permanent "client du jour" */
function getJournalEntries() {
  try {
    const a = JSON.parse(localStorage.getItem("acb_clients_jour") || "[]");
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

/* Affiche le détail du journal du jour (1 ligne par enregistrement,
   les plus récents en haut, les plus anciens en bas). */
/* Affiche le détail du journal du jour (1 ligne par enregistrement,
   les plus récents en haut, les plus anciens en bas). */
function agentNames() {
  // Noms identifiant l'agent connecté (pour filtrer ses propres données)
  const me = getStaff().find((s) => s.id === staffSessionId);
  return me ? [me.displayName, me.username].filter(Boolean) : [];
}
// Vrai si l'enregistrement (client ou entrée de journal) appartient à l'agent connecté.
// Priorité à l'id STABLE du staff (fiable entre appareils) ; repli sur le nom
// normalisé pour les anciennes données enregistrées avant ce champ.
function isMine(rec) {
  if (!rec) return false;
  if (rec.registeredById != null && String(rec.registeredById) === String(staffSessionId)) return true;
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const names = agentNames().map(norm);
  return names.includes(norm(rec.registeredBy));
}
async function renderJournalToday(entriesOverride) {
  const today = todayISO();
  // AFFICHAGE IMMÉDIAT depuis le cache local, puis rafraîchissement dès que
  // les données Supabase arrivent (évite l'attente réseau avant tout affichage).
  let entries = entriesOverride || null;
  if (!entries) {
    entries = getJournalEntries();
    if (window.acbJournal && window.acbJournal.fetchRemote) {
      window.acbJournal.fetchRemote().then(function (remote) {
        if (remote) renderJournalToday(remote);
      });
    }
  }
  if (!entries) entries = getJournalEntries();
  const list = entries
    .filter((e) => String(e.date).split("T")[0] === today)
    .filter(isMine)
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));

  const body = document.getElementById("clientsBody");
  const label = document.getElementById("clientCountLabel");
  if (label) label.textContent = list.length + (list.length <= 1 ? " entrée" : " entrées");
  body.innerHTML = "";

  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">Aucune entrée de journal aujourd'hui.</td></tr>`;
    return;
  }

  list.forEach((e) => {
    const tr = document.createElement("tr");
    if (e.type !== "mise à jour") tr.classList.add("new-entry-row");
    tr.innerHTML = `
      <td><span class="code-pill">${escapeHtml(e.numeroCarte || "—")}</span></td>
      <td><strong style="color:var(--navy)">${escapeHtml(e.username || "—")}</strong></td>
      <td class="muted">${formatDate(e.date)}</td>
      <td class="muted">${escapeHtml(e.registeredBy || "—")}</td>
      <td style="text-align:right" class="num-cell">${e.montantCarreau ? formatMoney(e.montantCarreau) : "—"}</td>
      <td style="text-align:center"><span class="pill">${Number(e.nbCarres) || 0}</span></td>
      <td style="text-align:right" class="num-cell">${formatMoney(e.montantTotal)}</td>
      <td style="text-align:right">
        ${e.cardImage
          ? `<button class="btn btn-ghost btn-sm view-jcard-btn" data-id="${escapeHtml(e.id)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir la carte</button>`
          : `<button class="btn btn-ghost btn-sm" disabled title="Aucune photo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg> Voir la carte</button>`}
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
}

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

/* Construit le HTML d'une ligne client */
function clientRowHtml(c, todayMode) {
  const today = todayISO();
  // En mode "liste du jour", on compte les carrés signés AUJOURD'HUI
  // (ou la somme regroupée par carte via _todayCount) ;
  // sinon le total cumulé de tous les carrés signés.
  const carreauxSignes = todayMode
    ? (c._todayCount != null
        ? c._todayCount
        : (c.transactions || []).filter((t) => t.type === "depot" && String(t.date).split("T")[0] === today).length)
    : (c.transactions || []).filter((t) => t.type === "depot").length;
  const montantCarreau = Number(c.montantCarreau) || 0;
  const total = montantCarreau * carreauxSignes;
  return `
    <td><span class="code-pill">${escapeHtml(c.numeroCarte || "—")}</span></td>
    <td>
      <div style="display:flex; align-items:center; gap:11px;">
        <span class="avatar" style="width:30px; height:30px; font-size:12px;">${escapeHtml(c.username.slice(0,2).toUpperCase())}</span>
        <strong style="color:var(--navy)">${escapeHtml(c.username)}</strong>
      </div>
    </td>
    <td class="muted">${formatDate(c.createdAt)}</td>
    <td class="muted">${escapeHtml(c.registeredBy || "—")}</td>
    <td style="text-align:right" class="num-cell">${montantCarreau ? formatMoney(montantCarreau) : "—"}</td>
    <td style="text-align:center"><span class="pill">${carreauxSignes}</span></td>
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
    </td>
  `;
}

/* Remplit un tbody avec une liste de clients + branche les boutons */
function renderClientRows(body, list, emptyMsg, todayMode) {
  body.innerHTML = "";
  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${emptyMsg}</td></tr>`;
    return;
  }
  list.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = clientRowHtml(c, todayMode);
    body.appendChild(tr);
  });
  body.querySelectorAll(".manage-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDrawer(btn.dataset.id));
  });
  body.querySelectorAll(".view-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = getClients().find((x) => x.id === btn.dataset.id);
      if (c) showCardImage(c);
    });
  });
}

/* Liste de tous les clients, filtrée par la recherche (n° de carte ou nom) */
async function renderAllClients() {
  const allBody = document.getElementById("allClientsBody");
  if (!allBody) return; // section absente (espace staff)
  const q = (document.getElementById("clientSearch")?.value || "").trim().toLowerCase();
  // Récupère les clients DIRECTEMENT depuis la base de données (repli cache si hors-ligne)
  let allClients = null;
  if (window.acbSync && window.acbSync.fetchTable) {
    allClients = await window.acbSync.fetchTable("acb_clients");
  }
  if (!allClients) allClients = getClients();
  let list = allClients.filter(isMine);
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
    list,
    q ? "Aucun client trouvé pour cette recherche." : "Aucun client enregistré."
  );
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
      // Réduit la photo (max 240px) pour ne pas saturer le stockage
      const max = 240;
      let { width, height } = img;
      if (width > height && width > max) { height = Math.round(height * max / width); width = max; }
      else if (height > max) { width = Math.round(width * max / height); height = max; }

      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

      // Enregistre sur le client
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
   ------------------------------------------------------------- */
function generatePassword(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const rnd = window.crypto && window.crypto.getRandomValues
    ? Array.from(window.crypto.getRandomValues(new Uint32Array(len)))
    : Array.from({ length: len }, () => Math.floor(Math.random() * 1e9));
  for (let i = 0; i < len; i++) out += chars[rnd[i] % chars.length];
  return out;
}

/* Calcul en direct du montant total dans la ligne d'enregistrement */
let willExceeds31 = false; // vrai si "Cela fera" dépasse 31 -> enregistrement bloqué
function updateRegTotal() {
  const m = Math.max(0, Number(document.getElementById("newMontantCarreau").value) || 0);
  const n = Math.max(0, Number(document.getElementById("newNbCarreaux").value) || 0);
  document.getElementById("regTotal").textContent = formatMoney(Math.round(m * n));
  updateWillBeText();
}
// Texte "Cela fera X carré(s) signé(s)" = carrés déjà en base + nombre de carrés saisi
function updateWillBeText() {
  const el = document.getElementById("willBe");
  if (!el) return;
  const card = document.getElementById("newCardNumber").value.trim();
  const n = Math.max(0, Number(document.getElementById("newNbCarreaux").value) || 0);
  let dbCount = 0;
  if (/^[0-9]{4}$/.test(card)) {
    const ex = getClients().find((c) => String(c.numeroCarte) === card);
    if (ex) dbCount = (ex.transactions || []).filter((t) => t.type === "depot").length;
  }
  const totalWill = dbCount + n;
  willExceeds31 = totalWill > 31;
  if (willExceeds31) {
    el.textContent = `Erreur : cela ferait ${totalWill} carrés signés (maximum 31). Réduisez le nombre de carrés.`;
    el.classList.add("will-error");
  } else {
    el.textContent = `Cela fera ${totalWill} carré${totalWill > 1 ? "s" : ""} signé${totalWill > 1 ? "s" : ""}`;
    el.classList.remove("will-error");
  }
  el.classList.toggle("show", /^[0-9]{4}$/.test(card) && n > 0 && !scanFewerSquares);
}
// Remplit le sélecteur « Nombre de carrés » (de 1 à 31)
(function fillNbCarreaux() {
  const sel = document.getElementById("newNbCarreaux");
  for (let i = 1; i <= 31; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
  sel.value = "1";
})();
document.getElementById("newMontantCarreau").addEventListener("input", updateRegTotal);
document.getElementById("newNbCarreaux").addEventListener("change", function () {
  // Modification manuelle après scan -> on lève le blocage "aucun nouveau carré"
  if (Number(this.value) > 0) scanFewerSquares = false;
  updateRegTotal();
});

// N° de carte : chiffres uniquement, max 4 + suggestions des cartes existantes
const cardInput = document.getElementById("newCardNumber");
const cardSuggest = document.getElementById("cardSuggest");
const newCardFlash = document.getElementById("newCardFlash");

// Affiche/masque le flash « Nouvelle carte — n° introuvable »
function setNewCardFlash(show) {
  if (!newCardFlash) return;
  newCardFlash.classList.toggle("show", !!show);
}
// Vérifie si un n° (4 chiffres) existe déjà ; met à jour le flash en conséquence
function checkCardFlash() {
  const q = cardInput.value.trim();
  if (q.length < 4) { setNewCardFlash(false); return; }
  // Carte déjà RETIRÉE (retrait total) → blocage immédiat dès la saisie.
  if (isCardRetired(q)) {
    setNewCardFlash(false);
    const cmsg = document.getElementById("createMsg");
    if (cmsg) { cmsg.className = "form-msg error"; cmsg.textContent = `Cette carte (n° ${q}) a déjà été retirée ou remplacée. Aucun nouvel enregistrement ni mise à jour n'est possible.`; }
    toast(`Carte n° ${q} déjà retirée ou remplacée — enregistrement impossible`, "error");
    return;
  }
  const exists = getClients().some((c) => String(c.numeroCarte) === q);
  setNewCardFlash(!exists);
  // Vérification DISTANTE en parallèle (le cache local peut ignorer un retrait
  // fait depuis un autre appareil).
  isCardRetiredRemote(q).then(function (isRet) {
    if (!isRet || cardInput.value.trim() !== q) return;
    setNewCardFlash(false);
    const m = document.getElementById("createMsg");
    if (m) { m.className = "form-msg error"; m.textContent = `Cette carte (n° ${q}) a déjà été retirée ou remplacée. Aucun nouvel enregistrement ni mise à jour n'est possible.`; }
    toast(`Carte n° ${q} déjà retirée ou remplacée — enregistrement impossible`, "error");
  });
}

function fillFromClient(c) {
  document.getElementById("newCardNumber").value = c.numeroCarte || "";
  document.getElementById("newUsername").value = c.username || "";
  document.getElementById("newMontantCarreau").value = c.montantCarreau || "";
  updateRegTotal();
  cardSuggest.classList.remove("open");
  cardSuggest.innerHTML = "";
  setNewCardFlash(false); // carte connue
}

function renderCardSuggestions() {
  const q = cardInput.value.trim();
  cardSuggest.innerHTML = "";
  if (!q) { cardSuggest.classList.remove("open"); return; }
  const matches = getClients().filter((c) => String(c.numeroCarte || "").startsWith(q));
  if (!matches.length) { cardSuggest.classList.remove("open"); return; }
  matches.slice(0, 6).forEach((c) => {
    const item = document.createElement("div");
    item.className = "cs-item";
    item.innerHTML = `
      <span class="cs-num">${escapeHtml(c.numeroCarte || "—")}</span>
      <span class="cs-name">${escapeHtml(c.username || "—")}</span>
      <span class="cs-amount">${c.montantCarreau ? formatMoney(c.montantCarreau) : "—"}</span>
    `;
    item.addEventListener("mousedown", (e) => { e.preventDefault(); fillFromClient(c); });
    cardSuggest.appendChild(item);
  });
  cardSuggest.classList.add("open");
}

  cardInput.addEventListener("input", function () {
    this.value = this.value.replace(/\D/g, "").slice(0, 4);
    renderCardSuggestions();
    checkCardFlash();
    scanUpdateClientId = null; // saisie manuelle -> annule le mode mise à jour
    scanFewerSquares = false;
  });
cardInput.addEventListener("focus", renderCardSuggestions);
cardInput.addEventListener("blur", () => setTimeout(() => cardSuggest.classList.remove("open"), 150));

/* -------------------------------------------------------------
   PHOTO DE LA CARTE (scan / galerie) — l'image est conservée, saisie manuelle
   ------------------------------------------------------------- */
const scanBtn = document.getElementById("scanCardBtn");
const scanInput = document.getElementById("scanCardInput");
const scanHint = document.getElementById("scanHint");
const scanBar = document.querySelector(".scan-bar");

// Dernière image de carte scannée (enregistrée avec le client)
let lastScanCardImage = null;
// Si on a scanné une carte DÉJÀ existante -> id du client à mettre à jour
let scanUpdateClientId = null;
// Vrai si la nouvelle photo montre MOINS de carrés que la base (incohérent)
let scanFewerSquares = false;
// Vrai pendant le traitement d'une photo (empêche un enregistrement prématuré)
let scanInProgress = false;
// Affiche « Photo prête » pour que l'agent sache qu'il peut enregistrer
function setPhotoReady(ready) {
  const el = document.getElementById("scanHint");
  if (el && ready) { el.textContent = "\u2713 Photo prête — vous pouvez enregistrer."; el.style.color = "#0f7b3f"; }
  else if (el && !ready) { el.style.color = ""; }
}

if (scanBtn && scanInput) {
  const scanGalleryInput = document.getElementById("scanGalleryInput");
  const scanMenu = document.getElementById("scanMenu");
  const scanCameraOpt = document.getElementById("scanCameraOpt");
  const scanGalleryOpt = document.getElementById("scanGalleryOpt");

  // Clic sur « Scanner la carte » -> ouvre le menu (caméra / galerie)
  scanBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (scanMenu) scanMenu.hidden = !scanMenu.hidden;
  });
  // Option « Prendre une photo » -> caméra (capture)
  if (scanCameraOpt) scanCameraOpt.addEventListener("click", () => {
    if (scanMenu) scanMenu.hidden = true;
    scanInput.value = ""; scanInput.click();
  });
  // Option « Choisir dans la galerie » -> sélecteur de fichiers sans capture
  if (scanGalleryOpt) scanGalleryOpt.addEventListener("click", () => {
    if (scanMenu) scanMenu.hidden = true;
    scanGalleryInput.value = ""; scanGalleryInput.click();
  });
  // Ferme le menu si on clique ailleurs
  document.addEventListener("click", (e) => {
    if (scanMenu && !scanMenu.hidden && !scanMenu.contains(e.target) && e.target !== scanBtn) {
      scanMenu.hidden = true;
    }
  });

  scanInput.addEventListener("change", () => {
    const file = scanInput.files && scanInput.files[0];
    if (file) analyzeCard(file);
  });
  if (scanGalleryInput) scanGalleryInput.addEventListener("change", () => {
    const file = scanGalleryInput.files && scanGalleryInput.files[0];
    if (file) analyzeCard(file);
  });
}

// Réduit l'image au strict minimum tout en gardant chiffres et signatures lisibles.
// Robuste sur téléphone : essaie createImageBitmap (économe en mémoire, gère
// l'orientation EXIF), puis repli sur Image + objectURL. Sortie : base64 JPEG.
function drawToB64(src, naturalW, naturalH) {
  const max = 1000; // dimension maximale (px)
  let width = naturalW, height = naturalH;
  if (width > max || height > max) {
    const r = Math.min(max / width, max / height);
    width = Math.round(width * r); height = Math.round(height * r);
  }
  const cv = document.createElement("canvas");
  cv.width = width; cv.height = height;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, width, height);
  return cv.toDataURL("image/jpeg", 0.65).split(",")[1]; // ≈ 50–110 Ko
}

async function fileToCompressedBase64(file) {
  // 1) Voie moderne : createImageBitmap (meilleure gestion mémoire sur mobile)
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const b64 = drawToB64(bmp, bmp.width, bmp.height);
      if (bmp.close) bmp.close();
      return b64;
    } catch (e) { /* repli ci-dessous */ }
  }
  // 2) Repli classique : Image + objectURL
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try { const b64 = drawToB64(img, img.naturalWidth || img.width, img.naturalHeight || img.height); URL.revokeObjectURL(url); resolve(b64); }
      catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function setScanBusy(busy, msg) {
  if (!busy) scanInProgress = false;
  if (scanBar) scanBar.classList.toggle("busy", busy);
  if (scanHint) {
    scanHint.innerHTML = busy
      ? `<span class="spin"></span> ${msg || "Traitement de la photo…"}`
      : (msg || "Prenez une photo de la carte, puis remplissez les champs.");
  }
  if (scanBtn) scanBtn.disabled = busy;
}

// Réduit une Data URL existante vers un base64 JPEG plus petit (stockage léger).
// Renvoie null si échec.
function shrinkDataUrlToB64(dataUrl, max, q) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (w > max || h > max) {
          const r = Math.min(max / w, max / h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL("image/jpeg", q || 0.6).split(",")[1]); }
        catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch (e) { resolve(null); }
  });
}

// Lit un fichier en Data URL brute (sans canvas) — repli fiable sur mobile.
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Capture l'image de la carte de façon ROBUSTE :
//  - essaie d'abord la compression canvas (léger, idéal) ;
//  - en cas d'échec (mémoire mobile, HEIC iPhone…), repli sur le fichier brut.
async function captureCardImage(file) {
  // 1) Compression canvas directe (idéal : JPEG léger)
  try {
    const b64 = await fileToCompressedBase64(file);
    if (b64) return { dataUrl: "data:image/jpeg;base64," + b64, b64 };
  } catch (e) { /* repli ci-dessous */ }
  // 2) Repli : lire le fichier brut PUIS le RE-ENCODER en JPEG via canvas.
  //    Gère le HEIC iPhone décodable par <img> et garantit un format AFFICHABLE.
  try {
    const raw = await readFileAsDataURL(file);
    if (raw) {
      const jb64 = await shrinkDataUrlToB64(raw, 1000, 0.65);
      if (jb64) return { dataUrl: "data:image/jpeg;base64," + jb64, b64: jb64 };
      // Image non décodable par le navigateur (ex. HEIC sur Android/Chrome) :
      // on n'enregistre PAS le blob brut illisible (évite image cassée + quota).
      return { dataUrl: null, b64: null, undecodable: true };
    }
  } catch (e) { /* échec total */ }
  return { dataUrl: null, b64: null };
}

async function analyzeCard(file) {
  scanInProgress = true;
  setScanBusy(true);
  // On stocke TOUJOURS la photo (capture robuste) : même si la compression
  // échoue (mobile), la photo est conservée et l'enregistrement reste possible.
  const cap = await captureCardImage(file);
  if (!cap.dataUrl) {
    if (cap.undecodable) {
      setScanBusy(false, "Format d'image non pris en charge (souvent HEIC iPhone). Utilisez l'appareil photo, ou choisissez une image JPEG/PNG.");
      toast("Format non pris en charge — utilisez l'appareil photo", "error");
    } else {
      setScanBusy(false, "Impossible de lire cette photo. Réessayez avec une autre image.");
      toast("Photo illisible — réessayez", "error");
    }
    return;
  }
  lastScanCardImage = cap.dataUrl; // conservée pour l'enregistrement
  setPhotoReady(true);
  // Saisie MANUELLE (aucune dépendance externe) : la photo est conservée,
  // l'agent renseigne les champs lui-même.
  scanUpdateClientId = null;
  scanFewerSquares = false;
  setNewCardFlash(true);
  if (cardSuggest) cardSuggest.classList.remove("open");
  setScanBusy(false, "Photo enregistrée — remplissez les champs puis enregistrez.");
  toast("Photo enregistrée", "success");
}

// Efface le message d'erreur dès que l'utilisateur ressaisit un champ après une erreur.
document.getElementById("createForm").addEventListener("input", () => {
  const msg = document.getElementById("createMsg");
  if (msg && msg.classList.contains("error")) {
    msg.className = "form-msg";
    msg.textContent = "";
  }
});

document.getElementById("createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("createMsg");
  msg.className = "form-msg error";

  const numeroCarte = document.getElementById("newCardNumber").value.trim();
  const username = document.getElementById("newUsername").value.trim();
  const montantCarreau = Math.max(0, Math.round(Number(document.getElementById("newMontantCarreau").value) || 0));
  const password = generatePassword(8); // mot de passe généré automatiquement

  if (!numeroCarte) { msg.textContent = "Renseignez le numéro de la carte."; return; }
  if (!/^[0-9]{4}$/.test(numeroCarte)) { msg.textContent = "Le numéro de carte doit comporter exactement 4 chiffres."; return; }
  if (!username) { msg.textContent = "Renseignez le nom du client."; return; }
  if (!montantCarreau) { msg.textContent = "Renseignez le montant d'un carré."; return; }

  // BLOCAGE : carte déjà RETIRÉE (retrait total) → plus d'enregistrement ni de mise à jour possible
  if (isCardRetired(numeroCarte) || await isCardRetiredRemote(numeroCarte)) {
    msg.textContent = `Cette carte (n° ${numeroCarte}) a déjà été retirée ou remplacée. Aucun nouvel enregistrement ni mise à jour n'est possible.`;
    toast(`Carte n° ${numeroCarte} déjà retirée/remplacée — opération impossible`, "error");
    setScanBusy(false, `Carte n° ${numeroCarte} déjà retirée/remplacée — opération impossible.`);
    return;
  }

  // Traitement encore en cours : on évite le faux message « scannez la carte »
  if (scanInProgress && !lastScanCardImage) {
    msg.className = "form-msg error";
    msg.textContent = "Traitement de la photo en cours… patientez un instant puis réessayez.";
    return;
  }
  // Photo de la carte obligatoire (scan requis)
  if (!lastScanCardImage) {
    msg.textContent = "Photo de la carte obligatoire : scannez la carte avant d'enregistrer.";
    toast("Scannez d'abord la carte", "error");
    return;
  }

  // OPTIMISATION STOCKAGE : on envoie la photo dans Supabase Storage (bucket)
  // et on ne garde qu'une URL courte à la place du base64. Cela évite de saturer
  // le stockage local du navigateur (~5 Mo) et la base de données.
  // Repli : si l'envoi échoue (bucket absent / hors-ligne), on garde l'image base64.
  if (lastScanCardImage && lastScanCardImage.indexOf("data:") === 0 && window.acbStorage) {
    try {
      const url = await window.acbStorage.upload(lastScanCardImage, numeroCarte);
      if (url) lastScanCardImage = url;
    } catch (err) { /* on garde le base64 */ }
  }

  // Blocage : la photo montrait moins de carrés que la base
  if (scanFewerSquares) {
    msg.textContent = "Mise à jour bloquée : la photo montre moins de carrés signés que la base. Vérifiez la carte.";
    return;
  }

  // Blocage : le total dépasserait 31 carrés
  if (willExceeds31) {
    msg.textContent = "Erreur : le total dépasserait 31 carrés signés (maximum d'une carte). Réduisez le nombre de carrés.";
    return;
  }

  // --- MODE MISE À JOUR : carte existante scannée ---
  // Sécurité : une carte est identifiée par son NUMÉRO. Si ce numéro existe déjà
  // dans la base, c'est forcément une mise à jour — même si le scan n'a pas
  // positionné le drapeau (saisie manuelle du n°, détection ratée, etc.).
  // Cela évite le faux blocage « Ce nom de client existe déjà » lors d'une mise à jour.
  if (!scanUpdateClientId) {
    const existByNum = getClients().find((c) => String(c.numeroCarte) === String(numeroCarte));
    if (existByNum) scanUpdateClientId = existByNum.id;
  }
  if (scanUpdateClientId) {
    const clients = getClients();
    const idx = clients.findIndex((c) => c.id === scanUpdateClientId);
    if (idx !== -1) {
      const client = clients[idx];
      // Sécurité : le nom saisi/scanné doit correspondre au nom attribué à ce
      // numéro de carte dans la base. Sinon, on BLOQUE l'enregistrement.
      const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (username && norm(username) !== norm(client.username)) {
        msg.className = "form-msg error";
        msg.textContent = `Ce numéro de carte (${client.numeroCarte}) est attribué à « ${client.username} », pas à « ${username} ». Enregistrement bloqué.`;
        toast("Nom différent de la base — enregistrement bloqué", "error");
        return;
      }
      const nbNew = Math.max(0, Math.round(Number(document.getElementById("newNbCarreaux").value) || 0));
      const mc = Number(client.montantCarreau) || montantCarreau;
      client.transactions = client.transactions || [];
      let bal = Number(client.balance) || 0;
      for (let i = 0; i < nbNew; i++) {
        bal += mc;
        client.transactions.push({
          id: "t_" + Date.now() + "_" + i,
          type: "depot",
          amount: mc,
          note: "Carré signé (mise à jour carte)",
          date: todayISO(),
          balanceAfter: bal,
        });
      }
      client.balance = bal;
      client.createdAt = todayISO(); // enregistré avec la date du jour
      if (lastScanCardImage) client.cardImage = lastScanCardImage; // remplace l'ancienne image
      saveClients(clients);

      // Journal permanent « client du jour »
      const meU = getStaff().find((s) => s.id === staffSessionId);
      const regByU = meU ? (meU.displayName || meU.username) : "Staff";
      if (window.acbJournal) window.acbJournal.add({
        id: "j_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        numeroCarte: client.numeroCarte,
        username: client.username,
        montantCarreau: mc,
        nbCarres: nbNew,
        montantTotal: mc * nbNew,
        date: todayISO(),
        registeredBy: regByU,
        registeredById: staffSessionId,
        type: "mise à jour",
        cardImage: client.cardImage || lastScanCardImage || null,
      });

      msg.className = "form-msg success";
      msg.textContent = `Carte ${numeroCarte} mise à jour — ${nbNew} nouveau(x) carré(s) ajouté(s).`;
      toast("Carte mise à jour", "success");

      document.getElementById("newCardNumber").value = "";
      document.getElementById("newUsername").value = "";
      document.getElementById("newMontantCarreau").value = "";
      document.getElementById("newNbCarreaux").value = "1";
      updateRegTotal();
      setNewCardFlash(false);
      lastScanCardImage = null;
      scanUpdateClientId = null;
      refreshDashboard();
      return;
    }
    scanUpdateClientId = null; // client introuvable -> création normale
  }

  const clients = getClients();
  // Un même NOM peut posséder PLUSIEURS numéros de carte → on n'interdit donc PAS
  // les noms en double. En revanche, un NUMÉRO de carte ne peut porter qu'un seul nom
  // (garanti plus haut : tout numéro déjà présent passe en mise à jour avec contrôle du nom).
  if (clients.some((c) => (c.numeroCarte || "").toLowerCase() === numeroCarte.toLowerCase())) {
    msg.textContent = "Ce numéro de carte est déjà attribué.";
    return;
  }

  const nbCarreaux = Math.max(0, Math.round(Number(document.getElementById("newNbCarreaux").value) || 0));

  const me = getStaff().find((s) => s.id === staffSessionId);
  const registeredBy = me ? (me.displayName || me.username) : "Staff";

  const newClient = {
    id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    numeroCarte,
    username,
    password,
    montantCarreau,
    balance: montantCarreau * nbCarreaux,
    createdAt: todayISO(),
    registeredBy,
    registeredById: staffSessionId,
    cardImage: lastScanCardImage || null,
    cumulCarresSignes: nbCarreaux,
    transactions: [],
  };

  // Pré-signe les carrés déjà payés au moment de l'enregistrement
  for (let i = 0; i < nbCarreaux; i++) {
    newClient.transactions.push({
      id: "t_" + Date.now() + "_" + i,
      type: "depot",
      amount: montantCarreau,
      note: "Carré signé (enregistrement)",
      date: todayISO(),
      balanceAfter: montantCarreau * (i + 1),
    });
  }

  clients.push(newClient);
  saveClients(clients);

  // Journal permanent « client du jour »
  if (window.acbJournal) window.acbJournal.add({
    id: "j_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    numeroCarte,
    username,
    montantCarreau,
    nbCarres: nbCarreaux,
    montantTotal: montantCarreau * nbCarreaux,
    date: todayISO(),
    registeredBy,
    registeredById: staffSessionId,
    type: "nouvel enregistrement",
    cardImage: lastScanCardImage || null,
  });

  msg.className = "form-msg success";
  msg.textContent = `Client « ${username} » enregistré (carte ${numeroCarte}).`;
  toast("Client enregistré avec succès", "success");

  document.getElementById("newCardNumber").value = "";
  document.getElementById("newUsername").value = "";
  document.getElementById("newMontantCarreau").value = "";
  document.getElementById("newNbCarreaux").value = "1";
  updateRegTotal();
  setNewCardFlash(false);
  lastScanCardImage = null;

  refreshDashboard();
});

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
  document.getElementById("drawerBalance").textContent = formatNumber(client.balance);

  const txs = client.transactions || [];
  const cnt = txs.length;
  document.getElementById("drawerTxCount").textContent = (cnt <= 1 ? cnt + " opération" : cnt + " opérations");

  // Pré-remplit le dépôt avec le montant d'un carré (signer un carré)
  document.getElementById("depAmount").value = client.montantCarreau ? client.montantCarreau : "";
  document.getElementById("depNote").value = "";
  document.getElementById("retAmount").value = "";
  document.getElementById("retNote").value = "";

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

document.getElementById("depBtn").addEventListener("click", () => {
  const amount = Math.round(Number(document.getElementById("depAmount").value) || 0);
  const note = document.getElementById("depNote").value.trim();
  if (amount <= 0) { toast("Montant de dépôt invalide", "error"); return; }
  applyTransaction("depot", amount, note);
});

document.getElementById("retBtn").addEventListener("click", () => {
  const amount = Math.round(Number(document.getElementById("retAmount").value) || 0);
  const note = document.getElementById("retNote").value.trim();
  if (amount <= 0) { toast("Montant de retrait invalide", "error"); return; }

  const client = getClients().find((c) => c.id === activeClientId);
  if (!client) return;
  if (amount > client.balance) {
    toast("Solde insuffisant pour ce retrait", "error");
    return;
  }
  applyTransaction("retrait", amount, note);
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

document.getElementById("deleteBtn").addEventListener("click", () => {
  const client = getClients().find((c) => c.id === activeClientId);
  if (!client) return;
  const ok = window.confirm(`Êtes-vous sûr ? Cette action est irréversible.\n\nLe compte « ${client.username} » et tout son historique seront définitivement supprimés.`);
  if (!ok) return;

  const clients = getClients().filter((c) => c.id !== activeClientId);
  saveClients(clients);
  closeDrawer();
  refreshDashboard();
  toast("Compte supprimé", "success");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
});

/* -------------------------------------------------------------
   8) INITIALISATION
   ------------------------------------------------------------- */
(function init() {
  if (!localStorage.getItem(LS_CLIENTS)) {
    localStorage.setItem(LS_CLIENTS, JSON.stringify([]));
  }
  loadStaffIdentity();
  refreshDashboard();

  // Recherche dans la liste de tous les clients
  const searchEl = document.getElementById("clientSearch");
  if (searchEl) searchEl.addEventListener("input", renderAllClients);

  // Bouton œil : masquer / afficher le "Montant journalier reçu"
  const toggleAmt = document.getElementById("toggleDailyAmount");
  if (toggleAmt) {
    toggleAmt.addEventListener("click", () => {
      const hidden = localStorage.getItem("acb_hide_daily_amount") !== "0";
      const next = hidden ? "0" : "1";
      localStorage.setItem("acb_hide_daily_amount", next);
      // Synchronise la préférence vers Supabase (partagée entre appareils)
      if (window.acbConfig && typeof window.acbConfig.setRaw === "function") {
        window.acbConfig.setRaw("pref_hide_daily_amount", next);
      }
      const el = document.getElementById("statDailyAmount");
      el.textContent = hidden ? (el.dataset.value || el.textContent) : "••••••";
    });
  }

  // Déconnexion automatique par inactivité
  setupAutoLogout({
    minutes: AUTO_LOGOUT_STAFF_MINUTES,
    onLogout: () => {
      Auth.endSession("staff");
      window.location.href = "staff.html?timeout=1";
    },
    onWarn: () => toast("Déconnexion dans 1 minute pour inactivité", "error"),
  });
})();

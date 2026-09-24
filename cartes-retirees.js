/* =================================================================
   Arc en Ciel Business — Page « Cartes retirées »
   Liste uniquement les cartes ayant fait l'objet d'un retrait.
   Accès réservé à l'administrateur. Lecture seule.
   ================================================================= */

/* --- Garde d'accès admin --- */
Auth.requireRole("admin");

const LS_CLIENTS = "acb_clients";

/* --- Stockage / helpers (page autonome) --- */
function getClients() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_CLIENTS) || "[]");
    return Array.isArray(arr) ? arr.filter((x) => !x.deleted) : [];
  } catch (e) { return []; }
}
const LS_CARTES_RETIREES = "acb_cartes_retirees";
function getCartesRetirees() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_CARTES_RETIREES) || "[]");
    return Array.isArray(a) ? a.filter((x) => !x.deleted) : [];
  } catch (e) { return []; }
}
function saveCartesRetirees(arr) {
  localStorage.setItem(LS_CARTES_RETIREES, JSON.stringify(arr));
}
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
  } else { d = new Date(value); }
  if (isNaN(d)) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* --- Rendu de la liste des cartes retirées --- */
function renderRetirees() {
  const body = document.getElementById("retiresBody");
  if (!body) return;

  // Source principale : magasin « Cartes retirées » (Supabase « cartes_retirees »).
  const byId = {};
  getCartesRetirees().forEach((c) => {
    const montant = c.montantRetire != null
      ? Number(c.montantRetire) || 0
      : (c.transactions || []).filter((t) => t.type === "retrait" && t.note === "Retrait total").reduce((s, t) => s + (Number(t.amount) || 0), 0);
    byId[c.id] = { ...c, totalRetrait: montant, lastRetraitDate: c.retraitDate || todayISO() };
  });

  // Repli (cartes héritées encore présentes dans la base clients).
  getClients().forEach((c) => {
    const retraitsTotaux = (c.transactions || []).filter((t) => t.type === "retrait" && t.note === "Retrait total");
    if (!retraitsTotaux.length || byId[c.id]) return;
    const last = retraitsTotaux.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    byId[c.id] = {
      ...c,
      totalRetrait: retraitsTotaux.reduce((s, t) => s + (Number(t.amount) || 0), 0),
      lastRetraitDate: last?.date || todayISO(),
    };
  });

  const retirees = Object.values(byId);
  // Plus récents en haut
  retirees.sort((a, b) => new Date(b.lastRetraitDate) - new Date(a.lastRetraitDate));

  // Filtre de recherche (n° de carte ou nom du client)
  const q = (document.getElementById("retireSearch")?.value || "").trim().toLowerCase();
  const list = q
    ? retirees.filter((c) =>
        String(c.numeroCarte || "").toLowerCase().includes(q) ||
        String(c.username || "").toLowerCase().includes(q))
    : retirees;

  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${q ? "Aucune carte trouvée pour cette recherche." : "Aucune carte retirée."}</td></tr>`;
    return;
  }

  body.innerHTML = list.map((c) => `
    <tr>
      <td><span class="code-pill">${escapeHtml(c.numeroCarte || "—")}</span></td>
      <td><strong style="color:var(--navy)">${escapeHtml(c.username || "—")}</strong></td>
      <td style="text-align:center" class="muted">${formatDate(c.createdAt)}</td>
      <td style="text-align:center" class="muted">${formatDate(c.lastRetraitDate)}</td>
      <td style="text-align:right" class="num-cell">${formatMoney(c.totalRetrait)}</td>
      <td style="text-align:right">
        <div style="display:flex; gap:8px; justify-content:flex-end;">
        ${c.cardImage
          ? `<button class="btn btn-ghost btn-sm see-card-btn" data-id="${c.id}">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg>
               Voir la carte
             </button>`
          : `<button class="btn btn-ghost btn-sm" disabled title="Aucune image de carte enregistrée">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m2 16 5-3 4 2 5-4 6 4"/></svg>
               Voir la carte
             </button>`}
          <button class="btn btn-danger btn-sm del-card-btn" data-id="${c.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Supprimer
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll(".see-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = findCard(btn.dataset.id);
      if (c) viewClientCard(c);
    });
  });
  body.querySelectorAll(".del-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteCard(btn.dataset.id));
  });
}

/* Cherche une carte dans les deux magasins (retirées + clients) */
function findCard(id) {
  return getCartesRetirees().find((x) => String(x.id) === String(id))
      || getClients().find((x) => String(x.id) === String(id))
      || null;
}

/* Enregistre la liste des clients (localStorage -> sync Supabase via db.js) */
function saveClients(arr) {
  localStorage.setItem(LS_CLIENTS, JSON.stringify(arr));
}

/* Supprime DÉFINITIVEMENT une carte retirée (cache local + Supabase) */
function deleteCard(id) {
  const c = findCard(id);
  if (!c) return;
  const ok = window.confirm(`Supprimer définitivement la carte ${c.numeroCarte || "—"} (${c.username || ""}) ?\nCette action est irréversible.`);
  if (!ok) return;
  // Retire localement des deux magasins tout de suite (affichage immédiat)
  const removeLocal = (key) => {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(arr)) return;
      const next = arr.filter((x) => String(x.id) !== String(id));
      localStorage.setItem(key, JSON.stringify(next));
    } catch (e) {}
  };
  removeLocal(LS_CARTES_RETIREES);
  removeLocal(LS_CLIENTS);
  renderRetirees();
  // Suppression DÉFINITIVE côté Supabase (sinon le prochain pull la restaurerait).
  if (window.acbSync && typeof window.acbSync.deleteRow === "function") {
    window.acbSync.deleteRow("acb_cartes_retirees", id);
    window.acbSync.deleteRow("acb_clients", id);
  }
}

/* --- Affichage de l'image de la carte dans la modale --- */
async function viewClientCard(c) {
  if (!c || !c.cardImage) return;
  const scrim = document.getElementById("cardViewScrim");
  const title = document.getElementById("cardViewTitle");
  const bodyEl = document.getElementById("cardViewBody");
  if (!scrim || !bodyEl) return;
  title.textContent = `Carte ${c.numeroCarte || "—"} · ${c.username || ""}`;

  let imgUrl = c.cardImage;
  if (imgUrl === "__LAZY__") {
    bodyEl.innerHTML = `<p class="sub" style="margin:0; padding:30px 0; text-align:center;">Chargement de l'image…</p>`;
    scrim.classList.add("open");
    imgUrl = null;
    if (window.acbSync && window.acbSync.fetchImage) {
      imgUrl = await window.acbSync.fetchImage("acb_cartes_retirees", c.id);
      if (!imgUrl) imgUrl = await window.acbSync.fetchImage("acb_clients", c.id);
    }
    if (!scrim.classList.contains("open")) return; // fermé entre-temps
    if (!imgUrl) { bodyEl.innerHTML = `<p class="sub" style="margin:0; padding:30px 0; text-align:center;">Image indisponible.</p>`; return; }
    c.cardImage = imgUrl;
  }

  bodyEl.innerHTML = `
    <div style="position:relative; display:inline-block; width:100%;">
      <img src="${imgUrl}" alt="Carte ${escapeHtml(c.numeroCarte || "")}" style="display:block; width:100%; height:auto; border-radius:10px;" />
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-18deg); border:4px solid #d11; color:#d11; font-weight:800; font-size:clamp(22px,6vw,46px); letter-spacing:2px; text-transform:uppercase; padding:6px 22px; border-radius:8px; background:rgba(255,255,255,.18); box-shadow:0 0 0 2px rgba(255,255,255,.35) inset; white-space:nowrap; pointer-events:none;">Carte retirée</div>
    </div>`;
  scrim.classList.add("open");
}
function closeCardView() {
  const scrim = document.getElementById("cardViewScrim");
  if (scrim) scrim.classList.remove("open");
}

/* --- Navigation & fermeture --- */
const logoutEl = document.getElementById("logoutBtn");
if (logoutEl) {
  logoutEl.addEventListener("click", () => {
    Auth.endSession("admin");
    location.href = "admin.html";
  });
}
document.getElementById("backToDashBtn").addEventListener("click", () => {
  location.href = "panneau-admin.html";
});
// Recherche en direct (n° de carte ou nom)
const retireSearchEl = document.getElementById("retireSearch");
if (retireSearchEl) retireSearchEl.addEventListener("input", renderRetirees);
document.getElementById("cardViewClose").addEventListener("click", closeCardView);
document.getElementById("cardViewScrim").addEventListener("click", (e) => {
  if (e.target.id === "cardViewScrim") closeCardView();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCardView(); });

// Rafraîchit quand Supabase renvoie de nouvelles données (db.js appelle window.renderClients)
window.renderClients = renderRetirees;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderRetirees);
} else {
  renderRetirees();
}

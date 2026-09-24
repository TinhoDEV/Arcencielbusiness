/* =================================================================
   Arc en Ciel Business — IMPRESSION DES CARTES (imprimer-cartes.js)
   Génère 6 cartes d'épargne par page A4. Le numéro rouge (en haut à
   droite) s'incrémente à partir de 0001 et reprend, à chaque impression,
   là où il s'était arrêté. Le dernier numéro est stocké dans Supabase
   (table « counters »), avec repli sur le localStorage.
   ================================================================= */

const LS_ADMIN_SESSION = "acb_admin_session";
Auth.requireRole("admin");

/* --- Configuration Supabase (identique à db.js) --- */
const SUPABASE_URL = "https://xlxnetjrftnnwmmfqswl.supabase.co";
const SUPABASE_KEY = "sb_publishable_o1GHKowDY3MDT_xZnG3tiQ_xk_ThxxV";
const REST = SUPABASE_URL + "/rest/v1/";
const SB_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json",
};
const COUNTER_ID = "card_print";   // identifiant de la ligne compteur
const LS_FALLBACK = "acb_card_last"; // repli local
const CARDS_PER_PAGE = 6;

/* Coordonnées de l'entreprise (modifiables ici) */
const CONTACT_TEL = "07 07 78 07 71";

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
  setTimeout(() => { el.classList.add("is-out"); setTimeout(() => el.remove(), 300); }, 3000);
}

/* -------------------------------------------------------------
   Compteur : lecture / écriture du dernier numéro
   ------------------------------------------------------------- */
async function getLastNumber() {
  // 1) Tentative Supabase
  try {
    const r = await fetch(REST + "counters?id=eq." + COUNTER_ID + "&select=doc", { headers: SB_HEADERS });
    if (r.ok) {
      const rows = await r.json();
      if (rows.length && rows[0].doc && typeof rows[0].doc.last === "number") {
        return rows[0].doc.last;
      }
      return 0; // table accessible mais aucune ligne -> on démarre à 0
    }
  } catch (e) { /* réseau indisponible */ }
  // 2) Repli local
  return Number(localStorage.getItem(LS_FALLBACK) || 0);
}

async function setLastNumber(n) {
  // Repli local immédiat (toujours)
  localStorage.setItem(LS_FALLBACK, String(n));
  // Supabase (upsert)
  try {
    await fetch(REST + "counters?on_conflict=id", {
      method: "POST",
      headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, SB_HEADERS),
      body: JSON.stringify([{ id: COUNTER_ID, doc: { last: n } }]),
    });
  } catch (e) {
    toast("Numéro enregistré en local (Supabase indisponible)", "error");
  }
}

/* -------------------------------------------------------------
   Formatage du numéro : 0001, 0002, ...
   ------------------------------------------------------------- */
function pad4(n) {
  return String(n).padStart(4, "0");
}

/* -------------------------------------------------------------
   Construction d'une carte
   ------------------------------------------------------------- */
function buildCard(number) {
  const card = document.createElement("div");
  card.className = "epargne-card";

  // Grille des numéros 1 → 31 (5 colonnes).
  // Le 31 se place seul sur une 7e ligne, juste sous le 26.
  let cells = "";
  for (let i = 1; i <= 31; i++) {
    cells += `<div class="ec-cell">${i}</div>`;
    // Après la case 31 (seule sur sa ligne), on remplit l'espace restant
    // à sa droite avec la mention rouge en gras.
    if (i === 31) {
      cells += `<div class="ec-nb" style="grid-column: span 4; display:flex; align-items:center; padding-left:8px; color:#d11; font-weight:800; font-size:10.5pt; line-height:1.15; text-align:left;">NB&nbsp;: Le 1er carré n'est pas remboursable</div>`;
    }
  }

  card.innerHTML = `
    <div class="ec-header">
      <div class="ec-logo"><img src="logo.jpg" alt="Arc-en-ciel Business" /></div>
      <div class="ec-title">
        <div class="t1">Arc-en-ciel Business</div>
        <div class="t2">Contact : <b>${CONTACT_TEL}</b></div>
      </div>
      <div class="ec-number">${pad4(number)}</div>
    </div>
    <div class="ec-fields">
      <div class="ec-line"><span class="lbl">Nom et Prénoms :</span><span class="dots"></span></div>
      <div class="ec-line"><span class="lbl">Montant :</span><span class="dots"></span></div>
      <div class="ec-line"><span class="lbl">Contact :</span><span class="dots"></span></div>
      <div class="ec-line"><span class="lbl">Lieu de résidence :</span><span class="dots"></span></div>
    </div>
    <div class="ec-grid">${cells}</div>
  `;
  return card;
}

/* -------------------------------------------------------------
   Affiche un lot de 6 cartes EN APERÇU (sans consommer les numéros).
   Les numéros ne sont validés qu'au téléchargement du PDF, ou quand on
   demande explicitement un nouveau lot.
   ------------------------------------------------------------- */
let busy = false;
let currentStart = 0;
let currentEnd = 0;

async function renderPreview() {
  if (busy) return;
  busy = true;
  const sheet = document.getElementById("sheet");
  const regenBtn = document.getElementById("regenBtn");
  const printBtn = document.getElementById("printBtn");
  regenBtn.disabled = true; printBtn.disabled = true;
  sheet.innerHTML = `<div style="grid-column:1/-1; padding:40px; text-align:center; color:var(--ink-400);">Chargement…</div>`;

  const last = await getLastNumber();
  currentStart = last + 1;
  currentEnd = last + CARDS_PER_PAGE;

  sheet.innerHTML = "";
  for (let n = currentStart; n <= currentEnd; n++) {
    sheet.appendChild(buildCard(n));
  }

  document.getElementById("rangeLabel").textContent = pad4(currentStart) + " → " + pad4(currentEnd);
  regenBtn.disabled = false; printBtn.disabled = false;
  busy = false;
}

/* Valide le lot courant (consomme les numéros) puis affiche le suivant. */
async function commitAndNext() {
  await setLastNumber(currentEnd);
  await renderPreview();
}

/* -------------------------------------------------------------
   Génération du PDF (téléchargement -> s'ouvre dans le lecteur PDF
   par défaut, ex. Adobe Reader)
   ------------------------------------------------------------- */
async function downloadPdf() {
  const printBtn = document.getElementById("printBtn");
  const sheet = document.getElementById("sheet");
  if (typeof html2pdf === "undefined") {
    // Repli : si la librairie n'a pas pu se charger, on utilise l'impression système
    window.print();
    return;
  }
  printBtn.disabled = true;
  const original = printBtn.innerHTML;
  printBtn.innerHTML = "Préparation du PDF…";

  const range = document.getElementById("rangeLabel").textContent.replace(/\s/g, "");
  const filename = "cartes-arc-en-ciel-" + (range || "lot") + ".pdf";

  try {
    await html2pdf().set({
      margin: 0,
      filename: filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 3, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all"] },
    }).from(sheet).save();
    await setLastNumber(currentEnd); // valide les numéros une fois le PDF généré
    toast("PDF téléchargé — cliquez sur « Retour » pour revenir à l'admin", "success");
    // La page reste affichée. On prépare le lot suivant pour un éventuel nouveau téléchargement.
    printBtn.disabled = false;
    printBtn.innerHTML = original;
    await renderPreview();
  } catch (e) {
    toast("Échec de la génération du PDF", "error");
    printBtn.disabled = false;
    printBtn.innerHTML = original;
  }
}

/* -------------------------------------------------------------
   Événements
   ------------------------------------------------------------- */
document.getElementById("printBtn").addEventListener("click", downloadPdf);
document.getElementById("regenBtn").addEventListener("click", commitAndNext);

/* Affiche le premier lot (aperçu, sans consommer de numéros) */
renderPreview();

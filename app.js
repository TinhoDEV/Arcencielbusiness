/* =================================================================
   Arc en Ciel Business — Logique CLIENT (app.js)
   Pas de framework. Données dans localStorage.
   ================================================================= */

/* -------------------------------------------------------------
   1) CLÉS & HELPERS DE STOCKAGE
   ------------------------------------------------------------- */
const LS_CLIENTS = "acb_clients";          // tableau de comptes clients
const LS_CLIENT_SESSION = "acb_client_session"; // id du client connecté

// Lit la liste des clients ; initialise un tableau vide si absent.
function getClients() {
  try {
    const raw = localStorage.getItem(LS_CLIENTS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/* -------------------------------------------------------------
   2) FORMATAGE (montants FCFA, dates DD/MM/YYYY)
   ------------------------------------------------------------- */
// 125000 -> "125 000" (séparateur de milliers à la française)
function formatNumber(n) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0));
}
function formatMoney(n) {
  return formatNumber(n) + " FCFA";
}
// "2026-06-04" (ISO) ou Date -> "04/06/2026"
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

/* -------------------------------------------------------------
   3) TOASTS (notifications discrètes, disparition après 3s)
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
   4) GESTION DE L'AUTHENTIFICATION CLIENT
   ------------------------------------------------------------- */
const loginScreen = document.getElementById("loginScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const loginForm = document.getElementById("loginForm");
const loginMsg = document.getElementById("loginMsg");

// Affiche / masque le mot de passe
document.getElementById("pwToggle").addEventListener("click", () => {
  const pw = document.getElementById("password");
  pw.type = pw.type === "password" ? "text" : "password";
});

// Soumission du formulaire de connexion
loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  loginMsg.textContent = "";

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  if (!username || !password) {
    loginMsg.textContent = "Veuillez renseigner vos identifiants.";
    return;
  }

  const clients = getClients();
  const client = clients.find(
    (c) => c.username.toLowerCase() === username.toLowerCase() && c.password === password
  );

  if (!client) {
    // Message d'erreur discret sous le formulaire
    loginMsg.textContent = "Identifiants incorrects. Vérifiez votre nom d'utilisateur et votre mot de passe.";
    document.getElementById("password").value = "";
    return;
  }

  // Connexion réussie -> on mémorise la session et on affiche le tableau de bord
  localStorage.setItem(LS_CLIENT_SESSION, client.id);
  showDashboard(client.id);
  toast("Bienvenue, " + client.username, "success");
});

// Déconnexion
document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(LS_CLIENT_SESSION);
  dashboardScreen.hidden = true;
  loginScreen.hidden = false;
  loginForm.reset();
  loginMsg.textContent = "";
});

/* -------------------------------------------------------------
   5) AFFICHAGE DU TABLEAU DE BORD CLIENT
   ------------------------------------------------------------- */
function showDashboard(clientId) {
  // On relit toujours les données fraîches du localStorage
  const client = getClients().find((c) => c.id === clientId);
  if (!client) {
    // Le compte a peut-être été supprimé par l'admin
    localStorage.removeItem(LS_CLIENT_SESSION);
    return;
  }

  loginScreen.hidden = true;
  dashboardScreen.hidden = false;

  // En-tête
  const initials = client.username.slice(0, 2).toUpperCase();
  document.getElementById("userAvatar").textContent = initials;
  document.getElementById("userNameTop").textContent = client.username;
  document.getElementById("greetName").textContent = client.username;

  // Solde + méta
  document.getElementById("balanceValue").textContent = formatNumber(client.balance);
  document.getElementById("metaCreated").textContent = formatDate(client.createdAt);
  const txs = Array.isArray(client.transactions) ? client.transactions : [];
  document.getElementById("metaTxCount").textContent = txs.length;

  // Récapitulatif
  let totalDep = 0, totalRet = 0;
  txs.forEach((t) => {
    if (t.type === "depot") totalDep += Number(t.amount) || 0;
    else if (t.type === "retrait") totalRet += Number(t.amount) || 0;
  });
  document.getElementById("sumDeposits").textContent = "+ " + formatMoney(totalDep);
  document.getElementById("sumWithdrawals").textContent = "− " + formatMoney(totalRet);

  // Dernière opération (la plus récente = dernière du tableau)
  const last = txs[txs.length - 1];
  document.getElementById("lastOp").textContent = last ? formatDate(last.date) : "—";

  // Compteur d'opérations
  const label = txs.length <= 1 ? txs.length + " opération" : txs.length + " opérations";
  document.getElementById("txCountLabel").textContent = label;

  renderTransactions(txs);
}

// Construit le tableau d'historique (du plus récent au plus ancien)
function renderTransactions(txs) {
  const body = document.getElementById("txBody");
  body.innerHTML = "";

  if (!txs.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">Aucune transaction pour le moment.</td></tr>`;
    return;
  }

  // Copie inversée pour afficher la plus récente en haut
  [...txs].reverse().forEach((t) => {
    const isDep = t.type === "depot";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="muted">${formatDate(t.date)}</td>
      <td>
        <span class="tx ${isDep ? "depot" : "retrait"}">
          <span class="pip">
            ${isDep
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`
              : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`}
          </span>
          ${isDep ? "Dépôt" : "Retrait"}
        </span>
      </td>
      <td class="muted">${t.note ? escapeHtml(t.note) : "—"}</td>
      <td style="text-align:right" class="num-cell ${isDep ? "amt-pos" : "amt-neg"}">
        ${isDep ? "+ " : "− "}${formatMoney(t.amount)}
      </td>
      <td style="text-align:right" class="num-cell">${formatMoney(t.balanceAfter)}</td>
    `;
    body.appendChild(tr);
  });
}

// Petite protection XSS pour les notes saisies côté admin
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/* -------------------------------------------------------------
   6) INITIALISATION : restaure la session si elle existe
   ------------------------------------------------------------- */
(function init() {
  // Initialise la clé clients si elle est absente (premier lancement)
  if (!localStorage.getItem(LS_CLIENTS)) {
    localStorage.setItem(LS_CLIENTS, JSON.stringify([]));
  }
  const sessionId = localStorage.getItem(LS_CLIENT_SESSION);
  if (sessionId) {
    showDashboard(sessionId);
  }

  // Déconnexion automatique par inactivité (uniquement si connecté)
  setupAutoLogout({
    minutes: AUTO_LOGOUT_CLIENT_MINUTES,
    onLogout: () => {
      if (!localStorage.getItem(LS_CLIENT_SESSION)) return;
      localStorage.removeItem(LS_CLIENT_SESSION);
      dashboardScreen.hidden = true;
      loginScreen.hidden = false;
      loginForm.reset();
      loginMsg.className = "form-msg error";
      loginMsg.textContent = "Vous avez été déconnecté(e) pour inactivité. Reconnectez-vous.";
    },
    onWarn: () => {
      if (localStorage.getItem(LS_CLIENT_SESSION)) toast("Déconnexion dans 1 minute pour inactivité", "error");
    },
  });
})();

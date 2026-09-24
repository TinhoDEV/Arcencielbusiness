/* =================================================================
   Arc en Ciel Business — Connexion ADMIN (admin.js)
   Écran de connexion accessible via le bouton 🔐 Admin (page staff).
   Une fois identifié, on redirige vers « panneau-admin.html ».
   ================================================================= */

/* =================================================================
   IDENTIFIANTS ADMIN PAR DÉFAUT — MODIFIEZ ICI
   (modifiables ensuite depuis le panneau admin > Paramètres)
   ================================================================= */
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "arcenciel2024";
/* ================================================================= */

const LS_ADMIN_SESSION = "acb_admin_session";
const LS_ADMIN_CREDS = "acb_admin_creds";

/* Lit les identifiants admin enregistrés (modifiables depuis le panneau).
   Repli sur les valeurs par défaut ci-dessus si rien n'est stocké. */
function getAdminCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_ADMIN_CREDS));
    if (c && c.username && (c.password || c.passwordHash)) return c;
  } catch (e) {}
  return { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: "Administrateur" };
}

/* Vérifie le mot de passe (hash SHA-256 si disponible, sinon ancien clair),
   et met à niveau l'ancien stockage en clair vers un hash après succès. */
async function verifyAdminPassword(creds, pass) {
  if (creds.passwordHash) {
    return (await Auth.sha256(pass)) === creds.passwordHash;
  }
  // Ancien format en clair : on compare puis on bascule vers un hash.
  if (pass === creds.password) {
    try {
      const upgraded = {
        username: creds.username,
        displayName: creds.displayName || "Administrateur",
        passwordHash: await Auth.sha256(pass),
      };
      localStorage.setItem(LS_ADMIN_CREDS, JSON.stringify(upgraded));
      if (window.acbConfig && typeof window.acbConfig.set === "function") {
        window.acbConfig.set("admin_creds", upgraded);
      }
    } catch (e) {}
    return true;
  }
  return false;
}

const adminLoginForm = document.getElementById("adminLoginForm");
const adminLoginMsg = document.getElementById("adminLoginMsg");
const adminLoginBtn = document.getElementById("adminLoginBtn");

let failedAttempts = 0;
let lockUntil = 0; // timestamp ms

// Au chargement : si un verrou anti-force-brute est en cours, on le rétablit.
(function restoreLock() {
  const st = Auth.lockStatus("admin");
  if (st.locked) { lockUntil = Date.now() + st.secs * 1000; startLockCountdown(); }
})();

// Affiche / masque le mot de passe
document.getElementById("adminPwToggle").addEventListener("click", () => {
  const pw = document.getElementById("adminPass");
  pw.type = pw.type === "password" ? "text" : "password";
});

// Soumission du formulaire de connexion
adminLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  adminLoginMsg.className = "form-msg error";

  // Vérifie un éventuel blocage en cours (persistant entre rechargements)
  const st = Auth.lockStatus("admin");
  if (st.locked) {
    lockUntil = Date.now() + st.secs * 1000;
    adminLoginMsg.textContent = `Trop de tentatives, réessayez dans ${st.secs} seconde${st.secs > 1 ? "s" : ""}.`;
    startLockCountdown();
    return;
  }

  const user = document.getElementById("adminUser").value.trim();
  const pass = document.getElementById("adminPass").value;

  const creds = getAdminCreds();
  const ok = (user === creds.username) && (await verifyAdminPassword(creds, pass));
  if (ok) {
    // Connexion réussie -> jeton de session signé + redirection
    Auth.clearFails("admin");
    Auth.startSession("admin", "1");
    window.location.href = "panneau-admin.html";
    return;
  }

  // Échec -> compteur PERSISTANT, blocage 1 min après 3 tentatives
  document.getElementById("adminPass").value = "";
  const res = Auth.registerFail("admin", 3, 60 * 1000);
  if (res.locked) {
    lockUntil = Date.now() + res.secs * 1000;
    startLockCountdown();
  } else {
    adminLoginMsg.textContent = `Identifiants incorrects. ${res.left} tentative${res.left > 1 ? "s" : ""} restante${res.left > 1 ? "s" : ""}.`;
  }
});

// Compte à rebours pendant le blocage
function startLockCountdown() {
  adminLoginBtn.disabled = true;
  const tick = () => {
    const remaining = lockUntil - Date.now();
    if (remaining <= 0) {
      adminLoginBtn.disabled = false;
      adminLoginMsg.className = "form-msg success";
      adminLoginMsg.textContent = "Vous pouvez réessayer.";
      return;
    }
    const secs = Math.ceil(remaining / 1000);
    adminLoginMsg.textContent = `Trop de tentatives, réessayez dans ${secs} seconde${secs > 1 ? "s" : ""}.`;
    setTimeout(tick, 500);
  };
  tick();
}

// Message après une déconnexion automatique pour inactivité
if (new URLSearchParams(location.search).get("timeout")) {
  adminLoginMsg.className = "form-msg error";
  adminLoginMsg.textContent = "Vous avez été déconnecté pour inactivité. Reconnectez-vous.";
}

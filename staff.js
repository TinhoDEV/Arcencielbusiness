/* =================================================================
   Arc en Ciel Business — Connexion STAFF (staff.js)
   Cette page ne gère QUE la connexion du personnel.
   Les comptes staff sont créés depuis l'espace ADMIN.
   Une fois identifié, on redirige vers « panneau-staff.html ».
   ================================================================= */

const LS_STAFF = "acb_staff";                 // liste des comptes staff
const LS_STAFF_SESSION = "acb_staff_session"; // id du staff connecté

/* Lit la liste des comptes staff (créés depuis l'admin). */
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

const staffLoginForm = document.getElementById("staffLoginForm");
const staffLoginMsg = document.getElementById("staffLoginMsg");
const staffLoginBtn = document.getElementById("staffLoginBtn");

let failedAttempts = 0;
let lockUntil = 0; // timestamp ms

// Au chargement : rétablit un verrou anti-force-brute en cours, le cas échéant.
(function restoreLock() {
  const st = Auth.lockStatus("staff");
  if (st.locked) { lockUntil = Date.now() + st.secs * 1000; startLockCountdown(); }
})();

// Affiche / masque le mot de passe
document.getElementById("staffPwToggle").addEventListener("click", () => {
  const pw = document.getElementById("staffPass");
  pw.type = pw.type === "password" ? "text" : "password";
});

// Soumission du formulaire de connexion
staffLoginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  staffLoginMsg.className = "form-msg error";

  // Blocage en cours (persistant entre rechargements) ?
  const st = Auth.lockStatus("staff");
  if (st.locked) {
    lockUntil = Date.now() + st.secs * 1000;
    staffLoginMsg.textContent = `Trop de tentatives, réessayez dans ${st.secs} seconde${st.secs > 1 ? "s" : ""}.`;
    startLockCountdown();
    return;
  }

  const user = document.getElementById("staffUser").value.trim();
  const pass = document.getElementById("staffPass").value;

  const member = getStaff().find(
    (s) => s.username.toLowerCase() === user.toLowerCase() && s.password === pass
  );

  if (member) {
    // Connexion réussie -> jeton de session signé (encode l'id du staff)
    Auth.clearFails("staff");
    Auth.startSession("staff", member.id);
    window.location.href = "panneau-staff.html";
    return;
  }

  // Échec -> compteur PERSISTANT, blocage 1 min après 3 tentatives
  document.getElementById("staffPass").value = "";
  const res = Auth.registerFail("staff", 3, 60 * 1000);
  if (res.locked) {
    lockUntil = Date.now() + res.secs * 1000;
    startLockCountdown();
  } else {
    staffLoginMsg.textContent = `Identifiants incorrects. ${res.left} tentative${res.left > 1 ? "s" : ""} restante${res.left > 1 ? "s" : ""}.`;
  }
});

// Compte à rebours pendant le blocage
function startLockCountdown() {
  staffLoginBtn.disabled = true;
  const tick = () => {
    const remaining = lockUntil - Date.now();
    if (remaining <= 0) {
      staffLoginBtn.disabled = false;
      staffLoginMsg.className = "form-msg success";
      staffLoginMsg.textContent = "Vous pouvez réessayer.";
      return;
    }
    const secs = Math.ceil(remaining / 1000);
    staffLoginMsg.textContent = `Trop de tentatives, réessayez dans ${secs} seconde${secs > 1 ? "s" : ""}.`;
    setTimeout(tick, 500);
  };
  tick();
}

// Message après une déconnexion automatique pour inactivité
if (new URLSearchParams(location.search).get("timeout")) {
  staffLoginMsg.className = "form-msg error";
  staffLoginMsg.textContent = "Vous avez été déconnecté pour inactivité. Reconnectez-vous.";
}

/* =================================================================
   Arc en Ciel Business — Déconnexion automatique par inactivité
   -----------------------------------------------------------------
   Au bout de AUTO_LOGOUT_MINUTES minutes SANS activité (souris,
   clavier, défilement, tactile), l'utilisateur est déconnecté et
   renvoyé à la page de connexion.
   Un avertissement apparaît 1 minute avant la déconnexion.
   ================================================================= */

/* ⏱️  DURÉES D'INACTIVITÉ AVANT DÉCONNEXION (en minutes) — MODIFIEZ ICI */
const AUTO_LOGOUT_STAFF_MINUTES = 2;   // espace staff
const AUTO_LOGOUT_ADMIN_MINUTES = 5;   // espace administrateur
const AUTO_LOGOUT_CLIENT_MINUTES = 5;  // espace client
/* ================================================================= */

/**
 * Arme la déconnexion automatique.
 * @param {Object} opts
 * @param {number} opts.minutes      Délai d'inactivité en minutes.
 * @param {Function} opts.onLogout   Appelée à l'expiration du délai.
 * @param {Function} [opts.onWarn]   Appelée 1 minute avant (avertissement).
 */
function setupAutoLogout(opts) {
  const onLogout = opts.onLogout;
  const onWarn = opts.onWarn;
  const minutes = opts.minutes || 5;

  const total = minutes * 60 * 1000;                      // délai total
  const warnLead = Math.min(60 * 1000, total / 2);        // avertir 1 min avant (ou à mi-parcours)
  const warnAt = total - warnLead;

  let logoutTimer = null;
  let warnTimer = null;

  function reset() {
    clearTimeout(logoutTimer);
    clearTimeout(warnTimer);
    if (typeof onWarn === "function" && warnAt > 0) {
      warnTimer = setTimeout(onWarn, warnAt);
    }
    logoutTimer = setTimeout(onLogout, total);
  }

  // Toute interaction réarme le minuteur
  ["click", "mousemove", "keydown", "scroll", "wheel", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, reset, { passive: true });
  });
  // Au retour sur l'onglet, on réarme aussi
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) reset();
  });

  reset();
}

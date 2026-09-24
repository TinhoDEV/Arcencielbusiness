/* =================================================================
   Arc en Ciel Business — Module de sécurité partagé (auth.js)
   À CHARGER EN PREMIER sur chaque page (avant tout autre script).

   Apporte :
   1) Jetons de session SIGNÉS + EXPIRABLES (anti-falsification basique).
      → empêche le contournement trivial du type
        sessionStorage.setItem("acb_admin_session","true").
   2) Hachage SHA-256 des mots de passe (utilisé pour l'admin).
   3) Verrouillage anti-force-brute PERSISTANT (survit au rechargement).

   ⚠️ Rappel important : c'est une application 100 % côté navigateur.
   Ces protections élèvent fortement le niveau, mais la VRAIE frontière
   de sécurité reste la base Supabase (RLS) — voir SECURITE.md.
   ================================================================= */
(function (global) {
  "use strict";

  // Sel d'intégrité de l'application (atténue l'altération des jetons/mots de passe).
  const APP_SALT = "ACB::7f3c91a2e8b64d05::v2";

  // Clés de session (on conserve les mêmes pour compatibilité).
  const KEYS = { admin: "acb_admin_session", staff: "acb_staff_session" };

  // Page de connexion vers laquelle rediriger selon le rôle.
  const LOGIN = { admin: "admin.html", staff: "staff.html" };

  // Durée de vie ABSOLUE d'une session (filet de sécurité, en plus de
  // la déconnexion pour inactivité gérée par inactivity.js).
  const MAX_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 h

  /* ---------- utilitaires base64 sûrs (UTF-8) ---------- */
  function b64encode(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64decode(s) { return decodeURIComponent(escape(atob(s))); }

  /* ---------- signature SYNCHRONE (djb2 double passe + sel) ----------
     Suffisant contre l'altération « console » ; ce n'est pas un secret
     cryptographique (le code est public). */
  function signSync(str) {
    const s = APP_SALT + "|" + str + "|" + APP_SALT;
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = (((h1 << 5) + h1) + c) >>> 0;
      h2 = (((h2 << 5) + h2) ^ c) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }

  /* ---------- hachage SHA-256 (asynchrone) pour les mots de passe ---------- */
  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(APP_SALT + "|" + str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* ---------- sessions ---------- */
  function startSession(role, id) {
    if (!KEYS[role]) return;
    const payload = JSON.stringify({ r: role, id: String(id || "1"), iat: Date.now() });
    const token = b64encode(payload) + "." + signSync(payload);
    sessionStorage.setItem(KEYS[role], token);
    return token;
  }

  // Retourne les données de session valides, ou null.
  function readSession(role) {
    const token = sessionStorage.getItem(KEYS[role]);
    if (!token || token.indexOf(".") < 1) return null;
    const dot = token.lastIndexOf(".");
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    let payloadStr;
    try { payloadStr = b64decode(payloadB64); } catch (e) { return null; }
    if (signSync(payloadStr) !== sig) return null;          // jeton altéré
    let data;
    try { data = JSON.parse(payloadStr); } catch (e) { return null; }
    if (data.r !== role) return null;                       // mauvais rôle
    if (Date.now() - (Number(data.iat) || 0) > MAX_LIFETIME_MS) return null; // expiré
    return data;
  }

  function check(role) { return readSession(role) !== null; }

  function endSession(role) {
    if (KEYS[role]) sessionStorage.removeItem(KEYS[role]);
  }

  // Garde de page : redirige si la session est absente/invalide/expirée.
  // Retourne l'identifiant (id staff, ou "1" pour l'admin), sinon null.
  function requireRole(role) {
    const data = readSession(role);
    if (!data) {
      try { sessionStorage.removeItem(KEYS[role]); } catch (e) {}
      window.location.replace(LOGIN[role] || "staff.html");
      return null;
    }
    return data.id;
  }

  /* ---------- verrouillage anti-force-brute PERSISTANT ---------- */
  function lockKey(role) { return "acb_lock_" + role; }
  function getLock(role) {
    try {
      const o = JSON.parse(localStorage.getItem(lockKey(role)) || "{}");
      return (o && typeof o === "object") ? o : {};
    } catch (e) { return {}; }
  }
  function setLock(role, o) { localStorage.setItem(lockKey(role), JSON.stringify(o)); }

  // Statut courant : { locked:bool, secs:int }
  function lockStatus(role) {
    const o = getLock(role);
    const until = Number(o.until) || 0;
    const now = Date.now();
    if (until > now) return { locked: true, secs: Math.ceil((until - now) / 1000) };
    return { locked: false, secs: 0 };
  }

  // Enregistre un échec. Au-delà de maxAttempts → verrou de lockMs.
  // Retourne { locked, left, secs }.
  function registerFail(role, maxAttempts, lockMs) {
    maxAttempts = maxAttempts || 3;
    lockMs = lockMs || 60 * 1000;
    const o = getLock(role);
    const now = Date.now();
    // Réinitialise le compteur si la fenêtre d'échecs (10 min) est dépassée
    if (!o.firstFail || now - o.firstFail > 10 * 60 * 1000) { o.attempts = 0; o.firstFail = now; }
    o.attempts = (Number(o.attempts) || 0) + 1;
    if (o.attempts >= maxAttempts) {
      o.until = now + lockMs;
      o.attempts = 0;
      o.firstFail = 0;
      setLock(role, o);
      return { locked: true, left: 0, secs: Math.ceil(lockMs / 1000) };
    }
    setLock(role, o);
    return { locked: false, left: maxAttempts - o.attempts, secs: 0 };
  }

  function clearFails(role) { localStorage.removeItem(lockKey(role)); }

  global.Auth = {
    sha256, signSync,
    startSession, readSession, check, endSession, requireRole,
    lockStatus, registerFail, clearFails,
    MAX_LIFETIME_MS,
  };
})(window);

/* =================================================================
   Arc en Ciel Business — Couche BASE DE DONNÉES en ligne (db.js)
   Connecte l'application à Supabase (stockage permanent + partagé).

   Fonctionnement :
   - Au chargement : on récupère (pull) les données depuis Supabase
     et on les place dans le localStorage (cache local).
   - À chaque enregistrement local (clients/staff), on pousse (push)
     automatiquement vers Supabase.
   - Si Supabase est indisponible, l'application continue de
     fonctionner en local (localStorage) sans rien casser.
   ================================================================= */

(function () {
  "use strict";

  /* --- Configuration Supabase (URL + clé publique) --- */
  const SUPABASE_URL = "https://xlxnetjrftnnwmmfqswl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_o1GHKowDY3MDT_xZnG3tiQ_xk_ThxxV";
  const REST = SUPABASE_URL + "/rest/v1/";

  // Tables : on stocke chaque enregistrement sous { id, doc } (doc = objet complet en JSON)
  const TABLES = { acb_clients: "clients", acb_staff: "staff", acb_cartes_retirees: "cartes_retirees" };

  // Journal permanent des enregistrements du jour (append-only : on n'efface JAMAIS).
  const JOURNAL_KEY = "acb_clients_jour";
  const JOURNAL_TABLE = "clients_jour";

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json",
  };

  // Référence au setItem d'origine (pour écrire le cache sans redéclencher de push)
  const rawSetItem = localStorage.setItem.bind(localStorage);

  /* ---------------------------------------------------------------
     TOMBSTONES (pierres tombales) — suppressions DÉFINITIVES & inviolables.
     Un id supprimé est mémorisé ici ET dans Supabase (table config, id
     « tombstones »). Conséquence : aucun appareil ne peut « ressusciter »
     un enregistrement supprimé, même s'il a encore une copie périmée en
     cache (les ids tombstonés sont exclus des push ET retirés des pull).
     --------------------------------------------------------------- */
  const TOMB_LS = "acb_tombstones";
  let tombstones = { clients: [], staff: [], cartes_retirees: [], clients_jour: [] };
  function loadTombstonesLocal() {
    try {
      const t = JSON.parse(localStorage.getItem(TOMB_LS) || "{}");
      ["clients", "staff", "cartes_retirees", "clients_jour"].forEach((k) => {
        tombstones[k] = Array.isArray(t[k]) ? t[k].map(String) : [];
      });
    } catch (e) {}
  }
  loadTombstonesLocal();
  function tombKey(storageKey) {
    return TABLES[storageKey] || (storageKey === JOURNAL_KEY ? "clients_jour" : null);
  }
  function isTombstoned(storageKey, id) {
    const k = tombKey(storageKey);
    return k ? tombstones[k].indexOf(String(id)) !== -1 : false;
  }
  function addTombstone(storageKey, id) {
    const k = tombKey(storageKey);
    if (!k) return;
    if (tombstones[k].indexOf(String(id)) === -1) tombstones[k].push(String(id));
    rawSetItem(TOMB_LS, JSON.stringify(tombstones));
    // Persiste vers Supabase (config) pour propager à tous les appareils.
    try {
      fetch(REST + "config?on_conflict=id", {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
        body: JSON.stringify([{ id: "tombstones", doc: tombstones }]),
      });
    } catch (e) {}
  }

  // Les écritures locales ne sont synchronisées qu'APRÈS la 1ʳᵉ récupération
  // (évite d'effacer la base distante avec un tableau vide au démarrage).
  let ready = false;
  // En mode polling, on n'inonde pas la console en cas d'erreur réseau ponctuelle.
  const silentPoll = true;

  /* ---------------------------------------------------------------
     PUSH : envoie le tableau local vers Supabase (upsert + suppression)
     --------------------------------------------------------------- */
  // On enchaîne les push pour éviter les conflits simultanés.
  // pendingPush compte les écritures en cours par table : tant qu'il est > 0
  // (ou pendant un court délai après), le PULL ne doit PAS écraser le cache local
  // avec une version distante potentiellement périmée (sinon la nouvelle image
  // d'une mise à jour serait remplacée par l'ancienne — race condition).
  const pendingPush = {};       // { storageKey: nombre de push en cours }
  const lastPushAt = {};        // { storageKey: timestamp du dernier push terminé }
  const PUSH_COOLDOWN_MS = 4000; // marge après push (cohérence éventuelle Supabase)

  function pushBusy(storageKey) {
    if ((pendingPush[storageKey] || 0) > 0) return true;
    const t = lastPushAt[storageKey] || 0;
    return (Date.now() - t) < PUSH_COOLDOWN_MS;
  }

  // Petit cache LOCAL (hors synchro) des vraies images déjà vues sur cet
  // appareil : sert à ne JAMAIS pousser le jeton "__LAZY__" vers Supabase
  // (qui écraserait l'image réelle) quand on ré-enregistre une fiche.
  const IMAGE_CACHE_KEY = "acb_image_cache_v1";
  function imageCacheGet(id) {
    try { return (JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || "{}"))[id] || null; }
    catch (e) { return null; }
  }
  function imageCacheSet(id, url) {
    try {
      const m = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || "{}");
      m[id] = url;
      // Borne la taille du cache (garde les 300 plus récents)
      const keys = Object.keys(m);
      if (keys.length > 300) delete m[keys[0]];
      rawSetItem(IMAGE_CACHE_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  // Résout, pour un lot d'items dont le cardImage local vaut "__LAZY__",
  // la VRAIE image (cache local sinon lecture groupée Supabase) — pour ne
  // jamais pousser le jeton lui-même à la place de l'image existante.
  async function resolveLazyImages(table, items) {
    const needIds = [];
    items.forEach((it) => {
      if (it.cardImage !== "__LAZY__") return;
      const cached = imageCacheGet(it.id);
      if (cached) { it.cardImage = cached; return; }
      needIds.push(String(it.id));
    });
    if (!needIds.length) return items;
    // Lecture groupée par lots de 40 id (limite raisonnable d'URL)
    for (let i = 0; i < needIds.length; i += 40) {
      const chunk = needIds.slice(i, i + 40);
      try {
        const res = await fetch(REST + table + "?id=in.(" + chunk.map(encodeURIComponent).join(",") + ")&select=id,doc", { headers });
        if (!res.ok) continue;
        const rows = await res.json();
        const byId = {};
        rows.forEach((r) => { if (r.doc && r.doc.cardImage && r.doc.cardImage !== "__LAZY__") byId[String(r.id)] = r.doc.cardImage; });
        items.forEach((it) => {
          if (it.cardImage === "__LAZY__" && byId[String(it.id)]) { it.cardImage = byId[String(it.id)]; imageCacheSet(it.id, it.cardImage); }
        });
      } catch (e) { /* hors-ligne : on laisse tel quel, filtré ensuite */ }
    }
    return items;
  }

  let pushChain = Promise.resolve();
  function pushTable(storageKey, value) {
    const table = TABLES[storageKey];
    if (!table) return;
    let arr;
    try { arr = JSON.parse(value); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    // On n'upload JAMAIS un enregistrement supprimé (tombstone) : empêche
    // qu'un cache périmé ressuscite un client/staff effacé.
    arr = arr.filter((item) => item && !isTombstoned(storageKey, item.id));

    pendingPush[storageKey] = (pendingPush[storageKey] || 0) + 1;
    // On enchaîne les push pour éviter les conflits simultanés
    pushChain = pushChain.then(async () => {
      try {
        // Ne JAMAIS pousser le jeton "__LAZY__" à la place d'une vraie image.
        // PRIORITÉ : les enregistrements portant une VRAIE image (donc les
        // nouveaux/modifiés) partent IMMÉDIATEMENT, sans attendre la résolution
        // réseau des autres. Les fiches « __LAZY__ » (images déjà en base, non
        // rechargées ici) sont résolues ensuite, en second lot tolérant à l'échec.
        let lazyLater = [];
        if (LAZY_IMAGE_TABLES[storageKey]) {
          lazyLater = arr.filter((it) => it && it.cardImage === "__LAZY__");
          arr = arr.filter((it) => !it || it.cardImage !== "__LAZY__");
        }
        // 1) Upsert de tous les enregistrements, DÉCOUPÉ EN LOTS.
        //    Chaque client peut embarquer une image base64 volumineuse ; envoyer
        //    tout le tableau en un seul POST peut dépasser la taille max de requête
        //    et faire échouer l'enregistrement (le nouveau client n'est jamais
        //    sauvegardé). On découpe donc en lots bornés par leur taille.
        if (arr.length) {
          const MAX_BATCH_BYTES = 600000; // ~0,6 Mo par requête
          let batch = [];
          let batchBytes = 0;
          const flush = async () => {
            if (!batch.length) return;
            const rows = batch.map((item) => ({ id: String(item.id), doc: item }));
            await fetch(REST + table + "?on_conflict=id", {
              method: "POST",
              headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
              body: JSON.stringify(rows),
            });
            batch = [];
            batchBytes = 0;
          };
          for (const item of arr) {
            let size = 2000;
            try { size = JSON.stringify(item).length; } catch (e) {}
            // Si l'élément seul dépasse, on le pousse isolément.
            if (size >= MAX_BATCH_BYTES) {
              await flush();
              await fetch(REST + table + "?on_conflict=id", {
                method: "POST",
                headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
                body: JSON.stringify([{ id: String(item.id), doc: item }]),
              });
              continue;
            }
            if (batchBytes + size > MAX_BATCH_BYTES) await flush();
            batch.push(item);
            batchBytes += size;
          }
          await flush();
        }
        // 1 bis) Second lot : les fiches dont l'image doit être résolue.
        //        Fait APRÈS l'envoi prioritaire, et sans bloquer celui-ci en cas
        //        d'échec réseau (les non-résolues repartiront plus tard).
        if (lazyLater.length) {
          try {
            const resolved = (await resolveLazyImages(table, lazyLater))
              .filter((it) => it && it.cardImage !== "__LAZY__");
            for (let i = 0; i < resolved.length; i += 20) {
              const rows = resolved.slice(i, i + 20).map((item) => ({ id: String(item.id), doc: item }));
              await fetch(REST + table + "?on_conflict=id", {
                method: "POST",
                headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
                body: JSON.stringify(rows),
              });
            }
          } catch (e2) {
            console.warn("[ACB] Second lot (images) reporté :", e2.message);
          }
        }
        // 2) Suppression « douce » : on N'ÉMET PLUS de DELETE via la clé publique.
        //    Les éléments retirés portent le drapeau { deleted: true } et sont
        //    simplement mis à jour (upsert) ci-dessus, puis masqués à la lecture.
        //    → permet de BLOQUER la suppression anonyme dans Supabase (RLS) sans
        //      casser la synchro entre appareils. Voir SECURITE.md.
      } catch (e) {
        console.warn("[ACB] Push Supabase échoué (" + table + ") :", e.message);
      } finally {
        pendingPush[storageKey] = Math.max(0, (pendingPush[storageKey] || 1) - 1);
        lastPushAt[storageKey] = Date.now();
      }
    });
    return pushChain;
  }

  // Tables dont l'image de carte est volumineuse : on ne charge JAMAIS
  // l'image dans le cache local synchronisé (clients/cartes retirées/journal).
  // Le champ est remplacé par un jeton "__LAZY__" ; l'image réelle n'est
  // récupérée qu'à la demande (clic sur « Voir la carte »), via fetchImage().
  const LAZY_IMAGE_TABLES = { acb_clients: true, acb_cartes_retirees: true, acb_clients_jour: true };
  function stripImages(list) {
    return list.map((item) => {
      if (item && typeof item.cardImage === "string" && item.cardImage) {
        return Object.assign({}, item, { cardImage: "__LAZY__" });
      }
      return item;
    });
  }
  // Récupère l'image RÉELLE d'UNE seule fiche (table + id), directement
  // depuis Supabase — TOUJOURS en réseau d'abord (une carte peut avoir été
  // rescannée/remplacée entre-temps) ; le cache local ne sert qu'en repli
  // hors-ligne, pour ne jamais afficher une image périmée.
  async function fetchImage(storageKey, id) {
  const table = TABLES[storageKey] || (storageKey === "clients_jour" || storageKey === "acb_clients_jour" ? JOURNAL_TABLE : null);
    if (!table || !id) return imageCacheGet(id);
    try {
      const res = await fetch(REST + table + "?id=eq." + encodeURIComponent(String(id)) + "&select=doc", { headers: headers, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      const doc = rows[0] && rows[0].doc;
      const url = (doc && doc.cardImage && doc.cardImage !== "__LAZY__") ? doc.cardImage : null;
      if (url) { imageCacheSet(id, url); return url; }
      // Repli : l'id peut appartenir au JOURNAL (entrées « j_… ») et non aux clients.
      if (table !== JOURNAL_TABLE) {
        const r2 = await fetch(REST + JOURNAL_TABLE + "?id=eq." + encodeURIComponent(String(id)) + "&select=doc", { headers: headers, cache: "no-store" });
        if (r2.ok) {
          const rows2 = await r2.json();
          const d2 = rows2[0] && rows2[0].doc;
          const u2 = (d2 && d2.cardImage && d2.cardImage !== "__LAZY__") ? d2.cardImage : null;
          if (u2) { imageCacheSet(id, u2); return u2; }
        }
      }
      return null;
    } catch (e) {
      // Hors-ligne : on retombe sur la dernière image vue sur cet appareil.
      return imageCacheGet(id);
    }
  }

  /* ---------------------------------------------------------------
     Interception : tout setItem sur acb_clients / acb_staff
     écrit en local PUIS pousse vers Supabase.
     --------------------------------------------------------------- */
  localStorage.setItem = function (key, value) {
    rawSetItem(key, value);
    if (TABLES[key] && ready) pushTable(key, value);
  };

  /* ---------------------------------------------------------------
     PULL : récupère les données depuis Supabase vers le cache local
     --------------------------------------------------------------- */
  async function pullTable(storageKey) {
    const table = TABLES[storageKey];
    try {
      const rows = await fetchAllRows(table, "doc");
      let remote = rows.map((r) => r.doc).filter(Boolean);
      if (LAZY_IMAGE_TABLES[storageKey]) remote = stripImages(remote);

      // Filtre les enregistrements supprimés (tombstones) ET ré-émet un DELETE
      // pour ceux qui auraient été ressuscités par un appareil au cache périmé.
      const resurrected = remote.filter((d) => isTombstoned(storageKey, d.id));
      if (resurrected.length) {
        remote = remote.filter((d) => !isTombstoned(storageKey, d.id));
        resurrected.forEach((d) => {
          try {
            fetch(REST + table + "?id=eq." + encodeURIComponent(String(d.id)), { method: "DELETE", headers });
          } catch (e) {}
        });
      }

      let localArr = [];
      try {
        localArr = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (!Array.isArray(localArr)) localArr = [];
      } catch (e) {}

      if (remote.length === 0 && localArr.length > 0 && !ready) {
        // Migration initiale : base distante vide mais données locales présentes
        // -> on envoie les données locales vers Supabase (on ne les efface pas).
        pushTable(storageKey, JSON.stringify(localArr));
        return "unchanged";
      }

      // Une écriture locale vient d'être poussée (ou est en cours) : on NE
      // remplace PAS le cache local par une version distante peut-être périmée.
      // La prochaine boucle de pull (après le cooldown) réconciliera proprement.
      if (pushBusy(storageKey)) {
        return "unchanged";
      }

      const remoteJson = JSON.stringify(remote);
      if (remoteJson === JSON.stringify(localArr)) {
        return "unchanged"; // rien de nouveau
      }
      rawSetItem(storageKey, remoteJson); // met à jour le cache SANS re-push
      return "changed";
    } catch (e) {
      if (!silentPoll) console.warn("[ACB] Pull Supabase échoué (" + table + ") :", e.message);
      return "error";
    }
  }

  // Rafraîchit l'affichage des pages si les fonctions existent.
  // Couvre TOUTES les vues : tableaux clients, personnel, cartes retirées,
  // ET les journaux (détail du jour staff, journal base de données, page journal).
  function rerender() {
    [
      "refreshDashboard", "refreshStaffList", "refreshNotifications",
      "renderClients", "renderStaff", "renderRetirees",
      "renderAllClients", "renderFullCards",
      "renderJournalToday", "renderJournalDb", "renderJournal",
    ].forEach((fn) => {
      try { if (typeof window[fn] === "function") window[fn](); } catch (e) {}
    });
  }

  async function pullAll() {
    // Pages de CONNEXION (login) : seule la table "staff"/"config" est nécessaire
    // pour vérifier les identifiants. On évite de tirer clients/journal/cartes
    // retirées (souvent volumineux avec les photos) avant même d'être connecté.
    if (window.ACB_LOGIN_ONLY) {
      await Promise.all([pullTable("acb_staff"), pullConfig()]);
      ready = true;
      if (typeof window.acbOnReady === "function") { try { window.acbOnReady(); } catch (e) {} }
      rerender();
      return;
    }
    // Toutes les lectures en PARALLÈLE (au lieu de 5 requêtes en série) :
    // le démarrage est limité par la plus lente, pas par leur somme.
    await Promise.all([
      pullTable("acb_clients"),
      pullTable("acb_staff"),
      pullTable("acb_cartes_retirees"),
      pullConfig(),
      pullJournal(),
    ]);
    ready = true; // à partir d'ici, les écritures locales sont synchronisées vers Supabase
    // Hook : permet aux pages d'exécuter une logique une fois la synchro prête
    // (ex. migration des cartes retirées) avec push Supabase garanti.
    if (typeof window.acbOnReady === "function") {
      try { window.acbOnReady(); } catch (e) {}
    }
    // Premier chargement : on RÉAFFICHE TOUJOURS à partir des données qui viennent
    // d'être récupérées dans la base (jamais l'ancien cache local).
    rerender();
  }

  /* ---------------------------------------------------------------
     SYNCHRO EN TEMPS RÉEL (par intervalle)
     Toutes les 5 s on récupère la base ; l'affichage n'est rafraîchi
     que si les données ont réellement changé. La synchro se met en
     pause quand l'onglet est en arrière-plan (économie de ressources).
     --------------------------------------------------------------- */
  const POLL_MS = 20000;
  let polling = false;

  async function pollOnce() {
    if (polling || document.hidden || !ready) return;
    polling = true;
    try {
      if (window.ACB_LOGIN_ONLY) {
        const rS0 = await pullTable("acb_staff");
        const rCfg0 = await pullConfig();
        if (rS0 === "changed" || rCfg0 === "changed") rerender();
        return;
      }
      const rC = await pullTable("acb_clients");
      const rS = await pullTable("acb_staff");
      const rR = await pullTable("acb_cartes_retirees");
      const rCfg = await pullConfig();
      const rJ = await pullJournal();
      if (rC === "changed" || rS === "changed" || rR === "changed" || rCfg === "changed" || rJ === "changed") rerender();
    } finally {
      polling = false;
    }
  }

  setInterval(pollOnce, POLL_MS);
  // Quand l'utilisateur revient sur l'onglet, on synchronise tout de suite
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pollOnce(); });

  /* Suppression DÉFINITIVE d'une ligne (cache local + Supabase).
     Retire l'entrée du cache local PUIS envoie un DELETE à Supabase, afin
     qu'aucun PULL ultérieur ne puisse la restaurer. Réservé aux actions admin. */
  async function deleteRow(storageKey, id) {
    const table = TABLES[storageKey];
    if (!table || id == null) return;
    // 0) Mémorise la suppression (tombstone) — locale + Supabase — pour qu'aucun
    //    appareil ne puisse ressusciter cet enregistrement.
    addTombstone(storageKey, id);
    // 1) Retire du cache local (et marque deleted pour parer toute relecture concurrente)
    try {
      let arr = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(arr)) {
        arr = arr.filter((x) => String(x.id) !== String(id));
        rawSetItem(storageKey, JSON.stringify(arr));
      }
    } catch (e) {}
    // 2) Empêche le pull d'écraser pendant la suppression
    pendingPush[storageKey] = (pendingPush[storageKey] || 0) + 1;
    try {
      await fetch(REST + table + "?id=eq." + encodeURIComponent(String(id)), {
        method: "DELETE",
        headers: headers,
      });
    } catch (e) {
      console.warn("[ACB] Suppression Supabase échouée (" + table + ") :", e.message);
    } finally {
      pendingPush[storageKey] = Math.max(0, (pendingPush[storageKey] || 1) - 1);
      lastPushAt[storageKey] = Date.now();
    }
  }

  // Lecture DIRECTE d'une table depuis Supabase (sans passer par le cache).
  // Met le cache local à jour au passage, et renvoie le tableau d'objets
  // (ou null si la lecture échoue / hors-ligne -> l'appelant se repliera sur le cache).
  // Coalescence : plusieurs rendus lancés dans la même seconde partagent UNE
  // seule requête réseau par table (au lieu d'une chacun).
  const inflight = {};
  const lastFetch = {};
  const COALESCE_MS = 10000;
  function fetchTableRemote(storageKey) {
    const now = Date.now();
    if (inflight[storageKey] && now - (lastFetch[storageKey] || 0) < COALESCE_MS) {
      return inflight[storageKey];
    }
    lastFetch[storageKey] = now;
    const p = fetchTableRemoteRaw(storageKey);
    inflight[storageKey] = p;
    p.then(function () { if (inflight[storageKey] === p) inflight[storageKey] = null; },
           function () { if (inflight[storageKey] === p) inflight[storageKey] = null; });
    return p;
  }

  async function fetchTableRemoteRaw(storageKey) {
    const table = TABLES[storageKey];
    if (!table) return null;
    try {
      const rows = await fetchAllRows(table, "doc");
      let remote = rows.map((r) => r.doc).filter(Boolean);
      // Exclut les enregistrements supprimés (tombstones).
      remote = remote.filter((d) => !isTombstoned(storageKey, d.id));
      // N'embarque JAMAIS les images dans cette lecture "pleine table" (rapide) :
      // l'image réelle n'est récupérée qu'à la demande via fetchImage().
      if (LAZY_IMAGE_TABLES[storageKey]) remote = stripImages(remote);
      // Supabase est autoritaire : on remplace le cache, SAUF si une écriture locale
      // est en cours (pour ne pas perdre une donnée pas encore poussée).
      if (!pushBusy(storageKey)) rawSetItem(storageKey, JSON.stringify(remote));
      return remote;
    } catch (e) {
      return null;
    }
  }

  // Expose un util pour forcer une synchro manuelle si besoin
  window.acbSync = { pullAll: pullAll, pushTable: pushTable, pollOnce: pollOnce, deleteRow: deleteRow, fetchTable: fetchTableRemote, upsertRows: upsertRows, fetchImage: fetchImage, imageCacheGet: imageCacheGet, imageCacheSet: imageCacheSet };

  // Insère / met à jour directement quelques lignes dans une table (upsert par id).
  // Sert à la reconstruction ciblée (ex. clients manquants depuis le journal).
  async function upsertRows(storageKey, items) {
    const table = TABLES[storageKey];
    if (!table || !Array.isArray(items) || !items.length) return false;
    try {
      // Ne JAMAIS écrire le jeton "__LAZY__" à la place d'une vraie image.
      if (LAZY_IMAGE_TABLES[storageKey]) {
        items = await resolveLazyImages(table, items.slice());
        items = items.filter((it) => it.cardImage !== "__LAZY__");
        if (!items.length) return false;
      }
      const rows = items.map((it) => ({ id: String(it.id), doc: it }));
      const res = await fetch(REST + table + "?on_conflict=id", {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
        body: JSON.stringify(rows),
      });
      return res.ok;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------
     STOCKAGE DES IMAGES (Supabase Storage — bucket « cartes »)
     Les photos sont envoyées dans un bucket (1 Go gratuit, séparé de la
     base 500 Mo) et on ne conserve qu'une URL courte. Cela évite de saturer
     le stockage local du navigateur (~5 Mo) et la base de données.
     uploadImage(dataUrl) :
       - si déjà une URL http(s) → renvoyée telle quelle ;
       - sinon convertit la Data URL base64 en fichier et l'envoie au bucket ;
       - renvoie l'URL publique, ou null en cas d'échec (l'appelant garde alors
         l'image base64 d'origine — repli de sécurité).
     --------------------------------------------------------------- */
  const STORAGE_BUCKET = "cartes";
  const STORAGE_BASE = SUPABASE_URL + "/storage/v1/object/";
  function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return null;
    const mime = m[1];
    const bin = atob(m[2]);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  async function uploadImage(dataUrl, idHint) {
    if (!dataUrl) return null;
    if (/^https?:\/\//i.test(dataUrl)) return dataUrl; // déjà une URL
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return null;
    const safe = String(idHint || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "");
    const path = "cards/" + safe + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".jpg";
    try {
      const res = await fetch(STORAGE_BASE + STORAGE_BUCKET + "/" + path, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY,
          "Content-Type": blob.type || "image/jpeg",
          "x-upsert": "true",
        },
        body: blob,
      });
      if (!res.ok) return null;
      return STORAGE_BASE + "public/" + STORAGE_BUCKET + "/" + path;
    } catch (e) {
      return null;
    }
  }
  // Supprime une image du bucket à partir de son URL publique (best-effort).
  async function deleteImage(url) {
    if (!url || typeof url !== "string") return;
    const marker = "/object/public/" + STORAGE_BUCKET + "/";
    const i = url.indexOf(marker);
    if (i === -1) return; // pas une URL de notre bucket (ex. base64) → rien à faire
    const path = url.slice(i + marker.length);
    if (!path) return;
    try {
      await fetch(STORAGE_BASE + STORAGE_BUCKET + "/" + path, {
        method: "DELETE",
        headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY },
      });
    } catch (e) {}
  }
  window.acbStorage = { upload: uploadImage, remove: deleteImage };

  /* ---------------------------------------------------------------
     CONFIG PARTAGÉE (paramètres synchronisés via Supabase)
     Table « config » : 1 ligne par paramètre { id, doc }.
     Sert notamment aux IDENTIFIANTS ADMIN (id = "admin_creds") pour
     qu'une modification soit valable sur TOUS les appareils.
     --------------------------------------------------------------- */
  const CONFIG_TABLE = "config";
  // Correspondance id Supabase -> clé localStorage à tenir à jour (configs OBJET, ex. identifiants)
  const CONFIG_KEYS = { admin_creds: "acb_admin_creds", replaced_cards: "acb_replaced_cards" };
  // Préférences SIMPLES (valeur scalaire « 0 »/« 1 ») partagées entre tous les appareils
  const CONFIG_RAW_KEYS = {
    pref_stats_hidden: "acb_stats_hidden",        // masquage des montants (admin)
    pref_hide_daily_amount: "acb_hide_daily_amount", // masquage du montant journalier (staff)
  };

  async function pullConfig() {
    try {
      const res = await fetch(REST + CONFIG_TABLE + "?select=id,doc", { headers });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      let changed = false;
      rows.forEach((r) => {
        // Tombstones : fusion des suppressions de tous les appareils.
        if (r.id === "tombstones" && r.doc) {
          let merged = false;
          ["clients", "staff", "cartes_retirees", "clients_jour"].forEach((k) => {
            const remoteIds = Array.isArray(r.doc[k]) ? r.doc[k].map(String) : [];
            remoteIds.forEach((id) => {
              if (tombstones[k].indexOf(id) === -1) { tombstones[k].push(id); merged = true; }
            });
          });
          if (merged) { rawSetItem(TOMB_LS, JSON.stringify(tombstones)); changed = true; }
        }
        const lsKey = CONFIG_KEYS[r.id];
        if (lsKey && r.doc) {
          const json = JSON.stringify(r.doc);
          if (localStorage.getItem(lsKey) !== json) { rawSetItem(lsKey, json); changed = true; }
        }
        // Préférences simples : on écrit la valeur brute (ex. "1") dans localStorage
        const rawKey = CONFIG_RAW_KEYS[r.id];
        if (rawKey && r.doc && r.doc.value != null) {
          const v = String(r.doc.value);
          if (localStorage.getItem(rawKey) !== v) { rawSetItem(rawKey, v); changed = true; }
        }
      });
      // Migration initiale : si la config distante est vide mais qu'on a déjà
      // des identifiants admin en local, on les pousse vers Supabase.
      if (!ready) {
        const hasRemoteAdmin = rows.some((r) => r.id === "admin_creds");
        const localAdmin = localStorage.getItem("acb_admin_creds");
        if (!hasRemoteAdmin && localAdmin) {
          try { setConfig("admin_creds", JSON.parse(localAdmin)); } catch (e) {}
        }
      }
      return changed ? "changed" : "unchanged";
    } catch (e) {
      return "error";
    }
  }

  async function setConfig(id, doc) {
    const lsKey = CONFIG_KEYS[id];
    if (lsKey) rawSetItem(lsKey, JSON.stringify(doc)); // met à jour le cache local
    try {
      await fetch(REST + CONFIG_TABLE + "?on_conflict=id", {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
        body: JSON.stringify([{ id: String(id), doc: doc }]),
      });
    } catch (e) {
      console.warn("[ACB] Config push échoué (" + id + ") :", e.message);
    }
  }

  window.acbConfig = { pull: pullConfig, set: setConfig, setRaw: setConfigRaw };

  /* Liste noire des cartes REMPLACÉES (ancien n°) : plus aucun enregistrement,
     mise à jour ni retrait possible sur ce n°. Synchronisée via la table config. */
  function getReplacedCards() {
    try {
      const d = JSON.parse(localStorage.getItem("acb_replaced_cards") || "{}");
      return Array.isArray(d.value) ? d.value.map((x) => String(x)) : [];
    } catch (e) { return []; }
  }
  function isCardReplaced(numeroCarte) {
    const n = String(numeroCarte || "").trim().toLowerCase();
    return getReplacedCards().some((c) => String(c).trim().toLowerCase() === n);
  }
  async function addReplacedCard(numeroCarte) {
    const n = String(numeroCarte || "").trim();
    if (!n) return;
    const list = getReplacedCards();
    if (!list.some((c) => String(c).trim().toLowerCase() === n.toLowerCase())) list.push(n);
    await setConfig("replaced_cards", { value: list });
  }
  window.acbReplaced = { list: getReplacedCards, has: isCardReplaced, add: addReplacedCard };

  // Enregistre une préférence simple (scalaire) et la synchronise vers Supabase.
  // id = clé Supabase (ex. "pref_stats_hidden"), value = chaîne ("0"/"1").
  async function setConfigRaw(id, value) {
    const rawKey = CONFIG_RAW_KEYS[id];
    if (rawKey) rawSetItem(rawKey, String(value)); // cache local immédiat
    try {
      await fetch(REST + CONFIG_TABLE + "?on_conflict=id", {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
        body: JSON.stringify([{ id: String(id), doc: { value: String(value) } }]),
      });
    } catch (e) {
      console.warn("[ACB] Préférence push échouée (" + id + ") :", e.message);
    }
  }

  /* ---------------------------------------------------------------
     JOURNAL PERMANENT « client du jour » (append-only)
     Chaque enregistrement ajoute une ligne, jamais supprimée.
     --------------------------------------------------------------- */
  function readJournal() {
    try {
      const a = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  // Écrit le journal en cache local en tolérant le dépassement de quota :
  // si l'écriture échoue (images base64 volumineuses), on réessaie en retirant
  // les images du cache (les images restent disponibles sur Supabase).
  function writeJournalCache(arr) {
    try {
      rawSetItem(JOURNAL_KEY, JSON.stringify(arr));
      return true;
    } catch (quota) {
      try {
        const slim = arr.map((e) => { const c = Object.assign({}, e); delete c.cardImage; return c; });
        rawSetItem(JOURNAL_KEY, JSON.stringify(slim));
        return true;
      } catch (e2) {
        return false; // cache local plein : tant pis, l'entrée vit sur Supabase
      }
    }
  }
  async function addJournalEntry(entry) {
    if (!entry || !entry.id) return;
    // N'écrase JAMAIS une vraie image par le jeton « __LAZY__ » : si l'entrée
    // vient du cache allégé, on rétablit l'image réelle vue sur cet appareil
    // (sinon on renonce à la ré-écrire pour ne rien perdre en base).
    if (entry.cardImage === "__LAZY__") {
      const real = imageCacheGet(entry.id);
      if (real) entry = Object.assign({}, entry, { cardImage: real });
      else return;
    }
    // 1) ENVOI SUPABASE D'ABORD : l'entrée n'est jamais perdue, même si le cache
    //    local dépasse le quota (cas mobile avec images volumineuses).
    try {
      await fetch(REST + JOURNAL_TABLE + "?on_conflict=id", {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, headers),
        body: JSON.stringify([{ id: String(entry.id), doc: entry }]),
      });
    } catch (e) {
      console.warn("[ACB] Journal push échoué :", e.message);
    }
    // 2) Cache local en best-effort (tolérant au quota).
    const arr = readJournal();
    arr.push(entry);
    writeJournalCache(arr);
  }
  // Récupère le journal DIRECTEMENT depuis Supabase (sans passer par le cache).
  // Renvoie le tableau d'entrées distantes, ou null si la lecture échoue (hors-ligne).
  // Met aussi le cache local à jour au passage.
  let jInflight = null, jLast = 0;
  function fetchJournalRemote() {
    const now = Date.now();
    if (jInflight && now - jLast < 10000) return jInflight;
    jLast = now;
    const p = fetchJournalRemoteRaw();
    jInflight = p;
    const clear = function () { if (jInflight === p) jInflight = null; };
    p.then(clear, clear);
    return p;
  }

  // Lit TOUTES les lignes d'une table par pages de 1000 (Supabase plafonne
  // chaque réponse à 1000 lignes : sans pagination, les enregistrements les
  // plus récents étaient purement et simplement invisibles).
  async function fetchAllRows(table, select) {
    const PAGE = 1000;
    let out = [], from = 0;
    for (;;) {
      const res = await fetch(REST + table + "?select=" + select + "&order=id.asc", {
        headers: Object.assign({ Range: from + "-" + (from + PAGE - 1), "Range-Unit": "items" }, headers),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      out = out.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
      if (from > 100000) break; // garde-fou
    }
    return out;
  }

  async function fetchJournalRemoteRaw() {
    try {
      const rows = await fetchAllRows(JOURNAL_TABLE, "doc");
      const remote = stripImages(rows.map((r) => r.doc).filter(Boolean).filter((e) => !isTombstoned(JOURNAL_KEY, e.id)));
      // Met à jour le cache local (fusion append-only) pour rester cohérent.
      const local = readJournal();
      const byId = {};
      remote.concat(local).forEach((e) => { if (e && e.id && !isTombstoned(JOURNAL_KEY, e.id)) byId[e.id] = e; });
      writeJournalCache(Object.values(byId));
      return remote;
    } catch (e) {
      return null; // hors-ligne : l'appelant se repliera sur le cache local
    }
  }
  async function pullJournal() {
    try {
      const rows = await fetchAllRows(JOURNAL_TABLE, "doc");
      const remote = stripImages(rows.map((r) => r.doc).filter(Boolean).filter((e) => !isTombstoned(JOURNAL_KEY, e.id)));
      const local = readJournal();
      const before = local.length;
      // Fusion append-only : on garde toutes les entrées (locales + distantes), dédupliquées par id.
      const byId = {};
      remote.concat(local).forEach((e) => { if (e && e.id && !isTombstoned(JOURNAL_KEY, e.id)) byId[e.id] = e; });
      const merged = Object.values(byId);
      // Ré-émet un DELETE pour toute entrée tombstonée encore présente sur le distant.
      rows.map((r) => r.doc).filter(Boolean).forEach((e) => {
        if (isTombstoned(JOURNAL_KEY, e.id)) {
          try { fetch(REST + JOURNAL_TABLE + "?id=eq." + encodeURIComponent(String(e.id)), { method: "DELETE", headers }); } catch (x) {}
        }
      });
      // Pousse les entrées locales absentes du distant (jamais les tombstonées)
      const remoteIds = new Set(remote.map((e) => String(e.id)));
      local.forEach((e) => { if (e && e.id && !remoteIds.has(String(e.id)) && !isTombstoned(JOURNAL_KEY, e.id)) addJournalEntry(e); });
      writeJournalCache(merged);
      // Signale un changement si le nombre d'entrées a évolué (nouvelles entrées d'un autre appareil)
      return merged.length !== before ? "changed" : "unchanged";
    } catch (e) { /* hors-ligne : on garde le cache local */ return "error"; }
  }
  async function removeJournalEntry(id) {
    if (!id) return;
    addTombstone(JOURNAL_KEY, id);
    // Supprime du cache local
    const arr = readJournal().filter((e) => String(e.id) !== String(id));
    rawSetItem(JOURNAL_KEY, JSON.stringify(arr));
    // Supprime de Supabase
    try {
      await fetch(REST + JOURNAL_TABLE + "?id=eq." + encodeURIComponent(String(id)), {
        method: "DELETE",
        headers,
      });
    } catch (e) {
      console.warn("[ACB] Journal delete échoué :", e.message);
    }
  }
  // Supprime DÉFINITIVEMENT toutes les entrées de journal d'un n° de carte
  // (cache local + Supabase). Utilisé quand on supprime un client.
  async function removeJournalByCard(numeroCarte) {
    if (numeroCarte == null) return;
    const card = String(numeroCarte);
    // Retrait local immédiat
    const arr = readJournal().filter((e) => String(e.numeroCarte) !== card);
    rawSetItem(JOURNAL_KEY, JSON.stringify(arr));
    // Côté Supabase : on récupère les entrées de cette carte puis on les
    // supprime PAR ID (le filtre JSON dans l'URL n'est pas fiable).
    try {
      const res = await fetch(REST + JOURNAL_TABLE + "?select=id,doc", { headers });
      if (res.ok) {
        const rows = await res.json();
        const ids = rows
          .filter((r) => r.doc && String(r.doc.numeroCarte) === card)
          .map((r) => r.id);
        for (const id of ids) {
          addTombstone(JOURNAL_KEY, id);
          await fetch(REST + JOURNAL_TABLE + "?id=eq." + encodeURIComponent(String(id)), {
            method: "DELETE",
            headers,
          });
        }
      }
    } catch (e) {
      console.warn("[ACB] Journal delete par carte échoué :", e.message);
    }
  }
  window.acbJournal = { add: addJournalEntry, read: readJournal, pull: pullJournal, remove: removeJournalEntry, removeByCard: removeJournalByCard, fetchRemote: fetchJournalRemote };

  // Synchro initiale au chargement de chaque page
  pullAll();
})();

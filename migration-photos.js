/* =================================================================
   Arc en Ciel Business — Migration des photos (base64 -> bucket)
   Parcourt les tables clients, clients_jour, cartes_retirees ; pour
   chaque enregistrement dont la photo est encore une Data URL base64,
   l'envoie dans le bucket « cartes » (via window.acbStorage.upload) et
   remplace la photo par l'URL courte, puis met à jour la ligne Supabase.
   Reprise sur erreur : une photo qui échoue est laissée telle quelle.
   ================================================================= */
(function () {
  "use strict";

  var SUPABASE_URL = "https://xlxnetjrftnnwmmfqswl.supabase.co";
  var SUPABASE_KEY = "sb_publishable_o1GHKowDY3MDT_xZnG3tiQ_xk_ThxxV";
  var REST = SUPABASE_URL + "/rest/v1/";
  var HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json",
  };

  // Tables à parcourir (clé d'affichage -> nom de table Supabase)
  var TABLES = [
    { label: "Clients", table: "clients" },
    { label: "Journal", table: "clients_jour" },
    { label: "Cartes retirées", table: "cartes_retirees" },
  ];

  var logEl = document.getElementById("log");
  var barEl = document.getElementById("bar");
  var statEl = document.getElementById("stat");
  var startBtn = document.getElementById("startBtn");

  function log(msg, cls) {
    var line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    barEl.style.width = pct + "%";
    statEl.textContent = done + " / " + total + " photo(s) traitée(s) — " + pct + "%";
  }

  // Récupère toutes les lignes d'une table : [{ id, doc }]
  async function fetchRows(table) {
    var res = await fetch(REST + table + "?select=id,doc", { headers: HEADERS });
    if (!res.ok) throw new Error("Lecture " + table + " : HTTP " + res.status);
    return await res.json();
  }

  // Met à jour le doc d'une ligne (upsert)
  async function upsertRow(table, id, doc) {
    var res = await fetch(REST + table + "?on_conflict=id", {
      method: "POST",
      headers: Object.assign({ "Prefer": "resolution=merge-duplicates,return=minimal" }, HEADERS),
      body: JSON.stringify([{ id: String(id), doc: doc }]),
    });
    if (!res.ok) throw new Error("Écriture " + table + " : HTTP " + res.status);
  }

  function isBase64Image(v) {
    return typeof v === "string" && v.indexOf("data:") === 0;
  }

  // Convertit une Data URL base64 en Blob
  function dataUrlToBlob(dataUrl) {
    var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return null;
    var bin = atob(m[2]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  }

  // Envoi DÉTAILLÉ vers le bucket : renvoie l'URL publique, ou lève une
  // erreur contenant le code HTTP + le message Supabase (pour diagnostic).
  var STORAGE_BUCKET = "cartes";
  var STORAGE_OBJ = SUPABASE_URL + "/storage/v1/object/";
  async function uploadDetailed(dataUrl, idHint) {
    if (/^https?:\/\//i.test(dataUrl)) return dataUrl;
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) throw new Error("image illisible");
    var safe = String(idHint || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "");
    var path = "cards/" + safe + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".jpg";
    var res = await fetch(STORAGE_OBJ + STORAGE_BUCKET + "/" + path, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": blob.type || "image/jpeg",
        "x-upsert": "true",
      },
      body: blob,
    });
    if (!res.ok) {
      var detail = "";
      try { detail = (await res.text()).slice(0, 160); } catch (e) {}
      throw new Error("HTTP " + res.status + (detail ? " — " + detail : ""));
    }
    return STORAGE_OBJ + "public/" + STORAGE_BUCKET + "/" + path;
  }

  async function run() {
    startBtn.disabled = true;
    log("Analyse des tables…");

    if (!window.acbStorage || typeof window.acbStorage.upload !== "function") {
      log("Note : module de stockage standard indisponible — utilisation de l'envoi direct.", "skip");
    }

    // 1) Collecte de toutes les photos base64 à migrer
    var jobs = [];
    for (var i = 0; i < TABLES.length; i++) {
      var t = TABLES[i];
      var rows;
      try {
        rows = await fetchRows(t.table);
      } catch (e) {
        log("⚠ " + e.message, "err");
        continue;
      }
      var count = 0;
      rows.forEach(function (r) {
        if (r.doc && isBase64Image(r.doc.cardImage)) {
          jobs.push({ table: t.table, label: t.label, id: r.id, doc: r.doc });
          count++;
        }
      });
      log(t.label + " : " + rows.length + " ligne(s), " + count + " photo(s) à migrer.");
    }

    if (!jobs.length) {
      log("✓ Rien à migrer : toutes les photos sont déjà optimisées.", "ok");
      statEl.textContent = "Migration terminée — aucune photo à déplacer.";
      barEl.style.width = "100%";
      startBtn.disabled = false;
      return;
    }

    log("");
    log("Début de la migration de " + jobs.length + " photo(s)…");
    setProgress(0, jobs.length);

    // 2) Migration séquentielle (douce pour le réseau mobile)
    var done = 0, migrated = 0, failed = 0, freedKB = 0;
    for (var j = 0; j < jobs.length; j++) {
      var job = jobs[j];
      var sizeKB = Math.round((job.doc.cardImage.length / 1024));
      try {
        var url = await uploadDetailed(job.doc.cardImage, job.doc.numeroCarte || job.id);
        if (!url) throw new Error("upload refusé");
        var newDoc = Object.assign({}, job.doc, { cardImage: url });
        await upsertRow(job.table, job.id, newDoc);
        migrated++;
        freedKB += sizeKB;
        log("✓ " + job.label + " · carte " + (job.doc.numeroCarte || job.id) + " (" + sizeKB + " Ko → lien)", "ok");
      } catch (e) {
        failed++;
        log("✗ " + job.label + " · carte " + (job.doc.numeroCarte || job.id) + " : " + e.message + " (photo conservée)", "err");
      }
      done++;
      setProgress(done, jobs.length);
    }

    log("");
    log("───────────────────────────────");
    log("Terminé : " + migrated + " migrée(s), " + failed + " échec(s).", migrated ? "ok" : "");
    if (freedKB) log("Espace base libéré : ~" + (freedKB >= 1024 ? (freedKB / 1024).toFixed(1) + " Mo" : freedKB + " Ko") + ".", "ok");
    if (failed) log("Les photos en échec restent intactes ; vous pouvez relancer la migration plus tard.", "skip");
    statEl.textContent = "Migration terminée : " + migrated + " photo(s) déplacée(s).";
    startBtn.disabled = false;
    startBtn.textContent = "Relancer la migration";
  }

  startBtn.addEventListener("click", run);

  /* ===============================================================
     NETTOYAGE DES PHOTOS ORPHELINES
     Liste tous les fichiers du bucket, recense les photos encore
     référencées (clients, journal, cartes retirées) et supprime les
     fichiers qui ne sont plus liés à aucun enregistrement.
     =============================================================== */
  var STORAGE_LIST = SUPABASE_URL + "/storage/v1/object/list/" + STORAGE_BUCKET;
  var STORAGE_DEL = SUPABASE_URL + "/storage/v1/object/" + STORAGE_BUCKET + "/";
  // En-têtes d'authentification SANS Content-Type (un DELETE sans corps + 
  // Content-Type:application/json renvoie une erreur 400 côté Supabase).
  var AUTH_ONLY = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY };
  var cleanBtn = document.getElementById("cleanBtn");

  // Liste tous les fichiers sous cards/ (pagination par lots de 100)
  async function listAllCards() {
    var all = [];
    var offset = 0;
    while (true) {
      var res = await fetch(STORAGE_LIST, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ prefix: "cards/", limit: 100, offset: offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!res.ok) throw new Error("Liste bucket : HTTP " + res.status);
      var batch = await res.json();
      if (!Array.isArray(batch) || !batch.length) break;
      all = all.concat(batch);
      if (batch.length < 100) break;
      offset += 100;
    }
    return all;
  }

  async function cleanOrphans() {
    cleanBtn.disabled = true;
    startBtn.disabled = true;
    log("");
    log("── Nettoyage des photos orphelines ──");

    // 1) Recense toutes les photos encore référencées (chemin de fichier).
    var referenced = {};
    var marker = "/object/public/" + STORAGE_BUCKET + "/";
    for (var i = 0; i < TABLES.length; i++) {
      var rows;
      try { rows = await fetchRows(TABLES[i].table); }
      catch (e) { log("⚠ " + e.message, "err"); continue; }
      rows.forEach(function (r) {
        var img = r.doc && r.doc.cardImage;
        if (typeof img === "string") {
          var k = img.indexOf(marker);
          if (k !== -1) referenced[img.slice(k + marker.length)] = true;
        }
      });
    }
    log("Photos référencées : " + Object.keys(referenced).length);

    // 2) Liste les fichiers réels du bucket.
    var files;
    try { files = await listAllCards(); }
    catch (e) { log("✗ " + e.message, "err"); cleanBtn.disabled = false; startBtn.disabled = false; return; }
    log("Fichiers dans le bucket : " + files.length);

    // 3) Supprime ceux qui ne sont plus référencés.
    var orphans = files.filter(function (f) { return f.name && !referenced["cards/" + f.name]; });
    if (!orphans.length) {
      log("✓ Aucune photo orpheline. Le stockage est propre.", "ok");
      cleanBtn.disabled = false; startBtn.disabled = false;
      return;
    }
    log(orphans.length + " photo(s) orpheline(s) à supprimer…");
    setProgress(0, orphans.length);
    var done = 0, removed = 0, failed = 0;
    for (var j = 0; j < orphans.length; j++) {
      try {
        var d = await fetch(STORAGE_DEL + "cards/" + encodeURIComponent(orphans[j].name), {
          method: "DELETE", headers: AUTH_ONLY,
        });
        if (d.ok) { removed++; } else { failed++; }
      } catch (e) { failed++; }
      done++;
      setProgress(done, orphans.length);
    }
    log("───────────────────────────────");
    log("Nettoyage terminé : " + removed + " supprimée(s)" + (failed ? ", " + failed + " échec(s)" : "") + ".", removed ? "ok" : "");
    statEl.textContent = "Nettoyage terminé : " + removed + " photo(s) orpheline(s) supprimée(s).";
    cleanBtn.disabled = false;
    startBtn.disabled = false;
  }

  cleanBtn.addEventListener("click", cleanOrphans);
})();

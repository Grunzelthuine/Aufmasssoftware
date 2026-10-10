"use strict";

/* ============================================================
   Cloud-Sync (seit Version 13.0)
   Synchronisiert alle lokal gespeicherten Daten (Aufmaße, Packlisten,
   Bauaufmaße, Produktliste, eigene Artikel, Favoriten, Standardmaterial-
   Ergänzungen) pro Benutzerkonto über Google Firebase (Auth + Firestore).

   Prinzip „lokal zuerst“: Die App arbeitet weiter mit localStorage. Dieses
   Modul bemerkt jede Speicherung (localStorage.setItem wird beobachtet),
   ermittelt geänderte/gelöschte Einträge und schreibt sie nach
   users/{uid}/{sammlung}/{id} als { d: JSON, t: Zeitstempel, del: bool }.
   Änderungen anderer Geräte kommen per Live-Abo (onSnapshot) zurück und
   werden pro Eintrag nach „neuester gewinnt“ eingemischt. Löschungen werden
   als Grabstein (del: true) gespeichert, damit ein Gerät, das länger
   offline war, gelöschte Einträge nicht wieder hochlädt.
   Ohne Konfiguration (firebase-config.js) bleibt alles wie bisher lokal.
   Wird NACH app.js geladen.
   ============================================================ */

const SYNC_META_KEY = "am2_sync_meta";

// Aufmaßsoftware: eigene Sammlungen in Firestore (users/{uid}/am2_…), getrennt von der bisherigen App
const CLOUD_PREFIX = "am2_";
const SYNC_SAMMLUNGEN = [
  { name: "aufmasse", key: "am2_liste", typ: "array", id: (x) => x.id, neu: () => ladeListe() },
  { name: "packlisten", key: "am2_packlisten", typ: "array", id: (x) => x.id, neu: () => ladePacklisten() },
  { name: "bauaufmasse", key: "am2_bauaufmasse", typ: "array", id: (x) => x.id, neu: () => ladeBauaufmasse() },
  // v15: zentrale Materialdatenbank (ersetzt produkte, eigeneArtikel, standardErgaenzungen)
  { name: "kategorien", key: "am2_kategorien", typ: "array", id: (x) => x.id, neu: () => ladeDatenbank() },
  { name: "material", key: "am2_material", typ: "array", id: (x) => x.id, neu: () => ladeDatenbank() },
  { name: "ordner", key: "am2_ordner", typ: "array", id: (x) => x.id, neu: () => ladeDatenbank() }, // v19: Baustellen-Ordner
  { name: "raumvorlagen", key: "am2_raumvorlagen", typ: "array", id: (x) => x.id, neu: () => ladeRaumVorlagen() },
  { name: "einstellungen", key: "am2_einstellungen", typ: "map", neu: () => ladeEinstellungen() }, // Mitarbeiter + Nummernzähler
  { name: "favoriten", key: "am2_favoriten", typ: "map", neu: () => ladeFavoriten() },
  { name: "sterne", key: "am2_sterne", typ: "map", neu: () => ladeSterne() } // v16: Favoriten per Stern
];

const cloud = {
  konfiguriert: false,
  fehler: "",
  user: null,
  db: null,
  auth: null,
  abos: [],
  meta: { uid: null, colls: {} },
  inFlight: {},           // name -> { id: hash }
  letzteSync: null,
  offline: !navigator.onLine,
  intern: false,          // true, während das Modul selbst localStorage schreibt
  scanTimer: {},
  uiTimer: null
};

/* ---------- Hilfen ---------- */

// cyrb53: schneller 53-bit-Hash für Änderungserkennung
function syncHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function ladeSyncMeta() {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    cloud.meta = raw ? JSON.parse(raw) : { uid: null, colls: {} };
    if (!cloud.meta.colls) cloud.meta.colls = {};
  } catch (e) {
    cloud.meta = { uid: null, colls: {} };
  }
}

function speichereSyncMeta() {
  cloud.intern = true;
  try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(cloud.meta)); } catch (e) { console.error(e); }
  cloud.intern = false;
}

function collMeta(name) {
  if (!cloud.meta.colls[name]) cloud.meta.colls[name] = {};
  return cloud.meta.colls[name];
}

// Liefert Map id -> { json, item } der lokal gespeicherten Einträge einer Sammlung
function lokaleEintraege(s) {
  const map = new Map();
  let daten;
  try { daten = JSON.parse(localStorage.getItem(s.key) || (s.typ === "map" ? "{}" : "[]")); } catch (e) { daten = s.typ === "map" ? {} : []; }
  if (s.typ === "map") {
    for (const [k, v] of Object.entries(daten || {})) map.set(k, { json: JSON.stringify(v), item: v });
  } else {
    for (const x of daten || []) {
      const id = s.id(x);
      if (id === undefined || id === null || id === "") continue;
      map.set(String(id), { json: JSON.stringify(x), item: x });
    }
  }
  return map;
}

/* Vergleicht den lokalen Stand mit dem zuletzt bekannten (lh) und
   vermerkt Änderungen mit Zeitstempel (lt). Läuft auch ohne Anmeldung,
   damit beim späteren Anmelden klar ist, was wann geändert wurde. */
function scanSammlung(s) {
  const m = collMeta(s.name);
  const lokal = lokaleEintraege(s);
  const jetzt = Date.now();
  let geaendert = false;
  for (const [id, { json, item }] of lokal) {
    const h = syncHash(json);
    const e = m[id] || (m[id] = { h: null, lh: null, lt: 0 });
    if (e.lh !== h) {
      // Aus alten Listen übernommene Einträge (_imp) gelten als „alt“, damit beim
      // Einmischen der Stand aus der Cloud (z. B. eine Löschung) gewinnt.
      e.lt = e.lh === null && item && item._imp ? 1 : jetzt;
      e.lh = h;
      geaendert = true;
    }
  }
  for (const [id, e] of Object.entries(m)) {
    if (!lokal.has(id) && e.lh !== "DEL") { e.lh = "DEL"; e.lt = jetzt; geaendert = true; }
  }
  if (geaendert) speichereSyncMeta();
  return lokal;
}

function anzahlAusstehend() {
  let n = 0;
  for (const s of SYNC_SAMMLUNGEN) {
    for (const e of Object.values(collMeta(s.name))) if (e.lh !== e.h && !(e.lh === "DEL" && e.h === null)) n++;
  }
  return n;
}

/* ---------- Hochladen ---------- */

async function pushSammlung(s) {
  if (!cloud.user || !cloud.db) return;
  const lokal = scanSammlung(s);
  const m = collMeta(s.name);
  const flight = cloud.inFlight[s.name] || (cloud.inFlight[s.name] = {});
  const zuSenden = [];
  for (const [id, e] of Object.entries(m)) {
    if (e.lh === e.h) continue;
    if (e.lh === "DEL" && e.h === null) continue;     // nie hochgeladen und lokal gelöscht
    if (flight[id] === e.lh) continue;                 // schon unterwegs
    zuSenden.push(id);
  }
  if (!zuSenden.length) return;
  const basis = cloud.db.collection("users").doc(cloud.user.uid).collection(CLOUD_PREFIX + s.name);
  // kleine Pakete, damit eine Übertragung unter der Größengrenze (10 MB) bleibt
  for (let i = 0; i < zuSenden.length; i += 100) {
    const teil = zuSenden.slice(i, i + 100);
    const batch = cloud.db.batch();
    const gesendet = {};
    for (const id of teil) {
      const e = m[id];
      const del = e.lh === "DEL";
      const json = del ? null : lokal.get(id).json;
      if (json && json.length > 900000) {
        cloud.fehler = `Ein Eintrag in „${s.name}“ ist zu groß für die Cloud (über 900 KB) und wird nur lokal gespeichert.`;
        continue;
      }
      batch.set(basis.doc(encodeURIComponent(id)), { d: json, t: e.lt || Date.now(), del });
      gesendet[id] = e.lh;
      flight[id] = e.lh;
    }
    planeUi();
    try {
      await batch.commit();
      for (const [id, h] of Object.entries(gesendet)) {
        if (m[id]) m[id].h = h;
        if (flight[id] === h) delete flight[id];
      }
      cloud.letzteSync = new Date();
      if (!cloud.fehler.startsWith("Ein Eintrag")) cloud.fehler = "";
      speichereSyncMeta();
    } catch (err) {
      for (const id of Object.keys(gesendet)) delete flight[id];
      const msg = err && err.message ? err.message : String(err);
      if (!navigator.onLine || /fetch|network|unavailable|offline/i.test(msg)) {
        cloud.fehler = ""; // offline: Änderungen bleiben vorgemerkt und gehen beim nächsten Online-Sein raus
      } else {
        console.error("Cloud-Sync: Hochladen fehlgeschlagen", err);
        cloud.fehler = "Hochladen fehlgeschlagen: " + msg;
      }
    }
    planeUi();
  }
}

function planeScan(s, sofort) {
  clearTimeout(cloud.scanTimer[s.name]);
  cloud.scanTimer[s.name] = setTimeout(() => {
    if (cloud.user) pushSammlung(s);
    else scanSammlung(s);
    planeUi();
  }, sofort ? 0 : 1500);
}

function syncAlles() {
  for (const s of SYNC_SAMMLUNGEN) planeScan(s, true);
}

/* ---------- Herunterladen / Einmischen ---------- */

function wendeRemoteAn(s, aenderungen) {
  const m = collMeta(s.name);
  let daten;
  try { daten = JSON.parse(localStorage.getItem(s.key) || (s.typ === "map" ? "{}" : "[]")); } catch (e) { daten = s.typ === "map" ? {} : []; }
  // aktuellen lokalen Stand erfassen (falls seit der letzten Speicherung noch nicht gescannt)
  scanSammlung(s);
  const betroffen = [];
  let lokalGeschrieben = false;
  for (const { id, d, t, del } of aenderungen) {
    const rh = del ? "DEL" : syncHash(d || "");
    const e = m[id] || (m[id] = { h: null, lh: null, lt: 0 });
    if (e.lh === rh) { e.h = rh; continue; }               // identisch
    const lokalSauber = e.lh === e.h || e.lh === null;     // lokal seit letztem Sync unverändert
    if (lokalSauber || (t || 0) > (e.lt || 0)) {
      // Remote übernehmen
      if (s.typ === "map") {
        if (del) delete daten[id]; else daten[id] = JSON.parse(d);
      } else {
        const idx = daten.findIndex((x) => String(s.id(x)) === id);
        if (del) { if (idx >= 0) daten.splice(idx, 1); }
        else if (idx >= 0) daten[idx] = JSON.parse(d);
        else daten.unshift(JSON.parse(d));
      }
      e.h = rh; e.lh = rh; e.lt = t || Date.now();
      lokalGeschrieben = true;
      betroffen.push(id);
    } else {
      e.h = rh; // lokal neuer -> bleibt, wird hochgeladen
    }
  }
  if (lokalGeschrieben) {
    cloud.intern = true;
    try { localStorage.setItem(s.key, JSON.stringify(daten)); } catch (err) { console.error(err); }
    cloud.intern = false;
    try { s.neu(); } catch (err) { console.error(err); }
  }
  speichereSyncMeta();
  return betroffen;
}

function aboniere() {
  beendeAbos();
  const uid = cloud.user.uid;
  for (const s of SYNC_SAMMLUNGEN) {
    const ref = cloud.db.collection("users").doc(uid).collection(CLOUD_PREFIX + s.name);
    const ab = ref.onSnapshot((snap) => {
      const aenderungen = [];
      snap.docChanges().forEach((c) => {
        if (c.type === "removed") return;
        const x = c.doc.data();
        aenderungen.push({ id: decodeURIComponent(c.doc.id), d: x.d, t: x.t, del: !!x.del });
      });
      if (aenderungen.length) {
        const betroffen = wendeRemoteAn(s, aenderungen);
        if (betroffen.length) nachRemoteAenderung(s, betroffen);
      }
      if (!snap.metadata.fromCache) cloud.letzteSync = new Date();
      cloud.offline = snap.metadata.fromCache && !navigator.onLine;
      pushSammlung(s); // lokal neuere Stände hochladen
      planeUi();
    }, (err) => {
      console.error("Cloud-Sync: Abo-Fehler", err);
      cloud.fehler = "Verbindung zur Cloud fehlgeschlagen: " + (err.code || err.message);
      planeUi();
    });
    cloud.abos.push(ab);
  }
}

function beendeAbos() {
  cloud.abos.forEach((ab) => { try { ab(); } catch (e) { /* egal */ } });
  cloud.abos = [];
}

function uebersichtSichtbar() {
  return typeof ansicht !== "undefined" && (ansicht === "start" || ansicht === "liste");
}

// Nach eingemischten Änderungen: Übersicht neu zeichnen bzw. Hinweis, wenn der offene Eintrag betroffen ist
function nachRemoteAenderung(s, ids) {
  if (uebersichtSichtbar()) {
    aktualisiereListenansicht();
    return;
  }
  const offen =
    (s.name === "aufmasse" && currentAufmass && ids.includes(currentAufmass.id)) ||
    (s.name === "packlisten" && currentPackliste && ids.includes(currentPackliste.id)) ||
    (s.name === "bauaufmasse" && currentBauaufmass && ids.includes(currentBauaufmass.id));
  if (offen) zeigeSyncHinweis("Dieser Eintrag wurde auf einem anderen Gerät geändert.", () => {
    if (s.name === "aufmasse") { const x = aufmassListe.find((a) => a.id === currentAufmass.id); if (x) oeffneFormular(x); }
    if (s.name === "packlisten") { const x = packlisten.find((a) => a.id === currentPackliste.id); if (x) oeffnePackliste(x); }
    if (s.name === "bauaufmasse") { const x = bauaufmasse.find((a) => a.id === currentBauaufmass.id); if (x) oeffneBauaufmass(x); }
  });
}

function zeigeSyncHinweis(text, onNeuLaden) {
  let el = document.getElementById("syncHinweis");
  if (!el) {
    el = document.createElement("div");
    el.id = "syncHinweis";
    el.className = "update-banner sync-hinweis";
    document.body.appendChild(el);
  }
  el.innerHTML = `<span></span><button class="btn btn-secondary">Neu laden</button><button class="btn-danger-text" style="color:#fff" aria-label="Schließen">${ic("x")}</button>`;
  el.querySelector("span").textContent = text;
  el.hidden = false;
  el.querySelectorAll("button")[0].addEventListener("click", () => { el.hidden = true; onNeuLaden(); });
  el.querySelectorAll("button")[1].addEventListener("click", () => { el.hidden = true; });
}

/* ---------- Anmeldung ---------- */

function loescheLokaleDaten() {
  cloud.intern = true;
  for (const s of SYNC_SAMMLUNGEN) localStorage.removeItem(s.key);
  localStorage.removeItem(SYNC_META_KEY);
  localStorage.removeItem("am2_db_version"); // Grundliste beim nächsten Start neu übernehmen
  cloud.intern = false;
  cloud.meta = { uid: null, colls: {} };
  for (const s of SYNC_SAMMLUNGEN) { try { s.neu(); } catch (e) { /* egal */ } }
}

async function beiAnmeldung(user) {
  if (cloud.meta.uid && cloud.meta.uid !== user.uid) {
    const ok = confirm(`Auf diesem Gerät liegen noch Daten eines anderen Kontos.\n\nOK = diese Daten vom Gerät entfernen und die Daten von ${user.email} laden.\nAbbrechen = abmelden.`);
    if (!ok) { await cloud.auth.signOut(); return; }
    loescheLokaleDaten();
  }
  cloud.user = user;
  cloud.meta.uid = user.uid;
  speichereSyncMeta();
  await uebernehmeAusAlterCloud(user);
  for (const s of SYNC_SAMMLUNGEN) scanSammlung(s);
  aboniere();
  planeUi();
  if (uebersichtSichtbar()) aktualisiereListenansicht();
}

/* Einmalig je Konto: Ist die Aufmaßsoftware-Cloud noch leer, werden die Daten der
   bisherigen App (users/{uid}/<sammlung>) gelesen und lokal ergänzt (nur fehlende
   Einträge). Danach lädt der normale Sync sie in die eigenen am2_-Sammlungen hoch.
   Die Daten der bisherigen App werden dabei nur gelesen, nie verändert. */
async function uebernehmeAusAlterCloud(user) {
  const flag = "am2_cloud_uebernahme_" + user.uid;
  if (localStorage.getItem(flag)) return;
  try {
    const basis = cloud.db.collection("users").doc(user.uid);
    const probe = await basis.collection(CLOUD_PREFIX + "material").limit(1).get();
    const probe2 = await basis.collection(CLOUD_PREFIX + "aufmasse").limit(1).get();
    if (probe.empty && probe2.empty) {
      let n = 0;
      for (const s of SYNC_SAMMLUNGEN) {
        const snap = await basis.collection(s.name).get();
        if (snap.empty) continue;
        let daten;
        try { daten = JSON.parse(localStorage.getItem(s.key) || (s.typ === "map" ? "{}" : "[]")); } catch (e) { daten = s.typ === "map" ? {} : []; }
        let geaendert = false;
        snap.forEach((doc) => {
          const x = doc.data();
          if (x.del || !x.d) return;
          const id = decodeURIComponent(doc.id);
          let item;
          try { item = JSON.parse(x.d); } catch (e) { return; }
          if (s.typ === "map") {
            if (!(id in daten)) { daten[id] = item; geaendert = true; n++; }
          } else if (!daten.some((y) => String(s.id(y)) === id)) { daten.push(item); geaendert = true; n++; }
        });
        if (geaendert) {
          cloud.intern = true;
          localStorage.setItem(s.key, JSON.stringify(daten));
          cloud.intern = false;
          try { s.neu(); } catch (e) { /* egal */ }
        }
      }
      if (n) {
        localStorage.setItem("am2_db_version", "1"); // Grundliste nicht zusätzlich einspielen
        console.info(`Aufmaßsoftware: ${n} Einträge aus der bisherigen App übernommen`);
      }
    }
    localStorage.setItem(flag, new Date().toISOString());
  } catch (e) {
    console.error("Übernahme aus der Cloud der bisherigen App fehlgeschlagen", e);
  }
}

const AUTH_FEHLER = {
  "auth/invalid-email": "Die E-Mail-Adresse ist ungültig.",
  "auth/invalid-credential": "E-Mail oder Passwort falsch.",
  "auth/wrong-password": "E-Mail oder Passwort falsch.",
  "auth/user-not-found": "E-Mail oder Passwort falsch.",
  "auth/email-already-in-use": "Für diese E-Mail gibt es schon ein Konto – bitte anmelden.",
  "auth/weak-password": "Das Passwort ist zu kurz (mindestens 6 Zeichen).",
  "auth/network-request-failed": "Keine Verbindung – bitte mit Internet erneut versuchen.",
  "auth/too-many-requests": "Zu viele Versuche – bitte kurz warten.",
  "auth/operation-not-allowed": "Anmeldung per E-Mail ist im Firebase-Projekt nicht aktiviert.",
  "auth/admin-restricted-operation": "Neue Konten sind gesperrt – Konto bitte in der Firebase-Konsole anlegen."
};

function authFehlerText(err) {
  return AUTH_FEHLER[err && err.code] || (err && err.message) || String(err);
}

/* ---------- Oberfläche ---------- */

function cloudStatusText() {
  if (!cloud.konfiguriert) return { text: "Cloud-Sync nicht eingerichtet", klasse: "aus" };
  if (!cloud.user) return { text: "Cloud-Sync: nicht angemeldet – tippen zum Anmelden", klasse: "aus" };
  const n = anzahlAusstehend();
  if (cloud.fehler) return { text: "" + cloud.fehler, klasse: "fehler" };
  if (n > 0) return { text: `${cloud.user.email} · ${n} Änderung${n === 1 ? "" : "en"} noch nicht übertragen${navigator.onLine ? "" : " (offline)"}`, klasse: "wartet" };
  const zeit = cloud.letzteSync ? cloud.letzteSync.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–";
  return { text: `${cloud.user.email} · synchronisiert ${zeit}`, klasse: "ok" };
}

function renderCloudStatus() {
  const el = document.getElementById("cloudStatus");
  if (!el) return;
  const st = cloudStatusText();
  if (el.closest(".kachel")) {
    // Kachel auf dem Startbildschirm
    el.className = "cloud-status-text " + st.klasse;
    el.textContent = st.text.replace(/^☁\s*/, "").replace("Cloud-Sync: ", "");
  } else {
    el.className = "cloud-status " + st.klasse;
    el.textContent = st.text;
    el.onclick = oeffneCloudKonto;
  }
}

function planeUi() {
  clearTimeout(cloud.uiTimer);
  cloud.uiTimer = setTimeout(() => {
    renderCloudStatus();
    const k = document.getElementById("cloudKontoStatus");
    if (k) k.textContent = cloudStatusText().text;
  }, 100);
}

function oeffneCloudKonto() {
  setzeAnsicht("konto");
  currentAufmass = null;
  currentPackliste = null;
  currentBauaufmass = null;
  currentRaum = null;
  zurueckAktion = oeffneEinstellungen;
  headerTitle.textContent = "Cloud-Sync";
  btnBack.hidden = false;
  btnNew.hidden = true;
  app.innerHTML = "";
  const view = document.createElement("section");
  view.className = "view";
  app.appendChild(view);
  window.scrollTo(0, 0);

  if (!cloud.konfiguriert) {
    view.innerHTML = `<div class="section-card" style="padding:14px"><p style="margin-top:0"><strong>Cloud-Sync ist noch nicht eingerichtet.</strong></p>
      <p class="hint">Dafür muss einmalig ein Firebase-Projekt angelegt und dessen Konfiguration in die Datei <code>firebase-config.js</code> eingetragen werden.${cloud.fehler ? "<br><br>" + escapeHtml(cloud.fehler) : ""}</p></div>`;
    return;
  }

  if (!cloud.user) {
    view.innerHTML = `
      <div class="section-card" style="padding:14px">
        <p style="margin-top:0">Mit einem Konto werden alle Aufmaße, Bauaufmaße, Packlisten, die Materialdatenbank und Favoriten auf allen deinen Geräten abgeglichen. Andere Benutzer sehen nur ihre eigenen Daten.</p>
        <div class="field-grid">
          <label>E-Mail <input type="email" id="cl_email" autocomplete="username" inputmode="email"></label>
          <label>Passwort <input type="password" id="cl_pw" autocomplete="current-password"></label>
        </div>
        <p class="hint" id="cl_meldung" hidden></p>
        <div class="action-bar">
          <button class="btn btn-primary" id="cl_login">Anmelden</button>
          <button class="btn btn-secondary" id="cl_register">Neues Konto</button>
        </div>
        <button class="btn-link-accent" id="cl_reset">Passwort vergessen?</button>
        <p class="hint">Bereits auf diesem Gerät gespeicherte Daten werden beim ersten Anmelden in das Konto übernommen.</p>
      </div>`;
    const email = view.querySelector("#cl_email");
    const pw = view.querySelector("#cl_pw");
    const meldung = view.querySelector("#cl_meldung");
    const zeige = (t) => { meldung.hidden = false; meldung.textContent = t; };
    const sperre = (an) => view.querySelectorAll("button").forEach((b) => (b.disabled = an));
    view.querySelector("#cl_login").addEventListener("click", async () => {
      sperre(true);
      try { await cloud.auth.signInWithEmailAndPassword(email.value.trim(), pw.value); oeffneEinstellungen(); }
      catch (e) { zeige(authFehlerText(e)); }
      sperre(false);
    });
    view.querySelector("#cl_register").addEventListener("click", async () => {
      if (pw.value.length < 6) { zeige("Bitte ein Passwort mit mindestens 6 Zeichen wählen."); return; }
      sperre(true);
      try { await cloud.auth.createUserWithEmailAndPassword(email.value.trim(), pw.value); oeffneEinstellungen(); }
      catch (e) { zeige(authFehlerText(e)); }
      sperre(false);
    });
    view.querySelector("#cl_reset").addEventListener("click", async () => {
      if (!email.value.trim()) { zeige("Bitte zuerst die E-Mail-Adresse eintragen."); return; }
      try { await cloud.auth.sendPasswordResetEmail(email.value.trim()); zeige("E-Mail zum Zurücksetzen wurde verschickt."); }
      catch (e) { zeige(authFehlerText(e)); }
    });
    return;
  }

  view.innerHTML = `
    <div class="section-card" style="padding:14px">
      <p style="margin-top:0">Angemeldet als <strong></strong></p>
      <p class="hint" id="cloudKontoStatus"></p>
      <div class="action-bar">
        <button class="btn btn-secondary" id="cl_sync">Jetzt synchronisieren</button>
        <button class="btn btn-outline" id="cl_logout">Abmelden</button>
      </div>
    </div>`;
  view.querySelector("strong").textContent = cloud.user.email;
  view.querySelector("#cloudKontoStatus").textContent = cloudStatusText().text;
  view.querySelector("#cl_sync").addEventListener("click", () => {
    cloud.fehler = "";
    if (cloud.abos.length === 0) aboniere();
    syncAlles();
    planeUi();
  });
  view.querySelector("#cl_logout").addEventListener("click", async () => {
    const n = anzahlAusstehend();
    if (n > 0 && !confirm(`${n} Änderung(en) sind noch nicht in der Cloud. Trotzdem abmelden?`)) return;
    const loeschen = confirm("Abmelden.\n\nOK = zusätzlich alle Daten von diesem Gerät entfernen (z. B. bei fremdem/geteiltem Gerät).\nAbbrechen = Daten auf dem Gerät behalten.");
    beendeAbos();
    await cloud.auth.signOut();
    if (loeschen) { loescheLokaleDaten(); initDatenbank(); }
    oeffneEinstellungen();
  });
}

/* ---------- Start ---------- */

function initCloudSync() {
  ladeSyncMeta();
  // Jede Speicherung der beobachteten Schlüssel löst Scan + Upload aus
  const beobachtet = new Map(SYNC_SAMMLUNGEN.map((s) => [s.key, s]));
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    original.call(this, k, v);
    if (!cloud.intern && this === window.localStorage && beobachtet.has(k)) planeScan(beobachtet.get(k));
  };
  for (const s of SYNC_SAMMLUNGEN) scanSammlung(s);

  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || typeof firebase === "undefined") {
    cloud.konfiguriert = false;
    if (cfg && typeof firebase === "undefined") cloud.fehler = "Firebase-Bibliothek konnte nicht geladen werden.";
    planeUi();
    return;
  }
  try {
    firebase.initializeApp(cfg);
    cloud.auth = firebase.auth();
    cloud.db = firebase.firestore();
    // Nur für lokale Tests mit dem Firebase-Emulator
    if (location.hostname === "localhost" && window.FIREBASE_EMULATOR) {
      cloud.auth.useEmulator("http://localhost:9099");
      cloud.db.useEmulator("localhost", 8080);
    }
    cloud.konfiguriert = true;
  } catch (e) {
    console.error("Firebase-Initialisierung fehlgeschlagen", e);
    cloud.fehler = "Firebase-Initialisierung fehlgeschlagen: " + e.message;
    planeUi();
    return;
  }
  cloud.auth.onAuthStateChanged((user) => {
    if (user) beiAnmeldung(user);
    else {
      cloud.user = null;
      beendeAbos();
      planeUi();
    }
  });
  window.addEventListener("online", () => { cloud.fehler = ""; if (cloud.user) syncAlles(); planeUi(); });
  window.addEventListener("offline", planeUi);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && cloud.user) syncAlles(); });
  planeUi();
}

initCloudSync();

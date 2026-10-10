"use strict";

/* ============================================================
   Aufmaßsoftware – Mitarbeiter & Aufmaßnummern
   - Mitarbeitername (+ Kürzel) wird einmal in den Einstellungen hinterlegt
     und erscheint auf jedem exportierten Aufmaß / Bauaufmaß.
   - Aufmaßnummer „<Kürzel>-<JJ>-<NNN>“ (z. B. SB-26-001), ein gemeinsamer
     Zähler für Aufmaße und Bauaufmaße, je Jahr ab 001. Vergeben wird sie
     beim ersten PDF-Export; einmal vergebene Nummern werden nie wieder
     benutzt (Zählerstand wird gespeichert und synchronisiert).
   Gespeichert in „am2_einstellungen“ (Map, per Cloud-Sync abgeglichen):
     { mitarbeiter: { name, kuerzel }, "zaehler:SB-26": 3, … }
   Wird nach app.js geladen.
   ============================================================ */

const STORAGE_KEY_EINSTELLUNGEN = "am2_einstellungen";
let einstellungen = {};

function ladeEinstellungen() {
  try { einstellungen = JSON.parse(localStorage.getItem(STORAGE_KEY_EINSTELLUNGEN) || "{}") || {}; }
  catch (e) { einstellungen = {}; }
}
ladeEinstellungen();

function speichereEinstellungen() {
  try { localStorage.setItem(STORAGE_KEY_EINSTELLUNGEN, JSON.stringify(einstellungen)); }
  catch (e) { console.error("Einstellungen konnten nicht gespeichert werden", e); }
}

function mitarbeiterName() {
  return ((einstellungen.mitarbeiter && einstellungen.mitarbeiter.name) || "").trim();
}

// „Sebastian Bruns“ -> „SB“, „Anna-Lena Meyer“ -> „AM“, „Kai“ -> „KA“
function initialenAus(name) {
  const worte = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!worte.length) return "";
  if (worte.length === 1) return worte[0].slice(0, 2).toUpperCase();
  return (worte[0][0] + worte[worte.length - 1][0]).toUpperCase();
}

function mitarbeiterKuerzel() {
  const k = ((einstellungen.mitarbeiter && einstellungen.mitarbeiter.kuerzel) || "").trim().toUpperCase();
  return (k || initialenAus(mitarbeiterName())).replace(/[^A-ZÄÖÜ0-9]/g, "");
}

function setzeMitarbeiter(name, kuerzel) {
  einstellungen.mitarbeiter = { name: String(name || "").trim(), kuerzel: String(kuerzel || "").trim().toUpperCase() };
  speichereEinstellungen();
}

/* Fragt den Namen ab, falls noch keiner hinterlegt ist. true = Name vorhanden. */
function stelleMitarbeiterSicher() {
  if (mitarbeiterName() && mitarbeiterKuerzel()) return true;
  const name = (prompt("Bitte einmalig deinen Namen eintragen.\nEr erscheint auf jedem Aufmaß, die Initialen bilden die Aufmaßnummer (z. B. SB-26-001).", "") || "").trim();
  if (!name) return false;
  setzeMitarbeiter(name, "");
  return true;
}

function nummernPraefix(jahr) {
  const jj = String(jahr || new Date().getFullYear()).slice(-2);
  return `${mitarbeiterKuerzel()}-${jj}`;
}

// höchste bisher vergebene laufende Nummer für ein Präfix (Listen + gespeicherter Zählerstand)
function hoechsteNummer(praefix) {
  let max = Number(einstellungen["zaehler:" + praefix]) || 0;
  const re = new RegExp("^" + praefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)$");
  const alle = [...((typeof aufmassListe !== "undefined" && aufmassListe) || []), ...((typeof bauaufmasse !== "undefined" && bauaufmasse) || [])];
  for (const x of alle) {
    const m = re.exec(x && x.nummer ? String(x.nummer) : "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function naechsteAufmassNummer() {
  const praefix = nummernPraefix();
  const n = hoechsteNummer(praefix) + 1;
  einstellungen["zaehler:" + praefix] = n;
  speichereEinstellungen();
  return `${praefix}-${String(n).padStart(3, "0")}`;
}

function vorschauNaechsteNummer() {
  if (!mitarbeiterKuerzel()) return "";
  const praefix = nummernPraefix();
  return `${praefix}-${String(hoechsteNummer(praefix) + 1).padStart(3, "0")}`;
}

/* Vergibt beim ersten PDF eine Nummer (bleibt danach fest). Liefert die Nummer oder "" (abgebrochen). */
function vergibNummer(obj) {
  if (obj.nummer) return obj.nummer;
  if (!stelleMitarbeiterSicher()) return "";
  obj.nummer = naechsteAufmassNummer();
  obj.mitarbeiter = mitarbeiterName();
  return obj.nummer;
}

// Name auf dem PDF: der beim Vergeben gespeicherte, sonst der aktuelle
function pdfMitarbeiter(obj) {
  return (obj.mitarbeiter || mitarbeiterName() || "").trim();
}

/* Kopfzeile rechts im PDF: „Nr. SB-26-001“ (fett) über dem Datum, darunter Mitarbeiter */
function pdfKopfRechts(doc, obj, datumText, marginX, y) {
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  if (obj.nummer) doc.text(`Nr. ${obj.nummer}`, 210 - marginX, y - 5, { align: "right" });
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(datumText, 210 - marginX, y, { align: "right" });
  const ma = pdfMitarbeiter(obj);
  if (ma) doc.text(`Mitarbeiter: ${ma}`, 210 - marginX, y + 5, { align: "right" });
}

/* ---------- Einstellungen (Startseite → ⚙ Einstellungen) ---------- */

function oeffneEinstellungen() {
  setzeAnsicht("einstellungen");
  currentAufmass = null;
  currentPackliste = null;
  currentBauaufmass = null;
  currentRaum = null;
  zurueckAktion = zeigeStart;
  headerTitle.textContent = "Einstellungen";
  btnBack.hidden = false;
  btnNew.hidden = true;
  app.innerHTML = "";
  const view = document.createElement("section");
  view.className = "view";
  view.innerHTML = `
    <div class="section-card einstellungen-karte">
      <strong>Mitarbeiter</strong>
      <label>Dein Name
        <input type="text" id="e_name" autocomplete="name" placeholder="z. B. Sebastian Bruns">
      </label>
      <label>Kürzel für die Aufmaßnummer
        <input type="text" id="e_kuerzel" autocomplete="off" maxlength="4" placeholder="automatisch aus dem Namen">
      </label>
      <p class="hint" id="e_vorschau"></p>
      <p class="hint">Der Name steht auf jedem exportierten Aufmaß und Bauaufmaß. Die Nummer wird beim ersten PDF vergeben – fortlaufend je Jahr (Kürzel-Jahr-Nummer), gemeinsam für Aufmaße und Bauaufmaße. Einmal vergebene Nummern ändern sich nicht mehr.</p>
    </div>
    <div id="e_kacheln" class="view"></div>
    <div id="e_kunden"></div>
    <div id="e_katalog"></div>`;
  app.appendChild(view);
  window.scrollTo(0, 0);
  const name = document.getElementById("e_name");
  const kuerzel = document.getElementById("e_kuerzel");
  const vorschau = document.getElementById("e_vorschau");
  name.value = mitarbeiterName();
  kuerzel.value = (einstellungen.mitarbeiter && einstellungen.mitarbeiter.kuerzel) || "";
  const zeige = () => {
    kuerzel.placeholder = initialenAus(name.value) ? `automatisch: ${initialenAus(name.value)}` : "automatisch aus dem Namen";
    const v = vorschauNaechsteNummer();
    vorschau.textContent = v ? `Nächste Aufmaßnummer: ${v}` : "Bitte Namen eintragen.";
  };
  const speichern = () => { setzeMitarbeiter(name.value, kuerzel.value); zeige(); };
  name.addEventListener("input", speichern);
  kuerzel.addEventListener("input", () => { kuerzel.value = kuerzel.value.toUpperCase(); speichern(); });
  zeige();
  if (!name.value) setTimeout(() => name.focus(), 50);
  const kacheln = document.getElementById("e_kacheln");
  if (typeof oeffneDatenbank === "function") kacheln.appendChild(baueKachel("🗂", "Materialdatenbank", `${dbMaterial.length} Einträge · Standardmaterial, Produkte, eigene Artikel`, () => oeffneDatenbank()));
  if (typeof oeffneCloudKonto === "function") {
    const ck = baueKachel("☁", "Cloud-Sync", "", () => oeffneCloudKonto(), "kachel-cloud");
    ck.querySelector("small").id = "cloudStatus";
    kacheln.appendChild(ck);
    if (typeof renderCloudStatus === "function") renderCloudStatus();
  }
  if (typeof renderKundenstammEinstellungen === "function") renderKundenstammEinstellungen(document.getElementById("e_kunden"));
  if (typeof renderKatalogEinstellungen === "function") renderKatalogEinstellungen(document.getElementById("e_katalog"));
}

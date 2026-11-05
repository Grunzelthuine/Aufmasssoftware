/* v7.13: Arbeitszeit im Aufmaß
   - Stunden aus der Stundenzettel-App: Dort wird bei „Aufmaß ja“ die Aufmaßnummer gewählt;
     die Stundenzettel-App legt pro Nummer ein Dokument users/{uid}/sz_aufmass_stunden/{nr} ab
     ({ nr, mitarbeiter, eintraege: [{ id, datum, stunden, zeit, taetigkeit, kunde }], del, t }).
     Solange das Aufmaß offen ist, wird dieses Dokument live gelesen und als Kopie im Aufmaß
     gespeichert (a.arbeitszeit.sz). Nach dem Senden bleibt die Kopie unverändert (Stand beim Senden).
   - Manuelle Zeilen (Kollegen, Helfer ohne Stundenzettel-App): Name, optional Datum, Stunden.
   - Schalter „Arbeitszeit ins Aufmaß übernehmen“: aus = kein Arbeitszeit-Block im PDF.
   Das PDF wird synchron erzeugt (Teilen-Menü auf dem iPhone braucht den direkten Tipp),
   deshalb nutzt es immer die bereits gespeicherte Kopie. */

let azAbo = null;        // { nr, unsub }
let azStatus = "";       // Hinweis zum Laden aus dem Stundenzettel

function azDaten(a) {
  if (!a.arbeitszeit || typeof a.arbeitszeit !== "object") a.arbeitszeit = {};
  const z = a.arbeitszeit;
  if (typeof z.aktiv !== "boolean") z.aktiv = true;
  if (!Array.isArray(z.sz)) z.sz = [];
  if (!Array.isArray(z.manuell)) z.manuell = [];
  return z;
}

function azZahl(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function azStd(n) {
  return (Math.round(n * 100) / 100).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Stundenzettel-Einträge zu einer Zeile pro Tag zusammenfassen
function azTageszeilen(a) {
  const z = azDaten(a);
  const map = new Map();
  for (const e of z.sz) {
    if (!e || !e.datum) continue;
    const t = map.get(e.datum) || { datum: e.datum, stunden: 0, taetigkeiten: [] };
    t.stunden += azZahl(e.stunden);
    const txt = String(e.taetigkeit || "").trim();
    if (txt && !t.taetigkeiten.includes(txt)) t.taetigkeiten.push(txt);
    map.set(e.datum, t);
  }
  return [...map.values()].sort((x, y) => x.datum.localeCompare(y.datum));
}

function azManuelleZeilen(a) {
  return azDaten(a).manuell.filter((m) => String(m.name || "").trim() || azZahl(m.stunden) > 0);
}

function azSumme(a) {
  return azTageszeilen(a).reduce((s, t) => s + t.stunden, 0) +
    azManuelleZeilen(a).reduce((s, m) => s + azZahl(m.stunden), 0);
}

function azSzMitarbeiter(a) {
  const z = azDaten(a);
  return (z.szMitarbeiter || (typeof pdfMitarbeiter === "function" ? pdfMitarbeiter(a) : "") || "").trim();
}

/* ---------- Live-Abgleich mit dem Stundenzettel ---------- */

function azAboBeenden() {
  if (azAbo && azAbo.unsub) { try { azAbo.unsub(); } catch (e) { /* ignore */ } }
  azAbo = null;
}

function azAboStarten(a) {
  const nr = String(a.nummer || "").trim().toUpperCase();
  if (!nr) { azAboBeenden(); azStatus = ""; return; }
  if (typeof cloud === "undefined" || !cloud.db || !cloud.user) {
    azAboBeenden();
    azStatus = "Nicht angemeldet – Stunden aus dem Stundenzettel werden nach der Anmeldung geladen.";
    return;
  }
  if (azAbo && azAbo.nr === nr && azAbo.uid === cloud.user.uid) return;
  azAboBeenden();
  azStatus = "Stunden werden geladen …";
  const ref = cloud.db.collection("users").doc(cloud.user.uid).collection("sz_aufmass_stunden").doc(encodeURIComponent(nr));
  const abo = { nr, uid: cloud.user.uid, unsub: null };
  abo.unsub = ref.onSnapshot((snap) => {
    if (currentAufmass !== a) { azAboBeenden(); return; }
    const z = azDaten(a);
    if (a.gesendet) { azStatus = ""; azRenderSz(a); return; } // Stand beim Senden bleibt
    const x = snap.exists ? (snap.data() || {}) : {};
    const neu = !x.del && Array.isArray(x.eintraege) ? x.eintraege : [];
    const vorher = JSON.stringify([z.sz, z.szMitarbeiter || ""]);
    z.sz = neu.map((e) => ({ datum: e.datum || "", stunden: azZahl(e.stunden), taetigkeit: e.taetigkeit || "" }));
    z.szMitarbeiter = x.mitarbeiter || z.szMitarbeiter || "";
    azStatus = snap.metadata && snap.metadata.fromCache ? "Offline – letzter bekannter Stand." : "";
    if (JSON.stringify([z.sz, z.szMitarbeiter || ""]) !== vorher) autosave();
    azRenderSz(a);
  }, (err) => {
    console.warn("Stunden aus dem Stundenzettel konnten nicht geladen werden", err);
    azStatus = "Stunden konnten nicht geladen werden – gespeicherter Stand wird verwendet.";
    azRenderSz(a);
  });
  azAbo = abo;
}

/* ---------- Anzeige im Formular ---------- */

function renderArbeitszeit(a) {
  const box = document.getElementById("arbeitszeitBox");
  if (!box) return;
  const z = azDaten(a);
  box.innerHTML = `
    <label class="az-schalter"><input type="checkbox" id="az_aktiv" ${z.aktiv ? "checked" : ""}> Arbeitszeit ins Aufmaß übernehmen</label>
    <div id="az_inhalt">
      <h4 class="az-titel">Aus dem Stundenzettel</h4>
      <div id="az_sz"></div>
      <h4 class="az-titel">Weitere Stunden (Kollegen, Helfer)</h4>
      <div id="az_manuell"></div>
      <button type="button" class="btn-link-accent" id="az_neu"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Person hinzufügen</button>
      <div class="az-summe">Summe: <strong id="az_summe">0</strong> Std</div>
    </div>`;
  const inhalt = box.querySelector("#az_inhalt");
  inhalt.classList.toggle("az-aus", !z.aktiv);
  box.querySelector("#az_aktiv").addEventListener("change", (e) => {
    z.aktiv = e.target.checked;
    inhalt.classList.toggle("az-aus", !z.aktiv);
    autosave();
  });
  box.querySelector("#az_neu").addEventListener("click", () => {
    z.manuell.push({ id: neueId(), name: "", datum: "", stunden: "" });
    autosave();
    azRenderManuell(a);
    const felder = box.querySelectorAll(".az-name");
    if (felder.length) felder[felder.length - 1].focus();
  });
  azAboStarten(a);
  azRenderSz(a);
  azRenderManuell(a);
}

function azRenderSumme(a) {
  const el = document.getElementById("az_summe");
  if (el) el.textContent = azStd(azSumme(a));
}

function azRenderSz(a) {
  const ziel = document.getElementById("az_sz");
  if (!ziel || currentAufmass !== a) return;
  ziel.innerHTML = "";
  if (!a.nummer) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Damit du im Stundenzettel Stunden zu diesem Aufmaß auswählen kannst, braucht es eine Nummer. Die Nummer wird vergeben, ohne dass etwas gesendet wird.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline az-nr-btn";
    btn.textContent = "Nummer jetzt vergeben";
    btn.addEventListener("click", () => azNummerVergeben(a));
    ziel.append(p, btn);
    azRenderSumme(a);
    return;
  }
  const tage = azTageszeilen(a);
  if (tage.length) {
    const ma = azSzMitarbeiter(a);
    const ul = document.createElement("ul");
    ul.className = "az-liste";
    for (const t of tage) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="az-datum"></span><span class="az-text"></span><span class="az-std"></span>`;
      li.querySelector(".az-datum").textContent = formatDatumDE(t.datum);
      li.querySelector(".az-text").textContent = [ma, t.taetigkeiten.join("; ")].filter(Boolean).join(" · ");
      li.querySelector(".az-std").textContent = azStd(t.stunden) + " Std";
      ul.appendChild(li);
    }
    ziel.appendChild(ul);
  }
  const hinweis = document.createElement("p");
  hinweis.className = "hint";
  if (a.gesendet) hinweis.textContent = tage.length ? "Stand beim Senden – später erfasste Stunden kommen nicht mehr dazu." : "Beim Senden waren keine Stunden aus dem Stundenzettel verknüpft.";
  else if (!tage.length) hinweis.textContent = `Noch keine Stunden verknüpft. Im Stundenzettel bei „Aufmaß ja“ die Nummer ${a.nummer} wählen, dann erscheinen sie hier.`;
  else hinweis.textContent = `Alle Stundenzettel-Einträge mit Nummer ${a.nummer}.`;
  if (azStatus && !a.gesendet) hinweis.textContent += " " + azStatus;
  ziel.appendChild(hinweis);
  azRenderSumme(a);
}

function azRenderManuell(a) {
  const ziel = document.getElementById("az_manuell");
  if (!ziel) return;
  const z = azDaten(a);
  ziel.innerHTML = "";
  for (const m of z.manuell) {
    const row = document.createElement("div");
    row.className = "az-zeile";
    row.innerHTML = `
      <input type="text" class="az-name" placeholder="Name" autocomplete="off">
      <input type="date" class="az-dat" title="Datum (optional)">
      <input type="text" class="az-h" placeholder="Std" inputmode="decimal" autocomplete="off">
      <button type="button" class="icon-btn az-weg" aria-label="Zeile entfernen"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>`;
    const [name, dat, h] = row.querySelectorAll("input");
    name.value = m.name || "";
    dat.value = m.datum || "";
    h.value = m.stunden === "" || m.stunden == null ? "" : String(m.stunden).replace(".", ",");
    name.addEventListener("input", () => { m.name = name.value; autosave(); });
    dat.addEventListener("input", () => { m.datum = dat.value; autosave(); });
    h.addEventListener("input", () => { m.stunden = h.value.trim() ? azZahl(h.value) : ""; autosave(); azRenderSumme(a); });
    row.querySelector(".az-weg").addEventListener("click", () => {
      z.manuell = z.manuell.filter((x) => x !== m);
      autosave();
      azRenderManuell(a);
    });
    ziel.appendChild(row);
  }
  azRenderSumme(a);
}

function azNummerVergeben(a) {
  if (!vergibNummer(a)) return;
  if (currentAufmass === a) upsertCurrentInListe(); else speichereListe();
  aktualisiereGesendetStatus(a);
  if (currentAufmass === a) { azAboStarten(a); azRenderSz(a); }
  if (typeof ksToast === "function") ksToast(`Nummer ${a.nummer} vergeben – jetzt im Stundenzettel auswählbar.`);
}

/* ---------- PDF ---------- */

// Hängt den Block „Arbeitszeit“ unter die Materialliste. Gibt nichts aus, wenn abgewählt oder leer.
function pdfArbeitszeit(doc, a, marginX, fusszeile) {
  const z = azDaten(a);
  if (!z.aktiv) return;
  const ma = azSzMitarbeiter(a);
  const body = [];
  for (const t of azTageszeilen(a)) body.push([formatDatumDE(t.datum), ma, t.taetigkeiten.join("; "), azStd(t.stunden)]);
  for (const m of azManuelleZeilen(a)) body.push([m.datum ? formatDatumDE(m.datum) : "", String(m.name || "").trim(), "", azStd(azZahl(m.stunden))]);
  if (!body.length) return;

  let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 40) + 10;
  if (y > 297 - 40) { doc.addPage(); y = 20; }
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text("Arbeitszeit", marginX, y);
  doc.setFont(undefined, "normal");
  doc.autoTable({
    startY: y + 3,
    head: [["Datum", "Mitarbeiter", "Tätigkeit", "Std."]],
    body,
    foot: [["", "", "Summe", azStd(azSumme(a))]],
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [21, 34, 56] },
    footStyles: { fillColor: [235, 238, 243], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 38 }, 3: { cellWidth: 16, halign: "right" } },
    didParseCell: (d) => { if (d.column.index === 3) d.cell.styles.halign = "right"; },
    didDrawPage: fusszeile
  });
}
